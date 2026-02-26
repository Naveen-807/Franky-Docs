/**
 * BCH Client — lightweight Bitcoin Cash integration for Chipnet testnet.
 * Uses Fulcrum ElectrumX WebSocket protocol for balance/UTXO queries and
 * transaction broadcasting. No external BCH library needed.
 */

import { createHash as ch } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  fulcrumCall,
  fulcrumBroadcast,
  getWssEndpoints,
  addressToElectrumScriptHash,
  CHIPNET_FULCRUM_WSS,
  MAINNET_FULCRUM_WSS,
} from "./fulcrum.js";

export interface BchClientParams {
  restUrl: string; // kept for config compatibility (not actively used)
  network?: string; // chipnet | mainnet | testnet3
}

export interface BchUtxo {
  txid: string;
  vout: number;
  value: number; // satoshis
  height: number;
}

export interface BchBalance {
  confirmed: number; // satoshis
  unconfirmed: number; // satoshis
  bchFormatted: string; // human-readable BCH amount
}

// ── Fulcrum WebSocket RPC helper (imported from ./fulcrum.ts) ──
// fulcrumCall, addressToElectrumScriptHash, fulcrumBroadcast are shared

export class BchClient {
  private restUrl: string;
  private network: string;
  private wssEndpoints: string[];

  constructor(params: BchClientParams) {
    this.restUrl = params.restUrl.replace(/\/+$/, "");
    this.network = params.network ?? "chipnet";
    this.wssEndpoints = this.network === "mainnet" ? MAINNET_FULCRUM_WSS : CHIPNET_FULCRUM_WSS;
  }

  /** Get balance for a BCH address via Fulcrum ElectrumX WebSocket */
  async getBalance(address: string): Promise<BchBalance> {
    try {
      const scriptHash = addressToElectrumScriptHash(address);
      const result = await fulcrumCall<{ confirmed: number; unconfirmed: number }>(
        this.wssEndpoints,
        "blockchain.scripthash.get_balance",
        [scriptHash],
      );
      const confirmed = result?.confirmed ?? 0;
      const unconfirmed = result?.unconfirmed ?? 0;
      const totalSats = confirmed + unconfirmed;
      return {
        confirmed,
        unconfirmed,
        bchFormatted: (totalSats / 1e8).toFixed(8),
      };
    } catch (e) {
      console.error(`[bch] Balance error:`, (e as Error).message);
      return { confirmed: 0, unconfirmed: 0, bchFormatted: "0" };
    }
  }

  /** Get UTXOs for a BCH address via Fulcrum */
  async getUtxos(address: string): Promise<BchUtxo[]> {
    try {
      const scriptHash = addressToElectrumScriptHash(address);
      const result = await fulcrumCall<Array<{ tx_hash: string; tx_pos: number; value: number; height: number }>>(
        this.wssEndpoints,
        "blockchain.scripthash.listunspent",
        [scriptHash],
      );
      return (result ?? []).map((u) => ({
        txid: u.tx_hash,
        vout: u.tx_pos,
        value: u.value,
        height: u.height ?? 0,
      }));
    } catch (e) {
      console.error(`[bch] UTXO fetch error:`, (e as Error).message);
      return [];
    }
  }

  /** Send BCH from one address to another.
   *  This builds a raw transaction, signs it, and broadcasts.
   *  Returns the txid on success.
   *
   *  For hackathon demo purposes, we use a simplified single-input approach.
   *  Production would need proper coin selection and change handling.
   */
  async sendBch(params: {
    privateKeyHex: string;
    fromAddress: string;
    to: string;
    amountSats: number;
  }): Promise<{ txid: string }> {
    // For the hackathon demo, we use the REST API to build and broadcast
    // We'll construct the raw transaction manually using the UTXO set

    const utxos = await this.getUtxos(params.fromAddress);
    if (utxos.length === 0) {
      throw new Error("No UTXOs available — wallet has no confirmed funds");
    }

    // Simple coin selection: use all UTXOs
    const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);
    const fee = 400; // ~400 sats for a simple P2PKH tx (1-2 inputs, 2 outputs)
    const amountSats = params.amountSats;

    if (totalInput < amountSats + fee) {
      throw new Error(
        `Insufficient funds: have ${totalInput} sats, need ${amountSats + fee} sats (${amountSats} + ${fee} fee)`
      );
    }

