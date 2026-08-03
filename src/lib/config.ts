/**
 * Runtime configuration. Everything is env-driven so btc.ag can be deployed
 * with zero keys (public sources only) or with every key (full coverage).
 */

const env = (k: string, fallback = ''): string => (process.env[k] ?? fallback).trim();
const num = (k: string, fallback: number): number => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : fallback;
};
const bool = (k: string, fallback: boolean): boolean => {
  const v = env(k).toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes';
};

export const config = {
  /** Canonical public origin. Used for metadata, sitemap and OG images. */
  site: {
    url: env('NEXT_PUBLIC_SITE_URL', 'https://btc.ag').replace(/\/+$/, ''),
    name: 'btc.ag',
  },

  /**
   * Upstash Redis. Optional but strongly recommended in production: without it
   * every serverless instance keeps a private cache and the marketplace API
   * quota scales with traffic instead of with time.
   */
  redis: {
    url: env('UPSTASH_REDIS_REST_URL') || env('KV_REST_API_URL'),
    token: env('UPSTASH_REDIS_REST_TOKEN') || env('KV_REST_API_TOKEN'),
    timeoutMs: num('REDIS_TIMEOUT_MS', 2_000),
  },

  /** Per-IP request budgets. Public site; the keys are the operator's. */
  rateLimit: {
    enabled: bool('RATE_LIMIT_ENABLED', true),
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
    /** Aggregated book — the expensive one. */
    listings: num('RATE_LIMIT_LISTINGS', 40),
    /** Cheap cached reads. */
    light: num('RATE_LIMIT_LIGHT', 120),
    /** Purchase quote/submit — hits an upstream venue with side effects. */
    buy: num('RATE_LIMIT_BUY', 12),
  },

  /** Shared secret for the cache-warming cron route. */
  cronSecret: env('CRON_SECRET'),

  /** How long an aggregated page is served from cache. Listings move fast. */
  cacheTtlMs: num('CACHE_TTL_MS', 20_000),
  /** Chain data changes at most every ~10 min, but fees move faster. */
  chainCacheTtlMs: num('CHAIN_CACHE_TTL_MS', 15_000),
  /** Hard ceiling on any single upstream call. A slow venue must not stall the page. */
  sourceTimeoutMs: num('SOURCE_TIMEOUT_MS', 9_000),
  /** Per-source page size when the client does not specify depth. */
  defaultDepth: num('DEFAULT_DEPTH', 50),
  maxDepth: num('MAX_DEPTH', 200),
  /** Fan-out concurrency. 9 sources, so default runs them all at once. */
  concurrency: num('SOURCE_CONCURRENCY', 9),
  userAgent: env('USER_AGENT', 'btc.ag/1.0 (+https://btc.ag)'),

  mempool: {
    base: env('MEMPOOL_BASE', 'https://mempool.space/api'),
  },

  sources: {
    unisat: {
      enabled: bool('UNISAT_ENABLED', true),
      base: env('UNISAT_BASE', 'https://open-api.unisat.io'),
      apiKey: env('UNISAT_API_KEY'),
    },
    magisat: {
      enabled: bool('MAGISAT_ENABLED', true),
      base: env('MAGISAT_BASE', 'https://api.magisat.io/external/v1'),
      apiKey: env('MAGISAT_API_KEY'),
    },
    satflow: {
      enabled: bool('SATFLOW_ENABLED', true),
      base: env('SATFLOW_BASE', 'https://api.satflow.com/v1'),
      apiKey: env('SATFLOW_API_KEY'),
    },
    gamma: {
      enabled: bool('GAMMA_ENABLED', true),
      base: env('GAMMA_BASE', 'https://gamma.io/api/v1'),
      apiKey: env('GAMMA_API_KEY'),
    },
    ordinalswallet: {
      enabled: bool('ORDINALSWALLET_ENABLED', true),
      base: env('ORDINALSWALLET_BASE', 'https://turbo.ordinalswallet.com'),
      cdn: env('ORDINALSWALLET_CDN', 'https://cdn.ordinalswallet.com'),
      /** Public API — no key. Which collections to sweep for escrows. */
      collections: env(
        'ORDINALSWALLET_COLLECTIONS',
        'bitcoin-puppets,nodemonkes,quantum_cats,ordinal-maxi-biz,bitcoin-frogs,runestone,taproot-wizards,pizza-ninjas,basedangels,natcats',
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    ordnet: {
      // Off by default: ORD.NET requires the signing wallet to hold 0.01 BTC
      // confirmed, which is a steep entry price for one more ordinals venue
      // when UniSat and Ordinals Wallet already cover that asset class.
      // Set ORDNET_ENABLED=true if you decide it's worth funding.
      enabled: bool('ORDNET_ENABLED', false),
      base: env('ORDNET_BASE', 'https://ord.net/api/v1'),
      /**
       * Dedicated signing wallet (WIF). ORD.NET tokens last one hour, so a
       * public deployment must be able to re-sign the challenge unattended.
       * The derived payment address must hold >= 0.01 BTC confirmed.
       * HOT KEY — use a wallet that holds nothing else.
       */
      signingWif: env('ORDNET_SIGNING_WIF'),
      /** Manually pasted token. Works, but expires within the hour. */
      token: env('ORDNET_TOKEN'),
    },
    odin: {
      enabled: bool('ODIN_ENABLED', true),
      base: env('ODIN_BASE', 'https://api.odin.fun/v1'),
    },
    wecsats: {
      // wecsats.com redirects to wecsats.io, and the live site presents as a
      // rare-sat explorer rather than an order book — no public listings API
      // has been found. Off by default so it does not sit red in the status
      // rail forever; flip it on once a real endpoint is known.
      enabled: bool('WECSATS_ENABLED', false),
      base: env('WECSATS_BASE', 'https://wecsats.io/api'),
      apiKey: env('WECSATS_API_KEY'),
    },
    nexus: {
      enabled: bool('NEXUS_ENABLED', true),
      base: env('NEXUS_BASE', 'https://api.dotswap.app/api/v1'),
      apiKey: env('NEXUS_API_KEY'),
    },
  },
} as const;

export type Config = typeof config;
