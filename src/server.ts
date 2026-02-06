import http from "node:http";
import { randomBytes } from "node:crypto";
import type { docs_v1 } from "googleapis";
import { keccak256, recoverMessageAddress } from "viem";
import { Repo } from "./db/repo.js";
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
        const rows = docs
          .map((d) => {
            const joinUrl = `${deps.publicBaseUrl}/join/${encodeURIComponent(d.doc_id)}`;
            const signersUrl = `${deps.publicBaseUrl}/signers/${encodeURIComponent(d.doc_id)}`;
            const activityUrl = `${deps.publicBaseUrl}/activity/${encodeURIComponent(d.doc_id)}`;
            const sessionsUrl = `${deps.publicBaseUrl}/sessions/${encodeURIComponent(d.doc_id)}`;
            return `<li><code>${escapeHtml(d.name ?? d.doc_id)}</code><br/>` +
              `<a href="${joinUrl}">Join</a> · <a href="${signersUrl}">Signers</a> · <a href="${activityUrl}">Activity</a> · <a href="${sessionsUrl}">Sessions</a></li>`;
          })
          .join("\n");

        return sendHtml(
          res,
          "DocWallet",
          `<h1>DocWallet</h1><p>Docs discovered: ${docs.length}</p><ul>${rows}</ul>`
        );
      }

      const activityPageMatch = matchPath(url.pathname, ["activity", ":docId"]);
      if (req.method === "GET" && activityPageMatch) {
        const docId = decodeURIComponent(activityPageMatch.docId);
        return sendHtml(res, "Activity", activityPageHtml({ docId }));
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
        return sendJson(res, 200, {
          ok: true,
          cmd: {
            cmdId: cmd.cmd_id,
            raw: cmd.raw_command,
            status: cmd.status,
            result: cmd.result_text,
            error: cmd.error_text
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
        const rows = signers
          .map((s) => `<tr><td><code>${escapeHtml(s.address)}</code></td><td>${s.weight}</td></tr>`)
          .join("\n");
        return sendHtml(
          res,
          "Signers",
          `<h1>Signers</h1><p><code>${escapeHtml(docId)}</code></p><p>Quorum: <b>${quorum}</b></p>` +
            `<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Address</th><th>Weight</th></tr></thead><tbody>${rows}</tbody></table>`
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
        const message = `DocWallet join\\nDocId: ${docId}\\nAddress: ${address}\\nWeight: ${weight}\\nNonce: ${nonce}`;
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

        deps.repo.recordCommandApproval({ docId, cmdId, signerAddress: session.signerAddress, decision: decision as "APPROVE" | "REJECT" });

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
            const out = await yellow.submitAppState({
              signerPrivateKeysHex,
              appSessionId: yellowSession.app_session_id,
              version: nextVersion,
              intent: "operate",
              sessionData
            });
            deps.repo.setYellowSessionVersion({ docId, version: out.version, status: "OPEN" });

            await bestEffortUpdateCommandRow({
              docs: deps.docs,
              docId,
              cmdId,
              updates: { result: `Approvals=${approvedWeight}/${quorum} YellowSession=${yellowSession.app_session_id} YellowV=${out.version}` }
            });
            await bestEffortAudit(deps.docs, docId, `${cmdId} Yellow submit_app_state v${out.version}`);
          }

          deps.repo.setCommandStatus(cmdId, "APPROVED", { errorText: null });
          await bestEffortUpdateCommandRow({ docs: deps.docs, docId, cmdId, updates: { status: "APPROVED", error: "" } });
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
  res.end(`<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(title)}</title>
<style>
:root{
  --blue:#1a73e8;
  --blue-weak:#e8f0fe;
  --gray-900:#202124;
  --gray-700:#5f6368;
  --gray-200:#e0e0e0;
  --bg:#f8f9fa;
  --card:#fff;
  --radius:14px;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--bg); color:var(--gray-900);
  font-family: "Google Sans", "Product Sans", "Segoe UI", Roboto, Arial, sans-serif;
}
.container{max-width:980px;margin:24px auto;padding:0 16px}
.card{background:var(--card); border:1px solid var(--gray-200); border-radius:var(--radius); padding:18px; box-shadow:0 1px 2px rgba(0,0,0,0.04)}
.row{display:flex; gap:12px; align-items:center; flex-wrap:wrap}
.btn{
  padding:10px 14px;border-radius:10px;border:1px solid var(--blue); background:var(--blue); color:#fff;
  cursor:pointer; font-weight:600
}
.btn.secondary{background:#fff;color:var(--blue)}
.btn.ghost{border-color:var(--gray-200);background:#fff;color:var(--gray-900)}
.input{
  padding:10px 12px;border-radius:10px;border:1px solid var(--gray-200); min-width:160px
}
.muted{color:var(--gray-700); font-size:0.9rem}
.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:var(--blue-weak);color:var(--blue);font-size:0.8rem}
code{background:#f1f3f4;padding:2px 6px;border-radius:6px}
pre{background:#f1f3f4;padding:12px;border-radius:12px;white-space:pre-wrap}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--gray-200);padding:8px;text-align:left;font-size:0.95rem}
thead th{background:#f1f3f4}
</style>
</head><body><div class="container">${body}</div></body></html>`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function joinPageHtml(params: { docId: string }): string {
  const { docId } = params;
  return `
<div class="card">
  <div class="row" style="justify-content:space-between">
    <div>
      <h1 style="margin:0">Join DocWallet</h1>
      <div class="muted">Doc: <code>${escapeHtml(docId)}</code></div>
    </div>
    <span class="badge">Signer Onboarding</span>
  </div>
  <div style="height:16px"></div>
  <div class="row">
    <button class="btn" id="connect">Connect wallet</button>
    <span class="muted">(MetaMask / injected EVM wallet)</span>
  </div>
  <div style="height:12px"></div>
  <div class="row">
    <label>Weight</label>
    <input class="input" id="weight" type="number" min="1" value="1"/>
    <button class="btn secondary" id="join">Register signer</button>
  </div>
  <div style="height:12px"></div>
  <pre id="out"></pre>
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
<div class="card">
  <div class="row" style="justify-content:space-between">
    <div>
      <h1 style="margin:0">Approve Command</h1>
      <div class="muted">Doc: <code>${escapeHtml(docId)}</code></div>
    </div>
    <span class="badge" id="statusBadge">${escapeHtml(status)}</span>
  </div>
  <div style="height:10px"></div>
  <div class="row">
    <div>Signer: <code>${escapeHtml(signerAddress)}</code></div>
    <div>Command ID: <code id="cmdId">${escapeHtml(cmdId)}</code></div>
    <button class="btn ghost" id="copyLink">Copy link</button>
  </div>
  <div style="height:12px"></div>
  <div class="muted">Command</div>
  <pre>${escapeHtml(raw)}</pre>
  <div class="row">
    <button class="btn" id="approve">Approve</button>
    <button class="btn secondary" id="reject">Reject</button>
  </div>
  <div style="height:12px"></div>
  <pre id="out"></pre>
</div>
<script>
const out = document.getElementById('out');
function log(x){ out.textContent = String(x); }
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
}
setInterval(poll, 3000);
</script>
`;
}

function activityPageHtml(params: { docId: string }): string {
  const { docId } = params;
  return `
<div class="card">
  <div class="row" style="justify-content:space-between">
    <div>
      <h1 style="margin:0">Activity Feed</h1>
      <div class="muted">Doc: <code>${escapeHtml(docId)}</code></div>
    </div>
    <span class="badge">Live</span>
  </div>
  <div style="height:12px"></div>
  <table>
    <thead>
      <tr><th>Command</th><th>Status</th><th>Result</th><th>Error</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
</div>
<script>
const rows = document.getElementById('rows');
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function load(){
  const res = await fetch('/api/activity/${escapeJs(docId)}');
  const data = await res.json();
  if(!data.ok) return;
  rows.innerHTML = data.commands.map(c =>
    '<tr><td><code>'+esc(c.cmdId)+'</code><div class="muted">'+esc(c.raw)+'</div></td>' +
    '<td>'+esc(c.status)+'</td><td>'+esc(c.result||'')+'</td><td>'+esc(c.error||'')+'</td></tr>'
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
<div class="card">
  <div class="row" style="justify-content:space-between">
    <div>
      <h1 style="margin:0">Sessions & Schedules</h1>
      <div class="muted">Doc: <code>${escapeHtml(docId)}</code></div>
    </div>
    <span class="badge">Live</span>
  </div>
  <div style="height:12px"></div>
  <h2>WalletConnect Sessions</h2>
  <table>
    <thead>
      <tr><th>Peer</th><th>Chains</th><th>Status</th><th>Connected</th><th>Action</th></tr>
    </thead>
    <tbody id="wc-sessions"></tbody>
  </table>
  <div style="height:12px"></div>
  <h2>Pending WC Requests</h2>
  <table>
    <thead>
      <tr><th>Method</th><th>Command ID</th><th>Status</th><th>Time</th></tr>
    </thead>
    <tbody id="wc-requests"></tbody>
  </table>
  <div style="height:12px"></div>
  <h2>Active Schedules (DCA)</h2>
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
async function load(){
  const res = await fetch('/api/sessions/${escapeJs(docId)}');
  const data = await res.json();
  if(!data.ok) return;
  wcSessions.innerHTML = data.sessions.map(s =>
    '<tr><td>'+esc(s.peerName||'Unknown')+'</td><td>'+esc(s.chains||'')+'</td><td><span class="badge'+(s.status==='ACTIVE'?' badge-ok':'')+'">'+esc(s.status)+'</span></td>' +
    '<td>'+new Date(s.createdAt).toLocaleString()+'</td>' +
    '<td>'+(s.status==='ACTIVE'?'<button onclick="disconnect(\\''+esc(s.topic)+'\\')">Disconnect</button>':'—')+'</td></tr>'
  ).join('') || '<tr><td colspan="5" class="muted">No sessions</td></tr>';

  wcRequests.innerHTML = data.pendingRequests.map(r =>
    '<tr><td>'+esc(r.method)+'</td><td><code>'+esc(r.cmdId)+'</code></td><td>'+esc(r.status)+'</td>' +
    '<td>'+new Date(r.createdAt).toLocaleString()+'</td></tr>'
  ).join('') || '<tr><td colspan="4" class="muted">No pending requests</td></tr>';

  schedulesEl.innerHTML = data.schedules.map(s =>
    '<tr><td><code>'+esc(s.scheduleId)+'</code></td><td>Every '+s.intervalHours+'h</td>' +
    '<td><code>'+esc(s.innerCommand)+'</code></td><td>'+s.totalRuns+'</td>' +
    '<td>'+new Date(s.nextRunAt).toLocaleString()+'</td>' +
    '<td><span class="badge'+(s.status==='ACTIVE'?' badge-ok':'')+'">'+esc(s.status)+'</span></td></tr>'
  ).join('') || '<tr><td colspan="6" class="muted">No active schedules</td></tr>';
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
  return `<h1>Not signed in</h1>
<p>Open the join page first to register your signer session:</p>
<p><a href="/join/${encodeURIComponent(docId)}">Join this doc</a></p>`;
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
