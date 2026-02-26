import type { docs_v1, drive_v3 } from "googleapis";
import { parseCommand, tryAutoDetect } from "./core/commands.js";
import type { ParsedCommand } from "./core/commands.js";
import { sha256Hex } from "./util/hash.js";
import { Repo } from "./db/repo.js";
import { listAccessibleDocs } from "./google/drive.js";
import {
  appendAuditRow,
  appendCommandRow,
  appendRecentActivityRow,
  loadDocWalletTables,
  readChatTable,
  readCommandsTable,
  readConfig,
  updateBalancesTable,
  updateChatRowCells,
  updateCommandsRowCells,
  userEditableCommandsHash,
  writeConfigBatch
} from "./google/docwallet.js";
import { createAndStoreDocSecrets, loadDocSecrets } from "./wallet/store.js";
import type { AppConfig } from "./config.js";
import type { StacksClient } from "./integrations/stacks.js";
import type { SbtcClient } from "./integrations/sbtc.js";
import type { UsdcxClient } from "./integrations/usdcx.js";
import type { X402Client } from "./integrations/x402.js";
import type { HederaClient } from "./integrations/hedera.js";
import { cvToJSON, stringAsciiCV, uintCV, principalCV } from "@stacks/transactions";

type ExecutionContext = {
  config: AppConfig;
  docs: docs_v1.Docs;
  drive: drive_v3.Drive;
  repo: Repo;
  hedera?: HederaClient;
  stacks?: StacksClient;
  sbtc?: SbtcClient;
  usdcx?: UsdcxClient;
  x402?: X402Client;
};

export class Engine {
  private discoveryRunning = false;
  private pollRunning = false;
  private executorRunning = false;
  private chatRunning = false;
  private balancesRunning = false;
  private schedulerRunning = false;
  private priceTickRunning = false;
  private agentDecisionRunning = false;
  private payoutRulesRunning = false;

  constructor(private ctx: ExecutionContext) {}

  private pollFailures = new Map<string, number>();

  async discoveryTick() {
    if (this.discoveryRunning) return;
    this.discoveryRunning = true;
    try {
      const { config, drive, docs, repo } = this.ctx;
      if (config.DOCWALLET_DOC_ID) {
        const d = await docs.documents.get({ documentId: config.DOCWALLET_DOC_ID });
        repo.upsertDoc({ docId: config.DOCWALLET_DOC_ID, name: d.data.title ?? config.DOCWALLET_DOC_ID });
        await loadDocWalletTables({ docs, docId: config.DOCWALLET_DOC_ID });
        console.log(`[discovery] single-doc mode: ${d.data.title ?? config.DOCWALLET_DOC_ID}`);
        return;
      }

      const namePrefix = config.DOCWALLET_DISCOVER_ALL ? undefined : config.DOCWALLET_NAME_PREFIX;
      const files = await listAccessibleDocs({ drive, namePrefix });

      console.log(`[discovery] Drive returned ${files.length} doc(s)${namePrefix ? ` (prefix: "${namePrefix}")` : " (all docs)"}`);

      const driveIds = new Set(files.map((f) => f.id));
      const tracked = repo.listDocs();
      let pruned = 0;
      for (const d of tracked) {
        if (!driveIds.has(d.doc_id)) {
          console.log(`[discovery] removing stale doc ${d.doc_id.slice(0, 8)}…`);
          try { repo.removeDoc(d.doc_id); } catch { /* ignore */ }
          pruned++;
        }
      }
      if (pruned > 0) console.log(`[discovery] pruned ${pruned} stale doc(s)`);

      for (const f of files) {
        try {
          repo.upsertDoc({ docId: f.id, name: f.name });
          await loadDocWalletTables({ docs, docId: f.id });
          console.log(`[discovery] ✅ ${f.id.slice(0, 8)}… "${f.name}" — template OK`);
          this.pollFailures.delete(f.id);
        } catch (err) {
          console.error(`[discovery] ❌ ${f.id.slice(0, 8)}… "${f.name}" — ${(err as Error).message}`);
          try { repo.removeDoc(f.id); } catch { /* ignore */ }
        }
      }

      if (files.length === 0) {
        console.warn(
          `[discovery] no docs found! Make sure your Google Docs are shared with the service account as Editor.\n` +
          `  Tip: Share your doc → Add people → paste the service account email → choose "Editor" role`
        );
      }
    } finally {
      this.discoveryRunning = false;
    }
  }

