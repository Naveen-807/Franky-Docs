// Test Chaingraph GraphQL API for BCH chipnet - this one is confirmed working
const CHAINGRAPH_URL = "https://gql.chaingraph.pat.mn/v1/graphql";
const addr = "bchtest:qr50rzw49s6g925f4s54459m26da57e0jykv4vtrjt";

// Extract the hash part from the CashAddr (remove prefix and decode)
// For Chaingraph we need the locking_bytecode (P2PKH script)

// First verify the address by querying the chain
async function query(gql: string, variables?: Record<string, unknown>) {
  const res = await fetch(CHAINGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json() as any;
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

// Test 1: Check chain status
console.log("=== Chain Status ===");
const status = await query(`{ block(limit: 1, order_by: {height: desc}) { height hash } }`);
console.log("Latest block:", status.block[0]);

// Test 2: Try to find outputs for a known address
// We need the locking bytecode for P2PKH: OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
// = 76a914{hash160}88ac
// But we need to decode the CashAddr to get the hash160

// Let's also test the BCHN JSON-RPC directly
console.log("\n=== Testing BCHN RPC endpoints ===");
const rpcEndpoints = [
  "https://chipnet.imaginary.cash",
  "https://chipnet.bch.ninja",
  "https://chipnet-bch.electroncash.de",
];

for (const rpc of rpcEndpoints) {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getblockchaininfo", params: [] }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    const isJson = text.startsWith("{") || text.startsWith("[");
    console.log(`\n[${rpc}] status=${res.status} json=${isJson}`);
    if (isJson) console.log("  Response:", text.slice(0, 200));
    else console.log("  HTML:", text.slice(0, 100));
  } catch (e) {
    console.log(`\n[${rpc}] ERROR: ${(e as Error).message}`);
  }
}

// Test Mainnet.cash library-less chipnet API (if exists)
console.log("\n=== Testing mainnet.cash chipnet ===");
try {
  const res = await fetch("https://chipnet.mainnet.cash/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId: `watch:chipnet:${addr}` }),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  console.log(`[mainnet.cash chipnet] status=${res.status}`);
  console.log("Response:", text.slice(0, 300));
} catch (e) {
  console.log(`[mainnet.cash chipnet] ERROR: ${(e as Error).message}`);
}

// Test Mainnet.cash rest.mainnet.cash chipnet
console.log("\n=== Testing rest.mainnet.cash chipnet ===");
try {
  const res = await fetch("https://rest-unstable.mainnet.cash/wallet/balance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId: `watch:chipnet:${addr}` }),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  console.log(`[rest-unstable.mainnet.cash] status=${res.status}`);
  console.log("Response:", text.slice(0, 300));
} catch (e) {
  console.log(`[rest-unstable.mainnet.cash] ERROR: ${(e as Error).message}`);
}

// Also try Electrum Cash protocol over WSS
console.log("\n=== Testing Fulcrum/ElectrumX WebSocket endpoints ===");
const electrumEndpoints = [
  "wss://chipnet.imaginary.cash:50004",
  "wss://chipnet.bch.ninja:50004",
];
for (const wsUrl of electrumEndpoints) {
  try {
    const ws = new WebSocket(wsUrl);
    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 5000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "server.version", id: 1, params: ["test", "1.4"] }));
      };
      ws.onmessage = (event) => {
        clearTimeout(timeout);
        ws.close();
        resolve(String(event.data));
      };
      ws.onerror = (e) => { clearTimeout(timeout); reject(new Error("ws error")); };
    });
    console.log(`[${wsUrl}] ✅`, result.slice(0, 200));
  } catch (e) {
    console.log(`[${wsUrl}] ❌ ${(e as Error).message}`);
  }
}
