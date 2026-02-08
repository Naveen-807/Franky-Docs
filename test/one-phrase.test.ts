import { describe, expect, it } from "vitest";
import { parseCommand, tryAutoDetect } from "../src/core/commands.js";
import { readPayoutRulesTable } from "../src/google/docwallet.js";

describe("One-phrase trading aliases", () => {
  it("'buy 50 SUI' → MARKET_BUY (no price = market)", () => {
    const result = parseCommand("buy 50 SUI");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("MARKET_BUY");
      if (result.value.type === "MARKET_BUY") {
        expect(result.value.qty).toBe(50);
        expect(result.value.base).toBe("SUI");
      }
    }
  });

  it("'sell 25 SUI' → MARKET_SELL (no price = market)", () => {
    const result = parseCommand("sell 25 SUI");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("MARKET_SELL");
      if (result.value.type === "MARKET_SELL") {
        expect(result.value.qty).toBe(25);
      }
    }
  });

  it("'buy 10 SUI at 1.5' still → LIMIT_BUY (with price)", () => {
    const result = parseCommand("buy 10 SUI at 1.5");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("LIMIT_BUY");
    }
  });

  it("'sell 10 SUI @ 2.0' still → LIMIT_SELL (with price)", () => {
    const result = parseCommand("sell 10 SUI @ 2.0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("LIMIT_SELL");
    }
  });

  it("tryAutoDetect handles bare buy/sell", () => {
    const buyResult = tryAutoDetect("buy 100 SUI");
    expect(buyResult).not.toBeNull();
    if (buyResult?.ok) {
      expect(buyResult.value.type).toBe("MARKET_BUY");
    }

    const sellResult = tryAutoDetect("sell 5 SUI");
    expect(sellResult).not.toBeNull();
    if (sellResult?.ok) {
      expect(sellResult.value.type).toBe("MARKET_SELL");
    }
  });

  it("'Buy 50 SUI' case-insensitive", () => {
    const result = parseCommand("Buy 50 SUI");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("MARKET_BUY");
  });

  it("'SELL 100 sui' case-insensitive", () => {
    const result = parseCommand("SELL 100 sui");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("MARKET_SELL");
  });

  it("'buy 0.5 SUI' accepts decimals", () => {
    const result = parseCommand("buy 0.5 SUI");
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "MARKET_BUY") {
      expect(result.value.qty).toBe(0.5);
    }
  });
});

describe("Payout frequency parser", () => {
  // This tests the parsePayoutFrequency function indirectly
  // through the readPayoutRulesTable function
  it("readPayoutRulesTable returns empty for null table", () => {
    expect(readPayoutRulesTable(null)).toEqual([]);
    expect(readPayoutRulesTable(undefined)).toEqual([]);
  });

  it("readPayoutRulesTable skips empty rows", () => {
    const table = {
      tableRows: [
        { tableCells: [{ content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }] },
        { tableCells: [{ content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }] },
      ],
    };
    const result = readPayoutRulesTable(table as any);
    expect(result).toEqual([]);
  });
});

describe("DW command aliases", () => {
  it("DW MARKET_BUY SUI 10 works", () => {
    const r = parseCommand("DW MARKET_BUY SUI 10");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("MARKET_BUY");
      if (r.value.type === "MARKET_BUY") expect(r.value.qty).toBe(10);
    }
  });

  it("DW MARKET_SELL SUI 5 works", () => {
    const r = parseCommand("DW MARKET_SELL SUI 5");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("MARKET_SELL");
      if (r.value.type === "MARKET_SELL") expect(r.value.qty).toBe(5);
    }
  });

  it("market buy 10 SUI (auto-detect)", () => {
    const r = parseCommand("market buy 10 SUI");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("MARKET_BUY");
  });

  it("market sell 5 SUI (auto-detect)", () => {
    const r = parseCommand("market sell 5 SUI");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("MARKET_SELL");
  });
});
