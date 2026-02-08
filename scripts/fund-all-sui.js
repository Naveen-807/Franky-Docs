#!/usr/bin/env node
/**
 * Fund all FrankyDocs Sui wallets from the testnet faucet.
 * Retries with backoff to handle rate limiting.
 */

const WALLETS = [
  { name: "Real",        addr: "0x3ef18b982128992344457122839eabb979589a145b5e0adae8a8068605c54c78" },
  { name: "test 7",      addr: "0x458f0700e020bbeca05c63fd04ce22582c36d6b20702abd9536bd7d79227565b" },
  { name: "test 8",      addr: "0xb5cfc1450c081725dc3954d0b88f220bf0a675cbb6364528e548e1dac5e5f3c7" },
  { name: "god",         addr: "0x8129c78499841cfd4ef765a242c14ec5637dba8fbe4d4c9cb7ca01ce63881df3" },
  { name: "finaltest 1", addr: "0xd16255cc654073120bee199c681979efe99e3d3f37ce0de137ad63614957df69" },
  { name: "testt",       addr: "0xf185a79d092b188d6c49a19fea4a16ebf2584251263a4166d3595755db07a25b" },
  { name: "DocWallet test",  addr: "0x6843532fac5399063a621c5210ff42894353ec6ff2930d7cbd92f34194052673" },
  { name: "DocWallet demo",  addr: "0xf106f1cfaa153e823abd46c41919251c7df774f508a4a7148ed59bd473c40541" },
  { name: "DocWallet test2", addr: "0x68c37ebb5f8d32631948c4522d20824ed1c275691221e1468a747f41a0a5bf40" },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fundOne(name, addr) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res = await fetch("https://faucet.testnet.sui.io/v1/gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ FixedAmountRequest: { recipient: addr } }),
        signal: AbortSignal.timeout(30_000),
      });

      const text = await res.text();

      if (res.ok) {
        console.log(`✅ ${name} (${addr.slice(0, 12)}…) FUNDED`);
        return true;
      }

      // Parse "Wait for Xs" from 429
      const waitMatch = text.match(/Wait for (\d+)s/);
      const waitSec = waitMatch ? Math.max(parseInt(waitMatch[1]), 5) + 3 : 10;
      console.log(`⏳ ${name} attempt ${attempt}: ${res.status} — waiting ${waitSec}s…`);
      await sleep(waitSec * 1000);
    } catch (err) {
      console.log(`❌ ${name} attempt ${attempt}: ${err.message}`);
      await sleep(10_000);
    }
  }
  console.log(`🔴 ${name} FAILED after 12 attempts`);
  return false;
}

async function checkBalance(addr) {
  try {
    const r = await fetch("https://fullnode.testnet.sui.io:443", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "suix_getBalance",
        params: [addr, "0x2::sui::SUI"]
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json();
    return parseInt(j.result?.totalBalance ?? "0") / 1e9;
  } catch { return -1; }
}

async function main() {
  console.log(`\n🚀 Funding ${WALLETS.length} Sui wallets…\n`);

  for (const w of WALLETS) {
    const bal = await checkBalance(w.addr);
    if (bal > 0.01) {
      console.log(`⏭️  ${w.name} already has ${bal.toFixed(4)} SUI — skipping`);
      continue;
    }
    await fundOne(w.name, w.addr);
    await sleep(3000); // gap between wallets
  }

  console.log(`\n📊 Final balances:`);
  for (const w of WALLETS) {
    const bal = await checkBalance(w.addr);
    console.log(`  ${w.name.padEnd(18)} ${bal.toFixed(4)} SUI`);
  }
}

main();
