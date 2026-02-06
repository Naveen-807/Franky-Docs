import type { docs_v1 } from "googleapis";
import { batchUpdateDoc, findAnchor, findNextTable, getDoc, buildWriteCellRequests, tableCellStartIndex, paragraphPlainText, tableCellRange } from "./docs.js";

export const DOCWALLET_CONFIG_ANCHOR = "DOCWALLET_CONFIG_ANCHOR";
export const DOCWALLET_COMMANDS_ANCHOR = "DOCWALLET_COMMANDS_ANCHOR";
export const DOCWALLET_CHAT_ANCHOR = "DOCWALLET_CHAT_ANCHOR";
export const DOCWALLET_BALANCES_ANCHOR = "DOCWALLET_BALANCES_ANCHOR";
export const DOCWALLET_OPEN_ORDERS_ANCHOR = "DOCWALLET_OPEN_ORDERS_ANCHOR";
export const DOCWALLET_RECENT_ACTIVITY_ANCHOR = "DOCWALLET_RECENT_ACTIVITY_ANCHOR";
export const DOCWALLET_SESSIONS_ANCHOR = "DOCWALLET_SESSIONS_ANCHOR";
export const DOCWALLET_AUDIT_ANCHOR = "DOCWALLET_AUDIT_ANCHOR";

export type DocWalletTemplate = {
  config: { anchor: typeof DOCWALLET_CONFIG_ANCHOR; table: docs_v1.Schema$Table };
  commands: { anchor: typeof DOCWALLET_COMMANDS_ANCHOR; table: docs_v1.Schema$Table };
  chat: { anchor: typeof DOCWALLET_CHAT_ANCHOR; table: docs_v1.Schema$Table };
  balances: { anchor: typeof DOCWALLET_BALANCES_ANCHOR; table: docs_v1.Schema$Table };
  openOrders: { anchor: typeof DOCWALLET_OPEN_ORDERS_ANCHOR; table: docs_v1.Schema$Table };
  recentActivity: { anchor: typeof DOCWALLET_RECENT_ACTIVITY_ANCHOR; table: docs_v1.Schema$Table };
  sessions: { anchor: typeof DOCWALLET_SESSIONS_ANCHOR; table: docs_v1.Schema$Table };
  audit: { anchor: typeof DOCWALLET_AUDIT_ANCHOR; table: docs_v1.Schema$Table };
};

function mustGetTable(templateDoc: docs_v1.Schema$Document, anchorText: string) {
  const anchor = findAnchor(templateDoc, anchorText);
  if (!anchor) throw new Error(`Missing anchor ${anchorText} after template insertion`);
  const next = findNextTable(templateDoc, anchor.elementIndex);
  if (!next?.table) throw new Error(`Missing table after anchor ${anchorText}`);
  return next.table;
}

async function ensureMinTableRows(params: {
  docs: docs_v1.Docs;
  docId: string;
  anchorText: string;
  minRows: number;
}) {
  const { docs, docId, anchorText, minRows } = params;
  const doc = await getDoc(docs, docId);
  const anchor = findAnchor(doc, anchorText);
  if (!anchor) return;
  const info = findNextTable(doc, anchor.elementIndex);
  if (!info?.table) return;

  const currentRows = (info.table.tableRows ?? []).length;
  if (currentRows >= minRows) return;

  const requests: docs_v1.Schema$Request[] = [];
  for (let r = currentRows; r < minRows; r++) {
    const rowIndex = Math.max(0, r - 1);
    requests.push({
      insertTableRow: {
        tableCellLocation: {
          tableStartLocation: { index: info.startIndex },
          rowIndex,
          columnIndex: 0
        },
        insertBelow: true
      }
    });
  }
  await batchUpdateDoc({ docs, docId, requests });
}

/**
 * If the doc has multiple copies of the template text (from previous failed runs),
 * delete everything after the first complete block to clean up the mess.
 */
