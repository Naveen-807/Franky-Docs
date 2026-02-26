import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/core/commands.js";

describe("parseCommand smoke (BCH)", () => {
  it("parses setup/status", () => {
    expect(parseCommand("DW SETUP")).toEqual({ ok: true, value: { type: "SETUP" } });
    expect(parseCommand("DW STATUS")).toEqual({ ok: true, value: { type: "STATUS" } });
  });

  it("parses alert aliases", () => {
    expect(parseCommand("DW ALERT BCH BELOW 0.1")).toEqual({
      ok: true,
      value: { type: "ALERT_THRESHOLD", coinType: "BCH", below: 0.1 }
    });
    expect(parseCommand("DW ALERT_THRESHOLD BCH 0")).toEqual({
      ok: true,
      value: { type: "ALERT_THRESHOLD", coinType: "BCH", below: 0 }
    });
  });

  it("parses schedule cancel alias", () => {
    expect(parseCommand("DW UNSCHEDULE sched_123")).toEqual({
      ok: true,
      value: { type: "CANCEL_SCHEDULE", scheduleId: "sched_123" }
    });
  });

  it("auto-detects BCH transfer", () => {
    const auto = parseCommand("send 10000 sats to bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a");
    expect(auto).toEqual({
      ok: true,
      value: {
        type: "BCH_SEND",
        to: "bchtest:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a",
        amountSats: 10000
      }
    });
  });
});
