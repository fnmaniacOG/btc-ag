/**
 * Live source probe.  `npm run probe`
 *
 * Hits every configured venue directly and reports what came back. Run this
 * first when a source goes dark — it separates "my key is wrong" from "the
 * venue changed its route" from "the venue is down", which is otherwise the
 * slowest part of maintaining an aggregator.
 */

import { SOURCES } from '../src/lib/sources';
import { getChainStatus } from '../src/lib/chain';
import { errMessage } from '../src/lib/http';

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`;
const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;

async function main() {
  console.log(bold(orange('\n  btc.ag source probe\n')));

  try {
    const chain = await getChainStatus();
    console.log(
      `  ${green('●')} chain      block ${chain.height}  fees ${chain.fees.halfHour} sat/vB` +
        (chain.btcPrice ? `  BTC $${Math.round(chain.btcPrice).toLocaleString()}` : ''),
    );
  } catch (e) {
    console.log(`  ${red('●')} chain      ${errMessage(e)}`);
  }

  console.log('');

  for (const source of SOURCES) {
    const pad = source.name.padEnd(18);

    if (!source.isConfigured()) {
      console.log(`  ${grey('○')} ${pad} ${grey('not configured')} ${grey(source.configNote ?? '')}`);
      continue;
    }

    const t0 = Date.now();
    try {
      const listings = await source.fetchListings({ assetType: 'all', depth: 10, sort: 'price_asc' });
      const ms = Date.now() - t0;

      if (!listings.length) {
        console.log(`  ${orange('◐')} ${pad} ${orange('0 listings')} ${grey(`${ms}ms`)}`);
        continue;
      }

      const cheapest = listings.reduce((a, b) => (a.priceSats < b.priceSats ? a : b));
      const types = [...new Set(listings.map((l) => l.assetType))].join(',');

      console.log(
        `  ${green('●')} ${pad} ${green(`${listings.length} listings`)} ${grey(`${ms}ms`)}  ` +
          `${grey(types)}  floor ${orange((cheapest.priceSats / 1e8).toFixed(6))} BTC`,
      );
      console.log(`    ${grey(`↳ ${cheapest.title.slice(0, 60)} — ${cheapest.marketUrl}`)}`);
    } catch (e) {
      console.log(`  ${red('●')} ${pad} ${red(errMessage(e))} ${grey(`${Date.now() - t0}ms`)}`);
    }
  }

  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
