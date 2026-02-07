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

type ServerDeps = {
  docs: docs_v1.Docs;
  repo: Repo;
  masterKey: string;
  port: number;
  publicBaseUrl: string;
  yellow?: NitroRpcYellowClient;
  yellowApplicationName?: string;
  walletconnect?: WalletConnectService;
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
              const joinUrl = `${deps.publicBaseUrl}/join/${encodeURIComponent(d.doc_id)}`;
              const signersUrl = `${deps.publicBaseUrl}/signers/${encodeURIComponent(d.doc_id)}`;
              const activityUrl = `${deps.publicBaseUrl}/activity/${encodeURIComponent(d.doc_id)}`;
              const sessionsUrl = `${deps.publicBaseUrl}/sessions/${encodeURIComponent(d.doc_id)}`;
              return `<div class="card" style="margin-bottom:14px">
  <div class="card-header">
    <div>
      <h3 style="margin:0">${name}</h3>
      <div class="card-meta"><code>${escapeHtml(shortId)}</code></div>
    </div>
    <span class="badge badge-green">● Active</span>
  </div>
  <div class="row">
    <a href="${joinUrl}" class="btn btn-primary btn-sm">Join</a>
    <a href="${signersUrl}" class="btn btn-outline btn-sm">Signers</a>
    <a href="${activityUrl}" class="btn btn-ghost btn-sm">Activity</a>
    <a href="${sessionsUrl}" class="btn btn-ghost btn-sm">Sessions</a>
  </div>
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
    <div class="card-meta">Off-chain gasless payments</div>
    <div class="badge badge-ok" style="margin-top:6px">NitroRPC/0.4</div>
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
  <div class="card mini" style="border-left:3px solid #5298FF">
    <div class="kpi-label">ENS Policy</div>
    <div style="font-size:.95rem;font-weight:600;color:var(--gray-900)">Governance</div>
    <div class="card-meta">On-chain spend limits</div>
    <div class="badge badge-ok" style="margin-top:6px">Text Records</div>
  </div>
</div>

<div class="card" style="margin-bottom:20px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border:none">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
    <span style="font-size:1.5rem">🌟</span>
    <div>
      <div style="font-weight:700;font-size:1.1rem">How It Works</div>
      <div style="opacity:.8;font-size:.88rem">Type commands in a Google Doc → Approve via MetaMask → Execute on-chain</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">
    <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px 14px">
      <div style="font-size:.75rem;opacity:.7;text-transform:uppercase;letter-spacing:.04em">Proposers</div>
      <div style="font-size:.9rem;margin-top:2px">No wallet needed — just type in the Doc</div>
    </div>
    <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px 14px">
      <div style="font-size:.75rem;opacity:.7;text-transform:uppercase;letter-spacing:.04em">Approvers</div>
      <div style="font-size:.9rem;margin-top:2px">Sign once via Yellow session keys (gasless)</div>
    </div>
    <div style="background:rgba(255,255,255,.08);border-radius:8px;padding:10px 14px">
      <div style="font-size:.75rem;opacity:.7;text-transform:uppercase;letter-spacing:.04em">Agent</div>
      <div style="font-size:.9rem;margin-top:2px">Auto-proposes, monitors risk, sweeps yield</div>
    </div>
  </div>
</div>

${rows}`
        );
      }

      const activityPageMatch = matchPath(url.pathname, ["activity", ":docId"]);
      if (req.method === "GET" && activityPageMatch) {
        const docId = decodeURIComponent(activityPageMatch.docId);
        return sendHtml(res, "Activity", activityPageHtml({ docId }));
      }

      // API: List docs with full integration status (for demo/judges)
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
            ensName: d.ens_name,
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
              ens: {
                policySource: d.policy_source ?? "NONE",
                ensName: d.ens_name ?? null
              }
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

      const joinMatch = matchPath(url.pathname, ["join", ":docId"]);
      if (req.method === "GET" && joinMatch) {
        const docId = decodeURIComponent(joinMatch.docId);
        return sendHtml(res, "Join", joinPageHtml({ docId }));
      }

      const signersMatch = matchPath(url.pathname, ["signers", ":docId"]);
      if (req.method === "GET" && signersMatch) {
        const docId = decodeURIComponent(signersMatch.docId);
        const quorum = deps.repo.getDocQuorum(docId);
        const signers = deps.repo.listSigners(docId);
        const rows = signers.length > 0
          ? signers.map((s) =>
              `<tr><td><code>${escapeHtml(s.address)}</code></td><td style="font-weight:600;text-align:center">${s.weight}</td></tr>`
            ).join("\n")
          : `<tr><td colspan="2" class="card-meta" style="text-align:center;padding:24px">No signers registered yet</td></tr>`;
        const totalWeight = signers.reduce((sum, s) => sum + s.weight, 0);
        return sendHtml(
          res,
          "Signers",
          `<div class="spacer-sm"></div>
<div class="card">
  <div class="card-header">
    <div>
      <h1>Signers</h1>
      <div class="card-meta">Multi-sig signer roster for this treasury doc</div>
    </div>
    <span class="badge badge-blue">${signers.length} Signer${signers.length !== 1 ? "s" : ""}</span>
  </div>
  <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:16px">
    <span class="card-meta">Document:</span> <code>${escapeHtml(docId)}</code>
  </div>
  <div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:18px">
    <div class="card mini" style="border-left:3px solid var(--primary)">
      <div class="kpi-label">Quorum Required</div>
      <div class="kpi">${quorum}</div>
    </div>
    <div class="card mini" style="border-left:3px solid var(--success)">
      <div class="kpi-label">Total Weight</div>
      <div class="kpi">${totalWeight}</div>
    </div>
  </div>
  <table><thead><tr><th>Address</th><th style="text-align:center;width:100px">Weight</th></tr></thead><tbody>${rows}</tbody></table>
</div>`
        );
      }

      const cmdMatch = matchPath(url.pathname, ["cmd", ":docId", ":cmdId"]);
      if (req.method === "GET" && cmdMatch) {
        const docId = decodeURIComponent(cmdMatch.docId);
        const cmdId = decodeURIComponent(cmdMatch.cmdId);
        const session = getSession(req, sessions);
        if (!session || session.docId !== docId) return sendHtml(res, "Not signed in", notSignedInHtml({ docId }));

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendHtml(res, "Not found", `<h1>Command not found</h1>`);

        return sendHtml(res, `Command ${cmdId}`, cmdPageHtml({ docId, cmdId, signerAddress: session.signerAddress, raw: cmd.raw_command, status: cmd.status }));
      }

      if (req.method === "POST" && url.pathname === "/api/join/start") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        const address = String(body.address ?? "").toLowerCase();
        const weight = Number(body.weight ?? 1);

        if (!docId) return sendJson(res, 400, { ok: false, error: "Missing docId" });
        if (!/^0x[0-9a-f]{40}$/.test(address)) return sendJson(res, 400, { ok: false, error: "Invalid address" });
        if (!Number.isFinite(weight) || weight <= 0 || Math.floor(weight) !== weight) return sendJson(res, 400, { ok: false, error: "Invalid weight" });

        // If Yellow is enabled, require real delegated session key authorization (no stubs).
        if (deps.yellow) {
          const application = String(deps.yellowApplicationName ?? "DocWallet");
          const scope = "app.create,app.submit,transfer";
          const allowances: Array<{ asset: string; amount: string }> = [];
          const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

          const sk = generateEvmWallet();
          const out = await deps.yellow.authRequest({
            address: address as `0x${string}`,
            sessionKeyAddress: sk.address,
            application,
            scope,
            allowances,
            expiresAt
          });
          const challengeMessage = String(out?.challenge_message ?? out?.challengeMessage ?? out?.challenge ?? "");
          if (!challengeMessage) return sendJson(res, 502, { ok: false, error: `Yellow auth_request missing challenge_message` });

          const joinToken = randomToken();
          pendingYellowJoins.set(joinToken, {
            docId,
            address: address as `0x${string}`,
            weight,
            sessionKeyAddress: sk.address,
            sessionKeyPrivateKeyHex: sk.privateKeyHex,
            application,
            scope,
            allowances,
            expiresAt,
            challengeMessage,
            createdAt: Date.now()
          });

          const typedData = yellowPolicyTypedData({
            application,
            challenge: challengeMessage,
            scope,
            wallet: address as `0x${string}`,
            sessionKey: sk.address,
            expiresAt,
            allowances
          });

          return sendJson(res, 200, {
            ok: true,
            mode: "yellow",
            joinToken,
            sessionKeyAddress: sk.address,
            typedData
          });
        }

        // No Yellow: basic join uses personal_sign.
        const nonce = randomToken().slice(0, 8);
        const message = `FrankyDocs join\\nDocId: ${docId}\\nAddress: ${address}\\nWeight: ${weight}\\nNonce: ${nonce}`;
        return sendJson(res, 200, { ok: true, mode: "basic", message });
      }

      if (req.method === "POST" && url.pathname === "/api/join/finish") {
        const body = await readJsonBody(req);
        const mode = String(body.mode ?? "");
        if (mode !== "yellow" && mode !== "basic") return sendJson(res, 400, { ok: false, error: "Invalid mode" });

        if (mode === "basic") {
          const docId = String(body.docId ?? "");
          const address = String(body.address ?? "").toLowerCase();
          const weight = Number(body.weight ?? 1);
          const message = String(body.message ?? "");
          const signature = String(body.signature ?? "");

          if (!docId) return sendJson(res, 400, { ok: false, error: "Missing docId" });
          if (!/^0x[0-9a-f]{40}$/.test(address)) return sendJson(res, 400, { ok: false, error: "Invalid address" });
          if (!Number.isFinite(weight) || weight <= 0 || Math.floor(weight) !== weight) return sendJson(res, 400, { ok: false, error: "Invalid weight" });
          if (!message || !signature) return sendJson(res, 400, { ok: false, error: "Missing signature" });

          const recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
          if (recovered.toLowerCase() !== address) return sendJson(res, 401, { ok: false, error: "Bad signature" });

          deps.repo.upsertSigner({ docId, address, weight });
          const token = randomToken();
          sessions.set(token, { docId, signerAddress: address as `0x${string}`, createdAt: Date.now() });
          setCookie(res, "dw_session", token);
          await bestEffortSyncSignersToDoc({ docs: deps.docs, repo: deps.repo, docId });
          return sendJson(res, 200, { ok: true, signerAddress: address });
        }

        // Yellow mode
        if (!deps.yellow) return sendJson(res, 400, { ok: false, error: "Yellow is not enabled on this agent" });
        const joinToken = String(body.joinToken ?? "");
        const signature = String(body.signature ?? "");
        if (!joinToken || !signature) return sendJson(res, 400, { ok: false, error: "Missing joinToken/signature" });

        const pending = pendingYellowJoins.get(joinToken);
        if (!pending) return sendJson(res, 404, { ok: false, error: "Join session expired. Reload /join and try again." });

        // Expire pending joins after 10 minutes.
        if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
          pendingYellowJoins.delete(joinToken);
          return sendJson(res, 410, { ok: false, error: "Join session expired. Reload /join and try again." });
        }

        const verified = await deps.yellow.authVerify({ signature: signature as `0x${string}`, challengeMessage: pending.challengeMessage });
        const jwtToken = verified?.jwt_token ?? verified?.jwtToken ?? null;

        deps.repo.upsertSigner({ docId: pending.docId, address: pending.address, weight: pending.weight });
        const encrypted = encryptWithMasterKey({
          masterKey: deps.masterKey,
          plaintext: Buffer.from(JSON.stringify({ privateKeyHex: pending.sessionKeyPrivateKeyHex }), "utf8")
        });
        deps.repo.upsertYellowSessionKey({
          docId: pending.docId,
          signerAddress: pending.address,
          sessionKeyAddress: pending.sessionKeyAddress,
          encryptedSessionKeyPrivate: encrypted,
          expiresAt: pending.expiresAt,
          allowancesJson: JSON.stringify({ scope: pending.scope, allowances: pending.allowances }),
          jwtToken: jwtToken ? String(jwtToken) : null
        });

        // Cookie session for approvals
        const token = randomToken();
        sessions.set(token, { docId: pending.docId, signerAddress: pending.address, createdAt: Date.now() });
        setCookie(res, "dw_session", token);

        pendingYellowJoins.delete(joinToken);

        await bestEffortSyncSignersToDoc({ docs: deps.docs, repo: deps.repo, docId: pending.docId });
        return sendJson(res, 200, { ok: true, signerAddress: pending.address, sessionKeyAddress: pending.sessionKeyAddress });
      }

      if (req.method === "POST" && url.pathname === "/api/cmd/decision") {
        const body = await readJsonBody(req);
        const docId = String(body.docId ?? "");
        const cmdId = String(body.cmdId ?? "");
        const decision = String(body.decision ?? "").toUpperCase();
        if (!docId || !cmdId) return sendJson(res, 400, { ok: false, error: "Missing docId/cmdId" });
        if (decision !== "APPROVE" && decision !== "REJECT") return sendJson(res, 400, { ok: false, error: "Invalid decision" });

        const session = getSession(req, sessions);
        if (!session || session.docId !== docId) return sendJson(res, 401, { ok: false, error: "Not signed in for this doc" });

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Command not found" });

        if (cmd.status !== "PENDING_APPROVAL") return sendJson(res, 409, { ok: false, error: `Cannot decide when status=${cmd.status}` });

        const priorDecision = deps.repo.getCommandApprovalDecision({ docId, cmdId, signerAddress: session.signerAddress });
        deps.repo.recordCommandApproval({ docId, cmdId, signerAddress: session.signerAddress, decision: decision as "APPROVE" | "REJECT" });

        if (decision === "APPROVE" && priorDecision?.decision !== "APPROVE") {
          deps.repo.incrementDocCounter(docId, "approvals_total", 1);
          deps.repo.incrementDocCounter(docId, "approval_tx_avoided", 1);
          deps.repo.setDocConfig(docId, "last_approval", `${new Date().toISOString()} ${session.signerAddress}`);
          await bestEffortSyncMetricsToDoc({ docs: deps.docs, repo: deps.repo, docId });
        }

        if (decision === "REJECT") {
          deps.repo.setCommandStatus(cmdId, "REJECTED", { errorText: null });
          await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId, updates: { status: "REJECTED", error: "" } });
          await bestEffortAudit(deps.docs, docId, `${cmdId} REJECTED by ${session.signerAddress}`);
          const wcReq = deps.repo.getWalletConnectRequestByCmdId(cmdId);
          if (wcReq) {
            deps.repo.setWalletConnectRequestStatus({ topic: wcReq.topic, requestId: wcReq.request_id, status: "REJECTED" });
            if (deps.walletconnect) {
              await deps.walletconnect.respondError(wcReq.topic, wcReq.request_id, "Rejected by quorum");
            }
          }
          deps.repo.clearCommandApprovals({ docId, cmdId });
          return sendJson(res, 200, { ok: true, status: "REJECTED" });
        }

        const quorum = deps.repo.getDocQuorum(docId);
        const signers = deps.repo.listSigners(docId);
        const weights = new Map(signers.map((s) => [s.address.toLowerCase(), s.weight]));
        const approvals = deps.repo.listCommandApprovals({ docId, cmdId }).filter((a) => a.decision === "APPROVE");
        const approvedWeight = approvals.reduce((sum, a) => sum + (weights.get(a.signer_address.toLowerCase()) ?? 0), 0);

        const approvedBy = approvals.filter((a) => a.decision === "APPROVE").map((a) => a.signer_address);
        await bestEffortUpdateCommandRow({
          docs: deps.docs,
          docId,
          cmdId,
          updates: { result: `Approvals=${approvedWeight}/${quorum}` }
        });

        if (approvedWeight >= quorum) {
          // If Yellow is enabled, it is the source-of-truth for approvals (no silent fallbacks).
          const yellow = deps.yellow;
          const yellowSession = deps.repo.getYellowSession(docId);
          const parsed = safeParseParsedJson(cmd.parsed_json);
          const isSessionCreate = parsed?.type === "SESSION_CREATE";

          if (yellow && !yellowSession && !isSessionCreate) {
            return sendJson(res, 409, { ok: false, error: "Yellow session not created. Run DW SESSION_CREATE first." });
          }

          let finalResult = `Approvals=${approvedWeight}/${quorum} ApprovedBy=${formatApproverList(approvedBy)} Gasless=YES`;
          if (yellow && yellowSession && !isSessionCreate) {
            const payload = { docId, cmdId, command: cmd.raw_command, ts: Date.now(), approvals: approvals.map((a) => a.signer_address) };
            const sessionData = keccak256(new TextEncoder().encode(JSON.stringify(payload)));

            const signerPrivateKeysHex: Array<`0x${string}`> = [];
            for (const a of approvals) {
              const keyRow = deps.repo.getYellowSessionKey({ docId, signerAddress: a.signer_address });
              if (!keyRow) return sendJson(res, 409, { ok: false, error: `Missing Yellow session key for signer ${a.signer_address}. Re-join via /join/<docId>.` });
              if (keyRow.expires_at <= Date.now()) return sendJson(res, 409, { ok: false, error: `Expired Yellow session key for signer ${a.signer_address}. Re-join via /join/<docId>.` });
              const plain = decryptWithMasterKey({ masterKey: deps.masterKey, blob: keyRow.encrypted_session_key_private });
              const parsed = JSON.parse(plain.toString("utf8")) as { privateKeyHex: `0x${string}` };
              signerPrivateKeysHex.push(parsed.privateKeyHex);
            }

            const nextVersion = (yellowSession.version ?? 0) + 1;

            // Load current allocations so the approval records real off-chain state
            const currentAllocations = JSON.parse(yellowSession.allocations_json || "[]");

            const out = await yellow.submitAppState({
              signerPrivateKeysHex,
              appSessionId: yellowSession.app_session_id,
              version: nextVersion,
              intent: "operate",
              sessionData,
              allocations: currentAllocations
            });
            deps.repo.setYellowSessionVersion({ docId, version: out.version, status: "OPEN" });

            finalResult += ` YellowSession=${yellowSession.app_session_id} YellowV=${out.version}`;
            await bestEffortAudit(deps.docs, docId, `${cmdId} Yellow submit_app_state v${out.version}`);
          }

          deps.repo.setCommandStatus(cmdId, "APPROVED", { errorText: null });
          await bestEffortUpdateCommandRow({
            docs: deps.docs,
            docId,
            cmdId,
            updates: { status: "APPROVED", error: "", result: finalResult }
          });
          await bestEffortAudit(deps.docs, docId, `${cmdId} APPROVED (quorum ${approvedWeight}/${quorum})`);

          deps.repo.clearCommandApprovals({ docId, cmdId });
          return sendJson(res, 200, { ok: true, status: "APPROVED" });
        }

        return sendJson(res, 200, { ok: true, status: "PENDING_APPROVAL", approvedWeight, quorum });
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

  server.listen(deps.port);
  return {
    url: deps.publicBaseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function bestEffortSyncSignersToDoc(params: { docs: docs_v1.Docs; repo: Repo; docId: string }) {
  const { docs, repo, docId } = params;
  try {
    const tables = await loadDocWalletTables({ docs, docId });
    const configMap = readConfig(tables.config.table);

    const signers = repo.listSigners(docId).map((s) => s.address);
    const quorum = repo.getDocQuorum(docId);

    if (configMap["SIGNERS"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "SIGNERS", value: signers.join(",") });
    }
    if (configMap["QUORUM"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "QUORUM", value: String(quorum) });
    }
  } catch {
    // ignore
  }
}

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
  try {
    const tables = await loadDocWalletTables({ docs, docId });
    const configMap = readConfig(tables.config.table);
    const approvalsTotal = repo.getDocCounter(docId, "approvals_total");
    const approvalTxAvoided = repo.getDocCounter(docId, "approval_tx_avoided");
    const gasPaid = repo.getDocConfig(docId, "signer_approval_gas_paid");
    const lastApproval = repo.getDocConfig(docId, "last_approval");
    const lastProposal = repo.getDocConfig(docId, "last_proposal");

    if (configMap["APPROVALS_TOTAL"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "APPROVALS_TOTAL", value: String(approvalsTotal) });
    }
    if (configMap["EST_APPROVAL_TX_AVOIDED"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "EST_APPROVAL_TX_AVOIDED", value: String(approvalTxAvoided) });
    }
    if (gasPaid && configMap["SIGNER_APPROVAL_GAS_PAID"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "SIGNER_APPROVAL_GAS_PAID", value: gasPaid });
    }
    if (lastApproval && configMap["LAST_APPROVAL"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "LAST_APPROVAL", value: lastApproval });
    }
    if (lastProposal && configMap["LAST_PROPOSAL"]) {
      await writeConfigValue({ docs, docId, configTable: tables.config.table, key: "LAST_PROPOSAL", value: lastProposal });
    }
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

