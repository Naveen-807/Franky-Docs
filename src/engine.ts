import type { docs_v1, drive_v3 } from "googleapis";
import { parseCommand, tryAutoDetect } from "./core/commands.js";
import type { ParsedCommand } from "./core/commands.js";
import { evaluatePolicy } from "./core/policy.js";
import { sha256Hex } from "./util/hash.js";
import { privateKeyToAccount } from "viem/accounts";
import { Repo } from "./db/repo.js";
import { listAccessibleDocs } from "./google/drive.js";
import {
  appendAuditRow,
  appendRecentActivityRow,
  appendCommandRow,
  loadDocWalletTables,
  readChatTable,
  readCommandsTable,
  readConfig,
  updateBalancesTable,
  updateChatRowCells,
  updateCommandsRowCells,
  updateOpenOrdersTable,
  upsertSessionRow,
  userEditableCommandsHash,
  writeConfigValue
} from "./google/docwallet.js";
import { createAndStoreDocSecrets, loadDocSecrets } from "./wallet/store.js";
import { decryptWithMasterKey } from "./wallet/crypto.js";
import type { AppConfig } from "./config.js";
import { ArcClient } from "./integrations/arc.js";
import { CircleArcClient } from "./integrations/circle.js";
import { EnsPolicyClient } from "./integrations/ens.js";
import { NitroRpcYellowClient } from "./integrations/yellow.js";
import type { DeepBookClient } from "./integrations/deepbook.js";
import type { WalletConnectService } from "./integrations/walletconnect.js";

type ExecutionContext = {
  config: AppConfig;
  docs: docs_v1.Docs;
  drive: drive_v3.Drive;
  repo: Repo;
  yellow?: NitroRpcYellowClient;
  deepbook?: DeepBookClient;
  arc?: ArcClient;
  circle?: CircleArcClient;
  ens?: EnsPolicyClient;
  walletconnect?: WalletConnectService;
};

export class Engine {
  private discoveryRunning = false;
  private pollRunning = false;
  private executorRunning = false;
  private balancesRunning = false;
  private schedulerRunning = false;

  constructor(private ctx: ExecutionContext) {}

