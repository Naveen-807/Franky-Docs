import { describe, expect, it } from "vitest";
import { parseCommand, tryAutoDetect } from "../src/core/commands.js";
import { readPayoutRulesTable } from "../src/google/docwallet.js";

describe("BCH one-phrase aliases", () => {
  it("'bch price' -> BCH_PRICE", () => {
    const result = parseCommand("bch price");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("BCH_PRICE");
  });

  it("'send 0.001 BCH to ...' -> BCH_SEND", () => {
    const result = parseCommand("send 0.001 BCH to bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a");
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "BCH_SEND") {
      expect(result.value.amountSats).toBe(100000);
    }
  });

  it("tryAutoDetect handles stop-loss and tp phrases", () => {
    const sl = tryAutoDetect("stop-loss 1 BCH @ 300");
    expect(sl?.ok).toBe(true);
    if (sl?.ok) expect(sl.value.type).toBe("BCH_STOP_LOSS");

    const tp = tryAutoDetect("take profit 1 BCH at 700");
    expect(tp?.ok).toBe(true);
    if (tp?.ok) expect(tp.value.type).toBe("BCH_TAKE_PROFIT");
  });
});

describe("Payout frequency parser", () => {
  it("readPayoutRulesTable returns empty for null table", () => {
    expect(readPayoutRulesTable(null)).toEqual([]);
    expect(readPayoutRulesTable(undefined)).toEqual([]);
  });

  it("readPayoutRulesTable skips empty rows", () => {
    const table = {
      tableRows: [
        { tableCells: [{ content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }] },
        { tableCells: [{ content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }, { content: [] }] }
      ]
    };
    const result = readPayoutRulesTable(table as any);
    expect(result).toEqual([]);
  });
});
