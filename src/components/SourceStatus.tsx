'use client';

import type { SourceHealth } from '@/lib/types';

/**
 * The honesty panel.
 *
 * An aggregator that silently drops a venue is worse than useless, so every
 * source reports one of three states: live (with latency and count), failed
 * (with the reason), or not configured (with what to set).
 */
export function SourceStatus({ sources }: { sources: SourceHealth[] }) {
  if (!sources.length) return null;

  const live = sources.filter((s) => s.ok);
  const totalListings = live.reduce((sum, s) => sum + (s.count ?? 0), 0);

  return (
    <div className="card p-3">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
          Venues
        </h3>
        <span className="font-mono text-[10px] text-neutral-600">
          {live.length}/{sources.length} live · {totalListings.toLocaleString('en-US')} raw
        </span>
      </div>

      <ul className="space-y-1">
        {sources.map((s) => (
          <li key={s.source} className="group flex items-center gap-2 text-[11px]">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                s.ok ? 'bg-emerald-500' : s.configured ? 'bg-red-500' : 'bg-ink-500'
              }`}
            />

            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className={`shrink-0 transition hover:text-orange-400 ${
                s.ok ? 'text-neutral-300' : 'text-neutral-600'
              }`}
            >
              {s.name}
            </a>

            {s.ok ? (
              <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-600">
                {s.count ?? 0} · {s.latencyMs}ms
              </span>
            ) : (
              <span
                className="ml-auto truncate text-right font-mono text-[10px] text-neutral-700"
                title={s.note}
              >
                {s.configured ? s.note ?? 'failed' : 'no key'}
              </span>
            )}
          </li>
        ))}
      </ul>

      {sources.some((s) => !s.configured) && (
        <p className="mt-2.5 border-t border-ink-800 pt-2 text-[10px] leading-relaxed text-neutral-600">
          Greyed venues need an API key. See{' '}
          <code className="text-orange-500/80">.env.example</code> — each one lists exactly
          what to set and where to get it.
        </p>
      )}
    </div>
  );
}
