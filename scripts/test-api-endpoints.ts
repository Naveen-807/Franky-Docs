// Test various BCH chipnet REST API endpoints to find working ones
const addr = "bchtest:qr50rzw49s6g925f4s54459m26da57e0jykv4vtrjt";

const endpoints = [
  // fullstack.cash API v5
  { name: "fullstack v5 electrumx", url: `https://chipnet.fullstack.cash/v5/electrumx/balance/${addr}` },
  // fullstack.cash API v5 POST style
  { name: "fullstack v5 POST", url: `https://chipnet.fullstack.cash/v5/electrumx/balance`, method: "POST", body: JSON.stringify({ address: addr }), headers: { "Content-Type": "application/json" } },
  // Free tier bchn endpoint
  { name: "free-bch api", url: `https://free-main.fullstack.cash/v5/electrumx/balance/${addr}` },
  // Mainnet CashTokens lookup (for reference)
  { name: "api.fullstack.cash", url: `https://api.fullstack.cash/v5/electrumx/balance/${addr}` },
  // Blockchain.info style
  { name: "rest.bitcoin.com", url: `https://rest1.biggestfan.net/v2/address/details/${addr}` },
  // BCHN chipnet RPC
  { name: "chipnet.chaingraph", url: `https://chipnet.chaingraph.cash/v1/graphql`, method: "POST", body: JSON.stringify({ query: `{ node { name } }` }), headers: { "Content-Type": "application/json" } },
  // Blockchair
  { name: "blockchair", url: `https://api.blockchair.com/bitcoin-cash/testnet/dashboards/address/${addr}` },
  // electroncash.de fulcrum
  { name: "electroncash.de", url: `https://chipnet.electroncash.de:60004` },
  // Chaingraph chipnet
  { name: "chaingraph chipnet", url: `https://gql.chaingraph.pat.mn/v1/graphql`, method: "POST", body: JSON.stringify({ query: `{ block(limit: 1, order_by: {height: desc}) { height } }` }), headers: { "Content-Type": "application/json" } },
];

for (const ep of endpoints) {
  try {
    const opts: RequestInit = { signal: AbortSignal.timeout(8000) };
    if (ep.method === "POST") {
      opts.method = "POST";
      opts.body = ep.body;
      opts.headers = ep.headers;
    }
    const res = await fetch(ep.url, opts);
    const text = await res.text();
    const isJson = text.startsWith("{") || text.startsWith("[");
    console.log(`\n[${ep.name}] status=${res.status} json=${isJson}`);
    if (isJson) {
      try {
        const json = JSON.parse(text);
        console.log("  Response:", JSON.stringify(json).slice(0, 300));
      } catch { console.log("  Raw:", text.slice(0, 200)); }
    } else {
      console.log("  NOT JSON, starts with:", text.slice(0, 80));
    }
  } catch (e) {
    console.log(`\n[${ep.name}] ERROR: ${(e as Error).message}`);
  }
}
