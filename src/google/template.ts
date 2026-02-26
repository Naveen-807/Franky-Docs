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
export const DOCWALLET_PAYOUT_RULES_ANCHOR = "DOCWALLET_PAYOUT_RULES_ANCHOR";

/** Name of the Quick Start guide tab */
export const GUIDE_TAB_TITLE = "📚 Quick Start Guide";

export type DocWalletTemplate = {
  config: { anchor: typeof DOCWALLET_CONFIG_ANCHOR; table: docs_v1.Schema$Table };
  commands: { anchor: typeof DOCWALLET_COMMANDS_ANCHOR; table: docs_v1.Schema$Table };
  chat: { anchor: typeof DOCWALLET_CHAT_ANCHOR; table: docs_v1.Schema$Table };
  balances: { anchor: typeof DOCWALLET_BALANCES_ANCHOR; table: docs_v1.Schema$Table };
  openOrders: { anchor: typeof DOCWALLET_OPEN_ORDERS_ANCHOR; table: docs_v1.Schema$Table };
  recentActivity: { anchor: typeof DOCWALLET_RECENT_ACTIVITY_ANCHOR; table: docs_v1.Schema$Table };
  sessions: { anchor: typeof DOCWALLET_SESSIONS_ANCHOR; table: docs_v1.Schema$Table };
  audit: { anchor: typeof DOCWALLET_AUDIT_ANCHOR; table: docs_v1.Schema$Table };
  payoutRules: { anchor: typeof DOCWALLET_PAYOUT_RULES_ANCHOR; table: docs_v1.Schema$Table } | null;
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
}, doc?: docs_v1.Schema$Document) {
  const { docs, docId, anchorText, minRows } = params;
  const resolvedDoc = doc ?? await getDoc(docs, docId);
  const anchor = findAnchor(resolvedDoc, anchorText);
  if (!anchor) return;
  const info = findNextTable(resolvedDoc, anchor.elementIndex);
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
      text.startsWith("Autonomous") || text.startsWith("Multi-sig") || text.startsWith("Single-user")) {
      deleteFrom = el.startIndex;
    } else {
      break;
    }
  }

  const docEnd = content.at(-1)?.endIndex;
  if (typeof docEnd !== "number" || deleteFrom >= docEnd - 1) return;
  const safeEnd = docEnd - 1;
  if (safeEnd <= deleteFrom) return;

  await batchUpdateDoc({
    docs, docId,
    requests: [{ deleteContentRange: { range: { startIndex: deleteFrom, endIndex: safeEnd } } }]
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
    "Chat": "💬 Ask Franky",
    "Dashboard — Balances": "💰 Portfolio",
    "Dashboard — Open Orders": "📊 Open Orders",
    "Dashboard — Recent Activity": "📡 Activity Feed",
    "Audit Log": "📝 Audit Log",
    // Upgrade previous emoji headings to new names
    "💬 Chat": "💬 Ask Franky",
    "💰 Balances": "💰 Portfolio",
    "🕐 Recent Activity": "📡 Activity Feed",
  };

  // Also upgrade bare "FrankyDocs" title to branded version
  const titleRename = { old: "FrankyDocs", new: "🟢 FrankyDocs" };

  // Process from bottom-to-top so insertions don't shift earlier indices.
  const ops: Array<{ startIndex: number; endIndex: number; newText: string }> = [];

  for (const el of content) {
    if (!el.paragraph) continue;
    const text = paragraphPlainText(el.paragraph).trim();
    if (typeof el.startIndex !== "number" || typeof el.endIndex !== "number") continue;

    // Check section headings
    const newHeading = renames[text];
    if (newHeading && newHeading !== text) {
      const textEnd = el.endIndex - 1;
      if (textEnd > el.startIndex) {
        ops.push({ startIndex: el.startIndex, endIndex: textEnd, newText: newHeading });
      }
      continue;
    }

    // Check title (exact match only — not already prefixed with DocWallet)
    if (text === titleRename.old || text === "🟢 FrankyDocs — DocWallet") {
      const textEnd = el.endIndex - 1;
      if (textEnd > el.startIndex) {
        ops.push({ startIndex: el.startIndex, endIndex: textEnd, newText: titleRename.new });
      }
    }
  }

  if (ops.length === 0) return;

  // Sort bottom-to-top
  ops.sort((a, b) => b.startIndex - a.startIndex);

  const requests: docs_v1.Schema$Request[] = [];
  for (const op of ops) {
    if (op.endIndex <= op.startIndex) continue; // skip invalid range
    requests.push({ deleteContentRange: { range: { startIndex: op.startIndex, endIndex: op.endIndex } } });
    requests.push({ insertText: { location: { index: op.startIndex }, text: op.newText } });
  }
  if (requests.length === 0) return;
  await batchUpdateDoc({ docs, docId, requests });
}

/** Same as upgradeOldHeadings but accepts an already-fetched doc to avoid an extra getDoc call */
async function upgradeOldHeadingsWithDoc(params: { docs: docs_v1.Docs; docId: string; doc: docs_v1.Schema$Document }) {
  const { docs, docId, doc } = params;
  const content = doc.body?.content ?? [];

  const renames: Record<string, string> = {
    "Config": "⚙️ Configuration", "Commands": "📋 Commands", "Chat": "💬 Ask Franky",
    "Dashboard — Balances": "💰 Portfolio", "Dashboard — Open Orders": "📊 Open Orders",
    "Dashboard — Recent Activity": "📡 Activity Feed",
    "Audit Log": "📝 Audit Log", "💬 Chat": "💬 Ask Franky", "💰 Balances": "💰 Portfolio",
    "🕐 Recent Activity": "📡 Activity Feed",
  };
  const ops: Array<{ startIndex: number; endIndex: number; newText: string }> = [];
  for (const el of content) {
    if (!el.paragraph) continue;
    const text = paragraphPlainText(el.paragraph).trim();
    if (typeof el.startIndex !== "number" || typeof el.endIndex !== "number") continue;
    const newHeading = renames[text];
    if (newHeading && newHeading !== text) {
      const textEnd = el.endIndex - 1;
      if (textEnd > el.startIndex) ops.push({ startIndex: el.startIndex, endIndex: textEnd, newText: newHeading });
      continue;
    }
    if (text === "FrankyDocs" || text === "🟢 FrankyDocs — DocWallet") {
      const textEnd = el.endIndex - 1;
      if (textEnd > el.startIndex) ops.push({ startIndex: el.startIndex, endIndex: textEnd, newText: "🟢 FrankyDocs" });
    }
  }
  if (ops.length === 0) return;
  ops.sort((a, b) => b.startIndex - a.startIndex);
  const requests: docs_v1.Schema$Request[] = [];
  for (const op of ops) {
    if (op.endIndex <= op.startIndex) continue;
    requests.push({ deleteContentRange: { range: { startIndex: op.startIndex, endIndex: op.endIndex } } });
    requests.push({ insertText: { location: { index: op.startIndex }, text: op.newText } });
  }
  if (requests.length > 0) await batchUpdateDoc({ docs, docId, requests });
}

