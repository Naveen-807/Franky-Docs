import http from "node:http";
import type { docs_v1 } from "googleapis";
import { Repo } from "./db/repo.js";
import { loadDocWalletTables, readCommandsTable, updateCommandsRowCells, appendAuditRow } from "./google/docwallet.js";
import { loadDocSecrets } from "./wallet/store.js";

type ServerDeps = {
  docs: docs_v1.Docs;
  repo: Repo;
  masterKey: string;
  port: number;
  publicBaseUrl: string;
  demoMode?: boolean;
};

export function startServer(deps: ServerDeps) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (req.method === "GET" && url.pathname === "/") {
        const docs = deps.repo.listDocs();
        const totalPending = deps.repo.countPendingCommands();
        const totalSchedules = deps.repo.countActiveSchedules();

        const cards = docs.length > 0
          ? docs.map((d) => {
              const secrets = loadDocSecrets({
                repo: deps.repo,
                masterKey: deps.masterKey,
                docId: d.doc_id
              });
              const stxAddr = secrets?.stx?.stxAddress ?? "(run DW SETUP)";
              return `
<div class="card">
  <div class="row">
    <div>
      <h3 style="margin:0">${escapeHtml(d.name ?? d.doc_id)}</h3>
      <div class="meta"><code>${escapeHtml(d.doc_id)}</code></div>
    </div>
    <a class="btn" href="/activity/${encodeURIComponent(d.doc_id)}">Activity</a>
  </div>
  <div class="meta" style="margin-top:8px"><strong>STX:</strong> <code>${escapeHtml(stxAddr)}</code></div>
  <div class="meta"><strong>EVM:</strong> <code>${escapeHtml(d.evm_address ?? "(not set)")}</code></div>
</div>`;
            }).join("\n")
          : `<div class="card"><p>No documents tracked yet.</p></div>`;

        const commandsRef = `
<div class="card" style="margin-top:20px">
  <h3 style="margin-top:0">📘 Command Reference</h3>
  <div style="display:grid; gap:8px">
    <details>
      <summary style="cursor:pointer;font-weight:500">Core Commands</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW SETUP</code> — Initialize STX + EVM wallets for this document<br>
        <code>DW STATUS</code> — View runtime status<br>
        <code>DW TREASURY</code> — Show all wallet balances
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;font-weight:500">STX Transactions</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW STX_SEND &lt;address&gt; &lt;microSTX&gt;</code><br>
        <code>DW STX_BALANCE</code> — View STX balance<br>
        <code>DW STX_PRICE</code> — Fetch current STX/USD price<br>
        <code>DW STX_HISTORY [limit]</code> — Recent transactions
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;font-weight:500; color:#f97316">sBTC Commands</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW SBTC_BALANCE</code> — View sBTC balance<br>
        <code>DW SBTC_SEND &lt;address&gt; &lt;sats&gt;</code><br>
        <code>DW SBTC_INFO</code> — sBTC contract info &amp; supply
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;font-weight:500; color:#2563eb">USDCx Commands</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW USDCX_BALANCE</code> — View USDCx balance<br>
        <code>DW USDCX_SEND &lt;address&gt; &lt;amount&gt;</code><br>
        <code>DW USDCX_APPROVE &lt;spender&gt; &lt;amount&gt;</code><br>
        <code>DW USDCX_PAYMENT &lt;amount&gt; "&lt;description&gt;"</code>
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;font-weight:500; color:#7c3aed">x402 Protocol</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW X402_CALL &lt;url&gt; [method]</code> — Pay-and-call HTTP 402 resource<br>
        <code>DW X402_STATUS &lt;txid&gt;</code> — Check payment transaction status
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;font-weight:500; color:#16a34a">Clarity Contracts</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW CONTRACT_CALL &lt;addr&gt;.&lt;name&gt; &lt;function&gt; [args...]</code><br>
        <code>DW CONTRACT_READ &lt;addr&gt;.&lt;name&gt; &lt;function&gt; [args...]</code>
      </div>
    </details>
    <details>
      <summary style="cursor:pointer;font-weight:500; color:#ea580c">Stacking</summary>
      <div style="padding-left:16px; margin-top:8px">
        <code>DW STACK_STX &lt;amountSTX&gt; &lt;cycles&gt;</code><br>
        <code>DW STACK_STATUS</code> — View current stacking position
      </div>
    </details>
  </div>
</div>`;

        return sendHtml(res, "FrankyDocs Stacks", `
<div style="background:linear-gradient(135deg,#5546ff 0%,#f97316 100%); color:#fff; padding:18px; border-radius:12px; margin-bottom:20px">
  <h2 style="margin:0; font-size:1.8rem">⚡ FrankyDocs Stacks</h2>
  <p style="margin:4px 0 0 0; opacity:0.95">Stacks/Bitcoin automation for Google Docs — STX, sBTC, USDCx, x402</p>
</div>
<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:20px">
  <div class="stat-card">
    <div class="stat-label">Documents</div>
    <div class="stat-value">${docs.length}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Pending Commands</div>
    <div class="stat-value">${totalPending}</div>
  </div>
  <div class="stat-card">
    <div class="stat-label">Active Schedules</div>
    <div class="stat-value">${totalSchedules}</div>
  </div>
</div>
<h2>Documents</h2>
<div class="grid">${cards}</div>
${commandsRef}
<footer style="margin-top:40px; padding-top:20px; border-top:1px solid var(--border); text-align:center; color:var(--muted); font-size:0.9rem">
  Powered by <a href="https://hiro.so" target="_blank" style="color:#5546ff; text-decoration:none; font-weight:500">Hiro API</a> • Stacks Testnet • STX + sBTC + USDCx + x402
</footer>`);
      }

      const activityMatch = matchPath(url.pathname, ["activity", ":docId"]);
      if (req.method === "GET" && activityMatch) {
        const docId = decodeURIComponent(activityMatch.docId);
        const rows = deps.repo.listRecentCommands(docId, 100);
        const tableRows = rows.map((r) => `
<tr>
  <td><code>${escapeHtml(r.cmd_id)}</code></td>
  <td>${escapeHtml(r.raw_command)}</td>
  <td>${escapeHtml(r.status)}</td>
  <td>${escapeHtml(r.result_text ?? "")}</td>
  <td>${escapeHtml(r.error_text ?? "")}</td>
  <td><a href="/cmd/${encodeURIComponent(docId)}/${encodeURIComponent(r.cmd_id)}">Open</a></td>
</tr>`).join("\n");
        return sendHtml(res, "Activity", `
<h1>Command Activity</h1>
<p><a href="/">← Back</a></p>
<table>
  <thead>
    <tr><th>ID</th><th>Command</th><th>Status</th><th>Result</th><th>Error</th><th>Action</th></tr>
  </thead>
  <tbody>
    ${tableRows || `<tr><td colspan="6">No commands yet.</td></tr>`}
  </tbody>
</table>`);
      }

      const cmdMatch = matchPath(url.pathname, ["cmd", ":docId", ":cmdId"]);
      if (req.method === "GET" && cmdMatch) {
        const docId = decodeURIComponent(cmdMatch.docId);
        const cmdId = decodeURIComponent(cmdMatch.cmdId);
        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) return sendJson(res, 404, { ok: false, error: "Command not found" });

        const parsed = cmd.parsed_json ? JSON.parse(cmd.parsed_json) : null;
        const summary = parsed ? describeCommand(parsed) : "Unparsed command";

        return sendHtml(res, "Command Decision", `
<h1>Command Decision</h1>
<p><a href="/activity/${encodeURIComponent(docId)}">← Back</a></p>
<div class="card">
  <div><strong>ID:</strong> <code>${escapeHtml(cmd.cmd_id)}</code></div>
  <div><strong>Status:</strong> ${escapeHtml(cmd.status)}</div>
  <div><strong>Raw:</strong> <code>${escapeHtml(cmd.raw_command)}</code></div>
  <div style="margin-top:8px"><strong>Summary:</strong> ${escapeHtml(summary)}</div>
</div>
<div class="row" style="margin-top:14px">
  <button class="btn btn-approve" onclick="decide('APPROVED')">Approve</button>
  <button class="btn btn-reject" onclick="decide('REJECTED')">Reject</button>
</div>
<script>
async function decide(decision) {
  const res = await fetch('/api/command-decision', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({ docId: ${JSON.stringify(docId)}, cmdId: ${JSON.stringify(cmdId)}, decision })
  });
  const json = await res.json();
  if (!json.ok) {
    alert('Failed: ' + (json.error || 'unknown'));
    return;
  }
  location.href = '/activity/' + encodeURIComponent(${JSON.stringify(docId)});
}
</script>`);
      }

      if (req.method === "GET" && url.pathname === "/api/docs") {
        const allDocs = deps.repo.listDocs();
        const payload = allDocs.map((d) => {
          const secrets = loadDocSecrets({ repo: deps.repo, masterKey: deps.masterKey, docId: d.doc_id });
          const stxAddress = secrets?.stx?.stxAddress ?? null;
          return {
            docId: d.doc_id,
            name: d.name,
            evmAddress: d.evm_address,
            stxAddress
          };
        });
        return sendJson(res, 200, { ok: true, docs: payload });
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        const allDocs = deps.repo.listDocs();
        const totalPending = deps.repo.countPendingCommands();
        const totalSchedules = deps.repo.countActiveSchedules();
        const totalPayments = deps.repo.countStacksPaymentRequests();
        const totalX402 = deps.repo.countX402Receipts();
        const totalContracts = deps.repo.countContractCalls();

        return sendJson(res, 200, {
          ok: true,
          status: {
            uptime: process.uptime(),
            documents: allDocs.length,
            pendingCommands: totalPending,
            activeSchedules: totalSchedules,
            paymentRequests: totalPayments,
            x402Receipts: totalX402,
            contractCalls: totalContracts,
            mode: "Stacks"
          }
        });
      }

      if (req.method === "POST" && url.pathname === "/api/command-decision") {
        const body = await readJson(req);
        const docId = typeof body?.docId === "string" ? body.docId : "";
        const cmdId = typeof body?.cmdId === "string" ? body.cmdId : "";
        const decision = typeof body?.decision === "string" ? body.decision.toUpperCase() : "";
        if (!docId || !cmdId || !["APPROVED", "REJECTED"].includes(decision)) {
          return sendJson(res, 400, { ok: false, error: "Invalid payload" });
        }

        const cmd = deps.repo.getCommand(cmdId);
        if (!cmd || cmd.doc_id !== docId) {
          return sendJson(res, 404, { ok: false, error: "Command not found" });
        }

        if (decision === "APPROVED") {
          deps.repo.setCommandStatus(cmdId, "APPROVED");
          await writeDocCommandStatus(deps.docs, docId, cmdId, "APPROVED", "");
          await appendAuditRow({
            docs: deps.docs,
            docId,
            timestampIso: new Date().toISOString(),
            message: `${cmdId} APPROVED (web)`
          });
          return sendJson(res, 200, { ok: true });
        }

        deps.repo.setCommandStatus(cmdId, "REJECTED", { errorText: "Rejected via web UI" });
        await writeDocCommandStatus(deps.docs, docId, cmdId, "REJECTED", "Rejected via web UI");
        await appendAuditRow({
          docs: deps.docs,
          docId,
          timestampIso: new Date().toISOString(),
          message: `${cmdId} REJECTED (web)`
        });
        return sendJson(res, 200, { ok: true });
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: (err as Error).message });
    }
  });

  server.listen(deps.port, () => {
    console.log(`[server] listening on ${deps.publicBaseUrl}`);
  });
}

