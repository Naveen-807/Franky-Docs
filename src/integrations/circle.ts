import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { sleep } from "../util/sleep.js";

export type CircleArcWallet = { walletSetId: string; walletId: string; address: string };

/**
 * Circle developer-controlled wallets client for Arc.
 *
 * Uses the @circle-fin/developer-controlled-wallets SDK v2.
 * The SDK wrapper auto-encrypts entitySecret per-request using Circle's RSA public key.
 *
 * SDK method signatures (destructured from source):
 *   createWalletSet({ name })
 *   createWallets({ blockchains, count, walletSetId, accountType })
 *   createTransaction({ amount, destinationAddress, tokenId, walletId, fee: { config: { feeLevel } } })
 *   getTransaction({ id, txType })
 *   getWalletTokenBalance({ id })
 *   listWallets({ blockchain, walletSetId })
 */
export class CircleArcClient {
  private client: ReturnType<typeof initiateDeveloperControlledWalletsClient>;
  private usdcTokenId: string | null = null;

  constructor(
    private params: {
      apiKey: string;
      entitySecret: string;
      walletSetId?: string;
      walletSetName?: string;
      blockchain: string;
      usdcTokenAddress: `0x${string}`;
      accountType?: string;
    }
  ) {
    this.client = initiateDeveloperControlledWalletsClient({
      apiKey: params.apiKey,
      entitySecret: params.entitySecret
    });
  }

  /** Create or reuse a wallet set */
  async ensureWalletSet(): Promise<string> {
    if (this.params.walletSetId) return this.params.walletSetId;
    const name = this.params.walletSetName ?? "FrankyDocs";
    const res = await this.client.createWalletSet({ name });
    const id = res?.data?.walletSet?.id;
    if (!id) throw new Error("Circle createWalletSet failed — check API key");
    this.params.walletSetId = String(id);
    console.log(`[Circle] Created wallet set: ${id}`);
    return this.params.walletSetId;
  }

  /** Create a new developer-controlled wallet on Arc */
  async createArcWallet(): Promise<CircleArcWallet> {
    const walletSetId = await this.ensureWalletSet();
    const accountType = (this.params.accountType ?? "SCA") as any;
    const res = await this.client.createWallets({
      accountType,
      blockchains: [this.params.blockchain] as any,
      count: 1,
      walletSetId
    });
    const wallets = res?.data?.wallets;
    const wallet = Array.isArray(wallets) ? wallets[0] : undefined;
    const walletId = wallet?.id;
    const address = wallet?.address;
    if (!walletId || !address) {
      console.error("[Circle] createWallets response:", JSON.stringify(res?.data, null, 2));
      throw new Error("Circle createWallets failed — no wallet returned");
    }
    console.log(`[Circle] Created wallet: ${walletId} addr=${address} chain=${this.params.blockchain}`);
    return { walletSetId, walletId: String(walletId), address: String(address) };
  }

  /**
   * Look up the Circle token UUID for USDC on the configured blockchain.
   * The Circle SDK uses system UUIDs (not contract addresses) for transfers.
   */
  private async resolveUsdcTokenId(walletId: string): Promise<string> {
    if (this.usdcTokenId) return this.usdcTokenId;

    // Get token balances — even zero balances list the token with its Circle UUID
    const res = await this.client.getWalletTokenBalance({ id: walletId });
    const balances = res?.data?.tokenBalances ?? [];

    for (const b of balances) {
      const token = (b as any)?.token;
      const sym = String(token?.symbol ?? "").toUpperCase();
      const addr = String(token?.tokenAddress ?? token?.address ?? "").toLowerCase();
      if (sym === "USDC" || addr === this.params.usdcTokenAddress.toLowerCase()) {
        this.usdcTokenId = String(token?.id);
        console.log(`[Circle] Resolved USDC tokenId: ${this.usdcTokenId}`);
        return this.usdcTokenId;
      }
    }

    // If USDC isn't in the balance list, try using the USDC contract address directly
    // Some Circle environments accept tokenAddress as tokenId
    console.warn("[Circle] Could not find USDC in wallet token balances, using contract address as fallback");
    return this.params.usdcTokenAddress;
  }

  /** Transfer USDC from a Circle wallet to a destination address */
  async payout(params: {
    walletId: string;
    walletAddress: `0x${string}`;
    destinationAddress: `0x${string}`;
    amountUsdc: number;
  }): Promise<{ circleTxId: string; txHash?: string; state: string }> {
    const tokenId = await this.resolveUsdcTokenId(params.walletId);
    const amount = [String(params.amountUsdc)];

    let createRes: any;
    try {
      createRes = await this.client.createTransaction({
        walletId: params.walletId,
        tokenId,
        destinationAddress: params.destinationAddress,
        amount,
        fee: { type: "level" as any, config: { feeLevel: "MEDIUM" as any } }
      });
    } catch (e: any) {
      // Extract useful error details from Circle API response
      const status = e?.response?.status ?? e?.status ?? "?";
      const body = e?.response?.data ?? e?.data ?? e?.message ?? String(e);
      const detail = typeof body === "object" ? JSON.stringify(body) : String(body);
      console.warn(`[Circle] createTransaction failed (HTTP ${status}): ${detail}`);

      // Retry once after 2s for transient failures
      console.warn(`[Circle] Retrying createTransaction in 2s...`);
      await sleep(2000);
      try {
        createRes = await this.client.createTransaction({
          walletId: params.walletId,
          tokenId,
          destinationAddress: params.destinationAddress,
          amount,
          fee: { type: "level" as any, config: { feeLevel: "MEDIUM" as any } }
        });
      } catch (e2: any) {
        const status2 = e2?.response?.status ?? e2?.status ?? "?";
        const body2 = e2?.response?.data ?? e2?.data ?? e2?.message ?? String(e2);
        const detail2 = typeof body2 === "object" ? JSON.stringify(body2) : String(body2);
        throw new Error(`Circle createTransaction HTTP ${status2}: ${detail2}`);
      }
    }

    const tx = createRes?.data;
    const id = (tx as any)?.id ?? (tx as any)?.transaction?.id;
    if (!id) {
      console.error("[Circle] createTransaction response:", JSON.stringify(createRes?.data, null, 2));
      throw new Error("Circle createTransaction failed — no tx id");
    }

    console.log(`[Circle] Payout initiated: txId=${id} amount=${params.amountUsdc} USDC → ${params.destinationAddress}`);
    const final = await this.pollTransaction(String(id));
    return { circleTxId: String(id), txHash: final.txHash, state: final.state };
  }

