/**
 * x402 Payment Protocol integration for FrankyDocs.
 * 
 * x402 is an HTTP-based payment protocol built on Stacks that enables
 * machine-to-machine payments using the HTTP 402 Payment Required status code.
 * 
 * Bounty target: "Best x402 Integration" — $3,000 prize.
 * 
 * Flow:
 * 1. Client makes HTTP request to a paid resource
 * 2. Server responds with HTTP 402 + payment details (x402-payment-required header)
 * 3. Client creates a Stacks transaction to pay
 * 4. Client resends original request with x402-payment proof
 * 5. Server verifies payment and serves the resource
 * 
 * This client handles the full x402 handshake from Google Docs commands.
 */
import {
  makeSTXTokenTransfer,
  broadcastTransaction,
  AnchorMode,
  getAddressFromPrivateKey,
  PostConditionMode,
  makeContractCall,
  uintCV,
  principalCV,
  bufferCV,
  type ClarityValue,
} from "@stacks/transactions";
import { STACKS_TESTNET, STACKS_MAINNET, TransactionVersion, type StacksNetwork } from "@stacks/network";
import type { StacksClient } from "./stacks.js";

export type X402Challenge = {
  /** The resource URL */
  url: string;
  /** Payment amount in micro-STX or token smallest unit */
  amount: string;
  /** Payment recipient address */
  recipient: string;
  /** Payment token: "STX" or a contract ID for SIP-010 tokens */
  token: string;
  /** Unique challenge/payment ID */
  challengeId: string;
  /** Optional memo */
  memo?: string;
  /** Challenge expiry (ISO timestamp) */
  expiresAt?: string;
  /** x402 version */
  version?: string;
};

export type X402Receipt = {
  /** The resource URL that was paid for */
  url: string;
  /** Challenge ID */
  challengeId: string;
  /** Payment transaction ID */
  txid: string;
  /** Amount paid */
  amount: string;
  /** Token used for payment */
  token: string;
  /** Response from the paid resource */
  responseData: unknown;
  /** When the payment was made */
  paidAt: string;
};

export type X402ClientConfig = {
  network: string;
};

export class X402Client {
  private network: string;
  private _stacks?: StacksClient;

  constructor(config: X402ClientConfig) {
    this.network = config.network === "mainnet" ? "mainnet" : "testnet";
  }

  /** Bind a StacksClient for underlying STX/token operations */
  setStacksClient(stacks: StacksClient) {
    this._stacks = stacks;
  }

  private get stacks(): StacksClient {
    if (!this._stacks) throw new Error("x402: StacksClient not set. Call setStacksClient() first.");
    return this._stacks;
  }

