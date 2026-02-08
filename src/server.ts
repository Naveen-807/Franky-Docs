import http from "node:http";
import { randomBytes } from "node:crypto";
import type { docs_v1 } from "googleapis";
import { keccak256, recoverMessageAddress } from "viem";
import { Repo } from "./db/repo.js";
import { parseCommand } from "./core/commands.js";
import { loadDocWalletTables, readCommandsTable, readConfig, updateCommandsRowCells, writeConfigValue, appendAuditRow } from "./google/docwallet.js";
import { decryptWithMasterKey, encryptWithMasterKey } from "./wallet/crypto.js";
import { generateEvmWallet } from "./wallet/evm.js";
import { NitroRpcYellowClient } from "./integrations/yellow.js";
import type { WalletConnectService } from "./integrations/walletconnect.js";
import { requestTestnetSui, requestArcTestnetUsdc } from "./integrations/sui-faucet.js";

type ServerDeps = {
  docs: docs_v1.Docs;
  repo: Repo;
  masterKey: string;
  port: number;
  publicBaseUrl: string;
  yellow?: NitroRpcYellowClient;
  yellowApplicationName?: string;
  yellowAsset?: string;
  walletconnect?: WalletConnectService;
  demoMode?: boolean;
  circleApiKey?: string;
  suiFaucetUrl?: string;
};

type Session = { docId: string; signerAddress: `0x${string}`; createdAt: number };
type PendingYellowJoin = {
  docId: string;
  address: `0x${string}`;
  weight: number;
  sessionKeyAddress: `0x${string}`;
  sessionKeyPrivateKeyHex: `0x${string}`;
  application: string;
  scope: string;
  allowances: Array<{ asset: string; amount: string }>;
  expiresAt: number;
  challengeMessage: string;
  createdAt: number;
};

