import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/core/policy.js";
import type { ParsedCommand } from "../src/core/commands.js";

const addr = "0x0000000000000000000000000000000000000001" as const;

describe("evaluatePolicy", () => {
  it("blocks denyCommands", () => {
    const cmd: ParsedCommand = { type: "BRIDGE", amountUsdc: 10, fromChain: "arc", toChain: "sui" };
    const res = evaluatePolicy({ denyCommands: ["BRIDGE"] }, cmd);
    expect(res.ok).toBe(false);
  });

  it("enforces maxSingleTxUsdc and dailyLimitUsdc", () => {
    const cmd: ParsedCommand = { type: "PAYOUT", amountUsdc: 60, to: addr };
    const res1 = evaluatePolicy({ maxSingleTxUsdc: 50 }, cmd);
    expect(res1.ok).toBe(false);

    const res2 = evaluatePolicy({ dailyLimitUsdc: 100 }, cmd, { dailySpendUsdc: 80 });
    expect(res2.ok).toBe(false);
  });

  it("blocks disallowed pair", () => {
    const cmd: ParsedCommand = { type: "LIMIT_BUY", base: "SUI", quote: "USDC", qty: 1, price: 1 };
    const res = evaluatePolicy({ allowedPairs: ["ETH/USDC"] }, cmd);
    expect(res.ok).toBe(false);
  });

  it("blocks market orders with disallowed pair", () => {
    const cmd: ParsedCommand = { type: "MARKET_BUY", base: "SUI", quote: "USDC", qty: 10 };
    const res = evaluatePolicy({ allowedPairs: ["ETH/USDC"] }, cmd);
    expect(res.ok).toBe(false);
  });

  it("blocks stop-loss when notional exceeds max", () => {
    const cmd: ParsedCommand = { type: "STOP_LOSS", base: "SUI", quote: "USDC", qty: 100, triggerPrice: 1.5 };
    const res = evaluatePolicy({ maxNotionalUsdc: 100 }, cmd);
    expect(res.ok).toBe(false);
  });

  it("enforces dailyLimitUsdc on YELLOW_SEND", () => {
    const cmd: ParsedCommand = { type: "YELLOW_SEND", amountUsdc: 60, to: addr };
    const res = evaluatePolicy({ dailyLimitUsdc: 100 }, cmd, { dailySpendUsdc: 80 });
    expect(res.ok).toBe(false);
  });

  it("enforces schedule limits", () => {
    const cmd: ParsedCommand = { type: "SCHEDULE", intervalHours: 48, innerCommand: "DW PAYOUT 1 USDC TO 0x0" };
    const res1 = evaluatePolicy({ schedulingAllowed: false }, cmd);
    expect(res1.ok).toBe(false);

    const res2 = evaluatePolicy({ maxScheduleIntervalHours: 24 }, cmd);
    expect(res2.ok).toBe(false);
  });
});
