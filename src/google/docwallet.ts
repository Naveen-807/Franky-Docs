import type { docs_v1 } from "googleapis";
import {
  batchUpdateDoc,
  buildWriteCellRequests,
  findAnchor,
  findNextTable,
  getDoc,
  tablePlainText,
  tableCellStartIndex
} from "./docs.js";
import {
  DOCWALLET_AUDIT_ANCHOR,
  DOCWALLET_BALANCES_ANCHOR,
  DOCWALLET_CHAT_ANCHOR,
  DOCWALLET_COMMANDS_ANCHOR,
  DOCWALLET_CONFIG_ANCHOR,
  DOCWALLET_OPEN_ORDERS_ANCHOR,
  DOCWALLET_RECENT_ACTIVITY_ANCHOR,
  DOCWALLET_SESSIONS_ANCHOR,
  ensureDocWalletTemplate
} from "./template.js";

export type DocWalletTables = {
  doc: docs_v1.Schema$Document;
  config: { table: docs_v1.Schema$Table; tableStartIndex: number };
  commands: { table: docs_v1.Schema$Table; tableStartIndex: number };
  chat: { table: docs_v1.Schema$Table; tableStartIndex: number };
  balances: { table: docs_v1.Schema$Table; tableStartIndex: number };
  openOrders: { table: docs_v1.Schema$Table; tableStartIndex: number };
  recentActivity: { table: docs_v1.Schema$Table; tableStartIndex: number };
  sessions: { table: docs_v1.Schema$Table; tableStartIndex: number };
  audit: { table: docs_v1.Schema$Table; tableStartIndex: number };
};

function mustGetTableInfo(doc: docs_v1.Schema$Document, anchor: string) {
  const anchorLoc = findAnchor(doc, anchor);
  if (!anchorLoc) throw new Error(`Missing anchor: ${anchor}`);
  const tableInfo = findNextTable(doc, anchorLoc.elementIndex);
  if (!tableInfo) throw new Error(`Missing table after anchor: ${anchor}`);
  return tableInfo;
}

export async function loadDocWalletTables(params: { docs: docs_v1.Docs; docId: string }): Promise<DocWalletTables> {
  const { docs, docId } = params;
  await ensureDocWalletTemplate({ docs, docId });
  const doc = await getDoc(docs, docId);

  const cfg = mustGetTableInfo(doc, DOCWALLET_CONFIG_ANCHOR);
  const cmds = mustGetTableInfo(doc, DOCWALLET_COMMANDS_ANCHOR);
  const chat = mustGetTableInfo(doc, DOCWALLET_CHAT_ANCHOR);
  const balances = mustGetTableInfo(doc, DOCWALLET_BALANCES_ANCHOR);
  const openOrders = mustGetTableInfo(doc, DOCWALLET_OPEN_ORDERS_ANCHOR);
  const recentActivity = mustGetTableInfo(doc, DOCWALLET_RECENT_ACTIVITY_ANCHOR);
  const sessions = mustGetTableInfo(doc, DOCWALLET_SESSIONS_ANCHOR);
  const audit = mustGetTableInfo(doc, DOCWALLET_AUDIT_ANCHOR);

  return {
    doc,
    config: { table: cfg.table, tableStartIndex: cfg.startIndex },
    commands: { table: cmds.table, tableStartIndex: cmds.startIndex },
    chat: { table: chat.table, tableStartIndex: chat.startIndex },
    balances: { table: balances.table, tableStartIndex: balances.startIndex },
    openOrders: { table: openOrders.table, tableStartIndex: openOrders.startIndex },
    recentActivity: { table: recentActivity.table, tableStartIndex: recentActivity.startIndex },
    sessions: { table: sessions.table, tableStartIndex: sessions.startIndex },
    audit: { table: audit.table, tableStartIndex: audit.startIndex }
  };
}

export type ConfigRow = { key: string; value: string; rowIndex: number };

export function readConfig(table: docs_v1.Schema$Table): Record<string, ConfigRow> {
  const rows = table.tableRows ?? [];
  const out: Record<string, ConfigRow> = {};
  for (let r = 1; r < rows.length; r++) {
    const key = cellText(rows[r].tableCells?.[0]).trim();
    if (!key) continue;
    const value = cellText(rows[r].tableCells?.[1]).trim();
    out[key] = { key, value, rowIndex: r };
  }
  return out;
}