export function startServer(deps: ServerDeps) {
  const sessions = new Map<string, Session>();
  const pendingYellowJoins = new Map<string, PendingYellowJoin>();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/") {
        const docs = deps.repo.listDocs();
        const rows = docs.length > 0
          ? docs.map((d) => {
              const name = escapeHtml(d.name ?? d.doc_id);
              const shortId = d.doc_id.length > 20 ? d.doc_id.slice(0, 20) + "…" : d.doc_id;
              const activityUrl = `${deps.publicBaseUrl}/activity/${encodeURIComponent(d.doc_id)}`;
              const sessionsUrl = `${deps.publicBaseUrl}/sessions/${encodeURIComponent(d.doc_id)}`;
              const evmAddr = d.evm_address ? escapeHtml(d.evm_address) : null;
              const suiAddr = d.sui_address ? escapeHtml(d.sui_address) : null;
              const walletSection = (evmAddr || suiAddr)
                ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
  ${evmAddr ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
    <span style="font-size:.75rem;font-weight:600;color:#0052FF;min-width:28px">ARC</span>
    <code style="font-size:.72rem;color:#475569;word-break:break-all">${evmAddr}</code>
    <button class="btn btn-outline btn-sm" onclick="fundWallet('${d.doc_id}','arc')" style="margin-left:auto;white-space:nowrap;font-size:.7rem;padding:2px 8px">💰 Fund USDC</button>
  </div>` : ""}
  ${suiAddr ? `<div style="display:flex;align-items:center;gap:6px">
    <span style="font-size:.75rem;font-weight:600;color:#6FBCF0;min-width:28px">SUI</span>
    <code style="font-size:.72rem;color:#475569;word-break:break-all">${suiAddr}</code>
    <button class="btn btn-outline btn-sm" onclick="fundWallet('${d.doc_id}','sui')" style="margin-left:auto;white-space:nowrap;font-size:.7rem;padding:2px 8px">💰 Fund SUI</button>
  </div>` : ""}
  <div id="fund-status-${d.doc_id.slice(0, 8)}" style="font-size:.75rem;margin-top:4px;color:#64748b"></div>
</div>`
                : "";
              return `<div class="card" style="margin-bottom:14px">
  <div class="card-header">
    <div>
      <h3 style="margin:0">${name}</h3>
      <div class="card-meta"><code>${escapeHtml(shortId)}</code></div>
    </div>
    <span class="badge badge-green">● Active</span>
  </div>
  <div class="row">
    <a href="${activityUrl}" class="btn btn-primary btn-sm">Activity</a>
    <a href="${sessionsUrl}" class="btn btn-ghost btn-sm">Sessions</a>
  </div>
  ${walletSection}
</div>`;
            }).join("\n")
          : `<div class="empty"><div class="empty-icon">📄</div><p>No docs discovered yet.<br/>Create a Google Doc and add the FrankyDocs template.</p></div>`;

        return sendHtml(
          res,
          "Dashboard",
          `<div class="spacer-sm"></div>
<div class="row" style="justify-content:space-between;margin-bottom:20px">
  <div>
    <h1>FrankyDocs Treasury</h1>
    <p style="margin-top:4px">Multi-chain DeFi treasury powered by Google Docs</p>
  </div>
  <span class="badge badge-blue">${docs.length} Doc${docs.length !== 1 ? "s" : ""}</span>
</div>

<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-bottom:24px">
  <div class="card mini" style="border-left:3px solid #FFD700">
    <div class="kpi-label">Yellow Network</div>
    <div style="font-size:.95rem;font-weight:600;color:var(--gray-900)">State Channels</div>
    <div class="card-meta">Off-chain gasless ytest.usd payments</div>
    <div class="badge badge-ok" style="margin-top:6px">NitroRPC/0.4 · ytest.usd</div>
  </div>
  <div class="card mini" style="border-left:3px solid #0052FF">
    <div class="kpi-label">Arc + Circle</div>
    <div style="font-size:.95rem;font-weight:600;color:var(--gray-900)">USDC Treasury</div>
    <div class="card-meta">Dev wallets + CCTP bridge</div>
    <div class="badge badge-ok" style="margin-top:6px">Chain 5042002</div>
  </div>
  <div class="card mini" style="border-left:3px solid #6FBCF0">
    <div class="kpi-label">Sui DeepBook V3</div>
    <div style="font-size:.95rem;font-weight:600;color:var(--gray-900)">CLOB Trading</div>
    <div class="card-meta">Limit, market, stop-loss</div>
    <div class="badge badge-ok" style="margin-top:6px">PTB Orders</div>
  </div>
</div>

<div class="card" style="margin-bottom:20px;border:2px solid #e2e8f0;background:linear-gradient(135deg,#f8fafc 0%,#f1f5f9 100%)">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <span style="font-size:1.3rem">💰</span>
    <div style="font-weight:700;font-size:1.05rem;color:var(--gray-900)">Unified Treasury Flow</div>
    <span class="badge badge-blue" style="margin-left:auto">3 Chains · 1 Treasury</span>
  </div>
  <div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:8px;align-items:center;text-align:center;font-size:.82rem">
    <div style="background:#FFF8E1;border-radius:10px;padding:10px 8px;border:1px solid #FFD700">
      <div style="font-weight:700;color:#B8860B">Yellow</div>
      <div style="color:#666;margin-top:2px">ytest.usd</div>
      <div style="font-size:.7rem;color:#999;margin-top:2px">Off-chain · Gasless</div>
    </div>
    <div style="font-size:1.2rem;color:#94a3b8">⇄</div>
    <div style="background:#EFF6FF;border-radius:10px;padding:10px 8px;border:1px solid #0052FF">
      <div style="font-weight:700;color:#0052FF">Arc</div>
      <div style="color:#666;margin-top:2px">USDC (ERC-20)</div>
      <div style="font-size:.7rem;color:#999;margin-top:2px">Circle CCTP · Chain 5042002</div>
    </div>
    <div style="font-size:1.2rem;color:#94a3b8">⇄</div>
    <div style="background:#F0F9FF;border-radius:10px;padding:10px 8px;border:1px solid #6FBCF0">
      <div style="font-weight:700;color:#2196F3">Sui</div>
      <div style="color:#666;margin-top:2px">SUI + DBUSDC</div>
      <div style="font-size:.7rem;color:#999;margin-top:2px">DeepBook V3 · CLOB</div>
    </div>
  </div>
  <div style="text-align:center;margin-top:10px;font-size:.78rem;color:#64748b">
    <code>DW TREASURY</code> — View all balances&nbsp;&nbsp;|&nbsp;&nbsp;<code>DW REBALANCE &lt;amt&gt; FROM &lt;chain&gt; TO &lt;chain&gt;</code> — Move capital
  </div>
</div>

<div class="card" style="margin-bottom:20px;border:2px solid #e8f5e9;background:linear-gradient(135deg,#f1f8e9 0%,#e8f5e9 100%)">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <span style="font-size:1.3rem">🔒</span>
    <div style="font-weight:700;font-size:1.05rem;color:var(--gray-900)">Wallet Abstraction — No Extensions Needed</div>
    <span class="badge badge-green" style="margin-left:auto">Circle SCA</span>
  </div>
  <div style="font-size:.88rem;color:var(--gray-700);line-height:1.6">
    This treasury uses <strong>Circle developer-controlled wallets</strong> (Smart Contract Accounts). No browser extension or seed phrase needed.
    Your funds are secured by Circle's enterprise infrastructure with built-in gasless transactions.
  </div>
</div>

<div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border:none">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
    <span style="font-size:1.5rem">🌟</span>
    <div>
      <div style="font-weight:700;font-size:1.1rem">How It Works</div>
      <div style="opacity:.8;font-size:.88rem">Type commands in a Google Doc → Approve with one click → Execute on-chain</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
    <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px 14px">
      <div style="font-size:.75rem;opacity:.7;text-transform:uppercase;letter-spacing:.04em">Step 1</div>
      <div style="font-size:.9rem;margin-top:2px">Type a command in the Google Doc — no wallet needed</div>
    </div>
    <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px 14px">
      <div style="font-size:.75rem;opacity:.7;text-transform:uppercase;letter-spacing:.04em">Step 2</div>
      <div style="font-size:.9rem;margin-top:2px">Commands auto-execute — wallets created on first use</div>
    </div>
    <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px 14px">
      <div style="font-size:.75rem;opacity:.7;text-transform:uppercase;letter-spacing:.04em">Step 3</div>
      <div style="font-size:.9rem;margin-top:2px">Results written back to the Doc — balances auto-refresh</div>
    </div>
  </div>
</div>

${rows}

<script>
async function fundWallet(docId, chain) {
  const statusEl = document.getElementById('fund-status-' + docId.slice(0, 8));
  if (statusEl) statusEl.textContent = 'Requesting ' + chain.toUpperCase() + ' funds…';
  try {
    const res = await fetch('/api/fund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ docId, chain })
    });
    const data = await res.json();
    if (statusEl) {
      statusEl.style.color = data.ok ? '#198754' : '#dc3545';
      statusEl.textContent = data.message || (data.ok ? 'Funded!' : 'Failed');
    }
  } catch (e) {
    if (statusEl) { statusEl.style.color = '#dc3545'; statusEl.textContent = 'Error: ' + e.message; }
  }
}
</script>`
        );
      }

      const activityPageMatch = matchPath(url.pathname, ["activity", ":docId"]);
      if (req.method === "GET" && activityPageMatch) {
        const docId = decodeURIComponent(activityPageMatch.docId);
        return sendHtml(res, "Activity", activityPageHtml({ docId }));
      }

      // API: List docs with full integration status
      if (req.method === "GET" && url.pathname === "/api/docs") {
        const allDocs = deps.repo.listDocs();
        const docData = allDocs.map((d) => {
          const yellowSession = deps.repo.getYellowSession(d.doc_id);
          const circleW = deps.repo.getCircleWallet(d.doc_id);
          const signers = deps.repo.listSigners(d.doc_id);
          const quorum = deps.repo.getDocQuorum(d.doc_id);
          const stats = deps.repo.getTradeStats(d.doc_id);
          const condOrders = deps.repo.listActiveConditionalOrders(d.doc_id);
          const schedules = deps.repo.listSchedules(d.doc_id).filter((s) => s.status === "ACTIVE");
          const cachedPrice = deps.repo.getPrice("SUI/USDC");
          return {
            docId: d.doc_id,
            name: d.name,
            evmAddress: d.evm_address,
            suiAddress: d.sui_address,
            integrations: {
              yellow: {
                enabled: !!deps.yellow,
                sessionId: yellowSession?.app_session_id ?? null,
                sessionVersion: yellowSession?.version ?? 0,
                sessionStatus: yellowSession?.status ?? "NONE",
                protocol: "NitroRPC/0.4"
              },
              arc: {
                enabled: true,
                chainId: 5042002,
                circleWalletId: circleW?.wallet_id ?? null,
                circleWalletAddress: circleW?.wallet_address ?? null
              },
              deepbook: {
                enabled: true,
                pool: "SUI_DBUSDC",
                cachedPrice: cachedPrice?.mid_price ?? null,
                spread: cachedPrice && cachedPrice.mid_price > 0
                  ? ((cachedPrice.ask - cachedPrice.bid) / cachedPrice.mid_price * 100)
                  : null
              },
            },
            signers: signers.length,
            quorum,
            trading: {
              pnl: stats.netPnl,
              totalBuys: stats.totalBuys,
              totalSells: stats.totalSells,
              activeStopLoss: condOrders.filter(o => o.type === "STOP_LOSS").length,
              activeTakeProfit: condOrders.filter(o => o.type === "TAKE_PROFIT").length,
              activeSchedules: schedules.length
            }
          };
        });
        return sendJson(res, 200, { ok: true, docs: docData });
      }

      const apiActivityMatch = matchPath(url.pathname, ["api", "activity", ":docId"]);
      if (req.method === "GET" && apiActivityMatch) {
        const docId = decodeURIComponent(apiActivityMatch.docId);
        const cmds = deps.repo.listRecentCommands(docId, 50).map((c) => ({
          cmdId: c.cmd_id,
          raw: c.raw_command,
          status: c.status,
          result: c.result_text,
          error: c.error_text,
          updatedAt: c.updated_at
        }));
        return sendJson(res, 200, { ok: true, commands: cmds });
      }

      const apiCmdMatch = matchPath(url.pathname, ["api", "cmd", ":docId", ":cmdId"]);
      if (req.method === "GET" && apiCmdMatch) {
        const docId = decodeURIComponent(apiCmdMatch.docId);
        const cmdId = decodeURIComponent(apiCmdMatch.cmdId);
        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Not found" });
        const signers = deps.repo.listSigners(docId);
        const weights = new Map(signers.map((s) => [s.address.toLowerCase(), s.weight]));
        const approvals = deps.repo.listCommandApprovals({ docId, cmdId });
        const approvedWeight = approvals
          .filter((a) => a.decision === "APPROVE")
          .reduce((sum, a) => sum + (weights.get(a.signer_address.toLowerCase()) ?? 0), 0);
        const quorum = deps.repo.getDocQuorum(docId);
        const yellowSession = deps.repo.getYellowSession(docId);
        const approvalMode = deps.yellow && yellowSession ? "YELLOW" : "WEB";
        return sendJson(res, 200, {
          ok: true,
          cmd: {
            cmdId: cmd.cmd_id,
            raw: cmd.raw_command,
            status: cmd.status,
            result: cmd.result_text,
            error: cmd.error_text
          },
          actionSummary: summarizeCommand(cmd.raw_command),
          approvals: approvals.map((a) => ({ signer: a.signer_address, decision: a.decision, createdAt: a.created_at })),
          approvedWeight,
          quorum,
          signerCount: signers.length,
          approvalMode
        });
      }

      const apiMetricsMatch = matchPath(url.pathname, ["api", "metrics", ":docId"]);
      if (req.method === "GET" && apiMetricsMatch) {
        const docId = decodeURIComponent(apiMetricsMatch.docId);
        const approvalsTotal = deps.repo.getDocCounter(docId, "approvals_total");
        const approvalTxAvoided = deps.repo.getDocCounter(docId, "approval_tx_avoided");
        const gasPerApproval = Number(deps.repo.getDocConfig(docId, "signer_approval_gas_paid") ?? "0.003");
        const lastApproval = deps.repo.getDocConfig(docId, "last_approval") ?? "";
        const lastProposal = deps.repo.getDocConfig(docId, "last_proposal") ?? "";
        return sendJson(res, 200, {
          ok: true,
          metrics: {
            approvalsTotal,
            approvalTxAvoided,
            signerApprovalGasPaid: Number.isFinite(gasPerApproval) ? gasPerApproval : 0,
            lastApproval,
            lastProposal
          }
        });
      }

      // Legacy join/signers routes redirect to activity
      const joinMatch = matchPath(url.pathname, ["join", ":docId"]);
      if (req.method === "GET" && joinMatch) {
        const docId = decodeURIComponent(joinMatch.docId);
        res.writeHead(302, { Location: `/activity/${encodeURIComponent(docId)}` });
        res.end();
        return;
      }
      const signersMatch = matchPath(url.pathname, ["signers", ":docId"]);
      if (req.method === "GET" && signersMatch) {
        const docId = decodeURIComponent(signersMatch.docId);
        res.writeHead(302, { Location: `/activity/${encodeURIComponent(docId)}` });
        res.end();
        return;
      }

      const cmdMatch = matchPath(url.pathname, ["cmd", ":docId", ":cmdId"]);
      if (req.method === "GET" && cmdMatch) {
        const docId = decodeURIComponent(cmdMatch.docId);
        const cmdId = decodeURIComponent(cmdMatch.cmdId);

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendHtml(res, "Not found", `<h1>Command not found</h1>`);

        return sendHtml(res, `Command ${cmdId}`, cmdPageHtml({ docId, cmdId, signerAddress: "", raw: cmd.raw_command, status: cmd.status }));
      }

      // Legacy join/auth endpoints — single-user mode, no external signers needed
      if (req.method === "POST" && (url.pathname === "/api/join/start" || url.pathname === "/api/join/finish" || url.pathname === "/api/quick-auth")) {
        return sendJson(res, 410, { ok: false, error: "FrankyDocs runs in single-user mode. Approve commands directly in the Google Doc by setting STATUS to APPROVED." });
      }

      // --- Quick approve: one-click approval without wallet ---
      if (req.method === "POST" && url.pathname === "/api/cmd/demo-approve") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        const cmdId = String(body.cmdId ?? "");
        if (!docId || !cmdId) return sendJson(res, 400, { ok: false, error: "Missing docId/cmdId" });
        if (!deps.demoMode) return sendJson(res, 403, { ok: false, error: "Quick-approve is not enabled" });

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Command not found" });
        if (cmd.status !== "PENDING_APPROVAL") return sendJson(res, 409, { ok: false, error: `Already ${cmd.status}` });

        deps.repo.setCommandStatus(cmdId, "APPROVED", { errorText: null });
        await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId, updates: { status: "APPROVED", error: "", result: "Approved" } });
        await bestEffortAudit(deps.docs, docId, `${cmdId} APPROVED (quick-approve)`);
        return sendJson(res, 200, { ok: true, status: "APPROVED" });
      }

      // --- Quick reject: one-click rejection without wallet ---
      if (req.method === "POST" && url.pathname === "/api/cmd/demo-reject") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        const cmdId = String(body.cmdId ?? "");
        if (!docId || !cmdId) return sendJson(res, 400, { ok: false, error: "Missing docId/cmdId" });
        if (!deps.demoMode) return sendJson(res, 403, { ok: false, error: "Quick-reject is not enabled" });

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Command not found" });
        if (cmd.status !== "PENDING_APPROVAL") return sendJson(res, 409, { ok: false, error: `Already ${cmd.status}` });

        deps.repo.setCommandStatus(cmdId, "REJECTED", { errorText: "Rejected by user" });
        await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId, updates: { status: "REJECTED", error: "Rejected by user", result: "" } });
        await bestEffortAudit(deps.docs, docId, `${cmdId} REJECTED`);
        return sendJson(res, 200, { ok: true, status: "REJECTED" });
      }

      // --- Bulk approve all PENDING_APPROVAL commands for a doc ---
      if (req.method === "POST" && url.pathname === "/api/cmd/demo-approve-all") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        if (!docId) return sendJson(res, 400, { ok: false, error: "Missing docId" });
        if (!deps.demoMode) return sendJson(res, 403, { ok: false, error: "Bulk approve is not enabled" });

        const cmds = deps.repo.listRecentCommands(docId, 100).filter(c => c.status === "PENDING_APPROVAL");
        let approved = 0;
        for (const cmd of cmds) {
          deps.repo.setCommandStatus(cmd.cmd_id, "APPROVED", { errorText: null });
          await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId: cmd.cmd_id, updates: { status: "APPROVED", error: "", result: "Approved" } });
          approved++;
        }
        await bestEffortAudit(deps.docs, docId, `BULK_APPROVE: ${approved} commands approved`);
        return sendJson(res, 200, { ok: true, approved, total: cmds.length });
      }

      // Single-user decision endpoint — no signer session required
      if (req.method === "POST" && url.pathname === "/api/cmd/decision") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        const cmdId = String(body.cmdId ?? "");
        const decision = String(body.decision ?? "").toUpperCase();
        if (!docId || !cmdId) return sendJson(res, 400, { ok: false, error: "Missing docId/cmdId" });
        if (decision !== "APPROVE" && decision !== "REJECT") return sendJson(res, 400, { ok: false, error: "Invalid decision" });

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Command not found" });
        if (cmd.status !== "PENDING_APPROVAL") return sendJson(res, 409, { ok: false, error: `Cannot decide when status=${cmd.status}` });

        if (decision === "REJECT") {
          deps.repo.setCommandStatus(cmdId, "REJECTED", { errorText: null });
          await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId, updates: { status: "REJECTED", error: "Rejected by owner" } });
          await bestEffortAudit(deps.docs, docId, `${cmdId} REJECTED by owner`);
          return sendJson(res, 200, { ok: true, status: "REJECTED" });
        }

        // APPROVE — single-user, no quorum check needed
        deps.repo.incrementDocCounter(docId, "approvals_total", 1);
        deps.repo.incrementDocCounter(docId, "approval_tx_avoided", 1);
        deps.repo.setDocConfig(docId, "last_approval", new Date().toISOString());
        try { await bestEffortSyncMetricsToDoc({ docs: deps.docs, repo: deps.repo, docId }); } catch { /* best effort */ }

        const approvalTxAvoided = deps.repo.getDocCounter(docId, "approval_tx_avoided");
        const gasPerApproval = Number(deps.repo.getDocConfig(docId, "signer_approval_gas_paid") ?? "0.003");
        const gasSavedEth = ((approvalTxAvoided) * gasPerApproval).toFixed(4);
        let finalResult = `Owner-approved · Gasless (saved ~${gasSavedEth} ETH)`;

        // Yellow gasless approval if session exists
        const yellow = deps.yellow;
        const yellowSession = deps.repo.getYellowSession(docId);
        const parsed = safeParseParsedJson(cmd.parsed_json);
        const isSessionCreate = parsed?.type === "SESSION_CREATE";
        if (yellow && yellowSession && !isSessionCreate) {
          try {
            const nextVersion = (yellowSession.version ?? 0) + 1;
            const currentAllocations = JSON.parse(yellowSession.allocations_json || "[]");
            const out = await yellow.submitGaslessApproval({
              signerPrivateKeysHex: [],
              appSessionId: yellowSession.app_session_id,
              version: nextVersion,
              cmdId,
              command: cmd.raw_command,
              approver: "owner",
              allocations: currentAllocations
            });
            deps.repo.setYellowSessionVersion({ docId, version: out.version, status: "OPEN" });
            finalResult += ` · Yellow v${out.version}`;
            await bestEffortAudit(deps.docs, docId, `${cmdId} Yellow gasless approval v${out.version}`);
          } catch (e: any) {
            console.warn(`[server] Yellow approval skipped: ${e.message}`);
          }
        }

        deps.repo.setCommandStatus(cmdId, "APPROVED", { errorText: null });
        await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId, updates: { status: "APPROVED", error: "", result: finalResult } });
        await bestEffortAudit(deps.docs, docId, `${cmdId} APPROVED by owner`);
        return sendJson(res, 200, { ok: true, status: "APPROVED" });
      }

      // --- WalletConnect Session Management ---

      const sessionsPageMatch = matchPath(url.pathname, ["sessions", ":docId"]);
      if (req.method === "GET" && sessionsPageMatch) {
        const docId = decodeURIComponent(sessionsPageMatch.docId);
        return sendHtml(res, "WC Sessions", walletConnectSessionsPageHtml({ docId, publicBaseUrl: deps.publicBaseUrl }));
      }

      const apiSessionsMatch = matchPath(url.pathname, ["api", "sessions", ":docId"]);
      if (req.method === "GET" && apiSessionsMatch) {
        const docId = decodeURIComponent(apiSessionsMatch.docId);
        const wcSessions = deps.repo.listWalletConnectSessions(docId);
        const pendingRequests = deps.repo.listPendingWalletConnectRequests(docId);
        const schedules = deps.repo.listSchedules(docId);
        return sendJson(res, 200, {
          ok: true,
          sessions: wcSessions.map((s) => ({
            topic: s.topic,
            peerName: s.peer_name,
            peerUrl: s.peer_url,
            chains: s.chains,
            status: s.status,
            createdAt: s.created_at,
            updatedAt: s.updated_at
          })),
          pendingRequests: pendingRequests.map((r) => ({
            topic: r.topic,
            requestId: r.request_id,
            method: r.method,
            cmdId: r.cmd_id,
            status: r.status,
            createdAt: r.created_at
          })),
          schedules: schedules.map((s) => ({
            scheduleId: s.schedule_id,
            intervalHours: s.interval_hours,
            innerCommand: s.inner_command,
            nextRunAt: s.next_run_at,
            status: s.status,
            totalRuns: s.total_runs,
            lastRunAt: s.last_run_at
          }))
        });
      }

      const apiDisconnectMatch = matchPath(url.pathname, ["api", "sessions", ":docId", "disconnect"]);
      if (req.method === "POST" && apiDisconnectMatch) {
        const docId = decodeURIComponent(apiDisconnectMatch.docId);
        const body = await readJsonBody(req);
        const topic = String(body.topic ?? "");
        if (!topic) return sendJson(res, 400, { ok: false, error: "Missing topic" });

        const session = deps.repo.getWalletConnectSession(topic);
        if (!session || session.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Session not found" });

        deps.repo.setWalletConnectSessionStatus(topic, "DISCONNECTED");

        if (deps.walletconnect) {
          try {
            // Reject any pending requests for this session
            const pending = deps.repo.listPendingWalletConnectRequests(docId);
            for (const r of pending) {
              if (r.topic === topic) {
                await deps.walletconnect.respondError(r.topic, r.request_id, "Session disconnected by user");
                deps.repo.setWalletConnectRequestStatus({ topic: r.topic, requestId: r.request_id, status: "REJECTED" });
              }
            }
          } catch { /* ignore */ }
        }

        return sendJson(res, 200, { ok: true, status: "DISCONNECTED" });
      }

      // --- Fund wallet: trigger faucet for Arc USDC or Sui ---
      if (req.method === "POST" && url.pathname === "/api/fund") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        const chain = String(body.chain ?? "").toLowerCase();
        if (!docId || !chain) return sendJson(res, 400, { ok: false, message: "Missing docId or chain" });
        if (chain !== "arc" && chain !== "sui") return sendJson(res, 400, { ok: false, message: "Chain must be 'arc' or 'sui'" });

        const doc = deps.repo.getDoc(docId);
        if (!doc) return sendJson(res, 404, { ok: false, message: "Doc not found" });

        if (chain === "arc") {
          const evmAddr = doc.evm_address;
          if (!evmAddr) return sendJson(res, 400, { ok: false, message: "No EVM address for this doc. Run a command first to auto-create wallets." });
          const result = await requestArcTestnetUsdc({ address: evmAddr, circleApiKey: deps.circleApiKey });
          return sendJson(res, result.ok ? 200 : 502, { ok: result.ok, message: result.message });
        }

        if (chain === "sui") {
          const suiAddr = doc.sui_address;
          if (!suiAddr) return sendJson(res, 400, { ok: false, message: "No SUI address for this doc. Run a command first to auto-create wallets." });
          const result = await requestTestnetSui({ address: suiAddr, faucetUrl: deps.suiFaucetUrl });
          return sendJson(res, result.ok ? 200 : 502, { ok: result.ok, message: result.message });
        }
      }

      res.statusCode = 404;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Not found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(`Internal error: ${msg}`);
    }
  });

  server.listen(deps.port, () => {
    console.log(`[http] listening on http://localhost:${deps.port}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[http] Port ${deps.port} already in use — retrying in 3s…`);
      setTimeout(() => {
        server.close();
        server.listen(deps.port);
      }, 3_000);
    } else {
      console.error("[http] Server error:", err.message);
    }
  });
  return {
    url: deps.publicBaseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

// bestEffortSyncSignersToDoc removed — single-user mode, no external signers

async function bestEffortUpdateCommandRow(params: {
  docs: docs_v1.Docs;
  docId: string;
  cmdId: string;
  updates: { status?: string; result?: string; error?: string };
}) {
  const { docs, docId, cmdId, updates } = params;
  try {
    const tables = await loadDocWalletTables({ docs, docId });
    const rows = readCommandsTable(tables.commands.table);
    const row = rows.find((r) => r.id === cmdId);
    if (!row) return;
    await updateCommandsRowCells({ docs, docId, commandsTable: tables.commands.table, rowIndex: row.rowIndex, updates: updates as any });
  } catch {
    // ignore
  }
}

async function bestEffortAudit(docs: docs_v1.Docs, docId: string, message: string) {
  try {
    await appendAuditRow({ docs, docId, timestampIso: new Date().toISOString(), message });
  } catch {
    // ignore
  }
}

async function bestEffortSyncMetricsToDoc(params: { docs: docs_v1.Docs; repo: Repo; docId: string }) {
  const { docs, repo, docId } = params;
  // Helper: write one config value then reload to keep indices fresh
  const safeWrite = async (key: string, value: string) => {
    const t = await loadDocWalletTables({ docs, docId });
    const cm = readConfig(t.config.table);
    if (cm[key]) {
      await writeConfigValue({ docs, docId, configTable: t.config.table, key, value });
    }
  };
  try {
    const approvalsTotal = repo.getDocCounter(docId, "approvals_total");
    const approvalTxAvoided = repo.getDocCounter(docId, "approval_tx_avoided");
    const lastApproval = repo.getDocConfig(docId, "last_approval");
    const lastProposal = repo.getDocConfig(docId, "last_proposal");

    await safeWrite("APPROVALS_TOTAL", String(approvalsTotal));
    await safeWrite("EST_APPROVAL_TX_AVOIDED", String(approvalTxAvoided));
    if (lastApproval) await safeWrite("LAST_APPROVAL", lastApproval);
    if (lastProposal) await safeWrite("LAST_PROPOSAL", lastProposal);
  } catch {
    // ignore
  }
}

function matchPath(pathname: string, parts: string[]): Record<string, string> | null {
  const segs = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (segs.length !== parts.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    const s = segs[i]!;
    if (p.startsWith(":")) out[p.slice(1)] = s;
    else if (p !== s) return null;
  }
  return out;
}

function randomToken(): string {
  return randomBytes(24).toString("base64url");
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = rest.join("=");
  }
  return out;
}

