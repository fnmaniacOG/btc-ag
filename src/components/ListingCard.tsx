'use client';

import { useState } from 'react';
import type { UnifiedListing } from '@/lib/types';
import { btc, commas, shortId, usd } from '@/lib/format';

const RARITY_STYLE: Record<string, string> = {
  mythic: 'border-fuchsia-500/60 bg-fuchsia-500/10 text-fuchsia-300',
  legendary: 'border-amber-400/60 bg-amber-400/10 text-amber-300',
  epic: 'border-violet-500/60 bg-violet-500/10 text-violet-300',
  rare: 'border-sky-500/60 bg-sky-500/10 text-sky-300',
  uncommon: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300',
  common: 'border-ink-600 bg-ink-850 text-neutral-500',
};

const ASSET_LABEL: Record<string, string> = {
  ordinal: 'ORD',
  rune: 'RUNE',
  'rare-sat': 'SAT',
  brc20: 'BRC20',
  token: 'TOKEN',
  pool: 'POOL',
};

export function ListingCard({
  listing,
  btcPrice,
  onBuy,
}: {
  listing: UnifiedListing;
  btcPrice?: number;
  onBuy: (l: UnifiedListing) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  const spreadPct =
    listing.alsoOn?.length && listing.priceSats > 0
      ? ((Math.max(...listing.alsoOn.map((o) => o.priceSats)) - listing.priceSats) /
          listing.priceSats) *
        100
      : 0;

  const fiat = usd(listing.priceSats, btcPrice);

  return (
    <div className="card group flex flex-col overflow-hidden transition hover:border-orange-600/70 hover:shadow-glow">
      {/* Media */}
      <div className="relative aspect-square bg-ink-850">
        {listing.imageUrl && !imgFailed ? (
          // Inscription content comes from many hosts and is often SVG/HTML —
          // a plain img keeps it sandboxed and avoids the optimiser choking.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.imageUrl}
            alt={listing.title}
            loading="lazy"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-mono text-3xl text-ink-600">
              {ASSET_LABEL[listing.assetType] ?? '₿'}
            </span>
          </div>
        )}

        <span className="chip absolute left-2 top-2 !bg-black/80 !text-orange-400">
          {ASSET_LABEL[listing.assetType] ?? listing.assetType}
        </span>

        {listing.rarity && listing.rarity !== 'common' && (
          <span className={`chip absolute right-2 top-2 ${RARITY_STYLE[listing.rarity]}`}>
            {listing.rarity}
          </span>
        )}

        {listing.crossListed && (
          <span className="chip chip-orange absolute bottom-2 left-2 !bg-black/85">
            on {(listing.alsoOn?.length ?? 0) + 1} venues
            {spreadPct > 1 ? ` · +${spreadPct.toFixed(0)}% elsewhere` : ''}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-100" title={listing.title}>
            {listing.title}
          </div>
          {listing.subtitle && (
            <div className="truncate text-[11px] text-neutral-500">{listing.subtitle}</div>
          )}
        </div>

        {listing.sattributes && listing.sattributes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {listing.sattributes.slice(0, 3).map((a) => (
              <span key={a} className="chip chip-orange">
                {a.replace(/_/g, ' ')}
              </span>
            ))}
            {listing.sattributes.length > 3 && (
              <span className="chip">+{listing.sattributes.length - 3}</span>
            )}
          </div>
        )}

        <div className="mt-auto space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="font-mono text-base font-semibold text-orange-400">
              {btc(listing.priceSats)}
              <span className="ml-1 text-[10px] text-neutral-600">BTC</span>
            </div>
            {fiat && <div className="font-mono text-[11px] text-neutral-500">{fiat}</div>}
          </div>

          {listing.unitPriceSats && listing.amount && listing.amount !== 1 && (
            <div className="font-mono text-[10px] text-neutral-600">
              {listing.unitPriceSats.toFixed(4)} sats/unit · {commas(Math.round(listing.amount))}{' '}
              units
            </div>
          )}

          {listing.utxoSizeSats && listing.assetType === 'rare-sat' && (
            <div className="font-mono text-[10px] text-neutral-600">
              {commas(listing.utxoSizeSats)} sats in UTXO ·{' '}
              {(listing.priceSats / listing.utxoSizeSats).toFixed(2)}× face value
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-ink-800 pt-2">
            <a
              href={listing.marketUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[11px] text-neutral-500 transition hover:text-orange-400"
              title={listing.sourceName}
            >
              {listing.sourceName} ↗
            </a>

            {listing.buyable ? (
              <button className="btn-primary !px-2.5 !py-1 !text-xs" onClick={() => onBuy(listing)}>
                Buy
              </button>
            ) : (
              <a
                href={listing.marketUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost !px-2.5 !py-1 !text-xs"
              >
                View
              </a>
            )}
          </div>

          {listing.inscriptionId && (
            <div
              className="font-mono text-[9px] text-ink-500"
              title={listing.inscriptionId}
            >
              {shortId(listing.inscriptionId, 10, 6)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
