/**
 * Swap on Nexus (DotSwap) — AMM/CLMM liquidity pools for Runes and BRC-20.
 *
 * https://swap.on.nexus/pools
 *
 * Pools are not listings, so this adapter does something slightly different:
 * it turns each pool into a *quote* — the effective sats price of one unit of
 * the asset at current reserves. That price then sits in the same order book
 * as UniSat's and Satflow's asks, which is the whole point: if a rune is
 * cheaper in a Nexus pool than on any order book, you see it immediately.
 *
 * Override NEXUS_BASE / NEXUS_POOLS_PATH if the route moves.
 */

import { config } from '../config';
import { request } from '../http';
import type { ListingQuery, MarketSource, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, wants } from './base';

const cfg = config.sources.nexus;
const POOLS_PATH = (process.env.NEXUS_POOLS_PATH ?? '/pool/list').trim();

/** Constant-product spot price of `asset` in sats, from pool reserves. */
function spotPriceSats(btcReserve: number, assetReserve: number): number {
  if (!btcReserve || !assetReserve) return 0;
  return btcReserve / assetReserve;
}

export const nexus: MarketSource = {
  id: 'nexus',
  name: 'Swap on Nexus',
  url: 'https://swap.on.nexus/pools',
  assetTypes: ['pool', 'rune', 'brc20'],
  configNote:
    'Public pool data. Override NEXUS_BASE / NEXUS_POOLS_PATH if DotSwap moves the route; NEXUS_API_KEY optional.',

  isConfigured: () => cfg.enabled,

  async fetchListings(q) {
    if (!wants(['pool', 'rune', 'brc20'], q)) return [];

    const limit = depthOf(q);
    const params = new URLSearchParams({
      start: '0',
      limit: String(Math.min(100, limit)),
    });

    const res = await request<unknown>(`${cfg.base}${POOLS_PATH}?${params}`, {
      headers: cfg.apiKey ? { 'x-api-key': cfg.apiKey } : undefined,
      retries: 1,
    });

    return asArray(res)
      .map((r) => {
        const o = r as Record<string, unknown>;

        const tick =
          s(pick(o, 'tick', 'ticker', 'rune', 'runeName', 'token1', 'symbol')) ?? undefined;
        if (!tick) return null;

        // Reserve naming varies across pool schemas; try the common aliases.
        const btcReserve = n(pick(o, 'btcAmount', 'satsReserve', 'reserve0', 'amount0', 'btc'));
        const assetReserve = n(pick(o, 'tokenAmount', 'reserve1', 'amount1', 'token'));
        const divisibility = n(pick(o, 'divisibility', 'decimals'), 0);

        const normalizedAsset =
          divisibility > 0 ? assetReserve / 10 ** divisibility : assetReserve;

        const unit =
          n(pick(o, 'price', 'unitPrice', 'lastPrice')) ||
          spotPriceSats(btcReserve, normalizedAsset);

        if (!unit || unit <= 0) return null;

        const isRune = Boolean(pick(o, 'runeId', 'runeid', 'rune'));
        const tvlSats = btcReserve * 2;

        return makeListing({
          source: 'nexus',
          sourceName: 'Swap on Nexus',
          sourceListingId: s(pick(o, 'poolId', 'pid', 'id')) ?? tick,
          assetType: isRune ? 'rune' : 'pool',
          title: tick,
          subtitle: tvlSats
            ? `AMM pool · ${(tvlSats / 1e8).toFixed(3)} BTC TVL`
            : 'AMM pool',
          runeId: s(pick(o, 'runeId', 'runeid')),
          runeName: isRune ? tick : undefined,
          ticker: tick,
          amount: 1,
          unitPriceSats: unit,
          priceSats: Math.max(1, Math.round(unit)),
          marketUrl: 'https://swap.on.nexus/pools',
          buyable: false, // Swaps route through Nexus's own contracts.
          raw: o,
        });
      })
      .filter((x): x is UnifiedListing => x !== null);
  },
};