  /**
   * Call a paid resource using the x402 protocol.
   * Handles the full 402 → pay → retry flow.
   */
  async callPaidResource(params: {
    url: string;
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    privateKeyHex: string;
  }): Promise<X402Receipt> {
    const method = params.method ?? "GET";

    // Step 1: Initial request — expect 402
    const initHeaders: Record<string, string> = {
      ...(params.headers ?? {}),
    };
    if (params.body) {
      initHeaders["content-type"] = "application/json";
    }

    const initRes = await fetch(params.url, {
      method,
      headers: initHeaders,
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });

    if (initRes.status !== 402) {
      // Not a paid resource, or already authorized
      if (initRes.ok) {
        return {
          url: params.url,
          challengeId: "free",
          txid: "",
          amount: "0",
          token: "STX",
          responseData: await initRes.json().catch(() => initRes.text()),
          paidAt: new Date().toISOString(),
        };
      }
      throw new Error(`Expected HTTP 402, got ${initRes.status}: ${await initRes.text()}`);
    }

    // Step 2: Parse x402 payment challenge
    const challenge = await this.parseChallenge(initRes);

    // Step 3: Make the payment
    const txid = await this.makePayment({
      privateKeyHex: params.privateKeyHex,
      challenge,
    });

    // Step 4: Retry with payment proof
    const paidHeaders: Record<string, string> = {
      ...initHeaders,
      "x-payment-txid": txid,
      "x-payment-challenge": challenge.challengeId,
      "x-payment-token": challenge.token,
    };

    const paidRes = await fetch(params.url, {
      method,
      headers: paidHeaders,
      body: params.body ? JSON.stringify(params.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    if (!paidRes.ok) {
      throw new Error(`Paid request failed with ${paidRes.status}: ${await paidRes.text()}`);
    }

    const responseData = await paidRes.json().catch(() => paidRes.text());

    return {
      url: params.url,
      challengeId: challenge.challengeId,
      txid,
      amount: challenge.amount,
      token: challenge.token,
      responseData,
      paidAt: new Date().toISOString(),
    };
  }

  /** Parse the 402 response into a structured challenge */
  private async parseChallenge(res: Response): Promise<X402Challenge> {
    // Try x402-specific headers first
    const paymentHeader = res.headers.get("x-payment") || res.headers.get("x402-payment-required");

    let challengeData: any;

    if (paymentHeader) {
      try {
        challengeData = JSON.parse(paymentHeader);
      } catch {
        challengeData = { raw: paymentHeader };
      }
    }

    // Fallback to response body
    if (!challengeData || (!challengeData.amount && !challengeData.recipient)) {
      try {
        challengeData = await res.json();
      } catch {
        throw new Error("Could not parse x402 payment challenge from 402 response");
      }
    }

    return {
      url: res.url,
      amount: String(challengeData.amount ?? challengeData.price ?? challengeData.priceUsdc ?? "0"),
      recipient: challengeData.recipient ?? challengeData.payTo ?? challengeData.address ?? "",
      token: challengeData.token ?? challengeData.currency ?? "STX",
      challengeId: challengeData.challengeId ?? challengeData.id ?? `x402_${Date.now()}`,
      memo: challengeData.memo,
      expiresAt: challengeData.expiresAt ?? challengeData.expires,
      version: challengeData.version ?? "1",
    };
  }

  /** Execute the payment for a challenge */
  private async makePayment(params: {
    privateKeyHex: string;
    challenge: X402Challenge;
  }): Promise<string> {
    const { challenge, privateKeyHex } = params;
    const amount = BigInt(challenge.amount);

    if (!challenge.recipient) {
      throw new Error("x402 challenge missing recipient address");
    }

    // If token is STX, send a simple STX transfer
    if (challenge.token === "STX" || challenge.token === "stx") {
      const { txid } = await this.stacks.sendStx({
        privateKeyHex,
        to: challenge.recipient,
        amountMicroStx: amount,
        memo: challenge.memo ?? `x402:${challenge.challengeId}`,
      });
      return txid;
    }

    // Otherwise, it's a SIP-010 token transfer (e.g., USDCx, sBTC)
    // Parse contract ID: "SP...address.contract-name"
    const parts = challenge.token.split(".");
    if (parts.length < 2) {
      throw new Error(`Invalid token contract ID: ${challenge.token}`);
    }
    const contractAddress = parts[0]!;
    const contractName = parts.slice(1).join(".");

    const { txid } = await this.stacks.contractCall({
      privateKeyHex,
      contractAddress,
      contractName,
      functionName: "transfer",
      functionArgs: [
        uintCV(amount),
        principalCV(challenge.recipient),
      ],
      postConditionMode: PostConditionMode.Allow,
    });

    return txid;
  }

  /**
   * Create an x402 payment server endpoint configuration.
   * This is for exposing your own FrankyDocs resources as paid endpoints.
   */
  createPaidEndpointConfig(params: {
    recipientAddress: string;
    amountMicroStx: number;
    token?: string;
    description?: string;
  }): {
    statusCode: 402;
    headers: Record<string, string>;
    body: X402Challenge;
  } {
    const challengeId = `x402_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const challenge: X402Challenge = {
      url: "",
      amount: String(params.amountMicroStx),
      recipient: params.recipientAddress,
      token: params.token ?? "STX",
      challengeId,
      memo: params.description,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      version: "1",
    };

    return {
      statusCode: 402,
      headers: {
        "x402-payment-required": JSON.stringify(challenge),
        "content-type": "application/json",
      },
      body: challenge,
    };
  }
}