export async function ensureDocWalletTemplate(params: {
  docs: docs_v1.Docs;
  docId: string;
  minCommandRows?: number;
}): Promise<DocWalletTemplate> {
  const { docs, docId, minCommandRows = 30 } = params;

  /* ------------------------------------------------------------------
   * FAST PATH — if all 9 anchors already have tables, skip everything.
   * This turns a 20+ API-call template setup into a single getDoc().
   * ---------------------------------------------------------------- */
  const fastDoc = await getDoc(docs, docId);
  const allAnchors = [
    DOCWALLET_CONFIG_ANCHOR, DOCWALLET_COMMANDS_ANCHOR, DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR, DOCWALLET_OPEN_ORDERS_ANCHOR, DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_PAYOUT_RULES_ANCHOR, DOCWALLET_SESSIONS_ANCHOR, DOCWALLET_AUDIT_ANCHOR
  ];
  const allPresent = allAnchors.every((a) => {
    const loc = findAnchor(fastDoc, a);
    if (!loc) return false;
    const tbl = findNextTable(fastDoc, loc.elementIndex);
    return Boolean(tbl?.table);
  });
  if (allPresent) {
    // Template is fully set up — return immediately (1 API call total)
    let payoutRulesEntry: DocWalletTemplate["payoutRules"] = null;
    try {
      const prTable = mustGetTable(fastDoc, DOCWALLET_PAYOUT_RULES_ANCHOR);
      payoutRulesEntry = { anchor: DOCWALLET_PAYOUT_RULES_ANCHOR, table: prTable };
    } catch { /* old doc */ }

    return {
      config: { anchor: DOCWALLET_CONFIG_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_CONFIG_ANCHOR) },
      commands: { anchor: DOCWALLET_COMMANDS_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_COMMANDS_ANCHOR) },
      chat: { anchor: DOCWALLET_CHAT_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_CHAT_ANCHOR) },
      balances: { anchor: DOCWALLET_BALANCES_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_BALANCES_ANCHOR) },
      openOrders: { anchor: DOCWALLET_OPEN_ORDERS_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_OPEN_ORDERS_ANCHOR) },
      recentActivity: { anchor: DOCWALLET_RECENT_ACTIVITY_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_RECENT_ACTIVITY_ANCHOR) },
      sessions: { anchor: DOCWALLET_SESSIONS_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_SESSIONS_ANCHOR) },
      audit: { anchor: DOCWALLET_AUDIT_ANCHOR, table: mustGetTable(fastDoc, DOCWALLET_AUDIT_ANCHOR) },
      payoutRules: payoutRulesEntry,
    };
  }

  /* ------------------------------------------------------------------
   * Phase 0 — Remove duplicate template blocks from previous failed runs.
   * ---------------------------------------------------------------- */
  await removeDuplicateTemplateBlocks({ docs, docId });

  /* ------------------------------------------------------------------
   * Phase 1 — Ensure all 8 anchor paragraphs exist in the document.
   *           (Text only — tables are inserted in Phase 2.)
   * ---------------------------------------------------------------- */
  let doc = await getDoc(docs, docId);

  // Upgrade old headings inline using the doc we already have (no extra getDoc)
  await upgradeOldHeadingsWithDoc({ docs, docId, doc });

  // Re-fetch doc after heading upgrades may have shifted indices
  doc = await getDoc(docs, docId);

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
    DOCWALLET_PAYOUT_RULES_ANCHOR,
    DOCWALLET_SESSIONS_ANCHOR,
    DOCWALLET_AUDIT_ANCHOR
  ];

  const missingAnchors = requiredAnchors.filter((a) => !findAnchor(doc, a));

  if (!hasBaseAnchors) {
    // Fresh doc — insert all headings + anchor text.
    // Layout: Dashboard sections FIRST (what users care about), then Commands, then Settings.
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
              "Turn any Google Doc into a multi-chain DeFi treasury. Trade, send payments, and manage funds — no wallet extensions, no seed phrases.\n\n" +

              // ═══ DASHBOARD ═══
              "📊 LIVE DASHBOARD\n\n" +

              `💰 Portfolio\n` +
              `${DOCWALLET_BALANCES_ANCHOR}\n\n` +

              `📊 Open Orders\n` +
              `${DOCWALLET_OPEN_ORDERS_ANCHOR}\n\n` +

              `📡 Activity Feed\n` +
              `${DOCWALLET_RECENT_ACTIVITY_ANCHOR}\n\n` +

              // ═══ COMMANDS ═══
              "🎮 COMMAND CENTER\n\n" +

              `📋 Commands\n` +
              `Type commands below — or use plain English. Wallets are created automatically on first use.\n` +
              `${DOCWALLET_COMMANDS_ANCHOR}\n\n` +

              "QUICK REFERENCE\n" +
              "  BCH:         bch price  ·  bch balance  ·  send 10000 sats to bchtest:q...\n" +
              "  CashTokens:  issue token FRANKY FrankyDAO 1000000  ·  send 100 FRANKY to bchtest:q...\n" +
              "  Risk:        DW BCH_STOP_LOSS 0.5 @ 350  ·  DW BCH_TAKE_PROFIT 0.5 @ 500\n" +
              "  Monitoring:  check balance  ·  treasury  ·  trades\n\n" +

              `💬 Ask Franky\n` +
              `${DOCWALLET_CHAT_ANCHOR}\n\n` +

              // ═══ PAYROLL ═══
              "💸 AUTOMATED PAYROLL\n\n" +

              `💸 Payout Rules\n` +
              `${DOCWALLET_PAYOUT_RULES_ANCHOR}\n\n` +

              // ═══ SETTINGS ═══
              "⚙️ SETTINGS & LOGS\n\n" +

              `⚙️ Configuration\n` +
              `${DOCWALLET_CONFIG_ANCHOR}\n\n` +

              `🔗 Connected Apps\n` +
              `${DOCWALLET_SESSIONS_ANCHOR}\n\n` +

              `📝 Audit Log\n` +
              `${DOCWALLET_AUDIT_ANCHOR}\n\n` +

              // ═══ SYSTEM OVERVIEW (clean, no ASCII art) ═══
              "🏗️ HOW IT WORKS\n\n" +

              "① User types in Google Doc → ② Agent parses & executes → ③ Results written back automatically\n\n" +

              "INTEGRATIONS\n" +
              "  🟢 Bitcoin Cash — Native BCH wallet operations and CashTokens support\n" +
              "  ⚙️ BCH Automation — Price checks, conditional orders, and treasury monitoring\n" +
              "  📄 Google Docs API — Zero-config Web2 interface with natural language commands\n\n" +

              "SECURITY\n" +
              "  🔑 Per-doc treasury keys encrypted with AES-256 — never leave the server\n" +
              "  ✅ Access controlled by Google Doc sharing permissions\n" +
              "  📝 Full audit trail of every transaction\n\n" +

              "Built for HackMoney 2026\n\n"
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
          a === DOCWALLET_CHAT_ANCHOR ? "💬 Ask Franky"
            : a === DOCWALLET_SESSIONS_ANCHOR ? "🔗 Connected Apps"
              : a === DOCWALLET_BALANCES_ANCHOR ? "💰 Portfolio"
                : a === DOCWALLET_OPEN_ORDERS_ANCHOR ? "📊 Open Orders"
                  : a === DOCWALLET_RECENT_ACTIVITY_ANCHOR ? "📡 Activity Feed"
                    : a === DOCWALLET_PAYOUT_RULES_ANCHOR ? "💸 Payout Rules"
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
   *           Merged into fewer API calls for speed.
   * ---------------------------------------------------------------- */
  // Single getDoc for row checks
  const rowDoc = await getDoc(docs, docId);
  const configTableCheck = findAnchor(rowDoc, DOCWALLET_CONFIG_ANCHOR);
  const configInfo = configTableCheck ? findNextTable(rowDoc, configTableCheck.elementIndex) : null;
  const needsRowExpansion = configInfo ? ((configInfo.table.tableRows ?? []).length < 30) : true;

  if (needsRowExpansion) {
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_CONFIG_ANCHOR, minRows: 30 }, rowDoc);
    const rowDoc2 = await getDoc(docs, docId);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_COMMANDS_ANCHOR, minRows: Math.max(2, minCommandRows) }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_CHAT_ANCHOR, minRows: 20 }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_BALANCES_ANCHOR, minRows: 25 }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_OPEN_ORDERS_ANCHOR, minRows: 12 }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_RECENT_ACTIVITY_ANCHOR, minRows: 10 }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_PAYOUT_RULES_ANCHOR, minRows: 8 }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_SESSIONS_ANCHOR, minRows: 8 }, rowDoc2);
    await ensureMinTableRows({ docs, docId, anchorText: DOCWALLET_AUDIT_ANCHOR, minRows: 2 }, rowDoc2);
  }

  // Merge populateTemplateTables + hideAnchorText + maybeMigrateCommandsTableV1
  // into a single getDoc + combined batchUpdate
  const mergedDoc = await getDoc(docs, docId);
  const mergedRequests: docs_v1.Schema$Request[] = [];

  // --- Populate template tables ---
  mergedRequests.push(...buildPopulateRequests(mergedDoc, docId, true));

  // --- Hide anchor text ---
  mergedRequests.push(...buildHideAnchorRequests(mergedDoc));

  // --- Migrate commands table v1 if needed ---
  mergedRequests.push(...buildMigrateV1Requests(mergedDoc));

  if (mergedRequests.length > 0) {
    await batchUpdateDoc({ docs, docId, requests: mergedRequests });
  }

  // Style + tabs (these need fresh doc state after the merge)
  await Promise.allSettled([
    styleDocTemplate({ docs, docId }),
    ensureGuideTab({ docs, docId }),
    renameMainTab({ docs, docId }),
  ]);

  const finalDoc = await getDoc(docs, docId);

  // Payout rules is optional — old docs may not have it yet
  let payoutRulesEntry: DocWalletTemplate["payoutRules"] = null;
  try {
    const prTable = mustGetTable(finalDoc, DOCWALLET_PAYOUT_RULES_ANCHOR);
    payoutRulesEntry = { anchor: DOCWALLET_PAYOUT_RULES_ANCHOR, table: prTable };
  } catch { /* old doc without payout rules — fine */ }

  return {
    config: { anchor: DOCWALLET_CONFIG_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_CONFIG_ANCHOR) },
    commands: { anchor: DOCWALLET_COMMANDS_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_COMMANDS_ANCHOR) },
    chat: { anchor: DOCWALLET_CHAT_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_CHAT_ANCHOR) },
    balances: { anchor: DOCWALLET_BALANCES_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_BALANCES_ANCHOR) },
    openOrders: { anchor: DOCWALLET_OPEN_ORDERS_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_OPEN_ORDERS_ANCHOR) },
    recentActivity: { anchor: DOCWALLET_RECENT_ACTIVITY_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_RECENT_ACTIVITY_ANCHOR) },
    sessions: { anchor: DOCWALLET_SESSIONS_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_SESSIONS_ANCHOR) },
    audit: { anchor: DOCWALLET_AUDIT_ANCHOR, table: mustGetTable(finalDoc, DOCWALLET_AUDIT_ANCHOR) },
    payoutRules: payoutRulesEntry,
  };
}

