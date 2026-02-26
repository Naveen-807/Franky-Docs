import { createHash } from "node:crypto";

// Address: bchtest:qr50rzw49s6g925f4s54459m26da57e0jykv4vtrjt
// We need the script hash for ElectrumX

// First decode the CashAddr to get hash160
const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function decodeCashAddr(addr: string): { prefix: string; hash: Buffer } {
  const parts = addr.split(":");
  if (parts.length !== 2) throw new Error("Invalid CashAddr - missing prefix");
  const prefix = parts[0];
  const data = parts[1];
  
  const values: number[] = [];
  for (const c of data) {
    const idx = CASHADDR_CHARSET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid CashAddr char: ${c}`);
    values.push(idx);
  }
  
  // Remove checksum (last 8 values)
  const payload5bit = values.slice(0, values.length - 8);
  
  // Convert from 5-bit to 8-bit
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  for (const v of payload5bit) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }
  
  // First byte is version, rest is hash
  const versionByte = result[0];
  const hashBytes = Buffer.from(result.slice(1));
  console.log("Version byte:", versionByte, "(0=P2PKH, 8=P2SH)");
  console.log("Hash160:", hashBytes.toString("hex"));
  console.log("Hash160 length:", hashBytes.length);
  
  return { prefix, hash: hashBytes };
}

const addr = "bchtest:qr50rzw49s6g925f4s54459m26da57e0jykv4vtrjt";
const decoded = decodeCashAddr(addr);

// Build P2PKH locking script: OP_DUP OP_HASH160 <hash160> OP_EQUALVERIFY OP_CHECKSIG
const script = Buffer.concat([
  Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH20
  decoded.hash,
  Buffer.from([0x88, 0xac])        // OP_EQUALVERIFY OP_CHECKSIG
]);
console.log("P2PKH script:", script.toString("hex"));

// ElectrumX wants sha256(script) reversed
const scriptHash = createHash("sha256").update(script).digest();
const reversedHash = Buffer.from(scriptHash).reverse().toString("hex");
console.log("Script hash (reversed for ElectrumX):", reversedHash);

// Now query balance via WebSocket
console.log("\n=== Querying balance via Fulcrum WebSocket ===");

const endpoints = [
  "wss://chipnet.imaginary.cash:50004",
  "wss://chipnet.bch.ninja:50004",
];

for (const wsUrl of endpoints) {
  try {
    const ws = new WebSocket(wsUrl);
    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 8000);
      ws.onopen = () => {
        // Get balance using blockchain.scripthash.get_balance
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          method: "blockchain.scripthash.get_balance",
          id: 1,
          params: [reversedHash]
        }));
      };
      ws.onmessage = (event) => {
        const data = JSON.parse(String(event.data));
        if (data.id === 1) {
          clearTimeout(timeout);
          // Also get UTXO list
          ws.send(JSON.stringify({
            jsonrpc: "2.0",
            method: "blockchain.scripthash.listunspent",
            id: 2,
            params: [reversedHash]
          }));
        }
        if (data.id === 2) {
          ws.close();
          resolve(JSON.stringify({ balance: JSON.parse(String(event.data)).result, utxos: data.result }));
          return;
        }
        if (data.id === 1) {
          console.log(`[${wsUrl}] Balance:`, JSON.stringify(data.result));
        }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error("ws error")); };
    });
    const parsed = JSON.parse(result);
    console.log(`[${wsUrl}] Full result:`, JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log(`[${wsUrl}] ERROR: ${(e as Error).message}`);
  }
}

// Also get transaction history
console.log("\n=== Transaction history ===");
try {
  const ws = new WebSocket("wss://chipnet.bch.ninja:50004");
  const result = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "blockchain.scripthash.get_history",
        id: 1,
        params: [reversedHash]
      }));
    };
    ws.onmessage = (event) => {
      clearTimeout(timeout);
      ws.close();
      resolve(String(event.data));
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error("ws error")); };
  });
  console.log("History:", result);
} catch (e) {
  console.log("History error:", (e as Error).message);
}
