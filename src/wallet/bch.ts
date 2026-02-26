import { createHash, randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";

// ── Types ──

export type BchWalletMaterial = {
  /** Wallet Import Format private key (base58check encoded) */
  wif: string;
  /** CashAddr format address (e.g. bchtest:qz...) for chipnet, bitcoincash:q... for mainnet */
  cashAddress: string;
  /** Legacy base58check address (fallback) */
  legacyAddress: string;
  /** Raw private key hex (32 bytes) */
  privateKeyHex: string;
};

// ── Base58 encoding ──

const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buf: Buffer): string {
  let num = BigInt("0x" + buf.toString("hex"));
  let result = "";
  while (num > 0n) {
    const mod = Number(num % 58n);
    result = BASE58_CHARS[mod] + result;
    num = num / 58n;
  }
  // Leading zero bytes → leading '1's
  for (const byte of buf) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}

function base58Check(payload: Buffer): string {
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return base58Encode(Buffer.concat([payload, checksum]));
}

// ── Hashing helpers ──

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

function ripemd160(data: Buffer): Buffer {
  return createHash("ripemd160").update(data).digest();
}

function hash160(data: Buffer): Buffer {
  return ripemd160(sha256(data));
}

// ── CashAddr encoding (BIP-173 variant for BCH) ──

const CASHADDR_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]): bigint {
  const generators = [
    0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n,
    0xae2eabe2a8n, 0x1e4f43e470n
  ];
  let c = 1n;
  for (const v of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v);
    for (let i = 0; i < 5; i++) {
      if ((c0 >> BigInt(i)) & 1n) {
        c ^= generators[i];
      }
    }
  }
  return c ^ 1n;
}

function prefixData(prefix: string): number[] {
  const result: number[] = [];
  for (const c of prefix) {
    result.push(c.charCodeAt(0) & 0x1f);
  }
  result.push(0); // separator
  return result;
}

function convertBits(data: Buffer, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
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
  if (pad && bits > 0) {
    result.push((acc << (toBits - bits)) & maxv);
  }
  return result;
}

function encodeCashAddr(prefix: string, hash160Buf: Buffer): string {
  // Version byte: P2PKH = 0x00, size bits for 20 bytes = 0 → version byte = 0
  const versionByte = 0x00; // P2PKH, 160-bit hash
  const payload = Buffer.concat([Buffer.from([versionByte]), hash160Buf]);
  const payloadData = convertBits(payload, 8, 5, true);

  const prefixArr = prefixData(prefix);
  const checksumInput = [...prefixArr, ...payloadData, 0, 0, 0, 0, 0, 0, 0, 0];
  const checksumValue = polymod(checksumInput);

  const checksumData: number[] = [];
  for (let i = 0; i < 8; i++) {
    checksumData.push(Number((checksumValue >> BigInt(5 * (7 - i))) & 0x1fn));
  }

  const combined = [...payloadData, ...checksumData];
  let result = prefix + ":";
  for (const v of combined) {
    result += CASHADDR_CHARSET[v];
  }
  return result;
}

// ── Wallet generation ──

export function generateBchWallet(network: string = "chipnet"): BchWalletMaterial {
  const privateKeyBytes = randomBytes(32);
  const privateKeyHex = privateKeyBytes.toString("hex");

  // Derive compressed public key using secp256k1
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true); // compressed
  const pubKeyBuf = Buffer.from(publicKeyBytes);

  // hash160 of public key
  const h160 = hash160(pubKeyBuf);

  // Legacy address (base58check)
  const legacyVersionByte = network === "mainnet" ? 0x00 : 0x6f; // mainnet vs testnet
  const legacyPayload = Buffer.concat([Buffer.from([legacyVersionByte]), h160]);
  const legacyAddress = base58Check(legacyPayload);

  // CashAddr
  const cashAddrPrefix = network === "mainnet" ? "bitcoincash" : "bchtest";
  const cashAddress = encodeCashAddr(cashAddrPrefix, h160);

  // WIF (Wallet Import Format) — compressed key
  const wifVersionByte = network === "mainnet" ? 0x80 : 0xef;
  const wifPayload = Buffer.concat([
    Buffer.from([wifVersionByte]),
    privateKeyBytes,
    Buffer.from([0x01]) // compressed flag
  ]);
  const wif = base58Check(wifPayload);

  return { wif, cashAddress, legacyAddress, privateKeyHex };
}

/** Reconstruct wallet from WIF private key */
export function loadBchWallet(wif: string, network: string = "chipnet"): BchWalletMaterial {
  // Decode base58check WIF
  const decoded = base58Decode(wif);
  // Remove version byte (1), get private key (32 bytes), skip compression flag (1 byte)
  const privateKeyBytes = decoded.subarray(1, 33);
  const privateKeyHex = privateKeyBytes.toString("hex");

  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, true);
  const pubKeyBuf = Buffer.from(publicKeyBytes);
  const h160 = hash160(pubKeyBuf);

  const legacyVersionByte = network === "mainnet" ? 0x00 : 0x6f;
  const legacyPayload = Buffer.concat([Buffer.from([legacyVersionByte]), h160]);
  const legacyAddress = base58Check(legacyPayload);

  const cashAddrPrefix = network === "mainnet" ? "bitcoincash" : "bchtest";
  const cashAddress = encodeCashAddr(cashAddrPrefix, h160);

  return { wif, cashAddress, legacyAddress, privateKeyHex };
}

function base58Decode(str: string): Buffer {
  let num = 0n;
  for (const c of str) {
    const idx = BASE58_CHARS.indexOf(c);
    if (idx < 0) throw new Error(`Invalid base58 character: ${c}`);
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");

  // Restore leading zeros
  let leadingZeros = 0;
  for (const c of str) {
    if (c !== "1") break;
    leadingZeros++;
  }

  const result = Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
  // Verify checksum
  const payload = result.subarray(0, result.length - 4);
  const checksum = result.subarray(result.length - 4);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error("Invalid WIF checksum");
  return payload;
}
