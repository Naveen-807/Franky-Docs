import type { Repo } from "../db/repo.js";
import { decryptWithMasterKey, encryptWithMasterKey } from "./crypto.js";
import { generateEvmWallet, type EvmWalletMaterial } from "./evm.js";
import { generateBchWallet, loadBchWallet, type BchWalletMaterial } from "./bch.js";
import { privateKeyToAccount } from "viem/accounts";

export type DocSecrets = {
  evm: EvmWalletMaterial;
  bch?: BchWalletMaterial;
};

type SecretsJson = {
  evmPrivateKeyHex: `0x${string}`;
  bchWif?: string;
  bchNetwork?: string;
};

export function loadDocSecrets(params: { repo: Repo; masterKey: string; docId: string }): DocSecrets | null {
  const row = params.repo.getSecrets(params.docId);
  if (!row) return null;
  const plaintext = decryptWithMasterKey({ masterKey: params.masterKey, blob: row.encrypted_blob });
  const parsed = JSON.parse(plaintext.toString("utf8")) as SecretsJson;
  const evm = { privateKeyHex: parsed.evmPrivateKeyHex, address: privateKeyToAccount(parsed.evmPrivateKeyHex).address };
  const bch = parsed.bchWif ? loadBchWallet(parsed.bchWif, parsed.bchNetwork ?? "chipnet") : undefined;
  return { evm, bch };
}

export function createAndStoreDocSecrets(params: {
  repo: Repo;
  masterKey: string;
  docId: string;
  bchNetwork?: string;
}): DocSecrets {
  const evm = generateEvmWallet();
  const bchNetwork = params.bchNetwork ?? "chipnet";
  const bch = generateBchWallet(bchNetwork);
  const json: SecretsJson = {
    evmPrivateKeyHex: evm.privateKeyHex,
    bchWif: bch.wif,
    bchNetwork
  };
  const blob = encryptWithMasterKey({ masterKey: params.masterKey, plaintext: Buffer.from(JSON.stringify(json), "utf8") });
  params.repo.upsertSecrets(params.docId, blob);
  return { evm, bch };
}
