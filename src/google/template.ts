import type { docs_v1 } from "googleapis";
import { batchUpdateDoc, findAnchor, findNextTable, getDoc, buildWriteCellRequests, tableCellStartIndex } from "./docs.js";

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

export async function ensureDocWalletTemplate(params: {
  docs: docs_v1.Docs;
  docId: string;
  minCommandRows?: number;
}): Promise<DocWalletTemplate> {
  const { docs, docId, minCommandRows = 12 } = params;

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
              "\n\nDocWallet\n\n" +
              `Config\n${DOCWALLET_CONFIG_ANCHOR}\n\n` +
              `Commands\n${DOCWALLET_COMMANDS_ANCHOR}\n\n` +
              `Chat\n${DOCWALLET_CHAT_ANCHOR}\n\n` +
              `Dashboard — Balances\n${DOCWALLET_BALANCES_ANCHOR}\n\n` +
              `Dashboard — Open Orders\n${DOCWALLET_OPEN_ORDERS_ANCHOR}\n\n` +
              `Dashboard — Recent Activity\n${DOCWALLET_RECENT_ACTIVITY_ANCHOR}\n\n` +
              `WalletConnect Sessions\n${DOCWALLET_SESSIONS_ANCHOR}\n\n` +
              `Audit Log\n${DOCWALLET_AUDIT_ANCHOR}\n\n`
          }
        }
      ]
    });

    const doc2 = await getDoc(docs, docId);
    const configAnchor = findAnchor(doc2, DOCWALLET_CONFIG_ANCHOR)!;
    const commandsAnchor = findAnchor(doc2, DOCWALLET_COMMANDS_ANCHOR)!;
    const chatAnchor = findAnchor(doc2, DOCWALLET_CHAT_ANCHOR)!;
    const balancesAnchor = findAnchor(doc2, DOCWALLET_BALANCES_ANCHOR)!;
    const openOrdersAnchor = findAnchor(doc2, DOCWALLET_OPEN_ORDERS_ANCHOR)!;
    const recentAnchor = findAnchor(doc2, DOCWALLET_RECENT_ACTIVITY_ANCHOR)!;
    const sessionsAnchor = findAnchor(doc2, DOCWALLET_SESSIONS_ANCHOR)!;
    const auditAnchor = findAnchor(doc2, DOCWALLET_AUDIT_ANCHOR)!;

    await batchUpdateDoc({
      docs,
      docId,
      requests: [
        // Insert tables from bottom-to-top so earlier insertions don't shift later anchor indices.
        {
          insertTable: {
            rows: 2,
            columns: 2,
            location: { index: auditAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: 10,
            columns: 4,
            location: { index: recentAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: 8,
            columns: 5,
            location: { index: sessionsAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: 12,
            columns: 7,
            location: { index: openOrdersAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: 8,
            columns: 3,
            location: { index: balancesAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: 8,
            columns: 2,
            location: { index: chatAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: Math.max(2, minCommandRows),
            columns: 6,
            location: { index: commandsAnchor.endIndex }
          }
        },
        {
          insertTable: {
            rows: 20,
            columns: 2,
            location: { index: configAnchor.endIndex }
          }
        }
      ]
    });

    await populateTemplateTables({ docs, docId });
  } else if (missingAnchors.length > 0) {
    // v1 template: insert missing dashboard anchors just above the audit log so they appear in a sensible order.
    const auditAnchor = findAnchor(doc, DOCWALLET_AUDIT_ANCHOR)!;
    const insertText = missingAnchors
      .filter((a) => a !== DOCWALLET_CONFIG_ANCHOR && a !== DOCWALLET_COMMANDS_ANCHOR && a !== DOCWALLET_AUDIT_ANCHOR)
      .map((a) => {
        const heading =
          a === DOCWALLET_CHAT_ANCHOR
            ? "Chat"
            : a === DOCWALLET_SESSIONS_ANCHOR
              ? "WalletConnect Sessions"
              :
          a === DOCWALLET_BALANCES_ANCHOR
            ? "Dashboard — Balances"
            : a === DOCWALLET_OPEN_ORDERS_ANCHOR
              ? "Dashboard — Open Orders"
            : a === DOCWALLET_RECENT_ACTIVITY_ANCHOR
              ? "Dashboard — Recent Activity"
              : "Dashboard";
        return `${heading}\n${a}\n\n`;
      })
      .join("");

    if (insertText) {
      await batchUpdateDoc({
        docs,
        docId,
        requests: [
          {
            insertText: {
              location: { index: auditAnchor.startIndex },
              text: `\n${insertText}`
            }
          }
        ]
      });

      const doc2 = await getDoc(docs, docId);
      const anchorsWithTables: Array<{ anchor: string; rows: number; cols: number; endIndex: number }> = [];
      for (const a of missingAnchors) {
        if (a === DOCWALLET_CONFIG_ANCHOR || a === DOCWALLET_COMMANDS_ANCHOR || a === DOCWALLET_AUDIT_ANCHOR) continue;
        const loc = findAnchor(doc2, a);
        if (!loc) continue;
        anchorsWithTables.push({
          anchor: a,
          endIndex: loc.endIndex,
          rows:
            a === DOCWALLET_BALANCES_ANCHOR
              ? 8
              : a === DOCWALLET_OPEN_ORDERS_ANCHOR
                ? 12
                : a === DOCWALLET_CHAT_ANCHOR
                  ? 8
                  : a === DOCWALLET_SESSIONS_ANCHOR
                    ? 8
                    : 10,
          cols:
            a === DOCWALLET_BALANCES_ANCHOR
              ? 3
              : a === DOCWALLET_OPEN_ORDERS_ANCHOR
                ? 7
                : a === DOCWALLET_CHAT_ANCHOR
                  ? 2
                  : a === DOCWALLET_SESSIONS_ANCHOR
                    ? 5
                    : 4
        });
      }

      // Insert missing tables from bottom-to-top.
      const requests = anchorsWithTables
        .sort((a, b) => b.endIndex - a.endIndex)
        .map((t) => ({
          insertTable: { rows: t.rows, columns: t.cols, location: { index: t.endIndex } }
        })) as docs_v1.Schema$Request[];
      if (requests.length > 0) await batchUpdateDoc({ docs, docId, requests });
    }

    await populateTemplateTables({ docs, docId, onlyFillEmpty: true });
  } else {
    // Ensure headers/keys exist (best effort; don't overwrite user values)
    await populateTemplateTables({ docs, docId, onlyFillEmpty: true });
  }

  // Make sure we have enough rows to hold keys/headers even on older templates.
  // (If we insert rows, we re-run populate in "onlyFillEmpty" mode.)
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_CONFIG_ANCHOR, minRows: 20 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_COMMANDS_ANCHOR, minRows: Math.max(2, minCommandRows) });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_CHAT_ANCHOR, minRows: 8 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_BALANCES_ANCHOR, minRows: 8 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_OPEN_ORDERS_ANCHOR, minRows: 12 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_RECENT_ACTIVITY_ANCHOR, minRows: 10 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_SESSIONS_ANCHOR, minRows: 8 });
  await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_AUDIT_ANCHOR, minRows: 2 });

  await populateTemplateTables({ docs, docId, onlyFillEmpty: true });
  await maybeMigrateCommandsTableV1({ docs, docId });

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
    ["ENS_NAME", ""]
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
