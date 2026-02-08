/**
 * DeepBook Route Planner — plan DBUSDC sourcing via DEEP routing.
 *
 * DeepBook V3 on Sui testnet has three pools:
 *   SUI_DBUSDC  — SUI ↔ DBUSDC
 *   DEEP_SUI    — DEEP ↔ SUI
 *   DEEP_DBUSDC — DEEP ↔ DBUSDC
 *
 * For a MARKET_BUY SUI:
 *   User needs DBUSDC to buy SUI.
 *   Route: if wallet has SUI but no DBUSDC → sell some SUI for DBUSDC first (SUI_DBUSDC pool)
 *
 * For a MARKET_SELL SUI:
 *   User sells SUI and receives DBUSDC.
 *   Straightforward: sell via SUI_DBUSDC pool.
 *
 * DEEP token discount:
 *   DeepBook V3 offers fee discounts for holding DEEP tokens.
 *   If the wallet has DEEP, they can be staked for reduced trading fees.
 */

export interface PoolBalance {
  suiBalance: number;
  dbUsdcBalance: number;
  deepBalance: number;
}

export interface RouteStep {
  pool: string;
  side: "buy" | "sell";
  qty: number;
  description: string;
}

export interface RoutePlan {
  steps: RouteStep[];
  /** True if we need to auto-source DBUSDC before the main trade */
  needsDbUsdcTopUp: boolean;
  /** Estimated DBUSDC needed (for buys) */
  estimatedDbUsdcNeeded: number;
  /** Human-readable summary */
  summary: string;
}

/**
 * Plan steps for buying SUI via DeepBook.
 * If user has insufficient DBUSDC, plan a pre-trade to source it.
 *
 * @param qty        Amount of SUI to buy
 * @param midPrice   Current SUI/DBUSDC mid price
 * @param balances   Wallet balances
 * @param slippage   Slippage multiplier (e.g. 1.02 = 2% slippage buffer)
 */
export function planMarketBuy(opts: {
  qty: number;
  midPrice: number;
  balances: PoolBalance;
  slippage?: number;
}): RoutePlan {
  const { qty, midPrice, balances, slippage = 1.03 } = opts;
  const estimatedDbUsdcNeeded = qty * midPrice * slippage;
  const steps: RouteStep[] = [];

  if (balances.dbUsdcBalance >= estimatedDbUsdcNeeded) {
    // Enough DBUSDC — direct buy
    steps.push({
      pool: "SUI_DBUSDC",
      side: "buy",
      qty,
      description: `Buy ${qty} SUI @ market (~$${midPrice.toFixed(4)})`,
    });

    return {
      steps,
      needsDbUsdcTopUp: false,
      estimatedDbUsdcNeeded,
      summary: `Direct buy ${qty} SUI (have ${balances.dbUsdcBalance.toFixed(2)} DBUSDC)`,
    };
  }

  // Need more DBUSDC — sell some SUI to get DBUSDC first
  const shortfall = estimatedDbUsdcNeeded - balances.dbUsdcBalance;
  const suiToSell = (shortfall / midPrice) * slippage; // sell enough SUI to cover shortfall

  if (balances.suiBalance >= suiToSell + 0.1) {
    // Has enough SUI to sell for DBUSDC
    steps.push({
      pool: "SUI_DBUSDC",
      side: "sell",
      qty: Number(suiToSell.toFixed(4)),
      description: `Pre-trade: sell ${suiToSell.toFixed(4)} SUI → ~${shortfall.toFixed(2)} DBUSDC`,
    });
    steps.push({
      pool: "SUI_DBUSDC",
      side: "buy",
      qty,
      description: `Buy ${qty} SUI @ market (~$${midPrice.toFixed(4)})`,
    });

    return {
      steps,
      needsDbUsdcTopUp: true,
      estimatedDbUsdcNeeded,
      summary: `Route: sell ${suiToSell.toFixed(2)} SUI → DBUSDC, then buy ${qty} SUI`,
    };
  }

  // Not enough SUI either — try DEEP route
  if (balances.deepBalance > 0) {
    const deepMidPrice = midPrice * 0.01; // rough DEEP/DBUSDC estimate
    const deepToSell = (shortfall / deepMidPrice) * slippage;

    if (balances.deepBalance >= deepToSell) {
      steps.push({
        pool: "DEEP_DBUSDC",
        side: "sell",
        qty: Number(deepToSell.toFixed(4)),
        description: `Pre-trade: sell ${deepToSell.toFixed(4)} DEEP → ~${shortfall.toFixed(2)} DBUSDC`,
      });
      steps.push({
        pool: "SUI_DBUSDC",
        side: "buy",
        qty,
        description: `Buy ${qty} SUI @ market (~$${midPrice.toFixed(4)})`,
      });

      return {
        steps,
        needsDbUsdcTopUp: true,
        estimatedDbUsdcNeeded,
        summary: `Route: sell ${deepToSell.toFixed(2)} DEEP → DBUSDC, then buy ${qty} SUI`,
      };
    }
  }

  // Insufficient funds — still return the plan but it will fail at execution
  steps.push({
    pool: "SUI_DBUSDC",
    side: "buy",
    qty,
    description: `Buy ${qty} SUI @ market (~$${midPrice.toFixed(4)}) — may fail: insufficient DBUSDC`,
  });

  return {
    steps,
    needsDbUsdcTopUp: true,
    estimatedDbUsdcNeeded,
    summary: `WARN: need ~${estimatedDbUsdcNeeded.toFixed(2)} DBUSDC, have ${balances.dbUsdcBalance.toFixed(2)}. May fail.`,
  };
}

