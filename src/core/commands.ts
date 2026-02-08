import { z } from "zod";

export type ParsedCommand =
  | { type: "SETUP" }
  | { type: "STATUS" }
  | { type: "SESSION_CREATE" }
  | { type: "SIGNER_ADD"; address: `0x${string}`; weight: number }
  | { type: "QUORUM"; quorum: number }
  | { type: "CONNECT"; wcUri: string }
  | {
      type: "WC_TX";
      chainId: number;
      to: `0x${string}`;
      data?: `0x${string}`;
      value?: `0x${string}`;
      from?: `0x${string}`;
      gas?: `0x${string}`;
      gasPrice?: `0x${string}`;
      maxFeePerGas?: `0x${string}`;
      maxPriorityFeePerGas?: `0x${string}`;
      nonce?: `0x${string}`;
    }
  | { type: "WC_SIGN"; address: `0x${string}`; message: string }
  | { type: "LIMIT_BUY"; base: "SUI"; quote: "USDC"; qty: number; price: number }
  | { type: "LIMIT_SELL"; base: "SUI"; quote: "USDC"; qty: number; price: number }
  | { type: "CANCEL"; orderId: string }
  | { type: "SETTLE" }
  | { type: "PAYOUT"; amountUsdc: number; to: `0x${string}` }
  | { type: "PAYOUT_SUI"; amountSui: number; to: `0x${string}` }
  | { type: "PAYOUT_SPLIT"; amountUsdc: number; recipients: Array<{ to: `0x${string}`; pct: number }> }
  | { type: "SCHEDULE"; intervalHours: number; innerCommand: string }
  | { type: "CANCEL_SCHEDULE"; scheduleId: string }
  | { type: "BRIDGE"; amountUsdc: number; fromChain: string; toChain: string }
  | { type: "SESSION_CLOSE" }
  | { type: "SESSION_STATUS" }
  | { type: "DEPOSIT"; coinType: string; amount: number }
  | { type: "WITHDRAW"; coinType: string; amount: number }
  | { type: "MARKET_BUY"; base: "SUI"; quote: "USDC"; qty: number }
  | { type: "MARKET_SELL"; base: "SUI"; quote: "USDC"; qty: number }
  | { type: "ALERT_THRESHOLD"; coinType: string; below: number }
  | { type: "AUTO_REBALANCE"; enabled: boolean }
  | { type: "YELLOW_SEND"; amountUsdc: number; to: `0x${string}` }
  | { type: "YELLOW_DEPOSIT"; amountUsdc: number }
  | { type: "YELLOW_WITHDRAW"; amountUsdc: number }
  | { type: "YELLOW_BALANCE" }
  | { type: "YELLOW_SWAP"; amountFrom: number; fromAsset: string; toAsset: string }
  | { type: "CHANNEL_RESIZE"; newCapacity: number }
  | { type: "CHANNEL_HISTORY" }
  | { type: "STOP_LOSS"; base: "SUI"; quote: "USDC"; qty: number; triggerPrice: number }
  | { type: "TAKE_PROFIT"; base: "SUI"; quote: "USDC"; qty: number; triggerPrice: number }
  | { type: "SWEEP_YIELD" }
  | { type: "TRADE_HISTORY" }
  | { type: "PRICE" }
  | { type: "CANCEL_ORDER"; orderId: string }
  | { type: "TREASURY" }
  | { type: "REBALANCE"; fromChain: string; toChain: string; amountUsdc: number };

const HexString = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/)
  .transform((v) => v as `0x${string}`);

const AddressString = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v as `0x${string}`);

const WalletConnectTxSchema = z.object({
  chainId: z.number().int().positive(),
  to: AddressString,
  data: HexString.optional(),
  value: HexString.optional(),
  from: AddressString.optional(),
  gas: HexString.optional(),
  gasPrice: HexString.optional(),
  maxFeePerGas: HexString.optional(),
  maxPriorityFeePerGas: HexString.optional(),
  nonce: HexString.optional()
});

