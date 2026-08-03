# btc.ag

**Nine Bitcoin marketplaces. One order book.**

A public website that aggregates Ordinals, Runes and Rare Sats listings from
every major venue into a single ranked book — deduplicated across marketplaces,
with rarity computed from ordinals theory rather than copied from venue tags,
and live on-chain fee data. Visitors connect their own wallet and buy from any
venue non-custodially.

Black and orange. Next.js 15, TypeScript. Deploys to Vercel.

**→ [DEPLOY.md](./DEPLOY.md) is the setup walkthrough.**

---

## Venues

| Venue | Assets | Operator key | Buy in-app |
|---|---|---|---|
| [UniSat](https://unisat.io) | Ordinals, Runes, BRC-20 | `UNISAT_API_KEY` | ✅ |
| [Magisat](https://magisat.io) | Rare Sats, Ordinals | `MAGISAT_API_KEY` | ✅ |
| [Satflow](https://www.satflow.com) | Ordinals, Runes, Rare Sats | `SATFLOW_API_KEY` | ✅ |
| [ORD.NET](https://ord.net) | Ordinals | `ORDNET_SIGNING_WIF` | ✅ |
| [Gamma](https://gamma.io) | Ordinals | — | deep link |
| [Ordinals Wallet](https://ordinalswallet.com) | Ordinals | — | deep link |
| [Odin.fun](https://odin.fun) | Tokens, Runes | — | deep link |
| [wecsats](https://wecsats.com) | Rare Sats | — | deep link |
| [Swap on Nexus](https://swap.on.nexus/pools) | Rune/BRC-20 pools | — | deep link |

Visitors need no keys — the site runs on the operator's. The four keyless
venues work the moment it deploys.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # optional — four venues work with no keys
npm run dev                    # http://localhost:3000
```

```bash
npm run probe     # live per-venue reachability, counts, floor prices
npm run verify    # 74 assertions
npm run ordnet    # ORD.NET signing wallet status
```

---

## What makes this an aggregator and not a list of links

**Cross-venue deduplication.** The same inscription listed on UniSat, Gamma and
Satflow is *one* row showing the cheapest ask, with the others in `alsoOn` and a
spread badge on the card. Uniques key on inscription ID or UTXO; fungibles key
on ticker and collapse on **unit** price, not total — so a 50-unit lot at 200
sats each never beats a 1000-unit lot at 100.

**Rarity computed from the chain.** `src/lib/sats.ts` is a from-spec
implementation of ordinals theory: block subsidy, epoch tables, degree notation,
the six rarity classes, Rodarmor names, and sattributes (palindromes,
palinception, block 9 / 450x, vintage, pizza). Venues disagree about sattributes
constantly. The chain does not. Verified against published spec values —
`satName(0) === 'nvtdijuwxlp'`.

**Per-source isolation.** One venue timing out, rate-limiting or changing its
JSON shape produces one `ok: false` row in the status rail and zero listings. It
never throws upward, never blocks the response, never silently disappears.
Verified: with all nine sources unreachable, `/api/listings` still returns HTTP
200 with full per-source diagnostics.

**Live chain data.** Block height, fee tiers and mempool depth from
mempool.space — or your own node, via `MEMPOOL_BASE`. Fees are in the buy modal
because the miner fee is often a material fraction of a cheap listing.

---

## Running it as a public site

Three things matter once strangers can hit the endpoints, because every visitor
request can fan out to nine marketplaces **on the operator's keys**.

**Shared cache.** Two-tier: in-process memory in front of Upstash Redis. On
Vercel each serverless instance has its own memory, so without the shared tier
your API quota burns in proportion to traffic. With it, one fan-out every 20
seconds serves everybody. Single-flight de-duplication runs at both levels —
in-process via a promise map, cross-instance via a short Redis lock — so a cold
cache plus a traffic spike does not stampede all nine venues at once. If the
origin fails, a stale copy is served rather than an empty page.

**Rate limiting.** Per-IP fixed windows: 40/min on the aggregated book, 120/min
on cached reads, 12/min on purchase quotes. Redis-backed when configured,
in-process otherwise.

**Cache warming.** A Vercel cron hits `/api/cron/refresh` every 5 minutes to keep
the four main views hot and to renew the ORD.NET session. Visitors arriving on a
cold cache get an instant page instead of waiting on a nine-way fan-out.

Check it's all wired up:

```bash
curl -s https://btc.ag/api/sources | jq .cache
# { "shared": true, "reachable": true }
```

---

## The ORD.NET problem

ORD.NET issues **no API keys**. A wallet BIP-322 signs a challenge and receives
a bearer token valid for **one hour**, and the signing payment address must hold
**≥ 0.01 BTC confirmed**.

A pasted-in token dies within an hour of deploy, so btc.ag re-signs
automatically: `src/lib/ordnet-auth.ts` holds a dedicated signing key, runs the
challenge/verify flow, caches the session in Redis, and refreshes it ten minutes
before expiry. A Redis lock ensures only one instance re-authenticates, since
ORD.NET allows just 5 auth attempts per address per minute.

> `ORDNET_SIGNING_WIF` is a hot key. Use a wallet created solely for this,
> funded with a little over 0.01 BTC and nothing else. btc.ag only ever signs
> auth challenges with it — it never builds a spend — but treat any key in a
> deployed environment as compromisable. Leaving it unset is fully supported:
> ORD.NET shows as unconfigured and the other eight venues carry on.

```bash
npm run ordnet -- --generate    # mint a throwaway wallet, print WIF + addresses
npm run ordnet -- --test        # check funding, then run the real auth flow
```

---

## Buying

btc.ag never holds keys, funds or assets.

```
listing → POST /api/buy/quote   → origin venue builds an unsigned PSBT
        → wallet.signPsbt()     → signature happens inside the visitor's extension
        → POST /api/buy/submit  → venue verifies and broadcasts
        → txid
```

Wallets: UniSat, Xverse, Leather, Magic Eden, OKX. Injected providers and
sats-connect providers are normalised behind one `WalletSession`, so the buy
flow doesn't care which wallet the visitor brought. The session lives in
`sessionStorage` only — it dies with the tab, which is the right default for
anything touching money.

---

## API

| Route | Purpose | Limit/min |
|---|---|---|
| `GET /api/listings` | The aggregated book | 40 |
| `GET /api/chain` | Height, fee tiers, mempool, BTC price | 120 |
| `GET /api/sources` | Venue status + cache health (also the uptime check) | — |
| `GET /api/portfolio?address=` | Balance, UTXOs, sat rarity when `ORD_BASE` is set | 120 |
| `POST /api/buy/quote` | Unsigned purchase PSBT from the origin venue | 12 |
| `POST /api/buy/submit` | Signed PSBT → broadcast | 12 |
| `GET /api/cron/refresh` | Cache warm + ORD.NET renewal (`CRON_SECRET`) | — |

`/api/listings` params: `asset` `sort` `q` `sources` `rarity` `minPrice`
`maxPrice` `collection` `depth` `limit`.

Response headers worth watching: `x-btcag-tier` (`memory` / `redis` / `origin`),
`x-btcag-cached`, `x-btcag-elapsed-ms`, `x-ratelimit-remaining`.

---

## Layout

```
src/
  lib/
    sats.ts          ordinals theory — rarity, degrees, names, sattributes
    aggregate.ts     fan-out, dedupe, cross-listing, filters, sorting
    cache.ts         two-tier cache + single-flight
    kv.ts            Upstash REST client
    ratelimit.ts     per-IP windows
    ordnet-auth.ts   BIP-322 signing + hourly token refresh
    chain.ts         mempool.space: fees, height, UTXOs, broadcast
    http.ts          the one outbound path — timeouts, bounded retry, concurrency
    sources/         one adapter per venue, all behind MarketSource
  app/
    api/             listings, chain, sources, portfolio, buy/*, cron/refresh
    robots.ts        sitemap.ts        opengraph-image.tsx
  components/        ChainBar, ListingCard, Filters, SourceStatus, BuyModal
  wallet/            connectors + React context
scripts/
  probe-sources.ts   live reachability per venue
  ordnet-setup.ts    signing wallet generate / inspect / test
  verify.ts          74 assertions
```

### Adding a venue

Implement `MarketSource` (`src/lib/types.ts`), register it in
`src/lib/sources/index.ts`. Return `UnifiedListing[]` from `fetchListings`; add
`quoteBuy`/`submitBuy` only if the venue exposes a PSBT flow. Everything
downstream — dedupe, filters, rarity, caching, rate limits, UI — works
automatically.

---

## Notes on the unkeyed adapters

Gamma, wecsats and Nexus don't publish API references. Those three adapters
target the sites' own JSON routes and are fully env-overridable
(`GAMMA_LISTINGS_PATH`, `WECSATS_LISTINGS_PATH`, `NEXUS_POOLS_PATH`) with
shape-agnostic response walking — so if a route moves, you re-point it in the
environment instead of editing code. `npm run probe` shows exactly which one is
off and why.

Ordinals Wallet has no global order book; its API is per-collection, so btc.ag
sweeps the slugs in `ORDINALSWALLET_COLLECTIONS`. Add slugs to widen coverage.

---

## Disclaimer

Aggregates public marketplace data. Listings can be filled or cancelled upstream
at any moment — always confirm on the origin marketplace before committing
funds. Not financial advice.
