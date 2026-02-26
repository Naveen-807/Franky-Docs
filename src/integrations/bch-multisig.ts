/**
 * BCH Multi-Sig Wallet Client
 *
 * Real M-of-N P2SH multi-signature wallets for Bitcoin Cash.
 * - createMultisigWallet: derives a real P2SH CashAddr from an OP_CHECKMULTISIG
 *   redeem script built from compressed secp256k1 pubkeys.
 * - sendFromMultisig: builds and broadcasts a real BIP-143-signed P2SH-spending
 *   transaction (works for any threshold where the caller supplies enough keys).
 *
 * All transactions are broadcast via Fulcrum ElectrumX WebSocket.
 */

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  fulcrumCall,
  fulcrumBroadcast,
  getWssEndpoints,
  addressToElectrumScriptHash,
} from "./fulcrum.js";

// ── Crypto helpers ──────────────────────────────────────────────────────────

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function sha256once(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}
function sha256d(data: Buffer): Buffer {
  return sha256once(sha256once(data));
}
function ripemd160(data: Buffer): Buffer {
  return createHash("ripemd160").update(data).digest();
}
function hash160(data: Buffer): Buffer {
  return ripemd160(sha256once(data));
}
function base58Encode(buf: Buffer): string {
  let num = BigInt("0x" + buf.toString("hex"));
  let result = "";
  while (num > 0n) {
    const mod = Number(num % 58n);
    result = BASE58_CHARS[mod] + result;
    num = num / 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    result = "1" + result;
  }
  return result || "1";
}
function base58Check(payload: Buffer): string {
  const checksum = sha256d(payload).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

// ── CashAddr encoder (P2SH type-byte = 0x08) ───────────────────────────────

const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): bigint {
  const generators = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const v of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v);
    for (let i = 0; i < 5; i++) {
      if ((c0 >> BigInt(i)) & 1n) c ^= generators[i];
    }
  }
  return c ^ 1n;
}
function prefixData(prefix: string): number[] {
  const result: number[] = [];
  for (const c of prefix) result.push(c.charCodeAt(0) & 0x1f);
  result.push(0);
  return result;
}
function convertBits5(data: Buffer, fromBits: number, toBits: number): number[] {
  let acc = 0, bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }
  if (bits > 0) result.push((acc << (toBits - bits)) & maxv);
  return result;
}
function encodeCashAddrP2SH(prefix: string, scriptHash160: Buffer): string {
  const versionByte = 0x08; // P2SH, 160-bit hash
  const payload = Buffer.concat([Buffer.from([versionByte]), scriptHash160]);
  const payloadData = convertBits5(payload, 8, 5);
  const prefixArr = prefixData(prefix);
  const checksumInput = [...prefixArr, ...payloadData, 0, 0, 0, 0, 0, 0, 0, 0];
  const checksumValue = polymod(checksumInput);
  const checksumData: number[] = [];
  for (let i = 0; i < 8; i++) checksumData.push(Number((checksumValue >> BigInt(5 * (7 - i))) & 0x1fn));
  let result = prefix + ":";
  for (const v of [...payloadData, ...checksumData]) result += CASHADDR_CHARSET[v];
  return result;
}

// ── Script helpers ──────────────────────────────────────────────────────────

function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}

/** Build OP_CHECKMULTISIG P2MS redeem script */
function buildRedeemScript(pubkeys: string[], threshold: number): Buffer {
  const parts: Buffer[] = [Buffer.from([0x50 + threshold])];
  for (const pk of pubkeys) {
    const pkBuf = Buffer.from(pk, "hex");
    parts.push(Buffer.from([pkBuf.length]), pkBuf);
  }
  parts.push(Buffer.from([0x50 + pubkeys.length]), Buffer.from([0xae])); // OP_<N> OP_CHECKMULTISIG
  return Buffer.concat(parts);
}

