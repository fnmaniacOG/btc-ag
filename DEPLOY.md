# Deploying btc.ag

Getting the public site live on Vercel, with all nine venues.

Rough time: **20 minutes** for the site and the free venues, plus however long
each marketplace takes to issue you a key.

---

## 1. Ship it first, add keys later

```bash
git init && git add . && git commit -m "btc.ag"
gh repo create btc-ag --private --source=. --push     # or push to GitHub manually
```

On [vercel.com/new](https://vercel.com/new): import the repo → **Deploy**. Next.js
is detected automatically; no build settings to change.

The site is now live with four venues (Gamma, Ordinals Wallet, Odin.fun, Nexus),
which need no keys. Everything below makes it production-grade.

---

## 2. Shared cache — do this before you tell anyone about the site

**This is the most important step on the page.** Skip it and your marketplace
API quota burns in proportion to traffic, because every Vercel instance keeps a
private cache and re-fans-out to all nine venues. With it, one fan-out every 20
seconds serves everybody.

1. Vercel dashboard → **Storage** → **Create** → **Upstash Redis** (free tier is
   plenty). Connecting it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically — btc.ag reads either those or the `UPSTASH_*` names.
2. Redeploy.
3. Confirm: `curl https://btc.ag/api/sources | jq .cache`

```json
{ "shared": true, "reachable": true }
```

If `warning` is present, the cache is not wired up and you should not be sending
traffic yet.

---

## 3. Environment variables

Vercel → **Settings** → **Environment Variables**. Set for Production (and
Preview if you want previews to work).

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://btc.ag` |
| `CRON_SECRET` | `openssl rand -hex 32` |

Then the marketplace keys below.

---

## 4. Venue keys

### UniSat — Ordinals, Runes, BRC-20

The single highest-value key: it is the deepest book on three asset types.

1. [docs.unisat.io → How to Acquire a UniSat API Key](https://docs.unisat.io/developer-support/how-to-acquire-a-unisat-api-key)
2. Register, enable 2FA, pick a plan (there is a free tier).
3. Set `UNISAT_API_KEY`.

### Magisat — Rare Sats

The deepest rare-sat order book; without it the Rare Sats tab is thin.

1. [magisat.io/docs/api/v1](https://magisat.io/docs/api/v1)
2. Request a key, set `MAGISAT_API_KEY`.

### Satflow — Ordinals, Runes, Rare Sats

Worth having beyond its own book: with `external=true` it also returns listings
Satflow has indexed from *other* venues, which widens coverage.

1. Ask in the [Satflow Discord](https://discord.gg/satflow).
2. Set `SATFLOW_API_KEY`.

### ORD.NET — Ordinals

The awkward one. ORD.NET issues **no API keys**. A wallet BIP-322 signs a
challenge and receives a bearer token valid for **one hour**, and the signing
payment address must hold **≥ 0.01 BTC confirmed**.

For a site that runs unattended, btc.ag re-signs automatically. That means a
private key in your environment.

> **Read this before you continue.** `ORDNET_SIGNING_WIF` is a hot key. Use a
> wallet created only for this, funded with a little over 0.01 BTC and nothing
> else. Never reuse a wallet holding inscriptions, runes, or savings. btc.ag
> only ever signs auth challenges with it — it never builds a spend — but treat
> any key in a deployed environment as compromisable.
>
> Leaving `ORDNET_SIGNING_WIF` unset is completely fine. ORD.NET shows as
> unconfigured and the other eight venues carry on.

```bash
npm run ordnet -- --generate
```

```
ORDNET_SIGNING_WIF  L4rK1yDt...
ordinals            bc1p...
payment             bc1q...   ← fund this one
```

1. Put the WIF in Vercel as `ORDNET_SIGNING_WIF`.
2. Send ~0.0105 BTC to the **payment** address.
3. After one confirmation: `npm run ordnet -- --test`

```
funding      0.01050000 BTC confirmed — meets the 0.01 BTC requirement
Token issued — valid for 58 minutes.
```

The cron job in step 5 keeps it refreshed from then on.

### Optional keys

`GAMMA_API_KEY`, `WECSATS_API_KEY`, `NEXUS_API_KEY` — these venues work without
one; a key only raises rate limits.

---

## 5. Cron — keeps the cache warm and ORD.NET alive

`vercel.json` already declares it:

```json
{ "crons": [{ "path": "/api/cron/refresh", "schedule": "*/5 * * * *" }] }
```

Every 5 minutes it refreshes the four main views and renews the ORD.NET token
well before its hourly expiry. Vercel sends `CRON_SECRET` as a bearer token
automatically — just make sure the variable is set. Verify under
**Deployments → Crons** after your next deploy.

Without the cron the site still works; visitors just occasionally pay for a
cold fan-out, and ORD.NET goes dark during quiet hours.

---

## 6. Domain

Vercel → **Settings** → **Domains** → add `btc.ag`. Point your registrar at
Vercel's nameservers, or add the A/CNAME records it shows you. TLS is automatic.

Set `NEXT_PUBLIC_SITE_URL=https://btc.ag` so canonical URLs, the sitemap and OG
images use the real origin.

---

## 7. Verify the deployment

```bash
# every venue's status, and whether the shared cache is live
curl -s https://btc.ag/api/sources | jq '.cache, [.sources[] | {name, configured}]'

# the aggregated book — check the headers
curl -sD- -o /dev/null 'https://btc.ag/api/listings?asset=all&depth=20'
```

Look for:

- `x-btcag-tier: redis` on a second request — the shared cache is doing its job
- `x-ratelimit-remaining` counting down
- `x-btcag-elapsed-ms` in the low hundreds when cached

Then locally:

```bash
npm run probe     # live per-venue reachability, with counts and floor prices
npm run verify    # 74 assertions
```

---

## Rate limits

Per IP, per 60s window. Tune with `RATE_LIMIT_*`.

| Endpoint | Default |
|---|---|
| `/api/listings` | 40 |
| `/api/chain`, `/api/portfolio` | 120 |
| `/api/buy/*` | 12 |

These exist because every visitor request can fan out to nine marketplaces on
**your** keys. One unthrottled scraper can burn a monthly quota in an afternoon
and get your keys suspended.

Upstream limits worth knowing: ORD.NET allows 60 trading reads/IP and 30/profile
per minute, and only 5 auth attempts per address per minute. Since the whole
site shares one server identity, the aggregate cache is what keeps btc.ag inside
that budget — another reason step 2 is not optional.

---

## Costs

| | Free tier | When you outgrow it |
|---|---|---|
| Vercel Hobby | 100 GB bandwidth/mo | Pro at $20/mo (also required for commercial use) |
| Upstash Redis | 10k commands/day | ~$0.20 per 100k after |
| Marketplace APIs | varies | UniSat and Satflow have paid tiers |

With the cron warming four views every 5 minutes, Redis usage is roughly 2.3k
commands/day before any visitor traffic — comfortably inside the free tier.

---

## Troubleshooting

**A venue shows "fetch failed" or a timeout.** Run `npm run probe` to see the
raw error per venue. Gamma, wecsats and Nexus publish no API reference, so if
one of them moved a route, re-point it with `GAMMA_LISTINGS_PATH`,
`WECSATS_LISTINGS_PATH` or `NEXUS_POOLS_PATH` instead of editing code.

**ORD.NET says "signing wallet holds < 0.01 BTC confirmed".** Exactly what it
says — the funding requirement is checked at every auth. Unconfirmed doesn't
count. Note that if you ever spend from that address below the threshold, the
venue silently drops off the site.

**Everything is empty and `/api/sources` shows all venues unconfigured.** The
env vars are set on the wrong Vercel environment, or you haven't redeployed —
Vercel does not apply new environment variables to an existing deployment.

**Listings look stale.** Expected: the cache is 20s and Vercel's edge holds
another 15s with a 60s stale-while-revalidate. Always confirm on the origin
marketplace before committing funds — the disclaimer in the footer is there for
a reason.
