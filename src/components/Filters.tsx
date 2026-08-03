'use client';

import type { AssetType, SatRarity, SourceHealth } from '@/lib/types';

export interface FilterState {
  asset: AssetType | 'all';
  q: string;
  sort: 'price_asc' | 'price_desc' | 'recent' | 'unit_price_asc' | 'rarity_desc';
  minBtc: string;
  maxBtc: string;
  rarity: SatRarity[];
  sources: string[];
  depth: number;
}

export const DEFAULT_FILTERS: FilterState = {
  asset: 'all',
  q: '',
  sort: 'price_asc',
  minBtc: '',
  maxBtc: '',
  rarity: [],
  sources: [],
  depth: 60,
};

const ASSET_TABS: Array<{ id: AssetType | 'all'; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'ordinal', label: 'Ordinals' },
  { id: 'rune', label: 'Runes' },
  { id: 'rare-sat', label: 'Rare Sats' },
  { id: 'brc20', label: 'BRC-20' },
  { id: 'token', label: 'Tokens' },
  { id: 'pool', label: 'Pools' },
];

const RARITIES: SatRarity[] = ['uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export function AssetTabs({
  value,
  onChange,
}: {
  value: AssetType | 'all';
  onChange: (v: AssetType | 'all') => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ASSET_TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
            value === t.id
              ? 'border-orange-500 bg-orange-500 text-black'
              : 'border-ink-700 bg-ink-900 text-neutral-400 hover:border-orange-700 hover:text-orange-300'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Filters({
  state,
  onChange,
  sources,
}: {
  state: FilterState;
  onChange: (next: FilterState) => void;
  sources: SourceHealth[];
}) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    onChange({ ...state, [k]: v });

  const toggle = <T extends string>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <div className="card space-y-4 p-3">
      <div>
        <label className="label">Sort</label>
        <select
          className="input"
          value={state.sort}
          onChange={(e) => set('sort', e.target.value as FilterState['sort'])}
        >
          <option value="price_asc">Price — low to high</option>
          <option value="price_desc">Price — high to low</option>
          <option value="unit_price_asc">Unit price — low to high</option>
          <option value="rarity_desc">Rarity — rarest first</option>
          <option value="recent">Recently listed</option>
        </select>
      </div>

      <div>
        <label className="label">Price range (BTC)</label>
        <div className="flex items-center gap-2">
          <input
            className="input font-mono"
            inputMode="decimal"
            placeholder="min"
            value={state.minBtc}
            onChange={(e) => set('minBtc', e.target.value)}
          />
          <span className="text-neutral-700">—</span>
          <input
            className="input font-mono"
            inputMode="decimal"
            placeholder="max"
            value={state.maxBtc}
            onChange={(e) => set('maxBtc', e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Sat rarity</label>
        <div className="flex flex-wrap gap-1.5">
          {RARITIES.map((r) => (
            <button
              key={r}
              onClick={() => set('rarity', toggle(state.rarity, r))}
              className={`chip transition ${
                state.rarity.includes(r) ? 'chip-orange' : 'hover:border-orange-700'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Venues</label>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => {
            const on = state.sources.includes(s.source);
            return (
              <button
                key={s.source}
                disabled={!s.configured}
                onClick={() => set('sources', toggle(state.sources, s.source))}
                className={`chip transition disabled:opacity-35 ${
                  on ? 'chip-orange' : 'hover:border-orange-700'
                }`}
                title={s.configured ? s.name : s.note}
              >
                {s.name}
              </button>
            );
          })}
        </div>
        {state.sources.length > 0 && (
          <button
            className="mt-2 text-[10px] text-neutral-600 hover:text-orange-400"
            onClick={() => set('sources', [])}
          >
            clear venue filter
          </button>
        )}
      </div>

      <div>
        <label className="label">Depth per venue — {state.depth}</label>
        <input
          type="range"
          min={20}
          max={200}
          step={20}
          value={state.depth}
          onChange={(e) => set('depth', Number(e.target.value))}
          className="w-full accent-orange-500"
        />
        <p className="mt-1 text-[10px] leading-relaxed text-neutral-600">
          Higher depth pulls more listings from each venue. Slower, and more likely
          to hit upstream rate limits.
        </p>
      </div>
    </div>
  );
}
