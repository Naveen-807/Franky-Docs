import { createPublicClient, createWalletClient, http, parseGwei, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem";

// Hedera Testnet EVM — https://docs.hedera.com/hedera/core-concepts/smart-contracts/evm-smart-contract-service
// Chain ID 296, HBAR native (8 decimals)
const HEDERA_TESTNET_CHAIN: Chain = {
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 8 },
  rpcUrls: { default: { http: ["https://testnet.hashio.io/api"] } }
};

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "ok", type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  }
] as const;

export interface HederaClientParams {
  rpcUrl: string;
  /** Optional ERC-20 token (e.g. wrapped USDC on Hedera) for stable transfers */
  tokenAddress?: `0x${string}`;
  maxFeeGwei?: number;
  maxPriorityFeeGwei?: number;
}

export class HederaClient {
  private publicClient;
  private chain: Chain;
  private rpcUrl: string;
  private tokenAddress: `0x${string}` | undefined;
  private maxFeePerGas: bigint;
  private maxPriorityFeePerGas: bigint;

  constructor(params: HederaClientParams) {
    this.chain = { ...HEDERA_TESTNET_CHAIN, rpcUrls: { default: { http: [params.rpcUrl] } } };
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(params.rpcUrl) });
    this.rpcUrl = params.rpcUrl;
    this.tokenAddress = params.tokenAddress;
    this.maxFeePerGas = parseGwei(String(params.maxFeeGwei ?? 100));
    this.maxPriorityFeePerGas = parseGwei(String(params.maxPriorityFeeGwei ?? 1));
  }

  /** Transfer native HBAR (8 decimals) */
  async transferHbar(params: {
    privateKeyHex: `0x${string}`;
    to: `0x${string}`;
    amountHbar: number;
  }): Promise<{ txHash: `0x${string}` }> {
    const amountWei = parseUnits(String(params.amountHbar), 8);
    const account = privateKeyToAccount(params.privateKeyHex);
    const walletClient = createWalletClient({ chain: this.chain, transport: http(this.rpcUrl), account });
    const hash = await walletClient.sendTransaction({
      to: params.to,
      value: amountWei,
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /** Transfer ERC-20 token (e.g. USDC 6 decimals) when tokenAddress is set */
  async transferToken(params: {
    privateKeyHex: `0x${string}`;
    to: `0x${string}`;
    amountRaw: bigint;
    decimals?: number;
  }): Promise<{ txHash: `0x${string}` }> {
    if (!this.tokenAddress) throw new Error("Hedera token address not configured");
    const account = privateKeyToAccount(params.privateKeyHex);
    const walletClient = createWalletClient({ chain: this.chain, transport: http(this.rpcUrl), account });
    const hash = await walletClient.writeContract({
      address: this.tokenAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [params.to, params.amountRaw],
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  /** Transfer USDC (6 decimals) when token is configured */
  async transferUsdc(params: {
    privateKeyHex: `0x${string}`;
    to: `0x${string}`;
    amountUsdc: number;
  }): Promise<{ txHash: `0x${string}` }> {
    const amount = parseUnits(String(params.amountUsdc), 6);
    return this.transferToken({
      privateKeyHex: params.privateKeyHex,
      to: params.to,
      amountRaw: amount,
      decimals: 6
    });
  }

  async sendTransaction(params: {
    privateKeyHex: `0x${string}`;
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: `0x${string}`;
    gas?: `0x${string}`;
    maxFeePerGas?: `0x${string}`;
    maxPriorityFeePerGas?: `0x${string}`;
    nonce?: `0x${string}`;
  }): Promise<{ txHash: `0x${string}` }> {
    const account = privateKeyToAccount(params.privateKeyHex);
    const walletClient = createWalletClient({ chain: this.chain, transport: http(this.rpcUrl), account });
    const parseHex = (v?: `0x${string}`) => (v ? BigInt(v) : undefined);
    const tx: any = {
      to: params.to,
      data: params.data,
      value: parseHex(params.value),
      gas: parseHex(params.gas),
      nonce: params.nonce ? Number(BigInt(params.nonce)) : undefined
    };
    if (params.maxFeePerGas) tx.maxFeePerGas = BigInt(params.maxFeePerGas);
    if (params.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = BigInt(params.maxPriorityFeePerGas);
    if (!tx.maxFeePerGas) tx.maxFeePerGas = this.maxFeePerGas;
    if (!tx.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = this.maxPriorityFeePerGas;
    const hash = await walletClient.sendTransaction(tx);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  async signMessage(params: { privateKeyHex: `0x${string}`; message: string }): Promise<{ signature: `0x${string}` }> {
    const account = privateKeyToAccount(params.privateKeyHex);
    const signature = params.message.startsWith("0x")
      ? await account.signMessage({ message: { raw: params.message as `0x${string}` } })
      : await account.signMessage({ message: params.message });
    return { signature };
  }

  /** HBAR = 8 decimals; token = 6 for USDC when configured */
  async getBalances(address: `0x${string}`): Promise<{ hbarBalance: string; tokenBalance: string }> {
    try {
      const nativeBal = await this.publicClient.getBalance({ address });
      let tokenBal = "0";
      if (this.tokenAddress) {
        const raw = await this.publicClient.readContract({
          address: this.tokenAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address]
        });
        tokenBal = formatUnits(raw as bigint, 6);
      }
      return {
        hbarBalance: formatUnits(nativeBal, 8),
        tokenBalance: tokenBal
      };
    } catch {
      return { hbarBalance: "0", tokenBalance: "0" };
    }
  }
}
