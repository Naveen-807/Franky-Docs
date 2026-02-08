/**
 * Sui Testnet Faucet — request SUI gas tokens.
 *
 * The faucet is rate-limited; we debounce per address (once per 30 min).
 */

const FAUCET_COOLDOWN_MS = 30 * 60_000; // 30 minutes
const lastFaucetRequest = new Map<string, number>();

export interface FaucetResult {
  ok: boolean;
  /** Human-readable summary */
  message: string;
  /** Array of coin object IDs minted (if available) */
  coins?: string[];
}

/**
 * Request SUI testnet tokens for `address`.
 *
 * @param faucetUrl  Override URL (defaults to official Sui testnet faucet)
 */
export async function requestTestnetSui(opts: {
  address: string;
  faucetUrl?: string;
}): Promise<FaucetResult> {
  const { address, faucetUrl = "https://faucet.testnet.sui.io/v2/gas" } = opts;

  // Cooldown check
  const lastMs = lastFaucetRequest.get(address) ?? 0;
  if (Date.now() - lastMs < FAUCET_COOLDOWN_MS) {
    const remainSec = Math.ceil((FAUCET_COOLDOWN_MS - (Date.now() - lastMs)) / 1000);
    return { ok: false, message: `Faucet cooldown: ${remainSec}s remaining for ${address.slice(0, 10)}…` };
  }

  try {
    const res = await fetch(faucetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Rate-limit or 429
      if (res.status === 429) {
        lastFaucetRequest.set(address, Date.now()); // back off anyway
        return { ok: false, message: `Faucet rate-limited (429). Try again later.` };
      }
      return { ok: false, message: `Faucet error ${res.status}: ${text.slice(0, 120)}` };
    }

    const body = await res.json() as any;
    lastFaucetRequest.set(address, Date.now());

    // v2 returns { task: "...", error: null } or v1 returns { transferredGasObjects: [...] }
    if (body?.task) {
      return {
        ok: true,
        message: `Faucet: task ${body.task} queued for ${address.slice(0, 10)}…`,
        coins: [],
      };
    }

    // Parse response — the Sui faucet returns { transferredGasObjects: [...] }
    const transferred = body?.transferredGasObjects ?? body?.data?.transferredGasObjects ?? [];
    const coins = transferred.map((o: any) => o?.id ?? o).filter(Boolean);

    return {
      ok: true,
      message: `Faucet: ${coins.length} SUI coin(s) sent to ${address.slice(0, 10)}…`,
      coins,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Faucet request failed: ${msg.slice(0, 120)}` };
  }
}

/* ----------------------------------------------------------------
 *  Arc Testnet USDC — Circle faucet drip
 *  Endpoint: https://api.circle.com/v1/w3s/faucet/drips
 *  Gives 10 USDC per request on ARC-TESTNET (chain: ARC-TESTNET, currency: USDC)
 * ---------------------------------------------------------------- */

const ARC_FAUCET_COOLDOWN_MS = 30 * 60_000;
const lastArcFaucetRequest = new Map<string, number>();

export interface ArcFaucetResult {
  ok: boolean;
  message: string;
}

/**
 * Request Arc testnet USDC from Circle's faucet for the given EVM address.
 * Requires CIRCLE_API_KEY for the Authorization header.
 */
export async function requestArcTestnetUsdc(opts: {
  address: string;
  circleApiKey?: string;
}): Promise<ArcFaucetResult> {
  const { address, circleApiKey } = opts;

  if (!circleApiKey) {
    return { ok: false, message: `Arc USDC faucet skipped: no CIRCLE_API_KEY configured. Visit https://faucet.circle.com to fund manually.` };
  }

  // Cooldown check
  const lastMs = lastArcFaucetRequest.get(address) ?? 0;
  if (Date.now() - lastMs < ARC_FAUCET_COOLDOWN_MS) {
    const remainSec = Math.ceil((ARC_FAUCET_COOLDOWN_MS - (Date.now() - lastMs)) / 1000);
    return { ok: false, message: `Arc USDC faucet cooldown: ${remainSec}s remaining for ${address.slice(0, 10)}…` };
  }

  try {
    const res = await fetch("https://api.circle.com/v1/faucet/drips", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${circleApiKey}`,
      },
      body: JSON.stringify({
        address,
        blockchain: "ARC-TESTNET",
        eurc: false,
        native: false,
        usdc: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    // 204 No Content = success for the Circle faucet
    if (res.status === 204 || res.ok) {
      lastArcFaucetRequest.set(address, Date.now());
      return { ok: true, message: `Arc USDC faucet: 20 USDC sent to ${address.slice(0, 10)}…` };
    }

    const text = await res.text().catch(() => "");
    if (res.status === 429) {
      lastArcFaucetRequest.set(address, Date.now());
      return { ok: false, message: `Arc USDC faucet rate-limited (429). Try again in 2 hours.` };
    }
    return { ok: false, message: `Arc USDC faucet error ${res.status}: ${text.slice(0, 120)}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Arc USDC faucet request failed: ${msg.slice(0, 120)}` };
  }
}

/** Reset cooldown (useful for tests) */
export function resetFaucetCooldown(address?: string) {
  if (address) {
    lastFaucetRequest.delete(address);
    lastArcFaucetRequest.delete(address);
  } else {
    lastFaucetRequest.clear();
    lastArcFaucetRequest.clear();
  }
}