  async pollTick() {
    if (this.pollRunning) return;
    this.pollRunning = true;
    try {
      const { docs, repo, config } = this.ctx;
      const tracked = repo.listDocs();
      const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;

      for (const d of tracked) {
        const docId = d.doc_id;
        let tables;
        let configMap;
        try {
          tables = await loadDocWalletTables({ docs, docId });
          configMap = readConfig(tables.config.table);
          this.pollFailures.delete(docId);
        } catch (err) {
          const fails = (this.pollFailures.get(docId) ?? 0) + 1;
          this.pollFailures.set(docId, fails);
          if (fails <= 2) {
            console.error(`[poll] ${docId.slice(0, 8)}… ${(err as Error).message}`);
          } else if (fails === 3) {
            console.error(`[poll] ${docId.slice(0, 8)}… failed ${fails}x — suppressing future logs`);
          }
          if (fails >= 10) {
            console.warn(`[poll] removing ${docId.slice(0, 8)}… after ${fails} consecutive failures`);
            try { repo.removeDoc(docId); } catch { /* ignore */ }
            this.pollFailures.delete(docId);
          }
          continue;
        }

        const commandsHash = sha256Hex(userEditableCommandsHash(tables.commands.table));
        if (d.last_user_hash && d.last_user_hash === commandsHash) continue;

        const rows = readCommandsTable(tables.commands.table);
        for (const row of rows) {
          if (!row.command) continue;

          if (row.id) {
            const existing = repo.getCommand(row.id);
            if (existing?.status === "PENDING_APPROVAL") {
              const cellStatus = row.status.toUpperCase().trim();
              if (cellStatus === "APPROVED") {
                repo.setCommandStatus(row.id, "APPROVED");
                await this.audit(docId, `${row.id} APPROVED (cell-edit)`);
                continue;
              }
              if (cellStatus === "REJECTED" || cellStatus === "REJECT") {
                repo.setCommandStatus(row.id, "REJECTED", { errorText: "Rejected via cell edit" });
                await this.audit(docId, `${row.id} REJECTED (cell-edit)`);
                continue;
              }
            }
          }

          if (!row.command.toUpperCase().startsWith("DW")) {
            const detected = tryAutoDetect(row.command);
            if (detected?.ok) {
              const dw = reconstructDwCommand(detected.value);
              if (dw) {
                row.command = dw;
                await updateCommandsRowCells({
                  docs,
                  docId,
                  commandsTable: tables.commands.table,
                  rowIndex: row.rowIndex,
                  updates: { command: dw }
                });
              }
            }
          }

          if (!row.id) {
            const cmdId = generateCmdId(docId, row.command);
            const parsed = parseCommand(row.command);
            if (!parsed.ok) {
              repo.upsertCommand({
                cmd_id: cmdId,
                doc_id: docId,
                raw_command: row.command,
                parsed_json: null,
                status: "INVALID",
                yellow_intent_id: null,
                sui_tx_digest: null,
                arc_tx_hash: null,
                result_text: null,
                error_text: parsed.error
              });
              await this.updateRowByIndex(docId, row.rowIndex, { id: cmdId, status: "INVALID", error: parsed.error, approvalUrl: "" });
              await this.audit(docId, `${cmdId} INVALID (${parsed.error})`);
              continue;
            }

            const AUTO_APPROVE = new Set([
              "SETUP", "STATUS", "STX_PRICE", "STX_BALANCE", "STX_HISTORY", "TREASURY",
              "SBTC_BALANCE", "SBTC_INFO", "USDCX_BALANCE", "X402_STATUS",
              "CONTRACT_READ", "STACK_STATUS"
            ]);
            const demoMode = config.DEMO_MODE || configMap["DEMO_MODE"]?.value?.trim() === "1";
            const initialStatus = AUTO_APPROVE.has(parsed.value.type) || demoMode ? "APPROVED" : "PENDING_APPROVAL";
            const approvalUrl = initialStatus === "PENDING_APPROVAL"
              ? `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(cmdId)}`
              : "";

            repo.upsertCommand({
              cmd_id: cmdId,
              doc_id: docId,
              raw_command: row.command,
              parsed_json: JSON.stringify(parsed.value, (_k, v) => typeof v === "bigint" ? v.toString() : v),
              status: initialStatus,
              yellow_intent_id: null,
              sui_tx_digest: null,
              arc_tx_hash: null,
              result_text: null,
              error_text: null
            });

            await this.updateRowByIndex(docId, row.rowIndex, { id: cmdId, status: initialStatus, approvalUrl, error: "" });
            await this.audit(docId, `${cmdId} ${initialStatus}`);
            continue;
          }

          const existing = repo.getCommand(row.id);
          if (!existing) continue;
          if (existing.raw_command === row.command) continue;
          if (existing.status !== "PENDING_APPROVAL" && existing.status !== "INVALID") {
            await updateCommandsRowCells({
              docs,
              docId,
              commandsTable: tables.commands.table,
              rowIndex: row.rowIndex,
              updates: { error: "Command locked after approval/execution" }
            });
            continue;
          }

          const parsed = parseCommand(row.command);
          if (!parsed.ok) {
            repo.upsertCommand({
              cmd_id: existing.cmd_id,
              doc_id: existing.doc_id,
              raw_command: row.command,
              parsed_json: null,
              status: "INVALID",
              yellow_intent_id: existing.yellow_intent_id,
              sui_tx_digest: existing.sui_tx_digest,
              arc_tx_hash: existing.arc_tx_hash,
              result_text: existing.result_text,
              error_text: parsed.error
            });
            await updateCommandsRowCells({
              docs,
              docId,
              commandsTable: tables.commands.table,
              rowIndex: row.rowIndex,
              updates: { status: "INVALID", error: parsed.error }
            });
          } else {
            repo.upsertCommand({
              cmd_id: existing.cmd_id,
              doc_id: existing.doc_id,
              raw_command: row.command,
              parsed_json: JSON.stringify(parsed.value, (_k, v) => typeof v === "bigint" ? v.toString() : v),
              status: "PENDING_APPROVAL",
              yellow_intent_id: existing.yellow_intent_id,
              sui_tx_digest: existing.sui_tx_digest,
              arc_tx_hash: existing.arc_tx_hash,
              result_text: existing.result_text,
              error_text: null
            });
            await updateCommandsRowCells({
              docs,
              docId,
              commandsTable: tables.commands.table,
              rowIndex: row.rowIndex,
              updates: {
                status: "PENDING_APPROVAL",
                approvalUrl: `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(existing.cmd_id)}`,
                error: ""
              }
            });
          }
        }

        repo.setDocLastUserHash(docId, commandsHash);
      }
    } finally {
      this.pollRunning = false;
    }
  }

