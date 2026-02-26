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
import type { BchClient } from "./integrations/bch.js";
import type { HederaClient } from "./integrations/hedera.js";
import type { BchNftClient } from "./integrations/bch-nft.js";
import type { BchMultisigClient } from "./integrations/bch-multisig.js";
import type { CashScriptClient } from "./integrations/cashscript.js";
import type { BchPaymentsClient } from "./integrations/bch-payments.js";

type ExecutionContext = {
  config: AppConfig;
  docs: docs_v1.Docs;
  drive: drive_v3.Drive;
  repo: Repo;
  hedera?: HederaClient;
  bch?: BchClient;
  bchNft?: BchNftClient;
  bchMultisig?: BchMultisigClient;
  cashScript?: CashScriptClient;
  bchPayments?: BchPaymentsClient;
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

  /** Track consecutive poll failures per doc for auto-cleanup */
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

      // Prune stale DB entries — docs Drive no longer returns
      const driveIds = new Set(files.map((f) => f.id));
      const tracked = repo.listDocs();
      let pruned = 0;
      for (const d of tracked) {
        if (!driveIds.has(d.doc_id)) {
          console.log(`[discovery] removing stale doc ${d.doc_id.slice(0, 8)}… ("${d.name}") — no longer accessible via Drive`);
          try { repo.removeDoc(d.doc_id); } catch { /* ignore */ }
          pruned++;
        }
      }
      if (pruned > 0) console.log(`[discovery] pruned ${pruned} stale doc(s) from DB`);

      // Ensure template on each accessible doc
      for (const f of files) {
        try {
          repo.upsertDoc({ docId: f.id, name: f.name });
          await loadDocWalletTables({ docs, docId: f.id });
          console.log(`[discovery] ✅ ${f.id.slice(0, 8)}… "${f.name}" — template OK`);
          this.pollFailures.delete(f.id); // reset failures on success
        } catch (err) {
          console.error(`[discovery] ❌ ${f.id.slice(0, 8)}… "${f.name}" — ${(err as Error).message}`);
          try { repo.removeDoc(f.id); } catch { /* ignore */ }
        }
      }

      if (files.length === 0) {
        console.warn(
          `[discovery] no docs found! Make sure your Google Docs are shared with the service account as Editor.\n` +
          `  Prefix filter: ${namePrefix ? `"${namePrefix}" (set DOCWALLET_DISCOVER_ALL=1 to disable)` : "none (discovering all docs)"}\n` +
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
          this.pollFailures.delete(docId); // reset on success
        } catch (err) {
          const fails = (this.pollFailures.get(docId) ?? 0) + 1;
          this.pollFailures.set(docId, fails);
          if (fails <= 2) {
            console.error(`[poll] ${docId.slice(0, 8)}… ${(err as Error).message}`);
          } else if (fails === 3) {
            console.error(`[poll] ${docId.slice(0, 8)}… failed ${fails}x — suppressing future logs (will retry on next discovery)`);
          }
          // After 10 consecutive failures, auto-remove from DB
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
              "SETUP", "STATUS", "BCH_PRICE", "BCH_TOKEN_BALANCE", "TREASURY", "PRICE", "TRADE_HISTORY",
              "NFT_BALANCE", "BCH_MULTISIG_BALANCE", "CASH_VAULT_STATUS", "PAYMENT_CHECK", "PAYMENT_QR"
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
              parsed_json: JSON.stringify(parsed.value),
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
              parsed_json: JSON.stringify(parsed.value),
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
          try {
            repo.setCommandStatus(cmd.cmd_id, "EXECUTING");
            await this.updateDocRow(cmd.doc_id, cmd.cmd_id, { status: "EXECUTING", error: "" });

            const result = await this.execute(cmd.doc_id, cmd.cmd_id, parsed);
            repo.setCommandExecutionIds(cmd.cmd_id, {
              txId: result.txId
            });
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
              agent: "Use BCH commands like: DW BCH_PRICE, DW BCH_SEND <cashaddr> <sats>, DW BCH_TOKEN_BALANCE"
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
              agent: "That command is not supported in BCH-only mode."
            });
            continue;
          }

          if (executeNow) {
            const cmdId = generateCmdId(docId, dw);
            repo.upsertCommand({
              cmd_id: cmdId,
              doc_id: docId,
              raw_command: dw,
              parsed_json: JSON.stringify(detected.value),
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
      const { docs, repo, config, bch } = this.ctx;
      const tracked = repo.listDocs();
      for (const d of tracked) {
        const docId = d.doc_id;
        const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
        if (!secrets) continue;

        const entries: Array<{ location: string; asset: string; balance: string }> = [];
        if (bch && secrets.bch) {
          try {
            const bal = await bch.getBalance(secrets.bch.cashAddress);
            const bchPrice = repo.getPrice("BCH/USD")?.mid_price ?? 0;
            const usd = bchPrice > 0 ? ` ($${(Number(bal.bchFormatted) * bchPrice).toFixed(2)})` : "";
            entries.push({ location: "Bitcoin Cash", asset: "BCH", balance: `${bal.bchFormatted}${usd}` });

            if (config.BCH_CASHTOKENS_ENABLED) {
              const tokenUtxos = await bch.getTokenUtxos(secrets.bch.cashAddress);
              const grouped = new Map<string, bigint>();
              for (const u of tokenUtxos) {
                grouped.set(u.tokenCategory, (grouped.get(u.tokenCategory) ?? 0n) + u.tokenAmount);
              }
              for (const [category, amount] of grouped) {
                const dbToken = repo.getBchTokens(docId).find((t) => t.token_category === category);
                const label = dbToken ? dbToken.ticker : `${category.slice(0, 12)}…`;
                entries.push({ location: "Bitcoin Cash", asset: `${label} (CashToken)`, balance: amount.toString() });
              }
            }
          } catch {
            entries.push({ location: "Bitcoin Cash", asset: "BCH", balance: "Unavailable" });
          }
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
          parsed_json: JSON.stringify(parsed.value),
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
      const { repo, bch, config } = this.ctx;
      if (!bch) return;

      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd", {
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          const data = await res.json() as Record<string, Record<string, number>>;
          const price = data?.["bitcoin-cash"]?.usd;
          if (price && price > 0) repo.upsertPrice("BCH/USD", price, price * 0.999, price * 1.001, "coingecko");
        }
      } catch {
        // ignore
      }

      const bchMid = repo.getPrice("BCH/USD")?.mid_price ?? 0;
      if (bchMid <= 0) return;

      const activeOrders = repo.listActiveConditionalOrders().filter((o) => o.base.toUpperCase() === "BCH");
      for (const order of activeOrders) {
        const shouldTrigger =
          (order.type === "STOP_LOSS" && bchMid <= order.trigger_price) ||
          (order.type === "TAKE_PROFIT" && bchMid >= order.trigger_price);
        if (!shouldTrigger) continue;

        const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId: order.doc_id });
        if (!secrets?.bch) continue;

        const cmdId = generateCmdId(order.doc_id, `${order.type}:${order.order_id}`);
        const amountSats = Math.round(order.qty * 1e8);
        const rawCommand = `DW BCH_SEND ${secrets.bch.cashAddress} ${amountSats}`;

        repo.upsertCommand({
          cmd_id: cmdId,
          doc_id: order.doc_id,
          raw_command: rawCommand,
          parsed_json: JSON.stringify({ type: "BCH_SEND", to: secrets.bch.cashAddress, amountSats }),
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
        } catch {
          // ignore
        }
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
      // BCH-only mode: keep this as a no-op tick.
    } finally {
      this.agentDecisionRunning = false;
    }
  }

  async payoutRulesTick() {
    if (this.payoutRulesRunning) return;
    this.payoutRulesRunning = true;
    try {
      // BCH-only mode: payout rules are intentionally disabled here.
    } finally {
      this.payoutRulesRunning = false;
    }
  }

  private async execute(docId: string, _cmdId: string, command: ParsedCommand): Promise<{
    resultText: string;
    txId?: string;
  }> {
    const { repo, config, bch, bchNft, bchMultisig, cashScript, bchPayments } = this.ctx;

    if (command.type === "SETUP") {
      const existing = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      const secrets = existing ?? createAndStoreDocSecrets({
        repo,
        masterKey: config.DOCWALLET_MASTER_KEY,
        docId,
        bchNetwork: config.BCH_NETWORK
      });
      repo.setDocAddresses(docId, { evmAddress: secrets.evm.address, secondaryAddress: "" });

      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigBatch({
        docs: this.ctx.docs,
        docId,
        configTable: tables.config.table,
        entries: [
          { key: "EVM_ADDRESS", value: secrets.evm.address },
          { key: "STATUS", value: "READY" },
          { key: "BCH_ADDRESS", value: secrets.bch?.cashAddress ?? "" },
          { key: "BCH_NETWORK", value: config.BCH_NETWORK }
        ]
      });
      return { resultText: `EVM=${secrets.evm.address}${secrets.bch ? ` BCH=${secrets.bch.cashAddress}` : ""}` };
    }

    if (command.type === "STATUS") {
      const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      if (!secrets) return { resultText: "STATUS=NO_WALLET (run DW SETUP)" };
      return {
        resultText: `MODE=BCH_ONLY EVM=${secrets.evm.address}${secrets.bch ? ` BCH=${secrets.bch.cashAddress}` : ""}`
      };
    }

    if (command.type === "BCH_PRICE") {
      try {
        const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd", {
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) {
          const data = await res.json() as Record<string, Record<string, number>>;
          const price = data?.["bitcoin-cash"]?.usd;
          if (price && price > 0) {
            repo.upsertPrice("BCH/USD", price, price * 0.999, price * 1.001, "coingecko");
            return { resultText: `BCH/USD PRICE=$${price.toFixed(2)} (via CoinGecko)` };
          }
        }
      } catch {
        // ignore
      }
      const cached = repo.getPrice("BCH/USD");
      if (cached?.mid_price) return { resultText: `BCH/USD PRICE=$${cached.mid_price.toFixed(2)} (cached)` };
      return { resultText: "BCH/USD PRICE=UNAVAILABLE" };
    }

    if (command.type === "BCH_STOP_LOSS") {
      const orderId = `bch_sl_${Date.now()}_${sha256Hex(`${docId}:${command.qty}:${command.triggerPrice}`).slice(0, 8)}`;
      repo.insertConditionalOrder({
        orderId,
        docId,
        type: "STOP_LOSS",
        base: "BCH",
        quote: "USD",
        triggerPrice: command.triggerPrice,
        qty: command.qty
      });
      return { resultText: `BCH_STOP_LOSS=${orderId} SELL ${command.qty} BCH WHEN ≤ $${command.triggerPrice}` };
    }

    if (command.type === "BCH_TAKE_PROFIT") {
      const orderId = `bch_tp_${Date.now()}_${sha256Hex(`${docId}:${command.qty}:${command.triggerPrice}`).slice(0, 8)}`;
      repo.insertConditionalOrder({
        orderId,
        docId,
        type: "TAKE_PROFIT",
        base: "BCH",
        quote: "USD",
        triggerPrice: command.triggerPrice,
        qty: command.qty
      });
      return { resultText: `BCH_TAKE_PROFIT=${orderId} SELL ${command.qty} BCH WHEN ≥ $${command.triggerPrice}` };
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
      if (!secrets?.bch || !bch) return { resultText: "TREASURY: BCH wallet not initialized" };

      const b = await bch.getBalance(secrets.bch.cashAddress);
      const p = repo.getPrice("BCH/USD")?.mid_price ?? 0;
      const usd = p > 0 ? Number(b.bchFormatted) * p : 0;
      const lines = [`BCH=${b.bchFormatted}`, p > 0 ? `BCH/USD=$${p.toFixed(2)}` : "BCH/USD=unknown", `USD=$${usd.toFixed(2)}`];
      if (config.BCH_CASHTOKENS_ENABLED) {
        const tokenUtxos = await bch.getTokenUtxos(secrets.bch.cashAddress);
        const grouped = new Map<string, bigint>();
        for (const u of tokenUtxos) grouped.set(u.tokenCategory, (grouped.get(u.tokenCategory) ?? 0n) + u.tokenAmount);
        for (const [cat, amount] of grouped) {
          const token = repo.getBchTokens(docId).find((t) => t.token_category === cat);
          lines.push(`${token?.ticker ?? cat.slice(0, 10)}=${amount.toString()}`);
        }
      }
      return { resultText: `TREASURY | ${lines.join(" | ")}` };
    }

    const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
    if (!secrets) return { resultText: `No wallet found. Type "DW SETUP" first.` };

    if (command.type === "BCH_SEND") {
      if (!bch) throw new Error("BCH integration disabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const out = await bch.sendBch({
        privateKeyHex: secrets.bch.privateKeyHex,
        fromAddress: secrets.bch.cashAddress,
        to: command.to,
        amountSats: command.amountSats
      });
      return { resultText: `BCH_Tx=${out.txid} (${command.amountSats} sats → ${command.to})`, txId: out.txid as any };
    }

    if (command.type === "BCH_TOKEN_ISSUE") {
      if (!bch) throw new Error("BCH integration disabled");
      if (!config.BCH_CASHTOKENS_ENABLED) throw new Error("CashTokens disabled (set BCH_CASHTOKENS_ENABLED=1)");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const out = await bch.issueToken({
        privateKeyHex: secrets.bch.privateKeyHex,
        fromAddress: secrets.bch.cashAddress,
        supply: BigInt(command.supply),
        recipientAddress: secrets.bch.cashAddress
      });
      repo.insertBchToken({
        docId,
        tokenCategory: out.tokenCategory,
        ticker: command.ticker,
        name: command.name,
        supply: command.supply,
        genesisTxid: out.txid
      });
      return {
        resultText: `TOKEN_ISSUED=${command.ticker} SUPPLY=${command.supply} CATEGORY=${out.tokenCategory.slice(0, 16)}… TX=${out.txid}`,
        txId: out.txid as any
      };
    }

    if (command.type === "BCH_TOKEN_SEND") {
      if (!bch) throw new Error("BCH integration disabled");
      if (!config.BCH_CASHTOKENS_ENABLED) throw new Error("CashTokens disabled (set BCH_CASHTOKENS_ENABLED=1)");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");

      let tokenCategory = command.tokenCategory;
      if (tokenCategory.length < 64 && !/^[0-9a-f]{64}$/i.test(tokenCategory)) {
        const token = repo.getBchTokens(docId).find((t) => t.ticker.toUpperCase() === tokenCategory.toUpperCase());
        if (!token) throw new Error(`Unknown token ticker: ${tokenCategory}`);
        tokenCategory = token.token_category;
      }

      const out = await bch.sendToken({
        privateKeyHex: secrets.bch.privateKeyHex,
        fromAddress: secrets.bch.cashAddress,
        to: command.to,
        tokenCategory,
        tokenAmount: BigInt(command.tokenAmount)
      });
      return {
        resultText: `TOKEN_SENT=${command.tokenAmount} ${tokenCategory.slice(0, 12)}… → ${command.to} TX=${out.txid}`,
        txId: out.txid as any
      };
    }

    if (command.type === "BCH_TOKEN_BALANCE") {
      if (!bch) throw new Error("BCH integration disabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const lines: string[] = [];

      const bchBal = await bch.getBalance(secrets.bch.cashAddress);
      lines.push(`BCH: ${bchBal.bchFormatted} (${bchBal.confirmed} sats)`);

      const tokenUtxos = await bch.getTokenUtxos(secrets.bch.cashAddress);
      if (tokenUtxos.length === 0) {
        lines.push("TOKENS: none");
      } else {
        const grouped = new Map<string, bigint>();
        for (const u of tokenUtxos) grouped.set(u.tokenCategory, (grouped.get(u.tokenCategory) ?? 0n) + u.tokenAmount);
        for (const [cat, amt] of grouped) {
          const token = repo.getBchTokens(docId).find((t) => t.token_category === cat);
          lines.push(`TOKEN ${token?.ticker ?? cat.slice(0, 16)}: ${amt.toString()}`);
        }
      }
      return { resultText: lines.join(" | ") };
    }

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

    // ── NFT Commands ────────────────────────────────────────────────────────────

    if (command.type === "NFT_MINT") {
      if (!bchNft) throw new Error("BCH NFT integration disabled (BCH_NFT_ENABLED=0)");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const { txid, tokenCategory } = await bchNft.mintNft({
        privateKeyHex: secrets.bch.privateKeyHex,
        fromAddress: secrets.bch.cashAddress,
        toAddress: command.to || secrets.bch.cashAddress,
        tokenTicker: command.ticker,
        tokenName: command.name,
        tokenUri: command.uri,
        amount: command.amount,
      });
      repo.insertBchToken({ docId, tokenCategory, ticker: command.ticker, name: command.name, supply: String(command.amount), genesisTxid: txid });
      return { resultText: `NFT_MINT name="${command.name}" ticker=${command.ticker} category=${tokenCategory.slice(0, 16)}… txid=${txid}`, txId: txid };
    }

    if (command.type === "NFT_SEND") {
      if (!bchNft) throw new Error("BCH NFT integration disabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const { txid } = await bchNft.sendNft({
        privateKeyHex: secrets.bch.privateKeyHex,
        fromAddress: secrets.bch.cashAddress,
        toAddress: command.to,
        tokenCategory: command.tokenCategory,
        tokenId: command.tokenId,
        amount: command.amount,
      });
      return { resultText: `NFT_SEND ${command.amount} of ${command.tokenCategory.slice(0, 16)}… → ${command.to} txid=${txid}`, txId: txid };
    }

    if (command.type === "NFT_BALANCE") {
      if (!bchNft) throw new Error("BCH NFT integration disabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const collections = await bchNft.getNftBalance(secrets.bch.cashAddress);
      const dbTokens = repo.getBchTokens(docId);
      if (collections.length === 0) return { resultText: "NFT_BALANCE: No NFTs in wallet" };
      const lines = collections.map(c => {
        const category = c.nfts[0]?.tokenCategory ?? "";
        const db = dbTokens.find(t => t.token_category === category);
        const label = db ? `${db.name} (${db.ticker})` : category.slice(0, 16) + "…";
        return `  ${label}: ${c.totalMinted} units`;
      });
      return { resultText: "NFT Holdings:\n" + lines.join("\n") };
    }

    if (command.type === "NFT_MARKET_LIST") {
      if (!bchNft) throw new Error("BCH NFT integration disabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const priceSats = Math.round(command.priceBch * 1e8);
      const listing = bchNft.createListing({ tokenCategory: command.tokenId, tokenId: command.tokenId, sellerAddress: secrets.bch.cashAddress, priceSats });
      const dbToken = repo.getBchToken(docId, command.tokenId);
      repo.insertBchNftListing({ listingId: listing.listingId, docId, tokenCategory: command.tokenId, tokenName: dbToken?.name ?? command.tokenId.slice(0, 12), priceSats, sellerAddress: secrets.bch.cashAddress });
      return { resultText: `NFT_MARKET_LIST listingId=${listing.listingId} token=${command.tokenId.slice(0, 16)}… price=${command.priceBch} BCH` };
    }

    if (command.type === "NFT_MARKET_BUY") {
      if (!bch) throw new Error("BCH integration disabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const listing = repo.getBchNftListing(command.listingId);
      if (!listing) throw new Error(`Listing not found: ${command.listingId}`);
      if (listing.status !== "active") throw new Error(`Listing is ${listing.status}, cannot buy`);
      const payResult = await bch.sendBch({ privateKeyHex: secrets.bch.privateKeyHex, fromAddress: secrets.bch.cashAddress, to: listing.seller_address, amountSats: listing.price_sats });
      repo.updateBchNftListingSold(command.listingId, docId, payResult.txid);
      return { resultText: `NFT_MARKET_BUY "${listing.token_name}" payTxid=${payResult.txid}`, txId: payResult.txid };
    }

    // ── Multisig Commands ───────────────────────────────────────────────────────

    if (command.type === "BCH_MULTISIG_CREATE") {
      if (!bchMultisig) throw new Error("BCH multisig not enabled (BCH_MULTISIG_ENABLED=0)");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const wallet = bchMultisig.createMultisigWallet({ threshold: command.threshold, pubkeys: command.pubkeys });
      const walletId = `ms_${Date.now()}_${wallet.scriptAddress.slice(-8)}`;
      repo.insertBchMultisig({ walletId, docId, scriptAddress: wallet.scriptAddress, redeemScript: wallet.redeemScript, threshold: command.threshold, pubkeys: command.pubkeys });
      return { resultText: `BCH_MULTISIG_CREATE walletId=${walletId} address=${wallet.scriptAddress} threshold=${command.threshold}/${command.pubkeys.length}` };
    }

    if (command.type === "BCH_MULTISIG_BALANCE") {
      if (!bchMultisig) throw new Error("BCH multisig not enabled");
      const multisigs = repo.getBchMultisigByDoc(docId);
      if (multisigs.length === 0) return { resultText: "BCH_MULTISIG_BALANCE: No multisig wallets for this doc" };
      const lines = await Promise.all(multisigs.map(async ms => {
        const bal = await bchMultisig.getBalance(ms.script_address);
        const pubkeys = JSON.parse(ms.pubkeys_json) as string[];
        return `  ${ms.script_address.slice(0, 24)}… (${ms.threshold}-of-${pubkeys.length}): ${bal.confirmed} sats confirmed, ${bal.unconfirmed} unconfirmed`;
      }));
      return { resultText: "Multisig Wallets:\n" + lines.join("\n") };
    }

    if (command.type === "BCH_MULTISIG_SEND") {
      if (!bchMultisig) throw new Error("BCH multisig not enabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const multisigs = repo.getBchMultisigByDoc(docId);
      if (multisigs.length === 0) throw new Error("No multisig wallet found — create one with BCH_MULTISIG_CREATE first");
      const ms = multisigs[0]!;
      const { txid } = await bchMultisig.sendFromMultisig({ fromScriptAddress: ms.script_address, redeemScriptHex: ms.redeem_script, toAddress: command.to, amountSats: command.amountSats, privateKeysHex: [secrets.bch.privateKeyHex] });
      return { resultText: `BCH_MULTISIG_SEND ${command.amountSats} sats → ${command.to} txid=${txid}`, txId: txid };
    }

    // ── Vault Commands ──────────────────────────────────────────────────────────

    if (command.type === "CASH_VAULT_CREATE") {
      if (!cashScript) throw new Error("CashScript vaults not enabled (CASH_ENABLED=0)");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const beneficiary = command.beneficiary || secrets.bch.cashAddress;
      const { txid, contractAddress, redeemScript } = await cashScript.deployVault({ beneficiary, unlockTime: command.unlockTime, amountSats: command.amountSats, funderPrivateKey: secrets.bch.privateKeyHex, funderAddress: secrets.bch.cashAddress });
      const vaultId = `v_${contractAddress.slice(-12)}`;
      repo.insertBchVault({ vaultId, docId, contractAddress, beneficiary, unlockTime: command.unlockTime, amountSats: command.amountSats, redeemScript, fundTxid: txid });
      const unlockDate = new Date(command.unlockTime * 1000).toISOString();
      return { resultText: `CASH_VAULT_CREATE vaultId=${vaultId} address=${contractAddress} fundTxid=${txid} unlocks=${unlockDate}`, txId: txid };
    }

    if (command.type === "CASH_VAULT_CLAIM") {
      if (!cashScript) throw new Error("CashScript vaults not enabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const vaults = repo.getBchVaultsByDoc(docId).filter(v => v.contract_address === command.vaultAddress);
      if (vaults.length === 0) throw new Error(`Vault not found for address: ${command.vaultAddress}`);
      const vault = vaults[0]!;
      if (vault.status === "CLAIMED") throw new Error("Vault already claimed");
      const { txid } = await cashScript.claimVault({ contractAddress: vault.contract_address, redeemScriptHex: vault.redeem_script, beneficiaryPrivateKey: secrets.bch.privateKeyHex, recipientAddress: secrets.bch.cashAddress, unlockTime: vault.unlock_time });
      repo.updateBchVaultStatus(vault.vault_id, "CLAIMED", txid);
      return { resultText: `CASH_VAULT_CLAIM vaultId=${vault.vault_id} txid=${txid}`, txId: txid };
    }

    if (command.type === "CASH_VAULT_RECLAIM") {
      if (!cashScript) throw new Error("CashScript vaults not enabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const vaults = repo.getBchVaultsByDoc(docId).filter(v => v.contract_address === command.vaultAddress);
      if (vaults.length === 0) throw new Error(`Vault not found for address: ${command.vaultAddress}`);
      const vault = vaults[0]!;
      if (vault.status !== "LOCKED") throw new Error(`Vault is not LOCKED (status=${vault.status})`);
      const { txid } = await cashScript.reclaimVault({ contractAddress: vault.contract_address, redeemScriptHex: vault.redeem_script, creatorPrivateKey: secrets.bch.privateKeyHex, recipientAddress: secrets.bch.cashAddress, locktime: vault.unlock_time });
      repo.updateBchVaultStatus(vault.vault_id, "RECLAIMED", txid);
      return { resultText: `CASH_VAULT_RECLAIM vaultId=${vault.vault_id} txid=${txid}`, txId: txid };
    }

    if (command.type === "CASH_VAULT_STATUS") {
      if (!cashScript) throw new Error("CashScript vaults not enabled");
      const vaults = repo.getBchVaultsByDoc(docId).filter(v => v.contract_address === command.vaultAddress);
      if (vaults.length === 0) return { resultText: `CASH_VAULT_STATUS: Vault not found: ${command.vaultAddress}` };
      const vault = vaults[0]!;
      const onChain = await cashScript.getVaultInfo(vault.contract_address);
      const unlockDate = new Date(vault.unlock_time * 1000).toISOString();
      const now = Math.floor(Date.now() / 1000);
      const timeleft = vault.unlock_time > now ? `${vault.unlock_time - now}s remaining` : "UNLOCKED";
      const lines = [`Vault: ${vault.contract_address}`, `Status: ${vault.status}`, `Timelock: ${unlockDate} (${timeleft})`, `Deposited: ${vault.amount_sats} sats`, `On-chain balance: ${onChain?.balance ?? "unavailable"} sats`, `Fund txid: ${vault.fund_txid}`];
      if (vault.claim_txid) lines.push(`Claim txid: ${vault.claim_txid}`);
      return { resultText: lines.join("\n") };
    }

    // ── Payment Commands ────────────────────────────────────────────────────────

    if (command.type === "PAYMENT_REQUEST") {
      if (!bchPayments) throw new Error("BCH payments not enabled");
      if (!secrets.bch) throw new Error("No BCH wallet. Run DW SETUP first.");
      const amountSats = Math.round(command.amountBch * 1e8);
      const request = await bchPayments.createPaymentRequest({ amountSats, description: command.description, receiveAddress: secrets.bch.cashAddress });
      repo.insertBchPaymentRequest({ requestId: request.requestId, docId, address: request.address, amountSats, description: command.description, expiresAt: request.expiresAt });
      const uri = `bitcoincash:${request.address}?amount=${command.amountBch}&message=${encodeURIComponent(command.description)}`;
      return { resultText: `PAYMENT_REQUEST requestId=${request.requestId} amount=${command.amountBch} BCH address=${request.address}\nURI: ${uri}` };
    }

    if (command.type === "PAYMENT_CHECK") {
      if (!bchPayments) throw new Error("BCH payments not enabled");
      const dbReq = repo.getBchPaymentRequest(command.requestId);
      if (!dbReq) throw new Error(`Payment request not found: ${command.requestId}`);
      if (dbReq.status === "paid") return { resultText: `PAYMENT_CHECK requestId=${command.requestId} status=PAID txid=${dbReq.paid_txid}` };
      if (Date.now() > dbReq.expires_at) return { resultText: `PAYMENT_CHECK requestId=${command.requestId} status=EXPIRED` };
      const result = await bchPayments.checkPayment(command.requestId);
      if (result && result.status === "paid" && result.paidTxid) {
        repo.updateBchPaymentRequestPaid(command.requestId, result.paidTxid);
        return { resultText: `PAYMENT_CHECK requestId=${command.requestId} status=PAID txid=${result.paidTxid}` };
      }
      return { resultText: `PAYMENT_CHECK requestId=${command.requestId} status=PENDING` };
    }

    if (command.type === "PAYMENT_QR") {
      if (!bchPayments) throw new Error("BCH payments not enabled");
      const dbReq = repo.getBchPaymentRequest(command.requestId);
      if (!dbReq) throw new Error(`Payment request not found: ${command.requestId}`);
      const qrUri = bchPayments.generateQR(command.requestId);
      return { resultText: `PAYMENT_QR requestId=${command.requestId}\nURI: ${qrUri ?? `bitcoincash:${dbReq.address}?amount=${(dbReq.amount_sats / 1e8).toFixed(8)}`}` };
    }

    // ── Bridge Commands (informational only) ────────────────────────────────────

    if (command.type === "BRIDGE_TO_BCH") {
      return { resultText: `BRIDGE_TO_BCH: No production ${command.fromChain}→BCH bridge on Chipnet. Use the Chipnet faucet at https://tbch.googol.cash/` };
    }

    if (command.type === "BRIDGE_FROM_BCH") {
      return { resultText: `BRIDGE_FROM_BCH: No production BCH→${command.toChain} bridge on Chipnet. For mainnet bridging, explore SideShift.ai or AtomicDEX.` };
    }

    throw new Error("Unsupported command in BCH-only mode");
  }

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

function generateCmdId(docId: string, raw: string): string {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const h = sha256Hex(`${docId}|${raw}|${Date.now()}`).slice(0, 10);
  return `cmd_${now}_${h}`;
}

function reconstructDwCommand(cmd: ParsedCommand): string | null {
  switch (cmd.type) {
    case "SETUP":
      return "DW SETUP";
    case "STATUS":
      return "DW STATUS";
    case "SCHEDULE":
      return `DW SCHEDULE EVERY ${cmd.intervalHours}h: ${cmd.innerCommand}`;
    case "CANCEL_SCHEDULE":
      return `DW CANCEL_SCHEDULE ${cmd.scheduleId}`;
    case "ALERT_THRESHOLD":
      return `DW ALERT_THRESHOLD ${cmd.coinType} ${cmd.below}`;
    case "AUTO_REBALANCE":
      return `DW AUTO_REBALANCE ${cmd.enabled ? "ON" : "OFF"}`;
    case "CANCEL_ORDER":
      return `DW CANCEL_ORDER ${cmd.orderId}`;
    case "BCH_PRICE":
      return "DW BCH_PRICE";
    case "BCH_SEND":
      return `DW BCH_SEND ${cmd.to} ${cmd.amountSats}`;
    case "BCH_TOKEN_ISSUE":
      return `DW BCH_TOKEN_ISSUE ${cmd.ticker} ${cmd.name} ${cmd.supply}`;
    case "BCH_TOKEN_SEND":
      return `DW BCH_TOKEN_SEND ${cmd.to} ${cmd.tokenCategory} ${cmd.tokenAmount}`;
    case "BCH_TOKEN_BALANCE":
      return "DW BCH_TOKEN_BALANCE";
    case "BCH_STOP_LOSS":
      return `DW BCH_STOP_LOSS ${cmd.qty} @ ${cmd.triggerPrice}`;
    case "BCH_TAKE_PROFIT":
      return `DW BCH_TAKE_PROFIT ${cmd.qty} @ ${cmd.triggerPrice}`;
    case "TREASURY":
      return "DW TREASURY";
    case "NFT_MINT":
      return `DW NFT_MINT ${cmd.ticker} "${cmd.name}" ${cmd.amount}${cmd.to ? ` to ${cmd.to}` : ""}${cmd.uri ? ` uri=${cmd.uri}` : ""}`;
    case "NFT_SEND":
      return `DW NFT_SEND ${cmd.to} ${cmd.tokenCategory} ${cmd.amount}${cmd.tokenId ? ` tokenId=${cmd.tokenId}` : ""}`;
    case "NFT_BALANCE":
      return "DW NFT_BALANCE";
    case "NFT_MARKET_LIST":
      return `DW NFT_MARKET_LIST ${cmd.tokenId} ${cmd.priceBch} BCH`;
    case "NFT_MARKET_BUY":
      return `DW NFT_MARKET_BUY ${cmd.listingId}`;
    case "BCH_MULTISIG_CREATE":
      return `DW BCH_MULTISIG_CREATE ${cmd.threshold}-of-${cmd.pubkeys.length}`;
    case "BCH_MULTISIG_BALANCE":
      return "DW BCH_MULTISIG_BALANCE";
    case "BCH_MULTISIG_SEND":
      return `DW BCH_MULTISIG_SEND ${cmd.to} ${cmd.amountSats}`;
    case "CASH_VAULT_CREATE":
      return `DW CASH_VAULT_CREATE ${cmd.amountSats} sats unlockTime=${cmd.unlockTime}${cmd.beneficiary ? ` beneficiary=${cmd.beneficiary}` : ""}`;
    case "CASH_VAULT_CLAIM":
      return `DW CASH_VAULT_CLAIM ${cmd.vaultAddress}`;
    case "CASH_VAULT_RECLAIM":
      return `DW CASH_VAULT_RECLAIM ${cmd.vaultAddress}`;
    case "CASH_VAULT_STATUS":
      return `DW CASH_VAULT_STATUS ${cmd.vaultAddress}`;
    case "PAYMENT_REQUEST":
      return `DW PAYMENT_REQUEST ${cmd.amountBch} BCH "${cmd.description}"`;
    case "PAYMENT_CHECK":
      return `DW PAYMENT_CHECK ${cmd.requestId}`;
    case "PAYMENT_QR":
      return `DW PAYMENT_QR ${cmd.requestId}`;
    case "BRIDGE_TO_BCH":
      return `DW BRIDGE_TO_BCH ${cmd.fromChain} ${cmd.amount}`;
    case "BRIDGE_FROM_BCH":
      return `DW BRIDGE_FROM_BCH ${cmd.toChain} ${cmd.amountSats}`;
    default:
      return null;
  }
}
