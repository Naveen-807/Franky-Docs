import { loadConfig } from "../src/config.js";
import { createGoogleAuth } from "../src/google/auth.js";
import { createDocsClient, createDriveClient } from "../src/google/clients.js";
import { Repo } from "../src/db/repo.js";
import { startServer } from "../src/server.js";

async function main() {
  console.log("step1: loading config");
  const config = loadConfig();
  console.log("step2: config loaded, port", config.HTTP_PORT);

  console.log("step3: creating auth (with 10s timeout)...");
  const auth = await createGoogleAuth(config.GOOGLE_SERVICE_ACCOUNT_JSON, [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.readonly"
  ]);
  console.log("step4: auth done");

  const docs = createDocsClient(auth);
  const drive = createDriveClient(auth);
  console.log("step5: clients created");

  const repo = new Repo("data/docwallet.db");
  console.log("step6: repo ready, docs:", repo.listDocs().length);

  console.log("step7: starting server...");
  startServer({
    docs,
    repo,
    masterKey: config.DOCWALLET_MASTER_KEY,
    port: config.HTTP_PORT,
    publicBaseUrl: `http://localhost:${config.HTTP_PORT}`,
  });
  console.log("step8: server started on port", config.HTTP_PORT);

  // Keep alive for 5s then exit
  setTimeout(() => {
    console.log("step9: exiting cleanly");
    repo.close();
    process.exit(0);
  }, 5_000);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
