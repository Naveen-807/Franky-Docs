/**
 * Core Stacks blockchain integration.
 * Handles STX transfers, balance queries, contract calls via Hiro API + @stacks/transactions.
 */
import {
  makeSTXTokenTransfer,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  getAddressFromPrivateKey,
  makeContractCall,
  fetchCallReadOnlyFunction,
  ClarityType,
  uintCV,
  stringAsciiCV,
  stringUtf8CV,
  principalCV,
  bufferCV,
  cvToJSON,
  type ClarityValue,
} from "@stacks/transactions";
import { STACKS_TESTNET, STACKS_MAINNET, type StacksNetwork } from "@stacks/network";

export type StacksClientConfig = {
  network: string;
  apiUrl?: string;
};

type NetworkLiteral = "mainnet" | "testnet";

export class StacksClient {
  private networkConfig: StacksNetwork;
  private networkLit: NetworkLiteral;
  private apiUrl: string;

  constructor(config: StacksClientConfig) {
    if (config.network === "mainnet") {
      this.networkConfig = STACKS_MAINNET;
      this.networkLit = "mainnet";
      this.apiUrl = config.apiUrl ?? "https://api.hiro.so";
    } else {
      this.networkConfig = STACKS_TESTNET;
      this.networkLit = "testnet";
      this.apiUrl = config.apiUrl ?? "https://api.testnet.hiro.so";
    }
  }