async function writeDocCommandStatus(
  docs: docs_v1.Docs,
  docId: string,
  cmdId: string,
  status: string,
  error: string
) {
  const tables = await loadDocWalletTables({ docs, docId });
  const rows = readCommandsTable(tables.commands.table);
  const row = rows.find((r) => r.id === cmdId);
  if (!row) return;
  await updateCommandsRowCells({
    docs,
    docId,
    commandsTable: tables.commands.table,
    rowIndex: row.rowIndex,
    updates: { status, error, approvalUrl: "" }
  });
}

function describeCommand(cmd: any): string {
  if (!cmd || typeof cmd !== "object" || typeof cmd.type !== "string") return "Unknown command";
  switch (cmd.type) {
    case "SETUP":
      return "Create STX + EVM wallets for this document";
    case "STATUS":
      return "Display runtime status";
    case "TREASURY":
      return "Show all wallet balances (STX, sBTC, USDCx)";
    // STX
    case "STX_PRICE":
      return "Fetch STX/USD price";
    case "STX_BALANCE":
      return "View STX balance";
    case "STX_SEND":
      return `Send ${cmd.amountMicroStx ?? "?"} microSTX to ${shortAddress(cmd.to)}`;
    case "STX_HISTORY":
      return `Show last ${cmd.limit ?? 10} transactions`;
    case "STX_STOP_LOSS":
      return `Create STX stop-loss at $${cmd.triggerPrice}`;
    case "STX_TAKE_PROFIT":
      return `Create STX take-profit at $${cmd.triggerPrice}`;
    // sBTC
    case "SBTC_BALANCE":
      return "View sBTC balance";
    case "SBTC_SEND":
      return `Send ${cmd.amountSats ?? "?"} sats sBTC to ${shortAddress(cmd.to)}`;
    case "SBTC_INFO":
      return "sBTC contract info and total supply";
    // USDCx
    case "USDCX_BALANCE":
      return "View USDCx balance";
    case "USDCX_SEND":
      return `Send ${cmd.amount ?? "?"} USDCx to ${shortAddress(cmd.to)}`;
    case "USDCX_APPROVE":
      return `Approve ${cmd.amount ?? "?"} USDCx for ${shortAddress(cmd.spender)}`;
    case "USDCX_PAYMENT":
      return `Create USDCx payment request for $${cmd.amount ?? "?"}: "${cmd.description ?? ""}"`;
    // x402
    case "X402_CALL":
      return `Pay-and-call ${cmd.url ?? "?"} via x402 protocol`;
    case "X402_STATUS":
      return `Check x402 payment status for txid ${shortAddress(cmd.txid)}`;
    // Contracts
    case "CONTRACT_CALL":
      return `Call ${shortAddress(cmd.contractAddress)}.${cmd.contractName ?? "?"}::${cmd.functionName ?? "?"}`;
    case "CONTRACT_READ":
      return `Read ${shortAddress(cmd.contractAddress)}.${cmd.contractName ?? "?"}::${cmd.functionName ?? "?"}`;
    // Stacking
    case "STACK_STX":
      return `Stack ${cmd.amountStx ?? "?"} STX for ${cmd.cycles ?? "?"} cycles`;
    case "STACK_STATUS":
      return "View stacking position";
    // Scheduling
    case "SCHEDULE":
      return `Schedule "${cmd.innerCommand}" every ${cmd.intervalHours}h`;
    case "CANCEL_SCHEDULE":
      return `Cancel schedule ${cmd.scheduleId ?? "?"}`;
    case "ALERT_THRESHOLD":
      return `Alert when ${cmd.coinType ?? "?"} < ${cmd.below ?? "?"}`;
    case "AUTO_REBALANCE":
      return `Auto-rebalance ${cmd.enabled ? "ON" : "OFF"}`;
    case "CANCEL_ORDER":
      return `Cancel order ${cmd.orderId ?? "?"}`;
    default:
      return `${cmd.type} command`;
  }
}