async function removeDuplicateTemplateBlocks(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  const doc = await getDoc(docs, docId);
  const content = doc.body?.content ?? [];

  // Find ALL paragraphs matching the first anchor in the template.
  const configOccurrences: Array<{ elementIndex: number; startIndex: number }> = [];
  for (let i = 0; i < content.length; i++) {
    const el = content[i];
    if (!el.paragraph || typeof el.startIndex !== "number") continue;
    if (paragraphPlainText(el.paragraph).trim() === DOCWALLET_CONFIG_ANCHOR) {
      configOccurrences.push({ elementIndex: i, startIndex: el.startIndex });
    }
  }
  if (configOccurrences.length <= 1) return; // No duplicates

  // Find the first AUDIT_ANCHOR (end of the first good template block).
  const firstAudit = findAnchor(doc, DOCWALLET_AUDIT_ANCHOR);
  const lowerBound = firstAudit ? firstAudit.elementIndex : configOccurrences[0].elementIndex;

  // Walk backwards from the second CONFIG_ANCHOR to capture the full header
  // of the duplicate block (blank lines, title, subtitle, heading).
  let deleteFrom = configOccurrences[1].startIndex;
  for (let i = configOccurrences[1].elementIndex - 1; i > lowerBound; i--) {
    const el = content[i];
    if (!el.paragraph || typeof el.startIndex !== "number") break;
    const text = paragraphPlainText(el.paragraph).trim();
    if (!text ||
        text.includes("FrankyDocs") ||
        text === "Config" || text === "⚙️ Configuration" ||
        text.startsWith("Autonomous") || text.startsWith("Multi-sig")) {
      deleteFrom = el.startIndex;
    } else {
      break;
    }
  }

  const docEnd = content.at(-1)?.endIndex;
  if (typeof docEnd !== "number" || deleteFrom >= docEnd - 1) return;

  await batchUpdateDoc({
    docs, docId,
    requests: [{ deleteContentRange: { range: { startIndex: deleteFrom, endIndex: docEnd - 1 } } }]
  });
}

/**
 * Replace old-style plain headings with emoji-prefixed ones.
 * Idempotent — if headings already have emojis, nothing happens.
 */
async function upgradeOldHeadings(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  const doc = await getDoc(docs, docId);
  const content = doc.body?.content ?? [];

  const renames: Record<string, string> = {
    "Config": "⚙️ Configuration",
    "Commands": "📋 Commands",
    "Chat": "💬 Chat",
    "Dashboard — Balances": "💰 Balances",
    "Dashboard — Open Orders": "📊 Open Orders",
    "Dashboard — Recent Activity": "🕐 Recent Activity",
    "WalletConnect Sessions": "🔗 WalletConnect Sessions",
    "Audit Log": "📝 Audit Log",
  };

  // Also upgrade bare "FrankyDocs" title to "🟢 FrankyDocs"
  const titleRename = { old: "FrankyDocs", new: "🟢 FrankyDocs" };

  // Process from bottom-to-top so insertions don't shift earlier indices.
  const ops: Array<{ startIndex: number; endIndex: number; newText: string }> = [];

  for (const el of content) {
    if (!el.paragraph) continue;
    const text = paragraphPlainText(el.paragraph).trim();
    if (typeof el.startIndex !== "number" || typeof el.endIndex !== "number") continue;

    // Check section headings
    const newHeading = renames[text];
    if (newHeading) {
      // The paragraph text includes a trailing newline — replace just the text portion.
      const textEnd = el.endIndex - 1; // exclude trailing \n
      ops.push({ startIndex: el.startIndex, endIndex: textEnd, newText: newHeading });
      continue;
    }

    // Check title (exact match only — not already prefixed)
    if (text === titleRename.old) {
      const textEnd = el.endIndex - 1;
      ops.push({ startIndex: el.startIndex, endIndex: textEnd, newText: titleRename.new });
    }
  }

  if (ops.length === 0) return;

  // Sort bottom-to-top
  ops.sort((a, b) => b.startIndex - a.startIndex);

  const requests: docs_v1.Schema$Request[] = [];
  for (const op of ops) {
    requests.push({ deleteContentRange: { range: { startIndex: op.startIndex, endIndex: op.endIndex } } });
    requests.push({ insertText: { location: { index: op.startIndex }, text: op.newText } });
  }
  await batchUpdateDoc({ docs, docId, requests });
}