  async executorTick() {
    if (this.executorRunning) return;
    this.executorRunning = true;
    try {
      const { repo } = this.ctx;
      const docs = repo.listDocs();
      for (const d of docs) {
        const pending = repo.listPendingCommands(d.doc_id);
        for (const cmd of pending) {
          const parsed = cmd.parsed_json ? JSON.parse(cmd.parsed_json) as ParsedCommand : null;
          if (!parsed) {
            repo.setCommandStatus(cmd.cmd_id, "FAILED", { errorText: "Missing parsed command" });
            continue;
          }
          // Restore BigInt values from JSON strings
          if ("amountMicroStx" in parsed) (parsed as any).amountMicroStx = BigInt((parsed as any).amountMicroStx);
          if ("amountSats" in parsed) (parsed as any).amountSats = BigInt((parsed as any).amountSats);
          if ("amount" in parsed && typeof (parsed as any).amount === "string" && parsed.type.startsWith("USDCX")) {
            (parsed as any).amount = BigInt((parsed as any).amount);
          }
          try {
            repo.setCommandStatus(cmd.cmd_id, "EXECUTING");
            await this.updateDocRow(cmd.doc_id, cmd.cmd_id, { status: "EXECUTING", error: "" });

            const result = await this.execute(cmd.doc_id, cmd.cmd_id, parsed);
            repo.setCommandExecutionIds(cmd.cmd_id, { txId: result.txId });
            repo.setCommandStatus(cmd.cmd_id, "EXECUTED", { resultText: result.resultText, errorText: null });

            await this.updateDocRow(cmd.doc_id, cmd.cmd_id, { status: "EXECUTED", result: result.resultText, error: "" });
            await this.audit(cmd.doc_id, `${cmd.cmd_id} EXECUTED ${result.resultText}`);
            await appendRecentActivityRow({
              docs: this.ctx.docs,
              docId: cmd.doc_id,
              timestampIso: new Date().toISOString(),
              type: parsed.type,
              details: cmd.raw_command,
              tx: result.txId ?? ""
            });
          } catch (err) {
            const e = err instanceof Error ? err.message : String(err);
            repo.setCommandStatus(cmd.cmd_id, "FAILED", { errorText: e });
            await this.updateDocRow(cmd.doc_id, cmd.cmd_id, { status: "FAILED", error: e });
            await this.audit(cmd.doc_id, `${cmd.cmd_id} FAILED ${e}`);
          }
        }
      }
    } finally {
      this.executorRunning = false;
    }
  }

  async chatTick() {
    if (this.chatRunning) return;
    this.chatRunning = true;
    try {
      const { docs, repo } = this.ctx;
      const tracked = repo.listDocs();
      for (const d of tracked) {
        const docId = d.doc_id;
        const tables = await loadDocWalletTables({ docs, docId });
        const rows = readChatTable(tables.chat.table);
        for (const row of rows) {
          if (!row.user || row.agent) continue;
          const raw = row.user.trim();
          const executeNow = raw.toLowerCase().startsWith("!execute ");
          const text = raw.replace(/^!execute\s+/i, "").trim();
          const detected = tryAutoDetect(text);
          if (!detected?.ok) {
            await updateChatRowCells({
              docs,
              docId,
              chatTable: tables.chat.table,
              rowIndex: row.rowIndex,
              agent: "Use Stacks commands: DW STX_PRICE, DW STX_SEND <addr> <microSTX>, DW SBTC_BALANCE, DW USDCX_BALANCE"
            });
            continue;
          }
          const dw = reconstructDwCommand(detected.value);
          if (!dw) {
            await updateChatRowCells({
              docs,
              docId,
              chatTable: tables.chat.table,
              rowIndex: row.rowIndex,
              agent: "That command is not supported."
            });
            continue;
          }

          if (executeNow) {
            const cmdId = generateCmdId(docId, dw);
            repo.upsertCommand({
              cmd_id: cmdId,
              doc_id: docId,
              raw_command: dw,
              parsed_json: JSON.stringify(detected.value, (_k, v) => typeof v === "bigint" ? v.toString() : v),
              status: "PENDING_APPROVAL",
              yellow_intent_id: null,
              sui_tx_digest: null,
              arc_tx_hash: null,
              result_text: null,
              error_text: null
            });
            await appendCommandRow({
              docs,
              docId,
              id: cmdId,
              command: dw,
              status: "PENDING_APPROVAL",
              approvalUrl: `${this.ctx.config.PUBLIC_BASE_URL ?? `http://localhost:${this.ctx.config.HTTP_PORT}`}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(cmdId)}`,
              result: "",
              error: ""
            });
            await updateChatRowCells({
              docs,
              docId,
              chatTable: tables.chat.table,
              rowIndex: row.rowIndex,
              agent: `Submitted: ${dw}`
            });
          } else {
            await updateChatRowCells({
              docs,
              docId,
              chatTable: tables.chat.table,
              rowIndex: row.rowIndex,
              agent: `Use: ${dw}`
            });
          }
        }
      }
    } catch (err) {
      console.error("chatTick error:", err);
    } finally {
      this.chatRunning = false;
    }
  }

