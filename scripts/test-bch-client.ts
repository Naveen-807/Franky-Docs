import { BchClient } from "../src/integrations/bch.js";

const client = new BchClient({
  restUrl: "https://chipnet.fullstack.cash/v5/", // not used anymore
  network: "chipnet",
});

const addr = "bchtest:qr50rzw49s6g925f4s54459m26da57e0jykv4vtrjt";

console.log("=== Testing BCH Client via Fulcrum WebSocket ===");
console.log("Address:", addr);

// Test balance
const balance = await client.getBalance(addr);
console.log("\nBalance:", JSON.stringify(balance, null, 2));

// Test UTXOs
const utxos = await client.getUtxos(addr);
console.log("\nUTXOs:", utxos.length, "found");
if (utxos.length > 0) {
  console.log("  First UTXO:", JSON.stringify(utxos[0]));
}

// Test token UTXOs
const tokenUtxos = await client.getTokenUtxos(addr);
console.log("\nToken UTXOs:", tokenUtxos.length, "found");

// Test history
const history = await client.getHistory(addr);
console.log("\nTransaction history:", history.length, "txs");
if (history.length > 0) {
  console.log("  Latest:", JSON.stringify(history[history.length - 1]));
}

console.log("\n✅ All BCH client methods working via Fulcrum WebSocket!");
