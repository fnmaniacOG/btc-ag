/**
 * btc.ag core domain types.
 *
 * Every marketplace speaks a different dialect. Everything below is the single
 * dialect the rest of the app speaks. Adapters translate into it; nothing
 * downstream of an adapter ever sees a vendor-specific shape.
 */

export type AssetType = 'ordinal' | 'rune' | 'rare-sat' | 'brc20' | 'token' | 'pool';

export type SourceId =
  | 'unisat'
  | 'magisat'
  | 'satflow'
  | 'gamma'
  | 'ordinalswallet'
  | 'ordnet'
  | 'odin'
  | 'wecsats'
  | 'nexus';

/** Ordinals-theory sat rarity, per the ord spec. */
export type SatRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

/** Collector-recognised "sattributes" that are not part of core rarity. */
export type Sattribute =
  | 'palindrome'
  | 'perfect_palinception'
  | 'uniform_palinception'
  | 'block9'
  | 'block9_450x'
  | 'block78'
  | 'block286'
  | 'block666'
  | 'pizza'
  | 'jpeg'
  | 'nakamoto'
  | 'vintage'
  | 'first_tx'
  | 'hitman'
  | 'silk_road'
  | 'alpha'
  | 'omega'
  | 'block_78'
  | 'legacy'
  | 'name_rare'
  | 'rodarmor_name';

export interface SatRange {
  /** Absolute sat number of the first sat in the range. */
  start: number;
  /** Number of sats in the range. */
  size: number;
  rarity?: SatRarity;
  sattributes?: Sattribute[];
}

export interface UnifiedListing {
  /** Deterministic, stable across refreshes: `${source}:${sourceListingId}`. */
  id: string;
  source: SourceId;
  sourceName: string;
  sourceListingId: string;

  assetType: AssetType;

  /** Human title, e.g. "Bitcoin Puppets #4213" or "DOG•GO•TO•THE•MOON". */
  title: string;
  subtitle?: string;

  /** Ordinals. */
  inscriptionId?: string;
  inscriptionNumber?: number;
  contentType?: string;

  /** Runes / BRC-20 / Odin tokens. */
  runeId?: string;
  runeName?: string;
  ticker?: string;
  /** Token amount being sold, in display units (already divided by divisibility). */
  amount?: number;
  /** Price per whole token, in sats. */
  unitPriceSats?: number;

  /** Rare sats. */
  satRanges?: SatRange[];
  rarity?: SatRarity;
  sattributes?: Sattribute[];
  /** Total sats in the UTXO backing this listing. */
  utxoSizeSats?: number;

  /** Total ask in satoshis. This is the number everything sorts on. */
  priceSats: number;

  /** UTXO the listing is escrowed against, `txid:vout`. */
  outpoint?: string;
  sellerAddress?: string;

  collectionSlug?: string;
  collectionName?: string;

  imageUrl?: string;
  /** Where a human goes to see/buy this on the origin marketplace. */
  marketUrl: string;

  /** Epoch millis. */
  listedAt?: number;
  updatedAt?: number;

  /** True when this exact asset is listed on more than one venue. */
  crossListed?: boolean;
  /** Other venues carrying the same asset, cheapest-first. */
  alsoOn?: Array<{
    source: SourceId;
    priceSats: number;
    /** Present for fungibles — the only number they can be compared on. */
    unitPriceSats?: number;
    marketUrl: string;
  }>;

  /** Can btc.ag build and broadcast the buy PSBT itself? */
  buyable: boolean;

  /** Raw upstream payload, kept for debugging + PSBT construction. */
  raw?: unknown;
}

export interface ListingQuery {
  assetType?: AssetType | 'all';
  /** Free-text: collection name, rune ticker, inscription id, sat name. */
  q?: string;
  sources?: SourceId[];
  minPriceSats?: number;
  maxPriceSats?: number;
  rarity?: SatRarity[];
  sattributes?: Sattribute[];
  collectionSlug?: string;
  sort?: 'price_asc' | 'price_desc' | 'recent' | 'unit_price_asc' | 'rarity_desc';
  limit?: number;
  cursor?: string;
  /** Per-source page size hint. Higher = more coverage, slower. */
  depth?: number;
  /** Bypass the cache. Cron warming only — never settable from a query string. */
  forceRefresh?: boolean;
}

export interface SourceHealth {
  source: SourceId;
  name: string;
  url: string;
  assetTypes: AssetType[];
  ok: boolean;
  configured: boolean;
  /** Why it is not configured / not ok. */
  note?: string;
  latencyMs?: number;
  count?: number;
}

export interface AggregateResult {
  listings: UnifiedListing[];
  sources: SourceHealth[];
  total: number;
  /** ms the whole fan-out took. */
  elapsedMs: number;
  cached: boolean;
  /** Which cache tier served this: process memory, shared Redis, or a live fan-out. */
  tier: 'memory' | 'redis' | 'origin';
  fetchedAt: number;
}

export interface ChainStatus {
  height: number;
  blockHash?: string;
  /** sat/vB */
  fees: { fastest: number; halfHour: number; hour: number; economy: number; minimum: number };
  mempool: { count: number; vsize: number; totalFeeSats: number };
  /** USD */
  btcPrice?: number;
  fetchedAt: number;
}

/** ---- Buy flow ---- */

export interface BuyQuote {
  listingId: string;
  source: SourceId;
  priceSats: number;
  /** Marketplace take rate, in sats. */
  marketplaceFeeSats: number;
  /** Estimated miner fee at the chosen feerate. */
  networkFeeSats: number;
  totalSats: number;
  feeRate: number;
  /** Base64 PSBT the wallet must sign. */
  psbtBase64: string;
  /** Indexes the buyer must sign, and with what sighash. */
  signingIndexes: number[];
  sighashType?: number;
  /** Opaque handles the venue wants echoed back on submit. */
  submitContext: Record<string, unknown>;
  expiresAt?: number;
}

export interface BuyResult {
  txid: string;
  source: SourceId;
  explorerUrl: string;
}

/** Adapter contract. Every venue implements this. */
export interface MarketSource {
  id: SourceId;
  name: string;
  url: string;
  assetTypes: AssetType[];
  /** False when a required API key is absent — source is skipped, not failed. */
  isConfigured(): boolean;
  /** Why it is unconfigured, shown in the UI status rail. */
  configNote?: string;
  fetchListings(query: ListingQuery): Promise<UnifiedListing[]>;
  /** Optional: build an unsigned purchase PSBT. */
  quoteBuy?(listing: UnifiedListing, buyer: BuyerContext): Promise<BuyQuote>;
  /** Optional: submit the signed PSBT and broadcast. */
  submitBuy?(signedPsbtBase64: string, quote: BuyQuote, buyer: BuyerContext): Promise<BuyResult>;
}

export interface BuyerContext {
  /** Taproot/ordinals address that will receive the asset. */
  ordinalsAddress: string;
  ordinalsPublicKey?: string;
  /** Address funding the purchase. */
  paymentAddress: string;
  paymentPublicKey?: string;
  feeRate: number;
  /** Venue-specific bearer token, if the client obtained its own. */
  authToken?: string;
  /**
   * Buyer's spendable (cardinal) UTXOs. ORD.NET requires these on purchase
   * preflight and caps the list at 1000.
   */
  spendableUtxos?: Array<{ txid: string; vout: number; value: number }>;
}
