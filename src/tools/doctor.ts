import { loadConfig } from "../config.js";
import { createGoogleAuth, loadServiceAccountKey } from "../google/auth.js";
import { createDocsClient, createDriveClient } from "../google/clients.js";
import { listAccessibleDocs } from "../google/drive.js";
import { CircleArcClient } from "../integrations/circle.js";
import { SuiClient } from "@mysten/sui/client";

function mask(s: string | undefined, keep = 4) {
  if (!s) return "(unset)";
  if (s.length <= keep) return "***";
  return `${"*".repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}`;
}

async function main() {
  const config = loadConfig();

  console.log("DocWallet doctor\n");

  // Google
  const sa = await loadServiceAccountKey(config.GOOGLE_SERVICE_ACCOUNT_JSON);
  console.log(`Google service account: ${sa.client_email}`);
  console.log(`GOOGLE_SERVICE_ACCOUNT_JSON: ${config.GOOGLE_SERVICE_ACCOUNT_JSON.startsWith("{") ? "(inline json)" : config.GOOGLE_SERVICE_ACCOUNT_JSON}`);

  const auth = await createGoogleAuth(config.GOOGLE_SERVICE_ACCOUNT_JSON, [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.readonly"
  ]);
  console.log("Google auth: OK");

  const drive = createDriveClient(auth);
  const docs = createDocsClient(auth);

  if (config.DOCWALLET_DOC_ID) {
    const d = await docs.documents.get({ documentId: config.DOCWALLET_DOC_ID });
    console.log(`DOCWALLET_DOC_ID: ${config.DOCWALLET_DOC_ID}`);
    console.log(`Doc title: ${d.data.title ?? "(unknown)"}`);
  } else {
    const files = await listAccessibleDocs({
      drive,
      namePrefix: config.DOCWALLET_DISCOVER_ALL ? undefined : config.DOCWALLET_NAME_PREFIX
    });
    console.log(`Drive discovery: ${files.length} docs found (${config.DOCWALLET_DISCOVER_ALL ? "no name filter" : `filter="${config.DOCWALLET_NAME_PREFIX}"`})`);
    for (const f of files.slice(0, 10)) {
      console.log(`- ${f.id}  ${f.name}`);
    }
    if (files.length === 0) {
      console.log("\nNo docs matched. Fix options:");
      console.log("- Rename your Doc to include [DocWallet], or");
      console.log("- Set DOCWALLET_DISCOVER_ALL=1, or");
      console.log("- Set DOCWALLET_DOC_ID=<the doc id>");
    }
  }

  // Sui
  if (config.DEEPBOOK_ENABLED) {
    const sui = new SuiClient({ url: config.SUI_RPC_URL! });
    const state = await sui.getLatestSuiSystemState();
    console.log(`\nSui RPC: OK (epoch ${state.epoch})`);
  } else {
    console.log("\nSui/DeepBook: disabled (DEEPBOOK_ENABLED=0)");
  }

  // Circle
  if (config.CIRCLE_ENABLED) {
    console.log(`\nCircle: enabled (apiKey=${mask(config.CIRCLE_API_KEY)} entitySecret=${mask(config.CIRCLE_ENTITY_SECRET)})`);
    const circle = new CircleArcClient({
      apiKey: config.CIRCLE_API_KEY!,
      entitySecret: config.CIRCLE_ENTITY_SECRET!,
      walletSetId: config.CIRCLE_WALLET_SET_ID,
      blockchain: config.CIRCLE_BLOCKCHAIN,
      usdcTokenAddress: config.ARC_USDC_ADDRESS as `0x${string}`,
      accountType: config.CIRCLE_ACCOUNT_TYPE
    });
    const pk = await (circle as any).client.getPublicKey?.();
    const hasPk = Boolean(pk?.data?.publicKey);
    console.log(`Circle getPublicKey: ${hasPk ? "OK" : "UNEXPECTED_RESPONSE"}`);
  } else {
    console.log("\nCircle: disabled (CIRCLE_ENABLED=0)");
  }

  // Yellow
  if (config.YELLOW_ENABLED) {
    console.log(`\nYellow: enabled (rpcUrl=${config.YELLOW_RPC_URL})`);
    console.log("Yellow health: not probed (requires signer join flow).");
  } else {
    console.log("\nYellow: disabled (YELLOW_ENABLED=0)");
  }

  if (config.WALLETCONNECT_ENABLED) {
    console.log(`\nWalletConnect: enabled (projectId=${mask(config.WALLETCONNECT_PROJECT_ID)})`);
  } else {
    console.log("\nWalletConnect: disabled (WALLETCONNECT_ENABLED=0)");
  }

  console.log("\nDoctor complete.");
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nDoctor failed: ${msg}`);
  process.exit(1);
});
