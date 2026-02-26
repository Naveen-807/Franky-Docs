import type { Repo } from "../db/repo.js";
import { decryptWithMasterKey, encryptWithMasterKey } from "./crypto.js";
import { generateEvmWallet, type EvmWalletMaterial } from "./evm.js";
import { generateStacksWallet, loadStacksWallet, type StacksWalletMaterial } from "./stacks.js";
import { privateKeyToAccount } from "viem/accounts";

export type DocSecrets = {
  evm: EvmWalletMaterial;
  stx?: StacksWalletMaterial;
};

type SecretsJson = {
  evmPrivateKeyHex: `0x${string}`;
  stxPrivateKeyHex?: string;
  stxNetwork?: string;
};

export function loadDocSecrets(params: { repo: Repo; masterKey: string; docId: string }): DocSecrets | null {
  const row = params.repo.getSecrets(params.docId);
  if (!row) return null;
  const plaintext = decryptWithMasterKey({ masterKey: params.masterKey, blob: row.encrypted_blob });
  const parsed = JSON.parse(plaintext.toString("utf8")) as SecretsJson;
  const evm = { privateKeyHex: parsed.evmPrivateKeyHex, address: privateKeyToAccount(parsed.evmPrivateKeyHex).address };
  const stx = parsed.stxPrivateKeyHex ? loadStacksWallet(parsed.stxPrivateKeyHex, parsed.stxNetwork ?? "testnet") : undefined;
  return { evm, stx };
}

export function createAndStoreDocSecrets(params: {
  repo: Repo;
  masterKey: string;
  docId: string;
  stxNetwork?: string;
}): DocSecrets {
  const evm = generateEvmWallet();
  const stxNetwork = params.stxNetwork ?? "testnet";
  const stx = generateStacksWallet(stxNetwork);
  const json: SecretsJson = {
    evmPrivateKeyHex: evm.privateKeyHex,
    stxPrivateKeyHex: stx.privateKeyHex,
    stxNetwork
  };
  const blob = encryptWithMasterKey({ masterKey: params.masterKey, plaintext: Buffer.from(JSON.stringify(json), "utf8") });
  params.repo.upsertSecrets(params.docId, blob);
  return { evm, stx };
}
