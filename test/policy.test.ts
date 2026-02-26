import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/core/policy.js";
import type { ParsedCommand } from "../src/core/commands.js";

describe("evaluatePolicy (BCH)", () => {
  it("blocks denyCommands", () => {
    const cmd: ParsedCommand = {
      type: "BCH_SEND",
      to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
      amountSats: 1000
    };
    const res = evaluatePolicy({ denyCommands: ["BCH_SEND"] }, cmd);
    expect(res.ok).toBe(false);
  });

  it("enforces maxSingleTxSats and dailyLimitSats", () => {
    const cmd: ParsedCommand = {
      type: "BCH_SEND",
      to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
      amountSats: 60_000
    };

    const res1 = evaluatePolicy({ maxSingleTxSats: 50_000 }, cmd);
    expect(res1.ok).toBe(false);

    const res2 = evaluatePolicy({ dailyLimitSats: 100_000 }, cmd, { dailySpendSats: 80_000 });
    expect(res2.ok).toBe(false);
  });

  it("enforces schedule limits", () => {
    const cmd: ParsedCommand = { type: "SCHEDULE", intervalHours: 48, innerCommand: "DW BCH_PRICE" };

    const res1 = evaluatePolicy({ schedulingAllowed: false }, cmd);
    expect(res1.ok).toBe(false);

    const res2 = evaluatePolicy({ maxScheduleIntervalHours: 24 }, cmd);
    expect(res2.ok).toBe(false);
  });

  it("returns autoApprove when requireApproval=false", () => {
    const cmd: ParsedCommand = { type: "BCH_PRICE" };
    const res = evaluatePolicy({ requireApproval: false }, cmd);
    expect(res).toEqual({ ok: true, autoApprove: true });
  });
});