export async function writeConfigValue(params: {
  docs: docs_v1.Docs;
  docId: string;
  configTable: docs_v1.Schema$Table;
  key: string;
  value: string;
}) {
  const { docs, docId, configTable, key, value } = params;
  const rows = configTable.tableRows ?? [];
  for (let r = 1; r < rows.length; r++) {
    const k = cellText(rows[r].tableCells?.[0]).trim();
    if (k !== key) continue;
    const cell = rows[r].tableCells?.[1];
    if (!cell) throw new Error(`Config row missing value cell for ${key}`);
    await batchUpdateDoc({ docs, docId, requests: buildWriteCellRequests({ cell, text: value }) });
    return;
  }
  throw new Error(`Config key not found: ${key}`);
}

export type CommandRow = {
  rowIndex: number; // index in table (0 = header)
  id: string;
  command: string;
  status: string;
  approvalUrl: string;
  result: string;
  error: string;
};

export function readCommandsTable(table: docs_v1.Schema$Table): CommandRow[] {
  const texts = tablePlainText(table);
  const out: CommandRow[] = [];
  for (let r = 1; r < texts.length; r++) {
    const row = texts[r] ?? [];
    out.push({
      rowIndex: r,
      id: (row[0] ?? "").trim(),
      command: (row[1] ?? "").trim(),
      status: (row[2] ?? "").trim(),
      approvalUrl: (row[3] ?? "").trim(),
      result: (row[4] ?? "").trim(),
      error: (row[5] ?? "").trim()
    });
  }
  return out;
}

export function userEditableCommandsHash(table: docs_v1.Schema$Table): string {
  const texts = tablePlainText(table);
  const parts: string[] = [];
  for (let r = 1; r < texts.length; r++) {
    const row = texts[r] ?? [];
    const command = (row[1] ?? "").trim();
    parts.push(`${r}:${command}`);
  }
  return parts.join("\n");
}

export async function appendCommandRow(params: {
  docs: docs_v1.Docs;
  docId: string;
  id: string;
  command: string;
  status: string;
  approvalUrl?: string;
  result?: string;
  error?: string;
}) {
  const { docs, docId, id, command, status, approvalUrl, result, error } = params;
  const tables = await loadDocWalletTables({ docs, docId });
  const table = tables.commands.table;
  const startIndex = tables.commands.tableStartIndex;
  const rowCount = (table.tableRows ?? []).length;
  const lastRowIndex = Math.max(0, rowCount - 1);

  await batchUpdateDoc({
    docs,
    docId,
    requests: [
      {
        insertTableRow: {
          tableCellLocation: { tableStartLocation: { index: startIndex }, rowIndex: lastRowIndex, columnIndex: 0 },
          insertBelow: true
        }
      }
    ]
  });

  const tables2 = await loadDocWalletTables({ docs, docId });
  const row = (tables2.commands.table.tableRows ?? []).at(-1);
  const cells = row?.tableCells ?? [];
  if (cells.length < 6) return;

  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];
  const write = (col: number, value: string | undefined) => {
    if (value === undefined) return;
    const cell = cells[col];
    if (!cell) return;
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text: value }) });
  };

  write(0, id);
  write(1, command);
  write(2, status);
  write(3, approvalUrl ?? "");
  write(4, result ?? "");
  write(5, error ?? "");

  const requests = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
  await batchUpdateDoc({ docs, docId, requests });
}

export type ChatRow = {
  rowIndex: number;
  user: string;
  agent: string;
};

export function readChatTable(table: docs_v1.Schema$Table): ChatRow[] {
  const texts = tablePlainText(table);
  const out: ChatRow[] = [];
  for (let r = 1; r < texts.length; r++) {
    const row = texts[r] ?? [];
    out.push({
      rowIndex: r,
      user: (row[0] ?? "").trim(),
      agent: (row[1] ?? "").trim()
    });
  }
  return out;
}