export async function ensureDocWalletTemplate(params: {
  docs: docs_v1.Docs;
  docId: string;
  minCommandRows?: number;
}): Promise<DocWalletTemplate> {
  const { docs, docId, minCommandRows = 12 } = params;

  /* ------------------------------------------------------------------
   * Phase 0 — Remove duplicate template blocks from previous failed runs.
   * ---------------------------------------------------------------- */
  await removeDuplicateTemplateBlocks({ docs, docId });
  await upgradeOldHeadings({ docs, docId });

  /* ------------------------------------------------------------------
   * Phase 1 — Ensure all 8 anchor paragraphs exist in the document.
   *           (Text only — tables are inserted in Phase 2.)
   * ---------------------------------------------------------------- */
  const doc = await getDoc(docs, docId);
  const hasBaseAnchors =
    Boolean(findAnchor(doc, DOCWALLET_CONFIG_ANCHOR)) &&
    Boolean(findAnchor(doc, DOCWALLET_COMMANDS_ANCHOR)) &&
    Boolean(findAnchor(doc, DOCWALLET_AUDIT_ANCHOR));

  const requiredAnchors = [
    DOCWALLET_CONFIG_ANCHOR,
    DOCWALLET_COMMANDS_ANCHOR,
    DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR,
    DOCWALLET_OPEN_ORDERS_ANCHOR,
    DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_SESSIONS_ANCHOR,
    DOCWALLET_AUDIT_ANCHOR
  ];

  const missingAnchors = requiredAnchors.filter((a) => !findAnchor(doc, a));

  if (!hasBaseAnchors) {
    // Fresh doc — insert all headings + anchor text.
    const endIndex = doc.body?.content?.at(-1)?.endIndex;
    if (typeof endIndex !== "number") throw new Error("Cannot determine document endIndex");
    const insertAt = Math.max(1, endIndex - 1);

    await batchUpdateDoc({
      docs,
      docId,
      requests: [
        {
          insertText: {
            location: { index: insertAt },
            text:
              "\n\n🟢 FrankyDocs\n" +
              "Autonomous multi-sig treasury agent powered by Google Docs\n\n" +
              `⚙️ Configuration\n${DOCWALLET_CONFIG_ANCHOR}\n\n` +
              `📋 Commands\n${DOCWALLET_COMMANDS_ANCHOR}\n\n` +
              `💬 Chat\n${DOCWALLET_CHAT_ANCHOR}\n\n` +
              `💰 Balances\n${DOCWALLET_BALANCES_ANCHOR}\n\n` +
              `📊 Open Orders\n${DOCWALLET_OPEN_ORDERS_ANCHOR}\n\n` +
              `🕐 Recent Activity\n${DOCWALLET_RECENT_ACTIVITY_ANCHOR}\n\n` +
              `🔗 WalletConnect Sessions\n${DOCWALLET_SESSIONS_ANCHOR}\n\n` +
              `📝 Audit Log\n${DOCWALLET_AUDIT_ANCHOR}\n\n`
          }
        }
      ]
    });
  } else if (missingAnchors.length > 0) {
    // v1 template — insert missing dashboard anchors just above the audit log.
    const auditAnchor = findAnchor(doc, DOCWALLET_AUDIT_ANCHOR)!;
    const insertText = missingAnchors
      .filter((a) => a !== DOCWALLET_CONFIG_ANCHOR && a !== DOCWALLET_COMMANDS_ANCHOR && a !== DOCWALLET_AUDIT_ANCHOR)
      .map((a) => {
        const heading =
          a === DOCWALLET_CHAT_ANCHOR ? "💬 Chat"
          : a === DOCWALLET_SESSIONS_ANCHOR ? "🔗 WalletConnect Sessions"
          : a === DOCWALLET_BALANCES_ANCHOR ? "💰 Balances"
          : a === DOCWALLET_OPEN_ORDERS_ANCHOR ? "📊 Open Orders"
          : a === DOCWALLET_RECENT_ACTIVITY_ANCHOR ? "🕐 Recent Activity"
          : "Dashboard";
        return `${heading}\n${a}\n\n`;
      })
      .join("");

    if (insertText) {
      await batchUpdateDoc({
        docs,
        docId,
        requests: [{ insertText: { location: { index: auditAnchor.startIndex }, text: `\n${insertText}` } }]
      });
    }
  }
  // else: all anchors already present — nothing to insert.

  /* ------------------------------------------------------------------
   * Phase 2 — Ensure every anchor has a table directly after it.
   *           (Handles first-run, partial failures, and recovery.)
   * ---------------------------------------------------------------- */
  await ensureTablesAfterAnchors({ docs, docId, minCommandRows });

  /* ------------------------------------------------------------------
   * Phase 3 — Ensure minimum row counts, populate headers/keys,
   *           hide anchor text, migrate v1 schema, apply styles.
   * ---------------------------------------------------------------- */
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_CONFIG_ANCHOR, minRows: 28 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_COMMANDS_ANCHOR, minRows: Math.max(2, minCommandRows) });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_CHAT_ANCHOR, minRows: 8 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_BALANCES_ANCHOR, minRows: 8 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_OPEN_ORDERS_ANCHOR, minRows: 12 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_RECENT_ACTIVITY_ANCHOR, minRows: 10 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_SESSIONS_ANCHOR, minRows: 8 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_AUDIT_ANCHOR, minRows: 2 });

  await populateTemplateTables({ docs, docId, onlyFillEmpty: true });
  await hideAnchorText({ docs, docId });
  await maybeMigrateCommandsTableV1({ docs, docId });
  await styleDocTemplate({ docs, docId });

  const finalDoc = await getDoc(docs, docId);
  return {
    config: { anchor: DOCWALLET_CONFIG_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_CONFIG_ANCHOR) },
    commands: { anchor: DOCWALLET_COMMANDS_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_COMMANDS_ANCHOR) },
    chat: { anchor: DOCWALLET_CHAT_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_CHAT_ANCHOR) },
    balances: { anchor: DOCWALLET_BALANCES_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_BALANCES_ANCHOR) },
    openOrders: { anchor: DOCWALLET_OPEN_ORDERS_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_OPEN_ORDERS_ANCHOR) },
    recentActivity: { anchor: DOCWALLET_RECENT_ACTIVITY_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_RECENT_ACTIVITY_ANCHOR) },
    sessions: { anchor: DOCWALLET_SESSIONS_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_SESSIONS_ANCHOR) },
    audit: { anchor: DOCWALLET_AUDIT_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_AUDIT_ANCHOR) }
  };
}

