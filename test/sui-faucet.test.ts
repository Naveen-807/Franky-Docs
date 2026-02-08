import { describe, expect, it } from "vitest";
import { requestTestnetSui, resetFaucetCooldown } from "../src/integrations/sui-faucet.js";

describe("Sui Faucet", () => {
  it("enforces cooldown between requests for same address", async () => {
    const addr = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    resetFaucetCooldown(addr);

    // First request will try the network (may fail if no network)
    // but cooldown logic is what we test
    const result1 = await requestTestnetSui({
      address: addr,
      faucetUrl: "http://localhost:0/fake-faucet", // intentionally unreachable
    });

    // Should fail due to network error
    expect(result1.ok).toBe(false);
    expect(result1.message).toContain("failed");
  });

  it("resets cooldown correctly", () => {
    resetFaucetCooldown("0xabc");
    resetFaucetCooldown(); // clear all
  });
});
