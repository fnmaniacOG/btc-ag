/**
 * UniSat — ordinals collections, runes and BRC-20.
 *
 * Docs: https://docs.unisat.io/developer-support/open-api-documentation
 * The marketplace surface is the /v3/market/* family; every route is POST and
 * every response is wrapped in { code, msg, data }.
 */

import { config } from '../config';
import { request } from '../http';
import type {
  BuyQuote,
  BuyResult,
  BuyerContext,
  ListingQuery,
  MarketSource,
  UnifiedListing,
} from '../types';
import { asArray, depthOf, makeListing, n, pick, s, ts, wants } from './base';

const cfg = config.sources.unisat;

interface Wrapped<T> {
  code: number;
  msg?: string;
  data: T;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    'content-type': 'application/json',
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await request<Wrapped<T>>(`${cfg.base}${path}`, {
    method: 'POST',
    json: body,
    headers: headers(),
  });
  if (res && typeof res === 'object' && 'code' in res && res.code !== 0) {
    throw new Error(`unisat: ${res.msg ?? 'error'} (code ${res.code})`);
  }
  return (res as Wrapped<T>).data;
}

/**
 * UniSat exposes one order-book endpoint for every asset class, selected by
 * `filter.nftType`. The server validates it against a fixed enum and rejects
 * anything else:
 *
 *   brc20 | domain | collection | runes | alkanes | brc20Prog | tap
 *
 * Ordinals live under `collection` — there is no `inscription` type. The body
 * is deliberately minimal: the endpoint runs strict schema validation, so
 * every extra field is another chance to be rejected wholesale.
 */
const LIST_PATH = '/v3/market/collection/auction/list';

type UnisatNftType = 'collection' | 'runes' | 'brc20';

async function fetchByType(nftType: UnisatNftType, q: ListingQuery): Promise<unknown[]> {
  const data = await post<unknown>(LIST_PATH, {
    filter: {
      nftType,
      ...(q.collectionSlug ? { collectionId: q.collectionSlug } : {}),
    },
    sort: { unitPrice: q.sort === 'price_desc' ? -1 : 1 },
    start: 0,
    limit: depthOf(q),
  });
  return asArray(data);
}

/** Ordinals / collection order book. */
async function fetchOrdinals(q: ListingQuery): Promise<UnifiedListing[]> {
  const data = await fetchByType('collection', q);

  return data.map((r) => {
    const o = r as Record<string, unknown>;
    const inscriptionId = s(pick(o, 'inscriptionId', 'nftId', 'inscription_id'));
    const priceSats = n(pick(o, 'price', 'amount', 'totalPrice'));
    const collectionSlug = s(pick(o, 'collectionId', 'collection_id'));
    const auctionId = s(pick(o, 'auctionId', 'orderId', 'id')) ?? inscriptionId ?? 'unknown';

    return makeListing({
      source: 'unisat',
      sourceName: 'UniSat',
      sourceListingId: auctionId,
      assetType: 'ordinal',
      title:
        s(pick(o, 'inscriptionName', 'name', 'collectionName')) ??
        (inscriptionId ? `Inscription ${s(pick(o, 'inscriptionNumber')) ?? ''}`.trim() : 'Ordinal'),
      subtitle: s(pick(o, 'collectionName')),
      inscriptionId,
      inscriptionNumber: pick(o, 'inscriptionNumber') !== undefined ? n(pick(o, 'inscriptionNumber')) : undefined,
      contentType: s(pick(o, 'contentType', 'content_type')),
      priceSats,
      outpoint:
        s(pick(o, 'outpoint')) ??
        (s(pick(o, 'txid')) ? `${s(pick(o, 'txid'))}:${n(pick(o, 'vout'))}` : undefined),
      sellerAddress: s(pick(o, 'sellerAddress', 'address', 'owner')),
      collectionSlug,
      collectionName: s(pick(o, 'collectionName')),
      utxoSizeSats: n(pick(o, 'outValue', 'utxoValue'), 546) || undefined,
      listedAt: ts(pick(o, 'listTime', 'createTime', 'timestamp')),
      marketUrl: inscriptionId
        ? `https://unisat.io/market/inscription?inscriptionId=${inscriptionId}`
        : 'https://unisat.io/market',
      buyable: true,
      raw: o,
    });
  });
}

/** Runes order book. UniSat sells runes in lots with a per-unit ask. */
async function fetchRunes(q: ListingQuery): Promise<UnifiedListing[]> {
  const data = await fetchByType('runes', q);

  return data.map((r) => {
    const o = r as Record<string, unknown>;
    const runeName = s(pick(o, 'rune', 'runeName', 'spacedRune', 'tick')) ?? 'RUNE';
    const priceSats = n(pick(o, 'price', 'amount', 'totalPrice'));
    const divisibility = n(pick(o, 'divisibility'), 0);
    const rawAmount = n(pick(o, 'runeAmount', 'amount0', 'tokenAmount', 'num'));
    const amount = divisibility > 0 ? rawAmount / 10 ** divisibility : rawAmount;
    const auctionId = s(pick(o, 'auctionId', 'orderId', 'id')) ?? `${runeName}-${priceSats}`;

    return makeListing({
      source: 'unisat',
      sourceName: 'UniSat',
      sourceListingId: auctionId,
      assetType: 'rune',
      title: runeName,
      subtitle: amount ? `${amount.toLocaleString('en-US')} ${s(pick(o, 'symbol')) ?? ''}`.trim() : undefined,
      runeId: s(pick(o, 'runeid', 'runeId')),
      runeName,
      ticker: s(pick(o, 'symbol', 'tick')),
      amount: amount || undefined,
      unitPriceSats: n(pick(o, 'unitPrice')) || undefined,
      priceSats,
      sellerAddress: s(pick(o, 'sellerAddress', 'address')),
      listedAt: ts(pick(o, 'listTime', 'timestamp')),
      marketUrl: `https://unisat.io/runes/market?tick=${encodeURIComponent(runeName)}`,
      buyable: true,
      raw: o,
    });
  });
}