/* ---------- Table spec for each anchor section ---------- */
const TABLE_SPEC: Record<string, { rows: number; cols: number }> = {
  [DOCWALLET_CONFIG_ANCHOR]:           { rows: 28, cols: 2 },
  [DOCWALLET_COMMANDS_ANCHOR]:         { rows: 12, cols: 6 },
  [DOCWALLET_CHAT_ANCHOR]:             { rows:  8, cols: 2 },
  [DOCWALLET_BALANCES_ANCHOR]:         { rows:  8, cols: 3 },
  [DOCWALLET_OPEN_ORDERS_ANCHOR]:      { rows: 12, cols: 7 },
  [DOCWALLET_RECENT_ACTIVITY_ANCHOR]:  { rows: 10, cols: 4 },
  [DOCWALLET_SESSIONS_ANCHOR]:         { rows:  8, cols: 5 },
  [DOCWALLET_AUDIT_ANCHOR]:            { rows:  2, cols: 2 },
};

/**
 * For every anchor that does NOT already have a table immediately after it,
 * insert one.  Handles fresh creation, partial failures, and recovery.
 *
 * Tables are inserted from bottom-to-top (highest doc index first) so that
 * earlier insertions never shift later anchor positions.
 */
async function ensureTablesAfterAnchors(params: {
  docs: docs_v1.Docs;
  docId: string;
  minCommandRows?: number;
}) {
  const { docs, docId, minCommandRows = 12 } = params;
  const doc = await getDoc(docs, docId);

  // Ordered top-to-bottom as they appear in the document.
  const orderedAnchors = [
    DOCWALLET_CONFIG_ANCHOR,
    DOCWALLET_COMMANDS_ANCHOR,
    DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR,
    DOCWALLET_OPEN_ORDERS_ANCHOR,
    DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_SESSIONS_ANCHOR,
    DOCWALLET_AUDIT_ANCHOR
  ];

  // Resolve each anchor's location (first occurrence only).
  const anchorLocs = new Map<string, ReturnType<typeof findAnchor>>();
  for (const a of orderedAnchors) {
    anchorLocs.set(a, findAnchor(doc, a));
  }

  const missing: Array<{ anchorText: string; endIndex: number }> = [];

  for (let i = 0; i < orderedAnchors.length; i++) {
    const anchorText = orderedAnchors[i];
    const loc = anchorLocs.get(anchorText);
    if (!loc) continue; // anchor paragraph missing — can't insert a table for it

    const tableInfo = findNextTable(doc, loc.elementIndex);

    if (tableInfo) {
      // Verify the table sits between THIS anchor and the NEXT anchor
      // (otherwise it belongs to a later section, meaning ours is missing).
      const nextAnchorText = orderedAnchors[i + 1];
      if (nextAnchorText) {
        const nextLoc = anchorLocs.get(nextAnchorText);
        if (nextLoc && tableInfo.elementIndex > nextLoc.elementIndex) {
          // Table is past the next section → this anchor has no table.
          missing.push({ anchorText, endIndex: loc.endIndex });
          continue;
        }
      }
      // Table exists in the correct range — nothing to do.
      continue;
    }

    // No table found at all after this anchor.
    missing.push({ anchorText, endIndex: loc.endIndex });
  }

  if (missing.length === 0) return;

  // Insert from bottom-to-top so indices remain stable.
  const sorted = missing.sort((a, b) => b.endIndex - a.endIndex);
  const requests: docs_v1.Schema$Request[] = sorted.map((m) => {
    const spec = TABLE_SPEC[m.anchorText]!;
    const rows = m.anchorText === DOCWALLET_COMMANDS_ANCHOR
      ? Math.max(spec.rows, minCommandRows)
      : spec.rows;
    return { insertTable: { rows, columns: spec.cols, location: { index: m.endIndex } } };
  });

  await batchUpdateDoc({ docs, docId, requests });
}

