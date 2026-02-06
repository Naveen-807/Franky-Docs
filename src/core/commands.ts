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
  | { type: "PAYOUT_SPLIT"; amountUsdc: number; recipients: Array<{ to: `0x${string}`; pct: number }> }
  | { type: "POLICY_ENS"; ensName: string }
  | { type: "SCHEDULE"; intervalHours: number; innerCommand: string }
  | { type: "CANCEL_SCHEDULE"; scheduleId: string }
  | { type: "BRIDGE"; amountUsdc: number; fromChain: string; toChain: string };

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
  z.object({ type: z.literal("POLICY_ENS"), ensName: z.string().min(3) }),
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

  // "send 10 USDC to 0x..." / "pay 10 USDC to 0x..." / "transfer 10 USDC to 0x..."
  const sendMatch = trimmed.match(/^(?:send|pay|transfer)\s+([\d.]+)\s*USDC\s+to\s+(0x[0-9a-fA-F]{40})$/i);
  if (sendMatch) {
    return parseCommand(`DW PAYOUT ${sendMatch[1]} USDC TO ${sendMatch[2]}`);
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
    // DW PAYOUT 1 USDC TO 0x...
    const amountStr = parts[2] ?? "";
    const unit = (parts[3] ?? "").toUpperCase();
    const toKw = (parts[4] ?? "").toUpperCase();
    const to = parts[5] ?? "";
    if (unit !== "USDC") return { ok: false, error: "PAYOUT expects USDC" };
    if (toKw !== "TO") return { ok: false, error: "PAYOUT expects TO <address>" };
    const amountUsdc = parseNumber(amountStr);
    if (amountUsdc === null || amountUsdc <= 0) return { ok: false, error: "Invalid payout amount" };
    const parsed = ParsedCommandSchema.safeParse({ type: "PAYOUT", amountUsdc, to });
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

  if (op === "POLICY") {
    const sub = (parts[2] ?? "").toUpperCase();
    if (sub !== "ENS") return { ok: false, error: "Only POLICY ENS <name.eth> supported" };
    const ensName = parts[3];
    if (!ensName) return { ok: false, error: "Missing ENS name" };
    return { ok: true, value: { type: "POLICY_ENS", ensName } };
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

  return { ok: false, error: `Unknown command: ${op}` };
}
