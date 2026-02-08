import type { docs_v1 } from "googleapis";

export async function getDoc(docs: docs_v1.Docs, docId: string) {
  const res = await docs.documents.get({ documentId: docId });
  if (!res.data.documentId) throw new Error(`Failed to load doc ${docId}`);
  return res.data;
}

export async function batchUpdateDoc(params: {
  docs: docs_v1.Docs;
  docId: string;
  requests: docs_v1.Schema$Request[];
}) {
  const { docs, docId, requests } = params;
  if (requests.length === 0) return;
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests }
  });
}

export type AnchorLocation = {
  elementIndex: number;
  startIndex: number;
  endIndex: number;
};

export function findAnchor(doc: docs_v1.Schema$Document, anchorText: string): AnchorLocation | null {
  const content = doc.body?.content ?? [];
  for (let i = 0; i < content.length; i++) {
    const el = content[i];
    const para = el.paragraph;
    if (!para) continue;
    const text = paragraphPlainText(para).trim();
    if (text === anchorText) {
      if (typeof el.startIndex !== "number" || typeof el.endIndex !== "number") continue;
      return { elementIndex: i, startIndex: el.startIndex, endIndex: el.endIndex };
    }
  }
  return null;
}

export function paragraphPlainText(paragraph: docs_v1.Schema$Paragraph): string {
  const elements = paragraph.elements ?? [];
  let out = "";
  for (const e of elements) {
    const tr = e.textRun;
    if (tr?.content) out += tr.content;
  }
  return out;
}

export type TableInfo = {
  elementIndex: number;
  startIndex: number;
  endIndex: number;
  table: docs_v1.Schema$Table;
};

export function findNextTable(doc: docs_v1.Schema$Document, afterElementIndex: number): TableInfo | null {
  const content = doc.body?.content ?? [];
  for (let i = afterElementIndex + 1; i < content.length; i++) {
    const el = content[i];
    if (el.table && typeof el.startIndex === "number" && typeof el.endIndex === "number") {
      return { elementIndex: i, startIndex: el.startIndex, endIndex: el.endIndex, table: el.table };
    }
  }
  return null;
}

export type IndexRange = { startIndex: number; endIndex: number };

export function tableCellRange(cell: docs_v1.Schema$TableCell): IndexRange | null {
  const content = cell.content ?? [];
  let start: number | undefined;
  let end: number | undefined;
  for (const el of content) {
    if (typeof el.startIndex === "number") start = start === undefined ? el.startIndex : Math.min(start, el.startIndex);
    if (typeof el.endIndex === "number") end = end === undefined ? el.endIndex : Math.max(end, el.endIndex);
  }
  if (start === undefined || end === undefined) return null;
  return { startIndex: start, endIndex: end };
}

export function tableCellStartIndex(cell: docs_v1.Schema$TableCell): number | null {
  const r = tableCellRange(cell);
  return r ? r.startIndex : null;
}

export function tablePlainText(table: docs_v1.Schema$Table): string[][] {
  const rows = table.tableRows ?? [];
  return rows.map((r) =>
    (r.tableCells ?? []).map((c) => {
      const parts: string[] = [];
      for (const el of c.content ?? []) {
        if (el.paragraph) parts.push(paragraphPlainText(el.paragraph));
      }
      return parts.join("").replace(/\n/g, " ").trim();
    })
  );
}

export function buildWriteCellRequests(params: { cell: docs_v1.Schema$TableCell; text: string }) {
  const { cell, text } = params;
  const range = tableCellRange(cell);
  if (!range) return [];

  const startIndex = range.startIndex;
  const endIndex = range.endIndex;
  const deleteEnd = Math.max(startIndex, endIndex - 1);

  const requests: docs_v1.Schema$Request[] = [];
  if (deleteEnd > startIndex + 1) {
    // Only delete if there's actual content beyond the mandatory cell newline
    requests.push({
      deleteContentRange: {
        range: { startIndex, endIndex: deleteEnd }
      }
    });
  } else if (deleteEnd > startIndex) {
    // Minimal cell content — still try to clear it
    requests.push({
      deleteContentRange: {
        range: { startIndex, endIndex: deleteEnd }
      }
    });
  }
  if (text !== "") {
    requests.push({
      insertText: {
        location: { index: startIndex },
        text
      }
    });
  }
  return requests;
}
