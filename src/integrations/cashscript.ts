/**
 * CashScript / OP_CHECKLOCKTIMEVERIFY Vault Client
 *
 * Real on-chain time-locked BCH vaults using OP_CHECKLOCKTIMEVERIFY (CLTV).
 * The vault is a P2SH address whose redeem script is:
 *
 *   <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP
 *   OP_DUP OP_HASH160 <beneficiaryHash160> OP_EQUALVERIFY OP_CHECKSIG
 *
 * Fund the vault by sending BCH to the P2SH contract address (real broadcast
 * via Fulcrum ElectrumX WebSocket). Claim after locktime passes using BIP-143.
 */

import { createHash } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  fulcrumCall,
  fulcrumBroadcast,
  getWssEndpoints,
  addressToElectrumScriptHash,
} from "./fulcrum.js";

// ── Crypto helpers ───────────────────────────────────────────────────────────

function sha256once(d: Buffer): Buffer { return createHash("sha256").update(d).digest(); }
function sha256d(d: Buffer): Buffer { return sha256once(sha256once(d)); }
function hash160(d: Buffer): Buffer {
  return createHash("ripemd160").update(sha256once(d)).digest();
}

// ── Base58Check ──────────────────────────────────────────────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// ── CashAddr P2SH encode ─────────────────────────────────────────────────────