/** Decode address to 20-byte hash160 (supports CashAddr and legacy) */
function addressToHash160(address: string): Buffer {
  if (address.includes(":")) {
    const parts = address.split(":");
    const payload = parts[parts.length - 1]!;
    const values: number[] = [];
    for (const c of payload) {
      const idx = CASHADDR_CHARSET.indexOf(c);
      if (idx < 0) throw new Error(`Invalid CashAddr char: ${c}`);
      values.push(idx);
    }
    const data5bit = values.slice(0, values.length - 8);
    let acc = 0, bits = 0;
    const result: number[] = [];
    for (const v of data5bit) {
      acc = (acc << 5) | v;
      bits += 5;
      while (bits >= 8) { bits -= 8; result.push((acc >> bits) & 0xff); }
    }
    return Buffer.from(result.slice(1, 21));
  }
  let num = 0n;
  for (const c of address) {
    const idx = BASE58_CHARS.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58 char: ${c}`);
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  let leads = 0;
  for (const c of address) { if (c !== "1") break; leads++; }
  return Buffer.concat([Buffer.alloc(leads), bytes]).subarray(1, 21);
}

// ── Public types ────────────────────────────────────────────────────────────

export interface MultisigConfig {
  restUrl: string;
  network?: string;
}

export interface MultisigWallet {
  scriptAddress: string;  // legacy P2SH (base58check)
  cashAddress: string;    // CashAddr P2SH
  redeemScript: string;   // hex redeem script
  pubkeys: string[];
  threshold: number;
  totalSigners: number;
}

// ── BchMultisigClient ───────────────────────────────────────────────────────

export class BchMultisigClient {
  private restUrl: string;
  private network: string;
  private wssEndpoints: string[];

  constructor(config: MultisigConfig) {
    this.restUrl = config.restUrl.replace(/\/+$/, "");
    this.network = config.network ?? "chipnet";
    this.wssEndpoints = getWssEndpoints(this.network);
  }

  /** Derive compressed secp256k1 public key (33-byte hex) from a private key hex */
  static pubkeyFromPrivateKey(privateKeyHex: string): string {
    const privBuf = Buffer.from(privateKeyHex, "hex");
    return Buffer.from(secp256k1.getPublicKey(privBuf, true)).toString("hex");
  }

  /**
   * Create a real M-of-N P2SH multisig wallet address.
   * All pubkeys must be 33-byte compressed secp256k1 keys (hex).
   */
  createMultisigWallet(params: { threshold: number; pubkeys: string[] }): MultisigWallet {
    const { threshold, pubkeys } = params;
    if (threshold < 1 || threshold > pubkeys.length) {
      throw new Error(`Invalid threshold ${threshold} for ${pubkeys.length} pubkeys`);
    }
    const redeemScript = buildRedeemScript(pubkeys, threshold);
    const scriptHash = hash160(redeemScript);

    // Legacy P2SH (version byte 0x05 mainnet, 0xc4 testnet)
    const versionByte = this.network === "mainnet" ? 0x05 : 0xc4;
    const legacyAddr = base58Check(Buffer.concat([Buffer.from([versionByte]), scriptHash]));

    // CashAddr P2SH
    const prefix = this.network === "mainnet" ? "bitcoincash" : "bchtest";
    const cashAddr = encodeCashAddrP2SH(prefix, scriptHash);

    return { scriptAddress: legacyAddr, cashAddress: cashAddr, redeemScript: redeemScript.toString("hex"), pubkeys, threshold, totalSigners: pubkeys.length };
  }

  /** Get BCH balance at a P2SH multisig address via Fulcrum ElectrumX */
  async getBalance(scriptAddress: string): Promise<{ confirmed: number; unconfirmed: number }> {
    try {
      const sh = addressToElectrumScriptHash(scriptAddress);
      const result = await fulcrumCall<{ confirmed: number; unconfirmed: number }>(
        this.wssEndpoints, "blockchain.scripthash.get_balance", [sh],
      );
      return { confirmed: result?.confirmed ?? 0, unconfirmed: result?.unconfirmed ?? 0 };
    } catch { return { confirmed: 0, unconfirmed: 0 }; }
  }

  /** Get UTXOs at a P2SH multisig address via Fulcrum ElectrumX */
  async getUtxos(scriptAddress: string): Promise<Array<{ txid: string; vout: number; value: number }>> {
    try {
      const sh = addressToElectrumScriptHash(scriptAddress);
      const utxos = await fulcrumCall<Array<{ tx_hash: string; tx_pos: number; value: number }>>(
        this.wssEndpoints, "blockchain.scripthash.listunspent", [sh],
      );
      return (utxos ?? []).map((u) => ({ txid: u.tx_hash, vout: u.tx_pos, value: u.value }));
    } catch { return []; }
  }

  /**
   * Build, sign (BIP-143), and broadcast a real P2SH-spending transaction.
   *
   * privateKeysHex must contain at least `threshold` keys that match pubkeys
   * in the redeemScript. Works for 1-of-N out of the box with the doc's key.
   */
  async sendFromMultisig(params: {
    fromScriptAddress: string;
    redeemScriptHex: string;
    toAddress: string;
    amountSats: number;
    privateKeysHex: string[]; // at least `threshold` keys
  }): Promise<{ txid: string }> {
    const utxos = await this.getUtxos(params.fromScriptAddress);
    if (utxos.length === 0) throw new Error("No UTXOs at multisig address — fund it first");

    const redeemScript = Buffer.from(params.redeemScriptHex, "hex");
    const totalInput = utxos.reduce((s, u) => s + u.value, 0);
    const fee = 700;
    if (totalInput < params.amountSats + fee) {
      throw new Error(`Insufficient multisig funds: have ${totalInput} sats, need ${params.amountSats + fee}`);
    }
    const change = totalInput - params.amountSats - fee;

    // Build outputs
    const buildOutput = (addr: string, sats: number, isP2SH: boolean): Buffer => {
      const h = addressToHash160(addr);
      const script = isP2SH
        ? Buffer.concat([Buffer.from([0xa9, 0x14]), h, Buffer.from([0x87])]) // OP_HASH160 h OP_EQUAL
        : Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), h, Buffer.from([0x88, 0xac])]);
      const vBuf = Buffer.alloc(8); vBuf.writeBigUInt64LE(BigInt(sats));
      return Buffer.concat([vBuf, encodeVarint(script.length), script]);
    };
    const outBuffers: Buffer[] = [buildOutput(params.toAddress, params.amountSats, false)];
    if (change > 546) outBuffers.push(buildOutput(params.fromScriptAddress, change, true));
    const allOutputs = Buffer.concat(outBuffers);

    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);
    const locktime = Buffer.from([0x00, 0x00, 0x00, 0x00]);

    // BIP-143 shared components
    const hashPrevouts = sha256d(Buffer.concat(
      utxos.map(u => { const t = Buffer.from(u.txid, "hex").reverse(); const v = Buffer.alloc(4); v.writeUInt32LE(u.vout); return Buffer.concat([t, v]); })
    ));
    const hashSequence = sha256d(Buffer.concat(utxos.map(() => Buffer.from([0xff, 0xff, 0xff, 0xff]))));
    const hashOutputs = sha256d(allOutputs);
    const sighashType = 0x41;
    const sighashTypeBuf = Buffer.alloc(4); sighashTypeBuf.writeUInt32LE(sighashType);
    // scriptCode for P2SH BIP-143 = varint(redeemScript.length) + redeemScript
    const scriptCode = Buffer.concat([encodeVarint(redeemScript.length), redeemScript]);

    const signedInputs: Buffer[] = [];
    for (let i = 0; i < utxos.length; i++) {
      const u = utxos[i]!;
      const txidBuf = Buffer.from(u.txid, "hex").reverse();
      const voutBuf = Buffer.alloc(4); voutBuf.writeUInt32LE(u.vout);
      const valueBuf = Buffer.alloc(8); valueBuf.writeBigUInt64LE(BigInt(u.value));
      const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);

      const preimage = Buffer.concat([version, hashPrevouts, hashSequence, txidBuf, voutBuf, scriptCode, valueBuf, sequence, hashOutputs, locktime, sighashTypeBuf]);
      const sighash = sha256d(preimage);

      const sigs: Buffer[] = params.privateKeysHex.map(k => {
        const sigObj = secp256k1.sign(sighash, Buffer.from(k, "hex"));
        return Buffer.concat([Buffer.from(sigObj.toDERRawBytes()), Buffer.from([sighashType])]);
      });

      // P2SH scriptSig = OP_0 <sig1>…<sigM> PUSH(redeemScript)
      const ssParts: Buffer[] = [Buffer.from([0x00])]; // OP_0
      for (const sig of sigs) ssParts.push(Buffer.from([sig.length]), sig);
      const rsLen = redeemScript.length;
      const rsPush = rsLen < 0x4c ? Buffer.from([rsLen])
        : rsLen <= 0xff ? Buffer.from([0x4c, rsLen])
        : Buffer.from([0x4d, rsLen & 0xff, (rsLen >> 8) & 0xff]);
      ssParts.push(rsPush, redeemScript);
      const ss = Buffer.concat(ssParts);

      signedInputs.push(Buffer.concat([txidBuf, voutBuf, encodeVarint(ss.length), ss, sequence]));
    }

    const rawTx = Buffer.concat([version, encodeVarint(utxos.length), ...signedInputs, encodeVarint(outBuffers.length), allOutputs, locktime]).toString("hex");

    const txid = await fulcrumBroadcast(this.wssEndpoints, rawTx);
    console.log(`[bch-multisig] Sent ${params.amountSats} sats → ${params.toAddress} txid=${txid}`);
    return { txid };
  }
}

// ── Compat helpers ──────────────────────────────────────────────────────────

export function parseCashAddr(address: string): { prefix: string; data: string } | null {
  const match = address.match(/^([^:]+):(.+)$/);
  if (!match) return null;
  return { prefix: match[1]!, data: match[2]! };
}

export function isValidCashAddr(address: string): boolean {
  const parsed = parseCashAddr(address);
  if (!parsed) return false;
  const validPrefixes = ["bitcoincash", "bchtest", "bchreg", "bchrt"];
  if (!validPrefixes.includes(parsed.prefix)) return false;
  const dataChars = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  return parsed.data.split("").every(c => dataChars.includes(c) || c === "0");
}
