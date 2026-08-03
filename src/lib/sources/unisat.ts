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

async function post<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  const res = await request<Wrapped<T>>(`${cfg.base}${path}`, {
    method: 'POST',
    json: body,
    headers: headers(),
    ...(timeoutMs ? { timeoutMs } : {}),
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

/**
 * UniSat's book contains developer test collections ("test-collection",
 * "Test 07"). Because there is no usable price sort, these surface in the
 * arbitrary window we receive and would otherwise show as real listings.
 */
const TEST_SLUGS = /^(test|demo|sample)([-_]|$)/i;

function isTestCollection(o: Record<string, unknown>): boolean {
  const slug = s(pick(o, 'collectionId', 'collection_id')) ?? '';
  return TEST_SLUGS.test(slug);
}

/** "bitcoin-puppets" → "Bitcoin Puppets". The API only gives us the slug. */
function prettifySlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchByType(nftType: UnisatNftType, q: ListingQuery): Promise<unknown[]> {
  const dir = q.sort === 'price_desc' ? -1 : 1;

  // `unitPrice` is the only sort key the schema accepts — `sort.price` is
  // rejected outright. Collections return unitPrice: null, so this does not
  // actually order them by cost; we get an arbitrary window of the book and
  // re-sort locally. Increasing depth is the only way to get closer to a true
  // floor until UniSat exposes a price sort.
  const sort = { unitPrice: dir };

  const data = await post<unknown>(
    LIST_PATH,
    {
      filter: {
        nftType,
        ...(q.collectionSlug ? { collectionId: q.collectionSlug } : {}),
      },
      sort,
      start: 0,
      limit: depthOf(q),
    },
    // UniSat's BRC-20 book is genuinely slow and regularly exceeds the default
    // 9s ceiling. Given it is a keyed source we are paying for, wait it out.
    20_000,
  );

  return asArray(data);
}

/** Ordinals / collection order book. */
async function fetchOrdinals(q: ListingQuery): Promise<UnifiedListing[]> {
  const data = await fetchByType('collection', q);

  return data
    .filter((r) => !isTestCollection(r as Record<string, unknown>))
    .map((r) => {
    const o = r as Record<string, unknown>;
    const inscriptionId = s(pick(o, 'inscriptionId', 'nftId', 'inscription_id'));
    const priceSats = n(pick(o, 'price', 'amount', 'totalPrice'));
    const collectionSlug = s(pick(o, 'collectionId', 'collection_id'));
    const auctionId = s(pick(o, 'auctionId', 'orderId', 'id')) ?? inscriptionId ?? 'unknown';
    const inscriptionNumber =
      pick(o, 'inscriptionNumber') !== undefined ? n(pick(o, 'inscriptionNumber')) : undefined;

    // The order book carries no human collection name — only the slug — so we
    // render the slug rather than leaving the card blank.
    const collectionName = collectionSlug ? prettifySlug(collectionSlug) : undefined;

    // `collectionItemName` is the per-item name (e.g. "Bitcoin Puppet #4213").
    const itemName = s(pick(o, 'collectionItemName', 'inscriptionName', 'name'));

    return makeListing({
      source: 'unisat',
      sourceName: 'UniSat',
      sourceListingId: auctionId,
      assetType: 'ordinal',
      title:
        itemName ??
        collectionName ??
        (inscriptionNumber ? `#${inscriptionNumber}` : 'Inscription'),
      subtitle: collectionName,
      inscriptionId,
      inscriptionNumber,
      contentType: s(pick(o, 'contentType', 'content_type')),
      priceSats,
      outpoint:
        s(pick(o, 'outpoint')) ??
        (s(pick(o, 'txid')) ? `${s(pick(o, 'txid'))}:${n(pick(o, 'vout'))}` : undefined),
      sellerAddress: s(pick(o, 'address', 'sellerAddress', 'owner')),
      collectionSlug,
      collectionName,
      // `satoshi` is the value of the UTXO holding the inscription.
      utxoSizeSats: n(pick(o, 'satoshi', 'outValue', 'utxoValue')) || undefined,
      listedAt: ts(pick(o, 'onSaleTime', 'listTime', 'createTime', 'timestamp')),
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