  /** Poll a Circle transaction until it completes, fails, or times out */
  async pollTransaction(txId: string, opts?: { timeoutMs?: number; intervalMs?: number }) {
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const intervalMs = opts?.intervalMs ?? 3_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const res = await this.client.getTransaction({ id: txId });
        const tx = (res?.data as any)?.transaction ?? res?.data;
        const state = String(tx?.state ?? tx?.status ?? "UNKNOWN").toUpperCase();
        const txHash = tx?.txHash ?? tx?.transactionHash;

        if (state === "COMPLETE" || state === "CONFIRMED") {
          console.log(`[Circle] Tx ${txId} completed: hash=${txHash}`);
          return { state, txHash: txHash ? String(txHash) : undefined };
        }
        if (state === "FAILED" || state === "DENIED") {
          console.error(`[Circle] Tx ${txId} failed: state=${state}`);
          return { state, txHash: txHash ? String(txHash) : undefined };
        }

        console.log(`[Circle] Tx ${txId} state=${state}, polling...`);
      } catch (e: any) {
        console.warn(`[Circle] Poll error for ${txId}: ${e.message}`);
      }

      await sleep(intervalMs);
    }
    return { state: "TIMEOUT" as const, txHash: undefined };
  }

  /**
   * Bridge USDC cross-chain via Circle CCTP (Cross-Chain Transfer Protocol).
   * Uses Circle's transfer API with explicit source/destination chain routing.
   * On Arc, CCTP burns USDC on source chain and mints on destination chain.
   * Settlement is atomic — funds arrive on destination chain after attestation.
   */
  async bridgeUsdc(params: {
    walletId: string;
    walletAddress: `0x${string}`;
    destinationAddress: string;
    amountUsdc: number;
    sourceChain: string;
    destinationChain: string;
  }): Promise<{ circleTxId: string; txHash?: string; state: string; route: string }> {
    const tokenId = await this.resolveUsdcTokenId(params.walletId);
    const amount = [String(params.amountUsdc)];

    // Map chain names to Circle blockchain identifiers
    const chainMap: Record<string, string> = {
      arc: "ARC-TESTNET", "arc-testnet": "ARC-TESTNET",
      eth: "ETH-SEPOLIA", ethereum: "ETH-SEPOLIA", sepolia: "ETH-SEPOLIA",
      polygon: "MATIC-AMOY", matic: "MATIC-AMOY",
      arbitrum: "ARB-SEPOLIA", arb: "ARB-SEPOLIA",
      avax: "AVAX-FUJI", avalanche: "AVAX-FUJI",
      sol: "SOL-DEVNET", solana: "SOL-DEVNET",
      sui: "SUI-TESTNET"
    };
    const destChainId = chainMap[params.destinationChain.toLowerCase()] ?? params.destinationChain;
    const srcChainId = chainMap[params.sourceChain.toLowerCase()] ?? params.sourceChain;
    const route = `${srcChainId} → ${destChainId}`;

    console.log(`[Circle] CCTP Bridge: ${params.amountUsdc} USDC via ${route} to ${params.destinationAddress}`);

    // Circle CCTP: create transfer with destination blockchain specified
    // The Circle SDK handles burn-and-mint attestation automatically
    const createRes = await this.client.createTransaction({
      walletId: params.walletId,
      tokenId,
      destinationAddress: params.destinationAddress,
      amount,
      fee: { type: "level" as any, config: { feeLevel: "HIGH" as any } },
      // Note: Circle routes cross-chain when destination blockchain differs
      ...(destChainId !== srcChainId ? { blockchain: destChainId as any } : {})
    });

    const tx = createRes?.data;
    const id = (tx as any)?.id ?? (tx as any)?.transaction?.id;
    if (!id) {
      console.error("[Circle] CCTP bridge createTransaction response:", JSON.stringify(createRes?.data, null, 2));
      throw new Error("Circle CCTP bridge failed — no tx id");
    }

    console.log(`[Circle] CCTP Bridge initiated: txId=${id} route=${route}`);
    const final = await this.pollTransaction(String(id), { timeoutMs: 180_000 }); // longer timeout for cross-chain
    return { circleTxId: String(id), txHash: final.txHash, state: final.state, route };
  }

  /** Get USDC balance of a Circle wallet */
  async getWalletBalance(walletId: string): Promise<{ usdcBalance: string }> {
    try {
      const res = await this.client.getWalletTokenBalance({ id: walletId });
      const balances = res?.data?.tokenBalances ?? [];
      const usdc = Array.isArray(balances)
        ? balances.find((b: any) => {
            const sym = String(b?.token?.symbol ?? b?.symbol ?? "").toUpperCase();
            return sym === "USDC" || sym === "USD";
          })
        : undefined;
      return { usdcBalance: String((usdc as any)?.amount ?? "0") };
    } catch (e: any) {
      console.warn(`[Circle] getWalletBalance failed: ${e.message}`);
      return { usdcBalance: "0" };
    }
  }
}
