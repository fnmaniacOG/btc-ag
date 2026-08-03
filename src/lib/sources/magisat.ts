/**
 * Magisat — the deepest rare-sat order book.
 *
 * Docs: https://magisat.io/docs/api/v1
 * `POST /external/v1/listing` is the order book. Auth is the X-MGST-API-KEY
 * header; write operations additionally need X-MGST-AUTH-MSG.
 *
 * Magisat returns raw sat ranges, which is exactly what we want — btc.ag
 * reclassifies rarity locally rather than trusting the venue's tags.
 */

import { config } from '../config';
import { request } from '../http';
import type {
  BuyQuote,
  BuyResult,
  BuyerContext,
  ListingQuery,
  MarketSource,
  SatRange,
  UnifiedListing,
} from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts } from './base';

const cfg = config.sources.magisat;

function headers(): Record<string, string> {
  return { 'X-MGST-API-KEY': cfg.apiKey, 'content-type': 'application/json' };
}

function orderBy(q: ListingQuery): string[] {
  switch (q.sort) {
    case 'price_desc':
      return ['PRICE_DESC'];
    case 'recent':
      return ['UPDATED_AT_DESC'];
    case 'unit_price_asc':
      return ['RELATIVE_UNIT_PRICE_ASC'];
    case 'rarity_desc':
      return ['BLOCK_NUMBER_ASC'];
    default:
      return ['PRICE_ASC'];
  }
}

/** Magisat represents a UTXO's contents as a list of sat ranges. */
function extractRanges(o: Record<string, unknown>): SatRange[] | undefined {
  const candidates =
    (pick(o, 'satRanges', 'ranges', 'satoshis', 'sats') as unknown[] | undefined) ?? undefined;
  if (!Array.isArray(candidates) || !candidates.length) return undefined;

  const out: SatRange[] = [];
  for (const c of candidates) {
    if (typeof c === 'number') {
      out.push({ start: c, size: 1 });
      continue;
    }
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const start = n(pick(r, 'start', 'rangeStart', 'from', 'sat', 'satNumber'), -1);
    if (start < 0) continue;
    const end = n(pick(r, 'end', 'rangeEnd', 'to'), -1);
    const size = end > start ? end - start : n(pick(r, 'size', 'count'), 1);
    out.push({ start, size: Math.max(1, size) });
  }
  return out.length ? out : undefined;
}

async function fetchPage(q: ListingQuery, offset: number, limit: number): Promise<unknown[]> {
  const body: Record<string, unknown> = {
    offset,
    // Magisat caps page size at 50.
    limit: Math.min(50, limit),
    orderByColumnWithDirection: orderBy(q),
    includePendingPurchase: false,
  };
  if (q.minPriceSats) body.minPrice = String(q.minPriceSats);
  if (q.maxPriceSats) body.maxPrice = String(q.maxPriceSats);
  if (q.q && /^[a-z]{1,11}$/.test(q.q)) body.satName = q.q;

  const res = await request<unknown>(`${cfg.base}/listing`, {
    method: 'POST',
    json: body,
    headers: headers(),
  });
  return asArray(res);
}

