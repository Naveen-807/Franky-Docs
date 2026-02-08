import { loadConfig } from "./config.js";
import { createGoogleAuth } from "./google/auth.js";
import { createDocsClient, createDriveClient } from "./google/clients.js";
import { Repo } from "./db/repo.js";
import { Engine } from "./engine.js";
import { ArcClient } from "./integrations/arc.js";
import { CircleArcClient } from "./integrations/circle.js";
import { NitroRpcYellowClient } from "./integrations/yellow.js";
import { DeepBookV3Client } from "./integrations/deepbook.js";
import { startServer } from "./server.js";
import { WalletConnectService } from "./integrations/walletconnect.js";

async function main() {
  const config = loadConfig();
  const auth = await createGoogleAuth(config.GOOGLE_SERVICE_ACCOUNT_JSON, [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.readonly"
  ]);

  const docs = createDocsClient(auth);
  const drive = createDriveClient(auth);
  const repo = new Repo("data/docwallet.db");

  let yellow: NitroRpcYellowClient | undefined;
  if (config.YELLOW_ENABLED) {
    try {
      yellow = new NitroRpcYellowClient(config.YELLOW_RPC_URL!, { defaultApplication: config.YELLOW_APP_NAME });
    } catch (e) {
      console.error("[startup] Yellow client init failed (continuing without Yellow):", (e as Error).message);
    }
  }

  let deepbook: DeepBookV3Client | undefined;
  if (config.DEEPBOOK_ENABLED) {
    try {
      deepbook = new DeepBookV3Client({ rpcUrl: config.SUI_RPC_URL! });
    } catch (e) {
      console.error("[startup] DeepBook client init failed (continuing without DeepBook):", (e as Error).message);
    }
  }

  let arc: ArcClient | undefined;
  if (config.ARC_ENABLED) {
    try {
      arc = new ArcClient({
        rpcUrl: config.ARC_RPC_URL,
        usdcAddress: config.ARC_USDC_ADDRESS as `0x${string}`
      });
    } catch (e) {
      console.error("[startup] Arc client init failed (continuing without Arc):", (e as Error).message);
    }
  }

  let circle: CircleArcClient | undefined;
  if (config.CIRCLE_ENABLED && config.CIRCLE_API_KEY && config.CIRCLE_ENTITY_SECRET) {
    try {
      circle = new CircleArcClient({
        apiKey: config.CIRCLE_API_KEY,
        entitySecret: config.CIRCLE_ENTITY_SECRET,
        walletSetId: config.CIRCLE_WALLET_SET_ID,
        blockchain: config.CIRCLE_BLOCKCHAIN,
        usdcTokenAddress: config.ARC_USDC_ADDRESS as `0x${string}`,
        accountType: config.CIRCLE_ACCOUNT_TYPE
      });
    } catch (e) {
      console.error("[startup] Circle client init failed (continuing without Circle):", (e as Error).message);
    }
  }

  let engine: Engine;
  const walletconnect = config.WALLETCONNECT_ENABLED
    ? new WalletConnectService({
        projectId: config.WALLETCONNECT_PROJECT_ID!,
        relayUrl: config.WALLETCONNECT_RELAY_URL,
        metadata: {
          name: "DocWallet",
          description: "DocWallet approvals",
          url: config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`,
          icons: []
        },
        repo,
        onRequest: async (req) => engine.handleWalletConnectRequest(req),
        onSessionUpdate: async (session) => engine.handleWalletConnectSessionUpdate(session)
      })
    : undefined;

  engine = new Engine({ config, docs, drive, repo, yellow, deepbook, arc, circle, walletconnect });

  const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;
  startServer({
    docs,
    repo,
    masterKey: config.DOCWALLET_MASTER_KEY,
    port: config.HTTP_PORT,
    publicBaseUrl,
    yellow,
    yellowApplicationName: config.YELLOW_APP_NAME ?? "DocWallet",
    yellowAsset: config.YELLOW_ASSET,
    walletconnect,
    demoMode: config.DEMO_MODE
  });

  if (walletconnect) await walletconnect.init();

  console.log(`[engine] started — polling every ${config.POLL_INTERVAL_MS}ms, ${repo.listDocs().length} tracked docs`);

  // Best-effort initial ticks — fire-and-forget with timeout so they never block startup
  const withTimeout = (p: Promise<void>, label: string, ms = 30_000) =>
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