  async discoveryTick() {
    if (this.discoveryRunning) return;
    this.discoveryRunning = true;
    try {
      const { config, drive, docs, repo } = this.ctx;
      if (config.DOCWALLET_DOC_ID) {
        const d = await docs.documents.get({ documentId: config.DOCWALLET_DOC_ID });
        const title = d.data.title ?? config.DOCWALLET_DOC_ID;
        repo.upsertDoc({ docId: config.DOCWALLET_DOC_ID, name: title });
        await loadDocWalletTables({ docs, docId: config.DOCWALLET_DOC_ID });
        return;
      }

      const files = await listAccessibleDocs({
        drive,
        namePrefix: config.DOCWALLET_DISCOVER_ALL ? undefined : config.DOCWALLET_NAME_PREFIX
      });
      for (const f of files) {
        repo.upsertDoc({ docId: f.id, name: f.name });
        await loadDocWalletTables({ docs, docId: f.id });
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
      for (const d of tracked) {
        const docId = d.doc_id;
        const tables = await loadDocWalletTables({ docs, docId });
        const configMap = readConfig(tables.config.table);
        const ensName = configMap["ENS_NAME"]?.value?.trim() || d.ens_name || "";
        const docCellApprovalsEnabled = configMap["DOC_CELL_APPROVALS"]?.value?.trim() === "1";
        const autoPropEnabled = configMap["AGENT_AUTOPROPOSE"]?.value?.trim();
        const signerApprovalGasPaid = configMap["SIGNER_APPROVAL_GAS_PAID"]?.value?.trim();

        if (configMap["ENS_NAME"] && ensName) {
          repo.setDocConfig(docId, "ens_name", ensName);
        }
        if (configMap["POLICY_SOURCE"]) {
          const policySource = configMap["POLICY_SOURCE"].value.trim();
          if (policySource) repo.setDocConfig(docId, "policy_source", policySource);
        }
        if (configMap["DOC_CELL_APPROVALS"]) {
          repo.setDocConfig(docId, "doc_cell_approvals", docCellApprovalsEnabled ? "1" : "0");
        }
        if (configMap["AGENT_AUTOPROPOSE"] && (autoPropEnabled === "1" || autoPropEnabled === "0")) {
          repo.setDocConfig(docId, "agent_autopropose", autoPropEnabled);
        }
        if (configMap["SIGNER_APPROVAL_GAS_PAID"] && signerApprovalGasPaid) {
          repo.setDocConfig(docId, "signer_approval_gas_paid", signerApprovalGasPaid);
        }

        const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;

        // Treat Config table as source of truth for quorum (so the doc can be edited without a command).
        const qText = configMap["QUORUM"]?.value?.trim() ?? "";
        const qNum = qText ? Number(qText) : NaN;
        if (Number.isFinite(qNum) && qNum > 0 && Math.floor(qNum) === qNum && repo.getDocQuorum(docId) !== qNum) {
          repo.setDocQuorum(docId, qNum);
        }

        // Best-effort sync some config rows so the doc is "judge-ready".
        try {
          if (configMap["DOC_ID"] && configMap["DOC_ID"].value !== docId) {
            await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "DOC_ID", value: docId });
          }
          if (configMap["WEB_BASE_URL"] && configMap["WEB_BASE_URL"].value !== publicBaseUrl) {
            await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "WEB_BASE_URL", value: publicBaseUrl });
          }
          if (configMap["JOIN_URL"]) {
            const joinUrl = `${publicBaseUrl}/join/${encodeURIComponent(docId)}`;
            if (configMap["JOIN_URL"].value !== joinUrl) {
              await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "JOIN_URL", value: joinUrl });
            }
          }
          if (configMap["QUORUM"]) {
            const q = repo.getDocQuorum(docId);
            if (configMap["QUORUM"].value !== String(q)) {
              await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "QUORUM", value: String(q) });
            }
          }
          if (configMap["SIGNERS"]) {
            const signers = repo.listSigners(docId).map((s) => s.address).join(",");
            if (configMap["SIGNERS"].value !== signers) {
              await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "SIGNERS", value: signers });
            }
          }
        } catch {
          // ignore
        }

        const commandsHash = sha256Hex(userEditableCommandsHash(tables.commands.table));
        if (d.last_user_hash && d.last_user_hash === commandsHash) continue;

        const rows = readCommandsTable(tables.commands.table);
        for (const row of rows) {
          if (!row.command) continue;

          // --- Status-cell approval: user can type APPROVED / REJECTED directly ---
          if (row.id) {
            const existing = repo.getCommand(row.id);
            if (existing?.status === "PENDING_APPROVAL") {
              const cellStatus = row.status.toUpperCase().trim();
              if (cellStatus === "APPROVED") {
                const quorum = repo.getDocQuorum(docId);
                const signerCount = repo.listSigners(docId).length;
                const allowCellApprovals = docCellApprovalsEnabled || quorum <= 1 || signerCount === 0;
                // Allow cell-based approval for single-signer or no-signer (demo) docs or when config enabled
                if (allowCellApprovals) {
                  repo.setCommandStatus(row.id, "APPROVED");
                  await this.audit(docId, `${row.id} APPROVED (cell-edit)`);
                  continue;
                }
              }
              if (cellStatus === "REJECTED" || cellStatus === "REJECT") {
                repo.setCommandStatus(row.id, "REJECTED", { errorText: "Rejected via cell edit" });
                await this.audit(docId, `${row.id} REJECTED (cell-edit)`);
                continue;
              }
            }
          }

          // --- Auto-detect commands without DW prefix (WalletSheets UX) ---
          if (!row.command.toUpperCase().startsWith("DW")) {
            const autoDetected = tryAutoDetect(row.command);
            if (!autoDetected) continue; // Not a recognizable command, skip
            // Rewrite the command cell with the proper DW-prefixed version
            if (autoDetected.ok) {
              const rewritten = autoDetected.value;
              // Build a canonical DW command string from the parsed result
              const dwCommand = reconstructDwCommand(rewritten);
              if (dwCommand) {
                row.command = dwCommand;
                // Update the cell in the doc to show the rewritten command
                await updateCommandsRowCells({
                  docs,
                  docId,
                  commandsTable: (await loadDocWalletTables({ docs, docId })).commands.table,
                  rowIndex: row.rowIndex,
                  updates: { command: dwCommand }
                });
              } else {
                continue;
              }
            } else {
              continue;
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

            const policyDecision = await this.checkPolicyIfPresent(ensName, parsed.value);
            if (!policyDecision.ok) {
              repo.upsertCommand({
                cmd_id: cmdId,
                doc_id: docId,
                raw_command: row.command,
                parsed_json: JSON.stringify(parsed.value),
                status: "REJECTED_POLICY",
                yellow_intent_id: null,
                sui_tx_digest: null,
                arc_tx_hash: null,
                result_text: null,
                error_text: policyDecision.reason
              });
              await updateCommandsRowCells({
                docs,
                docId,
                commandsTable: (await loadDocWalletTables({ docs, docId })).commands.table,
                rowIndex: row.rowIndex,
                updates: { id: cmdId, status: "REJECTED_POLICY", error: policyDecision.reason, approvalUrl: "" }
              });
              await this.audit(docId, `${cmdId} REJECTED_POLICY (${policyDecision.reason})`);
              continue;
            }

            const initialStatus = parsed.value.type === "SETUP" ? "APPROVED" : "PENDING_APPROVAL";
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

            const approvalUrl = initialStatus === "PENDING_APPROVAL" ? `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(cmdId)}` : "";
            await this.updateRowByIndex(docId, row.rowIndex, { id: cmdId, status: initialStatus, approvalUrl, error: "" });
            await this.audit(docId, `${cmdId} ${initialStatus}`);
            continue;
          }

          // Existing row: edits / best-effort backfill
          const existing = repo.getCommand(row.id);
          if (!existing) {
            // Best effort: ingest it.
            const parsed = parseCommand(row.command);
            repo.upsertCommand({
              cmd_id: row.id,
              doc_id: docId,
              raw_command: row.command,
              parsed_json: parsed.ok ? JSON.stringify(parsed.value) : null,
              status: parsed.ok && parsed.value.type === "SETUP" ? "APPROVED" : parsed.ok ? "PENDING_APPROVAL" : "INVALID",
              yellow_intent_id: null,
              sui_tx_digest: null,
              arc_tx_hash: null,
              result_text: null,
              error_text: parsed.ok ? null : parsed.error
            });
          } else if (existing.raw_command !== row.command) {
            if (existing.status === "PENDING_APPROVAL" || existing.status === "INVALID") {
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
                  commandsTable: (await loadDocWalletTables({ docs, docId })).commands.table,
                  rowIndex: row.rowIndex,
                  updates: { status: "INVALID", error: parsed.error }
                });
              } else {
                const newStatus =
                  parsed.value.type === "SETUP" ? "APPROVED" : "PENDING_APPROVAL";
                repo.upsertCommand({
                  cmd_id: existing.cmd_id,
                  doc_id: existing.doc_id,
                  raw_command: row.command,
                  parsed_json: JSON.stringify(parsed.value),
                  status: newStatus,
                  yellow_intent_id: existing.yellow_intent_id,
                  sui_tx_digest: existing.sui_tx_digest,
                  arc_tx_hash: existing.arc_tx_hash,
                  result_text: existing.result_text,
                  error_text: null
                });
                const approvalUrl =
                  newStatus === "PENDING_APPROVAL"
                    ? `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(existing.cmd_id)}`
                    : "";
                await updateCommandsRowCells({
                  docs,
                  docId,
                  commandsTable: (await loadDocWalletTables({ docs, docId })).commands.table,
                  rowIndex: row.rowIndex,
                  updates: { status: newStatus, approvalUrl, error: "" }
                });
              }
            } else {
              await updateCommandsRowCells({
                docs,
                docId,
                commandsTable: (await loadDocWalletTables({ docs, docId })).commands.table,
                rowIndex: row.rowIndex,
                updates: { error: "Command locked after approval/execution" }
              });
            }
          }

          // If still pending approval, ensure the approval URL is present (covers older template migrations).
          const cmd = repo.getCommand(row.id);
          if (cmd?.status === "PENDING_APPROVAL" && !row.approvalUrl) {
            await updateCommandsRowCells({
              docs,
              docId,
              commandsTable: (await loadDocWalletTables({ docs, docId })).commands.table,
              rowIndex: row.rowIndex,
              updates: { approvalUrl: `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(row.id)}` }
            });
          }
        }

        repo.setDocLastUserHash(docId, commandsHash);

        // Best-effort ensure config points to ENS if set.
        if (ensName && configMap["POLICY_SOURCE"]?.value !== "ENS") {
          repo.setDocPolicy(docId, { policySource: "ENS", ensName });
        }
      }
    } finally {
      this.pollRunning = false;
    }
  }

  async chatTick() {
    const { docs, repo } = this.ctx;
    const tracked = repo.listDocs();
    for (const d of tracked) {
      const docId = d.doc_id;
      const tables = await loadDocWalletTables({ docs, docId });
      const rows = readChatTable(tables.chat.table);
      for (const row of rows) {
        if (!row.user || row.agent) continue;

        // Handle !execute prefix: auto-insert suggested command into Commands table
        const isAutoExecute = row.user.trim().startsWith("!execute");
        const userText = isAutoExecute ? row.user.trim().replace(/^!execute\s*/i, "").trim() : row.user;

        const response = suggestCommandFromChat(userText, { repo, docId });

        // Only auto-insert when user explicitly uses !execute
        if (isAutoExecute) {
          // Extract the DW command from the suggestion and auto-insert it
          const dwMatch = response.match(/(?:Use:|Paste into Commands table:)\s*(DW\s+.+)/i);
          if (dwMatch) {
            const dwCommand = dwMatch[1]!.trim();
            await appendCommandRow({
              docs,
              docId,
              id: generateCmdId(docId, dwCommand),
              command: dwCommand,
              status: "PENDING_APPROVAL",
              result: "",
              error: ""
            });
            const label = "Auto-submitted";
            await updateChatRowCells({ docs, docId, chatTable: tables.chat.table, rowIndex: row.rowIndex, agent: `OK ${label}: ${dwCommand}` });
          } else {
            await updateChatRowCells({ docs, docId, chatTable: tables.chat.table, rowIndex: row.rowIndex, agent: response });
          }
        } else {
          await updateChatRowCells({ docs, docId, chatTable: tables.chat.table, rowIndex: row.rowIndex, agent: response });
        }

        await appendAuditRow({
          docs,
          docId,
          timestampIso: new Date().toISOString(),
          message: `CHAT: ${row.user} -> ${response.slice(0, 100)}`
        });
      }
    }
  }

  /**
   * Live Portfolio Dashboard — queries balances from all chains and updates the BALANCES
   * and OPEN_ORDERS tables in the Google Doc. Runs every BALANCE_POLL_INTERVAL_MS.
   */
  async balancesTick() {
    if (this.balancesRunning) return;
    this.balancesRunning = true;
    try {
      const { docs, repo, config, arc, circle, deepbook } = this.ctx;
      const tracked = repo.listDocs();

      for (const d of tracked) {
        const docId = d.doc_id;
        const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
        if (!secrets) continue; // Not set up yet

        const tables = await loadDocWalletTables({ docs, docId });
        const configMap = readConfig(tables.config.table);

        const balanceEntries: Array<{ location: string; asset: string; balance: string }> = [];

        // --- Sui balances ---
        if (deepbook && secrets.sui) {
          try {
            const bals = await deepbook.getWalletBalances({ address: secrets.sui.address });
            balanceEntries.push({ location: "Sui", asset: "SUI", balance: bals.suiBalance });
            balanceEntries.push({ location: "Sui", asset: "DBUSDC", balance: bals.dbUsdcBalance });
          } catch {
            balanceEntries.push({ location: "Sui", asset: "SUI", balance: "err" });
          }
        }

        // --- Arc balances (EVM wallet) ---
        if (arc && secrets.evm) {
          try {
            const bals = await arc.getBalances(secrets.evm.address as `0x${string}`);
            balanceEntries.push({ location: "Arc", asset: "Native", balance: bals.nativeBalance });
            balanceEntries.push({ location: "Arc", asset: "USDC", balance: bals.usdcBalance });
          } catch {
            balanceEntries.push({ location: "Arc", asset: "USDC", balance: "err" });
          }
        }

        // --- Circle wallet balance ---
        if (circle) {
          const circleWallet = repo.getCircleWallet(docId);
          if (circleWallet) {
            try {
              const bal = await circle.getWalletBalance(circleWallet.wallet_id);
              balanceEntries.push({ location: "Circle/Arc", asset: "USDC", balance: bal.usdcBalance });
            } catch {
              balanceEntries.push({ location: "Circle/Arc", asset: "USDC", balance: "err" });
            }
          }
        }

        // Timestamp row
        balanceEntries.push({ location: "Updated", asset: "", balance: new Date().toISOString().slice(0, 19) });

        await updateBalancesTable({ docs, docId, balancesTable: tables.balances.table, entries: balanceEntries });

        // --- Open Orders refresh ---
        if (deepbook && secrets.sui) {
          const managerId = configMap["DEEPBOOK_MANAGER"]?.value?.trim() || "";
          const poolKey = configMap["DEEPBOOK_POOL"]?.value?.trim() || "SUI_DBUSDC";
          if (managerId) {
            try {
              const orders = await deepbook.getOpenOrders({ wallet: secrets.sui, poolKey, managerId });
              const orderRows = orders.map((o) => ({
                orderId: o.orderId,
                side: o.side,
                price: o.price,
                qty: o.qty,
                status: o.status,
                updatedAt: new Date().toISOString().slice(0, 19),
                tx: ""
              }));
              await updateOpenOrdersTable({ docs, docId, openOrdersTable: tables.openOrders.table, orders: orderRows });
            } catch { /* ignore */ }
          }
        }
      }
    } finally {
      this.balancesRunning = false;
    }
  }

  /**
   * Scheduler tick — checks for due scheduled commands (DCA, recurring payouts)
   * and spawns them as new commands in the doc.
   */
  async schedulerTick() {
    if (this.schedulerRunning) return;
    this.schedulerRunning = true;
    try {
      const { docs, repo } = this.ctx;
      const dueSchedules = repo.listDueSchedules();

      for (const schedule of dueSchedules) {
        const docId = schedule.doc_id;
        const innerCommand = schedule.inner_command;

        // Parse the inner command to validate it's still valid
        const parsed = parseCommand(innerCommand);
        if (!parsed.ok) {
          repo.cancelSchedule(schedule.schedule_id);
          await this.audit(docId, `SCHEDULE ${schedule.schedule_id} CANCELLED (invalid inner command)`);
          continue;
        }

        // Create a new command row from the schedule
        const cmdId = generateCmdId(docId, `sched:${schedule.schedule_id}:${Date.now()}`);
        repo.upsertCommand({
          cmd_id: cmdId,
          doc_id: docId,
          raw_command: innerCommand,
          parsed_json: JSON.stringify(parsed.value),
          status: "APPROVED", // Auto-approved since the schedule itself was approved
          yellow_intent_id: null,
          sui_tx_digest: null,
          arc_tx_hash: null,
          result_text: null,
          error_text: null
        });

        // Add the command to the doc
        await appendCommandRow({
          docs,
          docId,
          id: cmdId,
          command: `[SCHED:${schedule.schedule_id}#${schedule.total_runs + 1}] ${innerCommand}`,
          status: "APPROVED",
          result: "",
          error: ""
        });

        await this.audit(docId, `SCHEDULE ${schedule.schedule_id} RUN#${schedule.total_runs + 1} -> ${cmdId}`);

        // Advance to next run
        repo.advanceSchedule(schedule.schedule_id);
      }
    } finally {
      this.schedulerRunning = false;
    }
  }

  async handleWalletConnectSessionUpdate(session: {
    docId: string;
    topic: string;
    peerName: string;
    chains: string[];
    status: string;
    createdAt: number;
  }) {
    const { docs } = this.ctx;
    await upsertSessionRow({
      docs,
      docId: session.docId,
      sessionId: session.topic,
      peerName: session.peerName,
      chains: session.chains.join(","),
      createdAt: new Date(session.createdAt).toISOString(),
      status: session.status
    });
    await appendAuditRow({
      docs,
      docId: session.docId,
      timestampIso: new Date().toISOString(),
      message: `WC SESSION ${session.status} ${session.peerName}`
    });
  }

  async handleWalletConnectRequest(req: { docId: string; topic: string; id: number; method: string; params: any; chainId?: string }) {
    const { repo, docs, config } = this.ctx;
    const docId = req.docId;
    const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;

    if (req.method !== "eth_sendTransaction" && req.method !== "personal_sign") {
      throw new Error(`Unsupported WalletConnect method: ${req.method}`);
    }

    const cmdId = generateCmdId(docId, `${req.method}:${Date.now()}`);
    let parsed: ParsedCommand;
    let rawCommand = "";

    if (req.method === "eth_sendTransaction") {
      const tx = Array.isArray(req.params) ? req.params[0] : req.params;
      if (!tx || typeof tx !== "object") throw new Error("WalletConnect tx missing params");
      const to = String(tx.to ?? "");
      if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error("WalletConnect tx missing valid to address");
      const chainId = parseWcChainId(req.chainId) ?? 5042002;
      const asHex = (v: any, label: string): `0x${string}` | undefined => {
        if (v === null || v === undefined || v === "") return undefined;
        const s = typeof v === "number" ? `0x${v.toString(16)}` : String(v);
        if (!/^0x[0-9a-fA-F]*$/.test(s)) throw new Error(`Invalid hex for ${label}`);
        return s as `0x${string}`;
      };
      const wcTx = {
        chainId,
        to: to as `0x${string}`,
        data: asHex(tx.data, "data"),
        value: asHex(tx.value, "value"),
        from: tx.from
          ? (() => {
              const s = String(tx.from);
              if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new Error("Invalid from address");
              return s as `0x${string}`;
            })()
          : undefined,
        gas: asHex(tx.gas, "gas"),
        gasPrice: asHex(tx.gasPrice, "gasPrice"),
        maxFeePerGas: asHex(tx.maxFeePerGas, "maxFeePerGas"),
        maxPriorityFeePerGas: asHex(tx.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
        nonce: asHex(tx.nonce, "nonce")
      };
      parsed = { type: "WC_TX", ...wcTx };
      rawCommand = `DW TX ${JSON.stringify(wcTx)}`;
    } else {
      const p = Array.isArray(req.params) ? req.params : [];
      const a0 = p[0];
      const a1 = p[1];
      const addr = typeof a0 === "string" && /^0x[0-9a-fA-F]{40}$/.test(a0) ? a0 : typeof a1 === "string" ? a1 : "";
      const msg = typeof a0 === "string" && addr !== a0 ? a0 : typeof a1 === "string" ? a1 : "";
      if (!addr) throw new Error("WalletConnect personal_sign missing address");
      if (!msg) throw new Error("WalletConnect personal_sign missing message");
      parsed = { type: "WC_SIGN", address: addr as `0x${string}`, message: msg };
      rawCommand = `DW SIGN ${JSON.stringify({ address: addr, message: msg })}`;
    }

    repo.upsertCommand({
      cmd_id: cmdId,
      doc_id: docId,
      raw_command: rawCommand,
      parsed_json: JSON.stringify(parsed),
      status: "PENDING_APPROVAL",
      yellow_intent_id: null,
      sui_tx_digest: null,
      arc_tx_hash: null,
      result_text: null,
      error_text: null
    });
    repo.upsertWalletConnectRequest({
      docId,
      cmdId,
      topic: req.topic,
      requestId: req.id,
      method: req.method,
      paramsJson: JSON.stringify(req.params ?? null),
      status: "PENDING"
    });

    const approvalUrl = `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(cmdId)}`;
    await appendCommandRow({
      docs,
      docId,
      id: cmdId,
      command: rawCommand,
      status: "PENDING_APPROVAL",
      approvalUrl,
      result: "",
      error: ""
    });

    await appendAuditRow({
      docs,
      docId,
      timestampIso: new Date().toISOString(),
      message: `WC REQUEST ${req.method} -> ${cmdId}`
    });
  }

  async executorTick() {
    if (this.executorRunning) return;
    this.executorRunning = true;
    let executing: { docId: string; cmdId: string } | null = null;
    try {
      const { repo } = this.ctx;
      const cmd = repo.getNextApprovedCommand();
      if (!cmd) return;
      executing = { docId: cmd.doc_id, cmdId: cmd.cmd_id };
      repo.setCommandStatus(cmd.cmd_id, "EXECUTING", { errorText: null });

      await this.updateDocRow(cmd.doc_id, cmd.cmd_id, { status: "EXECUTING", error: "" });
      await this.audit(cmd.doc_id, `${cmd.cmd_id} EXECUTING`);

      const command: ParsedCommand = cmd.parsed_json
        ? (JSON.parse(cmd.parsed_json) as ParsedCommand)
        : (() => {
            const pr = parseCommand(cmd.raw_command);
            if (!pr.ok) throw new Error(`Cannot execute invalid command: ${pr.error}`);
            return pr.value;
          })();

      const result = await this.execute(cmd.doc_id, cmd.cmd_id, command);
      repo.setCommandExecutionIds(cmd.cmd_id, {
        suiTxDigest: result.suiTxDigest,
        arcTxHash: result.arcTxHash
      });
      repo.setCommandStatus(cmd.cmd_id, "EXECUTED", { resultText: result.resultText, errorText: null });

      await this.updateDocRow(cmd.doc_id, cmd.cmd_id, { status: "EXECUTED", result: result.resultText, error: "" });
      await this.audit(cmd.doc_id, `${cmd.cmd_id} EXECUTED ${result.resultText}`);

      await appendRecentActivityRow({
        docs: this.ctx.docs,
        docId: cmd.doc_id,
        timestampIso: new Date().toISOString(),
        type: command.type,
        details: cmd.raw_command,
        tx: result.arcTxHash ?? result.suiTxDigest ?? ""
      });

      const wcReq = repo.getWalletConnectRequestByCmdId(cmd.cmd_id);
      if (wcReq && this.ctx.walletconnect) {
        if (result.wcResponse === undefined) {
          await this.ctx.walletconnect.respondError(wcReq.topic, wcReq.request_id, "Missing WalletConnect response payload");
          repo.setWalletConnectRequestStatus({ topic: wcReq.topic, requestId: wcReq.request_id, status: "FAILED" });
        } else {
          await this.ctx.walletconnect.respondResult(wcReq.topic, wcReq.request_id, result.wcResponse);
          repo.setWalletConnectRequestStatus({ topic: wcReq.topic, requestId: wcReq.request_id, status: "RESPONDED" });
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      const { repo } = this.ctx;
      if (executing) {
        repo.setCommandStatus(executing.cmdId, "FAILED", { errorText: e });
        await this.updateDocRow(executing.docId, executing.cmdId, { status: "FAILED", error: e });
        await this.audit(executing.docId, `${executing.cmdId} FAILED ${e}`);
        const wcReq = repo.getWalletConnectRequestByCmdId(executing.cmdId);
        if (wcReq && this.ctx.walletconnect) {
          await this.ctx.walletconnect.respondError(wcReq.topic, wcReq.request_id, e);
          repo.setWalletConnectRequestStatus({ topic: wcReq.topic, requestId: wcReq.request_id, status: "FAILED" });
        }
      }
    } finally {
      this.executorRunning = false;
    }
  }

  private async execute(docId: string, cmdId: string, command: ParsedCommand): Promise<{
    resultText: string;
    suiTxDigest?: string;
    arcTxHash?: string;
    wcResponse?: any;
  }> {
    const { repo, config, arc, circle, deepbook } = this.ctx;
    const yellow = this.ctx.yellow;
    if (command.type === "SETUP") {
      const existing = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      const secrets = existing ?? createAndStoreDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
      repo.setDocAddresses(docId, { evmAddress: secrets.evm.address, suiAddress: secrets.sui.address });

      let tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigValue({
        docs: this.ctx.docs,
        docId,
        configTable: tables.config.table,
        key: "EVM_ADDRESS",
        value: secrets.evm.address
      });
      await writeConfigValue({
        docs: this.ctx.docs,
        docId,
        configTable: tables.config.table,
        key: "SUI_ADDRESS",
        value: secrets.sui.address
      });
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "STATUS", value: "READY" });

      // Circle/Arc dev-controlled wallet (track-winner path)
      let circleAddr = "";
      if (circle) {
        const existingCircle = repo.getCircleWallet(docId);
        if (existingCircle) {
          circleAddr = existingCircle.wallet_address;
          await writeConfigValue({
            docs: this.ctx.docs,
            docId,
            configTable: tables.config.table,
            key: "ARC_WALLET_ADDRESS",
            value: existingCircle.wallet_address
          });
          await writeConfigValue({
            docs: this.ctx.docs,
            docId,
            configTable: tables.config.table,
            key: "ARC_WALLET_ID",
            value: existingCircle.wallet_id
          });
        } else {
          const w = await circle.createArcWallet();
          repo.upsertCircleWallet({ docId, walletSetId: w.walletSetId, walletId: w.walletId, walletAddress: w.address });
          circleAddr = w.address;
          await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "ARC_WALLET_ADDRESS", value: w.address });
          await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "ARC_WALLET_ID", value: w.walletId });
        }
      }

      const extra = circleAddr ? ` ARC=${circleAddr}` : "";
      return { resultText: `EVM=${secrets.evm.address} SUI=${secrets.sui.address}${extra}` };
    }

    if (command.type === "POLICY_ENS") {
      repo.setDocPolicy(docId, { policySource: "ENS", ensName: command.ensName });
      let tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "POLICY_SOURCE", value: "ENS" });
      tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "ENS_NAME", value: command.ensName });
      return { resultText: `ENS=${command.ensName}` };
    }

    if (command.type === "QUORUM") {
      repo.setDocQuorum(docId, command.quorum);
      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "QUORUM", value: String(command.quorum) });
      return { resultText: `QUORUM=${command.quorum}` };
    }

    if (command.type === "SIGNER_ADD") {
      repo.upsertSigner({ docId, address: command.address, weight: command.weight });
      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      const signers = repo.listSigners(docId).map((s) => s.address).join(",");
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "SIGNERS", value: signers });
      return { resultText: `SIGNER_ADDED=${command.address} WEIGHT=${command.weight}` };
    }

    if (command.type === "STATUS") {
      const q = repo.getDocQuorum(docId);
      const signerCount = repo.listSigners(docId).length;
      const y = repo.getYellowSession(docId);
      const status = y ? `YELLOW_SESSION=${y.app_session_id} v${y.version}` : "YELLOW_SESSION=NONE";
      return { resultText: `QUORUM=${q} SIGNERS=${signerCount} ${status}` };
    }

    if (command.type === "SESSION_CREATE") {
      if (!yellow) throw new Error("Yellow disabled (set YELLOW_ENABLED=1 and YELLOW_RPC_URL)");
      const signers = repo.listSigners(docId);
      if (signers.length === 0) throw new Error("No signers registered. Use the /join page first.");
      const quorum = repo.getDocQuorum(docId);
      const keyRows = signers.map((s) => ({ signer: s, key: repo.getYellowSessionKey({ docId, signerAddress: s.address }) }));
      const missing = keyRows.filter((r) => !r.key).map((r) => r.signer.address);
      if (missing.length) throw new Error(`Missing Yellow session keys for: ${missing.join(", ")}. Re-join via /join/<docId>.`);

      const now = Date.now();
      const expired = keyRows.filter((r) => (r.key?.expires_at ?? 0) <= now).map((r) => r.signer.address);
      if (expired.length) throw new Error(`Expired Yellow session keys for: ${expired.join(", ")}. Re-join via /join/<docId>.`);

      const definition = {
        protocol: "NitroRPC/0.4",
        // Participants are the delegated session keys so they can sign without repeated wallet prompts.
        participants: keyRows.map((r) => r.key!.session_key_address),
        weights: signers.map((s) => s.weight),
        quorum,
        challenge: 86400,
        nonce: Date.now()
      };
      const definitionJson = JSON.stringify(definition);
      const signerPrivateKeysHex = keyRows.map((r) => {
        const plain = decryptWithMasterKey({ masterKey: config.DOCWALLET_MASTER_KEY, blob: r.key!.encrypted_session_key_private });
        const parsed = JSON.parse(plain.toString("utf8")) as { privateKeyHex: `0x${string}` };
        return parsed.privateKeyHex;
      });

      const created = await yellow.createAppSession({ signerPrivateKeysHex, definition, sessionData: `DocWallet:${docId}` });
      const appSessionId = created.appSessionId as any;

      repo.upsertYellowSession({ docId, appSessionId, definitionJson, version: 0, status: "OPEN" });

      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "YELLOW_SESSION_ID", value: appSessionId });
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key: "YELLOW_PROTOCOL", value: "NitroRPC/0.4" });

      return { resultText: `YELLOW_SESSION=${appSessionId}` };
    }

    if (command.type === "CONNECT") {
      if (!this.ctx.walletconnect) throw new Error("WalletConnect disabled (set WALLETCONNECT_ENABLED=1)");
      await this.ctx.walletconnect.pair({ uri: command.wcUri, docId });
      return { resultText: "WALLETCONNECT_PAIRING_STARTED" };
    }

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
      const nextRunIso = new Date(nextRunAt).toISOString().slice(0, 19);
      return { resultText: `SCHEDULE_CREATED=${scheduleId} EVERY ${command.intervalHours}h NEXT=${nextRunIso}` };
    }

    if (command.type === "CANCEL_SCHEDULE") {
      const schedule = repo.getSchedule(command.scheduleId);
      if (!schedule) throw new Error(`Schedule not found: ${command.scheduleId}`);
      if (schedule.doc_id !== docId) throw new Error("Schedule belongs to a different doc");
      repo.cancelSchedule(command.scheduleId);
      return { resultText: `SCHEDULE_CANCELLED=${command.scheduleId} (ran ${schedule.total_runs} times)` };
    }

    const secrets = loadDocSecrets({ repo, masterKey: config.DOCWALLET_MASTER_KEY, docId });
    if (!secrets) throw new Error("Missing wallets. Run DW /setup first.");

    // Re-check policy at execution time (best effort).
    const d = repo.getDoc(docId);
    const ensName = d?.ens_name?.trim() ?? "";
    const policyDecision = await this.checkPolicyIfPresent(ensName, command);
    if (!policyDecision.ok) throw new Error(policyDecision.reason);

    if (command.type === "WC_TX") {
      if (command.chainId !== 5042002) throw new Error(`Unsupported chainId ${command.chainId} (expected 5042002)`);
      if (!arc) throw new Error("Arc disabled (ARC_ENABLED=0)");
      const tx = await arc.sendTransaction({
        privateKeyHex: secrets.evm.privateKeyHex,
        to: command.to,
        data: command.data,
        value: command.value,
        gas: command.gas,
        gasPrice: command.gasPrice,
        maxFeePerGas: command.maxFeePerGas,
        maxPriorityFeePerGas: command.maxPriorityFeePerGas,
        nonce: command.nonce
      });
      return { arcTxHash: tx.txHash, resultText: `ArcTx=${tx.txHash}`, wcResponse: tx.txHash };
    }

    if (command.type === "WC_SIGN") {
      if (command.address.toLowerCase() !== secrets.evm.address.toLowerCase()) {
        throw new Error(`Signer address mismatch (${command.address})`);
      }
      const account = privateKeyToAccount(secrets.evm.privateKeyHex);
      const message = command.message;
      const signature = message.startsWith("0x")
        ? await account.signMessage({ message: { raw: message as `0x${string}` } })
        : await account.signMessage({ message });
      return { resultText: `Signature=${signature}`, wcResponse: signature };
    }

    if (command.type === "PAYOUT") {
      if (circle) {
        const w = repo.getCircleWallet(docId);
        if (!w) throw new Error("Missing Circle Arc wallet. Run DW /setup first.");
        const out = await circle.payout({
          walletId: w.wallet_id,
          walletAddress: w.wallet_address as `0x${string}`,
          destinationAddress: command.to,
          amountUsdc: command.amountUsdc
        });
        const txText = out.txHash ? `ArcTx=${out.txHash}` : `CircleState=${out.state}`;
        return {
          arcTxHash: out.txHash as any,
          resultText: `CircleTx=${out.circleTxId} ${txText}`
        };
      }

      if (!arc) throw new Error("Arc disabled (ARC_ENABLED=0)");
      const tx = await arc.transferUsdc({ privateKeyHex: secrets.evm.privateKeyHex, to: command.to, amountUsdc: command.amountUsdc });
      return { arcTxHash: tx.txHash, resultText: `ArcTx=${tx.txHash}` };
    }

    if (command.type === "PAYOUT_SPLIT") {
      if (circle) {
        const w = repo.getCircleWallet(docId);
        if (!w) throw new Error("Missing Circle Arc wallet. Run DW /setup first.");
        const txHashes: string[] = [];
        const circleTxIds: string[] = [];
        for (const r of command.recipients) {
          const amt = (command.amountUsdc * r.pct) / 100;
          const out = await circle.payout({
            walletId: w.wallet_id,
            walletAddress: w.wallet_address as `0x${string}`,
            destinationAddress: r.to,
            amountUsdc: amt
          });
          circleTxIds.push(out.circleTxId);
          if (out.txHash) txHashes.push(out.txHash);
        }
        return {
          arcTxHash: (txHashes[0] as any) ?? undefined,
          resultText: `CircleTxs=${circleTxIds.join(",")} ArcTxs=${txHashes.join(",")}`
        };
      }

      if (!arc) throw new Error("Arc disabled (ARC_ENABLED=0)");
      const txHashes: string[] = [];
      for (const r of command.recipients) {
        const amt = (command.amountUsdc * r.pct) / 100;
        const tx = await arc.transferUsdc({ privateKeyHex: secrets.evm.privateKeyHex, to: r.to, amountUsdc: amt });
        txHashes.push(tx.txHash);
      }
      return {
        arcTxHash: txHashes[0],
        resultText: `ArcTxs=${txHashes.join(",")}`
      };
    }

    if (command.type === "BRIDGE") {
      if (!circle) throw new Error("BRIDGE requires Circle (set CIRCLE_ENABLED=1)");
      const w = repo.getCircleWallet(docId);
      if (!w) throw new Error("Missing Circle Arc wallet. Run DW /setup first.");

      // Determine destination address based on target chain
      let destinationAddress = "";
      if (command.toChain === "sui") {
        destinationAddress = secrets.sui.address;
      } else {
        // EVM-compatible destination
        destinationAddress = secrets.evm.address;
      }

      const result = await circle.bridgeUsdc({
        walletId: w.wallet_id,
        walletAddress: w.wallet_address as `0x${string}`,
        destinationAddress,
        amountUsdc: command.amountUsdc,
        sourceChain: command.fromChain,
        destinationChain: command.toChain
      });

      const txText = result.txHash ? `BridgeTx=${result.txHash}` : `CircleState=${result.state}`;
      return {
        arcTxHash: result.txHash as any,
        resultText: `BRIDGE ${command.amountUsdc} USDC ${command.fromChain}->${command.toChain} CircleTx=${result.circleTxId} ${txText}`
      };
    }

    // --- Yellow State Channel Commands ---

    if (command.type === "SESSION_CLOSE") {
      if (!yellow) throw new Error("Yellow disabled (set YELLOW_ENABLED=1)");
      const session = repo.getYellowSession(docId);
      if (!session) throw new Error("No Yellow session found. Create one with DW SESSION_CREATE.");
      const signers = repo.listSigners(docId);
      const keyRows = signers.map((s) => ({ signer: s, key: repo.getYellowSessionKey({ docId, signerAddress: s.address }) }));
      const signerPrivateKeysHex = keyRows
        .filter((r) => r.key)
        .map((r) => {
          const plain = decryptWithMasterKey({ masterKey: config.DOCWALLET_MASTER_KEY, blob: r.key!.encrypted_session_key_private });
          const parsed = JSON.parse(plain.toString("utf8")) as { privateKeyHex: `0x${string}` };
          return parsed.privateKeyHex;
        });

      const result = await yellow.closeAppSession({
        signerPrivateKeysHex,
        appSessionId: session.app_session_id,
        version: session.version,
        sessionData: `DocWallet:${docId}:close`
      });
      repo.setYellowSessionVersion({ docId, version: result.version, status: "CLOSED" });
      return { resultText: `YELLOW_SESSION_CLOSED v${result.version}` };
    }

    if (command.type === "SESSION_STATUS") {
      if (!yellow) throw new Error("Yellow disabled (set YELLOW_ENABLED=1)");
      const session = repo.getYellowSession(docId);
      if (!session) return { resultText: "YELLOW_SESSION=NONE" };
      const status = await yellow.getSessionStatus({ appSessionId: session.app_session_id });
      const connInfo = yellow.getConnectionInfo();
      return {
        resultText: `YELLOW_SESSION=${session.app_session_id} v${status.version} STATUS=${status.status} PROTOCOL=${connInfo.protocol} PARTICIPANTS=${status.participants.length}`
      };
    }

    // --- DeepBook Deposit/Withdraw/Market Orders (Sui-native) ---

    if (command.type === "DEPOSIT") {
      if (!deepbook) throw new Error("DeepBook disabled (set DEEPBOOK_ENABLED=1)");
      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      const cfg = readConfig(tables.config.table);
      const poolKey = cfg["DEEPBOOK_POOL"]?.value?.trim() || "SUI_DBUSDC";
      const managerId = cfg["DEEPBOOK_MANAGER"]?.value?.trim();
      if (!managerId) throw new Error("No DeepBook manager. Place an order first or run DW /setup.");
      const res = await deepbook.deposit({ wallet: secrets.sui, poolKey, managerId, coinType: command.coinType, amount: command.amount });
      return { suiTxDigest: res.txDigest, resultText: `DEPOSITED ${command.amount} ${command.coinType} SuiTx=${res.txDigest}` };
    }

    if (command.type === "WITHDRAW") {
      if (!deepbook) throw new Error("DeepBook disabled (set DEEPBOOK_ENABLED=1)");
      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      const cfg = readConfig(tables.config.table);
      const poolKey = cfg["DEEPBOOK_POOL"]?.value?.trim() || "SUI_DBUSDC";
      const managerId = cfg["DEEPBOOK_MANAGER"]?.value?.trim();
      if (!managerId) throw new Error("No DeepBook manager. Place an order first or run DW /setup.");
      const res = await deepbook.withdraw({ wallet: secrets.sui, poolKey, managerId, coinType: command.coinType, amount: command.amount });
      return { suiTxDigest: res.txDigest, resultText: `WITHDRAWN ${command.amount} ${command.coinType} SuiTx=${res.txDigest}` };
    }

    if (command.type === "MARKET_BUY" || command.type === "MARKET_SELL") {
      if (!deepbook) throw new Error("DeepBook disabled (set DEEPBOOK_ENABLED=1)");
      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      const cfg = readConfig(tables.config.table);
      const poolKey = cfg["DEEPBOOK_POOL"]?.value?.trim() || "SUI_DBUSDC";
      const managerId = cfg["DEEPBOOK_MANAGER"]?.value?.trim();
      if (!managerId) throw new Error("No DeepBook manager. Place an order first or run DW /setup.");

      // Pre-flight gas check
      const gasCheck = await deepbook.checkGas({ address: secrets.sui.address });
      if (!gasCheck.ok) throw new Error(`Insufficient SUI gas: ${gasCheck.suiBalance} SUI < ${gasCheck.minRequired} SUI minimum`);

      const side = command.type === "MARKET_BUY" ? "buy" as const : "sell" as const;
      const res = await deepbook.placeMarketOrder({ wallet: secrets.sui, poolKey, managerId, side, qty: command.qty });
      const explorer = `https://suiscan.xyz/testnet/tx/${res.txDigest}`;
      return {
        suiTxDigest: res.txDigest,
        resultText: `MARKET_${side.toUpperCase()} ${command.qty} SUI SuiTx=${res.txDigest} Explorer=${explorer}`
      };
    }

    // --- Agent Configuration Commands (Arc autonomous agent) ---

    if (command.type === "ALERT_THRESHOLD") {
      repo.setDocConfig(docId, `alert_threshold_${command.coinType.toLowerCase()}`, String(command.below));
      repo.insertAgentActivity(docId, "CONFIG", `Alert threshold set: ${command.coinType} < ${command.below}`);
      return { resultText: `ALERT_THRESHOLD ${command.coinType} < ${command.below}` };
    }

    if (command.type === "AUTO_REBALANCE") {
      repo.setDocConfig(docId, "auto_rebalance", command.enabled ? "1" : "0");
      repo.insertAgentActivity(docId, "CONFIG", `Auto-rebalance ${command.enabled ? "enabled" : "disabled"}`);
      return { resultText: `AUTO_REBALANCE=${command.enabled ? "ON" : "OFF"}` };
    }

    if (!deepbook) throw new Error("DeepBook disabled (set DEEPBOOK_ENABLED=1)");

    const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
    const cfg = readConfig(tables.config.table);
    const poolKey = cfg["DEEPBOOK_POOL"]?.value?.trim() || "SUI_DBUSDC";
    const managerId = cfg["DEEPBOOK_MANAGER"]?.value?.trim() || undefined;

    const deepbookRes = await deepbook.execute({ docId, command, wallet: secrets.sui, poolKey, managerId });
    if (deepbookRes?.managerId && !managerId) {
      try {
        await writeConfigValue({
          docs: this.ctx.docs,
          docId,
          configTable: tables.config.table,
          key: "DEEPBOOK_MANAGER",
          value: deepbookRes.managerId
        });
      } catch {
        // ignore
      }
    }
    if (!deepbookRes) return { resultText: `OK` };
    if (deepbookRes.kind === "order") {
      return {
        suiTxDigest: deepbookRes.txDigest,
        resultText: `SuiTx=${deepbookRes.txDigest} OrderId=${deepbookRes.orderId}`
      };
    }
    return {
      suiTxDigest: deepbookRes.txDigest,
      resultText: `SuiTx=${deepbookRes.txDigest}`
    };
  }

  private async checkPolicyIfPresent(ensName: string, command: ParsedCommand) {
    const { ens, repo } = this.ctx;
    if (!ens || !ensName) return { ok: true as const };
    const policy = await ens.getPolicy(ensName);
    if (!policy) return { ok: true as const };

    // Build context for daily spend checking
    let dailySpendUsdc: number | undefined;
    if (policy.dailyLimitUsdc !== undefined) {
      // We need a docId to compute daily spend — find it from tracked docs
      const docs = repo.listDocs();
      const doc = docs.find((d) => d.ens_name === ensName);
      if (doc) {
        dailySpendUsdc = repo.getDailySpendUsdc(doc.doc_id);
      }
    }

    return evaluatePolicy(policy, command, { dailySpendUsdc });
  }

  private async updateDocRow(docId: string, cmdId: string, updates: { status?: string; result?: string; error?: string }) {
    const { docs } = this.ctx;
    const tables = await loadDocWalletTables({ docs, docId });
    const rows = readCommandsTable(tables.commands.table);
    const row = rows.find((r) => r.id === cmdId);
    if (!row) return;
    const mergedResult =
      updates.result === undefined
        ? undefined
        : (() => {
            const next = updates.result ?? "";
            const prev = row.result ?? "";
            if (!prev.trim()) return next;
            if (!next.trim()) return prev;
            if (prev.includes(next)) return prev;
            return `${prev} ${next}`.trim();
          })();
    await updateCommandsRowCells({
      docs,
      docId,
      commandsTable: tables.commands.table,
      rowIndex: row.rowIndex,
      updates: { status: updates.status, result: mergedResult, error: updates.error }
    });
  }

  private async audit(docId: string, message: string) {
    const { docs } = this.ctx;
    await appendAuditRow({
      docs,
      docId,
      timestampIso: new Date().toISOString(),
      message
    });
  }

  private async bestEffortWriteConfig(docId: string, key: string, value: string) {
    try {
      const tables = await loadDocWalletTables({ docs: this.ctx.docs, docId });
      const configMap = readConfig(tables.config.table);
      if (!configMap[key]) return;
      await writeConfigValue({ docs: this.ctx.docs, docId, configTable: tables.config.table, key, value });
    } catch {
      // ignore
    }
  }

  private async updateRowByIndex(
    docId: string,
    rowIndex: number,
    updates: { id?: string; status?: string; approvalUrl?: string; result?: string; error?: string }
  ) {
    const { docs } = this.ctx;
    const tables = await loadDocWalletTables({ docs, docId });
    await updateCommandsRowCells({ docs, docId, commandsTable: tables.commands.table, rowIndex, updates });
  }

  // --- Autonomous Agent Decision Engine (Arc track) ---

  private agentDecisionRunning = false;

  async agentDecisionTick() {
    if (this.agentDecisionRunning) return;
    this.agentDecisionRunning = true;
    try {
      const { repo, config, arc, deepbook, circle } = this.ctx;
      const docs = repo.listDocs();

      for (const doc of docs) {
        const docId = doc.doc_id;
        const decisions: string[] = [];

        // 1. Stale command alerting — flag commands pending > 1 hour
        const staleCommands = repo.listStaleCommands(3600_000);
        const docStale = staleCommands.filter((c) => c.doc_id === docId);
        if (docStale.length > 0) {
          const staleIds = docStale.map((c) => c.cmd_id).join(", ");
          decisions.push(`⚠️ ${docStale.length} stale command(s): ${staleIds}`);
          repo.insertAgentActivity(docId, "ALERT_STALE", `${docStale.length} stale commands older than 1h`);
        }

        // 2. Gas monitoring (Sui)
        if (deepbook && doc.sui_address) {
          const gasCheck = await deepbook.checkGas({ address: doc.sui_address, minSui: 0.05 });
          if (!gasCheck.ok) {
            decisions.push(`🔴 Low SUI gas: ${gasCheck.suiBalance.toFixed(4)} SUI (min: ${gasCheck.minRequired} SUI)`);
            repo.insertAgentActivity(docId, "ALERT_GAS", `Low SUI gas: ${gasCheck.suiBalance.toFixed(4)} SUI`);
          }
        }

        // 3. Balance threshold alerts
        const allThresholds = repo.listDocConfig(docId).filter((c) => c.key.startsWith("alert_threshold_"));
        for (const threshold of allThresholds) {
          const coinType = threshold.key.replace("alert_threshold_", "").toUpperCase();
          const belowValue = Number(threshold.value);
          if (!Number.isFinite(belowValue)) continue;

          if (coinType === "SUI" && deepbook && doc.sui_address) {
            const gasCheck = await deepbook.checkGas({ address: doc.sui_address });
            if (gasCheck.suiBalance < belowValue) {
              decisions.push(`⚠️ ${coinType} balance ${gasCheck.suiBalance.toFixed(4)} below threshold ${belowValue}`);
              repo.insertAgentActivity(docId, "ALERT_BALANCE", `${coinType} ${gasCheck.suiBalance.toFixed(4)} < ${belowValue}`);
            }
          }
          if (coinType === "USDC" && arc && doc.evm_address) {
            try {
              const balances = await arc.getBalances(doc.evm_address as `0x${string}`);
              const balNum = Number(balances.usdcBalance) / 1e6;
              if (balNum < belowValue) {
                decisions.push(`⚠️ ${coinType} balance ${balNum.toFixed(2)} below threshold ${belowValue}`);
                repo.insertAgentActivity(docId, "ALERT_BALANCE", `${coinType} ${balNum.toFixed(2)} < ${belowValue}`);
              }
            } catch { /* arc balance check failed, skip */ }
          }
        }

        // 4. Idle capital detection (Arc)
        if (arc && circle && doc.evm_address) {
          const circleW = repo.getCircleWallet(docId);
          if (circleW) {
            try {
              const balance = await circle.getWalletBalance(circleW.wallet_id);
              const usdcIdle = Number(balance?.usdcBalance ?? 0);
              if (usdcIdle > 100) {
                decisions.push(`💰 Idle capital detected: ${usdcIdle.toFixed(2)} USDC in Circle wallet`);
                repo.insertAgentActivity(docId, "IDLE_CAPITAL", `${usdcIdle.toFixed(2)} USDC idle in Circle wallet`);
              }
            } catch { /* ignore balance check failure */ }
          }
        }

        // 5. Auto-rebalance check
        const autoRebalance = repo.getDocConfig(docId, "auto_rebalance");
        if (autoRebalance === "1" && deepbook && doc.sui_address) {
          const gasCheck = await deepbook.checkGas({ address: doc.sui_address, minSui: 0.02 });
          if (!gasCheck.ok) {
            decisions.push(`🔄 Auto-rebalance needed: SUI gas critically low (${gasCheck.suiBalance.toFixed(4)} SUI)`);
            repo.insertAgentActivity(docId, "REBALANCE_NEEDED", `SUI gas at ${gasCheck.suiBalance.toFixed(4)}`);
          }
        }

        // Auto-proposals (agent suggestions inserted into Commands table)
        const autoProp = repo.getDocConfig(docId, "agent_autopropose");
        const autoPropEnabled = autoProp !== "0";
        if (autoPropEnabled) {
          const now = Date.now();
          const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;
          const recent = repo.listRecentCommands(docId, 30);
          const hasRecent = (raw: string) => {
            const norm = raw.trim().toUpperCase();
            return recent.some((c) => c.raw_command.trim().toUpperCase() === norm && ["PENDING_APPROVAL", "APPROVED", "EXECUTING"].includes(c.status));
          };
          const propose = async (rawCommand: string, reason: string, cooldownKey: string) => {
            const lastMs = Number(repo.getDocConfig(docId, cooldownKey) ?? "0");
            if (Number.isFinite(lastMs) && now - lastMs < 6 * 60 * 60 * 1000) return false;
            if (hasRecent(rawCommand)) return false;
            const parsed = parseCommand(rawCommand);
            if (!parsed.ok) return false;

            const cmdId = generateCmdId(docId, rawCommand);
            repo.upsertCommand({
              cmd_id: cmdId,
              doc_id: docId,
              raw_command: rawCommand,
              parsed_json: JSON.stringify(parsed.value),
              status: "PENDING_APPROVAL",
              yellow_intent_id: null,
              sui_tx_digest: null,
              arc_tx_hash: null,
              result_text: null,
              error_text: null
            });
            const approvalUrl = `${publicBaseUrl}/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(cmdId)}`;
            await appendCommandRow({
              docs: this.ctx.docs,
              docId,
              id: cmdId,
              command: rawCommand,
              status: "PENDING_APPROVAL",
              approvalUrl,
              result: "",
              error: ""
            });

            repo.setDocConfig(docId, cooldownKey, String(now));
            const lastProposalText = `${new Date().toISOString()} ${rawCommand}`;
            repo.setDocConfig(docId, "last_proposal", lastProposalText);
            repo.insertAgentActivity(docId, "PROPOSAL", rawCommand);

            await appendRecentActivityRow({
              docs: this.ctx.docs,
              docId,
              timestampIso: new Date().toISOString(),
              type: "AGENT_PROPOSAL",
              details: `${reason}: ${rawCommand}`.slice(0, 200),
              tx: ""
            });
            await this.bestEffortWriteConfig(docId, "LAST_PROPOSAL", lastProposalText);
            return true;
          };

          if (this.ctx.yellow) {
            const hasSession = Boolean(repo.getYellowSession(docId));
            const signerCount = repo.listSigners(docId).length;
            if (!hasSession && signerCount > 0) {
              await propose("DW SESSION_CREATE", "Yellow enabled, no session", "proposal_session_create_last_ms");
            }
          }

          const ensNameCfg = repo.getDocConfig(docId, "ens_name") || doc.ens_name || "";
          const policySourceCfg = repo.getDocConfig(docId, "policy_source") || doc.policy_source || "NONE";
          if (ensNameCfg && policySourceCfg !== "ENS") {
            await propose(`DW POLICY ENS ${ensNameCfg}`, "Policy not set", "proposal_policy_last_ms");
          }
        }

        // Log decision summary
        if (decisions.length > 0) {
          const summary = decisions.join(" | ");
          console.log(`[agent] ${docId.slice(0, 8)}…: ${summary}`);

          // Write agent decisions to Google Doc activity
          try {
            await appendRecentActivityRow({
              docs: this.ctx.docs,
              docId,
              timestampIso: new Date().toISOString(),
              type: "AGENT_DECISION",
              details: summary.slice(0, 200),
              tx: ""
            });
          } catch { /* ignore doc write failure */ }
        }
      }
    } catch (err) {
      console.error("agentDecisionTick error:", err);
    } finally {
      this.agentDecisionRunning = false;
    }
  }
}