function getSession(req: http.IncomingMessage, sessions: Map<string, Session>): Session | null {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies["dw_session"];
  if (!token) return null;
  return sessions.get(token) ?? null;
}

function setCookie(res: http.ServerResponse, name: string, value: string) {
  res.setHeader("set-cookie", `${name}=${value}; Path=/; HttpOnly; SameSite=Lax`);
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, title: string, body: string) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)} — FrankyDocs</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🟢</text></svg>"/>
<style>
:root{
  --primary:#0d6efd;
  --primary-hover:#0b5ed7;
  --primary-light:#e7f1ff;
  --success:#198754;
  --success-light:#d1e7dd;
  --warning:#fd7e14;
  --warning-light:#fff3cd;
  --danger:#dc3545;
  --danger-light:#f8d7da;
  --gray-50:#f8fafc;
  --gray-100:#f1f5f9;
  --gray-200:#e2e8f0;
  --gray-300:#cbd5e1;
  --gray-500:#64748b;
  --gray-700:#334155;
  --gray-900:#0f172a;
  --card:#ffffff;
  --radius:12px;
  --radius-sm:8px;
  --shadow:0 1px 3px rgba(0,0,0,.06),0 1px 2px rgba(0,0,0,.04);
  --shadow-md:0 4px 6px -1px rgba(0,0,0,.07),0 2px 4px -2px rgba(0,0,0,.05);
  --shadow-lg:0 10px 15px -3px rgba(0,0,0,.08),0 4px 6px -4px rgba(0,0,0,.04);
  --transition:all .15s ease;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--gray-50);color:var(--gray-900);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:15px;line-height:1.6;
  -webkit-font-smoothing:antialiased;
}