/* ---------- Table spec for each anchor section ---------- */
const TABLE_SPEC: Record<string, { rows: number; cols: number }> = {
  [DOCWALLET_CONFIG_ANCHOR]: { rows: 30, cols: 2 },
  [DOCWALLET_COMMANDS_ANCHOR]: { rows: 30, cols: 6 },
  [DOCWALLET_CHAT_ANCHOR]: { rows: 20, cols: 2 },
  [DOCWALLET_BALANCES_ANCHOR]: { rows: 25, cols: 3 },
  [DOCWALLET_OPEN_ORDERS_ANCHOR]: { rows: 12, cols: 7 },
  [DOCWALLET_RECENT_ACTIVITY_ANCHOR]: { rows: 10, cols: 4 },
  [DOCWALLET_PAYOUT_RULES_ANCHOR]: { rows: 8, cols: 7 },
  [DOCWALLET_SESSIONS_ANCHOR]: { rows: 8, cols: 5 },
  [DOCWALLET_AUDIT_ANCHOR]: { rows: 2, cols: 2 },
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
  const { docs, docId, minCommandRows = 30 } = params;
  const doc = await getDoc(docs, docId);

  // Ordered top-to-bottom as they appear in the document.
  const orderedAnchors = [
    DOCWALLET_CONFIG_ANCHOR,
    DOCWALLET_COMMANDS_ANCHOR,
    DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR,
    DOCWALLET_OPEN_ORDERS_ANCHOR,
    DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_PAYOUT_RULES_ANCHOR,
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
    ["MODE", "SINGLE_USER"],
    ["BCH_ADDRESS", ""],
    ["BCH_NETWORK", "chipnet"],
    ["APPROVALS_TOTAL", "0"],
    ["EST_APPROVAL_TX_AVOIDED", "0"],
    ["SIGNER_APPROVAL_GAS_PAID", "0.003"],
    ["DOC_CELL_APPROVALS", "1"],
    ["AGENT_AUTOPROPOSE", "1"],
    ["LAST_PROPOSAL", ""],
    ["LAST_APPROVAL", ""],
    ["DEMO_MODE", "0"],
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

  // Payout Rules header + example row (optional table — may not exist on old docs)
  try {
    const payoutRulesTable = mustGetTable(doc, DOCWALLET_PAYOUT_RULES_ANCHOR);
    const prRows = payoutRulesTable.tableRows ?? [];
    const prHeader = ["LABEL", "RECIPIENT", "AMOUNT_USDC", "FREQUENCY", "NEXT_RUN", "LAST_TX", "STATUS"];
    for (let c = 0; c < prHeader.length; c++) setIf(prRows[0]?.tableCells?.[c], prHeader[c]);
    // Add example row to help Web2 users understand the payroll feature
    if (prRows.length > 1 && onlyFillEmpty) {
      const exampleRow = ["Team Salary (example)", "0x0000000000000000000000000000000000000000", "500", "monthly", "—", "—", "PAUSED"];
      for (let c = 0; c < exampleRow.length; c++) setIf(prRows[1]?.tableCells?.[c], exampleRow[c]);
    }
  } catch { /* no payout rules table yet — fine */ }

  const ordered = groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
  await batchUpdateDoc({ docs, docId, requests: ordered });
}

/** Build populate requests without calling getDoc — uses an already-fetched doc. Returns sorted requests. */
function buildPopulateRequests(doc: docs_v1.Schema$Document, docId: string, onlyFillEmpty: boolean): docs_v1.Schema$Request[] {
  const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];
  const setIf = (cell: docs_v1.Schema$TableCell | undefined, text: string) => {
    if (!cell) return;
    if (onlyFillEmpty) {
      const existing = cellPlainText(cell);
      if (existing.trim() !== "") return;
    }
    groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text }) });
  };

  try {
    const configTable = mustGetTable(doc, DOCWALLET_CONFIG_ANCHOR);
    const cfg = configTable.tableRows ?? [];
    setIf(cfg[0]?.tableCells?.[0], "KEY");
    setIf(cfg[0]?.tableCells?.[1], "VALUE");
    const cfgKeys: Array<[string, string]> = [
      ["DOCWALLET_VERSION", "2"], ["STATUS", "NEEDS_SETUP"], ["DOC_ID", docId],
      ["EVM_ADDRESS", ""], ["WEB_BASE_URL", ""], ["MODE", "SINGLE_USER"],
      ["BCH_ADDRESS", ""], ["BCH_NETWORK", "chipnet"],
      ["APPROVALS_TOTAL", "0"], ["EST_APPROVAL_TX_AVOIDED", "0"], ["SIGNER_APPROVAL_GAS_PAID", "0.003"],
      ["DOC_CELL_APPROVALS", "1"], ["AGENT_AUTOPROPOSE", "1"], ["LAST_PROPOSAL", ""],
      ["LAST_APPROVAL", ""], ["DEMO_MODE", "0"],
    ];
    for (let i = 0; i < cfgKeys.length; i++) {
      const row = cfg[i + 1];
      setIf(row?.tableCells?.[0], cfgKeys[i][0]);
      setIf(row?.tableCells?.[1], cfgKeys[i][1]);
    }
  } catch { /* config table missing */ }

  const tableHeaders: Array<{ anchor: string; headers: string[] }> = [
    { anchor: DOCWALLET_COMMANDS_ANCHOR, headers: ["ID", "COMMAND", "STATUS", "APPROVAL_URL", "RESULT", "ERROR"] },
    { anchor: DOCWALLET_CHAT_ANCHOR, headers: ["USER", "AGENT"] },
    { anchor: DOCWALLET_BALANCES_ANCHOR, headers: ["LOCATION", "ASSET", "BALANCE"] },
    { anchor: DOCWALLET_OPEN_ORDERS_ANCHOR, headers: ["ORDER_ID", "SIDE", "PRICE", "QTY", "STATUS", "UPDATED_AT", "TX"] },
    { anchor: DOCWALLET_RECENT_ACTIVITY_ANCHOR, headers: ["TIME", "TYPE", "DETAILS", "TX"] },
    { anchor: DOCWALLET_SESSIONS_ANCHOR, headers: ["SESSION_ID", "PEER_NAME", "CHAINS", "CREATED_AT", "STATUS"] },
    { anchor: DOCWALLET_AUDIT_ANCHOR, headers: ["TIME", "MESSAGE"] },
  ];
  for (const { anchor, headers } of tableHeaders) {
    try {
      const table = mustGetTable(doc, anchor);
      const rows = table.tableRows ?? [];
      for (let c = 0; c < headers.length; c++) setIf(rows[0]?.tableCells?.[c], headers[c]);
    } catch { /* table missing */ }
  }

  try {
    const payoutRulesTable = mustGetTable(doc, DOCWALLET_PAYOUT_RULES_ANCHOR);
    const prRows = payoutRulesTable.tableRows ?? [];
    const prHeader = ["LABEL", "RECIPIENT", "AMOUNT_USDC", "FREQUENCY", "NEXT_RUN", "LAST_TX", "STATUS"];
    for (let c = 0; c < prHeader.length; c++) setIf(prRows[0]?.tableCells?.[c], prHeader[c]);
    if (prRows.length > 1 && onlyFillEmpty) {
      const exampleRow = ["Team Salary (example)", "0x0000000000000000000000000000000000000000", "500", "monthly", "—", "—", "PAUSED"];
      for (let c = 0; c < exampleRow.length; c++) setIf(prRows[1]?.tableCells?.[c], exampleRow[c]);
    }
  } catch { /* no payout rules table */ }

  return groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
}

