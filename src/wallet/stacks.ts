/**
 * Stacks wallet generation and management.
 * Uses @stacks/transactions for key derivation and address encoding.
 */
import { randomBytes} from "node:crypto";
import {
  getAddressFromPrivateKey,
  privateKeyToPublic,
  publicKeyToHex,
} from "@stacks/transactions";

export type StacksWalletMaterial = {
  /** Hex private key (32 bytes) */
  privateKeyHex: string;
  /** STX address (SP... for mainnet, ST... for testnet) */
  stxAddress: string;
  /** Compressed public key hex */
  publicKeyHex: string;
  /** Network name */
  network: "mainnet" | "testnet";
};

/**
 * Generate a new random Stacks wallet.
 */
export function generateStacksWallet(network: string = "testnet"): StacksWalletMaterial {
  const privKeyBytes = randomBytes(32);
  const privateKeyHex = privKeyBytes.toString("hex");

  const isMainnet = network === "mainnet";
  const networkName = isMainnet ? "mainnet" as const : "testnet" as const;
  const stxAddress = getAddressFromPrivateKey(privateKeyHex, networkName);

  const publicKeyHex = publicKeyToHex(privateKeyToPublic(privateKeyHex));

  return {
    privateKeyHex,
    stxAddress,
    publicKeyHex,
    network: networkName,
  };
}

/**
 * Load a Stacks wallet from an existing private key hex.
 */
export function loadStacksWallet(privateKeyHex: string, network: string = "testnet"): StacksWalletMaterial {
  const isMainnet = network === "mainnet";
  const networkName = isMainnet ? "mainnet" as const : "testnet" as const;
  const stxAddress = getAddressFromPrivateKey(privateKeyHex, networkName);

  const publicKeyHex = publicKeyToHex(privateKeyToPublic(privateKeyHex));

  return {
    privateKeyHex,
    stxAddress,
    publicKeyHex,
    network: networkName,
  };
}
