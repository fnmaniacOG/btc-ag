/**
 * Odin.fun — bonding-curve and AMM market for Bitcoin-native tokens that etch
 * to Runes once they bond.
 *
 * Docs: https://docs.odin.fun/api-reference/overview  (public, no key)
 *
 * Odin is not an order book: there are no discrete listings, there is a curve.
 * We model each token's current ask as a listing so it sorts alongside
 * everything else, priced per whole token in sats.
 */

import { config } from '../config';
import { request } from '../http';
import type { ListingQuery, MarketSource, UnifiedListing } from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.odin;

/**
 * Odin's price units, derived from real API responses.
 *
 * Observed on live tokens: marketcap === price * total_supply / 10^(divisibility
 * + decimals), and marketcap is denominated in millisats. Working back from
 * that, the price of one whole token is:
 *
 *     satsPerToken = price / 10^decimals / 1000
 *
 * These are tiny fractions (a typical token is ~0.0001 sats), so quoting a
 * single token is useless in a price-sorted book. We quote per 1,000,000
 * tokens instead, which is how memecoins are actually discussed and which
 * lands in the same numeric range as the rest of the order book.
 */
const QUOTE_LOT = 1_000_000;

function satsPerToken(price: number, decimals: number): number {
  if (!price) return 0;
  return price / 10 ** decimals / 1000;
}

export const odin: MarketSource = {
  id: 'odin',
  name: 'Odin.fun',
  url: 'https://odin.fun',
  assetTypes: ['token', 'rune'],
  configNote: 'Public API — no key needed.',

  isConfigured: () => cfg.enabled,

  async fetchListings(q) {
    if (!wants(['token', 'rune'], q)) return [];

    const limit = Math.min(100, depthOf(q));
    const params = new URLSearchParams({
      sort: q.sort === 'recent' ? 'created_time:desc' : 'marketcap:desc',
      page: '1',
      limit: String(limit),
    });
    if (q.q) params.set('search', q.q);

    const res = await request<unknown>(`${cfg.base}/tokens?${params}`, {
      retries: 1,
      // Odin sits behind bot protection that rejects datacenter traffic
      // carrying a non-browser User-Agent — it answers fine from a laptop and
      // 403s from a serverless function. A browser UA is what gets through.
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'application/json',
        referer: 'https://odin.fun/',
        origin: 'https://odin.fun',
      },
    });

    return asArray(res)
      .map((r) => {
        const o = r as Record<string, unknown>;
        const id = s(pick(o, 'id', 'token_id'));
        if (!id) return null;

        const ticker = s(pick(o, 'ticker', 'symbol', 'name')) ?? id;
        // `decimals` drives price scaling; `divisibility` scales raw balances.
        const decimals = n(pick(o, 'decimals'), 3);
        const priceRaw = n(pick(o, 'price', 'last_price', 'buy_price'));
        const perToken = satsPerToken(priceRaw, decimals);
        if (perToken <= 0) return null;

        // A token that has bonded is a real Rune; before that it lives only on
        // the curve. We label it accordingly so filters behave sensibly.
        const bonded = Boolean(pick(o, 'bonded', 'is_bonded'));
        const runeName = s(pick(o, 'rune', 'rune_name'));
        const holders = n(pick(o, 'holder_count'));

        return makeListing({
          source: 'odin',
          sourceName: 'Odin.fun',
          sourceListingId: id,
          assetType: bonded && runeName ? 'rune' : 'token',
          title: s(pick(o, 'name')) ?? ticker,
          subtitle: `${bonded ? 'Bonded → Runes' : 'Bonding curve'} · per 1M tokens${
            holders ? ` · ${holders} holders` : ''
          }`,
          ticker,
          runeName,
          amount: QUOTE_LOT,
          unitPriceSats: perToken,
          priceSats: Math.max(1, Math.round(perToken * QUOTE_LOT)),
          imageUrl: `${cfg.base}/token/${id}/image`,
          listedAt: ts(pick(o, 'created_time', 'createdAt')),
          marketUrl: `https://odin.fun/token/${id}`,
          buyable: false, // Odin trades run through its ICP canister, not a PSBT.
          raw: o,
        });
      })
      .filter((x): x is UnifiedListing => x !== null && x.priceSats > 0);
  },
};