/** Build hide-anchor-text requests from an already-fetched doc */
function buildHideAnchorRequests(doc: docs_v1.Schema$Document): docs_v1.Schema$Request[] {
  const anchors = [
    DOCWALLET_CONFIG_ANCHOR, DOCWALLET_COMMANDS_ANCHOR, DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR, DOCWALLET_OPEN_ORDERS_ANCHOR, DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_PAYOUT_RULES_ANCHOR, DOCWALLET_SESSIONS_ANCHOR, DOCWALLET_AUDIT_ANCHOR
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
  return requests;
}

/** Build v1→v2 migration requests from an already-fetched doc */
function buildMigrateV1Requests(doc: docs_v1.Schema$Document): docs_v1.Schema$Request[] {
  try {
    const commandsTable = mustGetTable(doc, DOCWALLET_COMMANDS_ANCHOR);
    const rows = commandsTable.tableRows ?? [];
    const headerCells = rows[0]?.tableCells ?? [];
    const col2 = headerCells[2] ? cellPlainText(headerCells[2]) : "";
    const col3 = headerCells[3] ? cellPlainText(headerCells[3]) : "";
    if (col2.trim().toUpperCase() !== "APPROVAL" || col3.trim().toUpperCase() !== "STATUS") return [];

    const groups: Array<{ sortIndex: number; requests: docs_v1.Schema$Request[] }> = [];
    const write = (cell: docs_v1.Schema$TableCell | undefined, text: string) => {
      if (!cell) return;
      groups.push({ sortIndex: tableCellStartIndex(cell) ?? 0, requests: buildWriteCellRequests({ cell, text }) });
    };
    const v2Header = ["ID", "COMMAND", "STATUS", "APPROVAL_URL", "RESULT", "ERROR"];
    for (let c = 0; c < v2Header.length; c++) write(headerCells[c], v2Header[c]!);
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r]?.tableCells ?? [];
      const statusVal = cells[3] ? cellPlainText(cells[3]) : "";
      if (statusVal.trim()) write(cells[2], statusVal.trim());
      write(cells[3], "");
    }
    return groups.sort((a, b) => b.sortIndex - a.sortIndex).flatMap((g) => g.requests);
  } catch { return []; }
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
    DOCWALLET_PAYOUT_RULES_ANCHOR,
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
 * Apply polished Google Doc styling — professional dashboard look with branded colors.
 * Dark header rows, readable fonts, clear visual hierarchy.
 * Runs idempotently; safe to call multiple times.
 */
