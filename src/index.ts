import { loadConfig } from "./config.js";
import { createGoogleAuth } from "./google/auth.js";
import { createDocsClient, createDriveClient } from "./google/clients.js";
import { Repo } from "./db/repo.js";
import { Engine } from "./engine.js";
import { HederaClient } from "./integrations/hedera.js";
import { startServer } from "./server.js";
import { StacksClient } from "./integrations/stacks.js";
import { SbtcClient } from "./integrations/sbtc.js";
import { UsdcxClient } from "./integrations/usdcx.js";
import { X402Client } from "./integrations/x402.js";

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

  let stacks: StacksClient | undefined;
  let sbtc: SbtcClient | undefined;
  let usdcx: UsdcxClient | undefined;
  let x402: X402Client | undefined;
  if (config.STACKS_ENABLED) {
    try {
      const apiUrl = config.STACKS_API_URL || (config.STX_NETWORK === "mainnet"
        ? "https://api.hiro.so"
        : "https://api.testnet.hiro.so");
      stacks = new StacksClient({ network: config.STX_NETWORK, apiUrl });
      console.log(`[startup] Stacks client initialized (${config.STX_NETWORK}, API: ${apiUrl})`);
    } catch (e) {
      console.error("[startup] Stacks client init failed:", (e as Error).message);
    }

    if (stacks && config.SBTC_ENABLED) {
      try {
        sbtc = new SbtcClient({ network: config.STX_NETWORK });
        sbtc.setStacksClient(stacks);
        console.log(`[startup] sBTC client initialized (${config.STX_NETWORK})`);
      } catch (e) {
        console.error("[startup] sBTC client init failed:", (e as Error).message);
      }
    }

    if (stacks && config.USDCX_ENABLED) {
      try {
        usdcx = new UsdcxClient({ network: config.STX_NETWORK });
        usdcx.setStacksClient(stacks);
        console.log(`[startup] USDCx client initialized (${config.STX_NETWORK})`);
      } catch (e) {
        console.error("[startup] USDCx client init failed:", (e as Error).message);
      }
    }

    if (stacks && config.X402_ENABLED) {
      try {
        x402 = new X402Client({ network: config.STX_NETWORK });
        x402.setStacksClient(stacks);
        console.log(`[startup] x402 client initialized (${config.STX_NETWORK})`);
      } catch (e) {
        console.error("[startup] x402 client init failed:", (e as Error).message);
      }
    }
  }

  const engine = new Engine({ config, docs, drive, repo, hedera, stacks, sbtc, usdcx, x402 });

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