/**
 * Plan steps for selling SUI via DeepBook.
 * Straightforward — sell SUI on SUI_DBUSDC pool to receive DBUSDC.
 */
export function planMarketSell(opts: {
  qty: number;
  midPrice: number;
  balances: PoolBalance;
}): RoutePlan {
  const { qty, midPrice, balances } = opts;
  const steps: RouteStep[] = [];

  if (balances.suiBalance < qty + 0.05) {
    return {
      steps: [{
        pool: "SUI_DBUSDC",
        side: "sell",
        qty,
        description: `Sell ${qty} SUI @ market — may fail: only ${balances.suiBalance.toFixed(4)} SUI available`,
      }],
      needsDbUsdcTopUp: false,
      estimatedDbUsdcNeeded: 0,
      summary: `WARN: selling ${qty} SUI but wallet only has ${balances.suiBalance.toFixed(4)} SUI`,
    };
  }

  steps.push({
    pool: "SUI_DBUSDC",
    side: "sell",
    qty,
    description: `Sell ${qty} SUI @ market (~$${midPrice.toFixed(4)}) → ~${(qty * midPrice).toFixed(2)} DBUSDC`,
  });

  return {
    steps,
    needsDbUsdcTopUp: false,
    estimatedDbUsdcNeeded: 0,
    summary: `Direct sell ${qty} SUI → ~${(qty * midPrice).toFixed(2)} DBUSDC`,
  };
}

/**
 * Calculate whether a DBUSDC top-up from SUI is needed and how much.
 * Pure function — does not execute anything.
 */
export function planDbusdcTopUp(opts: {
  neededDbUsdc: number;
  currentDbUsdc: number;
  currentSui: number;
  midPrice: number;
  slippage?: number;
}): { needed: boolean; suiToSell: number; expectedDbUsdc: number } {
  const { neededDbUsdc, currentDbUsdc, currentSui, midPrice, slippage = 1.03 } = opts;

  if (currentDbUsdc >= neededDbUsdc) {
    return { needed: false, suiToSell: 0, expectedDbUsdc: currentDbUsdc };
  }

  const shortfall = neededDbUsdc - currentDbUsdc;
  const suiToSell = (shortfall / midPrice) * slippage;

  if (currentSui < suiToSell + 0.05) {
    // Can't cover it fully — sell what we can
    const maxSell = Math.max(0, currentSui - 0.05);
    return {
      needed: true,
      suiToSell: Number(maxSell.toFixed(4)),
      expectedDbUsdc: currentDbUsdc + maxSell * midPrice,
    };
  }

  return {
    needed: true,
    suiToSell: Number(suiToSell.toFixed(4)),
    expectedDbUsdc: currentDbUsdc + suiToSell * midPrice,
  };
}
