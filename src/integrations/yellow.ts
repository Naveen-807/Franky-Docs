import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256 } from "viem";

export type YellowQuorumSignature = { signer: string; signature: `0x${string}` };

/**
 * Off-chain allocation entry: tracks each participant's USDC balance in the state channel.
 * Allocations always represent the FINAL state — the clearnode computes deltas internally.
 */
export type YellowAllocation = {
  participant: string;
  asset: string;
  amount: string;
};

/**
 * Yellow NitroRPC (0.4) client.
 *
 * Notes:
 * - NitroRPC request payload is `{ req: [id, method, params, timestamp], sig: ["0x..", ...] }`.
 * - `sig` contains ECDSA signatures over `keccak256(JSON.stringify(req))`.
 * - For multi-party methods, pass multiple `sig` entries (quorum / participants).
 */
export class NitroRpcYellowClient {
  private requestId = 1;
  private ws: WebSocket | null = null;
  private wsReady: Promise<void> | null = null;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timeout: NodeJS.Timeout }>();

  constructor(
    private rpcUrl: string,
    private opts?: {
      defaultApplication?: string;
    }
  ) {}

  async createAppSession(params: {
    signerPrivateKeysHex: Array<`0x${string}`>;
    definition: unknown;
    sessionData?: string;
    allocations?: YellowAllocation[];
  }): Promise<{ appSessionId: string }> {
    const res = await this.callSigned({
      method: "create_app_session",
      params: { definition: params.definition, allocations: params.allocations ?? [], session_data: params.sessionData ?? "" },
      signerPrivateKeysHex: params.signerPrivateKeysHex
    });
    const appSessionId = res?.app_session_id ?? res?.appSessionId;
    if (!appSessionId) throw new Error("Yellow create_app_session missing app_session_id");
    return { appSessionId };
  }

  async submitAppState(params: {
    signerPrivateKeysHex: Array<`0x${string}`>;
    appSessionId: string;
    version: number;
    intent: string;
    sessionData: string;
    allocations?: YellowAllocation[];
  }): Promise<{ version: number }> {
    const res = await this.callSigned({
      method: "submit_app_state",
      params: {
        app_session_id: params.appSessionId,
        intent: params.intent,
        version: params.version,
        allocations: params.allocations ?? [],
        session_data: params.sessionData
      },
      signerPrivateKeysHex: params.signerPrivateKeysHex
    });
    const version = Number(res?.version ?? params.version);
    return { version };
  }

  async authRequest(params: {
    address: `0x${string}`;
    sessionKeyAddress: `0x${string}`;
    application?: string;
    scope: string;
    allowances?: unknown;
    expiresAt: number;
  }): Promise<any> {
    return this.callUnsigned({
      method: "auth_request",
      params: {
        application: params.application ?? this.opts?.defaultApplication ?? "DocWallet",
        scope: params.scope,
        address: params.address,
        session_key: params.sessionKeyAddress,
        expires_at: params.expiresAt,
        allowances: params.allowances ?? []
      }
    });
  }

  async authVerify(params: {
    signature: `0x${string}`;
    challengeMessage: string;
    jwtToken?: string;
  }): Promise<any> {
    return this.callSigned({
      method: "auth_verify",
      params: { challenge: params.challengeMessage, ...(params.jwtToken ? { jwt_token: params.jwtToken } : {}) },
      // When jwt_token is omitted, Yellow expects the EIP-712 signature in the NitroRPC `sig` field.
      signerSignatures: [params.signature]
    });
  }

  // --- Gasless Approval Layer (Yellow as core approval pipeline) ---

  /**
   * Submit a gasless approval for a command through the Yellow state channel.
   * This records an approval intent on-channel without any on-chain gas cost.
   */
  async submitGaslessApproval(params: {
    signerPrivateKeysHex: Array<`0x${string}`>;
    appSessionId: string;
    version: number;
    cmdId: string;
    command: string;
    approver: string;
    sessionData?: string;
    allocations?: YellowAllocation[];
  }): Promise<{ version: number; intentId: string }> {
    const intent = `APPROVE:${params.cmdId}:${params.command}:${params.approver}:${Date.now()}`;
    const stateHash = keccak256(new TextEncoder().encode(intent));
    const res = await this.submitAppState({
      signerPrivateKeysHex: params.signerPrivateKeysHex,
      appSessionId: params.appSessionId,
      version: params.version,
      intent: "operate",
      sessionData: params.sessionData ?? `approval:${params.cmdId}`,
      allocations: params.allocations ?? []
    });
    return { version: res.version, intentId: stateHash };
  }

  /**
   * Submit an off-chain USDC payment via the state channel.
   * Uses submit_app_state with intent=operate to redistribute funds between participants.
   * This is a REAL off-chain transaction — no gas, instant settlement.
   */
  async submitOffChainPayment(params: {
    signerPrivateKeysHex: Array<`0x${string}`>;
    appSessionId: string;
    version: number;
    allocations: YellowAllocation[];
    cmdId: string;
    amountUsdc: number;
    from: string;
    to: string;
    asset?: string;
  }): Promise<{ version: number }> {
    const sessionData = JSON.stringify({
      type: "PAYMENT",
      cmdId: params.cmdId,
      amount: params.amountUsdc,
      asset: params.asset ?? "ytest.usd",
      from: params.from,
      to: params.to,
      timestamp: Date.now()
    });

    console.log(`[Yellow] Off-chain payment: ${params.amountUsdc} USDC ${params.from} -> ${params.to} (v${params.version})`);

    return this.submitAppState({
      signerPrivateKeysHex: params.signerPrivateKeysHex,
      appSessionId: params.appSessionId,
      version: params.version,
      intent: "operate",
      sessionData,
      allocations: params.allocations
    });
  }

  /**
   * Close a Yellow state channel session. Settles all off-chain state on-chain.
   * Final allocations determine how funds are returned to each participant's unified balance.
   */
  async closeAppSession(params: {
    signerPrivateKeysHex: Array<`0x${string}`>;
    appSessionId: string;
    version: number;
    sessionData?: string;
    allocations?: YellowAllocation[];
  }): Promise<{ version: number }> {
    const res = await this.callSigned({
      method: "close_app_session",
      params: {
        app_session_id: params.appSessionId,
        version: params.version,
        session_data: params.sessionData ?? "",
        allocations: params.allocations ?? []
      },
      signerPrivateKeysHex: params.signerPrivateKeysHex
    });
    return { version: Number(res?.version ?? params.version) };
  }

  /**
   * Query channel status — returns current version and open/closed state.
   */
  async getSessionStatus(params: {
    appSessionId: string;
  }): Promise<{ version: number; status: string; participants: string[] }> {
    try {
      const res = await this.callUnsigned({
        method: "get_app_session",
        params: { app_session_id: params.appSessionId }
      });
      return {
        version: Number(res?.version ?? 0),
        status: String(res?.status ?? "UNKNOWN"),
        participants: Array.isArray(res?.definition?.participants) ? res.definition.participants : []
      };
    } catch {
      return { version: 0, status: "UNKNOWN", participants: [] };
    }
  }

  /**
   * Returns a summary of the Yellow integration for status displays.
   */
  getConnectionInfo(): { url: string; protocol: string; application: string } {
    return {
      url: this.rpcUrl,
      protocol: "NitroRPC/0.4",
      application: this.opts?.defaultApplication ?? "FrankyDocs"
    };
  }

  private async callUnsigned(params: { method: string; params?: unknown }) {
    const req = this.makeReq(params.method, params.params ?? {});
    return this.callRaw({ req, sig: [] });
  }

  private async callSigned(params: {
    method: string;
    params?: unknown;
    signerPrivateKeysHex?: Array<`0x${string}`>;
    signerSignatures?: Array<`0x${string}`>;
  }) {
    const req = this.makeReq(params.method, params.params ?? {});
    const sig =
      params.signerSignatures ??
      params.signerPrivateKeysHex?.map((pk) => signReq({ req, privateKeyHex: pk })) ??
      [];
    return this.callRaw({ req, sig });
  }

  private makeReq(method: string, params: unknown): NitroReq {
    const canonicalParams = canonicalize(params);
    return [this.requestId++, method, canonicalParams, Date.now()];
  }

  private async callRaw(msg: NitroMsg) {
    if (this.rpcUrl.startsWith("ws://") || this.rpcUrl.startsWith("wss://")) {
      const json = await this.callRawWs(msg);
      return unwrapNitroResponse(json);
    }

    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg)
    });
    if (!res.ok) throw new Error(`Yellow RPC failed (${res.status})`);
    const json = (await res.json()) as any;
    return unwrapNitroResponse(json);
  }

  private async callRawWs(msg: NitroMsg): Promise<any> {
    await this.ensureWs();
    const reqId = msg.req[0];
    const ws = this.ws!;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error("Yellow WS request timeout"));
      }, 20_000);
      this.pending.set(reqId, { resolve, reject, timeout });
      ws.send(JSON.stringify(msg));
    });
  }

  private async ensureWs(): Promise<void> {
    if (this.ws && this.ws.readyState === 1) return;
    if (this.wsReady) return this.wsReady;

    this.wsReady = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.rpcUrl);
      this.ws = ws;

      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("message", onMessage);
      };

      const onOpen = () => {
        resolve();
      };
      const onError = (e: any) => {
        cleanup();
        reject(new Error(`Yellow WS error: ${String(e?.message ?? e)}`));
      };
      const onClose = () => {
        cleanup();
        for (const [id, p] of this.pending.entries()) {
          clearTimeout(p.timeout);
          p.reject(new Error("Yellow WS closed"));
          this.pending.delete(id);
        }
        this.ws = null;
        this.wsReady = null;
      };
      const onMessage = (ev: any) => {
        try {
          const data = ev?.data;
          const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
          const json = JSON.parse(text);
          const resArr = json?.res;
          if (!Array.isArray(resArr) || resArr.length < 1) return;
          const id = Number(resArr[0]);
          const p = this.pending.get(id);
          if (!p) return;
          clearTimeout(p.timeout);
          this.pending.delete(id);
          p.resolve(json);
        } catch (e) {
          // ignore malformed messages
        }
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.addEventListener("message", onMessage);
    }).finally(() => {
      // If open succeeded, wsReady remains null so subsequent calls fast-path on readyState.
      this.wsReady = null;
    });

    return this.wsReady;
  }
}

