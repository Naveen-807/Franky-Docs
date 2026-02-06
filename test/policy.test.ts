import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/core/policy.js";

describe("policy", () => {
  it("blocks over maxNotionalUsdc", () => {
    const decision = evaluatePolicy({ maxNotionalUsdc: 100 }, { type: "LIMIT_BUY", base: "SUI", quote: "USDC", qty: 200, price: 1 });
    expect(decision.ok).toBe(false);
  });

  it("allows payouts to allowlist", () => {
    const decision = evaluatePolicy(
      { payoutAllowlist: ["0x0000000000000000000000000000000000000001"] },
      { type: "PAYOUT", amountUsdc: 1, to: "0x0000000000000000000000000000000000000001" }
    );
    expect(decision.ok).toBe(true);
  });

  it("blocks payout over maxSingleTxUsdc", () => {
    const decision = evaluatePolicy(
      { maxSingleTxUsdc: 50 },
      { type: "PAYOUT", amountUsdc: 100, to: "0x0000000000000000000000000000000000000001" }
    );
    expect(decision.ok).toBe(false);
  });

  it("blocks payout over dailyLimitUsdc", () => {
    const decision = evaluatePolicy(
      { dailyLimitUsdc: 200 },
      { type: "PAYOUT", amountUsdc: 50, to: "0x0000000000000000000000000000000000000001" },
      { dailySpendUsdc: 180 }
    );
    expect(decision.ok).toBe(false);
  });

  it("allows payout within dailyLimitUsdc", () => {
    const decision = evaluatePolicy(
      { dailyLimitUsdc: 200 },
      { type: "PAYOUT", amountUsdc: 10, to: "0x0000000000000000000000000000000000000001" },
      { dailySpendUsdc: 100 }
    );
    expect(decision.ok).toBe(true);
  });

  it("blocks scheduling when schedulingAllowed is false", () => {
    const decision = evaluatePolicy(
      { schedulingAllowed: false },
      { type: "SCHEDULE", intervalHours: 4, innerCommand: "DW LIMIT_BUY SUI 10 USDC @ 1.5" }
    );
    expect(decision.ok).toBe(false);
  });

  it("allows scheduling when schedulingAllowed is true", () => {
    const decision = evaluatePolicy(
      { schedulingAllowed: true },
      { type: "SCHEDULE", intervalHours: 4, innerCommand: "DW LIMIT_BUY SUI 10 USDC @ 1.5" }
    );
    expect(decision.ok).toBe(true);
  });

  it("blocks bridge when bridgeAllowed is false", () => {
    const decision = evaluatePolicy(
      { bridgeAllowed: false },
      { type: "BRIDGE", amountUsdc: 100, fromChain: "arc", toChain: "sui" }
    );
    expect(decision.ok).toBe(false);
  });

  it("blocks bridge to disallowed chain", () => {
    const decision = evaluatePolicy(
      { allowedChains: ["arc", "ethereum"] },
      { type: "BRIDGE", amountUsdc: 100, fromChain: "arc", toChain: "sui" }
    );
    expect(decision.ok).toBe(false);
  });

  it("allows bridge between allowed chains", () => {
    const decision = evaluatePolicy(
      { allowedChains: ["arc", "sui"] },
      { type: "BRIDGE", amountUsdc: 100, fromChain: "arc", toChain: "sui" }
    );
    expect(decision.ok).toBe(true);
  });
});