function generateCmdId(docId: string, raw: string): string {
  const now = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const h = sha256Hex(`${docId}|${raw}|${Date.now()}`).slice(0, 10);
  return `cmd_${now}_${h}`;
}

function parseWcChainId(chainId?: string): number | null {
  if (!chainId) return null;
  const parts = chainId.split(":");
  const last = parts[parts.length - 1];
  if (!last) return null;
  const n = Number(last);
  return Number.isFinite(n) ? n : null;
}

/**
 * Detects if user input is clearly a transactional intent that should be auto-executed
 * without requiring the !execute prefix (WalletSheets-style passive interaction).
 */
/**
 * Reconstructs a canonical DW command string from a parsed command.
 * Used when auto-detecting commands without DW prefix.
 */
function reconstructDwCommand(cmd: ParsedCommand): string | null {
  switch (cmd.type) {
    case "SETUP": return "DW /setup";
    case "STATUS": return "DW STATUS";
    case "SETTLE": return "DW SETTLE";
    case "SESSION_CREATE": return "DW SESSION_CREATE";
    case "SESSION_CLOSE": return "DW SESSION_CLOSE";
    case "SESSION_STATUS": return "DW SESSION_STATUS";
    case "CONNECT": return `DW CONNECT ${cmd.wcUri}`;
    case "LIMIT_BUY": return `DW LIMIT_BUY ${cmd.base} ${cmd.qty} ${cmd.quote} @ ${cmd.price}`;
    case "LIMIT_SELL": return `DW LIMIT_SELL ${cmd.base} ${cmd.qty} ${cmd.quote} @ ${cmd.price}`;
    case "MARKET_BUY": return `DW MARKET_BUY ${cmd.base} ${cmd.qty}`;
    case "MARKET_SELL": return `DW MARKET_SELL ${cmd.base} ${cmd.qty}`;
    case "CANCEL": return `DW CANCEL ${cmd.orderId}`;
    case "DEPOSIT": return `DW DEPOSIT ${cmd.coinType} ${cmd.amount}`;
    case "WITHDRAW": return `DW WITHDRAW ${cmd.coinType} ${cmd.amount}`;
    case "PAYOUT": return `DW PAYOUT ${cmd.amountUsdc} USDC TO ${cmd.to}`;
    case "BRIDGE": return `DW BRIDGE ${cmd.amountUsdc} USDC FROM ${cmd.fromChain} TO ${cmd.toChain}`;
    case "CANCEL_SCHEDULE": return `DW CANCEL_SCHEDULE ${cmd.scheduleId}`;
    case "QUORUM": return `DW QUORUM ${cmd.quorum}`;
    case "SIGNER_ADD": return `DW SIGNER_ADD ${cmd.address} WEIGHT ${cmd.weight}`;
    case "POLICY_ENS": return `DW POLICY ENS ${cmd.ensName}`;
    case "SCHEDULE": return `DW SCHEDULE EVERY ${cmd.intervalHours}h: ${cmd.innerCommand.replace(/^DW\s+/i, "")}`;
    case "ALERT_THRESHOLD": return `DW ALERT_THRESHOLD ${cmd.coinType} ${cmd.below}`;
    case "AUTO_REBALANCE": return `DW AUTO_REBALANCE ${cmd.enabled ? "ON" : "OFF"}`;
    default: return null;
  }
}