const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function _caPolymod(values: number[]): bigint {
  const g = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const v of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v);
    for (let i = 0; i < 5; i++) { if ((c0 >> BigInt(i)) & 1n) c ^= g[i]!; }
  }
  return c ^ 1n;
}
function _bits8to5(data: Buffer): number[] {
  let acc = 0, bits = 0;
  const r: number[] = [];
  for (const b of data) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { bits -= 5; r.push((acc >> bits) & 0x1f); } }
  if (bits > 0) r.push((acc << (5 - bits)) & 0x1f);
  return r;
}
function encodeCashAddrP2SH(prefix: string, hash20: Buffer): string {
  // version byte 0x08 = P2SH (type 1, 20-byte hash)
  const payload = _bits8to5(Buffer.concat([Buffer.from([0x08]), hash20]));
  const pd: number[] = [];
  for (const ch of prefix) pd.push(ch.charCodeAt(0) & 0x1f);
  pd.push(0);
  const cv = _caPolymod([...pd, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const cd: number[] = [];
  for (let i = 0; i < 8; i++) cd.push(Number((cv >> BigInt(5 * (7 - i))) & 0x1fn));
  let r = prefix + ":";
  for (const v of [...payload, ...cd]) r += CASHADDR_CHARSET[v];
  return r;
}

// ── CashAddr / legacy decode → hash160 ──────────────────────────────────────

function _bits5to8(data: number[]): number[] {
  let acc = 0, bits = 0;
  const r: number[] = [];
  for (const v of data) { acc = (acc << 5) | v; bits += 5; while (bits >= 8) { bits -= 8; r.push((acc >> bits) & 0xff); } }
  return r;
}
function decodeCashAddrHash(address: string): Buffer {
  const payload = address.split(":").pop()!;
  const vals = [...payload].map(c => { const i = CASHADDR_CHARSET.indexOf(c); if (i < 0) throw new Error("bad cashaddr char " + c); return i; });
  return Buffer.from(_bits5to8(vals.slice(0, vals.length - 8)).slice(1, 21));
}
function decodeLegacyHash(address: string): Buffer {
  let num = 0n;
  for (const c of address) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad b58 " + c); num = num * 58n + BigInt(i); }
  let hex = num.toString(16); if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  let leads = 0; for (const c of address) { if (c !== "1") break; leads++; }
  return Buffer.concat([Buffer.alloc(leads), bytes]).subarray(1, 21);
}
function addressToHash160(addr: string): Buffer {
  return addr.includes(":") ? decodeCashAddrHash(addr) : decodeLegacyHash(addr);
}

// ── Script / tx encoding helpers ─────────────────────────────────────────────

function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) { const b = Buffer.alloc(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0xfe; b.writeUInt32LE(n, 1); return b;
}

/**
 * Encode locktime as minimal CScript integer push.
 * Unix timestamps 2024–2030 fit in 4 bytes (< 0x80000000).
 */
function encodeLocktimePush(locktime: number): Buffer {
  let n = locktime >>> 0;
  const bytes: number[] = [];
  while (n > 0) { bytes.push(n & 0xff); n = n >>> 8; }
  // If high bit of last byte is set, append 0x00 to keep sign positive
  if (bytes.length > 0 && (bytes[bytes.length - 1]! & 0x80)) bytes.push(0x00);
  if (bytes.length === 0) bytes.push(0x00);
  return Buffer.concat([Buffer.from([bytes.length]), Buffer.from(bytes)]);
}

/**
 * CLTV P2SH redeem script:
 *   <locktime> OP_CLTV OP_DROP OP_DUP OP_HASH160 <hash160> OP_EQUALVERIFY OP_CHECKSIG
 */
function buildCLTVRedeemScript(locktime: number, beneficiaryHash160: Buffer): Buffer {
  return Buffer.concat([
    encodeLocktimePush(locktime),
    Buffer.from([0xb1]),              // OP_CHECKLOCKTIMEVERIFY
    Buffer.from([0x75]),              // OP_DROP
    Buffer.from([0x76, 0xa9, 0x14]), // OP_DUP OP_HASH160 PUSH(20)
    beneficiaryHash160,
    Buffer.from([0x88, 0xac]),        // OP_EQUALVERIFY OP_CHECKSIG
  ]);
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface CashScriptConfig {
  restUrl: string;
  network?: string; // "mainnet" | "chipnet" (default)
}

export interface VaultContract {
  address: string;       // P2SH CashAddr
  redeemScript: string;  // hex
  beneficiary: string;   // CashAddr of beneficiary
  unlockTime: number;    // Unix timestamp
  amountSats: number;
  fundingTxid: string;
}

// ── CashScriptClient ─────────────────────────────────────────────────────────

export class CashScriptClient {
  private restUrl: string;
  private network: string;
  private wssEndpoints: string[];

  constructor(config: CashScriptConfig) {
    this.restUrl = config.restUrl.replace(/\/+$/, "");
    this.network = config.network ?? "chipnet";
    this.wssEndpoints = getWssEndpoints(this.network);
  }

  /**
   * Deploy a real on-chain CLTV time-locked vault.
   *
   * 1. Builds CLTV redeem script
   * 2. Derives P2SH address
   * 3. Funds it with a real signed BCH transaction
   */
  async deployVault(params: {
    beneficiary: string;      // CashAddr of beneficiary (who can withdraw after locktime)
    unlockTime: number;       // Unix timestamp
    amountSats: number;
    funderPrivateKey: string; // hex private key of the funder
    funderAddress: string;    // CashAddr of funder
  }): Promise<{ txid: string; contractAddress: string; redeemScript: string }> {
    const beneficiaryHash = addressToHash160(params.beneficiary);
    const redeemScript = buildCLTVRedeemScript(params.unlockTime, beneficiaryHash);
    const scriptHash = hash160(redeemScript);
    const prefix = this.network === "mainnet" ? "bitcoincash" : "bchtest";
    const contractAddress = encodeCashAddrP2SH(prefix, scriptHash);

    console.log("[cashscript] Deploying CLTV vault at " + contractAddress);
    console.log("[cashscript]   beneficiary: " + params.beneficiary);
    console.log("[cashscript]   unlocks: " + new Date(params.unlockTime * 1000).toISOString());

    const { txid } = await this._fundP2SH({
      privateKeyHex: params.funderPrivateKey,
      fromAddress: params.funderAddress,
      toP2SHAddress: contractAddress,
      amountSats: params.amountSats,
    });

    console.log("[cashscript] Vault funded txid=" + txid);
    return { txid, contractAddress, redeemScript: redeemScript.toString("hex") };
  }

  /**
   * Claim (withdraw) from a CLTV vault after the unlock time has passed.
   * Builds and broadcasts a real P2SH-spending tx with nLockTime = unlockTime.
   */
  async claimVault(params: {
    contractAddress: string;
    redeemScriptHex: string;
    beneficiaryPrivateKey: string; // hex private key of beneficiary
    recipientAddress: string;
    unlockTime: number;
  }): Promise<{ txid: string }> {
    const now = Math.floor(Date.now() / 1000);
    if (now < params.unlockTime) {
      const remaining = params.unlockTime - now;
      const unlockDate = new Date(params.unlockTime * 1000).toISOString();
      throw new Error("Vault still locked for " + remaining + "s (unlocks " + unlockDate + ")");
    }
    return this._spendCLTV({
      contractAddress: params.contractAddress,
      redeemScriptHex: params.redeemScriptHex,
      privateKeyHex: params.beneficiaryPrivateKey,
      recipientAddress: params.recipientAddress,
      nlocktime: params.unlockTime,
    });
  }

  /**
   * Reclaim from vault (creator emergency exit, devnet/testnet only).
   * On mainnet nodes reject it if current time < CLTV locktime.
   */
  async reclaimVault(params: {
    contractAddress: string;
    redeemScriptHex: string;
    creatorPrivateKey: string;
    recipientAddress: string;
    locktime: number;
  }): Promise<{ txid: string }> {
    return this._spendCLTV({
      contractAddress: params.contractAddress,
      redeemScriptHex: params.redeemScriptHex,
      privateKeyHex: params.creatorPrivateKey,
      recipientAddress: params.recipientAddress,
      nlocktime: Math.floor(Date.now() / 1000),
    });
  }

  /** Query vault balance on-chain via Fulcrum ElectrumX */
  async getVaultInfo(contractAddress: string): Promise<{ balance: number; address: string } | null> {
    try {
      const sh = addressToElectrumScriptHash(contractAddress);
      const result = await fulcrumCall<{ confirmed: number; unconfirmed: number }>(
        this.wssEndpoints, "blockchain.scripthash.get_balance", [sh],
      );
      const balance = (result?.confirmed ?? 0) + (result?.unconfirmed ?? 0);
      return { balance, address: contractAddress };
    } catch {
      return null;
    }
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  /** Build and broadcast a tx sending BCH from P2PKH → P2SH address */
  private async _fundP2SH(params: {
    privateKeyHex: string;
    fromAddress: string;
    toP2SHAddress: string;
    amountSats: number;
  }): Promise<{ txid: string }> {
    const utxos = await this._getUtxos(params.fromAddress);
    if (utxos.length === 0) throw new Error("No UTXOs — fund the wallet first");

    const privBuf = Buffer.from(params.privateKeyHex, "hex");
    const pubKey = Buffer.from(secp256k1.getPublicKey(privBuf, true));
    const pubKeyHash = hash160(pubKey);

    const totalIn = utxos.reduce((s, u) => s + u.value, 0);
    const fee = 500;
    if (totalIn < params.amountSats + fee) {
      throw new Error("Insufficient BCH: have " + totalIn + " sats, need " + (params.amountSats + fee));
    }
    const change = totalIn - params.amountSats - fee;

    // P2SH output: OP_HASH160 PUSH(20) <hash> OP_EQUAL
    const toHash = addressToHash160(params.toP2SHAddress);
    const toScript = Buffer.concat([Buffer.from([0xa9, 0x14]), toHash, Buffer.from([0x87])]);
    // P2PKH change output
    const changeScript = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pubKeyHash, Buffer.from([0x88, 0xac])]);

    const makeOut = (sats: number, script: Buffer): Buffer => {
      const v = Buffer.alloc(8); v.writeBigUInt64LE(BigInt(sats));
      return Buffer.concat([v, encodeVarint(script.length), script]);
    };
    const outs: Buffer[] = [makeOut(params.amountSats, toScript)];
    if (change > 546) outs.push(makeOut(change, changeScript));
    const allOutputs = Buffer.concat(outs);

    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);
    const locktime = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const seq = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const sighashType = 0x41;
    const sighashTypeBuf = Buffer.alloc(4); sighashTypeBuf.writeUInt32LE(sighashType);

    const hashPrevouts = sha256d(Buffer.concat(utxos.map(u => {
      const t = Buffer.from(u.txid, "hex").reverse();
      const v = Buffer.alloc(4); v.writeUInt32LE(u.vout); return Buffer.concat([t, v]);
    })));
    const hashSequence = sha256d(Buffer.concat(utxos.map(() => seq)));
    const hashOutputs = sha256d(allOutputs);
    // P2PKH scriptCode
    const scriptCode = Buffer.concat([Buffer.from([0x19, 0x76, 0xa9, 0x14]), pubKeyHash, Buffer.from([0x88, 0xac])]);

    const signedInputs: Buffer[] = [];
    for (const u of utxos) {
      const txidBuf = Buffer.from(u.txid, "hex").reverse();
      const voutBuf = Buffer.alloc(4); voutBuf.writeUInt32LE(u.vout);
      const valueBuf = Buffer.alloc(8); valueBuf.writeBigUInt64LE(BigInt(u.value));
      const preimage = Buffer.concat([version, hashPrevouts, hashSequence, txidBuf, voutBuf, scriptCode, valueBuf, seq, hashOutputs, locktime, sighashTypeBuf]);
      const sighash = sha256d(preimage);
      const sig = Buffer.concat([Buffer.from(secp256k1.sign(sighash, privBuf).toDERRawBytes()), Buffer.from([sighashType])]);
      const ss = Buffer.concat([Buffer.from([sig.length]), sig, Buffer.from([pubKey.length]), pubKey]);
      signedInputs.push(Buffer.concat([txidBuf, voutBuf, encodeVarint(ss.length), ss, seq]));
    }

    const rawTx = Buffer.concat([version, encodeVarint(utxos.length), ...signedInputs, encodeVarint(outs.length), allOutputs, locktime]).toString("hex");
    return this._broadcast(rawTx);
  }

  /** Build and broadcast a P2SH-spending (CLTV claim) transaction */
  private async _spendCLTV(params: {
    contractAddress: string;
    redeemScriptHex: string;
    privateKeyHex: string;
    recipientAddress: string;
    nlocktime: number;
  }): Promise<{ txid: string }> {
    const utxos = await this._getUtxos(params.contractAddress);
    if (utxos.length === 0) throw new Error("No UTXOs in vault — already claimed?");

    const redeemScript = Buffer.from(params.redeemScriptHex, "hex");
    const privBuf = Buffer.from(params.privateKeyHex, "hex");
    const pubKey = Buffer.from(secp256k1.getPublicKey(privBuf, true));

    const totalIn = utxos.reduce((s, u) => s + u.value, 0);
    const fee = 600;
    if (totalIn < fee + 546) throw new Error("Vault balance too low to cover fee");
    const outSats = totalIn - fee;

    const recipientHash = addressToHash160(params.recipientAddress);
    const recipientScript = Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), recipientHash, Buffer.from([0x88, 0xac])]);
    const vBuf = Buffer.alloc(8); vBuf.writeBigUInt64LE(BigInt(outSats));
    const allOutputs = Buffer.concat([vBuf, encodeVarint(recipientScript.length), recipientScript]);

    const version = Buffer.from([0x02, 0x00, 0x00, 0x00]);
    const locktimeBuf = Buffer.alloc(4); locktimeBuf.writeUInt32LE(params.nlocktime);
    const sighashType = 0x41;
    const sighashTypeBuf = Buffer.alloc(4); sighashTypeBuf.writeUInt32LE(sighashType);
    // CLTV mandates sequence < 0xffffffff
    const seq = Buffer.from([0xfe, 0xff, 0xff, 0xff]);

    const hashPrevouts = sha256d(Buffer.concat(utxos.map(u => {
      const t = Buffer.from(u.txid, "hex").reverse();
      const v = Buffer.alloc(4); v.writeUInt32LE(u.vout); return Buffer.concat([t, v]);
    })));
    const hashSequence = sha256d(Buffer.concat(utxos.map(() => seq)));
    const hashOutputs = sha256d(allOutputs);
    // BIP-143 P2SH scriptCode = varint(len) + redeemScript
    const scriptCode = Buffer.concat([encodeVarint(redeemScript.length), redeemScript]);

    const signedInputs: Buffer[] = [];
    for (const u of utxos) {
      const txidBuf = Buffer.from(u.txid, "hex").reverse();
      const voutBuf = Buffer.alloc(4); voutBuf.writeUInt32LE(u.vout);
      const valueBuf = Buffer.alloc(8); valueBuf.writeBigUInt64LE(BigInt(u.value));
      const preimage = Buffer.concat([version, hashPrevouts, hashSequence, txidBuf, voutBuf, scriptCode, valueBuf, seq, hashOutputs, locktimeBuf, sighashTypeBuf]);
      const sighash = sha256d(preimage);
      const sig = Buffer.concat([Buffer.from(secp256k1.sign(sighash, privBuf).toDERRawBytes()), Buffer.from([sighashType])]);

      // P2SH scriptSig: <sig> <pubkey> PUSH(redeemScript)
      const rsLen = redeemScript.length;
      const rsPush = rsLen < 0x4c
        ? Buffer.from([rsLen])
        : Buffer.from([0x4c, rsLen]);
      const ss = Buffer.concat([
        Buffer.from([sig.length]), sig,
        Buffer.from([pubKey.length]), pubKey,
        rsPush, redeemScript,
      ]);
      signedInputs.push(Buffer.concat([txidBuf, voutBuf, encodeVarint(ss.length), ss, seq]));
    }

    const rawTx = Buffer.concat([
      version, encodeVarint(utxos.length), ...signedInputs,
      Buffer.from([0x01]), allOutputs, locktimeBuf,
    ]).toString("hex");
    return this._broadcast(rawTx);
  }

  private async _getUtxos(addr: string): Promise<{ txid: string; vout: number; value: number }[]> {
    try {
      const sh = addressToElectrumScriptHash(addr);
      const utxos = await fulcrumCall<Array<{ tx_hash: string; tx_pos: number; value: number }>>(
        this.wssEndpoints, "blockchain.scripthash.listunspent", [sh],
      );
      return (utxos ?? []).map((u) => ({
        txid: u.tx_hash as string,
        vout: u.tx_pos as number,
        value: u.value as number,
      }));
    } catch {
      return [];
    }
  }

  private async _broadcast(rawTx: string): Promise<{ txid: string }> {
    const txid = await fulcrumBroadcast(this.wssEndpoints, rawTx);
    return { txid };
  }
}

export const CONTRACT_TEMPLATES = {
  vault: `contract Vault(bytes20 beneficiary, int locktime) {
  function claim() {
    require(tx.time >= locktime);
    require(checkSig(sig, pubkey));
  }
}`,
};
