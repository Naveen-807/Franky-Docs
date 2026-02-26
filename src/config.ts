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
  DOCWALLET_DISCOVER_ALL: z.string().optional().default("1").pipe(BoolString),
  DOCWALLET_NAME_PREFIX: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .default("[DocWallet]"),
  HEDERA_RPC_URL: z.string().optional().default("https://testnet.hashio.io/api"),
  HEDERA_ENABLED: z.string().optional().default("0").pipe(BoolString),
  HEDERA_TOKEN_ADDRESS: z.string().optional().transform((v) => (v?.trim() ? (v.trim() as `0x${string}`) : undefined)),
  STACKS_ENABLED: z.string().optional().default("1").pipe(BoolString),
  STX_NETWORK: z.string().optional().default("testnet").transform((v) => v.trim()),
  STACKS_API_URL: z.string().optional().default("").transform((v) => v.trim()),
  SBTC_ENABLED: z.string().optional().default("1").pipe(BoolString),
  USDCX_ENABLED: z.string().optional().default("1").pipe(BoolString),
  X402_ENABLED: z.string().optional().default("1").pipe(BoolString),
  BALANCE_POLL_INTERVAL_MS: z.string().optional().default("60000").pipe(NumberString),
  SCHEDULER_INTERVAL_MS: z.string().optional().default("30000").pipe(NumberString),
  DEMO_MODE: z.string().optional().default("0").pipe(BoolString),
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
