'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChainBar } from '@/components/ChainBar';
import { WalletButton } from '@/components/WalletButton';
import { ListingCard } from '@/components/ListingCard';
import { SourceStatus } from '@/components/SourceStatus';
import { AssetTabs, DEFAULT_FILTERS, Filters, type FilterState } from '@/components/Filters';
import { BuyModal } from '@/components/BuyModal';
import type { AggregateResult, ChainStatus, UnifiedListing } from '@/lib/types';
import { btc, commas } from '@/lib/format';

const SATS_PER_BTC = 100_000_000;

export default function Home() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<AggregateResult | null>(null);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState<UnifiedListing | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const reqId = useRef(0);

  // Debounce the search box so typing does not fan out to nine venues per key.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: search })), 350);
    return () => clearTimeout(t);
  }, [search]);

  const url = useMemo(() => {
    const p = new URLSearchParams();
    p.set('asset', filters.asset);
    p.set('sort', filters.sort);
    p.set('depth', String(filters.depth));
    p.set('limit', '240');
    if (filters.q) p.set('q', filters.q);
    if (filters.sources.length) p.set('sources', filters.sources.join(','));
    if (filters.rarity.length) p.set('rarity', filters.rarity.join(','));

    const toSats = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.round(n * SATS_PER_BTC) : undefined;
    };
    const min = toSats(filters.minBtc);
    const max = toSats(filters.maxBtc);
    if (min) p.set('minPrice', String(min));
    if (max) p.set('maxPrice', String(max));

    return `/api/listings?${p}`;
  }, [filters]);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch(url);
      const json = (await res.json()) as AggregateResult;
      // Ignore responses that arrived after a newer request was issued.
      if (id === reqId.current && !('error' in json)) setData(json);
    } catch {
      /* the source status panel already surfaces per-venue failure */
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  useEffect(() => {
    fetch('/api/chain')
      .then((r) => r.json())
      .then(setChain)
      .catch(() => null);
  }, []);

  const listings = data?.listings ?? [];

  const stats = useMemo(() => {
    if (!listings.length) return null;
    const prices = listings.map((l) => l.priceSats);
    const crossListed = listings.filter((l) => l.crossListed);
    const bestSpread = crossListed.reduce((best, l) => {
      const max = Math.max(...(l.alsoOn?.map((o) => o.priceSats) ?? [0]));
      const pct = l.priceSats > 0 ? ((max - l.priceSats) / l.priceSats) * 100 : 0;
      return pct > best ? pct : best;
    }, 0);

    return {
      floor: Math.min(...prices),
      count: data?.total ?? listings.length,
      crossListed: crossListed.length,
      bestSpread,
    };
  }, [listings, data]);

  return (
    <>
      <ChainBar />

      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black tracking-tight text-orange-500">btc</span>
            <span className="text-xl font-black tracking-tight text-neutral-100">.ag</span>
          </div>

          <span className="hidden text-[10px] uppercase tracking-[0.18em] text-neutral-600 lg:inline">
            nine venues · one order book
          </span>

          <input
            className="input ml-auto max-w-md"
            placeholder="Search collections, runes, sat names, inscription IDs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button
            className="btn-ghost lg:hidden"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Toggle filters"
          >
            Filters
          </button>

          <WalletButton />
        </div>

        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 pb-3">
          <AssetTabs value={filters.asset} onChange={(asset) => setFilters((f) => ({ ...f, asset }))} />

          <div className="ml-auto flex items-center gap-3 font-mono text-[10px] text-neutral-600">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-orange-500"
              />
              auto-refresh
            </label>
            <button onClick={load} className="hover:text-orange-400" disabled={loading}>
              {loading ? 'loading…' : 'refresh'}
            </button>
            {data && (
              <span title={data.cached ? 'served from cache' : 'freshly aggregated'}>
                {data.elapsedMs}ms{data.cached ? ' · cached' : ''}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5">
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          {/* Rail */}
          <aside className={`space-y-4 ${showFilters ? '' : 'hidden lg:block'}`}>
            <SourceStatus sources={data?.sources ?? []} />
            <Filters state={filters} onChange={setFilters} sources={data?.sources ?? []} />
          </aside>

          {/* Book */}
          <section>
            {stats && (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Listings" value={commas(stats.count)} />
                <Stat label="Floor" value={`${btc(stats.floor)} BTC`} accent />
                <Stat label="Cross-listed" value={commas(stats.crossListed)} />
                <Stat
                  label="Widest spread"
                  value={stats.bestSpread > 0 ? `${stats.bestSpread.toFixed(0)}%` : '—'}
                  accent={stats.bestSpread > 15}
                />
              </div>
            )}

            {loading && !listings.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="card overflow-hidden">
                    <div className="skeleton aspect-square" />
                    <div className="space-y-2 p-3">
                      <div className="skeleton h-3 w-3/4 rounded" />
                      <div className="skeleton h-3 w-1/2 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : listings.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {listings.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    btcPrice={chain?.btcPrice}
                    onBuy={setBuying}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                anyConfigured={(data?.sources ?? []).some((s) => s.configured)}
                onReset={() => {
                  setFilters(DEFAULT_FILTERS);
                  setSearch('');
                }}
              />
            )}
          </section>
        </div>
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 py-8 text-[10px] leading-relaxed text-neutral-700">
        btc.ag aggregates public marketplace data and never custodies assets or funds.
        Rarity and sattributes are computed locally from ordinals theory rather than
        taken from venue tags. Listings can be filled or cancelled upstream at any
        moment — always confirm on the origin marketplace before committing funds.
        Nothing here is financial advice.
      </footer>

      <BuyModal listing={buying} chain={chain} onClose={() => setBuying(null)} />
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-neutral-600">{label}</div>
      <div
        className={`font-mono text-sm font-semibold ${accent ? 'text-orange-400' : 'text-neutral-200'}`}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({
  anyConfigured,
  onReset,
}: {
  anyConfigured: boolean;
  onReset: () => void;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-12 text-center">
      <div className="font-mono text-4xl text-ink-600">₿</div>
      {anyConfigured ? (
        <>
          <p className="text-sm text-neutral-400">Nothing matches those filters.</p>
          <button className="btn-ghost" onClick={onReset}>
            Reset filters
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-400">No venues are configured yet.</p>
          <p className="max-w-md text-xs leading-relaxed text-neutral-600">
            Copy <code className="text-orange-500/80">.env.example</code> to{' '}
            <code className="text-orange-500/80">.env.local</code> and add at least one
            marketplace key. Ordinals Wallet, Odin.fun, Gamma and Nexus need no key at
            all — they should be live already.
          </p>
        </>
      )}
    </div>
  );
}
