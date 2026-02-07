import type { ParsedCommand } from "../core/commands.js";
import type { SuiWalletMaterial } from "../wallet/sui.js";
import { loadSuiKeypair } from "../wallet/sui.js";

import { DeepBookClient as MystenDeepBookClient } from "@mysten/deepbook-v3";
import { SuiClient } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";

export type DeepBookExecuteResult =
  | { kind: "order"; txDigest: string; orderId: string; managerId: string }
  | { kind: "tx"; txDigest: string; managerId: string };

export type DeepBookOpenOrder = {
  orderId: string;
  side: string;
  price: string;
  qty: string;
  status: string;
};

export type DeepBookBalances = {
  suiBalance: string;
  dbUsdcBalance: string;
};

export interface DeepBookClient {
  execute(params: {
    docId: string;
    command: ParsedCommand;
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId?: string;
  }): Promise<DeepBookExecuteResult | null>;

  getOpenOrders(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
  }): Promise<DeepBookOpenOrder[]>;

  getWalletBalances(params: {
    address: string;
  }): Promise<DeepBookBalances>;

  /** Deposit coins into the DeepBook balance manager using PTB coin merging. */
  deposit(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
    coinType: string;
    amount: number;
  }): Promise<{ txDigest: string }>;

  /** Withdraw coins from the DeepBook balance manager back to owner. */
  withdraw(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
    coinType: string;
    amount: number;
  }): Promise<{ txDigest: string }>;

  /** Place a market order (IOC at extreme price). */
  placeMarketOrder(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
    side: "buy" | "sell";
    qty: number;
  }): Promise<DeepBookExecuteResult>;

  /** Get all coin balances for an address (SUI-native object model). */
  getAllBalances(params: { address: string }): Promise<Array<{ coinType: string; balance: string }>>;

  /** Check if address has enough gas for transactions. */
  checkGas(params: { address: string; minSui?: number }): Promise<{ ok: boolean; suiBalance: number; minRequired: number }>;

  /** Get mid-price from the orderbook (bid+ask)/2 for price oracle. */
  getMidPrice(params: { poolKey: string }): Promise<{ bid: number; ask: number; mid: number; spread: number }>;

  /** Get full status including balances, orders, gas. */
  getFullStatus(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId?: string;
  }): Promise<{
    balances: DeepBookBalances;
    openOrders: DeepBookOpenOrder[];
    gasOk: boolean;
    suiBalance: number;
    allCoins: Array<{ coinType: string; balance: string }>;
  }>;
}

type Network = "testnet";

export class DeepBookV3Client implements DeepBookClient {
  private sui: SuiClient;
  private network: Network;

  constructor(params: { network?: Network; rpcUrl: string }) {
    this.network = params.network ?? "testnet";
    this.sui = new SuiClient({ url: params.rpcUrl });
  }