  /** Get STX balance for an address */
  async getBalance(address: string): Promise<{
    stx: bigint;
    stxFormatted: string;
    locked: bigint;
  }> {
    const res = await fetch(`${this.apiUrl}/extended/v1/address/${address}/stx`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Hiro API error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as {
      balance: string;
      total_sent: string;
      total_received: string;
      locked: string;
    };
    const stx = BigInt(data.balance);
    const locked = BigInt(data.locked);
    // STX has 6 decimals
    const stxFormatted = (Number(stx) / 1_000_000).toFixed(6);
    return { stx, stxFormatted, locked };
  }

  /** Get all fungible token balances for an address */
  async getTokenBalances(address: string): Promise<
    Array<{
      contractId: string;
      balance: string;
      decimals: number;
      symbol: string;
      name: string;
    }>
  > {
    const res = await fetch(`${this.apiUrl}/extended/v1/address/${address}/balances`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Hiro API error ${res.status}`);
    const data = (await res.json()) as {
      fungible_tokens: Record<
        string,
        { balance: string; total_sent: string; total_received: string }
      >;
    };
    const results: Array<{
      contractId: string;
      balance: string;
      decimals: number;
      symbol: string;
      name: string;
    }> = [];
    for (const [contractId, info] of Object.entries(data.fungible_tokens)) {
      if (BigInt(info.balance) === 0n) continue;
      // Extract name from contract ID: SP...<contractName>::<assetName>
      const parts = contractId.split("::");
      const symbol = parts[1] ?? contractId.split(".").pop() ?? contractId;
      results.push({
        contractId,
        balance: info.balance,
        decimals: 6, // default, will be resolved per-token
        symbol,
        name: symbol,
      });
    }
    return results;
  }

  /** Send STX to an address */
  async sendStx(params: {
    privateKeyHex: string;
    to: string;
    amountMicroStx: bigint;
    memo?: string;
  }): Promise<{ txid: string }> {
    const senderAddress = getAddressFromPrivateKey(
      params.privateKeyHex,
      this.networkLit
    );
    const nonce = await this.getAccountNonce(senderAddress);

    const txOptions = {
      recipient: params.to,
      amount: params.amountMicroStx,
      senderKey: params.privateKeyHex,
      network: this.networkLit,
      memo: params.memo ?? "",
      nonce: BigInt(nonce),
      anchorMode: AnchorMode.Any,
      fee: 2000n, // safe default fee in micro-STX
    };

    const tx = await makeSTXTokenTransfer(txOptions);
    const result = await broadcastTransaction({ transaction: tx, network: this.networkLit });

    if (typeof result === "string") {
      return { txid: result };
    }
    if ("txid" in result) {
      return { txid: result.txid as string };
    }
    if ("error" in result) {
      throw new Error(`Broadcast failed: ${(result as any).reason ?? JSON.stringify(result)}`);
    }
    // result is the txid string
    return { txid: String(result) };
  }

  /** Call a Clarity smart contract function (write) */
  async contractCall(params: {
    privateKeyHex: string;
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: ClarityValue[];
    postConditionMode?: PostConditionMode;
  }): Promise<{ txid: string }> {
    const senderAddress = getAddressFromPrivateKey(
      params.privateKeyHex,
      this.networkLit
    );
    const nonce = await this.getAccountNonce(senderAddress);

    const txOptions = {
      contractAddress: params.contractAddress,
      contractName: params.contractName,
      functionName: params.functionName,
      functionArgs: params.functionArgs,
      senderKey: params.privateKeyHex,
      network: this.networkLit,
      nonce: BigInt(nonce),
      anchorMode: AnchorMode.Any,
      postConditionMode: params.postConditionMode ?? PostConditionMode.Deny,
      fee: 5000n,
    };

    const tx = await makeContractCall(txOptions);
    const result = await broadcastTransaction({ transaction: tx, network: this.networkLit });

    if (typeof result === "string") {
      return { txid: result };
    }
    if ("txid" in result) {
      return { txid: result.txid as string };
    }
    if ("error" in result) {
      throw new Error(`Contract call broadcast failed: ${(result as any).reason ?? JSON.stringify(result)}`);
    }
    return { txid: String(result) };
  }

  /** Read a Clarity smart contract function (read-only, no gas) */
  async contractRead(params: {
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: ClarityValue[];
    senderAddress: string;
  }): Promise<ClarityValue> {
    const result = await fetchCallReadOnlyFunction({
      contractAddress: params.contractAddress,
      contractName: params.contractName,
      functionName: params.functionName,
      functionArgs: params.functionArgs,
      senderAddress: params.senderAddress,
      network: this.networkLit,
    });
    return result;
  }

  /** Get recent transaction history for an address */
  async getTransactionHistory(
    address: string,
    limit = 10
  ): Promise<
    Array<{
      txid: string;
      type: string;
      status: string;
      amount: string;
      sender: string;
      recipient: string;
      timestamp: number;
    }>
  > {
    const res = await fetch(
      `${this.apiUrl}/extended/v1/address/${address}/transactions?limit=${limit}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) throw new Error(`Hiro API error ${res.status}`);
    const data = (await res.json()) as {
      results: Array<{
        tx_id: string;
        tx_type: string;
        tx_status: string;
        token_transfer?: { amount: string; recipient_address: string };
        sender_address: string;
        burn_block_time: number;
      }>;
    };
    return data.results.map((tx) => ({
      txid: tx.tx_id,
      type: tx.tx_type,
      status: tx.tx_status,
      amount: tx.token_transfer?.amount ?? "0",
      sender: tx.sender_address,
      recipient: tx.token_transfer?.recipient_address ?? "",
      timestamp: tx.burn_block_time,
    }));
  }

  /** Get current STX price from CoinGecko */
  async getStxPrice(): Promise<number | null> {
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd",
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, Record<string, number>>;
      return data?.blockstack?.usd ?? null;
    } catch {
      return null;
    }
  }

  /** Get account nonce for transaction building */
  private async getAccountNonce(address: string): Promise<number> {
    const res = await fetch(
      `${this.apiUrl}/extended/v1/address/${address}/nonces`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`Failed to get nonce: ${res.status}`);
    const data = (await res.json()) as {
      possible_next_nonce: number;
      last_executed_tx_nonce: number;
    };
    return data.possible_next_nonce;
  }

  /** Get transaction status */
  async getTransactionStatus(txid: string): Promise<{
    status: string;
    block_height?: number;
  }> {
    const res = await fetch(`${this.apiUrl}/extended/v1/tx/${txid}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`Hiro API error ${res.status}`);
    const data = (await res.json()) as {
      tx_status: string;
      block_height?: number;
    };
    return { status: data.tx_status, block_height: data.block_height };
  }

  /** Get the API URL for external use */
  getApiUrl(): string {
    return this.apiUrl;
  }
}
