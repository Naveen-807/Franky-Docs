import { loadConfig } from "./config.js";
import { createGoogleAuth } from "./google/auth.js";
import { createDocsClient, createDriveClient } from "./google/clients.js";
import { Repo } from "./db/repo.js";
import { Engine } from "./engine.js";
import { HederaClient } from "./integrations/hedera.js";
import { startServer } from "./server.js";
import { BchClient } from "./integrations/bch.js";
import { BchNftClient } from "./integrations/bch-nft.js";
import { BchMultisigClient } from "./integrations/bch-multisig.js";
import { CashScriptClient } from "./integrations/cashscript.js";
import { BchPaymentsClient } from "./integrations/bch-payments.js";

async function main() {
  const config = loadConfig();
  const auth = await createGoogleAuth(config.GOOGLE_SERVICE_ACCOUNT_JSON, [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.readonly"
  ]);

  const docs = createDocsClient(auth);
  const drive = createDriveClient(auth);
  const repo = new Repo("data/docwallet.db");

  let hedera: HederaClient | undefined;
  if (config.HEDERA_ENABLED) {
    try {
      hedera = new HederaClient({
        rpcUrl: config.HEDERA_RPC_URL,
        tokenAddress: config.HEDERA_TOKEN_ADDRESS
      });
    } catch (e) {
      console.error("[startup] Hedera client init failed (continuing without Hedera):", (e as Error).message);
    }
  }

  let bch: BchClient | undefined;
  let bchNft: BchNftClient | undefined;
  let bchMultisig: BchMultisigClient | undefined;
  let cashScript: CashScriptClient | undefined;
  let bchPayments: BchPaymentsClient | undefined;
  if (config.BCH_ENABLED) {
    try {
      bch = new BchClient({
        restUrl: config.BCH_REST_URL,
        network: config.BCH_NETWORK
      });
      bchNft = new BchNftClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
      bchMultisig = new BchMultisigClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
      cashScript = new CashScriptClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
      bchPayments = new BchPaymentsClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
      console.log(`[startup] BCH client initialized (${config.BCH_NETWORK}, REST: ${config.BCH_REST_URL})`);
    } catch (e) {
      console.error("[startup] BCH client init failed (continuing without BCH):", (e as Error).message);
    }
  }

  const engine = new Engine({ config, docs, drive, repo, hedera, bch, bchNft, bchMultisig, cashScript, bchPayments });

  const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;
  startServer({
    docs,
    repo,
    masterKey: config.DOCWALLET_MASTER_KEY,
    port: config.HTTP_PORT,
    publicBaseUrl,
    demoMode: config.DEMO_MODE
  });

  console.log(`[engine] started — polling every ${config.POLL_INTERVAL_MS}ms, ${repo.listDocs().length} tracked docs`);

  // Best-effort initial ticks — fire-and-forget with timeout so they never block startup
  const withTimeout = (p: Promise<void>, label: string, ms = 90_000) =>
    Promise.race([p, new Promise<void>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))])
      .catch((e) => console.error(`[startup] ${label} failed (will retry on schedule):`, (e as Error).message));

  withTimeout(engine.discoveryTick(), "discoveryTick");
  withTimeout(engine.pollTick(), "pollTick");

  // Tick error tracking — log warnings for persistent failures
  const tickErrors: Record<string, number> = {};
  function trackedTick(name: string, fn: () => Promise<void>) {
    return async () => {
      try {
        await fn();
        tickErrors[name] = 0; // reset on success
      } catch (e) {
        tickErrors[name] = (tickErrors[name] ?? 0) + 1;
        const count = tickErrors[name];
        if (count >= 3) {
          console.error(`[${name}] FAILED ${count} times consecutively — check configuration`, (e as Error).message);
        } else {
          console.error(`[${name}]`, (e as Error).message);
        }
      }
    };
  }

  setInterval(trackedTick("discoveryTick", () => engine.discoveryTick()), config.DISCOVERY_INTERVAL_MS);
  setInterval(trackedTick("pollTick", () => engine.pollTick()), config.POLL_INTERVAL_MS);
  setInterval(trackedTick("executorTick", () => engine.executorTick()), 5_000);
  setInterval(trackedTick("chatTick", () => engine.chatTick()), Math.max(15_000, config.POLL_INTERVAL_MS));
  setInterval(trackedTick("balancesTick", () => engine.balancesTick()), config.BALANCE_POLL_INTERVAL_MS);
  setInterval(trackedTick("schedulerTick", () => engine.schedulerTick()), config.SCHEDULER_INTERVAL_MS);
  setInterval(trackedTick("agentDecisionTick", () => engine.agentDecisionTick()), 60_000);
  setInterval(trackedTick("priceTick", () => engine.priceTick()), 30_000);
  setInterval(trackedTick("payoutRulesTick", () => engine.payoutRulesTick()), 60_000);

  process.on("SIGINT", () => {
    repo.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