  async balancesTick() {
    if (this.balancesRunning) return;
    this.balancesRunning = true;
    try {
      const { docs, repo, config, stacks, sbtc, usdcx } = this.ctx;
      const tracked = repo.listDocs();
      for (const d of tracked) {
        const docId = d.doc_id;
        const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
        if (!secrets) continue;

        const entries: Array<{ location: string; asset: string; balance: string }> = [];

        // STX balance
        if (stacks && secrets.stx) {
          try {
            const bal = await stacks.getBalance(secrets.stx.stxAddress);
            const stxPrice = repo.getPrice("STX/USD")?.mid_price ?? 0;
            const usd = stxPrice > 0 ? ` ($${(Number(bal.stx) / 1_000_000 * stxPrice).toFixed(2)})` : "";
            entries.push({ location: "Stacks", asset: "STX", balance: `${bal.stxFormatted}${usd}` });
          } catch {
            entries.push({ location: "Stacks", asset: "STX", balance: "Unavailable" });
          }
        }

        // sBTC balance
        if (sbtc && secrets.stx) {
          try {
            const bal = await sbtc.getBalance(secrets.stx.stxAddress);
            if (bal.balanceSats > 0n) {
              entries.push({ location: "Stacks (sBTC)", asset: "sBTC", balance: `${bal.balanceBtc} BTC` });
            }
          } catch { /* ignore */ }
        }

        // USDCx balance
        if (usdcx && secrets.stx) {
          try {
            const bal = await usdcx.getBalance(secrets.stx.stxAddress);
            if (bal.balanceRaw > 0n) {
              entries.push({ location: "Stacks (USDCx)", asset: "USDCx", balance: `$${bal.balanceFormatted}` });
            }
          } catch { /* ignore */ }
        }

        const tables = await loadDocWalletTables({ docs, docId });
        await updateBalancesTable({ docs, docId, balancesTable: tables.balances.table, entries });
      }
    } catch (err) {
      console.error("balancesTick error:", err);
    } finally {
      this.balancesRunning = false;
    }
  }

  async schedulerTick() {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      const { docs, repo } = this.ctx;
      const dueSchedules = repo.listDueSchedules();
      for (const s of dueSchedules) {
        const parsed = parseCommand(s.inner_command);
        if (!parsed.ok) {
          repo.cancelSchedule(s.schedule_id);
          await this.audit(s.doc_id, `SCHEDULE ${s.schedule_id} CANCELLED (invalid inner command)`);
          continue;
        }
        const cmdId = generateCmdId(s.doc_id, `sched:${s.schedule_id}:${Date.now()}`);
        repo.upsertCommand({
          cmd_id: cmdId,
          doc_id: s.doc_id,
          raw_command: s.inner_command,
          parsed_json: JSON.stringify(parsed.value, (_k, v) => typeof v === "bigint" ? v.toString() : v),
          status: "APPROVED",
          yellow_intent_id: null,
          sui_tx_digest: null,
          arc_tx_hash: null,
          result_text: null,
          error_text: null
        });
        await appendCommandRow({
          docs,
          docId: s.doc_id,
          id: cmdId,
          command: `[SCHED:${s.schedule_id}#${s.total_runs + 1}] ${s.inner_command}`,
          status: "APPROVED",
          result: "",
          error: ""
        });
        await this.audit(s.doc_id, `SCHEDULE ${s.schedule_id} RUN#${s.total_runs + 1} -> ${cmdId}`);
        repo.advanceSchedule(s.schedule_id);
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  async priceTick() {
    if (this.priceTickRunning) return;
    this.priceTickRunning = true;
    try {
      const { repo, stacks, config } = this.ctx;
      if (!stacks) return;

      // Fetch STX price
      const price = await stacks.getStxPrice();
      if (price && price > 0) {
        repo.upsertPrice("STX/USD", price, price * 0.999, price * 1.001, "coingecko");
      }

      const stxMid = repo.getPrice("STX/USD")?.mid_price ?? 0;
      if (stxMid <= 0) return;

      // Check conditional orders
      const activeOrders = repo.listActiveConditionalOrders().filter((o) => o.base.toUpperCase() === "STX");
      for (const order of activeOrders) {
        const shouldTrigger =
          (order.type === "STOP_LOSS" && stxMid <= order.trigger_price) ||
          (order.type === "TAKE_PROFIT" && stxMid >= order.trigger_price);
        if (!shouldTrigger) continue;

        const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId: order.doc_id });
        if (!secrets?.stx) continue;

        const cmdId = generateCmdId(order.doc_id, `${order.type}:${order.order_id}`);
        const amountMicroStx = Math.round(order.qty * 1_000_000);
        const rawCommand = `DW STX_SEND ${secrets.stx.stxAddress} ${amountMicroStx}`;

        repo.upsertCommand({
          cmd_id: cmdId,
          doc_id: order.doc_id,
          raw_command: rawCommand,
          parsed_json: JSON.stringify({ type: "STX_SEND", to: secrets.stx.stxAddress, amountMicroStx: String(amountMicroStx) }),
          status: "APPROVED",
          yellow_intent_id: null,
          sui_tx_digest: null,
          arc_tx_hash: null,
          result_text: null,
          error_text: null
        });
        repo.triggerConditionalOrder(order.order_id, cmdId);

        try {
          await appendCommandRow({
            docs: this.ctx.docs,
            docId: order.doc_id,
            id: cmdId,
            command: `[${order.type}:${order.order_id.slice(0, 12)}] ${rawCommand}`,
            status: "APPROVED",
            result: "",
            error: ""
          });
        } catch { /* ignore */ }
      }
    } catch (err) {
      console.error("priceTick error:", err);
    } finally {
      this.priceTickRunning = false;
    }
  }