async function populateTemplateTables(params: {
  docs: docs_v1.Docs;
  docId: string;
  onlyFillEmpty?: boolean;
}) {
  const { docs, docId, onlyFillEmpty = false } = params;
  const doc = await getDoc(docs, docId);

  const configTable = mustGetTable(doc, DOCWALLET_CONFIG_ANCHOR);
  const commandsTable = mustGetTable(doc, DOCWALLET_COMMANDS_ANCHOR);
  const chatTable = mustGetTable(doc, DOCWALLET_CHAT_ANCHOR);
  const balancesTable = mustGetTable(doc, DOCWALLET_BALANCES_ANCHOR);
  const openOrdersTable = mustGetTable(doc, DOCWALLET_OPEN_ORDERS_ANCHOR);
  const recentActivityTable = mustGetTable(doc, DOCWALLET_RECENT_ACTIVITY_ANCHOR);
  const sessionsTable = mustGetTable(doc, DOCWALLET_SESSIONS_ANCHOR);
  const auditTable = mustGetTable(doc, DOCWALLET_AUDIT_ANCHOR);

  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];

  const cfg = configTable.tableRows ?? [];
  const setIf = (cell: docs_v1.Schema$TableCell | undefined, text: string) => {
    if (!cell) return;
    if (onlyFillEmpty) {
      const existing = cellPlainText(cell);
      if (existing.trim() !== "") return;
    }
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text }) });
  };

  // Config header
  setIf(cfg[0]?.tableCells?.[0], "KEY");
  setIf(cfg[0]?.tableCells?.[1], "VALUE");

  const cfgKeys: Array<[string, string]> = [
    ["DOCWALLET_VERSION", "2"],
    ["STATUS", "NEEDS_SETUP"],
    ["DOC_ID", docId],
    ["EVM_ADDRESS", ""],
    ["WEB_BASE_URL", ""],
    ["JOIN_URL", ""],
    ["YELLOW_SESSION_ID", ""],
    ["YELLOW_PROTOCOL", "NitroRPC/0.4"],
    ["QUORUM", "2"],
    ["SIGNERS", ""],
    ["SUI_ADDRESS", ""],
    ["SUI_ENV", "testnet"],
    ["DEEPBOOK_POOL", "SUI_DBUSDC"],
    ["DEEPBOOK_MANAGER", ""],
    ["ARC_NETWORK", "ARC-TESTNET"],
    ["ARC_WALLET_ADDRESS", ""],
    ["ARC_WALLET_ID", ""],
    ["POLICY_SOURCE", "NONE"],
    ["ENS_NAME", ""],
    ["APPROVALS_TOTAL", "0"],
    ["EST_APPROVAL_TX_AVOIDED", "0"],
    ["SIGNER_APPROVAL_GAS_PAID", "0.003"],
    ["DOC_CELL_APPROVALS", "0"],
    ["AGENT_AUTOPROPOSE", "1"],
    ["LAST_PROPOSAL", ""],
    ["LAST_APPROVAL", ""]
  ];

  for (let i = 0; i < cfgKeys.length; i++) {
    const row = cfg[i + 1];
    setIf(row?.tableCells?.[0], cfgKeys[i][0]);
    setIf(row?.tableCells?.[1], cfgKeys[i][1]);
  }

  // Commands header
  const cmdRows = commandsTable.tableRows ?? [];
  const cmdHeader = ["ID", "COMMAND", "STATUS", "APPROVAL_URL", "RESULT", "ERROR"];
  for (let c = 0; c < cmdHeader.length; c++) {
    setIf(cmdRows[0]?.tableCells?.[c], cmdHeader[c]);
  }

  // Chat header
  const chatRows = chatTable.tableRows ?? [];
  const chatHeader = ["USER", "AGENT"];
  for (let c = 0; c < chatHeader.length; c++) {
    setIf(chatRows[0]?.tableCells?.[c], chatHeader[c]);
  }

  // Balances header
  const balRows = balancesTable.tableRows ?? [];
  const balHeader = ["LOCATION", "ASSET", "BALANCE"];
  for (let c = 0; c < balHeader.length; c++) setIf(balRows[0]?.tableCells?.[c], balHeader[c]);

  // Open orders header
  const ooRows = openOrdersTable.tableRows ?? [];
  const ooHeader = ["ORDER_ID", "SIDE", "PRICE", "QTY", "STATUS", "UPDATED_AT", "TX"];
  for (let c = 0; c < ooHeader.length; c++) setIf(ooRows[0]?.tableCells?.[c], ooHeader[c]);

  // Recent activity header
  const raRows = recentActivityTable.tableRows ?? [];
  const raHeader = ["TIME", "TYPE", "DETAILS", "TX"];
  for (let c = 0; c < raHeader.length; c++) setIf(raRows[0]?.tableCells?.[c], raHeader[c]);

  // Sessions header
  const sesRows = sessionsTable.tableRows ?? [];
  const sesHeader = ["SESSION_ID", "PEER_NAME", "CHAINS", "CREATED_AT", "STATUS"];
  for (let c = 0; c < sesHeader.length; c++) setIf(sesRows[0]?.tableCells?.[c], sesHeader[c]);

  // Audit header
  const auditRows = auditTable.tableRows ?? [];
  setIf(auditRows[0]?.tableCells?.[0], "TIME");
  setIf(auditRows[0]?.tableCells?.[1], "MESSAGE");

  const ordered = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
  await batchUpdateDoc({ docs, docId, requests: ordered });
}

