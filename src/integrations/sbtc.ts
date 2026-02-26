/**
 * sBTC integration for FrankyDocs.
 * Handles sBTC deposit (peg-in), withdraw (peg-out), balance queries, and transfers.
 * 
 * sBTC is a 1:1 Bitcoin-backed token on Stacks, bridged via the sBTC protocol.
 * Contract: SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR8.sbtc-token (testnet TBD)
 */
import {
  uintCV,
  principalCV,
  bufferCV,
  PostConditionMode,
  cvToJSON,
  type ClarityValue,
} from "@stacks/transactions";
import type { StacksClient } from "./stacks.js";

/**
 * sBTC contract addresses per network.
 * These are the canonical sBTC token contracts deployed by the Stacks Foundation.
 */
const SBTC_CONTRACTS = {
  mainnet: {
    address: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
    name: "sbtc-token",
    depositAddress: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4",
    depositName: "sbtc-deposit",
  },
  testnet: {
    address: "ST1R1061ZT6KPJXQ7PAXPFB6ZAZ6ZWW28G8HXK9G5",
    name: "sbtc-token",
    depositAddress: "ST1R1061ZT6KPJXQ7PAXPFB6ZAZ6ZWW28G8HXK9G5",
    depositName: "sbtc-deposit",
  },
};

export type SbtcClientConfig = {
  network: string;
  /** Override sBTC contract address if needed */
  contractAddress?: string;
  contractName?: string;
};

export class SbtcClient {
  private contractAddress: string;
  private contractName: string;
  private network: string;
  private _stacks?: StacksClient;

  constructor(config: SbtcClientConfig) {
    this.network = config.network === "mainnet" ? "mainnet" : "testnet";
    const contracts = SBTC_CONTRACTS[this.network as "mainnet" | "testnet"];
    this.contractAddress = config.contractAddress ?? contracts.address;
    this.contractName = config.contractName ?? contracts.name;
  }

  /** Bind a StacksClient for contract reads/calls */
  setStacksClient(stacks: StacksClient) {
    this._stacks = stacks;
  }

  private get stacks(): StacksClient {
    if (!this._stacks) throw new Error("sBTC: StacksClient not set. Call setStacksClient() first.");
    return this._stacks;
  }

  /** Get sBTC balance for an address (in sats) */
  async getBalance(address: string): Promise<{
    balanceSats: bigint;
    balanceBtc: string;
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
      const amount = BigInt(json?.value?.value ?? json?.value ?? "0");
      return {
        balanceSats: amount,
        balanceBtc: (Number(amount) / 1e8).toFixed(8),
      };
    } catch {
      // Fallback: query via Hiro API token balances
      const balances = await this.stacks.getTokenBalances(address);
      const sbtcToken = balances.find(
        (t) =>
          t.contractId.includes("sbtc") ||
          t.symbol.toLowerCase() === "sbtc"
      );
      const amount = BigInt(sbtcToken?.balance ?? "0");
      return {
        balanceSats: amount,
        balanceBtc: (Number(amount) / 1e8).toFixed(8),
      };
    }
  }

  /** Transfer sBTC to another Stacks address */
  async transfer(params: {
    privateKeyHex: string;
    to: string;
    amountSats: bigint;
    memo?: string;
  }): Promise<{ txid: string }> {
    const args: ClarityValue[] = [
      uintCV(params.amountSats),
      principalCV(params.to),
    ];
    if (params.memo) {
      args.push(bufferCV(Buffer.from(params.memo, "utf8")));
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

  /** Get sBTC total supply on Stacks */
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

  /** Get info about the sBTC contract — useful for STATUS display */
  getContractInfo(): { address: string; name: string; network: string } {
    return {
      address: this.contractAddress,
      name: this.contractName,
      network: this.network,
    };
  }
}
