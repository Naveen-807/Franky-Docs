import "dotenv/config";
import { z } from "zod";

const BoolString = z
  .string()
  .transform((v) => v.trim())
  .transform((v) => (v === "1" || v.toLowerCase() === "true" ? "true" : "false"))
  .pipe(z.enum(["true", "false"]))
  .transform((v) => v === "true");

const NumberString = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().regex(/^\d+$/))
  .transform((v) => Number(v));

const EnvSchema = z.object({
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  DOCWALLET_MASTER_KEY: z.string().min(1),
  HTTP_PORT: z.string().optional().default("8787").pipe(NumberString),
  PUBLIC_BASE_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim().replace(/\/+$/g, "") : undefined)),
  POLL_INTERVAL_MS: z.string().optional().default("15000").pipe(NumberString),
  DISCOVERY_INTERVAL_MS: z.string().optional().default("60000").pipe(NumberString),
  DOCWALLET_DOC_ID: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  DOCWALLET_DISCOVER_ALL: z.string().optional().default("0").pipe(BoolString),
  DOCWALLET_NAME_PREFIX: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .default("[DocWallet]"),
  SUI_RPC_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  DEEPBOOK_ENABLED: z.string().optional().default("0").pipe(BoolString),
  ARC_RPC_URL: z.string().optional().default("https://rpc.testnet.arc.network"),
  ARC_ENABLED: z.string().optional().default("1").pipe(BoolString),
  ARC_USDC_ADDRESS: z
    .string()
    .optional()
    .default("0x3600000000000000000000000000000000000000"),
  CIRCLE_ENABLED: z.string().optional().default("0").pipe(BoolString),
  CIRCLE_API_KEY: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  CIRCLE_ENTITY_SECRET: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  CIRCLE_WALLET_SET_ID: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  CIRCLE_BLOCKCHAIN: z.string().optional().default("ARC-TESTNET"),
  CIRCLE_ACCOUNT_TYPE: z.string().optional().default("SCA"),
  YELLOW_ENABLED: z.string().optional().default("0").pipe(BoolString),
  YELLOW_RPC_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  YELLOW_WS_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  YELLOW_APP_NAME: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  YELLOW_ASSET: z.string().optional().default("ytest.usd").transform((v) => v.trim()),
  WALLETCONNECT_ENABLED: z.string().optional().default("0").pipe(BoolString),
  WALLETCONNECT_PROJECT_ID: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  WALLETCONNECT_RELAY_URL: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  BALANCE_POLL_INTERVAL_MS: z.string().optional().default("60000").pipe(NumberString),
  SCHEDULER_INTERVAL_MS: z.string().optional().default("30000").pipe(NumberString),
  DEMO_MODE: z.string().optional().default("1").pipe(BoolString),
  SUI_FAUCET_URL: z.string().optional().default("https://faucet.testnet.sui.io/v1/gas"),
}).superRefine((env, ctx) => {
  if (env.YELLOW_ENABLED && !env.YELLOW_RPC_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["YELLOW_RPC_URL"], message: "Required when YELLOW_ENABLED=1" });
  }
  if (env.DEEPBOOK_ENABLED && !env.SUI_RPC_URL) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["SUI_RPC_URL"], message: "Required when DEEPBOOK_ENABLED=1 (use Sui HTTP fullnode RPC URL)" });
  }
  if (env.CIRCLE_ENABLED && (!env.CIRCLE_API_KEY || !env.CIRCLE_ENTITY_SECRET)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CIRCLE_API_KEY"], message: "CIRCLE_API_KEY required when CIRCLE_ENABLED=1" });
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["CIRCLE_ENTITY_SECRET"], message: "CIRCLE_ENTITY_SECRET required when CIRCLE_ENABLED=1" });
  }
  if (env.WALLETCONNECT_ENABLED && !env.WALLETCONNECT_PROJECT_ID) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WALLETCONNECT_PROJECT_ID"],
      message: "Required when WALLETCONNECT_ENABLED=1"
    });
  }
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(): AppConfig {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
