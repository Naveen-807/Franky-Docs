import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Repo } from "../src/db/repo.js";

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frankydocs-"));
  const dbFile = path.join(dir, "test.db");
  const repo = new Repo(dbFile);
  return { repo, dir };
}

describe("Repo counters and approvals", () => {
  it("increments doc counters", () => {
    const { repo } = makeRepo();
    repo.upsertDoc({ docId: "doc1", name: "Test" });
    expect(repo.getDocCounter("doc1", "approvals_total")).toBe(0);
    expect(repo.incrementDocCounter("doc1", "approvals_total", 1)).toBe(1);
    expect(repo.incrementDocCounter("doc1", "approvals_total", 2)).toBe(3);
    expect(repo.getDocCounter("doc1", "approvals_total")).toBe(3);
    repo.close();
  });

  it("returns command approval decisions", () => {
    const { repo } = makeRepo();
    repo.upsertDoc({ docId: "doc1", name: "Test" });
    repo.recordCommandApproval({ docId: "doc1", cmdId: "cmd1", signerAddress: "0xabc", decision: "APPROVE" });
    const decision = repo.getCommandApprovalDecision({ docId: "doc1", cmdId: "cmd1", signerAddress: "0xabc" });
    expect(decision?.decision).toBe("APPROVE");
    repo.close();
  });
});