export async function updateChatRowCells(params: {
  docs: docs_v1.Docs;
  docId: string;
  chatTable: docs_v1.Schema$Table;
  rowIndex: number;
  agent?: string;
}) {
  const { docs, docId, chatTable, rowIndex, agent } = params;
  if (agent === undefined) return;
  const row = (chatTable.tableRows ?? [])[rowIndex];
  if (!row) return;
  const cell = row.tableCells?.[1];
  if (!cell) return;
  const requests = buildWriteCellRequests({ cell, text: agent });
  await batchUpdateDoc({ docs, docId, requests });
}

export type SessionRow = {
  rowIndex: number;
  sessionId: string;
  peerName: string;
  chains: string;
  createdAt: string;
  status: string;
};

export function readSessionsTable(table: docs_v1.Schema$Table): SessionRow[] {
  const texts = tablePlainText(table);
  const out: SessionRow[] = [];
  for (let r = 1; r < texts.length; r++) {
    const row = texts[r] ?? [];
    out.push({
      rowIndex: r,
      sessionId: (row[0] ?? "").trim(),
      peerName: (row[1] ?? "").trim(),
      chains: (row[2] ?? "").trim(),
      createdAt: (row[3] ?? "").trim(),
      status: (row[4] ?? "").trim()
    });
  }
  return out;
}

export async function upsertSessionRow(params: {
  docs: docs_v1.Docs;
  docId: string;
  sessionId: string;
  peerName: string;
  chains: string;
  createdAt: string;
  status: string;
}) {
  const { docs, docId, sessionId, peerName, chains, createdAt, status } = params;
  const tables = await loadDocWalletTables({ docs, docId });
  const sessionsTable = tables.sessions.table;
  const sessionsStartIndex = tables.sessions.tableStartIndex;
  const rows = readSessionsTable(sessionsTable);
  const existing = rows.find((r) => r.sessionId === sessionId);

  if (!existing) {
    const rowCount = (sessionsTable.tableRows ?? []).length;
    const lastRowIndex = Math.max(0, rowCount - 1);
    await batchUpdateDoc({
      docs,
      docId,
      requests: [
        {
          insertTableRow: {
            tableCellLocation: { tableStartLocation: { index: sessionsStartIndex }, rowIndex: lastRowIndex, columnIndex: 0 },
            insertBelow: true
          }
        }
      ]
    });

    const tables2 = await loadDocWalletTables({ docs, docId });
    const newRow = (tables2.sessions.table.tableRows ?? []).at(-1);
    const cells = newRow?.tableCells ?? [];
    if (cells.length < 5) return;

    const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];
    const write = (col: number, value: string) => {
      const cell = cells[col];
      if (!cell) return;
      groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text: value }) });
    };
    write(0, sessionId);
    write(1, peerName);
    write(2, chains);
    write(3, createdAt);
    write(4, status);
    const requests = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
    await batchUpdateDoc({ docs, docId, requests });
    return;
  }

  const row = (sessionsTable.tableRows ?? [])[existing.rowIndex];
  if (!row) return;
  const cells = row.tableCells ?? [];
  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];
  const write = (col: number, value: string) => {
    const cell = cells[col];
    if (!cell) return;
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text: value }) });
  };
  write(1, peerName);
  write(2, chains);
  write(3, createdAt);
  write(4, status);
  const requests = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
  await batchUpdateDoc({ docs, docId, requests });
}

export async function updateCommandsRowCells(params: {
  docs: docs_v1.Docs;
  docId: string;
  commandsTable: docs_v1.Schema$Table;
  rowIndex: number;
  updates: Partial<Pick<CommandRow, "id" | "command" | "status" | "approvalUrl" | "result" | "error">>;
}) {
  const { docs, docId, commandsTable, rowIndex, updates } = params;
  const row = (commandsTable.tableRows ?? [])[rowIndex];
  if (!row) throw new Error(`Commands rowIndex out of range: ${rowIndex}`);

  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];
  const cells = row.tableCells ?? [];

  const write = (col: number, value: string | undefined) => {
    if (value === undefined) return;
    const cell = cells[col];
    if (!cell) return;
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text: value }) });
  };

  write(0, updates.id);
  write(1, updates.command);
  write(2, updates.status);
  write(3, updates.approvalUrl);
  write(4, updates.result);
  write(5, updates.error);

  const requests = groups
    .sort((a, b) => b.sortIndex - a.sortIndex)
    .flatMap((g) => g.requests);
  await batchUpdateDoc({ docs, docId, requests });
}