  async agentDecisionTick() {
    if (this.agentDecisionRunning) return;
    this.agentDecisionRunning = true;
    try {
      // Stacks mode: no-op for now
    } finally {
      this.agentDecisionRunning = false;
    }
  }

  async payoutRulesTick() {
    if (this.payoutRulesRunning) return;
    this.payoutRulesRunning = true;
    try {
      // Stacks mode: payout rules disabled
    } finally {
      this.payoutRulesRunning = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Command Execution
  // ══════════════════════════════════════════════════════════════════════════════

  private async execute(docId: string, _cmdId: string, command: ParsedCommand): Promise<{
    resultText: string;
    txId?: string;
  }> {
    const { repo, config, stacks, sbtc, usdcx, x402 } = this.ctx;

    // ── Core Commands ──

    if (command.type === "SETUP") {
      const existing = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      const secrets = existing ?? createAndStoreDocSecrets({
        repo,
        masterKey: config.DOCWALLET_MASTER_KEY,
        docId,
        stxNetwork: config.STX_NETWORK
      });
      repo.setDocAddresses(docId, { evmAddress: secrets.evm.address, secondaryAddress: secrets.stx?.stxAddress ?? "" });

      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigBatch({
        docs: this.ctx.docs,
        docId,
        configTable: tables.config.table,
        entries: [
          { key: "EVM_ADDRESS", value: secrets.evm.address },
          { key: "STX_ADDRESS", value: secrets.stx?.stxAddress ?? "" },
          { key: "STX_NETWORK", value: config.STX_NETWORK },
          { key: "STATUS", value: "READY" },
        ]
      });
      return { resultText: `EVM=${secrets.evm.address} STX=${secrets.stx?.stxAddress ?? "(none)"}` };
    }

    if (command.type === "STATUS") {
      const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      if (!secrets) return { resultText: "STATUS=NO_WALLET (run DW SETUP)" };
      return {
        resultText: `MODE=STACKS EVM=${secrets.evm.address} STX=${secrets.stx?.stxAddress ?? "(none)"} NETWORK=${config.STX_NETWORK}`
      };
    }

    if (command.type === "STX_PRICE") {
      if (!stacks) throw new Error("Stacks integration disabled");
      const price = await stacks.getStxPrice();
      if (price && price > 0) {
        repo.upsertPrice("STX/USD", price, price * 0.999, price * 1.001, "coingecko");
        return { resultText: `STX/USD PRICE=$${price.toFixed(4)} (via CoinGecko)` };
      }
      const cached = repo.getPrice("STX/USD");
      if (cached?.mid_price) return { resultText: `STX/USD PRICE=$${cached.mid_price.toFixed(4)} (cached)` };
      return { resultText: "STX/USD PRICE=UNAVAILABLE" };
    }

    if (command.type === "STX_STOP_LOSS") {
      const orderId = `stx_sl_${Date.now()}_${sha256Hex(`${docId}:${command.qty}:${command.triggerPrice}`).slice(0, 8)}`;
      repo.insertConditionalOrder({
        orderId,
        docId,
        type: "STOP_LOSS",
        base: "STX",
        quote: "USD",
        triggerPrice: command.triggerPrice,
        qty: command.qty
      });
      return { resultText: `STX_STOP_LOSS=${orderId} SELL ${command.qty} STX WHEN ≤ $${command.triggerPrice}` };
    }

    if (command.type === "STX_TAKE_PROFIT") {
      const orderId = `stx_tp_${Date.now()}_${sha256Hex(`${docId}:${command.qty}:${command.triggerPrice}`).slice(0, 8)}`;
      repo.insertConditionalOrder({
        orderId,
        docId,
        type: "TAKE_PROFIT",
        base: "STX",
        quote: "USD",
        triggerPrice: command.triggerPrice,
        qty: command.qty
      });
      return { resultText: `STX_TAKE_PROFIT=${orderId} SELL ${command.qty} STX WHEN ≥ $${command.triggerPrice}` };
    }

    if (command.type === "CANCEL_ORDER") {
      repo.cancelConditionalOrder(command.orderId);
      return { resultText: `CANCELLED conditional order ${command.orderId}` };
    }

    if (command.type === "ALERT_THRESHOLD") {
      repo.setDocConfig(docId, `alert_threshold_${command.coinType.toLowerCase()}`, String(command.below));
      return { resultText: `ALERT_THRESHOLD ${command.coinType} < ${command.below}` };
    }

    if (command.type === "AUTO_REBALANCE") {
      repo.setDocConfig(docId, "auto_rebalance", command.enabled ? "1" : "0");
      return { resultText: `AUTO_REBALANCE=${command.enabled ? "ON" : "OFF"}` };
    }

    if (command.type === "TREASURY") {
      const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      if (!secrets?.stx || !stacks) return { resultText: "TREASURY: Stacks wallet not initialized" };

      const bal = await stacks.getBalance(secrets.stx.stxAddress);
      const stxPrice = repo.getPrice("STX/USD")?.mid_price ?? 0;
      const stxUsd = stxPrice > 0 ? Number(bal.stx) / 1_000_000 * stxPrice : 0;
      const lines: string[] = [`STX=${bal.stxFormatted}`, stxPrice > 0 ? `STX/USD=$${stxPrice.toFixed(4)}` : "STX/USD=unknown", `USD=$${stxUsd.toFixed(2)}`];

      if (sbtc) {
        try {
          const sbtcBal = await sbtc.getBalance(secrets.stx.stxAddress);
          if (sbtcBal.balanceSats > 0n) lines.push(`sBTC=${sbtcBal.balanceBtc}`);
        } catch { /* ignore */ }
      }

      if (usdcx) {
        try {
          const usdcxBal = await usdcx.getBalance(secrets.stx.stxAddress);
          if (usdcxBal.balanceRaw > 0n) lines.push(`USDCx=$${usdcxBal.balanceFormatted}`);
        } catch { /* ignore */ }
      }

      return { resultText: `TREASURY | ${lines.join(" | ")}` };
    }

    // ── Secrets required from here ──

    const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
    if (!secrets) return { resultText: `No wallet found. Type "DW SETUP" first.` };

    // ── STX Commands ──

    if (command.type === "STX_SEND") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const out = await stacks.sendStx({
        privateKeyHex: secrets.stx.privateKeyHex,
        to: command.to,
        amountMicroStx: command.amountMicroStx,
      });
      const stxAmount = (Number(command.amountMicroStx) / 1_000_000).toFixed(6);
      return { resultText: `STX_SEND txid=${out.txid} (${stxAmount} STX → ${command.to})`, txId: out.txid };
    }

    if (command.type === "STX_BALANCE") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const bal = await stacks.getBalance(secrets.stx.stxAddress);
      const lockedStx = (Number(bal.locked) / 1_000_000).toFixed(6);
      return { resultText: `STX Balance: ${bal.stxFormatted} STX (locked: ${lockedStx} STX) | Address: ${secrets.stx.stxAddress}` };
    }

    if (command.type === "STX_HISTORY") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const txs = await stacks.getTransactionHistory(secrets.stx.stxAddress, command.limit);
      if (txs.length === 0) return { resultText: "STX_HISTORY: No transactions found" };
      const lines = txs.map((tx) => {
        const stxAmount = tx.amount !== "0" ? ` ${(Number(tx.amount) / 1_000_000).toFixed(6)} STX` : "";
        return `  ${tx.txid.slice(0, 16)}… ${tx.type} ${tx.status}${stxAmount}`;
      });
      return { resultText: `Recent Transactions (${txs.length}):\n${lines.join("\n")}` };
    }

