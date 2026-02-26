/**
 * USDCx integration for FrankyDocs.
 * USDCx is Circle's USDC stablecoin deployed on Stacks as a SIP-010 fungible token.
 * 
 * Bounty target: "Best Use of USDCx" — $3,000 prize.
 * 
 * This client handles:
 * - Balance queries via Clarity read-only calls
 * - USDCx transfers via contract-call transactions
 * - Allowance management (approve/revoke)
 * - Payment requests denominated in USDCx
 */
import {
  uintCV,
  principalCV,
  noneCV,
  someCV,
  bufferCV,
  PostConditionMode,
  cvToJSON,
  type ClarityValue,
} from "@stacks/transactions";
import type { StacksClient } from "./stacks.js";

/**
 * USDCx contract addresses on Stacks.
 * USDCx is a SIP-010 compliant fungible token deployed by Circle.
 */
const USDCX_CONTRACTS = {
  mainnet: {
    address: "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K",
    name: "token-susdt",  // placeholder — real USDCx mainnet TBA
  },
  testnet: {
    address: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
    name: "usdcx-token", // testnet USDCx contract
  },
};

export type UsdcxClientConfig = {
  network: string;
  /** Override contract address */
  contractAddress?: string;
  contractName?: string;
};

export class UsdcxClient {
  private contractAddress: string;
  private contractName: string;
  private network: string;
  private _stacks?: StacksClient;

  constructor(config: UsdcxClientConfig) {
    this.network = config.network === "mainnet" ? "mainnet" : "testnet";
    const contracts = USDCX_CONTRACTS[this.network as "mainnet" | "testnet"];
    this.contractAddress = config.contractAddress ?? contracts.address;
    this.contractName = config.contractName ?? contracts.name;
  }

  /** Bind a StacksClient for contract reads/calls */
  setStacksClient(stacks: StacksClient) {
    this._stacks = stacks;
  }

  private get stacks(): StacksClient {
    if (!this._stacks) throw new Error("USDCx: StacksClient not set. Call setStacksClient() first.");
    return this._stacks;
  }

  /** Get USDCx balance for an address (6 decimals) */
  async getBalance(address: string): Promise<{
    balanceRaw: bigint;
    balanceFormatted: string;
  }> {
    try {
      const result = await this.stacks.contractRead({
        contractAddress: this.contractAddress,
        contractName: this.contractName,
        functionName: "get-balance",
        functionArgs: [principalCV(address)],
        senderAddress: address,
      });
      const json = cvToJSON(result);
      const raw = BigInt(json?.value?.value ?? json?.value ?? "0");
      return {
        balanceRaw: raw,
        balanceFormatted: (Number(raw) / 1_000_000).toFixed(2),
      };
    } catch {
      // Fallback: query via Hiro token balances
      const balances = await this.stacks.getTokenBalances(address);
      const usdcToken = balances.find(
        (t) =>
          t.contractId.includes("usdc") ||
          t.symbol.toLowerCase().includes("usdc")
      );
      const raw = BigInt(usdcToken?.balance ?? "0");
      return {
        balanceRaw: raw,
        balanceFormatted: (Number(raw) / 1_000_000).toFixed(2),
      };
    }
  }

  /** Transfer USDCx to another Stacks address */
  async transfer(params: {
    privateKeyHex: string;
    to: string;
    amount: bigint;
    memo?: string;
  }): Promise<{ txid: string }> {
    const args: ClarityValue[] = [
      uintCV(params.amount),
      principalCV(params.to),
    ];
    if (params.memo) {
      args.push(someCV(bufferCV(Buffer.from(params.memo, "utf8"))));
    } else {
      args.push(noneCV());
    }

    return this.stacks.contractCall({
      privateKeyHex: params.privateKeyHex,
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: "transfer",
      functionArgs: args,
      postConditionMode: PostConditionMode.Allow,
    });
  }

  /** Approve a spender to transfer USDCx on behalf of the caller */
  async approve(params: {
    privateKeyHex: string;
    spender: string;
    amount: bigint;
  }): Promise<{ txid: string }> {
    return this.stacks.contractCall({
      privateKeyHex: params.privateKeyHex,
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: "approve",
      functionArgs: [principalCV(params.spender), uintCV(params.amount)],
      postConditionMode: PostConditionMode.Deny,
    });
  }

  /** Get the total supply of USDCx */
  async getTotalSupply(): Promise<bigint> {
    try {
      const result = await this.stacks.contractRead({
        contractAddress: this.contractAddress,
        contractName: this.contractName,
        functionName: "get-total-supply",
        functionArgs: [],
        senderAddress: this.contractAddress,
      });
      const json = cvToJSON(result);
      return BigInt(json?.value?.value ?? json?.value ?? "0");
    } catch {
      return 0n;
    }
  }

  /** Get contract info */
  getContractInfo(): { address: string; name: string; network: string } {
    return {
      address: this.contractAddress,
      name: this.contractName,
      network: this.network,
    };
  }

  /**
   * Create a USDCx payment URI (for QR codes / deep links).
   * Format: stacks:<address>?token=<contractId>&amount=<amount>&memo=<memo>
   */
  createPaymentUri(params: {
    toAddress: string;
    amount: number;
    memo?: string;
  }): string {
    const contractId = `${this.contractAddress}.${this.contractName}`;
    let uri = `stacks:${params.toAddress}?token=${contractId}&amount=${params.amount}`;
    if (params.memo) {
      uri += `&memo=${encodeURIComponent(params.memo)}`;
    }
    return uri;
  }
}