function joinPageHtml(params: { docId: string }): string {
  const { docId } = params;
  return `
<div class="spacer-sm"></div>
<div class="card">
  <div class="card-header">
    <div>
      <h1>Join as Signer</h1>
      <div class="card-meta">Connect your wallet to become a multi-sig signer</div>
    </div>
    <span class="badge badge-blue">Onboarding</span>
  </div>

  <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:20px">
    <div class="card-meta" style="margin-bottom:2px">Document ID</div>
    <code style="font-size:.85rem">${escapeHtml(docId)}</code>
  </div>

  <div style="display:flex;flex-direction:column;gap:16px">
    <div>
      <div class="card-meta" style="margin-bottom:6px;font-weight:600;color:var(--gray-700)">Step 1 — Connect Wallet</div>
      <div class="row">
        <button class="btn btn-primary" id="connect">🦊 Connect MetaMask</button>
        <span class="card-meta">(or any injected EVM wallet)</span>
      </div>
    </div>

    <div>
      <div class="card-meta" style="margin-bottom:6px;font-weight:600;color:var(--gray-700)">Step 2 — Set Weight & Register</div>
      <div class="row">
        <label class="card-meta" for="weight">Signer Weight</label>
        <input class="input" id="weight" type="number" min="1" value="1" style="width:80px"/>
        <button class="btn btn-outline" id="join">Register Signer</button>
      </div>
    </div>
  </div>

  <div class="spacer"></div>
  <pre id="out" style="min-height:40px">Waiting for wallet connection…</pre>
</div>
<script>
let address = null;
const out = document.getElementById('out');
function log(x){ out.textContent = String(x); }
document.getElementById('connect').onclick = async () => {
  if(!window.ethereum) return log('No injected wallet found.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  address = accounts && accounts[0];
  log('Connected: ' + address);
};
document.getElementById('join').onclick = async () => {
  if(!address) return log('Connect a wallet first.');
  const weight = Number(document.getElementById('weight').value || '1');
  const start = await fetch('/api/join/start', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ docId:'${escapeJs(docId)}', address, weight }) });
  const startData = await start.json();
  if(!startData.ok) return log('Error: ' + startData.error);

  if(startData.mode === 'basic'){
    const sig = await window.ethereum.request({ method: 'personal_sign', params: [startData.message, address] });
    const finish = await fetch('/api/join/finish', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include',
      body: JSON.stringify({ mode:'basic', docId:'${escapeJs(docId)}', address, weight, message: startData.message, signature: sig }) });
    const data = await finish.json();
    if(!data.ok) return log('Error: ' + data.error);
    return log('Joined! You can now open approval links from the Doc.');
  }

  // Yellow delegated session key flow
  const typed = startData.typedData;
  const sig = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(typed)] });
  const finish = await fetch('/api/join/finish', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include',
    body: JSON.stringify({ mode:'yellow', joinToken: startData.joinToken, signature: sig }) });
  const data = await finish.json();
  if(!data.ok) return log('Error: ' + data.error);
  log('Joined (Yellow)! Session key: ' + data.sessionKeyAddress + '\\nYou can now open approval links from the Doc.');
};
</script>
`;
}