export const ParsedCommandSchema: z.ZodType<ParsedCommand, z.ZodTypeDef, unknown> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SETUP") }),
  z.object({ type: z.literal("STATUS") }),
  z.object({ type: z.literal("SESSION_CREATE") }),
  z.object({
    type: z.literal("SIGNER_ADD"),
    address: AddressString,
    weight: z.number().int().positive()
  }),
  z.object({ type: z.literal("QUORUM"), quorum: z.number().int().positive() }),
  z.object({ type: z.literal("CONNECT"), wcUri: z.string().min(1) }),
  WalletConnectTxSchema.extend({ type: z.literal("WC_TX") }),
  z.object({ type: z.literal("WC_SIGN"), address: AddressString, message: z.string().min(1) }),
  z.object({
    type: z.literal("LIMIT_BUY"),
    base: z.literal("SUI"),
    quote: z.literal("USDC"),
    qty: z.number().positive(),
    price: z.number().positive()
  }),
  z.object({
    type: z.literal("LIMIT_SELL"),
    base: z.literal("SUI"),
    quote: z.literal("USDC"),
    qty: z.number().positive(),
    price: z.number().positive()
  }),
  z.object({ type: z.literal("CANCEL"), orderId: z.string().min(1) }),
  z.object({ type: z.literal("SETTLE") }),
  z.object({
    type: z.literal("PAYOUT"),
    amountUsdc: z.number().positive(),
    to: AddressString
  }),
  z.object({
    type: z.literal("PAYOUT_SUI"),
    amountSui: z.number().positive(),
    to: AddressString
  }),
  z.object({
    type: z.literal("PAYOUT_SPLIT"),
    amountUsdc: z.number().positive(),
    recipients: z
      .array(
        z.object({
          to: AddressString,
          pct: z.number().positive()
        })
      )
      .min(2)
  }),
  z.object({
    type: z.literal("SCHEDULE"),
    intervalHours: z.number().positive(),
    innerCommand: z.string().min(1)
  }),
  z.object({ type: z.literal("CANCEL_SCHEDULE"), scheduleId: z.string().min(1) }),
  z.object({
    type: z.literal("BRIDGE"),
    amountUsdc: z.number().positive(),
    fromChain: z.string().min(1),
    toChain: z.string().min(1)
  }),
  z.object({ type: z.literal("SESSION_CLOSE") }),
  z.object({ type: z.literal("SESSION_STATUS") }),
  z.object({
    type: z.literal("DEPOSIT"),
    coinType: z.string().min(1),
    amount: z.number().positive()
  }),
  z.object({
    type: z.literal("WITHDRAW"),
    coinType: z.string().min(1),
    amount: z.number().positive()
  }),
  z.object({
    type: z.literal("MARKET_BUY"),
    base: z.literal("SUI"),
    quote: z.literal("USDC"),
    qty: z.number().positive()
  }),
  z.object({
    type: z.literal("MARKET_SELL"),
    base: z.literal("SUI"),
    quote: z.literal("USDC"),
    qty: z.number().positive()
  }),
  z.object({
    type: z.literal("ALERT_THRESHOLD"),
    coinType: z.string().min(1),
    below: z.number().nonnegative()
  }),
  z.object({
    type: z.literal("AUTO_REBALANCE"),
    enabled: z.boolean()
  }),
  z.object({
    type: z.literal("YELLOW_SEND"),
    amountUsdc: z.number().positive(),
    to: AddressString
  }),
  z.object({
    type: z.literal("STOP_LOSS"),
    base: z.literal("SUI"),
    quote: z.literal("USDC"),
    qty: z.number().positive(),
    triggerPrice: z.number().positive()
  }),
  z.object({
    type: z.literal("TAKE_PROFIT"),
    base: z.literal("SUI"),
    quote: z.literal("USDC"),
    qty: z.number().positive(),
    triggerPrice: z.number().positive()
  }),
  z.object({ type: z.literal("SWEEP_YIELD") }),
  z.object({ type: z.literal("TRADE_HISTORY") }),
  z.object({ type: z.literal("PRICE") }),
  z.object({ type: z.literal("CANCEL_ORDER"), orderId: z.string().min(1) }),
  z.object({ type: z.literal("TREASURY") }),
  z.object({
    type: z.literal("REBALANCE"),
    fromChain: z.string().min(1),
    toChain: z.string().min(1),
    amountUsdc: z.number().positive()
  })
]);

export type ParseResult =
  | { ok: true; value: ParsedCommand }
  | { ok: false; error: string };

