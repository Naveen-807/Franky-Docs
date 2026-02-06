import { Core } from "@walletconnect/core";
import { Web3Wallet } from "@walletconnect/web3wallet";
import type { Web3WalletTypes } from "@walletconnect/web3wallet";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import type { Repo } from "../db/repo.js";

export type WalletConnectRequest = {
  docId: string;
  topic: string;
  id: number;
  method: string;
  params: any;
  chainId?: string;
};

export type WalletConnectSessionInfo = {
  docId: string;
  topic: string;
  peerName: string;
  peerUrl?: string;
  peerIcons?: string[];
  chains: string[];
  status: string;
  createdAt: number;
};

export class WalletConnectService {
  private core: any;
  private web3wallet: InstanceType<typeof Web3Wallet> | null = null;
  private pairingDoc = new Map<string, string>();

  constructor(
    private params: {
      projectId: string;
      relayUrl?: string;
      metadata: { name: string; description: string; url: string; icons: string[] };
      repo: Repo;
      onRequest?: (req: WalletConnectRequest) => Promise<void>;
      onSessionUpdate?: (session: WalletConnectSessionInfo) => Promise<void>;
    }
  ) {
    this.core = new Core({ projectId: params.projectId, relayUrl: params.relayUrl });
  }

  async init() {
    this.web3wallet = await Web3Wallet.init({
      core: this.core,
      metadata: this.params.metadata
    });

    (this.web3wallet as any).on("session_proposal", (proposal: any) => {
      this.handleSessionProposal(proposal).catch(() => {
        // handled in the method
      });
    });

    (this.web3wallet as any).on("session_request", (event: any) => {
      this.handleSessionRequest(event).catch(() => {
        // handled in the method
      });
    });

    (this.web3wallet as any).on("session_delete", (event: any) => {
      const topic = event?.topic;
      if (!topic) return;
      this.params.repo.setWalletConnectSessionStatus(topic, "DELETED");
      const s = this.params.repo.getWalletConnectSession(topic);
      if (s) {
        this.params.onSessionUpdate?.({
          docId: s.doc_id,
          topic,
          peerName: s.peer_name ?? "Unknown",
          peerUrl: s.peer_url ?? undefined,
          peerIcons: s.peer_icons ? s.peer_icons.split(",") : undefined,
          chains: s.chains ? s.chains.split(",") : [],
          status: "DELETED",
          createdAt: Date.now()
        });
      }
    });

    (this.web3wallet as any).on("session_expire", (event: any) => {
      const topic = event?.topic;
      if (!topic) return;
      this.params.repo.setWalletConnectSessionStatus(topic, "EXPIRED");
      const s = this.params.repo.getWalletConnectSession(topic);
      if (s) {
        this.params.onSessionUpdate?.({
          docId: s.doc_id,
          topic,
          peerName: s.peer_name ?? "Unknown",
          peerUrl: s.peer_url ?? undefined,
          peerIcons: s.peer_icons ? s.peer_icons.split(",") : undefined,
          chains: s.chains ? s.chains.split(",") : [],
          status: "EXPIRED",
          createdAt: Date.now()
        });
      }
    });
  }

  async pair(params: { uri: string; docId: string }) {
    if (!this.web3wallet) throw new Error("WalletConnect not initialized");
    const pairing = await this.web3wallet.core.pairing.pair({ uri: params.uri });
    if (pairing?.topic) this.pairingDoc.set(pairing.topic, params.docId);
  }

  async respondResult(topic: string, id: number, result: any) {
    if (!this.web3wallet) throw new Error("WalletConnect not initialized");
    await this.web3wallet.respondSessionRequest({
      topic,
      response: { id, jsonrpc: "2.0", result }
    });
  }

  async respondError(topic: string, id: number, message: string, code = 5000) {
    if (!this.web3wallet) throw new Error("WalletConnect not initialized");
    await this.web3wallet.respondSessionRequest({
      topic,
      response: { id, jsonrpc: "2.0", error: { code, message } }
    });
  }

  private async handleSessionProposal(proposal: Web3WalletTypes.SessionProposal) {
    if (!this.web3wallet) return;
    const pairingTopic = proposal.params.pairingTopic;
    const docId = pairingTopic ? this.pairingDoc.get(pairingTopic) : undefined;
    if (!docId) {
      await this.web3wallet.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
      return;
    }

    const doc = this.params.repo.getDoc(docId);
    const evmAddress = doc?.evm_address ?? null;
    if (!evmAddress) {
      await this.web3wallet.rejectSession({ id: proposal.id, reason: getSdkError("USER_REJECTED") });
      return;
    }

    const chain = "eip155:5042002";
    const approved = buildApprovedNamespaces({
      proposal: proposal.params,
      supportedNamespaces: {
        eip155: {
          chains: [chain],
          methods: ["eth_sendTransaction", "personal_sign"],
          events: ["chainChanged", "accountsChanged"],
          accounts: [`${chain}:${evmAddress}`]
        }
      }
    });

    const session = await this.web3wallet.approveSession({ id: proposal.id, namespaces: approved });

    const peer = session.peer?.metadata;
    const peerName = peer?.name ?? "Unknown";
    const sessionNamespaces = (session.namespaces ?? {}) as Record<string, { chains?: string[] }>;
    const chains = Object.values(sessionNamespaces)
      .flatMap((ns) => ns.chains ?? [])
      .filter(Boolean);

    this.params.repo.upsertWalletConnectSession({
      docId,
      topic: session.topic,
      peerName,
      peerUrl: peer?.url,
      peerIcons: peer?.icons?.join(","),
      chains: chains.join(","),
      status: "APPROVED"
    });

    await this.params.onSessionUpdate?.({
      docId,
      topic: session.topic,
      peerName,
      peerUrl: peer?.url,
      peerIcons: peer?.icons,
      chains,
      status: "APPROVED",
      createdAt: Date.now()
    });
  }

  private async handleSessionRequest(event: Web3WalletTypes.SessionRequest) {
    const { topic, id, params } = event;
    const method = params?.request?.method;
    const requestParams = params?.request?.params;
    if (!topic || !method) return;

    const session = this.params.repo.getWalletConnectSession(topic);
    if (!session) {
      await this.respondError(topic, id, "Unknown WalletConnect session");
      return;
    }

    const docId = session.doc_id;
    if (!this.params.onRequest) {
      await this.respondError(topic, id, "WalletConnect request handling is disabled");
      return;
    }

    await this.params.onRequest({
      docId,
      topic,
      id,
      method,
      params: requestParams,
      chainId: params?.chainId
    });
  }
}