/** BRC-20 order book. */
async function fetchBrc20(q: ListingQuery): Promise<UnifiedListing[]> {
  const data = await fetchByType('brc20', q);

  return data.map((r) => {
    const o = r as Record<string, unknown>;
    const tick = s(pick(o, 'tick', 'ticker')) ?? 'brc20';
    const priceSats = n(pick(o, 'price', 'amount'));
    const amount = n(pick(o, 'tokenAmount', 'amount0', 'num'));

    return makeListing({
      source: 'unisat',
      sourceName: 'UniSat',
      sourceListingId: s(pick(o, 'auctionId', 'orderId', 'id')) ?? `${tick}-${priceSats}`,
      assetType: 'brc20',
      title: tick.toUpperCase(),
      subtitle: amount ? `${amount.toLocaleString('en-US')} ${tick.toUpperCase()}` : undefined,
      ticker: tick,
      amount: amount || undefined,
      unitPriceSats: n(pick(o, 'unitPrice')) || undefined,
      priceSats,
      inscriptionId: s(pick(o, 'inscriptionId')),
      sellerAddress: s(pick(o, 'sellerAddress', 'address')),
      listedAt: ts(pick(o, 'listTime', 'timestamp')),
      marketUrl: `https://unisat.io/market/brc20?tick=${encodeURIComponent(tick)}`,
      buyable: true,
      raw: o,
    });
  });
}

export const unisat: MarketSource = {
  id: 'unisat',
  name: 'UniSat',
  url: 'https://unisat.io',
  assetTypes: ['ordinal', 'rune', 'brc20'],
  configNote: 'Set UNISAT_API_KEY (docs.unisat.io → Developer Support → API key).',

  isConfigured: () => cfg.enabled && Boolean(cfg.apiKey),

  async fetchListings(q) {
    const jobs: Array<Promise<UnifiedListing[]>> = [];
    const want = (t: 'ordinal' | 'rune' | 'brc20') => wants([t], q);

    if (want('ordinal')) jobs.push(fetchOrdinals(q));
    if (want('rune')) jobs.push(fetchRunes(q));
    if (want('brc20')) jobs.push(fetchBrc20(q));

    const settled = await Promise.allSettled(jobs);
    const out: UnifiedListing[] = [];
    let failures = 0;
    for (const r of settled) {
      if (r.status === 'fulfilled') out.push(...r.value);
      else failures++;
    }
    // Every sub-call failing is a real source failure; a partial failure is not.
    if (failures === settled.length && settled.length > 0) {
      throw (settled[0] as PromiseRejectedResult).reason;
    }
    return out;
  },

  async quoteBuy(listing: UnifiedListing, buyer: BuyerContext): Promise<BuyQuote> {
    const isRune = listing.assetType === 'rune';
    const path = isRune
      ? '/v3/market/runes/auction/create_bid_prepare'
      : '/v3/market/collection/auction/create_bid_prepare';

    const prepare = await post<Record<string, unknown>>(path, {
      auctionId: listing.sourceListingId,
      bidPrice: listing.priceSats,
      address: buyer.paymentAddress,
      pubkey: buyer.paymentPublicKey,
      receiveAddress: buyer.ordinalsAddress,
      feeRate: buyer.feeRate,
    });

    const bidPath = isRune
      ? '/v3/market/runes/auction/create_bid'
      : '/v3/market/collection/auction/create_bid';

    const bid = await post<Record<string, unknown>>(bidPath, {
      auctionId: listing.sourceListingId,
      bidPrice: listing.priceSats,
      address: buyer.paymentAddress,
      pubkey: buyer.paymentPublicKey,
      receiveAddress: buyer.ordinalsAddress,
      feeRate: buyer.feeRate,
      serverFee: pick(prepare, 'serverFee'),
      serverRealFee: pick(prepare, 'serverRealFee'),
      serverReceiveAddress: pick(prepare, 'serverReceiveAddress'),
    });

    const psbt = s(pick(bid, 'psbtBid', 'psbt', 'psbtHex'));
    if (!psbt) throw new Error('unisat: no PSBT returned');

    const marketplaceFeeSats = n(pick(prepare, 'serverFee', 'serverRealFee'));
    const networkFeeSats = n(pick(bid, 'networkFee', 'minerFee'));

    return {
      listingId: listing.id,
      source: 'unisat',
      priceSats: listing.priceSats,
      marketplaceFeeSats,
      networkFeeSats,
      totalSats: listing.priceSats + marketplaceFeeSats + networkFeeSats,
      feeRate: buyer.feeRate,
      psbtBase64: psbt,
      signingIndexes: (pick(bid, 'signIndexes') as number[]) ?? [],
      submitContext: { bidId: s(pick(bid, 'bidId')), auctionId: listing.sourceListingId },
    };
  },

  async submitBuy(signedPsbtBase64, quote): Promise<BuyResult> {
    const res = await post<Record<string, unknown>>('/v3/market/collection/auction/confirm_bid', {
      auctionId: quote.submitContext.auctionId,
      bidId: quote.submitContext.bidId,
      psbtBid: signedPsbtBase64,
    });
    const txid = s(pick(res, 'txid', 'txId')) ?? '';
    return { txid, source: 'unisat', explorerUrl: `https://mempool.space/tx/${txid}` };
  },
};