export async function appendAuditRow(params: {
  docs: docs_v1.Docs;
  docId: string;
  timestampIso: string;
  message: string;
}) {
  const { docs, docId, timestampIso, message } = params;

  // Insert a row below the last row, then re-fetch and fill it.
  const tables = await loadDocWalletTables({ docs, docId });
  const auditTable = tables.audit.table;
  const auditTableStartIndex = tables.audit.tableStartIndex;
  const rowCount = (auditTable.tableRows ?? []).length;
  const lastRowIndex = Math.max(0, rowCount - 1);

  await batchUpdateDoc({
    docs,
    docId,
    requests: [
      {
        insertTableRow: {
          tableCellLocation: {
            tableStartLocation: { index: auditTableStartIndex },
            rowIndex: lastRowIndex,
            columnIndex: 0
          },
          insertBelow: true
        }
      }
    ]
  });

  const tables2 = await loadDocWalletTables({ docs, docId });
  const audit2 = tables2.audit.table;
  const rows2 = audit2.tableRows ?? [];
  const newRow = rows2.at(-1);
  const c0 = newRow?.tableCells?.[0];
  const c1 = newRow?.tableCells?.[1];
  if (!c0 || !c1) return;

  await batchUpdateDoc({
    docs,
    docId,
    requests: [
      ...[
        { sortIndex: tableCellStartIndex(c0) ?? 0, requests: buildWriteCellRequests({ cell: c0, text: timestampIso }) },
        { sortIndex: tableCellStartIndex(c1) ?? 0, requests: buildWriteCellRequests({ cell: c1, text: message }) }
      ]
        .sort((a, b) => b.sortIndex - a.sortIndex)
        .flatMap((g) => g.requests)
    ]
  });
}

export async function appendRecentActivityRow(params: {
  docs: docs_v1.Docs;
  docId: string;
  timestampIso: string;
  type: string;
  details: string;
  tx: string;
}) {
  const { docs, docId, timestampIso, type, details, tx } = params;

  const tables = await loadDocWalletTables({ docs, docId });
  const table = tables.recentActivity.table;
  const startIndex = tables.recentActivity.tableStartIndex;
  const rowCount = (table.tableRows ?? []).length;
  const lastRowIndex = Math.max(0, rowCount - 1);

  await batchUpdateDoc({
    docs,
    docId,
    requests: [
      {
        insertTableRow: {
          tableCellLocation: {
            tableStartLocation: { index: startIndex },
            rowIndex: lastRowIndex,
            columnIndex: 0
          },
          insertBelow: true
        }
      }
    ]
  });

  const tables2 = await loadDocWalletTables({ docs, docId });
  const t2 = tables2.recentActivity.table;
  const newRow = (t2.tableRows ?? []).at(-1);
  const c0 = newRow?.tableCells?.[0];
  const c1 = newRow?.tableCells?.[1];
  const c2 = newRow?.tableCells?.[2];
  const c3 = newRow?.tableCells?.[3];
  if (!c0 || !c1 || !c2 || !c3) return;

  await batchUpdateDoc({
    docs,
    docId,
    requests: [
      ...[
        { sortIndex: tableCellStartIndex(c0) ?? 0, requests: buildWriteCellRequests({ cell: c0, text: timestampIso }) },
        { sortIndex: tableCellStartIndex(c1) ?? 0, requests: buildWriteCellRequests({ cell: c1, text: type }) },
        { sortIndex: tableCellStartIndex(c2) ?? 0, requests: buildWriteCellRequests({ cell: c2, text: details }) },
        { sortIndex: tableCellStartIndex(c3) ?? 0, requests: buildWriteCellRequests({ cell: c3, text: tx }) }
      ]
        .sort((a, b) => b.sortIndex - a.sortIndex)
        .flatMap((g) => g.requests)
    ]
  });
}

function cellText(cell?: docs_v1.Schema$TableCell): string {
  if (!cell) return "";
  return cellPlainText(cell);
}