function parseNumber(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Try to auto-detect common command patterns without the DW prefix.
 * Returns a ParseResult if detected, null otherwise.
 */
export function tryAutoDetect(raw: string): ParseResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // WalletConnect URI pasted directly
  if (trimmed.startsWith("wc:")) {
    return parseCommand(`DW CONNECT ${trimmed}`);
  }

  const lower = trimmed.toLowerCase();

  // --- Web2-friendly patterns: strip $ currency prefix ---
  // "send $50 to 0x..." / "pay $100 to 0x..."
  const dollarSendMatch = trimmed.match(/^(?:send|pay|transfer)\s+\$([\d.]+)\s+to\s+(0x[0-9a-fA-F]{40,64})$/i);
  if (dollarSendMatch) {
    return parseCommand(`DW PAYOUT ${dollarSendMatch[1]} USDC TO ${dollarSendMatch[2]}`);
  }

  // "send 10 USDC to 0x..." / "pay 10 USDC to 0x..." / "transfer 10 USDC to 0x..."
  const sendMatch = trimmed.match(/^(?:send|pay|transfer)\s+([\d.]+)\s*USDC\s+to\s+(0x[0-9a-fA-F]{40,64})$/i);
  if (sendMatch) {
    return parseCommand(`DW PAYOUT ${sendMatch[1]} USDC TO ${sendMatch[2]}`);
  }

  // "send 1 SUI to 0x..." / "pay 0.5 SUI to 0x..." / "transfer 2 SUI to 0x..."
  const sendSuiMatch = trimmed.match(/^(?:send|pay|transfer)\s+([\d.]+)\s*SUI\s+to\s+(0x[0-9a-fA-F]{40,64})$/i);
  if (sendSuiMatch) {
    return parseCommand(`DW PAYOUT ${sendSuiMatch[1]} SUI TO ${sendSuiMatch[2]}`);
  }

  // "swap 10 SUI for USDC" → MARKET_SELL
  const swapSellMatch = trimmed.match(/^swap\s+([\d.]+)\s*SUI\s+(?:for|to)\s*(?:USDC|USD|\$)$/i);
  if (swapSellMatch) {
    return parseCommand(`DW MARKET_SELL SUI ${swapSellMatch[1]}`);
  }

  // "swap 50 USDC for SUI" / "swap $50 for SUI" → MARKET_BUY (interpret as qty of SUI based on rough estimate)
  const swapBuyMatch = trimmed.match(/^swap\s+\$?([\d.]+)\s*(?:USDC|USD)?\s+(?:for|to)\s*SUI$/i);
  if (swapBuyMatch) {
    return parseCommand(`DW MARKET_BUY SUI ${swapBuyMatch[1]}`);
  }

  // "invest $100 in SUI" / "invest 100 in SUI"
  const investMatch = trimmed.match(/^invest\s+\$?([\d.]+)\s+in\s+SUI$/i);
  if (investMatch) {
    return parseCommand(`DW MARKET_BUY SUI ${investMatch[1]}`);
  }

  // "buy 10 SUI at market" → MARKET_BUY (explicit market keyword)
  const buyAtMarketMatch = trimmed.match(/^buy\s+([\d.]+)\s*SUI\s+at\s+market$/i);
  if (buyAtMarketMatch) {
    return parseCommand(`DW MARKET_BUY SUI ${buyAtMarketMatch[1]}`);
  }

  // "sell 10 SUI at market" → MARKET_SELL
  const sellAtMarketMatch = trimmed.match(/^sell\s+([\d.]+)\s*SUI\s+at\s+market$/i);
  if (sellAtMarketMatch) {
    return parseCommand(`DW MARKET_SELL SUI ${sellAtMarketMatch[1]}`);
  }

  // "DCA 5 SUI daily" / "DCA 10 SUI weekly" / "DCA 5 SUI every 24h"
  const dcaDailyMatch = trimmed.match(/^DCA\s+([\d.]+)\s*SUI\s+daily$/i);
  if (dcaDailyMatch) {
    return parseCommand(`DW SCHEDULE EVERY 24h: DW MARKET_BUY SUI ${dcaDailyMatch[1]}`);
  }
  const dcaWeeklyMatch = trimmed.match(/^DCA\s+([\d.]+)\s*SUI\s+weekly$/i);
  if (dcaWeeklyMatch) {
    return parseCommand(`DW SCHEDULE EVERY 168h: DW MARKET_BUY SUI ${dcaWeeklyMatch[1]}`);
  }
  const dcaEveryMatch = trimmed.match(/^DCA\s+([\d.]+)\s*SUI\s+every\s+([\d.]+)\s*h(?:ours?)?$/i);
  if (dcaEveryMatch) {
    return parseCommand(`DW SCHEDULE EVERY ${dcaEveryMatch[2]}h: DW MARKET_BUY SUI ${dcaEveryMatch[1]}`);
  }

  // "check balance" / "my balance" / "show balance" / "what's my balance"
  if (lower === "check balance" || lower === "my balance" || lower === "show balance"
      || lower.match(/^what'?s?\s+my\s+balance/)) {
    return parseCommand("DW TREASURY");
  }

  // "help" / "?"
  if (lower === "help" || lower === "?") {
    return parseCommand("DW STATUS");
  }

  // "top up" / "fund wallet" / "get tokens" / "faucet" (returns STATUS to trigger balance view)
  if (lower === "top up" || lower === "fund wallet" || lower === "get tokens" || lower === "faucet") {
    return parseCommand("DW STATUS");
  }

  // "set budget X USDC per day" / "set limit X per day" → ALERT_THRESHOLD (spending awareness)
  const budgetMatch = trimmed.match(/^set\s+(?:budget|limit|spending)\s+\$?([\d.]+)\s*(?:USDC\s+)?per\s+day$/i);
  if (budgetMatch) {
    return parseCommand(`DW ALERT_THRESHOLD USDC ${budgetMatch[1]}`);
  }

  // "show trades" / "my trades"
  if (lower === "show trades" || lower === "my trades" || lower === "recent trades") {
    return parseCommand("DW TRADE_HISTORY");
  }

  // "buy 50 SUI at 1.02" / "buy 50 SUI @ 1.02"
  const buyMatch = trimmed.match(/^buy\s+([\d.]+)\s*SUI\s*(?:at|@)\s*([\d.]+)$/i);
  if (buyMatch) {
    return parseCommand(`DW LIMIT_BUY SUI ${buyMatch[1]} USDC @ ${buyMatch[2]}`);
  }

  // "sell 50 SUI at 1.5" / "sell 50 SUI @ 1.5"
  const sellMatch = trimmed.match(/^sell\s+([\d.]+)\s*SUI\s*(?:at|@)\s*([\d.]+)$/i);
  if (sellMatch) {
    return parseCommand(`DW LIMIT_SELL SUI ${sellMatch[1]} USDC @ ${sellMatch[2]}`);
  }

  // "bridge 100 USDC from arc to sui"
  const bridgeMatch = trimmed.match(/^bridge\s+([\d.]+)\s*USDC\s+from\s+(\w+)\s+to\s+(\w+)$/i);
  if (bridgeMatch) {
    return parseCommand(`DW BRIDGE ${bridgeMatch[1]} USDC FROM ${bridgeMatch[2]} TO ${bridgeMatch[3]}`);
  }

  // "deposit 10 SUI" / "deposit 50 USDC"
  const depositMatch = trimmed.match(/^deposit\s+([\d.]+)\s*(\w+)$/i);
  if (depositMatch) {
    return parseCommand(`DW DEPOSIT ${depositMatch[2]} ${depositMatch[1]}`);
  }

  // "withdraw 10 SUI"
  const withdrawMatch = trimmed.match(/^withdraw\s+([\d.]+)\s*(\w+)$/i);
  if (withdrawMatch) {
    return parseCommand(`DW WITHDRAW ${withdrawMatch[2]} ${withdrawMatch[1]}`);
  }

  // "market buy 10 SUI" / "market sell 5 SUI"
  const marketBuyMatch = trimmed.match(/^market\s+buy\s+([\d.]+)\s*SUI$/i);
  if (marketBuyMatch) {
    return parseCommand(`DW MARKET_BUY SUI ${marketBuyMatch[1]}`);
  }
  const marketSellMatch = trimmed.match(/^market\s+sell\s+([\d.]+)\s*SUI$/i);
  if (marketSellMatch) {
    return parseCommand(`DW MARKET_SELL SUI ${marketSellMatch[1]}`);
  }

  // "buy 50 SUI" (no price → MARKET_BUY) — one-phrase trading intent
  const bareBuyMatch = trimmed.match(/^buy\s+([\d.]+)\s*SUI$/i);
  if (bareBuyMatch) {
    return parseCommand(`DW MARKET_BUY SUI ${bareBuyMatch[1]}`);
  }
  // "sell 50 SUI" (no price → MARKET_SELL) — one-phrase trading intent
  const bareSellMatch = trimmed.match(/^sell\s+([\d.]+)\s*SUI$/i);
  if (bareSellMatch) {
    return parseCommand(`DW MARKET_SELL SUI ${bareSellMatch[1]}`);
  }

  // "setup" or "/setup"
  if (lower === "setup" || lower === "/setup") {
    return parseCommand("DW /setup");
  }

  // "settle"
  if (lower === "settle") {
    return parseCommand("DW SETTLE");
  }

  // "status"
  if (lower === "status") {
    return parseCommand("DW STATUS");
  }

  // "cancel <orderId>"
  const cancelMatch = trimmed.match(/^cancel\s+([\w-]+)$/i);
  if (cancelMatch && !cancelMatch[1]!.startsWith("sched")) {
    return parseCommand(`DW CANCEL ${cancelMatch[1]}`);
  }

  // "cancel schedule sched_..."
  const cancelSchedMatch = trimmed.match(/^cancel\s+(?:schedule\s+)?(sched_\w+)$/i);
  if (cancelSchedMatch) {
    return parseCommand(`DW CANCEL_SCHEDULE ${cancelSchedMatch[1]}`);
  }

  // "stop loss 100 SUI at 0.80" / "stop-loss SUI 100 @ 0.80"
  const stopMatch = trimmed.match(/^stop[- ]?loss\s+(?:SUI\s+)?([\d.]+)\s*(?:SUI\s+)?(?:at|@)\s*([\d.]+)$/i);
  if (stopMatch) {
    return parseCommand(`DW STOP_LOSS SUI ${stopMatch[1]} @ ${stopMatch[2]}`);
  }

  // "take profit 100 SUI at 2.50" / "tp SUI 100 @ 2.50"
  const tpMatch = trimmed.match(/^(?:take[- ]?profit|tp)\s+(?:SUI\s+)?([\d.]+)\s*(?:SUI\s+)?(?:at|@)\s*([\d.]+)$/i);
  if (tpMatch) {
    return parseCommand(`DW TAKE_PROFIT SUI ${tpMatch[1]} @ ${tpMatch[2]}`);
  }

  // "sweep" / "sweep yield" / "collect"
  if (lower === "sweep" || lower === "sweep yield" || lower === "collect") {
    return parseCommand("DW SWEEP_YIELD");
  }

  // "trades" / "pnl" / "p&l" / "trade history"
  if (lower === "trades" || lower === "pnl" || lower === "p&l" || lower === "trade history") {
    return parseCommand("DW TRADE_HISTORY");
  }

  // "price" / "prices"
  if (lower === "price" || lower === "prices") {
    return parseCommand("DW PRICE");
  }

  // "cancel order ord_..." / "cancel stop loss sl_..." / "cancel take profit tp_..."
  const cancelOrdMatch = trimmed.match(/^cancel\s+(?:order\s+|stop[\s-]?loss\s+|take[\s-]?profit\s+)?((?:ord|sl|tp)_\w+)$/i);
  if (cancelOrdMatch) {
    return parseCommand(`DW CANCEL_ORDER ${cancelOrdMatch[1]}`);
  }

  // "treasury" / "unified balance" / "total balance"
  if (lower === "treasury" || lower === "unified balance" || lower === "total balance" || lower === "all balances") {
    return parseCommand("DW TREASURY");
  }

  // "rebalance 100 USDC from arc to sui" / "rebalance 50 from yellow to sui"
  const rebalMatch = trimmed.match(/^rebalance\s+([\d.]+)\s*(?:USDC\s+)?from\s+(\w+)\s+to\s+(\w+)$/i);
  if (rebalMatch) {
    return parseCommand(`DW REBALANCE ${rebalMatch[1]} FROM ${rebalMatch[2]} TO ${rebalMatch[3]}`);
  }

  return null;
}

export function parseCommand(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Empty command" };
  const norm = trimmed.replace(/\s+/g, " ");
  const parts = norm.split(" ");
  if (parts[0]?.toUpperCase() !== "DW") {
    // Try auto-detecting common patterns without DW prefix
    const autoDetected = tryAutoDetect(trimmed);
    if (autoDetected) return autoDetected;
    return { ok: false, error: "Commands must start with DW" };
  }
  const op = (parts[1] ?? "").toUpperCase();

  if (op === "/SETUP" || op === "SETUP") return { ok: true, value: { type: "SETUP" } };
  if (op === "STATUS") return { ok: true, value: { type: "STATUS" } };
  if (op === "SESSION_CREATE") return { ok: true, value: { type: "SESSION_CREATE" } };
  if (op === "CONNECT") {
    const wcUri = parts.slice(2).join(" ").trim();
    if (!wcUri) return { ok: false, error: "CONNECT expects a WalletConnect URI" };
    return { ok: true, value: { type: "CONNECT", wcUri } };
  }
  if (op === "TX") {
    const json = parts.slice(2).join(" ").trim();
    if (!json) return { ok: false, error: "TX expects JSON payload" };
    try {
      const parsed = WalletConnectTxSchema.safeParse(JSON.parse(json));
      if (!parsed.success) return { ok: false, error: "Invalid TX payload" };
      return { ok: true, value: { type: "WC_TX", ...parsed.data } };
    } catch {
      return { ok: false, error: "TX expects valid JSON" };
    }
  }
  if (op === "SIGN") {
    const json = parts.slice(2).join(" ").trim();
    if (!json) return { ok: false, error: "SIGN expects JSON payload" };
    try {
      const obj = JSON.parse(json);
      const parsed = ParsedCommandSchema.safeParse({ type: "WC_SIGN", address: obj?.address, message: obj?.message });
      if (!parsed.success) return { ok: false, error: "Invalid SIGN payload" };
      return { ok: true, value: parsed.data };
    } catch {
      return { ok: false, error: "SIGN expects valid JSON" };
    }
  }
  if (op === "QUORUM") {
    const qStr = parts[2] ?? "";
    const quorum = parseNumber(qStr);
    if (quorum === null || quorum <= 0 || Math.floor(quorum) !== quorum) return { ok: false, error: "Invalid quorum" };
    return { ok: true, value: { type: "QUORUM", quorum } };
  }
  if (op === "SIGNER_ADD") {
    // DW SIGNER_ADD 0xADDR WEIGHT 2
    const address = parts[2] ?? "";
    const weightKw = (parts[3] ?? "").toUpperCase();
    const weightStr = parts[4] ?? "";
    if (weightKw !== "WEIGHT") return { ok: false, error: "SIGNER_ADD expects WEIGHT <n>" };
    const weight = parseNumber(weightStr);
    if (weight === null || weight <= 0 || Math.floor(weight) !== weight) return { ok: false, error: "Invalid signer weight" };
    const parsed = ParsedCommandSchema.safeParse({ type: "SIGNER_ADD", address, weight });
    if (!parsed.success) return { ok: false, error: "Invalid signer address" };
    return { ok: true, value: parsed.data };
  }
  if (op === "SETTLE") return { ok: true, value: { type: "SETTLE" } };

  if (op === "LIMIT_BUY" || op === "LIMIT_SELL") {
    // DW LIMIT_BUY SUI 50 USDC @ 1.02
    const base = (parts[2] ?? "").toUpperCase();
    const qtyStr = parts[3] ?? "";
    const quote = (parts[4] ?? "").toUpperCase();
    const at = parts[5] ?? "";
    const priceStr = parts[6] ?? "";

    if (base !== "SUI" || (quote !== "USDC" && quote !== "DBUSDC")) {
      return { ok: false, error: "Only SUI/USDC supported in MVP (DeepBook testnet uses DBUSDC)" };
    }
    if (at !== "@") return { ok: false, error: "Expected '@' before price" };

    const qty = parseNumber(qtyStr);
    const price = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (price === null || price <= 0) return { ok: false, error: "Invalid price" };

    const value: ParsedCommand =
      op === "LIMIT_BUY"
        ? { type: "LIMIT_BUY", base: "SUI", quote: "USDC", qty, price }
        : { type: "LIMIT_SELL", base: "SUI", quote: "USDC", qty, price };
    return { ok: true, value };
  }

  if (op === "CANCEL") {
    const orderId = parts[2];
    if (!orderId) return { ok: false, error: "Missing order id" };
    return { ok: true, value: { type: "CANCEL", orderId } };
  }

  if (op === "PAYOUT") {
    // DW PAYOUT 1 USDC TO 0x...  OR  DW PAYOUT 0.5 SUI TO 0x...
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    const toKw = (parts[4] ?? "").toUpperCase();
    const to = parts[5] ?? "";
    if (unit !== "USDC" && unit !== "SUI") return { ok: false, error: "PAYOUT expects USDC or SUI" };
    if (toKw !== "TO") return { ok: false, error: "PAYOUT expects TO <address>" };
    const amount = parseNumber(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid payout amount" };
    if (unit === "SUI") {
      const parsed = ParsedCommandSchema.safeParse({ type: "PAYOUT_SUI", amountSui: amount, to });
      if (!parsed.success) return { ok: false, error: "Invalid payout address" };
      return { ok: true, value: parsed.data };
    }
    const parsed = ParsedCommandSchema.safeParse({ type: "PAYOUT", amountUsdc: amount, to });
    if (!parsed.success) return { ok: false, error: "Invalid payout address" };
    return { ok: true, value: parsed.data };
  }

  if (op === "PAYOUT_SPLIT") {
    // DW PAYOUT_SPLIT 10 USDC TO 0xA:50,0xB:50
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    const toKw = (parts[4] ?? "").toUpperCase();
    const spec = parts.slice(5).join(" ").trim();
    if (unit !== "USDC") return { ok: false, error: "PAYOUT_SPLIT expects USDC" };
    if (toKw !== "TO") return { ok: false, error: "PAYOUT_SPLIT expects TO <addr:pct,...>" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid payout amount" };
    if (!spec) return { ok: false, error: "Missing split recipients" };

    const recipients: Array<{ to: string; pct: number }> = [];
    for (const part of spec.split(",")) {
      const [addr, pctStr] = part.trim().split(":");
      if (!addr || !pctStr) return { ok: false, error: "Split recipients must be <address>:<pct>" };
      const pct = parseNumber(pctStr);
      if (pct === null || pct <= 0) return { ok: false, error: "Invalid split pct" };
      recipients.push({ to: addr.trim(), pct });
    }
    const pctSum = recipients.reduce((a, r) => a + r.pct, 0);
    if (Math.abs(pctSum - 100) > 0.0001) return { ok: false, error: "Split pct must sum to 100" };

    const parsed = ParsedCommandSchema.safeParse({ type: "PAYOUT_SPLIT", amountUsdc, recipients });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid split payout" };
    return { ok: true, value: parsed.data };
  }

  if (op === "SCHEDULE") {
    // DW SCHEDULE EVERY 4h: LIMIT_BUY SUI 10 USDC @ 1.02
    // DW SCHEDULE EVERY 24h: PAYOUT 5 USDC TO 0x...
    const rest = parts.slice(2).join(" ").trim();
    const everyMatch = rest.match(/^EVERY\s+(\d+(?:\.\d+)?)\s*h\s*:\s*(.+)$/i);
    if (!everyMatch) return { ok: false, error: "SCHEDULE expects: EVERY <N>h: <DW command>" };
    const intervalHours = parseNumber(everyMatch[1]!);
    if (intervalHours === null || intervalHours <= 0) return { ok: false, error: "Invalid interval hours" };
    const innerRaw = everyMatch[2]!.trim();
    const innerCommand = innerRaw.toUpperCase().startsWith("DW ") ? innerRaw : `DW ${innerRaw}`;
    // Validate the inner command is parseable
    const innerParsed = parseCommand(innerCommand);
    if (!innerParsed.ok) return { ok: false, error: `Invalid inner command: ${innerParsed.error}` };
    // Don't allow nesting schedules
    if (innerParsed.value.type === "SCHEDULE" || innerParsed.value.type === "CANCEL_SCHEDULE") {
      return { ok: false, error: "Cannot nest schedules" };
    }
    return { ok: true, value: { type: "SCHEDULE", intervalHours, innerCommand } };
  }

  if (op === "UNSCHEDULE") {
    const scheduleId = parts[2];
    if (!scheduleId) return { ok: false, error: "Missing schedule id" };
    return { ok: true, value: { type: "CANCEL_SCHEDULE", scheduleId } };
  }

  if (op === "CANCEL_SCHEDULE") {
    const scheduleId = parts[2];
    if (!scheduleId) return { ok: false, error: "Missing schedule id" };
    return { ok: true, value: { type: "CANCEL_SCHEDULE", scheduleId } };
  }

  if (op === "BRIDGE") {
    // DW BRIDGE 100 USDC FROM arc TO sui
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    const fromKw = (parts[4] ?? "").toUpperCase();
    const fromChain = (parts[5] ?? "").toLowerCase();
    const toKw = (parts[6] ?? "").toUpperCase();
    const toChain = (parts[7] ?? "").toLowerCase();
    if (unit !== "USDC") return { ok: false, error: "BRIDGE only supports USDC" };
    if (fromKw !== "FROM") return { ok: false, error: "BRIDGE expects FROM <chain>" };
    if (toKw !== "TO") return { ok: false, error: "BRIDGE expects TO <chain>" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid bridge amount" };
    const validChains = ["arc", "sui", "ethereum", "arbitrum", "polygon"];
    if (!validChains.includes(fromChain)) return { ok: false, error: `Invalid source chain: ${fromChain}` };
    if (!validChains.includes(toChain)) return { ok: false, error: `Invalid destination chain: ${toChain}` };
    if (fromChain === toChain) return { ok: false, error: "Source and destination chains must differ" };
    return { ok: true, value: { type: "BRIDGE", amountUsdc, fromChain, toChain } };
  }

  if (op === "SESSION_CLOSE") return { ok: true, value: { type: "SESSION_CLOSE" } };
  if (op === "SESSION_STATUS") return { ok: true, value: { type: "SESSION_STATUS" } };

  if (op === "DEPOSIT") {
    // DW DEPOSIT SUI 10  or  DW DEPOSIT USDC 50
    const coinType = (parts[2] ?? "").toUpperCase();
    const amountStr = parts[3] ?? "";
    if (!coinType) return { ok: false, error: "DEPOSIT expects <coinType> <amount>" };
    const amount = parseNumber(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid deposit amount" };
    return { ok: true, value: { type: "DEPOSIT", coinType, amount } };
  }

  if (op === "WITHDRAW") {
    // DW WITHDRAW SUI 10  or  DW WITHDRAW USDC 50
    const coinType = (parts[2] ?? "").toUpperCase();
    const amountStr = parts[3] ?? "";
    if (!coinType) return { ok: false, error: "WITHDRAW expects <coinType> <amount>" };
    const amount = parseNumber(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid withdraw amount" };
    return { ok: true, value: { type: "WITHDRAW", coinType, amount } };
  }

  if (op === "MARKET_BUY") {
    // DW MARKET_BUY SUI 10  (buy 10 SUI at market price)
    const base = (parts[2] ?? "").toUpperCase();
    const qtyStr = parts[3] ?? "";
    if (base !== "SUI") return { ok: false, error: "Only SUI/USDC supported for MARKET_BUY" };
    const qty = parseNumber(qtyStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    return { ok: true, value: { type: "MARKET_BUY", base: "SUI", quote: "USDC", qty } };
  }

  if (op === "MARKET_SELL") {
    // DW MARKET_SELL SUI 10  (sell 10 SUI at market price)
    const base = (parts[2] ?? "").toUpperCase();
    const qtyStr = parts[3] ?? "";
    if (base !== "SUI") return { ok: false, error: "Only SUI/USDC supported for MARKET_SELL" };
    const qty = parseNumber(qtyStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    return { ok: true, value: { type: "MARKET_SELL", base: "SUI", quote: "USDC", qty } };
  }

  if (op === "ALERT") {
    // DW ALERT USDC BELOW 500
    const coinType = (parts[2] ?? "").toUpperCase();
    const belowKw = (parts[3] ?? "").toUpperCase();
    const belowStr = parts[4] ?? "";
    if (!coinType) return { ok: false, error: "ALERT expects <coinType> BELOW <amount>" };
    if (belowKw !== "BELOW") return { ok: false, error: "ALERT expects BELOW <amount>" };
    const below = parseNumber(belowStr);
    if (below === null || below < 0) return { ok: false, error: "Invalid threshold amount" };
    return { ok: true, value: { type: "ALERT_THRESHOLD", coinType, below } };
  }

  if (op === "ALERT_THRESHOLD") {
    // DW ALERT_THRESHOLD SUI 0.5  (alert when SUI balance drops below 0.5)
    const coinType = (parts[2] ?? "").toUpperCase();
    const belowStr = parts[3] ?? "";
    if (!coinType) return { ok: false, error: "ALERT_THRESHOLD expects <coinType> <below>" };
    const below = parseNumber(belowStr);
    if (below === null || below < 0) return { ok: false, error: "Invalid threshold amount" };
    return { ok: true, value: { type: "ALERT_THRESHOLD", coinType, below } };
  }

  if (op === "AUTO_REBALANCE") {
    // DW AUTO_REBALANCE ON  or  DW AUTO_REBALANCE OFF
    const toggle = (parts[2] ?? "").toUpperCase();
    if (toggle !== "ON" && toggle !== "OFF") return { ok: false, error: "AUTO_REBALANCE expects ON or OFF" };
    return { ok: true, value: { type: "AUTO_REBALANCE", enabled: toggle === "ON" } };
  }

  if (op === "YELLOW_SEND") {
    // DW YELLOW_SEND 5 USDC TO 0x...  (also accepts ytest.usd or any stablecoin label)
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    const toKw = (parts[4] ?? "").toUpperCase();
    const to = parts[5] ?? "";
    const acceptableUnits = ["USDC", "YTEST.USD", "USD"];
    if (!acceptableUnits.includes(unit)) return { ok: false, error: "YELLOW_SEND supports USDC/ytest.usd" };
    if (toKw !== "TO") return { ok: false, error: "YELLOW_SEND expects TO <address>" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid amount" };
    const parsed = ParsedCommandSchema.safeParse({ type: "YELLOW_SEND", amountUsdc, to });
    if (!parsed.success) return { ok: false, error: "Invalid address" };
    return { ok: true, value: parsed.data };
  }

  if (op === "YELLOW_DEPOSIT") {
    // DW YELLOW_DEPOSIT 50 USDC  — Lock USDC into state channel
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    if (unit && !["USDC", "YTEST.USD", "USD"].includes(unit)) return { ok: false, error: "YELLOW_DEPOSIT supports USDC" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid deposit amount" };
    return { ok: true, value: { type: "YELLOW_DEPOSIT", amountUsdc } };
  }

  if (op === "YELLOW_WITHDRAW") {
    // DW YELLOW_WITHDRAW 25 USDC  — Withdraw from channel to on-chain
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    if (unit && !["USDC", "YTEST.USD", "USD"].includes(unit)) return { ok: false, error: "YELLOW_WITHDRAW supports USDC" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid withdraw amount" };
    return { ok: true, value: { type: "YELLOW_WITHDRAW", amountUsdc } };
  }

  if (op === "YELLOW_BALANCE") {
    // DW YELLOW_BALANCE — Show channel vs on-chain balances + gas savings
    return { ok: true, value: { type: "YELLOW_BALANCE" } };
  }

  if (op === "YELLOW_SWAP") {
    // DW YELLOW_SWAP 10 USDC TO ETH  — Off-chain atomic swap within channel
    const amountStr = parts[2] ?? "";
    const fromAsset = (parts[3] ?? "").toUpperCase();
    const toKw = (parts[4] ?? "").toUpperCase();
    const toAsset = (parts[5] ?? "").toUpperCase();
    if (toKw !== "TO") return { ok: false, error: "YELLOW_SWAP expects: <amount> <from_asset> TO <to_asset>" };
    const amountFrom = parseNumber(amountStr);
    if (amountFrom === null || amountFrom <= 0) return { ok: false, error: "Invalid swap amount" };
    if (!fromAsset || !toAsset) return { ok: false, error: "Specify both source and destination assets" };
    return { ok: true, value: { type: "YELLOW_SWAP", amountFrom, fromAsset, toAsset } };
  }

  if (op === "CHANNEL_RESIZE") {
    // DW CHANNEL_RESIZE 500  — Resize state channel capacity
    const newCapStr = parts[2] ?? "";
    const newCapacity = parseNumber(newCapStr);
    if (newCapacity === null || newCapacity <= 0) return { ok: false, error: "CHANNEL_RESIZE expects <new_capacity>" };
    return { ok: true, value: { type: "CHANNEL_RESIZE", newCapacity } };
  }

  if (op === "CHANNEL_HISTORY") {
    // DW CHANNEL_HISTORY — Show state transition audit trail
    return { ok: true, value: { type: "CHANNEL_HISTORY" } };
  }

  if (op === "STOP_LOSS") {
    // DW STOP_LOSS SUI 100 @ 0.80
    const base = (parts[2] ?? "").toUpperCase();
    const qtyStr = parts[3] ?? "";
    const at = parts[4] ?? "";
    const priceStr = parts[5] ?? "";
    if (base !== "SUI") return { ok: false, error: "STOP_LOSS only supports SUI" };
    if (at !== "@") return { ok: false, error: "STOP_LOSS expects @ <trigger_price>" };
    const qty = parseNumber(qtyStr);
    const triggerPrice = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (triggerPrice === null || triggerPrice <= 0) return { ok: false, error: "Invalid trigger price" };
    return { ok: true, value: { type: "STOP_LOSS", base: "SUI", quote: "USDC", qty, triggerPrice } };
  }

  if (op === "TAKE_PROFIT") {
    // DW TAKE_PROFIT SUI 100 @ 2.50
    const base = (parts[2] ?? "").toUpperCase();
    const qtyStr = parts[3] ?? "";
    const at = parts[4] ?? "";
    const priceStr = parts[5] ?? "";
    if (base !== "SUI") return { ok: false, error: "TAKE_PROFIT only supports SUI" };
    if (at !== "@") return { ok: false, error: "TAKE_PROFIT expects @ <trigger_price>" };
    const qty = parseNumber(qtyStr);
    const triggerPrice = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (triggerPrice === null || triggerPrice <= 0) return { ok: false, error: "Invalid trigger price" };
    return { ok: true, value: { type: "TAKE_PROFIT", base: "SUI", quote: "USDC", qty, triggerPrice } };
  }

  if (op === "SWEEP_YIELD" || op === "SWEEP") {
    return { ok: true, value: { type: "SWEEP_YIELD" } };
  }

  if (op === "TRADE_HISTORY" || op === "TRADES" || op === "PNL" || op === "P&L") {
    return { ok: true, value: { type: "TRADE_HISTORY" } };
  }

  if (op === "PRICE" || op === "PRICES") {
    return { ok: true, value: { type: "PRICE" } };
  }

  if (op === "CANCEL_ORDER") {
    const orderId = parts[2];
    if (!orderId) return { ok: false, error: "CANCEL_ORDER expects <orderId>" };
    return { ok: true, value: { type: "CANCEL_ORDER", orderId } };
  }

  if (op === "TREASURY") {
    return { ok: true, value: { type: "TREASURY" } };
  }

  if (op === "REBALANCE") {
    // DW REBALANCE 100 FROM arc TO sui
    const amountStr = parts[2] ?? "";
    const fromKw = (parts[3] ?? "").toUpperCase();
    const fromChain = (parts[4] ?? "").toLowerCase();
    const toKw = (parts[5] ?? "").toUpperCase();
    const toChain = (parts[6] ?? "").toLowerCase();
    if (fromKw !== "FROM") return { ok: false, error: "REBALANCE expects FROM <chain>" };
    if (toKw !== "TO") return { ok: false, error: "REBALANCE expects TO <chain>" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid rebalance amount" };
    const validChains = ["arc", "sui", "yellow"];
    if (!validChains.includes(fromChain)) return { ok: false, error: `Invalid source chain: ${fromChain}. Use: arc, sui, yellow` };
    if (!validChains.includes(toChain)) return { ok: false, error: `Invalid destination chain: ${toChain}. Use: arc, sui, yellow` };
    if (fromChain === toChain) return { ok: false, error: "Source and destination chains must differ" };
    return { ok: true, value: { type: "REBALANCE", fromChain, toChain, amountUsdc } };
  }

  return { ok: false, error: `Unknown command: ${op}` };
}