export const magisat: MarketSource = {
  id: 'magisat',
  name: 'Magisat',
  url: 'https://magisat.io',
  assetTypes: ['rare-sat', 'ordinal'],
  configNote: 'Set MAGISAT_API_KEY (magisat.io/docs/api/v1).',

  isConfigured: () => cfg.enabled && Boolean(cfg.apiKey),

  async fetchListings(q) {
    const want = depthOf(q);
    const pages = Math.ceil(want / 50);
    const raw: unknown[] = [];

    // Sequential paging: Magisat rate-limits parallel bursts on the same key.
    for (let p = 0; p < pages; p++) {
      const batch = await fetchPage(q, p * 50, Math.min(50, want - raw.length));
      raw.push(...batch);
      if (batch.length < 50) break;
    }

    return raw.map((r) => {
      const o = r as Record<string, unknown>;
      const listingId = s(pick(o, 'listingId', 'id', 'uuid')) ?? '';
      const priceSats = n(pick(o, 'price', 'priceSats', 'listingPrice'));
      const ranges = extractRanges(o);
      const utxo = s(pick(o, 'utxo', 'outpoint'));
      const txId = s(pick(o, 'txId', 'txid'));
      const vout = pick(o, 'vout', 'outputIndex');
      const outpoint = utxo ?? (txId ? `${txId}:${n(vout)}` : undefined);
      const inscriptionId = s(pick(o, 'inscriptionId'));

      const tagName = s(pick(o, 'tagName', 'tag', 'sattributeName'));
      const utxoSize = n(pick(o, 'utxoSize', 'utxoValue', 'value')) || undefined;

      return makeListing({
        source: 'magisat',
        sourceName: 'Magisat',
        sourceListingId: listingId || outpoint || `${priceSats}`,
        assetType: inscriptionId ? 'ordinal' : 'rare-sat',
        title: tagName ?? (ranges?.length ? 'Rare sat UTXO' : 'Sat listing'),
        subtitle: utxoSize ? `${utxoSize.toLocaleString('en-US')} sats` : undefined,
        priceSats,
        satRanges: ranges,
        vendorRarity: pick(o, 'rarity'),
        utxoSizeSats: utxoSize,
        outpoint,
        inscriptionId,
        sellerAddress: s(pick(o, 'sellerAddress', 'seller', 'address')),
        listedAt: ts(pick(o, 'createdAt', 'listedAt')),
        updatedAt: ts(pick(o, 'updatedAt')),
        marketUrl: listingId ? `https://magisat.io/listing/${listingId}` : 'https://magisat.io',
        buyable: true,
        raw: o,
      });
    });
  },

  async quoteBuy(listing, buyer: BuyerContext): Promise<BuyQuote> {
    const res = await request<Record<string, unknown>>(`${cfg.base}/psbt/buying`, {
      method: 'POST',
      headers: headers(),
      json: {
        listingIds: [listing.sourceListingId],
        buyerAddress: buyer.paymentAddress,
        buyerPublicKey: buyer.paymentPublicKey,
        buyerOrdinalAddress: buyer.ordinalsAddress,
        feeRate: buyer.feeRate,
      },
    });

    const psbt = s(pick(res, 'psbt', 'psbtBase64', 'buyerPsbt'));
    if (!psbt) throw new Error('magisat: no PSBT returned');

    const networkFeeSats = n(pick(res, 'networkFee', 'minerFee'));
    const marketplaceFeeSats = n(pick(res, 'serviceFee', 'marketplaceFee'));

    return {
      listingId: listing.id,
      source: 'magisat',
      priceSats: listing.priceSats,
      marketplaceFeeSats,
      networkFeeSats,
      totalSats: listing.priceSats + marketplaceFeeSats + networkFeeSats,
      feeRate: buyer.feeRate,
      psbtBase64: psbt,
      signingIndexes: (pick(res, 'inputsToSign', 'signIndexes') as number[]) ?? [],
      submitContext: { listingIds: [listing.sourceListingId], prepared: pick(res, 'prepared') },
    };
  },

  async submitBuy(signedPsbtBase64, quote, buyer): Promise<BuyResult> {
    const res = await request<Record<string, unknown>>(`${cfg.base}/buying/bulk`, {
      method: 'POST',
      headers: headers(),
      json: {
        listingIds: quote.submitContext.listingIds,
        buyerAddress: buyer.paymentAddress,
        buyerOrdinalAddress: buyer.ordinalsAddress,
        signedPsbt: signedPsbtBase64,
        feeRate: quote.feeRate,
      },
    });
    const txid = s(pick(res, 'txId', 'txid')) ?? '';
    return { txid, source: 'magisat', explorerUrl: `https://mempool.space/tx/${txid}` };
  },
};