function cmdPageHtml(params: { docId: string; cmdId: string; signerAddress: string; raw: string; status: string }): string {
  const { docId, cmdId, signerAddress, raw, status } = params;
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

  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px">
    <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;flex:1;min-width:200px">
      <div class="card-meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Signer</div>
      <code style="font-size:.82rem">${escapeHtml(signerAddress)}</code>
    </div>
    <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;flex:1;min-width:200px">
      <div class="card-meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Command ID</div>
      <code style="font-size:.82rem" id="cmdId">${escapeHtml(cmdId)}</code>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <span class="badge badge-gray" id="approvalMode">WEB</span>
      <button class="btn btn-ghost btn-sm" id="copyLink">📋 Copy link</button>
    </div>
  </div>

  <div class="grid" style="margin-bottom:18px">
    <div class="card mini" style="border-left:3px solid var(--primary)">
      <div class="kpi-label">Action Summary</div>
      <div class="kpi" id="actionSummary" style="font-size:1.2rem">—</div>
      <div class="card-meta" id="actionRaw" style="margin-top:4px"></div>
    </div>
    <div class="card mini" style="border-left:3px solid #6366f1">
      <div class="kpi-label">Approval Progress</div>
      <div class="kpi" style="font-size:1.2rem"><span id="approvedWeight">0</span> <span style="font-weight:400;color:var(--gray-500)">of</span> <span id="quorum">0</span></div>
      <div class="progress"><span id="progressFill"></span></div>
      <div class="card-meta" id="approvedBy" style="margin-top:6px">No approvals yet</div>
    </div>
    <div class="card mini" style="border-left:3px solid var(--success)">
      <div class="kpi-label">Gasless Savings</div>
      <div class="kpi" id="gasSaved" style="font-size:1.2rem;color:var(--success)">0.000 ETH</div>
      <div class="card-meta"><span id="approvalsTotal">0</span> on-chain approvals avoided</div>
      <div class="card-meta" id="lastApproval"></div>
    </div>
  </div>

  <div class="kpi-label">Raw Command</div>
  <pre style="margin:6px 0 18px">${escapeHtml(raw)}</pre>

  <div class="row" style="margin-bottom:16px">
    <button class="btn btn-primary" id="approve">✓ Approve</button>
    <button class="btn btn-danger" id="reject">✕ Reject</button>
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
function shortAddr(addr){
  if(!addr) return '';
  return addr.slice(0,6) + '...' + addr.slice(-4);
}
async function decide(decision){
  const res = await fetch('/api/cmd/decision', { method:'POST', headers:{'content-type':'application/json'}, credentials:'include',
    body: JSON.stringify({ docId:'${escapeJs(docId)}', cmdId:'${escapeJs(cmdId)}', decision }) });
  const data = await res.json();
  if(!data.ok) return log('Error: ' + data.error);
  log('OK: ' + data.status);
}
document.getElementById('approve').onclick = () => decide('APPROVE');
document.getElementById('reject').onclick = () => decide('REJECT');
document.getElementById('copyLink').onclick = async () => {
  try{
    await navigator.clipboard.writeText(window.location.href);
    log('Copied link to clipboard');
  }catch(e){
    log('Copy failed');
  }
};
async function poll(){
  const res = await fetch('/api/cmd/${escapeJs(docId)}/${escapeJs(cmdId)}');
  const data = await res.json();
  if(!data.ok) return;
  const badge = document.getElementById('statusBadge');
  badge.textContent = data.cmd.status;
  const mode = document.getElementById('approvalMode');
  mode.textContent = data.approvalMode || 'WEB';
  mode.className = 'badge ' + (data.approvalMode === 'YELLOW' ? 'badge-ok' : 'badge-gray');
  const approvals = (data.approvals || []).filter(a => a.decision === 'APPROVE');
  const approvedWeight = data.approvedWeight || 0;
  const quorum = data.quorum || 0;
  document.getElementById('approvedWeight').textContent = String(approvedWeight);
  document.getElementById('quorum').textContent = String(quorum);
  const pct = quorum > 0 ? Math.min(100, Math.round((approvedWeight / quorum) * 100)) : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('approvedBy').textContent = approvals.length
    ? approvals.map(a => shortAddr(a.signer)).join(', ')
    : 'No approvals yet';
  document.getElementById('actionSummary').textContent = data.actionSummary || '—';
  document.getElementById('actionRaw').textContent = data.cmd.raw || '';
  document.getElementById('resultText').textContent = data.cmd.result || '';
  document.getElementById('errorText').textContent = data.cmd.error || '';
}
async function pollMetrics(){
  const res = await fetch('/api/metrics/${escapeJs(docId)}');
  const data = await res.json();
  if(!data.ok) return;
  const m = data.metrics || {};
  const approvalsTotal = Number(m.approvalsTotal || 0);
  const avoided = Number(m.approvalTxAvoided || approvalsTotal);
  const gasPer = Number(m.signerApprovalGasPaid || 0.003);
  const gasSaved = avoided * gasPer;
  document.getElementById('approvalsTotal').textContent = String(avoided);
  document.getElementById('gasSaved').textContent = gasSaved.toFixed(4) + ' ETH';
  document.getElementById('lastApproval').textContent = m.lastApproval ? ('Last approval: ' + m.lastApproval) : '';
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
  <div style="background:var(--gray-50);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:16px">
    <span class="card-meta">Document:</span> <code>${escapeHtml(docId)}</code>
  </div>
  <table>
    <thead>
      <tr><th>Command</th><th>Status</th><th>Result</th><th>Error</th></tr>
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
  const cls = s==='EXECUTED'?'badge-green':s==='REJECTED'?'badge-red':s==='PENDING_APPROVAL'?'badge-orange':'badge-gray';
  return '<span class="badge '+cls+'">'+esc(s)+'</span>';
}
async function load(){
  const res = await fetch('/api/activity/${escapeJs(docId)}');
  const data = await res.json();
  if(!data.ok) return;
  if(!data.commands.length){
    rows.innerHTML='';emptyState.style.display='block';return;
  }
  emptyState.style.display='none';
  rows.innerHTML = data.commands.map(c =>
    '<tr><td><code style="font-size:.8rem">'+esc(c.cmdId)+'</code><div class="card-meta" style="margin-top:2px">'+esc(c.raw)+'</div></td>' +
    '<td>'+statusBadge(c.status)+'</td><td style="font-size:.88rem">'+esc(c.result||'—')+'</td><td style="font-size:.88rem;color:var(--danger)">'+esc(c.error||'—')+'</td></tr>'
  ).join('');
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
  const { docId } = params;
  return `
<div class="spacer-lg"></div>
<div class="card" style="max-width:480px;margin:0 auto;text-align:center">
  <div style="font-size:3rem;margin-bottom:8px">🔒</div>
  <h1 style="margin-bottom:8px">Not Signed In</h1>
  <p style="color:var(--gray-500);margin-bottom:20px">You need to register as a signer before you can approve commands.</p>
  <a href="/join/${encodeURIComponent(docId)}" class="btn btn-primary">Join this Doc</a>
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
    case "SETUP": return "Setup wallets";
    case "STATUS": return "Show status";
    case "SESSION_CREATE": return "Open Yellow session";
    case "SESSION_CLOSE": return "Close Yellow session";
    case "SESSION_STATUS": return "Show Yellow session status";
    case "SIGNER_ADD": return `Add signer ${shortAddress(cmd.address)} (weight ${cmd.weight})`;
    case "QUORUM": return `Set quorum to ${cmd.quorum}`;
    case "CONNECT": return "Connect WalletConnect session";
    case "WC_TX": return `WalletConnect tx to ${shortAddress(cmd.to)}`;
    case "WC_SIGN": return `WalletConnect sign as ${shortAddress(cmd.address)}`;
    case "LIMIT_BUY": return `Limit buy ${cmd.qty} ${cmd.base} @ ${cmd.price} ${cmd.quote}`;
    case "LIMIT_SELL": return `Limit sell ${cmd.qty} ${cmd.base} @ ${cmd.price} ${cmd.quote}`;
    case "MARKET_BUY": return `Market buy ${cmd.qty} ${cmd.base}`;
    case "MARKET_SELL": return `Market sell ${cmd.qty} ${cmd.base}`;
    case "DEPOSIT": return `Deposit ${cmd.amount} ${cmd.coinType}`;
    case "WITHDRAW": return `Withdraw ${cmd.amount} ${cmd.coinType}`;
    case "CANCEL": return `Cancel order ${cmd.orderId}`;
    case "SETTLE": return "Settle orders";
    case "PAYOUT": return `Payout ${cmd.amountUsdc} USDC to ${shortAddress(cmd.to)}`;
    case "PAYOUT_SPLIT": return `Split payout ${cmd.amountUsdc} USDC to ${cmd.recipients.length} recipients`;
    case "POLICY_ENS": return `Set policy from ${cmd.ensName}`;
    case "SCHEDULE": return `Schedule every ${cmd.intervalHours}h: ${cmd.innerCommand}`;
    case "CANCEL_SCHEDULE": return `Cancel schedule ${cmd.scheduleId}`;
    case "BRIDGE": return `CCTP Bridge ${cmd.amountUsdc} USDC ${cmd.fromChain} → ${cmd.toChain}`;
    case "ALERT_THRESHOLD": return `Alert when ${cmd.coinType} < ${cmd.below}`;
    case "AUTO_REBALANCE": return `Auto-rebalance ${cmd.enabled ? "ON" : "OFF"}`;
    case "YELLOW_SEND": return `⚡ Yellow send ${cmd.amountUsdc} USDC to ${shortAddress(cmd.to)} (gasless, off-chain)`;
    case "STOP_LOSS": return `🛡️ Stop-loss ${cmd.qty} ${cmd.base} @ ${cmd.triggerPrice}`;
    case "TAKE_PROFIT": return `📈 Take-profit ${cmd.qty} ${cmd.base} @ ${cmd.triggerPrice}`;
    case "SWEEP_YIELD": return "🧹 Sweep yield (settle + consolidate cross-chain)";
    case "TRADE_HISTORY": return "📊 Show trade history & P&L";
    case "PRICE": return "💹 Show live DeepBook price";
    case "CANCEL_ORDER": return `Cancel conditional order ${cmd.orderId}`;
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
