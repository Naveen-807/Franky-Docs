/**
 * Sui Testnet Faucet — request SUI gas tokens for demo/testing.
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
  const { address, faucetUrl = "https://faucet.testnet.sui.io/v1/gas" } = opts;

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

/** Reset cooldown (useful for tests) */
export function resetFaucetCooldown(address?: string) {
  if (address) {
    lastFaucetRequest.delete(address);
  } else {
    lastFaucetRequest.clear();
  }
}
