import { z } from "zod";
import type { ParsedCommand } from "./commands.js";

export const EnsPolicySchema = z
  .object({
    requireApproval: z.boolean().optional(),
    denyCommands: z.array(z.string()).optional(),
    schedulingAllowed: z.boolean().optional(),
    maxScheduleIntervalHours: z.number().positive().optional(),
    maxSingleTxMicroStx: z.number().positive().optional(),
    dailyLimitMicroStx: z.number().positive().optional(),
    allowedStxNetworks: z.array(z.enum(["mainnet", "testnet"])).optional()
  })
  .strict();

export type EnsPolicy = z.infer<typeof EnsPolicySchema>;

export type PolicyDecision = { ok: true; autoApprove?: boolean } | { ok: false; reason: string };

export function evaluatePolicy(
  policy: EnsPolicy,
  cmd: ParsedCommand,
  context?: { dailySpendMicroStx?: number }
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

  if (cmd.type === "STX_SEND") {
    const amount = Number(cmd.amountMicroStx);
    if (policy.maxSingleTxMicroStx !== undefined && amount > policy.maxSingleTxMicroStx) {
      return { ok: false, reason: `Blocked by policy (maxSingleTxMicroStx=${policy.maxSingleTxMicroStx})` };
    }
    if (policy.dailyLimitMicroStx !== undefined && context?.dailySpendMicroStx !== undefined) {
      if (context.dailySpendMicroStx + amount > policy.dailyLimitMicroStx) {
        return {
          ok: false,
          reason: `Blocked by policy (dailyLimitMicroStx=${policy.dailyLimitMicroStx}, spent=${context.dailySpendMicroStx})`
        };
      }
    }
  }

  return { ok: true, autoApprove };
}