async function styleDocTemplate(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  const doc = await getDoc(docs, docId);
  const content = doc.body?.content ?? [];
  const requests: docs_v1.Schema$Request[] = [];

  // ═══ COLOR PALETTE ═══
  const BRAND_BLUE = { red: 0.05, green: 0.27, blue: 0.63 };      // Deep professional blue
  const BRAND_GREEN = { red: 0.13, green: 0.55, blue: 0.13 };      // Status green
  const DARK_GRAY = { red: 0.15, green: 0.15, blue: 0.17 };        // Body text
  const MED_GRAY = { red: 0.42, green: 0.44, blue: 0.47 };         // Subtitle/description
  const HEADER_BG = { red: 0.12, green: 0.24, blue: 0.45 };        // Dark blue table headers
  const HEADER_TEXT = { red: 1, green: 1, blue: 1 };                // White text on dark headers
  const ALT_ROW_BG = { red: 0.95, green: 0.97, blue: 1.0 };        // Light blue alternating rows
  const SECTION_LINE = { red: 0.28, green: 0.52, blue: 0.90 };     // Section divider color
  const CONFIG_HEADER_BG = { red: 0.93, green: 0.93, blue: 0.95 }; // Lighter gray for config

  // Section heading texts
  const sectionHeadings = new Set([
    "⚙️ Configuration", "📋 Commands", "💬 Ask Franky", "💰 Portfolio",
    "📊 Open Orders", "📡 Activity Feed", "🔗 Connected Apps", "📝 Audit Log",
    "💸 Payout Rules",
    // Legacy
    "💬 Chat", "💰 Balances", "🕐 Recent Activity",
    "Config", "Commands", "Chat", "Dashboard — Balances",
    "Dashboard — Open Orders", "Dashboard — Recent Activity",
    "Audit Log"
  ]);

  // Description texts (styled as subtle helper text)
  const descriptionTexts = new Set([
    "Auto-updated balances across BCH and CashTokens",
    "Your active BCH conditional orders",
    "Recent transactions, agent actions, and proposals",
    "Type commands below to trade, send, or manage. Wallets and sessions are created automatically.",
    "Ask anything — \"bch price\", \"treasury\", \"help\". Prefix with !execute to auto-submit.",
    "Connected app sessions and audit visibility",
    "Your Google Doc is now a multi-chain treasury. Trade, send, and manage crypto — right here.",
    "Autonomous single-user treasury agent powered by Google Docs",
    "Single-user treasury agent powered by Google Docs",
    "Spreadsheet-driven payroll. Fill in rows — Franky pays automatically via BCH.",
    // New v3 descriptions
    "Turn any Google Doc into a multi-chain DeFi treasury. Trade, send payments, and manage funds — no wallet extensions, no seed phrases.",
    "Real-time balances across all connected networks — auto-refreshed every 60 seconds",
    "Active BCH stop-loss/take-profit orders",
    "Live stream of transactions, agent proposals, and system events",
    "Type commands below — or use plain English. Wallets are created automatically on first use.",
    "Chat with the AI assistant — ask anything like \"bch price\", \"check balance\", or \"help\"",
    "Define recurring payments in the table below. The agent processes them automatically via BCH.",
    "External app connection records",
    "Complete history of every action taken by the system",
    "DW TREASURY — View all balances  |  DW REBALANCE <amt> FROM <chain> TO <chain> — Move capital",
    "Built for ETH HackMoney 2026  —  github.com/FrankyDocs",
  ]);

  // Section separator texts
  const sectionSeparators = new Set([
    // Legacy short separators
    "━━━━━━━━━━━  LIVE DASHBOARD  ━━━━━━━━━━━",
    "━━━━━━━━━━━  COMMANDS & CHAT  ━━━━━━━━━━━",
    "━━━━━━━━━━━  PAYROLL  ━━━━━━━━━━━",
    "━━━━━━━━━━━  SETTINGS  ━━━━━━━━━━━",
    // New wide separators (border lines)
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ]);

  // Section label texts (the line inside separators, styled as bold headings)
  const sectionLabels = new Set([
    "  📊  LIVE DASHBOARD",
    "  🎮  COMMAND CENTER",
    "  💸  AUTOMATED PAYROLL",
    "  ⚙️  SETTINGS & LOGS",
    "  🏗️  HOW FRANKYDOCS WORKS",
    "  🗺️  MULTI-CHAIN TREASURY MAP",
    "  🔒  SECURITY MODEL",
    "  ⚡  POWERED BY",
    // v4 clean section labels (no leading spaces)
    "📊 LIVE DASHBOARD",
    "🎮 COMMAND CENTER",
    "💸 AUTOMATED PAYROLL",
    "⚙️ SETTINGS & LOGS",
    "🏗️ HOW IT WORKS",
  ]);

  // Monospace box-drawing content (flowcharts, diagrams)
  const boxDrawingPrefixes = ["┌", "│", "└", "├", "         │", "         ▼"];

  // Sub-heading texts in the architecture sections
  const archSubHeadings = new Set([
    "ACCESS CONTROL",
    "KEY MANAGEMENT",
    "ON-CHAIN SIGNING",
    "TRANSACTION FLOW",
    "INTEGRATIONS",
    "SECURITY",
    "QUICK REFERENCE",
  ]);

  for (const el of content) {
    if (!el.paragraph) continue;
    const para = el.paragraph;
    const text = paragraphPlainText(para).trim();
    const startIdx = el.startIndex;
    const endIdx = el.endIndex;
    if (typeof startIdx !== "number" || typeof endIdx !== "number") continue;

    // ── Title ──
    if (text.includes("FrankyDocs") && !text.includes("ANCHOR") && text.length < 40) {
      const currentStyle = para.paragraphStyle?.namedStyleType;
      if (currentStyle !== "TITLE") {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: startIdx, endIndex: endIdx },
            paragraphStyle: { namedStyleType: "TITLE" },
            fields: "namedStyleType"
          }
        });
      }
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 28, unit: "PT" },
            foregroundColor: { color: { rgbColor: BRAND_BLUE } }
          },
          fields: "bold,fontSize,foregroundColor"
        }
      });
    }

    // ── Subtitle / description lines ──
    if (descriptionTexts.has(text)) {
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
            italic: true,
            fontSize: { magnitude: 10, unit: "PT" },
            foregroundColor: { color: { rgbColor: MED_GRAY } }
          },
          fields: "italic,fontSize,foregroundColor"
        }
      });
    }

    // ── Section separators (━━━ lines) ──
    if (sectionSeparators.has(text)) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 8, unit: "PT" },
            foregroundColor: { color: { rgbColor: SECTION_LINE } }
          },
          fields: "bold,fontSize,foregroundColor"
        }
      });
    }

    // ── Section labels (  📊  LIVE DASHBOARD  etc.) ──
    if (sectionLabels.has(text)) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: startIdx, endIndex: endIdx },
          paragraphStyle: { namedStyleType: "HEADING_1" },
          fields: "namedStyleType"
        }
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 18, unit: "PT" },
            foregroundColor: { color: { rgbColor: BRAND_BLUE } }
          },
          fields: "bold,fontSize,foregroundColor"
        }
      });
    }

    // ── Box-drawing / ASCII art (flowcharts, diagrams) → monospace ──
    if (boxDrawingPrefixes.some(p => text.startsWith(p))) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            fontSize: { magnitude: 9, unit: "PT" },
            weightedFontFamily: { fontFamily: "Courier New", weight: 400 },
            foregroundColor: { color: { rgbColor: DARK_GRAY } }
          },
          fields: "fontSize,weightedFontFamily,foregroundColor"
        }
      });
    }

    // ── System overview sub-headings (ACCESS CONTROL, etc.) ──
    if (archSubHeadings.has(text)) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 11, unit: "PT" },
            foregroundColor: { color: { rgbColor: BRAND_GREEN } }
          },
          fields: "bold,fontSize,foregroundColor"
        }
      });
    }

    // ── Check/key/pen bullet items (✅ 🔑 📝 in security section) ──
    if (text.startsWith("✅") || text.startsWith("🔑") || text.startsWith("📝")) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            fontSize: { magnitude: 10, unit: "PT" },
            foregroundColor: { color: { rgbColor: DARK_GRAY } }
          },
          fields: "fontSize,foregroundColor"
        }
      });
    }

    // ── Integration bullets (🔵 🔷 ⚡ 📄 lines in the architecture section) ──
    if ((text.startsWith("🔵") || text.startsWith("🔷") || text.startsWith("⚡") || text.startsWith("📄")) && text.includes("—")) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            fontSize: { magnitude: 10, unit: "PT" },
            foregroundColor: { color: { rgbColor: DARK_GRAY } }
          },
          fields: "fontSize,foregroundColor"
        }
      });
    }

    // ── Quick reference command lines (  Trading: ... / Payments: ... etc.) ──
    if (/^\s*(Trading|Payments|Cross-chain|Monitoring|Automation):/.test(text)) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            fontSize: { magnitude: 9, unit: "PT" },
            weightedFontFamily: { fontFamily: "Roboto Mono", weight: 400 },
            foregroundColor: { color: { rgbColor: DARK_GRAY } }
          },
          fields: "fontSize,weightedFontFamily,foregroundColor"
        }
      });
    }

    // ── Flow summary line (① User types...) ──
    if (text.startsWith("①")) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 11, unit: "PT" },
            foregroundColor: { color: { rgbColor: BRAND_BLUE } }
          },
          fields: "bold,fontSize,foregroundColor"
        }
      });
    }

    // ── "Built for HackMoney" footer ──
    if (text.startsWith("Built for")) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            italic: true,
            fontSize: { magnitude: 9, unit: "PT" },
            foregroundColor: { color: { rgbColor: MED_GRAY } }
          },
          fields: "italic,fontSize,foregroundColor"
        }
      });
    }

    // ── Section headings → HEADING_2 with brand blue ──
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
      }
      requests.push({
        updateTextStyle: {
          range: { startIndex: startIdx, endIndex: endIdx - 1 },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 16, unit: "PT" },
            foregroundColor: { color: { rgbColor: BRAND_BLUE } }
          },
          fields: "bold,fontSize,foregroundColor"
        }
      });
    }
  }

  // ═══ Style table header rows — dark blue background, white bold text ═══
  const allAnchors = [
    DOCWALLET_CONFIG_ANCHOR, DOCWALLET_COMMANDS_ANCHOR, DOCWALLET_CHAT_ANCHOR,
    DOCWALLET_BALANCES_ANCHOR, DOCWALLET_OPEN_ORDERS_ANCHOR, DOCWALLET_RECENT_ACTIVITY_ANCHOR,
    DOCWALLET_SESSIONS_ANCHOR, DOCWALLET_AUDIT_ANCHOR
  ];

  // Config gets a lighter header since it's a settings table
  const lightHeaderAnchors = new Set([DOCWALLET_CONFIG_ANCHOR]);

  for (const anchorText of allAnchors) {
    const anchor = findAnchor(doc, anchorText);
    if (!anchor) continue;
    const tableInfo = findNextTable(doc, anchor.elementIndex);
    if (!tableInfo?.table) continue;
    const headerRow = tableInfo.table.tableRows?.[0];
    if (!headerRow) continue;

    const isLightHeader = lightHeaderAnchors.has(anchorText);
    const bgColor = isLightHeader ? CONFIG_HEADER_BG : HEADER_BG;
    const textColor = isLightHeader ? DARK_GRAY : HEADER_TEXT;

    for (const cell of headerRow.tableCells ?? []) {
      const range = tableCellRange(cell);
      if (!range) continue;

      // Bold + colored text in header
      if (range.endIndex > range.startIndex + 1) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: range.startIndex, endIndex: range.endIndex - 1 },
            textStyle: {
              bold: true,
              fontSize: { magnitude: 9, unit: "PT" },
              foregroundColor: { color: { rgbColor: textColor } }
            },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }

      // Background color for header cell
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
            backgroundColor: { color: { rgbColor: bgColor } }
          },
          fields: "backgroundColor"
        }
      });
    }

    // ── Pin header row for scrolling ──
    requests.push({
      pinTableHeaderRows: {
        tableStartLocation: { index: tableInfo.startIndex },
        pinnedHeaderRowsCount: 1
      }
    });

    // ── Alternating row colors (light blue for even rows) — for non-config tables ──
    if (!isLightHeader) {
      const rows = tableInfo.table.tableRows ?? [];
      const cols = rows[0]?.tableCells?.length ?? 1;
      for (let r = 1; r < rows.length; r++) {
        if (r % 2 === 0) { // Even rows get light blue background
          for (let c = 0; c < cols; c++) {
            requests.push({
              updateTableCellStyle: {
                tableRange: {
                  tableCellLocation: {
                    tableStartLocation: { index: tableInfo.startIndex },
                    rowIndex: r,
                    columnIndex: c
                  },
                  rowSpan: 1,
                  columnSpan: 1
                },
                tableCellStyle: {
                  backgroundColor: { color: { rgbColor: ALT_ROW_BG } }
                },
                fields: "backgroundColor"
              }
            });
          }
        }
      }
    }
  }

  if (requests.length > 0) {
    await batchUpdateDoc({ docs, docId, requests });
  }
}