    const change = totalInput - amountSats - fee;

    // Build raw transaction hex using our lightweight TX builder
    const rawTx = buildRawTransaction({
      privateKeyHex: params.privateKeyHex,
      utxos,
      outputs: [
        { address: params.to, valueSats: amountSats },
        ...(change > 546 ? [{ address: params.fromAddress, valueSats: change }] : [])
      ]
    });

    // Broadcast via Fulcrum ElectrumX WebSocket
    const txid = await this.broadcast(rawTx);
    console.log(`[bch] Sent ${amountSats} sats → ${params.to} txid=${txid}`);
    return { txid };
  }

  /** Broadcast a raw transaction hex via Fulcrum */
  async broadcast(rawTxHex: string): Promise<string> {
    try {
      return await fulcrumBroadcast(this.wssEndpoints, rawTxHex);
    } catch (e) {
      throw new Error(`Broadcast failed: ${(e as Error).message}`);
    }
  }

  /** Get transaction details via Fulcrum */
  async getTransaction(txid: string): Promise<any> {
    try {
      return await fulcrumCall(
        this.wssEndpoints,
        "blockchain.transaction.get",
        [txid, true], // verbose=true
      );
    } catch {
      return null;
    }
  }

  /** Get block explorer URL for a transaction */
  explorerUrl(txid: string): string {
    if (this.network === "mainnet") {
      return `https://blockchair.com/bitcoin-cash/transaction/${txid}`;
    }
    return `https://chipnet.chaingraph.cash/tx/${txid}`;
  }

  /** Get token UTXOs for a BCH address (CashTokens) via Fulcrum */
  async getTokenUtxos(address: string): Promise<BchTokenUtxo[]> {
    try {
      const scriptHash = addressToElectrumScriptHash(address);
      // Fulcrum supports blockchain.scripthash.listunspent which returns token_data on CashToken UTXOs
      const utxos = await fulcrumCall<Array<{
        tx_hash: string; tx_pos: number; value: number; height: number;
        token_data?: { category: string; amount: string; nft?: { capability: string; commitment: string } };
      }>>(
        this.wssEndpoints,
        "blockchain.scripthash.listunspent",
        [scriptHash],
      );
      const tokenUtxos: BchTokenUtxo[] = [];
      for (const u of utxos ?? []) {
        if (u.token_data) {
          tokenUtxos.push({
            txid: u.tx_hash,
            vout: u.tx_pos,
            value: u.value,
            tokenCategory: u.token_data.category ?? "",
            tokenAmount: BigInt(u.token_data.amount ?? "0"),
          });
        }
      }
      return tokenUtxos;
    } catch (e) {
      console.error(`[bch] Token UTXO fetch error:`, (e as Error).message);
      return [];
    }
  }

  /** Issue a new CashToken (fungible) via genesis transaction.
   *  The token category = txid of the first input being spent.
   */
  async issueToken(params: {
    privateKeyHex: string;
    fromAddress: string;
    supply: bigint;
    recipientAddress: string;
    feeSats?: number;
  }): Promise<{ txid: string; tokenCategory: string }> {
    const utxos = await this.getUtxos(params.fromAddress);
    if (utxos.length === 0) throw new Error("No UTXOs available for token issuance");

    const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);
    const fee = params.feeSats ?? 600;
    const tokenOutputSats = 1000; // dust for token output
    if (totalInput < tokenOutputSats + fee) {
      throw new Error(`Insufficient funds for token issuance: have ${totalInput} sats, need ${tokenOutputSats + fee}`);
    }
    const change = totalInput - tokenOutputSats - fee;

    // Token category = first input txid (big-endian hex for display)
    const tokenCategory = utxos[0]!.txid;

    const tokenOutputs: CashTokenOutput[] = [{
      address: params.recipientAddress,
      valueSats: tokenOutputSats,
      tokenCategory,
      tokenAmount: params.supply,
      tokenBitfield: 0x22 // minting + fungible
    }];

    const rawTx = buildRawTransaction({
      privateKeyHex: params.privateKeyHex,
      utxos,
      outputs: change > 546 ? [{ address: params.fromAddress, valueSats: change }] : [],
      tokenOutputs
    });

    const txid = await this.broadcast(rawTx);
    console.log(`[bch] Token issued: category=${tokenCategory} supply=${params.supply} txid=${txid}`);
    return { txid, tokenCategory };
  }

  /** Send CashTokens to another address */
  async sendToken(params: {
    privateKeyHex: string;
    fromAddress: string;
    to: string;
    tokenCategory: string;
    tokenAmount: bigint;
  }): Promise<{ txid: string }> {
    const tokenUtxos = await this.getTokenUtxos(params.fromAddress);
    const matchingUtxos = tokenUtxos.filter(u => u.tokenCategory === params.tokenCategory);
    if (matchingUtxos.length === 0) throw new Error(`No token UTXOs found for category ${params.tokenCategory}`);

    const totalTokens = matchingUtxos.reduce((sum, u) => sum + u.tokenAmount, 0n);
    if (totalTokens < params.tokenAmount) {
      throw new Error(`Insufficient token balance: have ${totalTokens}, need ${params.tokenAmount}`);
    }

    // Also need regular UTXOs for fees
    const plainUtxos = await this.getUtxos(params.fromAddress);
    const fee = 600;
    const tokenOutputSats = 1000; // dust for token output
    const totalBchInput = plainUtxos.reduce((sum, u) => sum + u.value, 0)
      + matchingUtxos.reduce((sum, u) => sum + u.value, 0);
    if (totalBchInput < tokenOutputSats + fee) {
      throw new Error(`Insufficient BCH for token transfer fees: have ${totalBchInput} sats`);
    }
    const bchChange = totalBchInput - tokenOutputSats - fee;

    // Combine all UTXOs as inputs (token UTXOs first)
    const allInputs: Array<{ txid: string; vout: number; value: number }> = [
      ...matchingUtxos.map(u => ({ txid: u.txid, vout: u.vout, value: u.value })),
      ...plainUtxos
    ];

    const tokenOutputs: CashTokenOutput[] = [{
      address: params.to,
      valueSats: tokenOutputSats,
      tokenCategory: params.tokenCategory,
      tokenAmount: params.tokenAmount,
      tokenBitfield: 0x10 // fungible-only
    }];

    // Token change output if needed
    const tokenChange = totalTokens - params.tokenAmount;
    if (tokenChange > 0n) {
      tokenOutputs.push({
        address: params.fromAddress,
        valueSats: 546,
        tokenCategory: params.tokenCategory,
        tokenAmount: tokenChange,
        tokenBitfield: 0x10
      });
    }

    const rawTx = buildRawTransaction({
      privateKeyHex: params.privateKeyHex,
      utxos: allInputs,
      outputs: bchChange > 546 ? [{ address: params.fromAddress, valueSats: bchChange }] : [],
      tokenOutputs
    });

    const txid = await this.broadcast(rawTx);
    console.log(`[bch] Token sent: ${params.tokenAmount} of ${params.tokenCategory.slice(0, 12)}… → ${params.to} txid=${txid}`);
    return { txid };
  }

  /** Get transaction history for an address */
  async getHistory(address: string): Promise<Array<{ tx_hash: string; height: number }>> {
    try {
      const scriptHash = addressToElectrumScriptHash(address);
      return await fulcrumCall<Array<{ tx_hash: string; height: number }>>(
        this.wssEndpoints,
        "blockchain.scripthash.get_history",
        [scriptHash],
      ) ?? [];
    } catch (e) {
      console.error(`[bch] History fetch error:`, (e as Error).message);
      return [];
    }
  }
}