async function hideAnchorText(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  const doc = await getDoc(docs, docId);
  const anchors = [
    DOCWALLET_CONFIG_ANCHOR,
    DOCWALLET_COMMANDS_ANCHOR,
    DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR,
    DOCWALLET_OPEN_ORDERS_ANCHOR,
    DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_SESSIONS_ANCHOR,
    DOCWALLET_AUDIT_ANCHOR
  ];
  const requests: docs_v1.Schema$Request[] = [];
  for (const anchorText of anchors) {
    const anchor = findAnchor(doc, anchorText);
    if (!anchor) continue;
    const endIndex = Math.max(anchor.startIndex + 1, anchor.endIndex - 1);
    if (endIndex <= anchor.startIndex) continue;
    requests.push({
      updateTextStyle: {
        range: { startIndex: anchor.startIndex, endIndex },
        textStyle: {
          fontSize: { magnitude: 1, unit: "PT" },
          foregroundColor: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } }
        },
        fields: "fontSize,foregroundColor"
      }
    });
  }
  await batchUpdateDoc({ docs, docId, requests });
}

async function maybeMigrateCommandsTableV1(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  const doc = await getDoc(docs, docId);
  const commandsTable = mustGetTable(doc, DOCWALLET_COMMANDS_ANCHOR);
  const rows = commandsTable.tableRows ?? [];
  const headerRow = rows[0];
  const headerCells = headerRow?.tableCells ?? [];
  const col2 = headerCells[2] ? cellPlainText(headerCells[2]) : "";
  const col3 = headerCells[3] ? cellPlainText(headerCells[3]) : "";

  // v1 schema: ID | COMMAND | APPROVAL | STATUS | RESULT | ERROR
  if (col2.trim().toUpperCase() !== "APPROVAL" || col3.trim().toUpperCase() !== "STATUS") return;

  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];

  const write = (cell: docs_v1.Schema$TableCell | undefined, text: string) => {
    if (!cell) return;
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text }) });
  };

  // Force the header to v2.
  const v2Header = ["ID", "COMMAND", "STATUS", "APPROVAL_URL", "RESULT", "ERROR"];
  for (let c = 0; c < v2Header.length; c++) write(headerCells[c], v2Header[c]!);

  // Shift each data row: STATUS(col3) -> STATUS(col2), clear col3 (approval url will be filled by the agent).
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]?.tableCells ?? [];
    const approvalCell = cells[2];
    const statusCell = cells[3];
    if (!approvalCell || !statusCell) continue;
    const oldStatus = cellPlainText(statusCell).trim();
    if (!oldStatus) continue;
    write(approvalCell, oldStatus);
    write(statusCell, "");
  }

  const requests = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
  await batchUpdateDoc({ docs, docId, requests });
}

