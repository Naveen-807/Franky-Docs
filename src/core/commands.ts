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
  // ── STX Commands ──
  | { type: "STX_SEND"; to: string; amountMicroStx: bigint }
  | { type: "STX_BALANCE" }
  | { type: "STX_PRICE" }
  | { type: "STX_HISTORY"; limit: number }
  | { type: "STX_STOP_LOSS"; qty: number; triggerPrice: number }
  | { type: "STX_TAKE_PROFIT"; qty: number; triggerPrice: number }
  // ── sBTC Commands ──
  | { type: "SBTC_BALANCE" }
  | { type: "SBTC_SEND"; to: string; amountSats: bigint }
  | { type: "SBTC_INFO" }
  // ── USDCx Commands ──
  | { type: "USDCX_BALANCE" }
  | { type: "USDCX_SEND"; to: string; amount: bigint }
  | { type: "USDCX_APPROVE"; spender: string; amount: bigint }
  | { type: "USDCX_PAYMENT"; amount: number; description: string }
  // ── x402 Commands ──
  | { type: "X402_CALL"; url: string; method: string }
  | { type: "X402_STATUS"; txid: string }
  // ── Clarity Contract Commands ──
  | { type: "CONTRACT_CALL"; contractAddress: string; contractName: string; functionName: string; args: string[] }
  | { type: "CONTRACT_READ"; contractAddress: string; contractName: string; functionName: string; args: string[] }
  // ── Stacking (PoX) ──
  | { type: "STACK_STX"; amountStx: number; cycles: number }
  | { type: "STACK_STATUS" };

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

/** Validate Stacks address format (SP... or ST...) */
const STX_ADDR_RE = /^(SP|ST)[A-Z0-9]{38,}$/i;

