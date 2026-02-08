import { z } from "zod";
import type { ParsedCommand } from "./commands.js";

export const EnsPolicySchema = z
  .object({
    requireApproval: z.boolean().optional(),
    maxNotionalUsdc: z.number().positive().optional(),
    allowedPairs: z.array(z.string()).optional(),
    payoutAllowlist: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).optional(),
    denyCommands: z.array(z.string()).optional(),
    // --- Enhanced policy fields ---
    dailyLimitUsdc: z.number().positive().optional(),
    maxSingleTxUsdc: z.number().positive().optional(),
    allowedChains: z.array(z.string()).optional(),
    schedulingAllowed: z.boolean().optional(),
    maxScheduleIntervalHours: z.number().positive().optional(),
    bridgeAllowed: z.boolean().optional()
  })
  .strict();

export type EnsPolicy = z.infer<typeof EnsPolicySchema>;

export type PolicyDecision = { ok: true; autoApprove?: boolean } | { ok: false; reason: string };

export function evaluatePolicy(
  policy: EnsPolicy,
  cmd: ParsedCommand,
  context?: { dailySpendUsdc?: number }
): PolicyDecision {
  const deny = new Set((policy.denyCommands ?? []).map((s) => s.toUpperCase()));
  if (deny.has(cmd.type.toUpperCase())) return { ok: false, reason: `Blocked by policy (denyCommands: ${cmd.type})` };

  // Enforce requireApproval — when explicitly false, signal that auto-approval is policy-allowed
  // This lets low-risk commands bypass the approval queue when the policy says so
  const autoApprove = policy.requireApproval === false ? true : undefined;

  if (cmd.type === "LIMIT_BUY" || cmd.type === "LIMIT_SELL") {
    if (policy.allowedPairs && !policy.allowedPairs.includes("SUI/USDC")) {
      return { ok: false, reason: "Blocked by policy (allowedPairs)" };
    }
    if (policy.maxNotionalUsdc !== undefined) {
      const notional = cmd.qty * cmd.price;
      if (notional > policy.maxNotionalUsdc) {
        return { ok: false, reason: `Blocked by policy (maxNotionalUsdc=${policy.maxNotionalUsdc})` };
      }
    }
    // maxSingleTxUsdc check for limit orders
    if (policy.maxSingleTxUsdc !== undefined) {
      const notional = cmd.qty * cmd.price;
      if (notional > policy.maxSingleTxUsdc) {
        return { ok: false, reason: `Blocked by policy (maxSingleTxUsdc=${policy.maxSingleTxUsdc})` };
      }
    }
  }

  if (cmd.type === "PAYOUT") {
    if (policy.payoutAllowlist && !policy.payoutAllowlist.map((a) => a.toLowerCase()).includes(cmd.to.toLowerCase())) {
      return { ok: false, reason: "Blocked by policy (payoutAllowlist)" };
    }
    if (policy.maxSingleTxUsdc !== undefined && cmd.amountUsdc > policy.maxSingleTxUsdc) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxUsdc=${policy.maxSingleTxUsdc})` };
    }
    // Daily limit check
    if (policy.dailyLimitUsdc !== undefined && context?.dailySpendUsdc !== undefined) {
      if (context.dailySpendUsdc + cmd.amountUsdc > policy.dailyLimitUsdc) {
        return { ok: false, reason: `Blocked by policy (dailyLimitUsdc=${policy.dailyLimitUsdc}, spent=${context.dailySpendUsdc.toFixed(2)})` };
      }
    }
  }

  if (cmd.type === "PAYOUT_SPLIT") {
    if (policy.payoutAllowlist) {
      const allow = new Set(policy.payoutAllowlist.map((a) => a.toLowerCase()));
      for (const r of cmd.recipients) {
        if (!allow.has(r.to.toLowerCase())) return { ok: false, reason: "Blocked by policy (payoutAllowlist)" };
      }
    }
    if (policy.maxSingleTxUsdc !== undefined && cmd.amountUsdc > policy.maxSingleTxUsdc) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxUsdc=${policy.maxSingleTxUsdc})` };
    }
    if (policy.dailyLimitUsdc !== undefined && context?.dailySpendUsdc !== undefined) {
      if (context.dailySpendUsdc + cmd.amountUsdc > policy.dailyLimitUsdc) {
        return { ok: false, reason: `Blocked by policy (dailyLimitUsdc=${policy.dailyLimitUsdc}, spent=${context.dailySpendUsdc.toFixed(2)})` };
      }
    }
  }

  if (cmd.type === "SCHEDULE") {
    if (policy.schedulingAllowed === false) {
      return { ok: false, reason: "Blocked by policy (schedulingAllowed=false)" };
    }
    if (policy.maxScheduleIntervalHours !== undefined && cmd.intervalHours > policy.maxScheduleIntervalHours) {
      return { ok: false, reason: `Blocked by policy (maxScheduleIntervalHours=${policy.maxScheduleIntervalHours})` };
    }
  }

  if (cmd.type === "BRIDGE") {
    if (policy.bridgeAllowed === false) {
      return { ok: false, reason: "Blocked by policy (bridgeAllowed=false)" };
    }
    if (policy.allowedChains) {
      const chains = policy.allowedChains.map((c) => c.toLowerCase());
      if (!chains.includes(cmd.fromChain.toLowerCase())) {
        return { ok: false, reason: `Blocked by policy (allowedChains: ${cmd.fromChain})` };
      }
      if (!chains.includes(cmd.toChain.toLowerCase())) {
        return { ok: false, reason: `Blocked by policy (allowedChains: ${cmd.toChain})` };
      }
    }
    if (policy.maxSingleTxUsdc !== undefined && cmd.amountUsdc > policy.maxSingleTxUsdc) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxUsdc=${policy.maxSingleTxUsdc})` };
    }
    if (policy.dailyLimitUsdc !== undefined && context?.dailySpendUsdc !== undefined) {
      if (context.dailySpendUsdc + cmd.amountUsdc > policy.dailyLimitUsdc) {
        return { ok: false, reason: `Blocked by policy (dailyLimitUsdc=${policy.dailyLimitUsdc}, spent=${context.dailySpendUsdc.toFixed(2)})` };
      }
    }
  }

  if (cmd.type === "MARKET_BUY" || cmd.type === "MARKET_SELL") {
    if (policy.allowedPairs && !policy.allowedPairs.includes("SUI/USDC")) {
      return { ok: false, reason: "Blocked by policy (allowedPairs)" };
    }
  }

  if (cmd.type === "STOP_LOSS" || cmd.type === "TAKE_PROFIT") {
    if (policy.allowedPairs && !policy.allowedPairs.includes("SUI/USDC")) {
      return { ok: false, reason: "Blocked by policy (allowedPairs)" };
    }
    if (policy.maxNotionalUsdc !== undefined) {
      const notional = cmd.qty * cmd.triggerPrice;
      if (notional > policy.maxNotionalUsdc) {
        return { ok: false, reason: `Blocked by policy (maxNotionalUsdc=${policy.maxNotionalUsdc})` };
      }
    }
  }

  if (cmd.type === "YELLOW_SEND") {
    if (policy.maxSingleTxUsdc !== undefined && cmd.amountUsdc > policy.maxSingleTxUsdc) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxUsdc=${policy.maxSingleTxUsdc})` };
    }
    if (policy.dailyLimitUsdc !== undefined && context?.dailySpendUsdc !== undefined) {
      if (context.dailySpendUsdc + cmd.amountUsdc > policy.dailyLimitUsdc) {
        return { ok: false, reason: `Blocked by policy (dailyLimitUsdc=${policy.dailyLimitUsdc}, spent=${context.dailySpendUsdc.toFixed(2)})` };
      }
    }
  }

  if (cmd.type === "REBALANCE") {
    if (policy.bridgeAllowed === false) {
      return { ok: false, reason: "Blocked by policy (bridgeAllowed=false — REBALANCE uses cross-chain transfers)" };
    }
    if (policy.allowedChains) {
      const chains = policy.allowedChains.map((c) => c.toLowerCase());
      if (!chains.includes(cmd.fromChain.toLowerCase())) {
        return { ok: false, reason: `Blocked by policy (allowedChains: ${cmd.fromChain})` };
      }
      if (!chains.includes(cmd.toChain.toLowerCase())) {
        return { ok: false, reason: `Blocked by policy (allowedChains: ${cmd.toChain})` };
      }
    }
    if (policy.maxSingleTxUsdc !== undefined && cmd.amountUsdc > policy.maxSingleTxUsdc) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxUsdc=${policy.maxSingleTxUsdc})` };
    }
    if (policy.dailyLimitUsdc !== undefined && context?.dailySpendUsdc !== undefined) {
      if (context.dailySpendUsdc + cmd.amountUsdc > policy.dailyLimitUsdc) {
        return { ok: false, reason: `Blocked by policy (dailyLimitUsdc=${policy.dailyLimitUsdc}, spent=${context.dailySpendUsdc.toFixed(2)})` };
      }
    }
  }

  return { ok: true, autoApprove };
}

