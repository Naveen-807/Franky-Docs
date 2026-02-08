import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

export type SuiWalletMaterial = {
  suiPrivateKey: string; // sui bech32 string
  address: string;
};

export function generateSuiWallet(): SuiWalletMaterial {
  const kp = Ed25519Keypair.generate();
  const suiPrivateKey = kp.getSecretKey();
  return { suiPrivateKey, address: kp.toSuiAddress() };
}

export function loadSuiKeypair(suiPrivateKey: string): Ed25519Keypair {
  const decoded = decodeSuiPrivateKey(suiPrivateKey);
  return Ed25519Keypair.fromSecretKey(decoded.secretKey);
}

/** Transfer SUI to a destination address on Sui network */
export async function transferSui(params: {
  rpcUrl: string;
  wallet: SuiWalletMaterial;
  to: string;
  amountSui: number;
}): Promise<{ txDigest: string }> {
  const sui = new SuiClient({ url: params.rpcUrl });
  const signer = loadSuiKeypair(params.wallet.suiPrivateKey);
  const amountMist = BigInt(Math.round(params.amountSui * 1_000_000_000)); // 1 SUI = 1e9 MIST

  const tx = new Transaction();
  const [coin] = tx.splitCoins(tx.gas, [amountMist]);
  tx.transferObjects([coin], params.to);

  const result = await sui.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true }
  });

  const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
  if (!txDigest) throw new Error("SUI transfer tx missing digest");
  console.log(`[sui] Transferred ${params.amountSui} SUI → ${params.to} tx=${txDigest}`);
  return { txDigest };
}