/**
 * Rename the main document tab to "📊 DocWallet" for a cleaner tab bar.
 * Uses raw API calls since googleapis types may not include newer tab APIs.
 * Idempotent — only renames if the tab still has the default name.
 */
async function renameMainTab(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  try {
    // Fetch with includeTabsContent to get tab metadata (cast to any for newer API param)
    const res = await docs.documents.get({ documentId: docId, includeTabsContent: true } as any);
    const data = res.data as any;
    const tabs: any[] = data.tabs ?? [];
    if (tabs.length === 0) return;

    const firstTab = tabs[0];
    const tabId = firstTab?.tabProperties?.tabId;
    const currentTitle = firstTab?.tabProperties?.title ?? "";

    // Only rename if it's still the default empty name or generic name
    if (tabId && (!currentTitle || currentTitle === "Tab 1" || currentTitle === docId.slice(0, 8))) {
      await batchUpdateDoc({
        docs,
        docId,
        requests: [{
          updateDocumentTabProperties: {
            tabProperties: { tabId, title: "📊 FrankyDocs" },
            fields: "title"
          }
        } as any]
      });
    }
  } catch {
    // Tab APIs may not be available in this googleapis version — gracefully skip
  }
}

/**
 * Create a "📚 Quick Start Guide" tab with user-friendly help content.
 * New users see this tab and immediately understand what to do.
 * Uses `any` casts since googleapis types may not include newer tab APIs.
 * Idempotent — checks if the guide tab already exists.
 */
