import { z } from "zod";

export type ParsedCommand =
  | { type: "SETUP" }
  | { type: "STATUS" }
  | { type: "TREASURY" }
  | { type: "SCHEDULE"; intervalHours: number; innerCommand: string }
  | { type: "CANCEL_SCHEDULE"; scheduleId: string }
  | { type: "ALERT_THRESHOLD"; coinType: string; below: number }
  | { type: "AUTO_REBALANCE"; enabled: boolean }
  | { type: "CANCEL_ORDER"; orderId: string }
  | { type: "BCH_SEND"; to: string; amountSats: number }
  | { type: "BCH_TOKEN_ISSUE"; ticker: string; name: string; supply: string }
  | { type: "BCH_TOKEN_SEND"; to: string; tokenCategory: string; tokenAmount: string }
  | { type: "BCH_TOKEN_BALANCE" }
  | { type: "BCH_PRICE" }
  | { type: "BCH_STOP_LOSS"; qty: number; triggerPrice: number }
  | { type: "BCH_TAKE_PROFIT"; qty: number; triggerPrice: number }
  | { type: "NFT_MINT"; ticker: string; name: string; uri: string; to: string; amount: number }
  | { type: "NFT_SEND"; to: string; tokenCategory: string; tokenId: string; amount: number }
  | { type: "NFT_BALANCE" }
  | { type: "NFT_MARKET_LIST"; tokenId: string; priceBch: number }
  | { type: "NFT_MARKET_BUY"; listingId: string }
  | { type: "BCH_MULTISIG_CREATE"; threshold: number; pubkeys: string[] }
  | { type: "BCH_MULTISIG_SEND"; to: string; amountSats: number }
  | { type: "BCH_MULTISIG_BALANCE" }
  | { type: "CASH_VAULT_CREATE"; beneficiary: string; unlockTime: number; amountSats: number }
  | { type: "CASH_VAULT_CLAIM"; vaultAddress: string }
  | { type: "CASH_VAULT_RECLAIM"; vaultAddress: string }
  | { type: "CASH_VAULT_STATUS"; vaultAddress: string }
  | { type: "PAYMENT_REQUEST"; amountBch: number; description: string }
  | { type: "PAYMENT_CHECK"; requestId: string }
  | { type: "PAYMENT_QR"; requestId: string }
  | { type: "BRIDGE_TO_BCH"; fromChain: string; amount: number }
  | { type: "BRIDGE_FROM_BCH"; toChain: string; amountSats: number; destAddr: string };

