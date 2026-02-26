/**
 * Shared Fulcrum ElectrumX WebSocket helpers for all BCH integrations.
 *
 * Provides:
 *  - WebSocket JSON-RPC caller with failover across multiple endpoints
 *  - Address → ElectrumX script-hash conversion (P2PKH & P2SH, CashAddr & legacy)
 *  - Pre-configured endpoint lists for chipnet & mainnet
 */

import { createHash } from "node:crypto";

// ── Endpoint lists ─────────────────────────────────────────────────────────

export const CHIPNET_FULCRUM_WSS = [
  "wss://chipnet.bch.ninja:50004",
  "wss://chipnet.imaginary.cash:50004",
];

export const MAINNET_FULCRUM_WSS = [
  "wss://electrum.imaginary.cash:50004",
  "wss://bch.loping.net:50004",
];

export function getWssEndpoints(network: string): string[] {
  return network === "mainnet" ? MAINNET_FULCRUM_WSS : CHIPNET_FULCRUM_WSS;
}

// ── JSON-RPC over WebSocket ────────────────────────────────────────────────

/**
 * Send one JSON-RPC request over a fresh WebSocket connection.
 * Tries each endpoint in order; returns the first successful result.
 */
export async function fulcrumCall<T = unknown>(
  endpoints: string[],
  method: string,
  params: unknown[],
  timeoutMs = 10_000,
): Promise<T> {
  let lastError: Error | null = null;
  for (const wsUrl of endpoints) {
    try {
      const result = await new Promise<T>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`Fulcrum timeout (${method})`));
        }, timeoutMs);
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({ jsonrpc: "2.0", method, id: 1, params }));
        });
        ws.addEventListener("message", (event: MessageEvent) => {
          clearTimeout(timer);
          ws.close();
          const data = JSON.parse(String(event.data)) as {
            result?: T;
            error?: { message: string };
          };
          if (data.error) reject(new Error(data.error.message));
          else resolve(data.result as T);
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error(`WS connect failed: ${wsUrl}`));
        });
      });
      return result;
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new Error("All Fulcrum endpoints failed");
}

// ── Broadcast helper ───────────────────────────────────────────────────────

/**
 * Broadcast a raw transaction hex via Fulcrum ElectrumX.
 * Returns the txid on success.
 */
export async function fulcrumBroadcast(
  endpoints: string[],
  rawTxHex: string,
): Promise<string> {
  const txid = await fulcrumCall<string>(
    endpoints,
    "blockchain.transaction.broadcast",
    [rawTxHex],
  );
  if (typeof txid !== "string" || txid.length !== 64) {
    throw new Error(`Unexpected broadcast result: ${JSON.stringify(txid)}`);
  }
  return txid;
}

// ── Address decoding & script-hash ─────────────────────────────────────────

/**
 * Compute the ElectrumX "script hash" for any BCH address.
 *
 * Works for P2PKH & P2SH, in both CashAddr and legacy base58check format.
 * The script hash is `sha256(lockingScript)` reversed to hex.
 */
export function addressToElectrumScriptHash(address: string): string {
  const { hash, type } = decodeAddress(address);
  const script =
    type === "p2sh"
      ? Buffer.concat([Buffer.from([0xa9, 0x14]), hash, Buffer.from([0x87])])
      : Buffer.concat([
          Buffer.from([0x76, 0xa9, 0x14]),
          hash,
          Buffer.from([0x88, 0xac]),
        ]);
  const sha = createHash("sha256").update(script).digest();
  return Buffer.from(sha).reverse().toString("hex");
}

// ── Internal CashAddr / legacy decoders ────────────────────────────────────

const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BASE58_CHARS =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeAddress(address: string): {
  hash: Buffer;
  type: "p2pkh" | "p2sh";
} {
  if (address.includes(":")) return decodeCashAddr(address);
  return decodeLegacy(address);
}

function decodeCashAddr(address: string): {
  hash: Buffer;
  type: "p2pkh" | "p2sh";
} {
  const payload = address.split(":").pop()!;
  const values: number[] = [];
  for (const c of payload) {
    const idx = CASHADDR_CHARSET.indexOf(c);
    if (idx < 0) throw new Error("Invalid CashAddr char: " + c);
    values.push(idx);
  }
  // Remove 8 checksum values
  const data5 = values.slice(0, values.length - 8);
  // Convert from 5-bit to 8-bit groups
  let acc = 0,
    bits = 0;
  const result: number[] = [];
  for (const v of data5) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }
  // result[0] is version byte: 0x00 = P2PKH (type 0), 0x08 = P2SH (type 1)
  const versionByte = result[0]!;
  const type = versionByte & 0x08 ? "p2sh" : "p2pkh";
  return { hash: Buffer.from(result.slice(1, 21)), type };
}

function decodeLegacy(address: string): {
  hash: Buffer;
  type: "p2pkh" | "p2sh";
} {
  let num = 0n;
  for (const c of address) {
    const idx = BASE58_CHARS.indexOf(c);
    if (idx < 0) throw new Error("Invalid base58 char: " + c);
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  let leads = 0;
  for (const c of address) {
    if (c !== "1") break;
    leads++;
  }
  const full = Buffer.concat([Buffer.alloc(leads), bytes]);
  // version byte: 0x00 / 0x6f = P2PKH, 0x05 / 0xc4 = P2SH
  const vb = full[0]!;
  const type = vb === 0x05 || vb === 0xc4 ? "p2sh" : "p2pkh";
  return { hash: full.subarray(1, 21), type };
}
