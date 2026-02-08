import { describe, expect, it } from "vitest";
import { parseCommand, tryAutoDetect } from "../src/core/commands.js";

const ADDR1 = "0x0000000000000000000000000000000000000001";
const ADDR2 = "0x0000000000000000000000000000000000000002";

describe("parseCommand — every command type", () => {
  // ============================================================
  // 1. DW /setup
  // ============================================================
  describe("SETUP", () => {
    it("parses DW /setup", () => {
      const r = parseCommand("DW /setup");
      expect(r).toEqual({ ok: true, value: { type: "SETUP" } });
    });
    it("parses DW SETUP (without slash)", () => {
      const r = parseCommand("DW SETUP");
      expect(r).toEqual({ ok: true, value: { type: "SETUP" } });
    });
    it("parses case-insensitively", () => {
      const r = parseCommand("dw /setup");
      expect(r).toEqual({ ok: true, value: { type: "SETUP" } });
    });
  });

  // ============================================================
  // 2. DW STATUS
  // ============================================================
  describe("STATUS", () => {
    it("parses DW STATUS", () => {
      const r = parseCommand("DW STATUS");
      expect(r).toEqual({ ok: true, value: { type: "STATUS" } });
    });
  });

  // ============================================================
  // 3. DW SESSION_CREATE
  // ============================================================
  describe("SESSION_CREATE", () => {
    it("parses DW SESSION_CREATE", () => {
      const r = parseCommand("DW SESSION_CREATE");
      expect(r).toEqual({ ok: true, value: { type: "SESSION_CREATE" } });
    });
  });

  // ============================================================
  // 4. DW SIGNER_ADD
  // ============================================================
  describe("SIGNER_ADD", () => {
    it("parses DW SIGNER_ADD <addr> WEIGHT <n>", () => {
      const r = parseCommand(`DW SIGNER_ADD ${ADDR1} WEIGHT 2`);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toEqual({ type: "SIGNER_ADD", address: ADDR1, weight: 2 });
      }
    });
    it("rejects missing WEIGHT keyword", () => {
      const r = parseCommand(`DW SIGNER_ADD ${ADDR1} 2`);
      expect(r.ok).toBe(false);
    });
    it("rejects invalid address", () => {
      const r = parseCommand("DW SIGNER_ADD 0xinvalid WEIGHT 1");
      expect(r.ok).toBe(false);
    });
    it("rejects weight 0", () => {
      const r = parseCommand(`DW SIGNER_ADD ${ADDR1} WEIGHT 0`);
      expect(r.ok).toBe(false);
    });
    it("rejects fractional weight", () => {
      const r = parseCommand(`DW SIGNER_ADD ${ADDR1} WEIGHT 1.5`);
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 5. DW QUORUM
  // ============================================================
  describe("QUORUM", () => {
    it("parses DW QUORUM 2", () => {
      const r = parseCommand("DW QUORUM 2");
      expect(r).toEqual({ ok: true, value: { type: "QUORUM", quorum: 2 } });
    });
    it("rejects 0", () => {
      const r = parseCommand("DW QUORUM 0");
      expect(r.ok).toBe(false);
    });
    it("rejects negative", () => {
      const r = parseCommand("DW QUORUM -1");
      expect(r.ok).toBe(false);
    });
    it("rejects fractional", () => {
      const r = parseCommand("DW QUORUM 1.5");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 6. DW CONNECT
  // ============================================================
  describe("CONNECT", () => {
    it("parses DW CONNECT <wcUri>", () => {
      const r = parseCommand("DW CONNECT wc:abc123@2?relay-protocol=irn&symKey=xxx");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "CONNECT") {
        expect(r.value.wcUri).toContain("wc:abc123");
      }
    });
    it("rejects empty URI", () => {
      const r = parseCommand("DW CONNECT");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 7. DW TX (WC_TX)
  // ============================================================
  describe("WC_TX", () => {
    it("parses DW TX with valid JSON", () => {
      const payload = JSON.stringify({ chainId: 1, to: ADDR1 });
      const r = parseCommand(`DW TX ${payload}`);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "WC_TX") {
        expect(r.value.chainId).toBe(1);
        expect(r.value.to).toBe(ADDR1);
      }
    });
    it("rejects invalid JSON", () => {
      const r = parseCommand("DW TX not-json");
      expect(r.ok).toBe(false);
    });
    it("rejects missing to field", () => {
      const r = parseCommand(`DW TX ${JSON.stringify({ chainId: 1 })}`);
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 8. DW SIGN (WC_SIGN)
  // ============================================================
  describe("WC_SIGN", () => {
    it("parses DW SIGN with valid JSON", () => {
      const payload = JSON.stringify({ address: ADDR1, message: "hello" });
      const r = parseCommand(`DW SIGN ${payload}`);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "WC_SIGN") {
        expect(r.value.address).toBe(ADDR1);
        expect(r.value.message).toBe("hello");
      }
    });
    it("rejects empty payload", () => {
      const r = parseCommand("DW SIGN");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 9. DW LIMIT_BUY
  // ============================================================
  describe("LIMIT_BUY", () => {
    it("parses DW LIMIT_BUY SUI 50 USDC @ 1.02", () => {
      const r = parseCommand("DW LIMIT_BUY SUI 50 USDC @ 1.02");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "LIMIT_BUY") {
        expect(r.value.base).toBe("SUI");
        expect(r.value.quote).toBe("USDC");
        expect(r.value.qty).toBe(50);
        expect(r.value.price).toBe(1.02);
      }
    });
    it("rejects missing @", () => {
      const r = parseCommand("DW LIMIT_BUY SUI 50 USDC 1.02");
      expect(r.ok).toBe(false);
    });
    it("rejects non-SUI base", () => {
      const r = parseCommand("DW LIMIT_BUY ETH 50 USDC @ 1.02");
      expect(r.ok).toBe(false);
    });
    it("rejects qty 0", () => {
      const r = parseCommand("DW LIMIT_BUY SUI 0 USDC @ 1.02");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 10. DW LIMIT_SELL
  // ============================================================
  describe("LIMIT_SELL", () => {
    it("parses DW LIMIT_SELL SUI 10 USDC @ 2.5", () => {
      const r = parseCommand("DW LIMIT_SELL SUI 10 USDC @ 2.5");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "LIMIT_SELL") {
        expect(r.value.qty).toBe(10);
        expect(r.value.price).toBe(2.5);
      }
    });
  });

  // ============================================================
  // 11. DW CANCEL
  // ============================================================
  describe("CANCEL", () => {
    it("parses DW CANCEL order123", () => {
      const r = parseCommand("DW CANCEL order123");
      expect(r).toEqual({ ok: true, value: { type: "CANCEL", orderId: "order123" } });
    });
    it("rejects missing orderId", () => {
      const r = parseCommand("DW CANCEL");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 12. DW SETTLE
  // ============================================================
  describe("SETTLE", () => {
    it("parses DW SETTLE", () => {
      const r = parseCommand("DW SETTLE");
      expect(r).toEqual({ ok: true, value: { type: "SETTLE" } });
    });
  });

  // ============================================================
  // 13. DW PAYOUT
  // ============================================================
  describe("PAYOUT", () => {
    it("parses DW PAYOUT 10 USDC TO <addr>", () => {
      const r = parseCommand(`DW PAYOUT 10 USDC TO ${ADDR1}`);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "PAYOUT") {
        expect(r.value.amountUsdc).toBe(10);
        expect(r.value.to).toBe(ADDR1);
      }
    });
    it("rejects non-USDC", () => {
      const r = parseCommand(`DW PAYOUT 10 ETH TO ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
    it("rejects missing TO", () => {
      const r = parseCommand(`DW PAYOUT 10 USDC ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
    it("rejects amount 0", () => {
      const r = parseCommand(`DW PAYOUT 0 USDC TO ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 14. DW PAYOUT_SPLIT
  // ============================================================
  describe("PAYOUT_SPLIT", () => {
    it("parses DW PAYOUT_SPLIT 100 USDC TO <a>:60,<b>:40", () => {
      const r = parseCommand(`DW PAYOUT_SPLIT 100 USDC TO ${ADDR1}:60,${ADDR2}:40`);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "PAYOUT_SPLIT") {
        expect(r.value.amountUsdc).toBe(100);
        expect(r.value.recipients).toHaveLength(2);
        expect(r.value.recipients[0].pct).toBe(60);
        expect(r.value.recipients[1].pct).toBe(40);
      }
    });
    it("rejects split not summing to 100", () => {
      const r = parseCommand(`DW PAYOUT_SPLIT 100 USDC TO ${ADDR1}:30,${ADDR2}:40`);
      expect(r.ok).toBe(false);
    });
    it("rejects single recipient", () => {
      const r = parseCommand(`DW PAYOUT_SPLIT 100 USDC TO ${ADDR1}:100`);
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 15. DW SCHEDULE
  // ============================================================
  describe("SCHEDULE", () => {
    it("parses DW SCHEDULE EVERY 4h: LIMIT_BUY SUI 10 USDC @ 1.02", () => {
      const r = parseCommand("DW SCHEDULE EVERY 4h: LIMIT_BUY SUI 10 USDC @ 1.02");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "SCHEDULE") {
        expect(r.value.intervalHours).toBe(4);
        expect(r.value.innerCommand).toContain("LIMIT_BUY");
      }
    });
    it("parses with DW prefix in inner command", () => {
      const r = parseCommand("DW SCHEDULE EVERY 24h: DW PAYOUT 5 USDC TO " + ADDR1);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "SCHEDULE") {
        expect(r.value.innerCommand).toContain("DW");
      }
    });
    it("rejects nested schedule", () => {
      const r = parseCommand("DW SCHEDULE EVERY 1h: SCHEDULE EVERY 2h: STATUS");
      expect(r.ok).toBe(false);
    });
    it("rejects invalid inner command", () => {
      const r = parseCommand("DW SCHEDULE EVERY 1h: INVALID_COMMAND");
      expect(r.ok).toBe(false);
    });
    it("rejects bad format", () => {
      const r = parseCommand("DW SCHEDULE 4h LIMIT_BUY SUI 10 USDC @ 1.02");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 17. DW CANCEL_SCHEDULE / UNSCHEDULE
  // ============================================================
  describe("CANCEL_SCHEDULE", () => {
    it("parses DW CANCEL_SCHEDULE sched_123", () => {
      const r = parseCommand("DW CANCEL_SCHEDULE sched_123");
      expect(r).toEqual({ ok: true, value: { type: "CANCEL_SCHEDULE", scheduleId: "sched_123" } });
    });
    it("parses DW UNSCHEDULE alias", () => {
      const r = parseCommand("DW UNSCHEDULE sched_456");
      expect(r).toEqual({ ok: true, value: { type: "CANCEL_SCHEDULE", scheduleId: "sched_456" } });
    });
    it("rejects missing id", () => {
      expect(parseCommand("DW CANCEL_SCHEDULE").ok).toBe(false);
      expect(parseCommand("DW UNSCHEDULE").ok).toBe(false);
    });
  });

  // ============================================================
  // 18. DW BRIDGE
  // ============================================================
  describe("BRIDGE", () => {
    it("parses DW BRIDGE 100 USDC FROM arc TO sui", () => {
      const r = parseCommand("DW BRIDGE 100 USDC FROM arc TO sui");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "BRIDGE") {
        expect(r.value.amountUsdc).toBe(100);
        expect(r.value.fromChain).toBe("arc");
        expect(r.value.toChain).toBe("sui");
      }
    });
    it("rejects same chain", () => {
      const r = parseCommand("DW BRIDGE 100 USDC FROM arc TO arc");
      expect(r.ok).toBe(false);
    });
    it("rejects invalid chain", () => {
      const r = parseCommand("DW BRIDGE 100 USDC FROM bitcoin TO sui");
      expect(r.ok).toBe(false);
    });
    it("rejects non-USDC", () => {
      const r = parseCommand("DW BRIDGE 100 ETH FROM arc TO sui");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 19. DW SESSION_CLOSE
  // ============================================================
  describe("SESSION_CLOSE", () => {
    it("parses DW SESSION_CLOSE", () => {
      const r = parseCommand("DW SESSION_CLOSE");
      expect(r).toEqual({ ok: true, value: { type: "SESSION_CLOSE" } });
    });
  });

  // ============================================================
  // 20. DW SESSION_STATUS
  // ============================================================
  describe("SESSION_STATUS", () => {
    it("parses DW SESSION_STATUS", () => {
      const r = parseCommand("DW SESSION_STATUS");
      expect(r).toEqual({ ok: true, value: { type: "SESSION_STATUS" } });
    });
  });

  // ============================================================
  // 21. DW DEPOSIT
  // ============================================================
  describe("DEPOSIT", () => {
    it("parses DW DEPOSIT SUI 10", () => {
      const r = parseCommand("DW DEPOSIT SUI 10");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "DEPOSIT") {
        expect(r.value.coinType).toBe("SUI");
        expect(r.value.amount).toBe(10);
      }
    });
    it("parses DW DEPOSIT USDC 50", () => {
      const r = parseCommand("DW DEPOSIT USDC 50");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "DEPOSIT") {
        expect(r.value.coinType).toBe("USDC");
        expect(r.value.amount).toBe(50);
      }
    });
    it("rejects missing amount", () => {
      const r = parseCommand("DW DEPOSIT SUI");
      expect(r.ok).toBe(false);
    });
    it("rejects amount 0", () => {
      const r = parseCommand("DW DEPOSIT SUI 0");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 22. DW WITHDRAW
  // ============================================================
  describe("WITHDRAW", () => {
    it("parses DW WITHDRAW SUI 5", () => {
      const r = parseCommand("DW WITHDRAW SUI 5");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "WITHDRAW") {
        expect(r.value.coinType).toBe("SUI");
        expect(r.value.amount).toBe(5);
      }
    });
    it("rejects negative", () => {
      const r = parseCommand("DW WITHDRAW SUI -5");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 23. DW MARKET_BUY
  // ============================================================
  describe("MARKET_BUY", () => {
    it("parses DW MARKET_BUY SUI 10", () => {
      const r = parseCommand("DW MARKET_BUY SUI 10");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "MARKET_BUY") {
        expect(r.value.base).toBe("SUI");
        expect(r.value.quote).toBe("USDC");
        expect(r.value.qty).toBe(10);
      }
    });
    it("rejects non-SUI", () => {
      const r = parseCommand("DW MARKET_BUY ETH 10");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 24. DW MARKET_SELL
  // ============================================================
  describe("MARKET_SELL", () => {
    it("parses DW MARKET_SELL SUI 5", () => {
      const r = parseCommand("DW MARKET_SELL SUI 5");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "MARKET_SELL") {
        expect(r.value.base).toBe("SUI");
        expect(r.value.quote).toBe("USDC");
        expect(r.value.qty).toBe(5);
      }
    });
  });

  // ============================================================
  // 25. DW ALERT / ALERT_THRESHOLD
  // ============================================================
  describe("ALERT_THRESHOLD", () => {
    it("parses DW ALERT USDC BELOW 500", () => {
      const r = parseCommand("DW ALERT USDC BELOW 500");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "ALERT_THRESHOLD") {
        expect(r.value.coinType).toBe("USDC");
        expect(r.value.below).toBe(500);
      }
    });
    it("parses DW ALERT_THRESHOLD SUI 0.5", () => {
      const r = parseCommand("DW ALERT_THRESHOLD SUI 0.5");
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "ALERT_THRESHOLD") {
        expect(r.value.coinType).toBe("SUI");
        expect(r.value.below).toBe(0.5);
      }
    });
    it("allows threshold of 0 (disable)", () => {
      const r = parseCommand("DW ALERT USDC BELOW 0");
      expect(r.ok).toBe(true);
    });
    it("rejects bad format (ALERT without BELOW)", () => {
      const r = parseCommand("DW ALERT USDC 500");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // 26. DW AUTO_REBALANCE
  // ============================================================
  describe("AUTO_REBALANCE", () => {
    it("parses DW AUTO_REBALANCE ON", () => {
      const r = parseCommand("DW AUTO_REBALANCE ON");
      expect(r).toEqual({ ok: true, value: { type: "AUTO_REBALANCE", enabled: true } });
    });
    it("parses DW AUTO_REBALANCE OFF", () => {
      const r = parseCommand("DW AUTO_REBALANCE OFF");
      expect(r).toEqual({ ok: true, value: { type: "AUTO_REBALANCE", enabled: false } });
    });
    it("rejects invalid toggle", () => {
      const r = parseCommand("DW AUTO_REBALANCE MAYBE");
      expect(r.ok).toBe(false);
    });
  });

  // 27. DW YELLOW_SEND

  describe("YELLOW_SEND", () => {
    it("parses DW YELLOW_SEND 5 USDC TO <addr>", () => {
      const r = parseCommand(`DW YELLOW_SEND 5 USDC TO ${ADDR1}`);
      expect(r).toEqual({ ok: true, value: { type: "YELLOW_SEND", amountUsdc: 5, to: ADDR1 } });
    });
    it("parses DW YELLOW_SEND 0.5 USDC TO <addr>", () => {
      const r = parseCommand(`DW YELLOW_SEND 0.5 USDC TO ${ADDR2}`);
      expect(r).toEqual({ ok: true, value: { type: "YELLOW_SEND", amountUsdc: 0.5, to: ADDR2 } });
    });
    it("case-insensitive", () => {
      const r = parseCommand(`dw yellow_send 10 usdc to ${ADDR1}`);
      expect(r).toEqual({ ok: true, value: { type: "YELLOW_SEND", amountUsdc: 10, to: ADDR1 } });
    });
    it("rejects zero amount", () => {
      const r = parseCommand(`DW YELLOW_SEND 0 USDC TO ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
    it("rejects negative amount", () => {
      const r = parseCommand(`DW YELLOW_SEND -5 USDC TO ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
    it("rejects missing TO keyword", () => {
      const r = parseCommand(`DW YELLOW_SEND 5 USDC ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
    it("rejects non-USDC unit", () => {
      const r = parseCommand(`DW YELLOW_SEND 5 ETH TO ${ADDR1}`);
      expect(r.ok).toBe(false);
    });
    it("accepts ytest.usd as unit (Yellow sandbox token)", () => {
      const r = parseCommand(`DW YELLOW_SEND 10 ytest.usd TO ${ADDR1}`);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "YELLOW_SEND") {
        expect(r.value.amountUsdc).toBe(10);
        expect(r.value.to).toBe(ADDR1);
      }
    });
    it("accepts USD as unit", () => {
      const r = parseCommand(`DW YELLOW_SEND 5 USD TO ${ADDR1}`);
      expect(r.ok).toBe(true);
      if (r.ok && r.value.type === "YELLOW_SEND") {
        expect(r.value.amountUsdc).toBe(5);
      }
    });
    it("rejects invalid address", () => {
      const r = parseCommand("DW YELLOW_SEND 5 USDC TO 0xinvalid");
      expect(r.ok).toBe(false);
    });
  });

  // ============================================================
  // STOP_LOSS
  // ============================================================
  describe("STOP_LOSS", () => {
    it("parses DW STOP_LOSS SUI 100 @ 0.80", () => {
      const r = parseCommand("DW STOP_LOSS SUI 100 @ 0.80");
      expect(r).toEqual({ ok: true, value: { type: "STOP_LOSS", base: "SUI", quote: "USDC", qty: 100, triggerPrice: 0.8 } });
    });
    it("parses case-insensitively", () => {
      const r = parseCommand("dw stop_loss sui 50 @ 0.75");
      expect(r).toEqual({ ok: true, value: { type: "STOP_LOSS", base: "SUI", quote: "USDC", qty: 50, triggerPrice: 0.75 } });
    });
    it("rejects zero qty", () => {
      expect(parseCommand("DW STOP_LOSS SUI 0 @ 0.80").ok).toBe(false);
    });
    it("rejects negative price", () => {
      expect(parseCommand("DW STOP_LOSS SUI 100 @ -1").ok).toBe(false);
    });
    it("rejects missing @", () => {
      expect(parseCommand("DW STOP_LOSS SUI 100 0.80").ok).toBe(false);
    });
  });

  // ============================================================
  // TAKE_PROFIT
  // ============================================================
  describe("TAKE_PROFIT", () => {
    it("parses DW TAKE_PROFIT SUI 200 @ 2.50", () => {
      const r = parseCommand("DW TAKE_PROFIT SUI 200 @ 2.50");
      expect(r).toEqual({ ok: true, value: { type: "TAKE_PROFIT", base: "SUI", quote: "USDC", qty: 200, triggerPrice: 2.5 } });
    });
    it("parses case-insensitively", () => {
      const r = parseCommand("dw take_profit sui 100 @ 3.00");
      expect(r).toEqual({ ok: true, value: { type: "TAKE_PROFIT", base: "SUI", quote: "USDC", qty: 100, triggerPrice: 3 } });
    });
    it("rejects zero price", () => {
      expect(parseCommand("DW TAKE_PROFIT SUI 100 @ 0").ok).toBe(false);
    });
  });

  // ============================================================
  // SWEEP_YIELD
  // ============================================================
  describe("SWEEP_YIELD", () => {
    it("parses DW SWEEP_YIELD", () => {
      const r = parseCommand("DW SWEEP_YIELD");
      expect(r).toEqual({ ok: true, value: { type: "SWEEP_YIELD" } });
    });
    it("parses DW SWEEP alias", () => {
      const r = parseCommand("DW SWEEP");
      expect(r).toEqual({ ok: true, value: { type: "SWEEP_YIELD" } });
    });
    it("case-insensitive", () => {
      const r = parseCommand("dw sweep_yield");
      expect(r).toEqual({ ok: true, value: { type: "SWEEP_YIELD" } });
    });
  });

  // ============================================================
  // TRADE_HISTORY
  // ============================================================
  describe("TRADE_HISTORY", () => {
    it("parses DW TRADE_HISTORY", () => {
      const r = parseCommand("DW TRADE_HISTORY");
      expect(r).toEqual({ ok: true, value: { type: "TRADE_HISTORY" } });
    });
    it("parses DW TRADES alias", () => {
      const r = parseCommand("DW TRADES");
      expect(r).toEqual({ ok: true, value: { type: "TRADE_HISTORY" } });
    });
    it("parses DW PNL alias", () => {
      const r = parseCommand("DW PNL");
      expect(r).toEqual({ ok: true, value: { type: "TRADE_HISTORY" } });
    });
    it("parses DW P&L alias", () => {
      const r = parseCommand("DW P&L");
      expect(r).toEqual({ ok: true, value: { type: "TRADE_HISTORY" } });
    });
    it("case-insensitive", () => {
      const r = parseCommand("dw trades");
      expect(r).toEqual({ ok: true, value: { type: "TRADE_HISTORY" } });
    });
  });

  // ============================================================
  // PRICE
  // ============================================================
  describe("PRICE", () => {
    it("parses DW PRICE", () => {
      const r = parseCommand("DW PRICE");
      expect(r).toEqual({ ok: true, value: { type: "PRICE" } });
    });
    it("parses DW PRICES alias", () => {
      const r = parseCommand("DW PRICES");
      expect(r).toEqual({ ok: true, value: { type: "PRICE" } });
    });
    it("case-insensitive", () => {
      const r = parseCommand("dw price");
      expect(r).toEqual({ ok: true, value: { type: "PRICE" } });
    });
  });

  // ============================================================
  // CANCEL_ORDER
  // ============================================================
  describe("CANCEL_ORDER", () => {
    it("parses DW CANCEL_ORDER sl_12345", () => {
      const r = parseCommand("DW CANCEL_ORDER sl_12345");
      expect(r).toEqual({ ok: true, value: { type: "CANCEL_ORDER", orderId: "sl_12345" } });
    });
    it("parses DW CANCEL_ORDER tp_abc", () => {
      const r = parseCommand("DW CANCEL_ORDER tp_abc");
      expect(r).toEqual({ ok: true, value: { type: "CANCEL_ORDER", orderId: "tp_abc" } });
    });
    it("rejects missing orderId", () => {
      expect(parseCommand("DW CANCEL_ORDER").ok).toBe(false);
    });
    it("case-insensitive", () => {
      const r = parseCommand("dw cancel_order sl_123");
      expect(r).toEqual({ ok: true, value: { type: "CANCEL_ORDER", orderId: "sl_123" } });
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================
  describe("edge cases", () => {
    it("rejects empty string", () => {
      expect(parseCommand("").ok).toBe(false);
    });
    it("rejects random text", () => {
      expect(parseCommand("hello world").ok).toBe(false);
    });
    it("rejects DW alone", () => {
      expect(parseCommand("DW").ok).toBe(false);
    });
    it("rejects unknown op", () => {
      const r = parseCommand("DW FOOBAR");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("Unknown command");
    });
    it("handles extra whitespace", () => {
      const r = parseCommand("  DW   STATUS  ");
      expect(r).toEqual({ ok: true, value: { type: "STATUS" } });
    });
  });
});

describe("tryAutoDetect — natural language shortcuts", () => {
  it("auto-detects 'send 10 USDC to <addr>'", () => {
    const r = tryAutoDetect(`send 10 USDC to ${ADDR1}`);
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "PAYOUT") {
      expect(r.value.amountUsdc).toBe(10);
    }
  });
  it("auto-detects 'pay 5 USDC to <addr>'", () => {
    const r = tryAutoDetect(`pay 5 USDC to ${ADDR1}`);
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'transfer 100 USDC to <addr>'", () => {
    const r = tryAutoDetect(`transfer 100 USDC to ${ADDR1}`);
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'buy 50 SUI at 1.02'", () => {
    const r = tryAutoDetect("buy 50 SUI at 1.02");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "LIMIT_BUY") {
      expect(r.value.qty).toBe(50);
      expect(r.value.price).toBe(1.02);
    }
  });
  it("auto-detects 'sell 10 SUI @ 2.5'", () => {
    const r = tryAutoDetect("sell 10 SUI @ 2.5");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'bridge 100 USDC from arc to sui'", () => {
    const r = tryAutoDetect("bridge 100 USDC from arc to sui");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'deposit 10 SUI'", () => {
    const r = tryAutoDetect("deposit 10 SUI");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "DEPOSIT") {
      expect(r.value.coinType).toBe("SUI");
      expect(r.value.amount).toBe(10);
    }
  });
  it("auto-detects 'withdraw 5 USDC'", () => {
    const r = tryAutoDetect("withdraw 5 USDC");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'market buy 10 SUI'", () => {
    const r = tryAutoDetect("market buy 10 SUI");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'market sell 5 SUI'", () => {
    const r = tryAutoDetect("market sell 5 SUI");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'setup' and '/setup'", () => {
    expect(tryAutoDetect("setup")?.ok).toBe(true);
    expect(tryAutoDetect("/setup")?.ok).toBe(true);
  });
  it("auto-detects 'settle'", () => {
    expect(tryAutoDetect("settle")?.ok).toBe(true);
  });
  it("auto-detects 'status'", () => {
    expect(tryAutoDetect("status")?.ok).toBe(true);
  });
  it("auto-detects 'cancel order123'", () => {
    const r = tryAutoDetect("cancel order123");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "CANCEL") {
      expect(r.value.orderId).toBe("order123");
    }
  });
  it("auto-detects 'cancel schedule sched_123'", () => {
    const r = tryAutoDetect("cancel schedule sched_123");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "CANCEL_SCHEDULE") {
      expect(r.value.scheduleId).toBe("sched_123");
    }
  });
  it("auto-detects WalletConnect URI", () => {
    const r = tryAutoDetect("wc:abc123@2?relay-protocol=irn&symKey=xyz");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "CONNECT") {
      expect(r.value.wcUri).toContain("wc:");
    }
  });
  it("returns null for unknown text", () => {
    expect(tryAutoDetect("hello world")).toBe(null);
  });
  it("auto-detects 'cancel order ord_123'", () => {
    const r = tryAutoDetect("cancel order ord_123");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "CANCEL_ORDER") {
      expect(r.value.orderId).toBe("ord_123");
    }
  });
  it("auto-detects 'cancel stop loss sl_abc'", () => {
    const r = tryAutoDetect("cancel stop loss sl_abc");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "CANCEL_ORDER") {
      expect(r.value.orderId).toBe("sl_abc");
    }
  });
  it("returns null for empty string", () => {
    expect(tryAutoDetect("")).toBe(null);
  });
  it("auto-detects 'stop loss 100 SUI at 0.80'", () => {
    const r = tryAutoDetect("stop loss 100 SUI at 0.80");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "STOP_LOSS") {
      expect(r.value.base).toBe("SUI");
      expect(r.value.qty).toBe(100);
      expect(r.value.triggerPrice).toBe(0.8);
    }
  });
  it("auto-detects 'stop-loss SUI 50 @ 0.75'", () => {
    const r = tryAutoDetect("stop-loss SUI 50 @ 0.75");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "STOP_LOSS") {
      expect(r.value.qty).toBe(50);
      expect(r.value.triggerPrice).toBe(0.75);
    }
  });
  it("auto-detects 'take profit 100 SUI at 2.50'", () => {
    const r = tryAutoDetect("take profit 100 SUI at 2.50");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "TAKE_PROFIT") {
      expect(r.value.qty).toBe(100);
      expect(r.value.triggerPrice).toBe(2.5);
    }
  });
  it("auto-detects 'tp SUI 50 @ 2.50'", () => {
    const r = tryAutoDetect("tp SUI 50 @ 2.50");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "TAKE_PROFIT") {
      expect(r.value.qty).toBe(50);
    }
  });
  it("auto-detects 'sweep'", () => {
    const r = tryAutoDetect("sweep");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("SWEEP_YIELD");
  });
  it("auto-detects 'sweep yield'", () => {
    const r = tryAutoDetect("sweep yield");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'collect'", () => {
    const r = tryAutoDetect("collect");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("SWEEP_YIELD");
  });
  it("auto-detects 'pnl'", () => {
    const r = tryAutoDetect("pnl");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("TRADE_HISTORY");
  });
  it("auto-detects 'trades'", () => {
    const r = tryAutoDetect("trades");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("TRADE_HISTORY");
  });
  it("auto-detects 'p&l'", () => {
    const r = tryAutoDetect("p&l");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("TRADE_HISTORY");
  });
  it("auto-detects 'trade history'", () => {
    const r = tryAutoDetect("trade history");
    expect(r?.ok).toBe(true);
  });
  it("auto-detects 'price'", () => {
    const r = tryAutoDetect("price");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("PRICE");
  });
  it("auto-detects 'prices'", () => {
    const r = tryAutoDetect("prices");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("PRICE");
  });
  it("auto-detects 'treasury'", () => {
    const r = tryAutoDetect("treasury");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("TREASURY");
  });
  it("auto-detects 'unified balance'", () => {
    const r = tryAutoDetect("unified balance");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("TREASURY");
  });
  it("auto-detects 'all balances'", () => {
    const r = tryAutoDetect("all balances");
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(r.value.type).toBe("TREASURY");
  });
  it("auto-detects 'rebalance 100 USDC from arc to sui'", () => {
    const r = tryAutoDetect("rebalance 100 USDC from arc to sui");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "REBALANCE") {
      expect(r.value.amountUsdc).toBe(100);
      expect(r.value.fromChain).toBe("arc");
      expect(r.value.toChain).toBe("sui");
    }
  });
  it("auto-detects 'rebalance 50 from yellow to arc'", () => {
    const r = tryAutoDetect("rebalance 50 from yellow to arc");
    expect(r?.ok).toBe(true);
    if (r?.ok && r.value.type === "REBALANCE") {
      expect(r.value.amountUsdc).toBe(50);
      expect(r.value.fromChain).toBe("yellow");
      expect(r.value.toChain).toBe("arc");
    }
  });
});

describe("TREASURY", () => {
  it("parses DW TREASURY", () => {
    const r = parseCommand("DW TREASURY");
    expect(r).toEqual({ ok: true, value: { type: "TREASURY" } });
  });
});

describe("REBALANCE", () => {
  it("parses DW REBALANCE 100 FROM arc TO sui", () => {
    const r = parseCommand("DW REBALANCE 100 FROM arc TO sui");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "REBALANCE") {
      expect(r.value.amountUsdc).toBe(100);
      expect(r.value.fromChain).toBe("arc");
      expect(r.value.toChain).toBe("sui");
    }
  });
  it("parses DW REBALANCE 50 FROM yellow TO arc", () => {
    const r = parseCommand("DW REBALANCE 50 FROM yellow TO arc");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "REBALANCE") {
      expect(r.value.amountUsdc).toBe(50);
      expect(r.value.fromChain).toBe("yellow");
      expect(r.value.toChain).toBe("arc");
    }
  });
  it("parses DW REBALANCE 25 FROM sui TO yellow", () => {
    const r = parseCommand("DW REBALANCE 25 FROM sui TO yellow");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "REBALANCE") {
      expect(r.value.amountUsdc).toBe(25);
      expect(r.value.fromChain).toBe("sui");
      expect(r.value.toChain).toBe("yellow");
    }
  });
  it("rejects same source and destination", () => {
    const r = parseCommand("DW REBALANCE 100 FROM arc TO arc");
    expect(r.ok).toBe(false);
  });
  it("rejects invalid chain", () => {
    const r = parseCommand("DW REBALANCE 100 FROM ethereum TO sui");
    expect(r.ok).toBe(false);
  });
  it("rejects zero amount", () => {
    const r = parseCommand("DW REBALANCE 0 FROM arc TO sui");
    expect(r.ok).toBe(false);
  });
  it("rejects missing FROM keyword", () => {
    const r = parseCommand("DW REBALANCE 100 arc TO sui");
    expect(r.ok).toBe(false);
  });
});