export const ParsedCommandSchema: z.ZodType<ParsedCommand, z.ZodTypeDef, unknown> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SETUP") }),
  z.object({ type: z.literal("STATUS") }),
  z.object({ type: z.literal("TREASURY") }),
  z.object({
    type: z.literal("SCHEDULE"),
    intervalHours: z.number().positive(),
    innerCommand: z.string().min(1)
  }),
  z.object({ type: z.literal("CANCEL_SCHEDULE"), scheduleId: z.string().min(1) }),
  z.object({ type: z.literal("ALERT_THRESHOLD"), coinType: z.string().min(1), below: z.number().nonnegative() }),
  z.object({ type: z.literal("AUTO_REBALANCE"), enabled: z.boolean() }),
  z.object({ type: z.literal("CANCEL_ORDER"), orderId: z.string().min(1) }),
  z.object({
    type: z.literal("BCH_SEND"),
    to: z.string().min(1),
    amountSats: z.number().int().positive()
  }),
  z.object({
    type: z.literal("BCH_TOKEN_ISSUE"),
    ticker: z.string().min(1),
    name: z.string().min(1),
    supply: z.string().min(1)
  }),
  z.object({
    type: z.literal("BCH_TOKEN_SEND"),
    to: z.string().min(1),
    tokenCategory: z.string().min(1),
    tokenAmount: z.string().min(1)
  }),
  z.object({ type: z.literal("BCH_TOKEN_BALANCE") }),
  z.object({ type: z.literal("BCH_PRICE") }),
  z.object({ type: z.literal("BCH_STOP_LOSS"), qty: z.number().positive(), triggerPrice: z.number().positive() }),
  z.object({ type: z.literal("BCH_TAKE_PROFIT"), qty: z.number().positive(), triggerPrice: z.number().positive() }),
  z.object({
    type: z.literal("NFT_MINT"),
    ticker: z.string().min(1),
    name: z.string().min(1),
    uri: z.string().min(1),
    to: z.string().min(1),
    amount: z.number().int().positive()
  }),
  z.object({
    type: z.literal("NFT_SEND"),
    to: z.string().min(1),
    tokenCategory: z.string().min(1),
    tokenId: z.string().min(1),
    amount: z.number().int().positive()
  }),
  z.object({ type: z.literal("NFT_BALANCE") }),
  z.object({ type: z.literal("NFT_MARKET_LIST"), tokenId: z.string().min(1), priceBch: z.number().positive() }),
  z.object({ type: z.literal("NFT_MARKET_BUY"), listingId: z.string().min(1) }),
  z.object({
    type: z.literal("BCH_MULTISIG_CREATE"),
    threshold: z.number().int().min(1).max(5),
    pubkeys: z.array(z.string()).min(2).max(10)
  }),
  z.object({ type: z.literal("BCH_MULTISIG_SEND"), to: z.string().min(1), amountSats: z.number().int().positive() }),
  z.object({ type: z.literal("BCH_MULTISIG_BALANCE") }),
  z.object({
    type: z.literal("CASH_VAULT_CREATE"),
    beneficiary: z.string().min(1),
    unlockTime: z.number().int().positive(),
    amountSats: z.number().int().positive()
  }),
  z.object({ type: z.literal("CASH_VAULT_CLAIM"), vaultAddress: z.string().min(1) }),
  z.object({ type: z.literal("CASH_VAULT_RECLAIM"), vaultAddress: z.string().min(1) }),
  z.object({ type: z.literal("CASH_VAULT_STATUS"), vaultAddress: z.string().min(1) }),
  z.object({ type: z.literal("PAYMENT_REQUEST"), amountBch: z.number().positive(), description: z.string().min(1) }),
  z.object({ type: z.literal("PAYMENT_CHECK"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("PAYMENT_QR"), requestId: z.string().min(1) }),
  z.object({ type: z.literal("BRIDGE_TO_BCH"), fromChain: z.string().min(1), amount: z.number().positive() }),
  z.object({
    type: z.literal("BRIDGE_FROM_BCH"),
    toChain: z.string().min(1),
    amountSats: z.number().int().positive(),
    destAddr: z.string().min(1)
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

function parseIntSafe(v: string): number | null {
  const n = parseNumber(v);
  if (n === null || Math.floor(n) !== n) return null;
  return n;
}

const CASHADDR_RE = /^(?:bitcoincash|bchtest):[a-z0-9]+$/i;

function toNormalizedCashAddr(input: string): string | null {
  const trimmed = input.trim();
  if (!CASHADDR_RE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Try to auto-detect common command patterns without the DW prefix.
 * Returns a ParseResult if detected, null otherwise.
 */
export function tryAutoDetect(raw: string): ParseResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();

  if (lower === "setup" || lower === "/setup") return parseCommand("DW SETUP");
  if (lower === "status" || lower === "help" || lower === "?") return parseCommand("DW STATUS");

  if (
    lower === "treasury" ||
    lower === "unified balance" ||
    lower === "total balance" ||
    lower === "all balances" ||
    lower === "check balance" ||
    lower === "my balance" ||
    lower === "show balance" ||
    /^what'?s?\s+my\s+balance/.test(lower)
  ) {
    return parseCommand("DW TREASURY");
  }

  if (lower === "bch price" || lower === "bitcoin cash price" || lower === "bch/usd") {
    return parseCommand("DW BCH_PRICE");
  }

  if (lower === "bch balance" || lower === "token balance" || lower === "my tokens" || lower === "cashtokens" || lower === "bch tokens") {
    return parseCommand("DW BCH_TOKEN_BALANCE");
  }

  const bchSendSatsMatch = trimmed.match(/^(?:send|pay)\s+([\d]+)\s*sats?\s+to\s+((?:bitcoincash|bchtest):[a-z0-9]+)$/i);
  if (bchSendSatsMatch) {
    return parseCommand(`DW BCH_SEND ${bchSendSatsMatch[2]} ${bchSendSatsMatch[1]}`);
  }

  const bchSendBchMatch = trimmed.match(/^(?:send|pay)\s+([\d.]+)\s*BCH\s+to\s+((?:bitcoincash|bchtest):[a-z0-9]+)$/i);
  if (bchSendBchMatch) {
    const amountBch = parseNumber(bchSendBchMatch[1]!);
    if (amountBch === null || amountBch <= 0) return { ok: false, error: "Invalid BCH amount" };
    const sats = Math.round(amountBch * 1e8);
    return parseCommand(`DW BCH_SEND ${bchSendBchMatch[2]} ${sats}`);
  }

  const issueMatch = trimmed.match(/^(?:issue|create|mint)\s+token\s+([A-Za-z0-9_\-]+)\s+(\S+)\s+([\d]+)$/i);
  if (issueMatch) {
    return parseCommand(`DW BCH_TOKEN_ISSUE ${issueMatch[1]} ${issueMatch[2]} ${issueMatch[3]}`);
  }

  const tokenSendMatch = trimmed.match(/^(?:send|transfer)\s+([\d]+)\s+([A-Za-z0-9_\-]+)\s+to\s+((?:bitcoincash|bchtest):[a-z0-9]+)$/i);
  if (tokenSendMatch) {
    const symbol = tokenSendMatch[2]!.toUpperCase();
    if (symbol !== "BCH" && symbol !== "SATS") {
      return parseCommand(`DW BCH_TOKEN_SEND ${tokenSendMatch[3]} ${symbol} ${tokenSendMatch[1]}`);
    }
  }

  const stopLossMatch = trimmed.match(/^(?:stop[- ]?loss|sl)\s+([\d.]+)\s*(?:BCH\s*)?(?:at|@)\s*([\d.]+)$/i);
  if (stopLossMatch) {
    return parseCommand(`DW BCH_STOP_LOSS ${stopLossMatch[1]} @ ${stopLossMatch[2]}`);
  }

  const takeProfitMatch = trimmed.match(/^(?:take[- ]?profit|tp)\s+([\d.]+)\s*(?:BCH\s*)?(?:at|@)\s*([\d.]+)$/i);
  if (takeProfitMatch) {
    return parseCommand(`DW BCH_TAKE_PROFIT ${takeProfitMatch[1]} @ ${takeProfitMatch[2]}`);
  }

  const cancelOrderMatch = trimmed.match(/^cancel\s+(?:order\s+)?((?:ord|bch_sl|bch_tp)_[\w-]+)$/i);
  if (cancelOrderMatch) {
    return parseCommand(`DW CANCEL_ORDER ${cancelOrderMatch[1]}`);
  }

  const cancelSchedMatch = trimmed.match(/^cancel\s+(?:schedule\s+)?(sched_[\w-]+)$/i);
  if (cancelSchedMatch) {
    return parseCommand(`DW CANCEL_SCHEDULE ${cancelSchedMatch[1]}`);
  }

  const budgetMatch = trimmed.match(/^set\s+(?:budget|limit|spending)\s+\$?([\d.]+)\s*(?:BCH\s+)?per\s+day$/i);
  if (budgetMatch) {
    return parseCommand(`DW ALERT_THRESHOLD BCH ${budgetMatch[1]}`);
  }

  return null;
}

export function parseCommand(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Empty command" };

  const norm = trimmed.replace(/\s+/g, " ");
  const parts = norm.split(" ");

  if (parts[0]?.toUpperCase() !== "DW") {
    const autoDetected = tryAutoDetect(trimmed);
    if (autoDetected) return autoDetected;
    return { ok: false, error: "Commands must start with DW" };
  }

  const op = (parts[1] ?? "").toUpperCase();

  if (op === "/SETUP" || op === "SETUP") return { ok: true, value: { type: "SETUP" } };
  if (op === "STATUS") return { ok: true, value: { type: "STATUS" } };
  if (op === "TREASURY") return { ok: true, value: { type: "TREASURY" } };

  if (op === "SCHEDULE") {
    const rest = parts.slice(2).join(" ").trim();
    const everyMatch = rest.match(/^EVERY\s+(\d+(?:\.\d+)?)\s*h\s*:\s*(.+)$/i);
    if (!everyMatch) return { ok: false, error: "SCHEDULE expects: EVERY <N>h: <DW command>" };

    const intervalHours = parseNumber(everyMatch[1]!);
    if (intervalHours === null || intervalHours <= 0) return { ok: false, error: "Invalid interval hours" };

    const innerRaw = everyMatch[2]!.trim();
    const innerCommand = innerRaw.toUpperCase().startsWith("DW ") ? innerRaw : `DW ${innerRaw}`;
    const innerParsed = parseCommand(innerCommand);
    if (!innerParsed.ok) return { ok: false, error: `Invalid inner command: ${innerParsed.error}` };
    if (innerParsed.value.type === "SCHEDULE" || innerParsed.value.type === "CANCEL_SCHEDULE") {
      return { ok: false, error: "Cannot nest schedules" };
    }

    return { ok: true, value: { type: "SCHEDULE", intervalHours, innerCommand } };
  }

  if (op === "CANCEL_SCHEDULE" || op === "UNSCHEDULE") {
    const scheduleId = parts[2] ?? "";
    if (!scheduleId) return { ok: false, error: "Missing schedule id" };
    return { ok: true, value: { type: "CANCEL_SCHEDULE", scheduleId } };
  }

  if (op === "ALERT") {
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
    const coinType = (parts[2] ?? "").toUpperCase();
    const belowStr = parts[3] ?? "";
    if (!coinType) return { ok: false, error: "ALERT_THRESHOLD expects <coinType> <below>" };
    const below = parseNumber(belowStr);
    if (below === null || below < 0) return { ok: false, error: "Invalid threshold amount" };
    return { ok: true, value: { type: "ALERT_THRESHOLD", coinType, below } };
  }

  if (op === "AUTO_REBALANCE") {
    const toggle = (parts[2] ?? "").toUpperCase();
    if (toggle !== "ON" && toggle !== "OFF") return { ok: false, error: "AUTO_REBALANCE expects ON or OFF" };
    return { ok: true, value: { type: "AUTO_REBALANCE", enabled: toggle === "ON" } };
  }

  if (op === "CANCEL_ORDER") {
    const orderId = parts[2] ?? "";
    if (!orderId) return { ok: false, error: "CANCEL_ORDER expects <orderId>" };
    return { ok: true, value: { type: "CANCEL_ORDER", orderId } };
  }

  if (op === "BCH_PRICE") return { ok: true, value: { type: "BCH_PRICE" } };

  if (op === "BCH_SEND") {
    const to = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    const amountSats = parseIntSafe(amountStr);

    if (!to) return { ok: false, error: "BCH_SEND expects <address> <amountSats>" };
    if (!toNormalizedCashAddr(to)) return { ok: false, error: "Invalid BCH cashaddr" };
    if (amountSats === null || amountSats <= 0) return { ok: false, error: "Invalid amount (sats)" };

    return { ok: true, value: { type: "BCH_SEND", to, amountSats } };
  }

  if (op === "BCH_TOKEN_ISSUE") {
    const ticker = (parts[2] ?? "").toUpperCase();
    const name = parts[3] ?? "";
    const supply = parts[4] ?? "";
    if (!ticker || !name || !supply) return { ok: false, error: "BCH_TOKEN_ISSUE expects <ticker> <name> <supply>" };

    const supplyNum = parseIntSafe(supply);
    if (supplyNum === null || supplyNum <= 0) return { ok: false, error: "Invalid supply" };

    return { ok: true, value: { type: "BCH_TOKEN_ISSUE", ticker, name, supply } };
  }

  if (op === "BCH_TOKEN_SEND") {
    const to = parts[2] ?? "";
    const tokenCategory = parts[3] ?? "";
    const tokenAmount = parts[4] ?? "";
    if (!to || !tokenCategory || !tokenAmount) {
      return { ok: false, error: "BCH_TOKEN_SEND expects <address> <tokenCategory|ticker> <amount>" };
    }
    if (!toNormalizedCashAddr(to)) return { ok: false, error: "Invalid BCH cashaddr" };

    const amountNum = parseIntSafe(tokenAmount);
    if (amountNum === null || amountNum <= 0) return { ok: false, error: "Invalid token amount" };

    return { ok: true, value: { type: "BCH_TOKEN_SEND", to, tokenCategory, tokenAmount } };
  }

  if (op === "BCH_TOKEN_BALANCE" || op === "BCH_TOKENS") {
    return { ok: true, value: { type: "BCH_TOKEN_BALANCE" } };
  }

  if (op === "BCH_STOP_LOSS") {
    const qtyStr = parts[2] ?? "";
    const at = parts[3] ?? "";
    const priceStr = parts[4] ?? "";
    if (at !== "@") return { ok: false, error: "BCH_STOP_LOSS expects <qty> @ <trigger_price>" };
    const qty = parseNumber(qtyStr);
    const triggerPrice = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (triggerPrice === null || triggerPrice <= 0) return { ok: false, error: "Invalid trigger price" };
    return { ok: true, value: { type: "BCH_STOP_LOSS", qty, triggerPrice } };
  }

  if (op === "BCH_TAKE_PROFIT") {
    const qtyStr = parts[2] ?? "";
    const at = parts[3] ?? "";
    const priceStr = parts[4] ?? "";
    if (at !== "@") return { ok: false, error: "BCH_TAKE_PROFIT expects <qty> @ <trigger_price>" };
    const qty = parseNumber(qtyStr);
    const triggerPrice = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (triggerPrice === null || triggerPrice <= 0) return { ok: false, error: "Invalid trigger price" };
    return { ok: true, value: { type: "BCH_TAKE_PROFIT", qty, triggerPrice } };
  }

  if (op === "NFT_MINT") {
    const ticker = (parts[2] ?? "").toUpperCase();
    const name = parts[3] ?? "";
    const uri = parts[4] ?? "";
    const to = parts[5] ?? "";
    const amountStr = parts[6] ?? "1";
    if (!ticker || !name || !uri || !to) return { ok: false, error: "NFT_MINT expects <ticker> <name> <uri> <to> <amount>" };
    const amount = parseIntSafe(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid NFT amount" };
    return { ok: true, value: { type: "NFT_MINT", ticker, name, uri, to, amount } };
  }

  if (op === "NFT_SEND") {
    const to = parts[2] ?? "";
    const tokenCategory = parts[3] ?? "";
    const tokenId = parts[4] ?? "1";
    const amountStr = parts[5] ?? "1";
    if (!to || !tokenCategory) return { ok: false, error: "NFT_SEND expects <to> <tokenCategory> <tokenId> <amount>" };
    const amount = parseIntSafe(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid NFT amount" };
    return { ok: true, value: { type: "NFT_SEND", to, tokenCategory, tokenId, amount } };
  }

  if (op === "NFT_BALANCE") return { ok: true, value: { type: "NFT_BALANCE" } };

  if (op === "NFT_MARKET_LIST") {
    const tokenId = parts[2] ?? "";
    const priceStr = parts[3] ?? "";
    if (!tokenId || !priceStr) return { ok: false, error: "NFT_MARKET_LIST expects <tokenId> <priceBch>" };
    const priceBch = parseNumber(priceStr);
    if (priceBch === null || priceBch <= 0) return { ok: false, error: "Invalid listing price" };
    return { ok: true, value: { type: "NFT_MARKET_LIST", tokenId, priceBch } };
  }

  if (op === "NFT_MARKET_BUY") {
    const listingId = parts[2] ?? "";
    if (!listingId) return { ok: false, error: "NFT_MARKET_BUY expects <listingId>" };
    return { ok: true, value: { type: "NFT_MARKET_BUY", listingId } };
  }

  if (op === "BCH_MULTISIG_CREATE") {
    const thresholdStr = parts[2] ?? "2";
    const threshold = parseIntSafe(thresholdStr);
    const pubkeys = parts.slice(3);
    if (threshold === null || threshold <= 0) return { ok: false, error: "Invalid threshold" };
    if (pubkeys.length < 2) return { ok: false, error: "BCH_MULTISIG_CREATE requires at least 2 pubkeys" };
    return { ok: true, value: { type: "BCH_MULTISIG_CREATE", threshold, pubkeys } };
  }

  if (op === "BCH_MULTISIG_SEND") {
    const to = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    if (!to || !amountStr) return { ok: false, error: "BCH_MULTISIG_SEND expects <to> <amountSats>" };
    const amountSats = parseIntSafe(amountStr);
    if (amountSats === null || amountSats <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "BCH_MULTISIG_SEND", to, amountSats } };
  }

  if (op === "BCH_MULTISIG_BALANCE") return { ok: true, value: { type: "BCH_MULTISIG_BALANCE" } };

  if (op === "CASH_VAULT_CREATE") {
    const beneficiary = parts[2] ?? "";
    const unlockTimeStr = parts[3] ?? "";
    const amountStr = parts[4] ?? "";
    if (!beneficiary || !unlockTimeStr || !amountStr) {
      return { ok: false, error: "CASH_VAULT_CREATE expects <beneficiary> <unlockTimestamp> <amountSats>" };
    }
    const unlockTime = parseIntSafe(unlockTimeStr);
    const amountSats = parseIntSafe(amountStr);
    if (unlockTime === null || unlockTime <= 0 || amountSats === null || amountSats <= 0) {
      return { ok: false, error: "Invalid parameters" };
    }
    return { ok: true, value: { type: "CASH_VAULT_CREATE", beneficiary, unlockTime, amountSats } };
  }

  if (op === "CASH_VAULT_CLAIM") {
    const vaultAddress = parts[2] ?? "";
    if (!vaultAddress) return { ok: false, error: "CASH_VAULT_CLAIM expects <vaultAddress>" };
    return { ok: true, value: { type: "CASH_VAULT_CLAIM", vaultAddress } };
  }

  if (op === "CASH_VAULT_RECLAIM") {
    const vaultAddress = parts[2] ?? "";
    if (!vaultAddress) return { ok: false, error: "CASH_VAULT_RECLAIM expects <vaultAddress>" };
    return { ok: true, value: { type: "CASH_VAULT_RECLAIM", vaultAddress } };
  }

  if (op === "CASH_VAULT_STATUS") {
    const vaultAddress = parts[2] ?? "";
    if (!vaultAddress) return { ok: false, error: "CASH_VAULT_STATUS expects <vaultAddress>" };
    return { ok: true, value: { type: "CASH_VAULT_STATUS", vaultAddress } };
  }

  if (op === "PAYMENT_REQUEST") {
    const amountStr = parts[2] ?? "";
    const description = parts.slice(3).join(" ") || "Payment";
    if (!amountStr) return { ok: false, error: "PAYMENT_REQUEST expects <amountBch> <description>" };
    const amountBch = parseNumber(amountStr);
    if (amountBch === null || amountBch <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "PAYMENT_REQUEST", amountBch, description } };
  }

  if (op === "PAYMENT_CHECK") {
    const requestId = parts[2] ?? "";
    if (!requestId) return { ok: false, error: "PAYMENT_CHECK expects <requestId>" };
    return { ok: true, value: { type: "PAYMENT_CHECK", requestId } };
  }

  if (op === "PAYMENT_QR") {
    const requestId = parts[2] ?? "";
    if (!requestId) return { ok: false, error: "PAYMENT_QR expects <requestId>" };
    return { ok: true, value: { type: "PAYMENT_QR", requestId } };
  }

  if (op === "BRIDGE_TO_BCH") {
    const fromChain = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    if (!fromChain || !amountStr) return { ok: false, error: "BRIDGE_TO_BCH expects <fromChain> <amount>" };
    const amount = parseNumber(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "BRIDGE_TO_BCH", fromChain, amount } };
  }

  if (op === "BRIDGE_FROM_BCH") {
    const toChain = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    const destAddr = parts[4] ?? "";
    if (!toChain || !amountStr || !destAddr) {
      return { ok: false, error: "BRIDGE_FROM_BCH expects <toChain> <amountSats> <destAddr>" };
    }
    const amountSats = parseIntSafe(amountStr);
    if (amountSats === null || amountSats <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "BRIDGE_FROM_BCH", toChain, amountSats, destAddr } };
  }

  return { ok: false, error: `Unknown command: ${op}` };
}