function isValidStxAddress(addr: string): boolean {
  return STX_ADDR_RE.test(addr.trim());
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

  // STX price
  if (lower === "stx price" || lower === "stacks price" || lower === "stx/usd") {
    return parseCommand("DW STX_PRICE");
  }

  // STX balance
  if (lower === "stx balance" || lower === "my stx" || lower === "balance") {
    return parseCommand("DW STX_BALANCE");
  }

  // sBTC balance
  if (lower === "sbtc balance" || lower === "my sbtc" || lower === "bitcoin balance") {
    return parseCommand("DW SBTC_BALANCE");
  }

  // USDCx balance
  if (lower === "usdcx balance" || lower === "usdc balance" || lower === "my usdc" || lower === "my usdcx") {
    return parseCommand("DW USDCX_BALANCE");
  }

  // Send STX: "send 10 STX to ST..."
  const stxSendMatch = trimmed.match(/^(?:send|pay)\s+([\d.]+)\s*STX\s+to\s+((?:ST|SP)[A-Z0-9]+)$/i);
  if (stxSendMatch) {
    const amountStx = parseNumber(stxSendMatch[1]!);
    if (amountStx === null || amountStx <= 0) return { ok: false, error: "Invalid STX amount" };
    const microStx = Math.round(amountStx * 1_000_000);
    return parseCommand(`DW STX_SEND ${stxSendMatch[2]} ${microStx}`);
  }

  // Send sBTC: "send 0.001 sBTC to ST..."
  const sbtcSendMatch = trimmed.match(/^(?:send|pay)\s+([\d.]+)\s*sBTC\s+to\s+((?:ST|SP)[A-Z0-9]+)$/i);
  if (sbtcSendMatch) {
    const amountBtc = parseNumber(sbtcSendMatch[1]!);
    if (amountBtc === null || amountBtc <= 0) return { ok: false, error: "Invalid sBTC amount" };
    const sats = Math.round(amountBtc * 1e8);
    return parseCommand(`DW SBTC_SEND ${sbtcSendMatch[2]} ${sats}`);
  }

  // Send USDCx: "send 50 USDCx to ST..."
  const usdcxSendMatch = trimmed.match(/^(?:send|pay)\s+([\d.]+)\s*(?:USDCx|USDC)\s+to\s+((?:ST|SP)[A-Z0-9]+)$/i);
  if (usdcxSendMatch) {
    const amountUsdc = parseNumber(usdcxSendMatch[1]!);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid USDCx amount" };
    const raw = Math.round(amountUsdc * 1_000_000);
    return parseCommand(`DW USDCX_SEND ${usdcxSendMatch[2]} ${raw}`);
  }

  // Stop loss / take profit
  const stopLossMatch = trimmed.match(/^(?:stop[- ]?loss|sl)\s+([\d.]+)\s*(?:STX\s*)?(?:at|@)\s*([\d.]+)$/i);
  if (stopLossMatch) {
    return parseCommand(`DW STX_STOP_LOSS ${stopLossMatch[1]} @ ${stopLossMatch[2]}`);
  }

  const takeProfitMatch = trimmed.match(/^(?:take[- ]?profit|tp)\s+([\d.]+)\s*(?:STX\s*)?(?:at|@)\s*([\d.]+)$/i);
  if (takeProfitMatch) {
    return parseCommand(`DW STX_TAKE_PROFIT ${takeProfitMatch[1]} @ ${takeProfitMatch[2]}`);
  }

  const cancelOrderMatch = trimmed.match(/^cancel\s+(?:order\s+)?((?:ord|stx_sl|stx_tp)_[\w-]+)$/i);
  if (cancelOrderMatch) {
    return parseCommand(`DW CANCEL_ORDER ${cancelOrderMatch[1]}`);
  }

  const cancelSchedMatch = trimmed.match(/^cancel\s+(?:schedule\s+)?(sched_[\w-]+)$/i);
  if (cancelSchedMatch) {
    return parseCommand(`DW CANCEL_SCHEDULE ${cancelSchedMatch[1]}`);
  }

  // Stack STX: "stack 1000 STX for 6 cycles"
  const stackMatch = trimmed.match(/^stack\s+([\d.]+)\s*STX\s+(?:for\s+)?(\d+)\s*cycles?$/i);
  if (stackMatch) {
    return parseCommand(`DW STACK_STX ${stackMatch[1]} ${stackMatch[2]}`);
  }

  if (lower === "stacking status" || lower === "stack status") {
    return parseCommand("DW STACK_STATUS");
  }

  // x402 call: "pay and call https://..."
  const x402Match = trimmed.match(/^(?:x402|pay\s+(?:and\s+)?call)\s+(https?:\/\/\S+)$/i);
  if (x402Match) {
    return parseCommand(`DW X402_CALL ${x402Match[1]} GET`);
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

  // ── Scheduling ──

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

  if (op === "ALERT" || op === "ALERT_THRESHOLD") {
    const coinType = (parts[2] ?? "").toUpperCase();
    if (!coinType) return { ok: false, error: "ALERT expects <coinType> BELOW <amount>" };
    const belowKw = (parts[3] ?? "").toUpperCase();
    let belowStr: string;
    if (belowKw === "BELOW") {
      belowStr = parts[4] ?? "";
    } else {
      belowStr = parts[3] ?? "";
    }
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

  // ── STX Commands ──

  if (op === "STX_PRICE") return { ok: true, value: { type: "STX_PRICE" } };
  if (op === "STX_BALANCE") return { ok: true, value: { type: "STX_BALANCE" } };

  if (op === "STX_SEND") {
    const to = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    if (!to) return { ok: false, error: "STX_SEND expects <address> <amountMicroStx>" };
    if (!isValidStxAddress(to)) return { ok: false, error: "Invalid Stacks address (must start with SP or ST)" };
    const amount = parseIntSafe(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid amount (micro-STX)" };
    return { ok: true, value: { type: "STX_SEND", to, amountMicroStx: BigInt(amount) } };
  }

  if (op === "STX_HISTORY") {
    const limitStr = parts[2] ?? "10";
    const limit = parseIntSafe(limitStr) ?? 10;
    return { ok: true, value: { type: "STX_HISTORY", limit: Math.min(limit, 50) } };
  }

  if (op === "STX_STOP_LOSS") {
    const qtyStr = parts[2] ?? "";
    const at = parts[3] ?? "";
    const priceStr = parts[4] ?? "";
    if (at !== "@") return { ok: false, error: "STX_STOP_LOSS expects <qty> @ <trigger_price>" };
    const qty = parseNumber(qtyStr);
    const triggerPrice = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (triggerPrice === null || triggerPrice <= 0) return { ok: false, error: "Invalid trigger price" };
    return { ok: true, value: { type: "STX_STOP_LOSS", qty, triggerPrice } };
  }

  if (op === "STX_TAKE_PROFIT") {
    const qtyStr = parts[2] ?? "";
    const at = parts[3] ?? "";
    const priceStr = parts[4] ?? "";
    if (at !== "@") return { ok: false, error: "STX_TAKE_PROFIT expects <qty> @ <trigger_price>" };
    const qty = parseNumber(qtyStr);
    const triggerPrice = parseNumber(priceStr);
    if (qty === null || qty <= 0) return { ok: false, error: "Invalid qty" };
    if (triggerPrice === null || triggerPrice <= 0) return { ok: false, error: "Invalid trigger price" };
    return { ok: true, value: { type: "STX_TAKE_PROFIT", qty, triggerPrice } };
  }

  // ── sBTC Commands ──

  if (op === "SBTC_BALANCE") return { ok: true, value: { type: "SBTC_BALANCE" } };

  if (op === "SBTC_SEND") {
    const to = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    if (!to) return { ok: false, error: "SBTC_SEND expects <address> <amountSats>" };
    if (!isValidStxAddress(to)) return { ok: false, error: "Invalid Stacks address" };
    const amount = parseIntSafe(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid amount (sats)" };
    return { ok: true, value: { type: "SBTC_SEND", to, amountSats: BigInt(amount) } };
  }

  if (op === "SBTC_INFO") return { ok: true, value: { type: "SBTC_INFO" } };

  // ── USDCx Commands ──

  if (op === "USDCX_BALANCE") return { ok: true, value: { type: "USDCX_BALANCE" } };

  if (op === "USDCX_SEND") {
    const to = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    if (!to) return { ok: false, error: "USDCX_SEND expects <address> <amount>" };
    if (!isValidStxAddress(to)) return { ok: false, error: "Invalid Stacks address" };
    const amount = parseIntSafe(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "USDCX_SEND", to, amount: BigInt(amount) } };
  }

  if (op === "USDCX_APPROVE") {
    const spender = parts[2] ?? "";
    const amountStr = parts[3] ?? "";
    if (!spender) return { ok: false, error: "USDCX_APPROVE expects <spender> <amount>" };
    if (!isValidStxAddress(spender)) return { ok: false, error: "Invalid Stacks address" };
    const amount = parseIntSafe(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "USDCX_APPROVE", spender, amount: BigInt(amount) } };
  }

  if (op === "USDCX_PAYMENT") {
    const amountStr = parts[2] ?? "";
    const description = parts.slice(3).join(" ") || "Payment";
    if (!amountStr) return { ok: false, error: "USDCX_PAYMENT expects <amount> <description>" };
    const amount = parseNumber(amountStr);
    if (amount === null || amount <= 0) return { ok: false, error: "Invalid amount" };
    return { ok: true, value: { type: "USDCX_PAYMENT", amount, description } };
  }

  // ── x402 Commands ──

  if (op === "X402_CALL") {
    const url = parts[2] ?? "";
    const method = (parts[3] ?? "GET").toUpperCase();
    if (!url) return { ok: false, error: "X402_CALL expects <url> [method]" };
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { ok: false, error: "URL must start with http:// or https://" };
    }
    return { ok: true, value: { type: "X402_CALL", url, method } };
  }

  if (op === "X402_STATUS") {
    const txid = parts[2] ?? "";
    if (!txid) return { ok: false, error: "X402_STATUS expects <txid>" };
    return { ok: true, value: { type: "X402_STATUS", txid } };
  }

  // ── Clarity Contract Commands ──

  if (op === "CONTRACT_CALL" || op === "CONTRACT_READ") {
    const contractFull = parts[2] ?? "";
    const functionName = parts[3] ?? "";
    const args = parts.slice(4);
    if (!contractFull || !functionName) {
      return { ok: false, error: `${op} expects <address>.<contractName> <functionName> [args...]` };
    }
    const dotIdx = contractFull.indexOf(".");
    if (dotIdx < 0) return { ok: false, error: "Contract must be in format <address>.<contractName>" };
    const contractAddress = contractFull.slice(0, dotIdx);
    const contractName = contractFull.slice(dotIdx + 1);
    if (!contractAddress || !contractName) {
      return { ok: false, error: "Invalid contract format" };
    }
    return {
      ok: true,
      value: { type: op === "CONTRACT_CALL" ? "CONTRACT_CALL" : "CONTRACT_READ", contractAddress, contractName, functionName, args }
    };
  }

  // ── Stacking ──

  if (op === "STACK_STX") {
    const amountStr = parts[2] ?? "";
    const cyclesStr = parts[3] ?? "1";
    const amountStx = parseNumber(amountStr);
    if (amountStx === null || amountStx <= 0) return { ok: false, error: "Invalid STX amount for stacking" };
    const cycles = parseIntSafe(cyclesStr);
    if (cycles === null || cycles < 1 || cycles > 12) return { ok: false, error: "Cycles must be 1-12" };
    return { ok: true, value: { type: "STACK_STX", amountStx, cycles } };
  }

  if (op === "STACK_STATUS") return { ok: true, value: { type: "STACK_STATUS" } };

  return { ok: false, error: `Unknown command: ${op}` };
}
