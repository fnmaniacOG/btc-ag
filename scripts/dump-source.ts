/**
 * Raw response dumper.  `npm run dump unisat`
 *
 * Prints the actual JSON a venue returns, before any of btc.ag's parsing runs.
 *
 * This exists because adapter field mappings are guesses until someone sees a
 * real payload. When a venue connects but returns nothing, or a field comes
 * back empty, this shows exactly what keys the upstream is really sending so
 * the mapping can be corrected instead of guessed at again.
 */

// MUST be first: config.ts reads process.env at module load.
import { envSummary } from './load-env';

import { config } from '../src/lib/config';
import { request } from '../src/lib/http';

const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

/** Show the shape of an object without dumping thousands of lines. */
function describe(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (!value.length) return '[] (empty)';
    return `Array(${value.length}) of:\n${describe(value[0], depth)}`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .map(([k, v]) => {
        const t = Array.isArray(v)
          ? `Array(${v.length})`
          : v === null
            ? 'null'
            : typeof v === 'object'
              ? 'object'
              : `${typeof v} = ${JSON.stringify(v)?.slice(0, 60)}`;
        return `${pad}${orange(k)}: ${t}`;
      })
      .join('\n');
  }
  return String(value);
}

async function dumpUnisat(nftType: string) {
  const cfg = config.sources.unisat;
  if (!cfg.apiKey) {
    console.log(red('  UNISAT_API_KEY not set. Run: vercel env pull .env.local --environment=production'));
    return;
  }

  const body = {
    filter: { nftType },
    sort: { unitPrice: 1 },
    start: 0,
    limit: 3,
  };

  console.log(bold(`\n  POST /v3/market/collection/auction/list  nftType=${orange(nftType)}`));
  console.log(grey(`  body: ${JSON.stringify(body)}`));

  try {
    const res = await request<Record<string, unknown>>(
      `${cfg.base}/v3/market/collection/auction/list`,
      {
        method: 'POST',
        json: body,
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        retries: 0,
      },
    );

    const data = (res as { data?: unknown }).data ?? res;
    const list =
      (data as { list?: unknown[] })?.list ??
      (Array.isArray(data) ? data : undefined);

    console.log(grey(`  total: ${JSON.stringify((data as { total?: unknown })?.total ?? '?')}`));

    if (!list || !list.length) {
      console.log(red('  → no items returned'));
      console.log(grey(`  envelope keys: ${Object.keys((data as object) ?? {}).join(', ')}`));
      return;
    }

    console.log(bold(`\n  First item's real field names:`));
    console.log(describe(list[0]));
  } catch (e) {
    console.log(red(`  → ${e instanceof Error ? e.message : e}`));
  }
}

/**
 * UniSat's `nftType: runes` returns total 0, so the runes book lives on a
 * different route. Try the plausible candidates and report which one answers.
 */
async function findUnisatRunes() {
  const cfg = config.sources.unisat;
  if (!cfg.apiKey) {
    console.log(red('  UNISAT_API_KEY not set.'));
    return;
  }

  const auth = { Authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' };

  const candidates: Array<{ path: string; method: 'GET' | 'POST'; body?: unknown }> = [
    { path: '/v3/market/runes/auction/list', method: 'POST', body: { filter: {}, sort: { unitPrice: 1 }, start: 0, limit: 3 } },
    { path: '/v3/market/runes/auction/runes_list', method: 'POST', body: { start: 0, limit: 3 } },
    { path: '/v3/market/runes/auction/actions', method: 'POST', body: { filter: {}, start: 0, limit: 3 } },
    { path: '/v1/indexer/runes/info-list?start=0&limit=3', method: 'GET' },
    { path: '/v3/runes/auction/list', method: 'POST', body: { filter: {}, start: 0, limit: 3 } },
  ];

  console.log(bold('\n  Hunting for the UniSat runes endpoint\n'));

  for (const c of candidates) {
    try {
      const res = await request<Record<string, unknown>>(`${cfg.base}${c.path}`, {
        method: c.method,
        ...(c.body ? { json: c.body } : {}),
        headers: auth,
        retries: 0,
        timeoutMs: 15_000,
      });

      const data = (res as { data?: unknown }).data ?? res;
      const list = (data as { list?: unknown[] })?.list ?? (Array.isArray(data) ? data : []);
      const total = (data as { total?: unknown })?.total;

      console.log(`  ${orange('OK  ')} ${c.method} ${c.path}`);
      console.log(grey(`       total=${JSON.stringify(total)} items=${list?.length ?? 0}`));
      if (list?.length) {
        console.log(bold('\n       fields:'));
        console.log(describe(list[0], 2));
        return;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  ${red('FAIL')} ${c.method} ${c.path} ${grey(msg.slice(0, 60))}`);
    }
  }

  console.log(grey('\n  None returned listings. UniSat runes may need a tick filter.'));
}

async function dumpGeneric(url: string) {
  console.log(bold(`\n  GET ${url}`));
  try {
    const res = await request<unknown>(url, { retries: 0 });
    console.log(describe(res));
  } catch (e) {
    console.log(red(`  → ${e instanceof Error ? e.message : e}`));
  }
}

async function main() {
  const target = process.argv[2] ?? 'unisat';
  console.log(bold(orange(`\n  btc.ag raw dump — ${target}`)));
  console.log(grey(`  env: ${envSummary()}`));

  switch (target) {
    case 'unisat':
      // Every asset class UniSat's enum accepts, so we can see which ones
      // actually have listings and what each shape looks like.
      for (const t of ['collection', 'brc20']) await dumpUnisat(t);
      await findUnisatRunes();
      break;
    case 'unisat-runes':
      await findUnisatRunes();
      break;
    case 'odin':
      await dumpGeneric(`${config.sources.odin.base}/tokens?page=1&limit=2`);
      break;
    case 'ordinalswallet':
      await dumpGeneric(`${config.sources.ordinalswallet.base}/collection/runestone/escrows`);
      break;
    default:
      console.log(red(`  unknown target "${target}". Try: unisat | odin | ordinalswallet`));
  }

  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