    // ── sBTC Commands ──

    if (command.type === "SBTC_BALANCE") {
      if (!sbtc) throw new Error("sBTC integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const bal = await sbtc.getBalance(secrets.stx.stxAddress);
      return { resultText: `sBTC Balance: ${bal.balanceBtc} BTC (${bal.balanceSats.toString()} sats) | Address: ${secrets.stx.stxAddress}` };
    }

    if (command.type === "SBTC_SEND") {
      if (!sbtc) throw new Error("sBTC integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const out = await sbtc.transfer({
        privateKeyHex: secrets.stx.privateKeyHex,
        to: command.to,
        amountSats: command.amountSats,
      });
      const btcAmount = (Number(command.amountSats) / 1e8).toFixed(8);
      return { resultText: `SBTC_SEND txid=${out.txid} (${btcAmount} sBTC → ${command.to})`, txId: out.txid };
    }

    if (command.type === "SBTC_INFO") {
      if (!sbtc) throw new Error("sBTC integration disabled");
      const info = sbtc.getContractInfo();
      const supply = await sbtc.getTotalSupply();
      const supplyBtc = (Number(supply) / 1e8).toFixed(8);
      return { resultText: `sBTC Info | Contract: ${info.address}.${info.name} | Network: ${info.network} | Total Supply: ${supplyBtc} BTC` };
    }

    // ── USDCx Commands ──

    if (command.type === "USDCX_BALANCE") {
      if (!usdcx) throw new Error("USDCx integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const bal = await usdcx.getBalance(secrets.stx.stxAddress);
      return { resultText: `USDCx Balance: $${bal.balanceFormatted} (${bal.balanceRaw.toString()} raw) | Address: ${secrets.stx.stxAddress}` };
    }

    if (command.type === "USDCX_SEND") {
      if (!usdcx) throw new Error("USDCx integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const out = await usdcx.transfer({
        privateKeyHex: secrets.stx.privateKeyHex,
        to: command.to,
        amount: command.amount,
      });
      const usdcAmount = (Number(command.amount) / 1_000_000).toFixed(2);
      return { resultText: `USDCX_SEND txid=${out.txid} ($${usdcAmount} USDCx → ${command.to})`, txId: out.txid };
    }