async function ensureGuideTab(params: { docs: docs_v1.Docs; docId: string }) {
  const { docs, docId } = params;
  try {
    const res = await docs.documents.get({ documentId: docId, includeTabsContent: true } as any);
    const data = res.data as any;
    const tabs: any[] = data.tabs ?? [];

    // Check if guide tab already exists
    const hasGuide = tabs.some((t: any) => t.tabProperties?.title === GUIDE_TAB_TITLE);
    if (hasGuide) return;

    // Create the guide tab
    await batchUpdateDoc({
      docs,
      docId,
      requests: [{
        addDocumentTab: {
          tabProperties: {
            title: GUIDE_TAB_TITLE,
            index: 1 // Second tab
          }
        }
      } as any]
    });

    // Re-fetch to get the new tab's ID
    const res2 = await docs.documents.get({ documentId: docId, includeTabsContent: true } as any);
    const data2 = res2.data as any;
    const guideTab = ((data2.tabs ?? []) as any[]).find((t: any) => t.tabProperties?.title === GUIDE_TAB_TITLE);
    const guideTabId = guideTab?.tabProperties?.tabId;
    if (!guideTabId) return;

    // Populate the guide tab with helpful content (Web2-native language)
    const guideContent = [
      "🟢 FrankyDocs — Quick Start Guide\n\n",
      "Welcome! Your Google Doc is now a multi-chain DeFi treasury.\n",
      "Trade, send payments, bridge assets, and manage funds — all by typing in this document.\n",
      "No browser extensions. No seed phrases. No crypto knowledge needed.\n\n",

      "━━━━━━━━━━━  HOW IT WORKS  ━━━━━━━━━━━\n\n",

      "1️⃣  Go to the 📊 DocWallet tab\n",
      "2️⃣  Type a command in the Commands table (plain English works!)\n",
      "3️⃣  The agent parses, executes, and writes results back — automatically\n",
      "4️⃣  Watch your Portfolio, Orders, and Activity update in real-time\n\n",

      "💡 Wallets, trading accounts, and payment accounts are created automatically on your first command. Literally zero setup.\n\n",

      "━━━━━━━━━━━  GET STARTED (2 min)  ━━━━━━━━━━━\n\n",

      "Type any of these in the COMMAND column:\n\n",
      "   bch price                       → Live BCH/USD price\n",
      "   check balance                   → See all your funds across every chain\n",
      "   send 5 USDC to 0x...           → Send $5 USDC to any address\n",
      "   send 10000 sats to bchtest:q... → Send BCH in satoshis\n",
      "   help                            → Full command reference\n\n",

      "━━━━━━━━━━━  COMMAND REFERENCE  ━━━━━━━━━━━\n\n",

      "💳 BCH OPERATIONS\n",
      "   DW BCH_SEND bchtest:q... 10000  → Send BCH in satoshis\n",
      "   DW BCH_PRICE                    → Live BCH/USD price\n",
      "   DW BCH_TOKEN_BALANCE            → BCH + CashToken balances\n\n",

      "📊 MONITORING\n",
      "   check balance                   → All balances at a glance\n",
      "   treasury                        → BCH treasury summary\n",
      "   trades                          → Recent command/trade activity\n\n",

      "━━━━━━━━━━━  BCH & CASHTOKENS  ━━━━━━━━━━━\n\n",

      "🪙 BITCOIN CASH (BCH CashTokens DAO)\n",
      "   bch price                        → Live BCH/USD price\n",
      "   bch balance                      → View your BCH & CashTokens balances\n",
      "   send 10000 sats to bchtest:qp..  → Send BCH (in satoshis)\n",
      "   issue token FRANKY FrankyDAO 1000000 → Issue a new CashToken (fungible)\n",
      "   send 100 FRANKY to bchtest:qp..  → Transfer CashTokens to another address\n",
      "   DW BCH_STOP_LOSS 0.5 @ 350      → Auto-sell BCH if price drops below $350\n",
      "   DW BCH_TAKE_PROFIT 0.5 @ 500    → Auto-sell BCH if price rises above $500\n\n",

      "━━━━━━━━━━━  ASK FRANKY (AI Chat)  ━━━━━━━━━━━\n\n",

      "Use the 💬 Ask Franky table to chat naturally:\n\n",
      "   \"What's my balance?\"\n",
      "   \"Send 10000 sats to bchtest:q...\"\n",
      "   \"Issue token FRANKY FrankyDAO 1000000\"\n",
      "   \"What are my active orders?\"\n\n",
      "Prefix with !execute to automatically run the suggested command.\n\n",

      "━━━━━━━━━━━  BEHIND THE SCENES  ━━━━━━━━━━━\n\n",

      "FrankyDocs connects five technologies into one seamless interface:\n\n",

      "┌──────────────────────────────────────────────────────────────┐\n",
      "│  📄  Google Docs API     Your familiar document = your UI    │\n",
      "│  🟢  Bitcoin Cash        Native BCH transfers + CashTokens    │\n",
      "│  ⚙️  BCH Automation      Conditional orders + treasury checks │\n",
      "│  📄  Google Docs API     Natural-language command interface   │\n",
      "│  🤖  Autonomous Agent    Stop-loss, DCA, rebalance proposals  │\n",
      "└──────────────────────────────────────────────────────────────┘\n\n",

      "🔒 Security: Treasury keys are encrypted at rest (AES-256), never leave the server, and every transaction is cryptographically signed. Access is controlled by Google Doc sharing permissions.\n\n",

      "━━━━━━━━━━━  NEED HELP?  ━━━━━━━━━━━\n\n",

      "• Open the web dashboard at your WEB_BASE_URL (shown in Configuration)\n",
      "• The Activity Feed shows all actions and their status\n",
      "• The AI agent automatically suggests actions to optimize your treasury\n",
      "• Type \"help\" in the Commands table for a full command list\n"
    ].join("");

    // Insert text into the guide tab (endOfSegmentLocation with tabId)
    await batchUpdateDoc({
      docs,
      docId,
      requests: [{
        insertText: {
          endOfSegmentLocation: { tabId: guideTabId } as any,
          text: guideContent
        }
      }]
    });

    // Style the guide tab — re-fetch to get correct indices
    const res3 = await docs.documents.get({ documentId: docId, includeTabsContent: true } as any);
    const data3 = res3.data as any;
    const guideTab2 = ((data3.tabs ?? []) as any[]).find((t: any) => t.tabProperties?.title === GUIDE_TAB_TITLE);
    const guideBody: any[] = guideTab2?.documentTab?.body?.content ?? [];

    const styleReqs: docs_v1.Schema$Request[] = [];
    const BRAND_BLUE = { red: 0.05, green: 0.27, blue: 0.63 };
    const SECTION_LINE = { red: 0.28, green: 0.52, blue: 0.90 };
    const ACCENT_GREEN = { red: 0.13, green: 0.55, blue: 0.13 };

    const guideSections = new Set([
      "📈 TRADING", "💸 PAYMENTS", "🌉 MOVING FUNDS BETWEEN NETWORKS", "📊 CHECKING YOUR FUNDS", "⏰ AUTOMATION",
      // New v3 sections
      "📈 TRADING (Bitcoin Cash price + conditional orders)",
      "💳 PAYMENTS (Native BCH transfers and CashTokens)",
      "🌉 BRIDGING (Optional external bridge integrations)",
      "⚡ AUTOMATION (Doc-driven execution loop)",
      "📊 MONITORING",
      // BCH CashTokens
      "🪙 BITCOIN CASH (BCH CashTokens DAO)",
    ]);
    const guideSeparators = new Set([
      "━━━━━━━━━━━  HOW IT WORKS  ━━━━━━━━━━━",
      "━━━━━━━━━━━  TRY IT NOW (5 min)  ━━━━━━━━━━━",
      "━━━━━━━━━━━  ALL COMMANDS  ━━━━━━━━━━━",
      "━━━━━━━━━━━  ASK FRANKY (Chat)  ━━━━━━━━━━━",
      "━━━━━━━━━━━  WHAT HAPPENS BEHIND THE SCENES  ━━━━━━━━━━━",
      "━━━━━━━━━━━  NEED HELP?  ━━━━━━━━━━━",
      // New v3 separators
      "━━━━━━━━━━━  GET STARTED (2 min)  ━━━━━━━━━━━",
      "━━━━━━━━━━━  COMMAND REFERENCE  ━━━━━━━━━━━",
      "━━━━━━━━━━━  ASK FRANKY (AI Chat)  ━━━━━━━━━━━",
      "━━━━━━━━━━━  BEHIND THE SCENES  ━━━━━━━━━━━",
      // BCH CashTokens
      "━━━━━━━━━━━  BCH & CASHTOKENS  ━━━━━━━━━━━",
    ]);

    for (const el of guideBody) {
      if (!el.paragraph) continue;
      const text = paragraphPlainText(el.paragraph).trim();
      const si = el.startIndex as number | undefined;
      const ei = el.endIndex as number | undefined;
      if (typeof si !== "number" || typeof ei !== "number" || ei <= si + 1) continue;

      // Title
      if (text.includes("FrankyDocs") && text.includes("Quick Start")) {
        styleReqs.push({
          updateParagraphStyle: {
            range: { startIndex: si, endIndex: ei },
            paragraphStyle: { namedStyleType: "TITLE" },
            fields: "namedStyleType"
          }
        });
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { bold: true, fontSize: { magnitude: 24, unit: "PT" }, foregroundColor: { color: { rgbColor: BRAND_BLUE } } },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }

      // Section separators
      if (guideSeparators.has(text)) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { bold: true, fontSize: { magnitude: 11, unit: "PT" }, foregroundColor: { color: { rgbColor: SECTION_LINE } } },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }

      // Sub-sections
      if (guideSections.has(text)) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { bold: true, fontSize: { magnitude: 12, unit: "PT" }, foregroundColor: { color: { rgbColor: BRAND_BLUE } } },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }

      // Command examples (lines starting with "DW ")
      if (text.startsWith("DW ")) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { fontSize: { magnitude: 10, unit: "PT" }, foregroundColor: { color: { rgbColor: { red: 0.15, green: 0.15, blue: 0.15 } } } },
            fields: "fontSize,foregroundColor"
          }
        });
      }

      // Box-drawing / ASCII art in guide tab → monospace
      if (text.startsWith("┌") || text.startsWith("│") || text.startsWith("└")) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: {
              fontSize: { magnitude: 9, unit: "PT" },
              weightedFontFamily: { fontFamily: "Courier New", weight: 400 },
              foregroundColor: { color: { rgbColor: { red: 0.15, green: 0.15, blue: 0.17 } } }
            },
            fields: "fontSize,weightedFontFamily,foregroundColor"
          }
        });
      }

      // Security line (🔒)
      if (text.startsWith("🔒")) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { italic: true, fontSize: { magnitude: 10, unit: "PT" }, foregroundColor: { color: { rgbColor: { red: 0.3, green: 0.3, blue: 0.35 } } } },
            fields: "italic,fontSize,foregroundColor"
          }
        });
      }

      // Tip line
      if (text.startsWith("💡")) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { italic: true, fontSize: { magnitude: 11, unit: "PT" }, foregroundColor: { color: { rgbColor: ACCENT_GREEN } } },
            fields: "italic,fontSize,foregroundColor"
          }
        });
      }

      // Steps (1️⃣ 2️⃣ etc)
      if (/^[1-4]\uFE0F\u20E3/.test(text)) {
        styleReqs.push({
          updateTextStyle: {
            range: { startIndex: si, endIndex: ei - 1 },
            textStyle: { bold: true, fontSize: { magnitude: 12, unit: "PT" }, foregroundColor: { color: { rgbColor: { red: 0.2, green: 0.2, blue: 0.2 } } } },
            fields: "bold,fontSize,foregroundColor"
          }
        });
      }
    }

    if (styleReqs.length > 0) {
      await batchUpdateDoc({ docs, docId, requests: styleReqs });
    }
  } catch (err) {
    // Tab creation may not be supported in all environments — gracefully skip
    console.log("[template] Guide tab creation skipped:", (err as Error)?.message?.slice(0, 100) ?? "unknown");
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