/**
 * Apply professional Google Doc styling — heading levels, bold table headers, branded colors.
 * Runs idempotently; safe to call multiple times.
 */
async function styleDocTemplate(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  const doc = await getDoc(docs, docId);
  const content = doc.body?.content ?? [];
  const requests: docs_v1.Schema$Request[] = [];

  // Section heading texts we want to style as HEADING_2
  const sectionHeadings = new Set([
    "⚙️ Configuration", "📋 Commands", "💬 Chat", "💰 Balances",
    "📊 Open Orders", "🕐 Recent Activity", "🔗 WalletConnect Sessions", "📝 Audit Log",
    // Legacy headings
    "Config", "Commands", "Chat", "Dashboard — Balances",
    "Dashboard — Open Orders", "Dashboard — Recent Activity",
    "WalletConnect Sessions", "Audit Log"
  ]);

  for (const el of content) {
    if (!el.paragraph) continue;
    const para = el.paragraph;
    const text = paragraphPlainText(para).trim();
    const startIdx = el.startIndex;
    const endIdx = el.endIndex;
    if (typeof startIdx !== "number" || typeof endIdx !== "number") continue;

    // Title — "FrankyDocs" or "🟢 FrankyDocs"
    if (text.includes("FrankyDocs") && !text.includes("ANCHOR") && text.length < 30) {
      const currentStyle = para.paragraphStyle?.namedStyleType;
      if (currentStyle !== "TITLE") {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: startIdx, endIndex: endIdx },
            paragraphStyle: { namedStyleType: "TITLE" },
            fields: "namedStyleType"
          }
        });
        requests.push({
          updateTextStyle: {
            range: { startIndex: startIdx, endIndex: endIdx - 1 },
            textStyle: {
              bold: true,
              fontSize: { magnitude: 26, unit: "PT" },
              foregroundColor: { color: { rgbColor: { red: 0.06, green: 0.35, blue: 0.85 } } }
            },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }
    }

    // Subtitle line
    if (text.startsWith("Autonomous multi-sig") || text.startsWith("Multi-sig treasury")) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startIdx, endIndex: endIdx },
          paragraphStyle: { namedStyleType: "SUBTITLE" },
          fields: "namedStyleType"
        }
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            foregroundColor: { color: { rgbColor: { red: 0.37, green: 0.39, blue: 0.41 } } },
            fontSize: { magnitude: 12, unit: "PT" }
          },
          fields: "foregroundColor,fontSize"
        }
      });
    }

    // Section headings → HEADING_2
    if (sectionHeadings.has(text)) {
      const currentStyle = para.paragraphStyle?.namedStyleType;
      if (currentStyle !== "HEADING_2") {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: startIdx, endIndex: endIdx },
            paragraphStyle: { namedStyleType: "HEADING_2" },
            fields: "namedStyleType"
          }
        });
        requests.push({
          updateTextStyle: {
            range: { startIndex: startIdx, endIndex: endIdx - 1 },
            textStyle: {
              bold: true,
              fontSize: { magnitude: 14, unit: "PT" },
              foregroundColor: { color: { rgbColor: { red: 0.13, green: 0.13, blue: 0.13 } } }
            },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }
    }
  }

  // Style table header rows (row 0 of each table) with bold text and light blue background
  const allAnchors = [
    DOCWALLET_CONFIG_ANCHOR, DOCWALLET_COMMANDS_ANCHOR, DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR, DOCWALLET_OPEN_ORDERS_ANCHOR, DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_SESSIONS_ANCHOR, DOCWALLET_AUDIT_ANCHOR
  ];

  for (const anchorText of allAnchors) {
    const anchor = findAnchor(doc, anchorText);
    if (!anchor) continue;
    const tableInfo = findNextTable(doc, anchor.elementIndex);
    if (!tableInfo?.table) continue;
    const headerRow = tableInfo.table.tableRows?.[0];
    if (!headerRow) continue;

    // Bold + background color for header cells
    for (const cell of headerRow.tableCells ?? []) {
      const range = tableCellRange(cell);
      if (!range) continue;

      // Bold text in header
      if (range.endIndex > range.startIndex + 1) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.startIndex, endIndex: range.endIndex - 1 },
            textStyle: {
              bold: true,
              fontSize: { magnitude: 9, unit: "PT" },
              foregroundColor: { color: { rgbColor: { red: 0.13, green: 0.13, blue: 0.13 } } }
            },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }

      // Light blue-gray background for header cell
      requests.push({
        updateTableCellStyle: {
          tableRange: {
            tableCellLocation: {
              tableStartLocation: { index: tableInfo.startIndex },
              rowIndex: 0,
              columnIndex: (headerRow.tableCells ?? []).indexOf(cell)
            },
            rowSpan: 1,
            columnSpan: 1
          },
          tableCellStyle: {
            backgroundColor: { color: { rgbColor: { red: 0.91, green: 0.94, blue: 0.98 } } }
          },
          fields: "backgroundColor"
        }
      });
    }
  }

  if (requests.length > 0) {
    await batchUpdateDoc({ docs, docId, requests });
  }
}

export function cellPlainText(cell: docs_v1.Schema$TableCell): string {
  const parts: string[] = [];
  for (const el of cell.content ?? []) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements ?? []) {
        if (pe.textRun?.content) parts.push(pe.textRun.content);
      }
    }
  }
  return parts.join("").replace(/\n/g, " ").trim();
}
