import { z } from "zod";
import type { ParsedCommand } from "./commands.js";

export const EnsPolicySchema = z
  .object({
    requireApproval: z.boolean().optional(),
    denyCommands: z.array(z.string()).optional(),
    schedulingAllowed: z.boolean().optional(),
    maxScheduleIntervalHours: z.number().positive().optional(),
    maxSingleTxSats: z.number().positive().optional(),
    dailyLimitSats: z.number().positive().optional(),
    allowedBchNetworks: z.array(z.enum(["mainnet", "testnet"])).optional()
  })
  .strict();

export type EnsPolicy = z.infer<typeof EnsPolicySchema>;

export type PolicyDecision = { ok: true; autoApprove?: boolean } | { ok: false; reason: string };

export function evaluatePolicy(
  policy: EnsPolicy,
  cmd: ParsedCommand,
  context?: { dailySpendSats?: number }
): PolicyDecision {
  const deny = new Set((policy.denyCommands ?? []).map((s) => s.toUpperCase()));
  if (deny.has(cmd.type.toUpperCase())) return { ok: false, reason: `Blocked by policy (denyCommands: ${cmd.type})` };

  const autoApprove = policy.requireApproval === false ? true : undefined;

  if (cmd.type === "SCHEDULE") {
    if (policy.schedulingAllowed === false) {
      return { ok: false, reason: "Blocked by policy (schedulingAllowed=false)" };
    }
    if (policy.maxScheduleIntervalHours !== undefined && cmd.intervalHours > policy.maxScheduleIntervalHours) {
      return { ok: false, reason: `Blocked by policy (maxScheduleIntervalHours=${policy.maxScheduleIntervalHours})` };
    }
  }

  if (cmd.type === "BCH_SEND") {
    if (policy.maxSingleTxSats !== undefined && cmd.amountSats > policy.maxSingleTxSats) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxSats=${policy.maxSingleTxSats})` };
    }
    if (policy.dailyLimitSats !== undefined && context?.dailySpendSats !== undefined) {
      if (context.dailySpendSats + cmd.amountSats > policy.dailyLimitSats) {
        return {
          ok: false,
          reason: `Blocked by policy (dailyLimitSats=${policy.dailyLimitSats}, spent=${context.dailySpendSats})`
        };
      }
    }
  }

  return { ok: true, autoApprove };
}