export interface BchTokenUtxo {
  txid: string;
  vout: number;
  value: number;
  tokenCategory: string;
  tokenAmount: bigint;
}

export interface CashTokenOutput {
  address: string;
  valueSats: number;
  tokenCategory: string; // 32-byte hex (big-endian display)
  tokenAmount: bigint;
  tokenBitfield: number; // 0x10 = fungible-only, 0x22 = minting genesis
}

// ── Raw Transaction Builder (P2PKH) ──

const createHash = ch; // re-alias from top-level import

function sha256d(data: Buffer): Buffer {
  return createHash("sha256").update(
    createHash("sha256").update(data).digest()
  ).digest();
}

function sha256Single(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

function ripemd160Hash(data: Buffer): Buffer {
  return createHash("ripemd160").update(data).digest();
}

function hash160(data: Buffer): Buffer {
  return ripemd160Hash(sha256Single(data));
}

/** Decode a CashAddr or legacy address to a 20-byte pubkey hash */
function addressToHash160(address: string): Buffer {
  // If it's a CashAddr (contains ":" prefix), decode it
  if (address.includes(":")) {
    return decodeCashAddr(address);
  }
  // Otherwise assume legacy base58check
  return decodeLegacyAddress(address);
}

function decodeLegacyAddress(address: string): Buffer {
  const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const c of address) {
    const idx = BASE58_CHARS.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58 char: ${c}`);
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  let leadingZeros = 0;
  for (const c of address) {
    if (c !== "1") break;
    leadingZeros++;
  }
  const full = Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
  // Skip version byte (1), take 20 bytes hash
  return full.subarray(1, 21);
}

const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function decodeCashAddr(address: string): Buffer {
  const parts = address.split(":");
  const payload = parts[parts.length - 1]; // take part after ':'

  const values: number[] = [];
  for (const c of payload) {
    const idx = CASHADDR_CHARSET.indexOf(c);
    if (idx < 0) throw new Error(`Invalid CashAddr character: ${c}`);
    values.push(idx);
  }

  // Remove 8 checksum values
  const data5bit = values.slice(0, values.length - 8);

  // Convert 5-bit to 8-bit
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  for (const v of data5bit) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }

  // First byte is version, rest is hash160
  return Buffer.from(result.slice(1, 21));
}

interface TxInput {
  txid: string;
  vout: number;
  value: number;
}

interface TxOutput {
  address: string;
  valueSats: number;
}

function buildRawTransaction(params: {
  privateKeyHex: string;
  utxos: TxInput[];
  outputs: TxOutput[];
  tokenOutputs?: CashTokenOutput[];
}): string {
  const { privateKeyHex, utxos, outputs, tokenOutputs = [] } = params;

  // Get public key
  const privKeyBuf = Buffer.from(privateKeyHex, "hex");
  const pubKeyBytes = secp256k1.getPublicKey(privKeyBuf, true); // compressed
  const pubKey = Buffer.from(pubKeyBytes);
  const pubKeyHash = hash160(pubKey);

  // Build the unsigned transaction first, then sign each input

  // Version (4 bytes, little-endian)
  const version = Buffer.from([0x02, 0x00, 0x00, 0x00]); // version 2

  // Input count (varint)
  const inputCount = encodeVarint(utxos.length);

  // Total output count = regular + token outputs
  const totalOutputCount = outputs.length + tokenOutputs.length;
  const outputCount = encodeVarint(totalOutputCount);

  // Build output scripts
  const outputBuffers: Buffer[] = [];

  // Token outputs first (they need to be at the beginning for CashTokens rules)
  for (const tout of tokenOutputs) {
    const script = buildCashTokensOutputScript(tout);
    const valueBuf = Buffer.alloc(8);
    valueBuf.writeBigUInt64LE(BigInt(tout.valueSats));
    const scriptLen = encodeVarint(script.length);
    outputBuffers.push(Buffer.concat([valueBuf, scriptLen, script]));
  }

  // Regular P2PKH outputs
  for (const out of outputs) {
    const h160 = addressToHash160(out.address);
    // P2PKH script: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
    const script = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      h160,
      Buffer.from([0x88, 0xac])
    ]);
    const valueBuf = Buffer.alloc(8);
    valueBuf.writeBigUInt64LE(BigInt(out.valueSats));
    const scriptLen = encodeVarint(script.length);
    outputBuffers.push(Buffer.concat([valueBuf, scriptLen, script]));
  }
  const allOutputs = Buffer.concat(outputBuffers);

  // Locktime
  const locktime = Buffer.from([0x00, 0x00, 0x00, 0x00]);

  // Sign each input (BCH uses BIP-143 sighash for replay protection)
  const signedInputs: Buffer[] = [];

  // Precompute BIP-143 components
  const hashPrevouts = sha256d(Buffer.concat(
    utxos.map(u => {
      const txidBuf = Buffer.from(u.txid, "hex").reverse();
      const voutBuf = Buffer.alloc(4);
      voutBuf.writeUInt32LE(u.vout);
      return Buffer.concat([txidBuf, voutBuf]);
    })
  ));

  const hashSequence = sha256d(Buffer.concat(
    utxos.map(() => Buffer.from([0xff, 0xff, 0xff, 0xff]))
  ));

  const hashOutputs = sha256d(allOutputs);

  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];
    const txidBuf = Buffer.from(utxo.txid, "hex").reverse();
    const voutBuf = Buffer.alloc(4);
    voutBuf.writeUInt32LE(utxo.vout);

    // scriptCode for P2PKH
    const scriptCode = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      pubKeyHash,
      Buffer.from([0x88, 0xac])
    ]);
    const scriptCodeLen = encodeVarint(scriptCode.length);

    const valueBuf = Buffer.alloc(8);
    valueBuf.writeBigUInt64LE(BigInt(utxo.value));

    const sequence = Buffer.from([0xff, 0xff, 0xff, 0xff]);

    // BIP-143 sighash preimage (with SIGHASH_ALL | SIGHASH_FORKID)
    const sighashType = 0x41; // SIGHASH_ALL | SIGHASH_FORKID (0x40)
    const sighashTypeBuf = Buffer.alloc(4);
    sighashTypeBuf.writeUInt32LE(sighashType);

    const preimage = Buffer.concat([
      version,
      hashPrevouts,
      hashSequence,
      txidBuf, voutBuf,
      scriptCodeLen, scriptCode,
      valueBuf,
      sequence,
      hashOutputs,
      locktime,
      sighashTypeBuf
    ]);

    const sighash = sha256d(preimage);

    // Sign with secp256k1
    const sigObj = secp256k1.sign(sighash, privKeyBuf);
    const derSig = sigObj.toDERRawBytes();
    // Append sighash type byte
    const sigWithType = Buffer.concat([Buffer.from(derSig), Buffer.from([sighashType])]);

    // Build signed input
    const sigScript = Buffer.concat([
      Buffer.from([sigWithType.length]),
      sigWithType,
      Buffer.from([pubKey.length]),
      pubKey
    ]);
    const sigScriptLen = encodeVarint(sigScript.length);

    signedInputs.push(Buffer.concat([
      txidBuf, voutBuf,
      sigScriptLen, sigScript,
      sequence
    ]));
  }

  // Assemble final transaction
  const rawTx = Buffer.concat([
    version,
    inputCount,
    ...signedInputs,
    outputCount,
    allOutputs,
    locktime
  ]);

  return rawTx.toString("hex");
}

function encodeVarint(n: number): Buffer {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xfe;
  buf.writeUInt32LE(n, 1);
  return buf;
}

/** Encode a bigint as a Bitcoin varint (used for CashTokens fungible amount) */
function encodeTokenVarint(n: bigint): Buffer {
  if (n < 0xfdn) {
    return Buffer.from([Number(n)]);
  }
  if (n <= 0xffffn) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(Number(n), 1);
    return buf;
  }
  if (n <= 0xffffffffn) {
    const buf = Buffer.alloc(5);
    buf[0] = 0xfe;
    buf.writeUInt32LE(Number(n), 1);
    return buf;
  }
  const buf = Buffer.alloc(9);
  buf[0] = 0xff;
  buf.writeBigUInt64LE(n, 1);
  return buf;
}

/**
 * Build a CashTokens output script (CHIP-2022-02).
 * Format: 0xef | category (32 bytes LE) | bitfield | varint(amount) | P2PKH script
 */
function buildCashTokensOutputScript(out: CashTokenOutput): Buffer {
  const h160 = addressToHash160(out.address);
  // P2PKH locking script
  const p2pkh = Buffer.concat([
    Buffer.from([0x76, 0xa9, 0x14]),
    h160,
    Buffer.from([0x88, 0xac])
  ]);

  // Token prefix: 0xef + 32 bytes category (little-endian) + bitfield + varint(amount)
  const categoryLE = Buffer.from(out.tokenCategory, "hex").reverse();
  const amountVarint = encodeTokenVarint(out.tokenAmount);

  return Buffer.concat([
    Buffer.from([0xef]),          // CashTokens prefix
    categoryLE,                    // 32-byte category ID (LE)
    Buffer.from([out.tokenBitfield]), // bitfield: 0x10 = fungible, 0x22 = minting+fungible
    amountVarint,                  // fungible amount (varint)
    p2pkh                          // standard P2PKH script
  ]);
}
