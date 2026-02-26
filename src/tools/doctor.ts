import { loadConfig } from "../config.js";
import { createGoogleAuth, loadServiceAccountKey } from "../google/auth.js";
import { createDocsClient, createDriveClient } from "../google/clients.js";
import { listAccessibleDocs } from "../google/drive.js";

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

  console.log("\nDoctor complete.");
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`\nDoctor failed: ${msg}`);
  process.exit(1);
});