function cellPlainText(cell: docs_v1.Schema$TableCell): string {
  const parts: string[] = [];
  for (const el of cell.content ?? []) {
    if (!el.paragraph) continue;
    for (const pe of el.paragraph.elements ?? []) {
      if (pe.textRun?.content) parts.push(pe.textRun.content);
    }
  }
  return parts.join("").replace(/\n/g, " ").trim();
}

// --- Dashboard balance rows ---

export type BalanceRow = {
  rowIndex: number;
  location: string;
  asset: string;
  balance: string;
};

export function readBalancesTable(table: docs_v1.Schema$Table): BalanceRow[] {
  const texts = tablePlainText(table);
  const out: BalanceRow[] = [];
  for (let r = 1; r < texts.length; r++) {
    const row = texts[r] ?? [];
    out.push({
      rowIndex: r,
      location: (row[0] ?? "").trim(),
      asset: (row[1] ?? "").trim(),
      balance: (row[2] ?? "").trim()
    });
  }
  return out;
}

export async function updateBalancesTable(params: {
  docs: docs_v1.Docs;
  docId: string;
  balancesTable: docs_v1.Schema$Table;
  entries: Array<{ location: string; asset: string; balance: string }>;
}) {
  const { docs, docId, balancesTable, entries } = params;
  const rows = balancesTable.tableRows ?? [];
  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];

  const write = (row: docs_v1.Schema$TableRow, col: number, value: string) => {
    const cell = row.tableCells?.[col];
    if (!cell) return;
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text: value }) });
  };

  for (let i = 0; i < entries.length; i++) {
    const rowIdx = i + 1; // skip header
    if (rowIdx >= rows.length) break;
    const entry = entries[i]!;
    const row = rows[rowIdx]!;
    write(row, 0, entry.location);
    write(row, 1, entry.asset);
    write(row, 2, entry.balance);
  }

  if (groups.length > 0) {
    const requests = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
    await batchUpdateDoc({ docs, docId, requests });
  }
}

// --- Dashboard open orders rows ---

export type OpenOrderRow = {
  rowIndex: number;
  orderId: string;
  side: string;
  price: string;
  qty: string;
  status: string;
  updatedAt: string;
  tx: string;
};

export function readOpenOrdersTable(table: docs_v1.Schema$Table): OpenOrderRow[] {
  const texts = tablePlainText(table);
  const out: OpenOrderRow[] = [];
  for (let r = 1; r < texts.length; r++) {
    const row = texts[r] ?? [];
    out.push({
      rowIndex: r,
      orderId: (row[0] ?? "").trim(),
      side: (row[1] ?? "").trim(),
      price: (row[2] ?? "").trim(),
      qty: (row[3] ?? "").trim(),
      status: (row[4] ?? "").trim(),
      updatedAt: (row[5] ?? "").trim(),
      tx: (row[6] ?? "").trim()
    });
  }
  return out;
}

export async function updateOpenOrdersTable(params: {
  docs: docs_v1.Docs;
  docId: string;
  openOrdersTable: docs_v1.Schema$Table;
  orders: Array<{ orderId: string; side: string; price: string; qty: string; status: string; updatedAt: string; tx: string }>;
}) {
  const { docs, docId, openOrdersTable, orders } = params;
  const rows = openOrdersTable.tableRows ?? [];
  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];

  const write = (row: docs_v1.Schema$TableRow, col: number, value: string) => {
    const cell = row.tableCells?.[col];
    if (!cell) return;
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text: value }) });
  };

  for (let i = 0; i < Math.min(orders.length, rows.length - 1); i++) {
    const rowIdx = i + 1;
    const order = orders[i]!;
    const row = rows[rowIdx]!;
    write(row, 0, order.orderId);
    write(row, 1, order.side);
    write(row, 2, order.price);
    write(row, 3, order.qty);
    write(row, 4, order.status);
    write(row, 5, order.updatedAt);
    write(row, 6, order.tx);
  }

  // Clear remaining rows
  for (let i = orders.length; i < rows.length - 1 && i < 11; i++) {
    const rowIdx = i + 1;
    const row = rows[rowIdx];
    if (!row) break;
    for (let c = 0; c < 7; c++) write(row, c, "");
  }

  if (groups.length > 0) {
    const requests = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
    await batchUpdateDoc({ docs, docId, requests });
  }
}