export function suggestCommandFromChat(input: string, context?: { repo: Repo; docId: string }): string {
  const text = input.trim();
  if (!text) return "Type a command or ask a question. Prefix with !execute to insert into the Commands table.";
  if (text.toUpperCase().startsWith("DW ")) return `Command detected. Paste into Commands table: ${text}`;

  const lower = text.toLowerCase();

  // --- Context-aware queries ---
  if (context) {
    const { repo, docId } = context;

    if (lower.includes("balance") || lower.includes("how much") || lower.includes("portfolio")) {
      const doc = repo.getDoc(docId);
      const evmAddr = doc?.evm_address ?? "not set";
      const suiAddr = doc?.sui_address ?? "not set";
      const circleW = repo.getCircleWallet(docId);
      const lines = [`Wallets:`, `EVM: ${evmAddr}`, `SUI: ${suiAddr}`];
      if (circleW) lines.push(`Circle/Arc: ${circleW.wallet_address}`);
      lines.push("Balances auto-update in the BALANCES table above.");
      return lines.join("\n");
    }

    if (lower.includes("signer") && (lower.includes("list") || lower.includes("who"))) {
      const signers = repo.listSigners(docId);
      const quorum = repo.getDocQuorum(docId);
      if (signers.length === 0) return `No signers yet. Quorum=${quorum}. Join via the /join page.`;
      const list = signers.map((s) => `${s.address} (weight=${s.weight})`).join(", ");
      return `Signers (${signers.length}): ${list}. Quorum=${quorum}`;
    }

    if (lower.includes("schedule") && (lower.includes("list") || lower.includes("active") || lower.includes("show"))) {
      const schedules = repo.listSchedules(docId);
      const active = schedules.filter((s) => s.status === "ACTIVE");
      if (active.length === 0) return "No active schedules. Use: DW SCHEDULE EVERY <N>h: <command>";
      const list = active.map((s) => `${s.schedule_id}: every ${s.interval_hours}h, runs=${s.total_runs}, next=${new Date(s.next_run_at).toISOString().slice(0, 19)}`).join("\n");
      return `Active schedules (${active.length}):\n${list}`;
    }

    if (lower.includes("status") || lower.includes("overview")) {
      const doc = repo.getDoc(docId);
      const q = repo.getDocQuorum(docId);
      const signerCount = repo.listSigners(docId).length;
      const y = repo.getYellowSession(docId);
      const schedules = repo.listSchedules(docId).filter((s) => s.status === "ACTIVE");
      const parts = [`Quorum=${q}, Signers=${signerCount}`];
      if (y) parts.push(`Yellow Session=${y.app_session_id}`);
      if (doc?.ens_name) parts.push(`ENS Policy=${doc.ens_name}`);
      if (schedules.length > 0) parts.push(`Active Schedules=${schedules.length}`);
      return parts.join(", ") + "\nUse: DW STATUS for full details.";
    }
  }

  // --- Natural language to command mapping ---

  // Setup
  if (lower.includes("setup") || lower.includes("initialize") || lower.includes("get started")) {
    return "Use: DW /setup";
  }
  if (lower.includes("status") || lower.includes("info")) {
    return "Use: DW STATUS";
  }

  // Session
  if (lower.includes("session") && lower.includes("create")) return "Use: DW SESSION_CREATE";
  if (lower.includes("settle")) return "Use: DW SETTLE";

  // Quorum
  const quorumMatch = lower.match(/quorum\s+(\d+)/);
  if (quorumMatch) return `Use: DW QUORUM ${quorumMatch[1]}`;

  // Signer add
  const signerMatch = lower.match(/(?:signer\s+add|add\s+signer)\s+(0x[a-f0-9]{40})\s*(?:weight\s+)?(\d+)?/i);
  if (signerMatch) {
    const weight = signerMatch[2] ?? "1";
    return `Use: DW SIGNER_ADD ${signerMatch[1]} WEIGHT ${weight}`;
  }

  // Buy — supports natural language
  const buyMatch = lower.match(/buy\s+([\d.]+)\s*(?:sui|SUI)\s*(?:at|@)\s*([\d.]+)/);
  const buyNatural = lower.match(/buy\s+sui\s+([\d.]+)\s*(?:usdc)?\s*(?:@|at)\s*([\d.]+)/);
  if (buyMatch) return `Use: DW LIMIT_BUY SUI ${buyMatch[1]} USDC @ ${buyMatch[2]}`;
  if (buyNatural) return `Use: DW LIMIT_BUY SUI ${buyNatural[1]} USDC @ ${buyNatural[2]}`;

  // Sell
  const sellMatch = lower.match(/sell\s+([\d.]+)\s*(?:sui|SUI)\s*(?:at|@)\s*([\d.]+)/);
  const sellNatural = lower.match(/sell\s+sui\s+([\d.]+)\s*(?:usdc)?\s*(?:@|at)\s*([\d.]+)/);
  if (sellMatch) return `Use: DW LIMIT_SELL SUI ${sellMatch[1]} USDC @ ${sellMatch[2]}`;
  if (sellNatural) return `Use: DW LIMIT_SELL SUI ${sellNatural[1]} USDC @ ${sellNatural[2]}`;

  // Cancel order
  const cancelMatch = lower.match(/cancel\s+([\w-]+)/);
  if (cancelMatch) return `Use: DW CANCEL ${cancelMatch[1]}`;

  // Payout — enhanced NLP
  const payoutMatch = lower.match(/(?:send|payout|transfer|pay)\s+([\d.]+)\s*usdc\s+(?:to\s+)?(0x[a-f0-9]{40})/i);
  if (payoutMatch) return `Use: DW PAYOUT ${payoutMatch[1]} USDC TO ${payoutMatch[2]}`;

  // Bridge
  const bridgeMatch = lower.match(/bridge\s+([\d.]+)\s*usdc\s+(?:from\s+)?(\w+)\s+(?:to\s+)?(\w+)/i);
  if (bridgeMatch) return `Use: DW BRIDGE ${bridgeMatch[1]} USDC FROM ${bridgeMatch[2]} TO ${bridgeMatch[3]}`;

  // DCA / Schedule
  const dcaMatch = lower.match(/(?:dca|schedule|recurring)\s+(?:buy\s+)?([\d.]+)\s*(?:sui|SUI)\s*(?:every|each)\s+([\d.]+)\s*h(?:ours?)?(?:\s*(?:at|@)\s*([\d.]+))?/i);
  if (dcaMatch) {
    const qty = dcaMatch[1]!;
    const interval = dcaMatch[2]!;
    const price = dcaMatch[3] ?? "MARKET";
    if (price === "MARKET") {
      return `Use: DW SCHEDULE EVERY ${interval}h: LIMIT_BUY SUI ${qty} USDC @ 999999`;
    }
    return `Use: DW SCHEDULE EVERY ${interval}h: LIMIT_BUY SUI ${qty} USDC @ ${price}`;
  }

  const scheduleMatch = lower.match(/schedule\s+every\s+([\d.]+)\s*h/i);
  if (scheduleMatch) return `Syntax: DW SCHEDULE EVERY ${scheduleMatch[1]}h: <any DW command>`;

  // Cancel schedule
  const cancelSchedMatch = lower.match(/cancel\s+schedule\s+(sched_\w+)/i);
  if (cancelSchedMatch) return `Use: DW UNSCHEDULE ${cancelSchedMatch[1]}`;

  // ENS Policy
  const policyMatch = lower.match(/policy\s+(?:ens\s+)?([a-z0-9-]+\.eth)/i);
  if (policyMatch) return `Use: DW POLICY ENS ${policyMatch[1]}`;

  // WalletConnect
  if (lower.includes("walletconnect") || lower.includes("wc:")) {
    const uriMatch = text.match(/(wc:[^\s]+)/i);
    if (uriMatch) return `Use: DW CONNECT ${uriMatch[1]}`;
    return "Paste WalletConnect URI: DW CONNECT wc:...";
  }

  // Help
  if (lower.includes("help") || lower.includes("commands") || lower.includes("what can")) {
    return [
      "Available commands:",
      "• DW /setup — Initialize wallets",
      "• DW STATUS — Show status",
      "• DW LIMIT_BUY SUI <qty> USDC @ <price>",
      "• DW LIMIT_SELL SUI <qty> USDC @ <price>",
      "• DW MARKET_BUY SUI <qty> — Market buy",
      "• DW MARKET_SELL SUI <qty> — Market sell",
      "• DW DEPOSIT <coin> <amount> — Deposit to DeepBook",
      "• DW WITHDRAW <coin> <amount> — Withdraw from DeepBook",
      "• DW CANCEL <orderId>",
      "• DW SETTLE — Withdraw filled orders",
      "• DW PAYOUT <amt> USDC TO <addr>",
      "• DW BRIDGE <amt> USDC FROM <chain> TO <chain>",
      "• DW SCHEDULE EVERY <N>h: <command>",
      "• DW UNSCHEDULE <schedId> (alias: CANCEL_SCHEDULE)",
      "• DW SESSION_CREATE — Yellow state channel",
      "• DW SESSION_CLOSE — Close Yellow session",
      "• DW SESSION_STATUS — Yellow session info",
      "• DW ALERT <coin> BELOW <amount> (alias: ALERT_THRESHOLD)",
      "• DW AUTO_REBALANCE ON|OFF",
      "• DW POLICY ENS <name.eth>",
      "• DW CONNECT <wc:uri>",
      "Prefix with !execute to insert into Commands table."
    ].join("\n");
  }

  return "I can help! Try: 'buy 10 SUI at 1.5', 'send 50 USDC to 0x...', 'bridge 100 USDC from arc to sui', 'deposit 10 SUI', 'market buy 5 SUI', 'schedule DCA buy 10 SUI every 6h', or type 'help'.";
}
