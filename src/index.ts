import { loadConfig } from "./config.js";
import { createGoogleAuth } from "./google/auth.js";
import { createDocsClient, createDriveClient } from "./google/clients.js";
import { Repo } from "./db/repo.js";
import { Engine } from "./engine.js";
import { ArcClient } from "./integrations/arc.js";
import { CircleArcClient } from "./integrations/circle.js";
import { EnsPolicyClient } from "./integrations/ens.js";
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

  const yellow = config.YELLOW_ENABLED ? new NitroRpcYellowClient(config.YELLOW_RPC_URL!, { defaultApplication: config.YELLOW_APP_NAME }) : undefined;

  const deepbook = config.DEEPBOOK_ENABLED ? new DeepBookV3Client({ rpcUrl: config.SUI_RPC_URL! }) : undefined;

  const arc = config.ARC_ENABLED
    ? new ArcClient({
        rpcUrl: config.ARC_RPC_URL,
        usdcAddress: config.ARC_USDC_ADDRESS as `0x${string}`
      })
    : undefined;

  const circle =
    config.CIRCLE_ENABLED && config.CIRCLE_API_KEY && config.CIRCLE_ENTITY_SECRET
      ? new CircleArcClient({
          apiKey: config.CIRCLE_API_KEY,
          entitySecret: config.CIRCLE_ENTITY_SECRET,
          walletSetId: config.CIRCLE_WALLET_SET_ID,
          blockchain: config.CIRCLE_BLOCKCHAIN,
          usdcTokenAddress: config.ARC_USDC_ADDRESS as `0x${string}`,
          accountType: config.CIRCLE_ACCOUNT_TYPE
        })
      : undefined;

  const ens = config.ENS_RPC_URL ? new EnsPolicyClient(config.ENS_RPC_URL) : undefined;

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

  engine = new Engine({ config, docs, drive, repo, yellow, deepbook, arc, circle, ens, walletconnect });

  const publicBaseUrl = config.PUBLIC_BASE_URL ?? `http://localhost:${config.HTTP_PORT}`;
  startServer({
    docs,
    repo,
    masterKey: config.DOCWALLET_MASTER_KEY,
    port: config.HTTP_PORT,
    publicBaseUrl,
    yellow,
    yellowApplicationName: config.YELLOW_APP_NAME ?? "DocWallet",
    walletconnect
  });

  if (walletconnect) await walletconnect.init();

  await engine.discoveryTick();
  await engine.pollTick();

  setInterval(() => engine.discoveryTick().catch((e) => console.error("discoveryTick", e)), config.DISCOVERY_INTERVAL_MS);
  setInterval(() => engine.pollTick().catch((e) => console.error("pollTick", e)), config.POLL_INTERVAL_MS);
  setInterval(() => engine.executorTick().catch((e) => console.error("executorTick", e)), 1500);
  setInterval(() => engine.chatTick().catch((e) => console.error("chatTick", e)), Math.max(5000, config.POLL_INTERVAL_MS));
  setInterval(() => engine.balancesTick().catch((e) => console.error("balancesTick", e)), config.BALANCE_POLL_INTERVAL_MS);
  setInterval(() => engine.schedulerTick().catch((e) => console.error("schedulerTick", e)), config.SCHEDULER_INTERVAL_MS);

  process.on("SIGINT", () => {
    repo.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