type NitroReq = [number, string, unknown, number];
type NitroMsg = { req: NitroReq; sig: Array<`0x${string}`> };

function unwrapNitroResponse(json: any) {
  if (json?.error) throw new Error(`Yellow RPC error: ${JSON.stringify(json.error)}`);
  const resArr = json?.res;
  if (!Array.isArray(resArr) || resArr.length < 3) throw new Error(`Yellow RPC malformed response: ${JSON.stringify(json)}`);
  const method = String(resArr[1] ?? "");
  if (method === "error") {
    const payload = resArr[2];
    throw new Error(`Yellow RPC error: ${JSON.stringify(payload?.error ?? payload ?? {})}`);
  }
  return resArr[2];
}

function signReq(params: { req: NitroReq; privateKeyHex: `0x${string}` }): `0x${string}` {
  const msg = JSON.stringify(params.req);
  const hash = keccak256(new TextEncoder().encode(msg));
  const sig = signHash({ hashHex: hash, privateKeyHex: params.privateKeyHex });
  return sig;
}

function signHash(params: { hashHex: `0x${string}`; privateKeyHex: `0x${string}` }): `0x${string}` {
  const hashBytes = hexToBytes(params.hashHex);
  const privBytes = hexToBytes(params.privateKeyHex);
  const signature = secp256k1.sign(hashBytes, privBytes);
  const compact = signature.toCompactRawBytes();
  const v = (signature.recovery ?? 0) + 27;
  const out = new Uint8Array(65);
  out.set(compact, 0);
  out[64] = v;
  return bytesToHex(out);
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.slice(2), "hex"));
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(bytes).toString("hex")}` as const;
}

function canonicalize(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value !== "object") return value;
  const out: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}
