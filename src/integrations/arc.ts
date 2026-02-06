import { createPublicClient, createWalletClient, http, parseGwei, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem";

const ARC_TESTNET_CHAIN: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } }
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

export class ArcClient {
  private publicClient;

  constructor(params: {
    rpcUrl: string;
    usdcAddress: `0x${string}`;
    maxFeeGwei?: number;
    maxPriorityFeeGwei?: number;
  }) {
    const chain: Chain = { ...ARC_TESTNET_CHAIN, rpcUrls: { default: { http: [params.rpcUrl] } } };
    this.publicClient = createPublicClient({ chain, transport: http(params.rpcUrl) });
    this.usdcAddress = params.usdcAddress;
    this.maxFeePerGas = parseGwei(String(params.maxFeeGwei ?? 200));
    this.maxPriorityFeePerGas = parseGwei(String(params.maxPriorityFeeGwei ?? 2));
    this.chain = chain;
    this.rpcUrl = params.rpcUrl;
  }

  private chain: Chain;
  private rpcUrl: string;
  private usdcAddress: `0x${string}`;
  private maxFeePerGas: bigint;
  private maxPriorityFeePerGas: bigint;

  async transferUsdc(params: {
    privateKeyHex: `0x${string}`;
    to: `0x${string}`;
    amountUsdc: number;
  }): Promise<{ txHash: `0x${string}` }> {
    const amount = parseUnits(String(params.amountUsdc), 6);
    const account = privateKeyToAccount(params.privateKeyHex);
    const walletClient = createWalletClient({ chain: this.chain, transport: http(this.rpcUrl), account });
    const hash = await walletClient.writeContract({
      address: this.usdcAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [params.to, amount],
      maxFeePerGas: this.maxFeePerGas,
      maxPriorityFeePerGas: this.maxPriorityFeePerGas
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  async sendTransaction(params: {
    privateKeyHex: `0x${string}`;
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: `0x${string}`;
    gas?: `0x${string}`;
    gasPrice?: `0x${string}`;
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
    if (params.gasPrice) {
      tx.gasPrice = parseHex(params.gasPrice);
    } else {
      if (params.maxFeePerGas) tx.maxFeePerGas = parseHex(params.maxFeePerGas);
      if (params.maxPriorityFeePerGas) tx.maxPriorityFeePerGas = parseHex(params.maxPriorityFeePerGas);
    }

    const hash = await walletClient.sendTransaction(tx);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return { txHash: hash };
  }

  async signMessage(params: { privateKeyHex: `0x${string}`; message: string }): Promise<{ signature: `0x${string}` }> {
    const account = privateKeyToAccount(params.privateKeyHex);
    const message = params.message;
    const signature = message.startsWith("0x")
      ? await account.signMessage({ message: { raw: message as `0x${string}` } })
      : await account.signMessage({ message });
    return { signature };
  }

  async getBalances(address: `0x${string}`): Promise<{ nativeBalance: string; usdcBalance: string }> {
    try {
      const [nativeBal, usdcBal] = await Promise.all([
        this.publicClient.getBalance({ address }),
        this.publicClient.readContract({
          address: this.usdcAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address]
        })
      ]);
      return {
        nativeBalance: formatUnits(nativeBal, 18),
        usdcBalance: formatUnits(usdcBal as bigint, 6)
      };
    } catch {
      return { nativeBalance: "0", usdcBalance: "0" };
    }
  }
}