    if (command.type === "USDCX_APPROVE") {
      if (!usdcx) throw new Error("USDCx integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const out = await usdcx.approve({
        privateKeyHex: secrets.stx.privateKeyHex,
        spender: command.spender,
        amount: command.amount,
      });
      const usdcAmount = (Number(command.amount) / 1_000_000).toFixed(2);
      return { resultText: `USDCX_APPROVE txid=${out.txid} (approved $${usdcAmount} for ${command.spender})`, txId: out.txid };
    }

    if (command.type === "USDCX_PAYMENT") {
      if (!usdcx) throw new Error("USDCx integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const rawAmount = Math.round(command.amount * 1_000_000);
      const requestId = `pay_${Date.now()}_${sha256Hex(`${docId}:${command.amount}:${command.description}`).slice(0, 8)}`;
      const uri = usdcx.createPaymentUri({
        toAddress: secrets.stx.stxAddress,
        amount: command.amount,
        memo: command.description,
      });
      repo.insertStacksPaymentRequest({
        requestId,
        docId,
        address: secrets.stx.stxAddress,
        amountRaw: rawAmount,
        token: "USDCx",
        description: command.description,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      return { resultText: `USDCX_PAYMENT requestId=${requestId} amount=$${command.amount} USDCx\nAddress: ${secrets.stx.stxAddress}\nURI: ${uri}` };
    }

    // ── x402 Commands ──

    if (command.type === "X402_CALL") {
      if (!x402) throw new Error("x402 integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const receipt = await x402.callPaidResource({
        url: command.url,
        method: command.method,
        privateKeyHex: secrets.stx.privateKeyHex,
      });
      const responsePreview = typeof receipt.responseData === "string"
        ? receipt.responseData.slice(0, 200)
        : JSON.stringify(receipt.responseData).slice(0, 200);
      return {
        resultText: `X402_CALL txid=${receipt.txid} paid=${receipt.amount} ${receipt.token} challengeId=${receipt.challengeId}\nResponse: ${responsePreview}`,
        txId: receipt.txid || undefined
      };
    }

    if (command.type === "X402_STATUS") {
      if (!stacks) throw new Error("Stacks integration disabled");
      const status = await stacks.getTransactionStatus(command.txid);
      return { resultText: `X402_STATUS txid=${command.txid} status=${status.status}${status.block_height ? ` block=${status.block_height}` : ""}` };
    }

    // ── Clarity Contract Commands ──

    if (command.type === "CONTRACT_CALL") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      // Parse args as Clarity values (basic: numbers → uint, strings → string-ascii, addresses → principal)
      const clarityArgs = command.args.map(parseClarityArg);
      const out = await stacks.contractCall({
        privateKeyHex: secrets.stx.privateKeyHex,
        contractAddress: command.contractAddress,
        contractName: command.contractName,
        functionName: command.functionName,
        functionArgs: clarityArgs,
      });
      return { resultText: `CONTRACT_CALL txid=${out.txid} (${command.contractAddress}.${command.contractName}::${command.functionName})`, txId: out.txid };
    }

    if (command.type === "CONTRACT_READ") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const clarityArgs = command.args.map(parseClarityArg);
      const result = await stacks.contractRead({
        contractAddress: command.contractAddress,
        contractName: command.contractName,
        functionName: command.functionName,
        functionArgs: clarityArgs,
        senderAddress: secrets.stx.stxAddress,
      });
      const json = cvToJSON(result);
      return { resultText: `CONTRACT_READ ${command.contractAddress}.${command.contractName}::${command.functionName}\nResult: ${JSON.stringify(json, null, 2)}` };
    }

    // ── Stacking ──

    if (command.type === "STACK_STX") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      // Stacking is informational for now — would require pox contract interaction
      return { resultText: `STACK_STX: Would stack ${command.amountStx} STX for ${command.cycles} cycles. Full PoX stacking requires a BTC reward address and minimum threshold. Use the Stacks Explorer to initiate stacking.` };
    }

    if (command.type === "STACK_STATUS") {
      if (!stacks) throw new Error("Stacks integration disabled");
      if (!secrets.stx) throw new Error("No STX wallet. Run DW SETUP first.");
      const bal = await stacks.getBalance(secrets.stx.stxAddress);
      const lockedStx = (Number(bal.locked) / 1_000_000).toFixed(6);
      const isStacking = bal.locked > 0n;
      return { resultText: `STACK_STATUS: ${isStacking ? "ACTIVE" : "NOT STACKING"} | Locked: ${lockedStx} STX | Total: ${bal.stxFormatted} STX` };
    }

    // ── Scheduling ──

    if (command.type === "SCHEDULE" || command.type === "CANCEL_SCHEDULE") {
      if (command.type === "SCHEDULE") {
        const scheduleId = `sched_${Date.now()}_${sha256Hex(`${docId}:${command.innerCommand}:${Date.now()}`).slice(0, 8)}`;
        const nextRunAt = Date.now() + command.intervalHours * 3600_000;
        repo.insertSchedule({
          scheduleId,
          docId,
          intervalHours: command.intervalHours,
          innerCommand: command.innerCommand,
          nextRunAt
        });
        return { resultText: `SCHEDULE_CREATED=${scheduleId} EVERY ${command.intervalHours}h` };
      }
      const sched = repo.getSchedule(command.scheduleId);
      if (!sched || sched.doc_id !== docId) throw new Error("Schedule not found");
      repo.cancelSchedule(command.scheduleId);
      return { resultText: `SCHEDULE_CANCELLED=${command.scheduleId}` };
    }

    throw new Error(`Unsupported command: ${(command as any).type}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════════

  private async updateDocRow(
    docId: string,
    cmdId: string,
    updates: { status?: string; result?: string; error?: string }
  ) {
    const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
    const rows = readCommandsTable(tables.commands.table);
    const row = rows.find((r) => r.id === cmdId);
    if (!row) return;
    await updateCommandsRowCells({
      docs: this.ctx.docs,
      docId,
      commandsTable: tables.commands.table,
      rowIndex: row.rowIndex,
      updates: { status: updates.status, result: updates.result, error: updates.error }
    });
  }

  private async updateRowByIndex(
    docId: string,
    rowIndex: number,
    updates: { id?: string; status?: string; approvalUrl?: string; result?: string; error?: string }
  ) {
    const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
    await updateCommandsRowCells({
      docs: this.ctx.docs,
      docId,
      commandsTable: tables.commands.table,
      rowIndex,
      updates
    });
  }

  private async audit(docId: string, message: string) {
    await appendAuditRow({
      docs: this.ctx.docs,
      docId,
      timestampIso: new Date().toISOString(),
      message
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Utility functions
// ══════════════════════════════════════════════════════════════════════════════

function generateCmdId(docId: string, raw: string): string {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const h = sha256Hex(`${docId}|${raw}|${Date.now()}`).slice(0, 10);
  return `cmd_${now}_${h}`;
}

function parseClarityArg(arg: string) {
  // Number → uint
  if (/^\d+$/.test(arg)) return uintCV(BigInt(arg));
  // Stacks address → principal
  if (/^(SP|ST)[A-Z0-9]{38,}/i.test(arg)) return principalCV(arg);
  // Default → string-ascii
  return stringAsciiCV(arg);
}

function reconstructDwCommand(cmd: ParsedCommand): string | null {
  switch (cmd.type) {
    case "SETUP": return "DW SETUP";
    case "STATUS": return "DW STATUS";
    case "TREASURY": return "DW TREASURY";
    case "SCHEDULE": return `DW SCHEDULE EVERY ${cmd.intervalHours}h: ${cmd.innerCommand}`;
    case "CANCEL_SCHEDULE": return `DW CANCEL_SCHEDULE ${cmd.scheduleId}`;
    case "ALERT_THRESHOLD": return `DW ALERT_THRESHOLD ${cmd.coinType} ${cmd.below}`;
    case "AUTO_REBALANCE": return `DW AUTO_REBALANCE ${cmd.enabled ? "ON" : "OFF"}`;
    case "CANCEL_ORDER": return `DW CANCEL_ORDER ${cmd.orderId}`;
    // STX
    case "STX_PRICE": return "DW STX_PRICE";
    case "STX_BALANCE": return "DW STX_BALANCE";
    case "STX_SEND": return `DW STX_SEND ${cmd.to} ${cmd.amountMicroStx.toString()}`;
    case "STX_HISTORY": return `DW STX_HISTORY ${cmd.limit}`;
    case "STX_STOP_LOSS": return `DW STX_STOP_LOSS ${cmd.qty} @ ${cmd.triggerPrice}`;
    case "STX_TAKE_PROFIT": return `DW STX_TAKE_PROFIT ${cmd.qty} @ ${cmd.triggerPrice}`;
    // sBTC
    case "SBTC_BALANCE": return "DW SBTC_BALANCE";
    case "SBTC_SEND": return `DW SBTC_SEND ${cmd.to} ${cmd.amountSats.toString()}`;
    case "SBTC_INFO": return "DW SBTC_INFO";
    // USDCx
    case "USDCX_BALANCE": return "DW USDCX_BALANCE";
    case "USDCX_SEND": return `DW USDCX_SEND ${cmd.to} ${cmd.amount.toString()}`;
    case "USDCX_APPROVE": return `DW USDCX_APPROVE ${cmd.spender} ${cmd.amount.toString()}`;
    case "USDCX_PAYMENT": return `DW USDCX_PAYMENT ${cmd.amount} ${cmd.description}`;
    // x402
    case "X402_CALL": return `DW X402_CALL ${cmd.url} ${cmd.method}`;
    case "X402_STATUS": return `DW X402_STATUS ${cmd.txid}`;
    // Contracts
    case "CONTRACT_CALL": return `DW CONTRACT_CALL ${cmd.contractAddress}.${cmd.contractName} ${cmd.functionName}${cmd.args.length ? " " + cmd.args.join(" ") : ""}`;
    case "CONTRACT_READ": return `DW CONTRACT_READ ${cmd.contractAddress}.${cmd.contractName} ${cmd.functionName}${cmd.args.length ? " " + cmd.args.join(" ") : ""}`;
    // Stacking
    case "STACK_STX": return `DW STACK_STX ${cmd.amountStx} ${cmd.cycles}`;
    case "STACK_STATUS": return "DW STACK_STATUS";
    default: return null;
  }
}
