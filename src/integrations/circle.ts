import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { sleep } from "../util/sleep.js";

export type CircleArcWallet = { walletSetId: string; walletId: string; address: string };

export class CircleArcClient {
  private client: any;

  constructor(
    private params: {
      apiKey: string;
      entitySecret: string;
      walletSetId?: string;
      walletSetName?: string;
      blockchain: string;
      usdcTokenAddress: `0x${string}`;
      accountType?: string; // "SCA" or "EOA" depending on Circle support for Arc
    }
  ) {
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: params.apiKey,
      entitySecret: params.entitySecret
    });
  }

  async ensureWalletSet(): Promise<string> {
    if (this.params.walletSetId) return this.params.walletSetId;
    const name = this.params.walletSetName ?? "DocWallet";
    const res = await this.client.createWalletSet({ name });
    const id = res?.data?.walletSet?.id ?? res?.data?.walletSetId ?? res?.walletSetId;
    if (!id) throw new Error("Circle createWalletSet missing id");
    this.params.walletSetId = String(id);
    return this.params.walletSetId;
  }

  async createArcWallet(): Promise<CircleArcWallet> {
    const walletSetId = await this.ensureWalletSet();
    const accountType = this.params.accountType ?? "SCA";
    const res = await this.client.createWallets({
      accountType,
      blockchains: [this.params.blockchain],
      count: 1,
      walletSetId
    });
    const wallet = res?.data?.wallets?.[0] ?? res?.data?.wallets?.items?.[0] ?? res?.data?.wallet;
    const walletId = wallet?.id ?? wallet?.walletId;
    const address = wallet?.address;
    if (!walletId || !address) throw new Error("Circle createWallets missing wallet id/address");
    return { walletSetId, walletId: String(walletId), address: String(address) };
  }

  async payout(params: {
    walletAddress: `0x${string}`;
    destinationAddress: `0x${string}`;
    amountUsdc: number;
  }): Promise<{ circleTxId: string; txHash?: string; state: string }> {
    const amount = String(params.amountUsdc);
    const createPayload = {
      blockchain: this.params.blockchain,
      tokenAddress: this.params.usdcTokenAddress,
      walletAddress: params.walletAddress,
      destinationAddress: params.destinationAddress,
      amount: [amount],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } }
    };

    const createRes =
      (await this.client.createTransaction?.(createPayload)) ??
      (await this.client.createTransactions?.(createPayload));

    const id =
      createRes?.data?.id ??
      createRes?.data?.transaction?.id ??
      createRes?.data?.transactionId ??
      createRes?.id;
    if (!id) throw new Error("Circle createTransaction missing id");

    const final = await this.pollTransaction(String(id));
    return { circleTxId: String(id), txHash: final.txHash, state: final.state };
  }

  async pollTransaction(txId: string, opts?: { timeoutMs?: number; intervalMs?: number }) {
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const intervalMs = opts?.intervalMs ?? 2_500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const res =
        (await this.client.getTransaction?.({ id: txId })) ??
        (await this.client.getTransaction?.(txId)) ??
        (await this.client.getTransactions?.({ id: txId }));

      const tx = res?.data?.transaction ?? res?.data ?? res;
      const state = String(tx?.state ?? tx?.status ?? "UNKNOWN");
      const txHash = tx?.txHash ?? tx?.transactionHash ?? tx?.tx_hash;

      if (state === "COMPLETE" || state === "COMPLETED") return { state, txHash: txHash ? String(txHash) : undefined };
      if (state === "FAILED") return { state, txHash: txHash ? String(txHash) : undefined };

      await sleep(intervalMs);
    }
    return { state: "TIMEOUT" as const, txHash: undefined };
  }

  /**
   * Bridge USDC cross-chain via Circle CCTP (Cross-Chain Transfer Protocol).
   * Uses Circle's developer-controlled wallets to initiate a cross-chain transfer.
   */
  async bridgeUsdc(params: {
    walletAddress: `0x${string}`;
    destinationAddress: string;
    amountUsdc: number;
    sourceChain: string;
    destinationChain: string;
  }): Promise<{ circleTxId: string; txHash?: string; state: string }> {
    const chainMap: Record<string, string> = {
      arc: "ARC-TESTNET",
      ethereum: "ETH-SEPOLIA",
      arbitrum: "ARB-SEPOLIA",
      polygon: "MATIC-AMOY",
      sui: "SUI-TESTNET"
    };

    const destBlockchain = chainMap[params.destinationChain.toLowerCase()] ?? params.destinationChain.toUpperCase();

    // Use Circle's transfer API for cross-chain USDC bridging via CCTP
    const amount = String(params.amountUsdc);
    const createPayload: any = {
      blockchain: this.params.blockchain,
      tokenAddress: this.params.usdcTokenAddress,
      walletAddress: params.walletAddress,
      destinationAddress: params.destinationAddress,
      amount: [amount],
      fee: { type: "level", config: { feeLevel: "MEDIUM" } }
    };

    // If cross-chain, add destination blockchain for CCTP routing
    if (destBlockchain !== this.params.blockchain) {
      createPayload.destinationBlockchain = destBlockchain;
    }

    const createRes =
      (await this.client.createTransaction?.(createPayload)) ??
      (await this.client.createTransactions?.(createPayload));

    const id =
      createRes?.data?.id ??
      createRes?.data?.transaction?.id ??
      createRes?.data?.transactionId ??
      createRes?.id;
    if (!id) throw new Error("Circle bridge createTransaction missing id");

    const final = await this.pollTransaction(String(id), { timeoutMs: 180_000 });
    return { circleTxId: String(id), txHash: final.txHash, state: final.state };
  }

  /**
   * Get wallet balance via Circle API.
   */
  async getWalletBalance(walletId: string): Promise<{ usdcBalance: string }> {
    try {
      const res =
        (await this.client.getWalletTokenBalance?.({ id: walletId })) ??
        (await this.client.listWalletBallance?.({ id: walletId }));
      const balances = res?.data?.tokenBalances ?? res?.data ?? [];
      const usdc = Array.isArray(balances)
        ? balances.find((b: any) => {
            const sym = String(b?.token?.symbol ?? b?.symbol ?? "").toUpperCase();
            return sym === "USDC" || sym === "USD";
          })
        : undefined;
      return { usdcBalance: String(usdc?.amount ?? "0") };
    } catch {
      return { usdcBalance: "0" };
    }
  }
}
