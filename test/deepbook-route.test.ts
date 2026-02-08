import { describe, expect, it } from "vitest";
import { planMarketBuy, planMarketSell, planDbusdcTopUp } from "../src/integrations/deepbook-route.js";

describe("DeepBook Route Planner", () => {
  describe("planMarketBuy", () => {
    it("returns direct buy when DBUSDC is sufficient", () => {
      const plan = planMarketBuy({
        qty: 10,
        midPrice: 1.5,
        balances: { suiBalance: 100, dbUsdcBalance: 50, deepBalance: 0 },
      });
      expect(plan.needsDbUsdcTopUp).toBe(false);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].side).toBe("buy");
      expect(plan.steps[0].pool).toBe("SUI_DBUSDC");
    });

    it("plans SUI→DBUSDC pre-trade when DBUSDC is insufficient", () => {
      const plan = planMarketBuy({
        qty: 50,
        midPrice: 1.5,
        balances: { suiBalance: 200, dbUsdcBalance: 5, deepBalance: 0 },
      });
      expect(plan.needsDbUsdcTopUp).toBe(true);
      expect(plan.steps.length).toBe(2);
      expect(plan.steps[0].side).toBe("sell"); // pre-trade: sell SUI
      expect(plan.steps[1].side).toBe("buy");  // main: buy SUI
    });

    it("warns when insufficient funds on all routes", () => {
      const plan = planMarketBuy({
        qty: 1000,
        midPrice: 1.5,
        balances: { suiBalance: 0.01, dbUsdcBalance: 0, deepBalance: 0 },
      });
      expect(plan.needsDbUsdcTopUp).toBe(true);
      expect(plan.summary).toContain("WARN");
    });

    it("considers DEEP balance for routing", () => {
      const plan = planMarketBuy({
        qty: 10,
        midPrice: 1.5,
        balances: { suiBalance: 0.01, dbUsdcBalance: 0, deepBalance: 100000 },
      });
      expect(plan.needsDbUsdcTopUp).toBe(true);
      expect(plan.steps[0].pool).toBe("DEEP_DBUSDC");
    });
  });

  describe("planMarketSell", () => {
    it("plans direct sell when SUI is sufficient", () => {
      const plan = planMarketSell({
        qty: 10,
        midPrice: 1.5,
        balances: { suiBalance: 50, dbUsdcBalance: 0, deepBalance: 0 },
      });
      expect(plan.needsDbUsdcTopUp).toBe(false);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].side).toBe("sell");
    });

    it("warns when insufficient SUI", () => {
      const plan = planMarketSell({
        qty: 100,
        midPrice: 1.5,
        balances: { suiBalance: 5, dbUsdcBalance: 0, deepBalance: 0 },
      });
      expect(plan.summary).toContain("WARN");
    });
  });

  describe("planDbusdcTopUp", () => {
    it("returns not needed when DBUSDC is sufficient", () => {
      const result = planDbusdcTopUp({
        neededDbUsdc: 10,
        currentDbUsdc: 20,
        currentSui: 100,
        midPrice: 1.5,
      });
      expect(result.needed).toBe(false);
      expect(result.suiToSell).toBe(0);
    });

    it("calculates SUI to sell for DBUSDC shortfall", () => {
      const result = planDbusdcTopUp({
        neededDbUsdc: 100,
        currentDbUsdc: 10,
        currentSui: 200,
        midPrice: 1.5,
      });
      expect(result.needed).toBe(true);
      expect(result.suiToSell).toBeGreaterThan(0);
      // Should sell enough SUI to cover ~90 DBUSDC shortfall + slippage
      expect(result.suiToSell).toBeGreaterThan(60); // 90/1.5 = 60 before slippage
    });

    it("limits sell to available SUI minus gas reserve", () => {
      const result = planDbusdcTopUp({
        neededDbUsdc: 1000,
        currentDbUsdc: 0,
        currentSui: 1,
        midPrice: 1.5,
      });
      expect(result.needed).toBe(true);
      expect(result.suiToSell).toBeLessThanOrEqual(0.95); // 1 - 0.05 gas reserve
    });
  });
});
