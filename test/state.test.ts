import { describe, expect, it } from "vitest";
import { canTransition } from "../src/core/state.js";

describe("canTransition", () => {
  it("allows valid transitions", () => {
    expect(canTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(canTransition("APPROVED", "EXECUTING")).toBe(true);
    expect(canTransition("EXECUTING", "EXECUTED")).toBe(true);
  });

  it("blocks invalid transitions", () => {
    expect(canTransition("EXECUTED", "APPROVED")).toBe(false);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("FAILED", "EXECUTING")).toBe(false);
  });
});
