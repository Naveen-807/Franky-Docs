import { describe, expect, it } from "vitest";
import { parseCommand, tryAutoDetect } from "../src/core/commands.js";

describe("parseCommand (BCH-only)", () => {
  it("parses setup and status", () => {
    expect(parseCommand("DW /setup")).toEqual({ ok: true, value: { type: "SETUP" } });
    expect(parseCommand("DW STATUS")).toEqual({ ok: true, value: { type: "STATUS" } });
  });

  it("parses BCH_SEND and validates params", () => {
    const ok = parseCommand("DW BCH_SEND bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a 10000");
    expect(ok).toEqual({
      ok: true,
      value: { type: "BCH_SEND", to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a", amountSats: 10000 }
    });

    expect(parseCommand("DW BCH_SEND invalid 10000").ok).toBe(false);
    expect(parseCommand("DW BCH_SEND bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a 0").ok).toBe(false);
  });

  it("parses BCH token commands", () => {
    expect(parseCommand("DW BCH_TOKEN_ISSUE FRANKY FrankyDAO 1000000")).toEqual({
      ok: true,
      value: { type: "BCH_TOKEN_ISSUE", ticker: "FRANKY", name: "FrankyDAO", supply: "1000000" }
    });

    expect(parseCommand("DW BCH_TOKEN_SEND bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a FRANKY 500")).toEqual({
      ok: true,
      value: {
        type: "BCH_TOKEN_SEND",
        to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
        tokenCategory: "FRANKY",
        tokenAmount: "500"
      }
    });

    expect(parseCommand("DW BCH_TOKEN_BALANCE")).toEqual({ ok: true, value: { type: "BCH_TOKEN_BALANCE" } });
    expect(parseCommand("DW BCH_TOKENS")).toEqual({ ok: true, value: { type: "BCH_TOKEN_BALANCE" } });
  });

  it("parses BCH pricing and conditional commands", () => {
    expect(parseCommand("DW BCH_PRICE")).toEqual({ ok: true, value: { type: "BCH_PRICE" } });

    expect(parseCommand("DW BCH_STOP_LOSS 1.5 @ 420")).toEqual({
      ok: true,
      value: { type: "BCH_STOP_LOSS", qty: 1.5, triggerPrice: 420 }
    });

    expect(parseCommand("DW BCH_TAKE_PROFIT 2 @ 700")).toEqual({
      ok: true,
      value: { type: "BCH_TAKE_PROFIT", qty: 2, triggerPrice: 700 }
    });

    expect(parseCommand("DW CANCEL_ORDER bch_sl_123")).toEqual({
      ok: true,
      value: { type: "CANCEL_ORDER", orderId: "bch_sl_123" }
    });
  });

  it("parses treasury and scheduling", () => {
    expect(parseCommand("DW TREASURY")).toEqual({ ok: true, value: { type: "TREASURY" } });

    const sched = parseCommand("DW SCHEDULE EVERY 4h: BCH_PRICE");
    expect(sched.ok).toBe(true);
    if (sched.ok && sched.value.type === "SCHEDULE") {
      expect(sched.value.intervalHours).toBe(4);
      expect(sched.value.innerCommand).toBe("DW BCH_PRICE");
    }

    expect(parseCommand("DW UNSCHEDULE sched_123")).toEqual({
      ok: true,
      value: { type: "CANCEL_SCHEDULE", scheduleId: "sched_123" }
    });

    expect(parseCommand("DW SCHEDULE EVERY 1h: SCHEDULE EVERY 2h: STATUS").ok).toBe(false);
  });

  it("returns stable errors", () => {
    expect(parseCommand("")).toEqual({ ok: false, error: "Empty command" });
    expect(parseCommand("hello world")).toEqual({ ok: false, error: "Commands must start with DW" });
    expect(parseCommand("DW FOOBAR")).toEqual({ ok: false, error: "Unknown command: FOOBAR" });
  });
});

describe("tryAutoDetect (BCH-only)", () => {
  it("detects price and balance intents", () => {
    expect(tryAutoDetect("bch price")).toEqual({ ok: true, value: { type: "BCH_PRICE" } });
    expect(tryAutoDetect("bitcoin cash price")).toEqual({ ok: true, value: { type: "BCH_PRICE" } });
    expect(tryAutoDetect("bch balance")).toEqual({ ok: true, value: { type: "BCH_TOKEN_BALANCE" } });
  });

  it("detects BCH sends in sats and BCH units", () => {
    expect(tryAutoDetect("send 10000 sats to bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a")).toEqual({
      ok: true,
      value: {
        type: "BCH_SEND",
        to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
        amountSats: 10000
      }
    });

    const bch = tryAutoDetect("send 0.001 BCH to bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a");
    expect(bch).toEqual({
      ok: true,
      value: {
        type: "BCH_SEND",
        to: "bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
        amountSats: 100000
      }
    });
  });

  it("detects token intents", () => {
    expect(tryAutoDetect("issue token FRANKY FrankyDAO 1000000")).toEqual({
      ok: true,
      value: { type: "BCH_TOKEN_ISSUE", ticker: "FRANKY", name: "FrankyDAO", supply: "1000000" }
    });

    expect(tryAutoDetect("send 250 FRANKY to bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a")).toEqual({
      ok: true,
      value: {
        type: "BCH_TOKEN_SEND",
        to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
        tokenCategory: "FRANKY",
        tokenAmount: "250"
      }
    });
  });

  it("detects stop-loss / take-profit aliases", () => {
    expect(tryAutoDetect("stop loss 1.2 BCH at 350")).toEqual({
      ok: true,
      value: { type: "BCH_STOP_LOSS", qty: 1.2, triggerPrice: 350 }
    });

    expect(tryAutoDetect("tp 1 BCH @ 800")).toEqual({
      ok: true,
      value: { type: "BCH_TAKE_PROFIT", qty: 1, triggerPrice: 800 }
    });
  });

  it("returns null when pattern is unknown", () => {
    expect(tryAutoDetect("random phrase")).toBeNull();
  });
});