/* === HEADER === */
.topbar{
  background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);
  color:#fff;padding:0 24px;height:56px;
  display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:100;
  box-shadow:0 1px 3px rgba(0,0,0,.2);
}
.topbar-brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.1rem;text-decoration:none;color:#fff}
.topbar-brand span{font-size:1.3rem}
.topbar-nav{display:flex;gap:6px}
.topbar-nav a{
  color:rgba(255,255,255,.7);text-decoration:none;padding:6px 14px;
  border-radius:var(--radius-sm);font-size:.875rem;font-weight:500;
  transition:var(--transition);
}
.topbar-nav a:hover,.topbar-nav a.active{color:#fff;background:rgba(255,255,255,.1)}

/* === LAYOUT === */
.container{max-width:1060px;margin:0 auto;padding:28px 20px}
h1{font-size:1.5rem;font-weight:700;letter-spacing:-.02em;color:var(--gray-900)}
h2{font-size:1.15rem;font-weight:600;color:var(--gray-700);margin:20px 0 10px}
h3{font-size:1rem;font-weight:600;color:var(--gray-700)}
p{color:var(--gray-700)}

/* === CARD === */
.card{
  background:var(--card);border:1px solid var(--gray-200);
  border-radius:var(--radius);padding:24px;
  box-shadow:var(--shadow);transition:var(--transition);
}
.card:hover{box-shadow:var(--shadow-md)}
.card.mini{padding:16px 18px}
.card-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.card-header h1{margin:0}
.card-meta{color:var(--gray-500);font-size:.85rem}

/* === FLEX / GRID === */
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.gap-sm{gap:8px}
.gap-lg{gap:20px}
.spacer{height:16px}
.spacer-sm{height:10px}
.spacer-lg{height:24px}

/* === BUTTONS === */
.btn{
  display:inline-flex;align-items:center;gap:6px;
  padding:10px 20px;border-radius:var(--radius-sm);border:none;
  font-size:.9rem;font-weight:600;cursor:pointer;
  transition:var(--transition);text-decoration:none;
}
.btn-primary{background:var(--primary);color:#fff}
.btn-primary:hover{background:var(--primary-hover);box-shadow:var(--shadow-md)}
.btn-outline{background:transparent;border:1.5px solid var(--primary);color:var(--primary)}
.btn-outline:hover{background:var(--primary-light)}
.btn-ghost{background:transparent;border:1.5px solid var(--gray-200);color:var(--gray-700)}
.btn-ghost:hover{border-color:var(--gray-300);background:var(--gray-50)}
.btn-danger{background:transparent;border:1.5px solid var(--danger);color:var(--danger)}
.btn-danger:hover{background:var(--danger-light)}
.btn-sm{padding:6px 14px;font-size:.82rem}

/* === INPUT === */
.input{
  padding:10px 14px;border-radius:var(--radius-sm);
  border:1.5px solid var(--gray-200);font-size:.9rem;
  transition:var(--transition);outline:none;min-width:120px;
}
.input:focus{border-color:var(--primary);box-shadow:0 0 0 3px rgba(13,110,253,.12)}

/* === BADGES === */
.badge{
  display:inline-flex;align-items:center;gap:4px;
  padding:3px 10px;border-radius:999px;font-size:.78rem;font-weight:600;
  letter-spacing:.01em;
}
.badge-blue{background:var(--primary-light);color:var(--primary)}
.badge-green{background:var(--success-light);color:var(--success)}
.badge-orange{background:var(--warning-light);color:var(--warning)}
.badge-red{background:var(--danger-light);color:var(--danger)}
.badge-gray{background:var(--gray-100);color:var(--gray-500)}
.badge-ok{background:var(--success-light);color:var(--success)}

/* === CODE === */
code{background:var(--gray-100);padding:2px 7px;border-radius:5px;font-size:.88em;color:var(--gray-700);font-family:"SF Mono",Menlo,Consolas,monospace}
pre{background:var(--gray-100);padding:14px 16px;border-radius:var(--radius-sm);white-space:pre-wrap;word-break:break-all;font-size:.88rem;color:var(--gray-700);font-family:"SF Mono",Menlo,Consolas,monospace;border:1px solid var(--gray-200)}

/* === KPI === */
.kpi{font-size:1.6rem;font-weight:700;color:var(--gray-900);letter-spacing:-.02em}
.kpi-label{font-size:.8rem;color:var(--gray-500);font-weight:500;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}

/* === PROGRESS === */
.progress{height:6px;background:var(--gray-200);border-radius:999px;overflow:hidden;margin-top:8px}
.progress span{display:block;height:100%;width:0%;background:linear-gradient(90deg,var(--primary),#6366f1);border-radius:999px;transition:width .4s ease}

/* === TABLE === */
table{border-collapse:separate;border-spacing:0;width:100%;border:1px solid var(--gray-200);border-radius:var(--radius-sm);overflow:hidden}
thead th{
  background:var(--gray-50);color:var(--gray-500);font-size:.78rem;
  font-weight:600;text-transform:uppercase;letter-spacing:.05em;
  padding:10px 14px;text-align:left;border-bottom:1px solid var(--gray-200);
}
tbody td{padding:10px 14px;font-size:.9rem;border-bottom:1px solid var(--gray-100)}
tbody tr:last-child td{border-bottom:none}
tbody tr:hover{background:var(--gray-50)}

/* === LINKS === */
a{color:var(--primary);text-decoration:none}
a:hover{text-decoration:underline}

/* === STATUS DOT === */
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.status-dot.live{background:var(--success);box-shadow:0 0 6px rgba(25,135,84,.4);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}

/* === EMPTY STATE === */
.empty{text-align:center;padding:40px 20px;color:var(--gray-500)}
.empty-icon{font-size:2.5rem;margin-bottom:8px}

/* === RESPONSIVE === */
@media(max-width:640px){
  .topbar{padding:0 16px}
  .container{padding:16px 12px}
  .card{padding:16px}
  .grid{grid-template-columns:1fr}
  .btn{padding:10px 16px}
}
</style>
</head><body>
<nav class="topbar">
  <a href="/" class="topbar-brand"><span>🟢</span> FrankyDocs</a>
  <div class="topbar-nav">
    <a href="/">Dashboard</a>
  </div>
</nav>
<div class="container">${body}</div>
</body></html>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

// joinPageHtml removed — single-user mode, no join/signer flow needed

function cmdPageHtml(params: { docId: string; cmdId: string; signerAddress: string; raw: string; status: string }): string {
  const { docId, cmdId, raw, status } = params;
  return `
<div class="spacer-sm"></div>
<div class="card">
  <div class="card-header">
    <div>
      <h1>Command Approval</h1>
      <div class="card-meta">Review and approve this treasury action</div>
    </div>
    <span class="badge badge-blue" id="statusBadge">${escapeHtml(status)}</span>
  </div>

  <!-- Command details -->
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
    <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;flex:1;min-width:200px">
      <div class="card-meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Command ID</div>
      <code style="font-size:.82rem">${escapeHtml(cmdId)}</code>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="badge badge-green">Single-User</span>
      <button class="btn btn-ghost btn-sm" id="copyLink">📋 Copy link</button>
    </div>
  </div>

  <div class="grid" style="margin-bottom:18px">
    <div class="card mini" style="border-left:3px solid var(--primary)">
      <div class="kpi-label">Action Summary</div>
      <div class="kpi" id="actionSummary" style="font-size:1.2rem">—</div>
      <div class="card-meta" id="actionRaw" style="margin-top:4px"></div>
    </div>
    <div class="card mini" style="border-left:3px solid var(--success)">
      <div class="kpi-label">Gasless Savings</div>
      <div class="kpi" id="gasSaved" style="font-size:1.2rem;color:var(--success)">0.000 ETH</div>
      <div class="card-meta"><span id="approvalsTotal">0</span> on-chain approvals avoided</div>
    </div>
  </div>

  <div class="kpi-label">Raw Command</div>
  <pre style="margin:6px 0 18px">${escapeHtml(raw)}</pre>

  <!-- Human-readable action summary -->
  <div id="humanSummary" style="background:linear-gradient(135deg,#f0fdf4,#ecfdf5);border:1px solid #bbf7d0;border-radius:var(--radius-sm);padding:14px 18px;margin-bottom:16px">
    <div style="font-weight:700;font-size:1rem;color:#166534;margin-bottom:4px" id="humanAction">${escapeHtml(summarizeCommand(raw))}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
      <span class="badge badge-green">Gasless Approval — $0 in fees (Yellow Network)</span>
    </div>
  </div>

  <!-- Approve / Reject — no wallet needed -->
  <div id="actionButtons" class="row" style="margin-bottom:16px">
    <button class="btn btn-primary" id="approveBtn" style="font-size:1.1rem;padding:14px 36px;box-shadow:var(--shadow-md)">⚡ Approve</button>
    <button class="btn btn-danger btn-sm" id="rejectBtn">✕ Reject</button>
    <span class="card-meta" style="margin-left:8px">No wallet needed — owner-approved</span>
  </div>

  <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px">
    <div class="card-meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Tip</div>
    <div style="font-size:.88rem;color:var(--gray-700)">You can also approve commands directly in the Google Doc by setting the STATUS cell to <code>APPROVED</code>.</div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:10px 14px">
      <div class="card-meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Result</div>
      <div id="resultText" style="font-size:.9rem;word-break:break-all">—</div>
    </div>
    <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:10px 14px">
      <div class="card-meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Error</div>
      <div id="errorText" style="font-size:.9rem;word-break:break-all;color:var(--danger)">—</div>
    </div>
  </div>

  <div class="spacer-sm"></div>
  <pre id="out" style="min-height:24px"></pre>
</div>
<script>
const out = document.getElementById('out');
function log(x){ out.textContent = String(x); }

// --- Approve command ---
document.getElementById('approveBtn').onclick = async () => {
  log('Approving…');
  let res = await fetch('/api/cmd/demo-approve', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ docId:'${escapeJs(docId)}', cmdId:'${escapeJs(cmdId)}' }) });
  let data = await res.json();
  if (!data.ok && data.error && !data.error.includes('Already')) {
    res = await fetch('/api/cmd/decision', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ docId:'${escapeJs(docId)}', cmdId:'${escapeJs(cmdId)}', decision:'APPROVE' }) });
    data = await res.json();
  }
  if(!data.ok) return log('Error: ' + data.error);
  log('✅ APPROVED! The agent will execute this command shortly.');
  document.getElementById('statusBadge').textContent = 'APPROVED';
  document.getElementById('statusBadge').className = 'badge badge-green';
  document.getElementById('actionButtons').style.display = 'none';
  poll();
};
document.getElementById('rejectBtn').onclick = async () => {
  log('Rejecting…');
  let res = await fetch('/api/cmd/demo-reject', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ docId:'${escapeJs(docId)}', cmdId:'${escapeJs(cmdId)}' }) });
  let data = await res.json();
  if (!data.ok && data.error && !data.error.includes('Already')) {
    res = await fetch('/api/cmd/decision', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ docId:'${escapeJs(docId)}', cmdId:'${escapeJs(cmdId)}', decision:'REJECT' }) });
    data = await res.json();
  }
  if(!data.ok) return log('Error: ' + data.error);
  log('❌ REJECTED.');
  document.getElementById('statusBadge').textContent = 'REJECTED';
  document.getElementById('statusBadge').className = 'badge badge-red';
  document.getElementById('actionButtons').style.display = 'none';
  poll();
};
document.getElementById('copyLink').onclick = async () => {
  try{
    await navigator.clipboard.writeText(window.location.href);
    log('Copied link to clipboard');
  }catch(e){
    log('Copy failed');
  }
};

// --- Polling ---
async function poll(){
  try {
    const res = await fetch('/api/cmd/${escapeJs(docId)}/${escapeJs(cmdId)}');
    const data = await res.json();
    if(!data.ok) return;
    document.getElementById('statusBadge').textContent = data.cmd.status;
    document.getElementById('statusBadge').className = 'badge ' + (data.cmd.status === 'APPROVED' ? 'badge-green' : data.cmd.status === 'EXECUTED' ? 'badge-green' : data.cmd.status === 'REJECTED' ? 'badge-red' : 'badge-blue');
    document.getElementById('actionSummary').textContent = data.actionSummary || '—';
    document.getElementById('actionRaw').textContent = data.cmd.raw || '';
    document.getElementById('resultText').textContent = data.cmd.result || '';
    document.getElementById('errorText').textContent = data.cmd.error || '';
    if(data.cmd.status !== 'PENDING_APPROVAL') document.getElementById('actionButtons').style.display = 'none';
  } catch(e) { console.warn('Poll failed:', e); }
}
async function pollMetrics(){
  try {
    const res = await fetch('/api/metrics/${escapeJs(docId)}');
    const data = await res.json();
    if(!data.ok) return;
    const m = data.metrics || {};
    const avoided = Number(m.approvalTxAvoided || m.approvalsTotal || 0);
    const gasPer = Number(m.signerApprovalGasPaid || 0.003);
    document.getElementById('approvalsTotal').textContent = String(avoided);
    document.getElementById('gasSaved').textContent = (avoided * gasPer).toFixed(4) + ' ETH';
  } catch(e) { console.warn('Metrics poll failed:', e); }
}
setInterval(poll, 3000);
setInterval(pollMetrics, 5000);
poll();
pollMetrics();
</script>
`;
}

function activityPageHtml(params: { docId: string }): string {
  const { docId } = params;
  return `
<div class="spacer-sm"></div>
<div class="card">
  <div class="card-header">
    <div>
      <h1>Activity Feed</h1>
      <div class="card-meta">Live command history for this treasury doc</div>
    </div>
    <span class="badge badge-green"><span class="status-dot live"></span>Live</span>
  </div>
  <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
    <div><span class="card-meta">Document:</span> <code>${escapeHtml(docId)}</code></div>
    <button id="approveAllBtn" class="btn btn-primary btn-sm" onclick="demoApproveAll()" style="white-space:nowrap">⚡ Approve All Pending</button>
  </div>
  <table>
    <thead>
      <tr><th>Command</th><th>Status</th><th>Action</th><th>Result</th><th>Error</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="empty-state" class="empty" style="display:none"><div class="empty-icon">📭</div><p>No commands yet</p></div>
</div>
<script>
const rows = document.getElementById('rows');
const emptyState = document.getElementById('empty-state');
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function statusBadge(s){
  const cls = s==='EXECUTED'?'badge-green':s==='REJECTED'||s==='FAILED'?'badge-red':s==='PENDING_APPROVAL'?'badge-orange':s==='APPROVED'||s==='EXECUTING'?'badge-blue':'badge-gray';
  return '<span class="badge '+cls+'">'+esc(s)+'</span>';
}
function humanizeCommand(raw){
  if(!raw) return '';
  // Translate command types to human-friendly actions
  if(raw.includes('MARKET_BUY')) { const m=raw.match(/MARKET_BUY\\s+SUI\\s+([\\d.]+)/); return m ? 'Bought '+m[1]+' SUI at market price' : 'Market buy SUI'; }
  if(raw.includes('MARKET_SELL')) { const m=raw.match(/MARKET_SELL\\s+SUI\\s+([\\d.]+)/); return m ? 'Sold '+m[1]+' SUI at market price' : 'Market sell SUI'; }
  if(raw.includes('LIMIT_BUY')) { const m=raw.match(/LIMIT_BUY\\s+SUI\\s+([\\d.]+)\\s+USDC\\s+@\\s+([\\d.]+)/); return m ? 'Limit buy '+m[1]+' SUI at $'+m[2] : 'Limit buy SUI'; }
  if(raw.includes('LIMIT_SELL')) { const m=raw.match(/LIMIT_SELL\\s+SUI\\s+([\\d.]+)\\s+USDC\\s+@\\s+([\\d.]+)/); return m ? 'Limit sell '+m[1]+' SUI at $'+m[2] : 'Limit sell SUI'; }
  if(raw.includes('PAYOUT')) { const m=raw.match(/PAYOUT\\s+([\\d.]+)\\s+USDC\\s+TO\\s+(0x[a-f0-9]+)/i); return m ? 'Sent $'+m[1]+' USDC to '+m[2].slice(0,6)+'...' : 'USDC payout'; }
  if(raw.includes('BRIDGE')) { const m=raw.match(/BRIDGE\\s+([\\d.]+)\\s+USDC\\s+FROM\\s+(\\w+)\\s+TO\\s+(\\w+)/i); return m ? 'Bridged $'+m[1]+' USDC from '+m[2]+' to '+m[3] : 'Cross-chain bridge'; }
  if(raw.includes('STOP_LOSS')) return 'Stop-loss order';
  if(raw.includes('TAKE_PROFIT')) return 'Take-profit order';
  if(raw.includes('SWEEP_YIELD')) return 'Swept idle capital';
  if(raw.includes('TREASURY')) return 'Treasury balance check';
  if(raw.includes('PRICE')) return 'Price check';
  if(raw.includes('SETUP')) return 'Initial setup';
  if(raw.includes('SCHEDULE')) return 'Scheduled automation';
  if(raw.includes('REBALANCE')) return 'Cross-chain rebalance';
  return raw.replace(/^DW\\s+/,'');
}
async function demoApprove(cmdId){
  const btn = document.getElementById('btn-'+cmdId);
  if(btn) btn.textContent = '⏳…';
  try{
    const res = await fetch('/api/cmd/demo-approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({docId:'${escapeJs(docId)}',cmdId})});
    const data = await res.json();
    if(!data.ok){ alert('Error: '+data.error); if(btn) btn.textContent='✓ Approve'; return; }
    load();
  }catch(e){ alert('Error: '+e.message); if(btn) btn.textContent='✓ Approve'; }
}
async function demoApproveAll(){
  const btn = document.getElementById('approveAllBtn');
  if(btn) btn.textContent = '⏳ Approving…';
  try{
    const res = await fetch('/api/cmd/demo-approve-all',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({docId:'${escapeJs(docId)}'})});
    const data = await res.json();
    if(!data.ok){ alert('Error: '+data.error); if(btn) btn.textContent='⚡ Approve All'; return; }
    if(btn) btn.textContent = '✅ '+data.approved+' Approved!';
    load();
    setTimeout(()=>{ if(btn) btn.textContent='⚡ Approve All'; },2000);
  }catch(e){ alert('Error: '+e.message); if(btn) btn.textContent='⚡ Approve All'; }
}
function actionCol(c){
  if(c.status==='PENDING_APPROVAL'){
    return '<button id="btn-'+esc(c.cmdId)+'" class="btn btn-primary btn-sm" style="white-space:nowrap" onclick="demoApprove(\''+esc(c.cmdId)+'\')">' +
      '⚡ Approve</button>';
  }
  if(c.status==='EXECUTED' && c.result){
    // Link to tx explorer if available
    const suiMatch = (c.result||'').match(/SuiTx=(\\w+)/);
    const arcMatch = (c.result||'').match(/ArcTx=(0x\\w+)/);
    if(suiMatch) return '<a href="https://suiscan.xyz/testnet/tx/'+suiMatch[1]+'" target="_blank" class="btn btn-ghost btn-sm">🔍 Sui Explorer</a>';
    if(arcMatch) return '<a href="https://explorer.testnet.arc.network/tx/'+arcMatch[1]+'" target="_blank" class="btn btn-ghost btn-sm">🔍 Arc Explorer</a>';
    return '<span class="card-meta">Done</span>';
  }
  if(c.status==='EXECUTING') return '<span class="badge badge-blue">⏳ Running</span>';
  if(c.status==='FAILED') return '<span class="badge badge-red">✕</span>';
  return '<span class="card-meta">—</span>';
}
async function load(){
  const res = await fetch('/api/activity/${escapeJs(docId)}');
  const data = await res.json();
  if(!data.ok) return;
  if(!data.commands.length){
    rows.innerHTML='';emptyState.style.display='block';return;
  }
  emptyState.style.display='none';
  rows.innerHTML = data.commands.map(c => {
    const raw = c.raw||'';
    const chain = raw.includes('BRIDGE')||raw.includes('PAYOUT')||raw.includes('ARC')?'<span class="badge badge-blue" style="font-size:.65rem;margin-left:4px">Arc</span>':
      raw.includes('SUI')||raw.includes('MARKET')||raw.includes('LIMIT')?'<span class="badge badge-ok" style="font-size:.65rem;margin-left:4px">Sui</span>':
      raw.includes('YELLOW')?'<span class="badge badge-orange" style="font-size:.65rem;margin-left:4px">Yellow</span>':'';
    return '<tr><td><div style="font-weight:500;font-size:.9rem">'+humanizeCommand(c.raw)+chain+'</div><code style="font-size:.72rem;color:var(--gray-500)">'+esc(c.cmdId)+'</code></td>' +
    '<td>'+statusBadge(c.status)+'</td><td>'+actionCol(c)+'</td><td style="font-size:.88rem">'+esc(c.result||'—')+'</td><td style="font-size:.88rem;color:var(--danger)">'+esc(c.error||'—')+'</td></tr>';
  }).join('');
}
load();
setInterval(load, 3000);
</script>
`;
}

function walletConnectSessionsPageHtml(params: { docId: string; publicBaseUrl: string }): string {
  const { docId, publicBaseUrl } = params;
  return `
<div class="spacer-sm"></div>
<div class="card">
  <div class="card-header">
    <div>
      <h1>Sessions & Schedules</h1>
      <div class="card-meta">WalletConnect sessions, pending requests, and DCA schedules</div>
    </div>
    <span class="badge badge-green"><span class="status-dot live"></span>Live</span>
  </div>
  <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:20px">
    <span class="card-meta">Document:</span> <code>${escapeHtml(docId)}</code>
  </div>

  <h2>🔗 WalletConnect Sessions</h2>
  <table>
    <thead>
      <tr><th>Peer</th><th>Chains</th><th>Status</th><th>Connected</th><th>Action</th></tr>
    </thead>
    <tbody id="wc-sessions"></tbody>
  </table>

  <div class="spacer"></div>
  <h2>⏳ Pending Requests</h2>
  <table>
    <thead>
      <tr><th>Method</th><th>Command ID</th><th>Status</th><th>Time</th></tr>
    </thead>
    <tbody id="wc-requests"></tbody>
  </table>

  <div class="spacer"></div>
  <h2>📅 Active Schedules (DCA)</h2>
  <table>
    <thead>
      <tr><th>Schedule ID</th><th>Interval</th><th>Command</th><th>Runs</th><th>Next Run</th><th>Status</th></tr>
    </thead>
    <tbody id="schedules"></tbody>
  </table>
</div>
<script>
const wcSessions = document.getElementById('wc-sessions');
const wcRequests = document.getElementById('wc-requests');
const schedulesEl = document.getElementById('schedules');
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function emptyRow(cols,msg){return '<tr><td colspan="'+cols+'" class="card-meta" style="text-align:center;padding:20px">'+msg+'</td></tr>';}
async function load(){
  const res = await fetch('/api/sessions/${escapeJs(docId)}');
  const data = await res.json();
  if(!data.ok) return;
  wcSessions.innerHTML = data.sessions.length ? data.sessions.map(s =>
    '<tr><td style="font-weight:500">'+esc(s.peerName||'Unknown')+'</td><td><code>'+esc(s.chains||'')+'</code></td>' +
    '<td><span class="badge '+(s.status==='ACTIVE'?'badge-green':'badge-gray')+'">'+esc(s.status)+'</span></td>' +
    '<td class="card-meta">'+new Date(s.createdAt).toLocaleString()+'</td>' +
    '<td>'+(s.status==='ACTIVE'?'<button class="btn btn-danger btn-sm" onclick="disconnect(\\''+esc(s.topic)+'\\')">Disconnect</button>':'<span class="card-meta">—</span>')+'</td></tr>'
  ).join('') : emptyRow(5,'No WalletConnect sessions');

  wcRequests.innerHTML = data.pendingRequests.length ? data.pendingRequests.map(r =>
    '<tr><td><code>'+esc(r.method)+'</code></td><td><code>'+esc(r.cmdId)+'</code></td>' +
    '<td><span class="badge badge-orange">'+esc(r.status)+'</span></td>' +
    '<td class="card-meta">'+new Date(r.createdAt).toLocaleString()+'</td></tr>'
  ).join('') : emptyRow(4,'No pending requests');

  schedulesEl.innerHTML = data.schedules.length ? data.schedules.map(s =>
    '<tr><td><code>'+esc(s.scheduleId)+'</code></td><td>Every '+s.intervalHours+'h</td>' +
    '<td><code>'+esc(s.innerCommand)+'</code></td><td style="font-weight:600">'+s.totalRuns+'</td>' +
    '<td class="card-meta">'+new Date(s.nextRunAt).toLocaleString()+'</td>' +
    '<td><span class="badge '+(s.status==='ACTIVE'?'badge-green':'badge-gray')+'">'+esc(s.status)+'</span></td></tr>'
  ).join('') : emptyRow(6,'No active schedules');
}
async function disconnect(topic){
  if(!confirm('Disconnect this session?')) return;
  const res = await fetch('/api/sessions/${escapeJs(docId)}/disconnect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({topic})});
  const data = await res.json();
  if(data.ok) load();
  else alert('Error: '+(data.error||'unknown'));
}
load();
setInterval(load, 5000);
</script>
`;
}

function notSignedInHtml(params: { docId: string }): string {
  return `
<div class="spacer-lg"></div>
<div class="card" style="max-width:480px;margin:0 auto;text-align:center">
  <div style="font-size:3rem;margin-bottom:8px">📄</div>
  <h1 style="margin-bottom:8px">Approve in the Doc</h1>
  <p style="color:var(--gray-500);margin-bottom:20px">Set the command's <strong>STATUS</strong> cell to <code>APPROVED</code> in the Commands table of your Google Doc. The agent will pick it up on the next poll.</p>
</div>`;
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\\n/g, "\\n").replace(/\\r/g, "\\r");
}

function safeParseParsedJson(parsedJson: string | null): any | null {
  if (!parsedJson) return null;
  try {
    return JSON.parse(parsedJson);
  } catch {
    return null;
  }
}

function shortAddress(addr: string): string {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatApproverList(approvers: string[]): string {
  const byLower = new Map<string, string>();
  for (const addr of approvers) {
    const key = addr.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, addr);
  }
  const unique = Array.from(byLower.values());
  const display = unique.slice(0, 2).map(shortAddress).join(",");
  if (unique.length <= 2) return display || "none";
  return `${display}+${unique.length - 2}`;
}

function summarizeCommand(raw: string): string {
  const parsed = parseCommand(raw);
  if (!parsed.ok) return raw;
  const cmd = parsed.value;
  switch (cmd.type) {
    case "SETUP": return "Create your treasury wallets (automatic, no setup needed)";
    case "STATUS": return "Check treasury status";
    case "SESSION_CREATE": return "Open a Yellow Network session for gasless approvals";
    case "SESSION_CLOSE": return "Close the Yellow Network session";
    case "SESSION_STATUS": return "Check Yellow session status";
    case "SIGNER_ADD": return `Add ${shortAddress(cmd.address)} as a team approver (weight ${cmd.weight})`;
    case "QUORUM": return `Set approval threshold to ${cmd.quorum} votes`;
    case "CONNECT": return "Connect to an external app via WalletConnect";
    case "WC_TX": return `Execute transaction to ${shortAddress(cmd.to)} via connected app`;
    case "WC_SIGN": return `Sign message as ${shortAddress(cmd.address)}`;
    case "LIMIT_BUY": {
      const total = (cmd.qty * cmd.price).toFixed(2);
      return `Buy ${cmd.qty} SUI at $${cmd.price} each (total ~$${total})`;
    }
    case "LIMIT_SELL": {
      const total = (cmd.qty * cmd.price).toFixed(2);
      return `Sell ${cmd.qty} SUI at $${cmd.price} each (receive ~$${total})`;
    }
    case "MARKET_BUY": return `Buy ${cmd.qty} SUI at the current market price`;
    case "MARKET_SELL": return `Sell ${cmd.qty} SUI at the current market price`;
    case "DEPOSIT": return `Deposit ${cmd.amount} ${cmd.coinType} into DeepBook`;
    case "WITHDRAW": return `Withdraw ${cmd.amount} ${cmd.coinType} from DeepBook`;
    case "CANCEL": return `Cancel order ${cmd.orderId}`;
    case "SETTLE": return "Settle all filled orders";
    case "PAYOUT": return `Send $${cmd.amountUsdc} USDC to ${shortAddress(cmd.to)}`;
    case "PAYOUT_SPLIT": return `Split $${cmd.amountUsdc} USDC across ${cmd.recipients.length} recipients`;
    case "SCHEDULE": return `Automate every ${cmd.intervalHours}h: ${cmd.innerCommand}`;
    case "CANCEL_SCHEDULE": return `Cancel automated schedule ${cmd.scheduleId}`;
    case "BRIDGE": return `Bridge $${cmd.amountUsdc} USDC from ${cmd.fromChain} to ${cmd.toChain}`;
    case "ALERT_THRESHOLD": return `Alert when ${cmd.coinType} drops below ${cmd.below}`;
    case "AUTO_REBALANCE": return `Auto-rebalance ${cmd.enabled ? "enabled" : "disabled"}`;
    case "YELLOW_SEND": return `Send $${cmd.amountUsdc} USDC to ${shortAddress(cmd.to)} instantly (gasless, off-chain via Yellow)`;
    case "STOP_LOSS": return `Auto-sell ${cmd.qty} SUI if price drops to $${cmd.triggerPrice} (downside protection)`;
    case "TAKE_PROFIT": return `Auto-sell ${cmd.qty} SUI if price rises to $${cmd.triggerPrice} (lock in gains)`;
    case "SWEEP_YIELD": return "Collect idle funds and settle trades across all chains";
    case "TRADE_HISTORY": return "View trade history and profit/loss";
    case "PRICE": return "Check live SUI/USDC price from DeepBook";
    case "CANCEL_ORDER": return `Cancel conditional order ${cmd.orderId}`;
    case "TREASURY": return "View unified balance across all chains";
    case "REBALANCE": return `Move $${cmd.amountUsdc} USDC from ${cmd.fromChain} to ${cmd.toChain}`;
    default: return raw;
  }
}

function yellowPolicyTypedData(params: {
  application: string;
  challenge: string;
  scope: string;
  wallet: `0x${string}`;
  sessionKey: `0x${string}`;
  expiresAt: number;
  allowances: Array<{ asset: string; amount: string }>;
}) {
  return {
    domain: { name: params.application },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }],
      Policy: [
        { name: "challenge", type: "string" },
        { name: "scope", type: "string" },
        { name: "wallet", type: "address" },
        { name: "session_key", type: "address" },
        { name: "expires_at", type: "uint64" },
        { name: "allowances", type: "Allowance[]" }
      ],
      Allowance: [
        { name: "asset", type: "string" },
        { name: "amount", type: "string" }
      ]
    },
    primaryType: "Policy",
    message: {
      challenge: params.challenge,
      scope: params.scope,
      wallet: params.wallet,
      session_key: params.sessionKey,
      expires_at: String(params.expiresAt),
      allowances: params.allowances ?? []
    }
  };
}
