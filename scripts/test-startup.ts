import { loadConfig } from "../src/config.js";
import { Repo } from "../src/db/repo.js";

console.log("1. Loading config...");
const config = loadConfig();
console.log("2. Config OK — BCH_ENABLED:", config.BCH_ENABLED, "PORT:", config.HTTP_PORT);

console.log("3. Opening DB...");
const repo = new Repo("data/docwallet.db");
console.log("4. DB OK — tracked docs:", repo.listDocs().length);

if (config.BCH_ENABLED) {
  console.log("5. Importing BCH clients...");
  const { BchClient } = await import("../src/integrations/bch.js");
  const { BchNftClient } = await import("../src/integrations/bch-nft.js");
  const { BchMultisigClient } = await import("../src/integrations/bch-multisig.js");
  const { CashScriptClient } = await import("../src/integrations/cashscript.js");
  const { BchPaymentsClient } = await import("../src/integrations/bch-payments.js");

  const bch = new BchClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
  const bchNft = new BchNftClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
  const bchMultisig = new BchMultisigClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
  const cashScript = new CashScriptClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
  const bchPayments = new BchPaymentsClient({ restUrl: config.BCH_REST_URL, network: config.BCH_NETWORK });
  console.log("6. All BCH clients created OK");
}

console.log("7. Testing Google auth import...");
const { createGoogleAuth } = await import("../src/google/auth.js");
console.log("8. Google auth module imported (not calling it — needs real creds to succeed)");

console.log("\n✅ All imports and initialization succeeded!");
repo.close();
process.exit(0);