function shortAddress(addr?: string): string {
  if (!addr) return "(none)";
  if (addr.length <= 18) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(body);
}

function sendHtml(res: http.ServerResponse, title: string, body: string) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --border:#e2e8f0; --text:#0f172a; --muted:#64748b; --bg:#f8fafc; --card:#fff; }
    body { margin:0; font-family: ui-sans-serif,system-ui,-apple-system,sans-serif; color:var(--text); background:var(--bg); }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit,minmax(300px,1fr)); }
    .card { background:var(--card); border:1px solid var(--border); border-radius:12px; padding:14px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .stat-card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:14px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .stat-label { color:var(--muted); font-size:0.85rem; margin-bottom:6px; }
    .stat-value { font-size:2rem; font-weight:700; color:#16a34a; }
    .row { display:flex; align-items:center; gap:12px; justify-content:space-between; }
    .meta { color:var(--muted); font-size:.9rem; }
    .btn { border:1px solid var(--border); background:#fff; border-radius:8px; padding:8px 12px; cursor:pointer; text-decoration:none; color:inherit; display:inline-block; }
    .btn:hover { background:#f1f5f9; }
    .btn-approve { background:#e8f5e9; border-color:#86efac; }
    .btn-reject { background:#fef2f2; border-color:#fca5a5; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--border); border-radius:10px; overflow:hidden; }
    th,td { padding:8px; border-bottom:1px solid var(--border); text-align:left; vertical-align:top; font-size:.9rem; }
    th { background:#f1f5f9; font-weight:600; }
    code { background:#f1f5f9; padding:2px 6px; border-radius:6px; font-size:0.85rem; }
    details summary { font-weight:500; padding:6px 0; }
    a { color:#0ea5e9; }
  </style>
</head>
<body><div class="wrap">${body}</div></body></html>`);
}

function matchPath(pathname: string, pattern: string[]): Record<string, string> | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== pattern.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const v = parts[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = v;
    else if (p !== v) return null;
  }
  return params;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
