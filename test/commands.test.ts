import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/core/commands.js";

const addr = "0x0000000000000000000000000000000000000001";

describe("parseCommand", () => {
  it("parses setup and status", () => {
    const setup = parseCommand("DW /setup");
    expect(setup.ok).toBe(true);
    if (setup.ok) expect(setup.value.type).toBe("SETUP");

    const status = parseCommand("DW STATUS");
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.value.type).toBe("STATUS");
  });

  it("parses payout and limit buy", () => {
    const payout = parseCommand(`DW PAYOUT 1 USDC TO ${addr}`);
    expect(payout.ok).toBe(true);
    if (payout.ok && payout.value.type === "PAYOUT") {
      expect(payout.value.amountUsdc).toBe(1);
      expect(payout.value.to).toBe(addr);
    }

    const buy = parseCommand("DW LIMIT_BUY SUI 5 USDC @ 1.02");
    expect(buy.ok).toBe(true);
    if (buy.ok && buy.value.type === "LIMIT_BUY") {
      expect(buy.value.base).toBe("SUI");
      expect(buy.value.quote).toBe("USDC");
    }
  });

  it("parses alert aliases", () => {
    const alert = parseCommand("DW ALERT USDC BELOW 500");
    expect(alert.ok).toBe(true);
    if (alert.ok && alert.value.type === "ALERT_THRESHOLD") {
      expect(alert.value.coinType).toBe("USDC");
      expect(alert.value.below).toBe(500);
    }

    const alertThreshold = parseCommand("DW ALERT_THRESHOLD SUI 0.5");
    expect(alertThreshold.ok).toBe(true);
    if (alertThreshold.ok && alertThreshold.value.type === "ALERT_THRESHOLD") {
      expect(alertThreshold.value.coinType).toBe("SUI");
      expect(alertThreshold.value.below).toBe(0.5);
    }
  });

  it("parses schedule cancel alias", () => {
    const unschedule = parseCommand("DW UNSCHEDULE sched_123");
    expect(unschedule.ok).toBe(true);
    if (unschedule.ok && unschedule.value.type === "CANCEL_SCHEDULE") {
      expect(unschedule.value.scheduleId).toBe("sched_123");
    }
  });

  it("rejects invalid formats with stable errors", () => {
    const badAlert = parseCommand("DW ALERT USDC 500");
    expect(badAlert.ok).toBe(false);
    if (!badAlert.ok) expect(badAlert.error).toBe("ALERT expects BELOW <amount>");
  });

  it("auto-detects simple commands without DW prefix", () => {
    const auto = parseCommand(`send 10 usdc to ${addr}`);
    expect(auto.ok).toBe(true);
    if (auto.ok && auto.value.type === "PAYOUT") {
      expect(auto.value.amountUsdc).toBe(10);
      expect(auto.value.to).toBe(addr);
    }
  });
});
