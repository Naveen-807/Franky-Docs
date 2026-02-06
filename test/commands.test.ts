import { describe, expect, it } from "vitest";
import { parseCommand, tryAutoDetect } from "../src/core/commands.js";

describe("parseCommand", () => {
  it("parses setup", () => {
    expect(parseCommand("DW /setup")).toEqual({ ok: true, value: { type: "SETUP" } });
  });

  it("parses limit buy", () => {
    const r = parseCommand("DW LIMIT_BUY SUI 50 USDC @ 1.02");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "LIMIT_BUY", qty: 50, price: 1.02 });
  });

  it("rejects missing DW prefix for unknown commands", () => {
    const r = parseCommand("FOOBAR something");
    expect(r.ok).toBe(false);
  });

  it("parses payout split", () => {
    const r = parseCommand(
      "DW PAYOUT_SPLIT 10 USDC TO 0x0000000000000000000000000000000000000001:50,0x0000000000000000000000000000000000000002:50"
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.type).toBe("PAYOUT_SPLIT");
  });

  it("parses session create", () => {
    expect(parseCommand("DW SESSION_CREATE")).toEqual({ ok: true, value: { type: "SESSION_CREATE" } });
  });

  it("parses walletconnect connect", () => {
    const r = parseCommand("DW CONNECT wc:example@2?relay-protocol=irn&symKey=abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "CONNECT" });
  });

  it("parses walletconnect tx json", () => {
    const payload = JSON.stringify({
      chainId: 5042002,
      to: "0x0000000000000000000000000000000000000001",
      data: "0x",
      value: "0x0"
    });
    const r = parseCommand(`DW TX ${payload}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "WC_TX", chainId: 5042002 });
  });

  it("parses walletconnect sign json", () => {
    const payload = JSON.stringify({
      address: "0x0000000000000000000000000000000000000001",
      message: "hello"
    });
    const r = parseCommand(`DW SIGN ${payload}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "WC_SIGN" });
  });

  it("parses signer add", () => {
    const r = parseCommand("DW SIGNER_ADD 0x0000000000000000000000000000000000000001 WEIGHT 2");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "SIGNER_ADD", weight: 2 });
  });

  it("parses quorum", () => {
    expect(parseCommand("DW QUORUM 2")).toEqual({ ok: true, value: { type: "QUORUM", quorum: 2 } });
  });

  it("parses schedule DCA", () => {
    const r = parseCommand("DW SCHEDULE EVERY 4h: LIMIT_BUY SUI 10 USDC @ 1.5");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({ type: "SCHEDULE", intervalHours: 4 });
      if (r.value.type === "SCHEDULE") {
        expect(r.value.innerCommand).toBe("DW LIMIT_BUY SUI 10 USDC @ 1.5");
      }
    }
  });

  it("parses schedule with DW prefix in inner command", () => {
    const r = parseCommand("DW SCHEDULE EVERY 24h: DW PAYOUT 5 USDC TO 0x0000000000000000000000000000000000000001");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "SCHEDULE") {
      expect(r.value.intervalHours).toBe(24);
      expect(r.value.innerCommand).toBe("DW PAYOUT 5 USDC TO 0x0000000000000000000000000000000000000001");
    }
  });

  it("rejects nested schedule", () => {
    const r = parseCommand("DW SCHEDULE EVERY 1h: SCHEDULE EVERY 2h: LIMIT_BUY SUI 1 USDC @ 1");
    expect(r.ok).toBe(false);
  });

  it("parses cancel schedule", () => {
    const r = parseCommand("DW CANCEL_SCHEDULE sched_123_abc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "CANCEL_SCHEDULE", scheduleId: "sched_123_abc" });
  });

  it("parses bridge", () => {
    const r = parseCommand("DW BRIDGE 100 USDC FROM arc TO sui");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "BRIDGE", amountUsdc: 100, fromChain: "arc", toChain: "sui" });
  });

  it("rejects bridge same chain", () => {
    const r = parseCommand("DW BRIDGE 100 USDC FROM arc TO arc");
    expect(r.ok).toBe(false);
  });

  it("rejects bridge unsupported chain", () => {
    const r = parseCommand("DW BRIDGE 100 USDC FROM arc TO solana");
    expect(r.ok).toBe(false);
  });
});

describe("tryAutoDetect (prefix-less commands)", () => {
  it("auto-detects 'send 10 USDC to 0x...' as PAYOUT", () => {
    const r = tryAutoDetect("send 10 USDC to 0x0000000000000000000000000000000000000001");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "PAYOUT", amountUsdc: 10 });
  });

  it("auto-detects 'buy 50 SUI at 1.02' as LIMIT_BUY", () => {
    const r = tryAutoDetect("buy 50 SUI at 1.02");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "LIMIT_BUY", qty: 50, price: 1.02 });
  });

  it("auto-detects 'sell 25 SUI @ 2.5' as LIMIT_SELL", () => {
    const r = tryAutoDetect("sell 25 SUI @ 2.5");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "LIMIT_SELL", qty: 25, price: 2.5 });
  });

  it("auto-detects 'bridge 100 USDC from arc to sui' as BRIDGE", () => {
    const r = tryAutoDetect("bridge 100 USDC from arc to sui");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "BRIDGE", amountUsdc: 100, fromChain: "arc", toChain: "sui" });
  });

  it("auto-detects WalletConnect URI", () => {
    const r = tryAutoDetect("wc:abc123@2?relay-protocol=irn&symKey=xyz");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "CONNECT" });
  });

  it("auto-detects 'setup' without DW prefix", () => {
    const r = tryAutoDetect("setup");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "SETUP" });
  });

  it("auto-detects 'settle' without DW prefix", () => {
    const r = tryAutoDetect("settle");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "SETTLE" });
  });

  it("auto-detects 'cancel schedule sched_xxx' as CANCEL_SCHEDULE", () => {
    const r = tryAutoDetect("cancel schedule sched_123_abc");
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    if (r!.ok) expect(r!.value).toMatchObject({ type: "CANCEL_SCHEDULE", scheduleId: "sched_123_abc" });
  });

  it("parseCommand falls through to auto-detect for natural language", () => {
    const r = parseCommand("send 10 USDC to 0x0000000000000000000000000000000000000001");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ type: "PAYOUT", amountUsdc: 10 });
  });

  it("parseCommand still rejects truly unknown input", () => {
    const r = parseCommand("hello world");
    expect(r.ok).toBe(false);
  });

  it("returns null for unrecognized input", () => {
    expect(tryAutoDetect("random garbage text")).toBeNull();
    expect(tryAutoDetect("")).toBeNull();
  });
});