  async execute(params: {
    docId: string;
    command: ParsedCommand;
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId?: string;
  }): Promise<DeepBookExecuteResult | null> {
    const { command } = params;
    if (command.type !== "LIMIT_BUY" && command.type !== "LIMIT_SELL" && command.type !== "CANCEL" && command.type !== "SETTLE") {
      return null;
    }
    if (this.network !== "testnet") throw new Error(`Unsupported DeepBook network: ${this.network}`);

    const signer = loadSuiKeypair(params.wallet.suiPrivateKey);
    const ownerAddress = params.wallet.address;
    const poolKey = params.poolKey;

    let managerId = params.managerId?.trim() || "";
    if (!managerId) {
      managerId = await this.createAndShareBalanceManager({ signer, ownerAddress });
    }

    const deepbook = this.makeDeepBookClient({ ownerAddress, managerId });
    const managerKey = "DOCWALLET_MANAGER";

    if (command.type === "LIMIT_BUY" || command.type === "LIMIT_SELL") {
      const isBid = command.type === "LIMIT_BUY";
      const clientOrderId = `${params.docId}:${Date.now()}`;

      const [baseKey, quoteKey] = splitPoolKey(poolKey);

      const openBefore = await safeOpenOrders(deepbook, poolKey, managerKey);

      const tx = new Transaction();
      if (isBid) {
        const notionalUsdc = Math.max(0, command.qty * command.price);
        deepbook.balanceManager.depositIntoManager(managerKey, quoteKey, notionalUsdc)(tx);
      } else {
        deepbook.balanceManager.depositIntoManager(managerKey, baseKey, command.qty)(tx);
      }

      deepbook.deepBook.placeLimitOrder({
        poolKey,
        balanceManagerKey: managerKey,
        clientOrderId,
        price: command.price,
        quantity: command.qty,
        isBid,
        payWithDeep: true
      })(tx);

      const result = await this.sui.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true, showEvents: true }
      });
      const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
      if (!txDigest) throw new Error("DeepBook tx missing digest");

      const openAfter = await safeOpenOrders(deepbook, poolKey, managerKey);
      const orderId = pickNewOrderId({ before: openBefore, after: openAfter }) ?? clientOrderId;

      return { kind: "order", txDigest, orderId, managerId };
    }

    if (command.type === "CANCEL") {
      const tx = new Transaction();
      deepbook.deepBook.cancelOrder(poolKey, managerKey, command.orderId)(tx);
      const result = await this.sui.signAndExecuteTransaction({
        signer,
        transaction: tx,
        options: { showEffects: true }
      });
      const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
      if (!txDigest) throw new Error("DeepBook cancel tx missing digest");
      return { kind: "tx", txDigest, managerId };
    }

    // SETTLE: withdraw settled amounts + withdraw all manager balances back to owner (demo-friendly).
    const [baseKey, quoteKey] = splitPoolKey(poolKey);
    const tx = new Transaction();
    deepbook.deepBook.withdrawSettledAmounts(poolKey, managerKey)(tx);
    deepbook.balanceManager.withdrawAllFromManager(managerKey, baseKey, ownerAddress)(tx);
    deepbook.balanceManager.withdrawAllFromManager(managerKey, quoteKey, ownerAddress)(tx);

    const result = await this.sui.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true }
    });
    const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
    if (!txDigest) throw new Error("DeepBook settle tx missing digest");
    return { kind: "tx", txDigest, managerId };
  }

  private makeDeepBookClient(params: { ownerAddress: string; managerId: string }) {
    return new MystenDeepBookClient({
      client: this.sui as any,
      address: params.ownerAddress,
      env: this.network,
      balanceManagers: {
        DOCWALLET_MANAGER: { address: params.managerId }
      }
    }) as any;
  }

  private async createAndShareBalanceManager(params: { signer: any; ownerAddress: string }): Promise<string> {
    const deepbook = new MystenDeepBookClient({
      client: this.sui as any,
      address: params.ownerAddress,
      env: this.network
    }) as any;

    const tx = new Transaction();
    deepbook.balanceManager.createAndShareBalanceManager()(tx);
    const result = await this.sui.signAndExecuteTransaction({
      signer: params.signer,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true }
    });

    const changes = (result.objectChanges ?? []) as Array<any>;
    const manager = changes.find(
      (c) => c.type === "created" && typeof c.objectType === "string" && c.objectType.includes("balance_manager::BalanceManager")
    );
    const managerId = manager?.objectId ?? manager?.object_id;
    if (!managerId) throw new Error("Failed to detect BalanceManager objectId from transaction");
    return String(managerId);
  }

  async getOpenOrders(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
  }): Promise<DeepBookOpenOrder[]> {
    try {
      const deepbook = this.makeDeepBookClient({ ownerAddress: params.wallet.address, managerId: params.managerId });
      const managerKey = "DOCWALLET_MANAGER";
      const orders = await deepbook.accountOpenOrders(params.poolKey, managerKey);
      if (!Array.isArray(orders)) return [];
      return orders.map((o: any) => ({
        orderId: String(o.orderId ?? o.order_id ?? o),
        side: String(o.isBid ?? o.side ?? "?"),
        price: String(o.price ?? "?"),
        qty: String(o.quantity ?? o.qty ?? "?"),
        status: String(o.status ?? "OPEN")
      }));
    } catch {
      return [];
    }
  }

  async getWalletBalances(params: { address: string }): Promise<DeepBookBalances> {
    try {
      const suiBal = await this.sui.getBalance({ owner: params.address });
      const suiBalance = (Number(suiBal.totalBalance) / 1e9).toFixed(4);

      // Try to get DBUSDC balance (DeepBook testnet USDC)
      let dbUsdcBalance = "0";
      try {
        const allCoins = await this.sui.getAllBalances({ owner: params.address });
        for (const coin of allCoins) {
          const coinType = coin.coinType?.toLowerCase() ?? "";
          if (coinType.includes("dbusdc") || coinType.includes("usdc")) {
            dbUsdcBalance = (Number(coin.totalBalance) / 1e6).toFixed(2);
            break;
          }
        }
      } catch { /* ignore */ }

      return { suiBalance, dbUsdcBalance };
    } catch {
      return { suiBalance: "0", dbUsdcBalance: "0" };
    }
  }

  // --- New Sui-specific capabilities ---

  async deposit(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
    coinType: string;
    amount: number;
  }): Promise<{ txDigest: string }> {
    const signer = loadSuiKeypair(params.wallet.suiPrivateKey);
    const ownerAddress = params.wallet.address;
    const deepbook = this.makeDeepBookClient({ ownerAddress, managerId: params.managerId });
    const managerKey = "DOCWALLET_MANAGER";

    const [baseKey, quoteKey] = splitPoolKey(params.poolKey);
    const coinKey = params.coinType.toUpperCase() === "SUI" ? baseKey : quoteKey;

    const tx = new Transaction();
    deepbook.balanceManager.depositIntoManager(managerKey, coinKey, params.amount)(tx);

    const result = await this.sui.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true }
    });
    const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
    if (!txDigest) throw new Error("Deposit tx missing digest");
    return { txDigest };
  }

  async withdraw(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
    coinType: string;
    amount: number;
  }): Promise<{ txDigest: string }> {
    const signer = loadSuiKeypair(params.wallet.suiPrivateKey);
    const ownerAddress = params.wallet.address;
    const deepbook = this.makeDeepBookClient({ ownerAddress, managerId: params.managerId });
    const managerKey = "DOCWALLET_MANAGER";

    const [baseKey, quoteKey] = splitPoolKey(params.poolKey);
    const coinKey = params.coinType.toUpperCase() === "SUI" ? baseKey : quoteKey;

    const tx = new Transaction();
    deepbook.balanceManager.withdrawFromManager(managerKey, coinKey, params.amount, ownerAddress)(tx);

    const result = await this.sui.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true }
    });
    const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
    if (!txDigest) throw new Error("Withdraw tx missing digest");
    return { txDigest };
  }

  async placeMarketOrder(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId: string;
    side: "buy" | "sell";
    qty: number;
  }): Promise<DeepBookExecuteResult> {
    const signer = loadSuiKeypair(params.wallet.suiPrivateKey);
    const ownerAddress = params.wallet.address;
    const deepbook = this.makeDeepBookClient({ ownerAddress, managerId: params.managerId });
    const managerKey = "DOCWALLET_MANAGER";
    const isBid = params.side === "buy";

    const [baseKey, quoteKey] = splitPoolKey(params.poolKey);

    // Market order = IOC limit order at extreme price
    const extremePrice = isBid ? 999999 : 0.000001;
    const clientOrderId = `market_${Date.now()}`;

    const tx = new Transaction();
    if (isBid) {
      // Estimate sane deposit: use cached mid-price * 2x slippage, fallback to 10x qty
      let estimatedUnitPrice = 2; // conservative SUI/USDC fallback
      try {
        const priceData = await this.getMidPrice({ poolKey: params.poolKey });
        if (priceData.mid > 0) estimatedUnitPrice = priceData.mid;
      } catch { /* use fallback */ }
      const notionalUsdc = Math.max(1, params.qty * estimatedUnitPrice * 2); // 2x slippage buffer
      deepbook.balanceManager.depositIntoManager(managerKey, quoteKey, notionalUsdc)(tx);
    } else {
      deepbook.balanceManager.depositIntoManager(managerKey, baseKey, params.qty)(tx);
    }

    deepbook.deepBook.placeLimitOrder({
      poolKey: params.poolKey,
      balanceManagerKey: managerKey,
      clientOrderId,
      price: extremePrice,
      quantity: params.qty,
      isBid,
      payWithDeep: true,
      // IOC = immediate-or-cancel for market order behavior
      orderType: "immediate_or_cancel"
    })(tx);

    const result = await this.sui.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true }
    });
    const txDigest = String(result.digest ?? result.effects?.transactionDigest ?? "");
    if (!txDigest) throw new Error("Market order tx missing digest");

    return { kind: "order", txDigest, orderId: clientOrderId, managerId: params.managerId };
  }

  async getAllBalances(params: { address: string }): Promise<Array<{ coinType: string; balance: string }>> {
    try {
      const allCoins = await this.sui.getAllBalances({ owner: params.address });
      return allCoins.map((c) => ({
        coinType: c.coinType,
        balance: c.totalBalance
      }));
    } catch {
      return [];
    }
  }

  async checkGas(params: { address: string; minSui?: number }): Promise<{ ok: boolean; suiBalance: number; minRequired: number }> {
    const minRequired = params.minSui ?? 0.01;
    try {
      const bal = await this.sui.getBalance({ owner: params.address });
      const suiBalance = Number(bal.totalBalance) / 1e9;
      return { ok: suiBalance >= minRequired, suiBalance, minRequired };
    } catch {
      return { ok: false, suiBalance: 0, minRequired };
    }
  }

  /**
   * Get mid-price from the DeepBook V3 orderbook.
   * Uses the on-chain book state to derive bid/ask/mid/spread.
   */
  async getMidPrice(params: { poolKey: string }): Promise<{ bid: number; ask: number; mid: number; spread: number }> {
    try {
      // Use a temporary deepbook client to read orderbook state
      // We pass a dummy address since we're only reading, not trading
      const dummyAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";
      const deepbook = new MystenDeepBookClient({
        address: dummyAddress,
        env: this.network as any,
        client: this.sui as any
      });

      const [base, quote] = splitPoolKey(params.poolKey);
      const poolKey = params.poolKey;

      // Try to get book state via level2 orderbook query
      // DeepBook V3 exposes level2Range or we can read from best bid/ask
      try {
        const level2 = await (deepbook as any).getLevel2Range(poolKey, 0, Number.MAX_SAFE_INTEGER, true);
        const bids = level2?.bids ?? [];
        const asks = level2?.asks ?? [];

        const bestBid = bids.length > 0 ? Number(bids[0]?.[0] ?? bids[0]?.price ?? 0) : 0;
        const bestAsk = asks.length > 0 ? Number(asks[0]?.[0] ?? asks[0]?.price ?? 0) : 0;

        if (bestBid > 0 && bestAsk > 0) {
          const mid = (bestBid + bestAsk) / 2;
          const spread = (bestAsk - bestBid) / mid * 100;
          return { bid: bestBid, ask: bestAsk, mid, spread };
        }
      } catch { /* level2 not available, try fallback */ }

      // Fallback: try getQuoteQuantityOut for a small SUI amount to estimate price
      try {
        const quoteOut = await (deepbook as any).getQuoteQuantityOut(poolKey, 1);
        const price = Number(quoteOut ?? 0);
        if (price > 0) {
          return { bid: price * 0.999, ask: price * 1.001, mid: price, spread: 0.2 };
        }
      } catch { /* fallback also failed */ }

      // Final fallback: return 0s (no liquidity or pool not found)
      return { bid: 0, ask: 0, mid: 0, spread: 0 };
    } catch {
      return { bid: 0, ask: 0, mid: 0, spread: 0 };
    }
  }

  async getFullStatus(params: {
    wallet: SuiWalletMaterial;
    poolKey: string;
    managerId?: string;
  }): Promise<{
    balances: DeepBookBalances;
    openOrders: DeepBookOpenOrder[];
    gasOk: boolean;
    suiBalance: number;
    allCoins: Array<{ coinType: string; balance: string }>;
  }> {
    const balances = await this.getWalletBalances({ address: params.wallet.address });
    const gasCheck = await this.checkGas({ address: params.wallet.address });
    const allCoins = await this.getAllBalances({ address: params.wallet.address });

    let openOrders: DeepBookOpenOrder[] = [];
    if (params.managerId) {
      openOrders = await this.getOpenOrders({
        wallet: params.wallet,
        poolKey: params.poolKey,
        managerId: params.managerId
      });
    }

    return {
      balances,
      openOrders,
      gasOk: gasCheck.ok,
      suiBalance: gasCheck.suiBalance,
      allCoins
    };
  }
}

function splitPoolKey(poolKey: string): [string, string] {
  const parts = poolKey.split("_").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return ["SUI", "DBUSDC"];
  return [parts[0]!, parts[1]!];
}

async function safeOpenOrders(deepbook: any, poolKey: string, managerKey: string): Promise<string[]> {
  try {
    const out = await deepbook.accountOpenOrders(poolKey, managerKey);
    return Array.isArray(out) ? out.map(String) : [];
  } catch {
    return [];
  }
}

function pickNewOrderId(params: { before: string[]; after: string[] }): string | null {
  const before = new Set(params.before.map(String));
  for (const id of params.after) {
    if (!before.has(String(id))) return String(id);
  }
  return null;
}
