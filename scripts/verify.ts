/**
 * Verification suite.  `npx tsx scripts/verify.ts`
 *
 * Two things are checked here, because both fail silently:
 *
 *  1. Ordinals theory. A wrong rarity is not an error, it is a *plausible wrong
 *     answer* — the app keeps working and quietly mislabels every rare sat.
 *     Expectations below come from the ord spec, not from this implementation.
 *
 *  2. Aggregation. Dedupe collapsing too much (hiding listings) or too little
 *     (duplicate rows) is equally invisible without assertions.
 */

import {
  SUPPLY,
  blockStartSat,
  classifyRanges,
  degree,
  formatDegree,
  rarity,
  satHeight,
  satName,
  sattributes,
  subsidy,
} from '../src/lib/sats';
import { dedupe, sortListings, applyFilters, spread } from '../src/lib/aggregate';
import type { UnifiedListing } from '../src/lib/types';

let pass = 0;
let fail = 0;

function eq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`);
  }
}

function ok(label: string, cond: boolean) {
  eq(label, cond, true);
}

console.log('\n\x1b[1m\x1b[38;5;208m  btc.ag verification\x1b[0m\n');

// ── Ordinals theory ──────────────────────────────────────────────────────────
console.log('\x1b[1m  Ordinals theory\x1b[0m');

// Block subsidy halves every 210,000 blocks.
eq('subsidy(0) = 50 BTC', subsidy(0), 50e8);
eq('subsidy(209999) = 50 BTC', subsidy(209_999), 50e8);
eq('subsidy(210000) = 25 BTC', subsidy(210_000), 25e8);
eq('subsidy(420000) = 12.5 BTC', subsidy(420_000), 12.5e8);
eq('subsidy(630000) = 6.25 BTC', subsidy(630_000), 6.25e8);
eq('subsidy(840000) = 3.125 BTC', subsidy(840_000), 3.125e8);

// First sat of each block.
eq('block 0 starts at sat 0', blockStartSat(0), 0);
eq('block 1 starts at sat 5e9', blockStartSat(1), 5_000_000_000);
eq('block 210000 starts at 1.05e15', blockStartSat(210_000), 1_050_000_000_000_000);

// satHeight is the inverse of blockStartSat.
for (const h of [0, 1, 9, 170, 286, 666, 209_999, 210_000, 420_000, 840_000]) {
  ok(`satHeight(blockStartSat(${h})) = ${h}`, satHeight(blockStartSat(h)) === h);
}

// Rarity classes, per the spec.
eq('sat 0 is mythic', rarity(0), 'mythic');
eq('first sat of block 1 is uncommon', rarity(blockStartSat(1)), 'uncommon');
eq('second sat of block 1 is common', rarity(blockStartSat(1) + 1), 'common');
eq('first sat of diffchange (block 2016) is rare', rarity(blockStartSat(2_016)), 'rare');
eq('first sat of halving (block 210000) is epic', rarity(blockStartSat(210_000)), 'epic');
eq('first sat of cycle (block 1260000) is legendary', rarity(blockStartSat(1_260_000)), 'legendary');

// Degree notation: sat 0 is the origin.
eq('degree(0)', degree(0), { hour: 0, minute: 0, second: 0, third: 0 });
eq('formatDegree(0)', formatDegree(0), '0°0′0″0‴');

// Rodarmor names. sat 0 has the longest name; the final sat is named "a".
eq('satName(0) = nvtdijuwxlp', satName(0), 'nvtdijuwxlp');
eq('satName(SUPPLY - 1) = a', satName(SUPPLY - 1), 'a');
eq('satName(2099999997689999) = a', satName(2_099_999_997_689_999), 'a');

// Sattributes.
ok('block 9 sat is tagged block9', sattributes(blockStartSat(9) + 5).includes('block9'));
ok('block 9 first sats are 450x', sattributes(blockStartSat(9)).includes('block9_450x'));
ok('block 9 late sats are not 450x', !sattributes(blockStartSat(9) + 500_000_000).includes('block9_450x'));
ok('block 500 sat is vintage', sattributes(blockStartSat(500) + 3).includes('vintage'));
ok('block 500000 sat is not vintage', !sattributes(blockStartSat(500_000) + 3).includes('vintage'));
ok('palindrome detected', sattributes(1_234_321).includes('palindrome'));
ok('non-palindrome not flagged', !sattributes(1_234_567).includes('palindrome'));
ok('uniform palinception detected', sattributes(7_777_777).includes('uniform_palinception'));

// A range's rarity is that of its rarest (first) sat, and attributes union.
{
  const c = classifyRanges([
    { start: blockStartSat(210_000), size: 10 },
    { start: blockStartSat(500_001) + 7, size: 3 },
  ]);
  eq('classifyRanges picks the rarest class', c.rarity, 'epic');
  eq('classifyRanges totals sats', c.totalSats, 13);
}

// ── Aggregation ──────────────────────────────────────────────────────────────
console.log('\n\x1b[1m  Aggregation\x1b[0m');

const L = (over: Partial<UnifiedListing>): UnifiedListing => ({
  id: 'x',
  source: 'unisat',
  sourceName: 'UniSat',
  sourceListingId: 'x',
  assetType: 'ordinal',
  title: 'Test',
  priceSats: 1000,
  marketUrl: 'https://example.com',
  buyable: false,
  ...over,
});

{
  // Same inscription on three venues at three prices → one row, cheapest wins.
  const merged = dedupe([
    L({ id: 'a', source: 'unisat', inscriptionId: 'i1', priceSats: 900_000 }),
    L({ id: 'b', source: 'gamma', inscriptionId: 'i1', priceSats: 750_000 }),
    L({ id: 'c', source: 'satflow', inscriptionId: 'i1', priceSats: 1_200_000 }),
  ]);

  eq('three venues, one inscription → 1 row', merged.length, 1);
  eq('cheapest ask wins the row', merged[0].priceSats, 750_000);
  eq('winner is the right venue', merged[0].source, 'gamma');
  eq('others recorded in alsoOn', merged[0].alsoOn?.length, 2);
  ok('row is flagged cross-listed', merged[0].crossListed === true);
}

{
  // Distinct assets must never be collapsed.
  const merged = dedupe([
    L({ id: 'a', inscriptionId: 'i1' }),
    L({ id: 'b', inscriptionId: 'i2' }),
    L({ id: 'c', outpoint: 'tx:0' }),
    L({ id: 'd', outpoint: 'tx:1' }),
  ]);
  eq('four distinct assets stay four rows', merged.length, 4);
  ok('no false cross-listing', merged.every((m) => !m.crossListed));
}

{
  // Fungibles dedupe on unit price, not total.
  const merged = dedupe([
    L({ id: 'a', assetType: 'rune', runeName: 'DOG', priceSats: 100_000, amount: 1000, unitPriceSats: 100 }),
    L({ id: 'b', source: 'satflow', assetType: 'rune', runeName: 'DOG', priceSats: 10_000, amount: 50, unitPriceSats: 200 }),
  ]);
  eq('runes collapse by ticker', merged.length, 1);
  eq('cheaper UNIT price wins, not cheaper total', merged[0].unitPriceSats, 100);
}

{
  // Regression: fungible lots of different sizes must compare on UNIT price.
  // Comparing totals once produced a "199900% spread" on the live site.
  const merged = dedupe([
    L({ id: 'a', assetType: 'brc20', ticker: 'B@AI', priceSats: 100, amount: 100, unitPriceSats: 1 }),
    L({ id: 'b', source: 'satflow', assetType: 'brc20', ticker: 'B@AI', priceSats: 200_000, amount: 200_000, unitPriceSats: 1 }),
  ]);
  eq('same unit price collapses to one row', merged.length, 1);
  const sp = spread(merged[0]);
  eq('identical unit prices ⇒ 0% spread, not 199900%', sp ? Math.round(sp.spreadPct) : null, 0);
}

{
  // A genuine fungible spread is still detected.
  const merged = dedupe([
    L({ id: 'a', assetType: 'rune', runeName: 'DOG', priceSats: 1000, amount: 1000, unitPriceSats: 1 }),
    L({ id: 'b', source: 'gamma', assetType: 'rune', runeName: 'DOG', priceSats: 300, amount: 200, unitPriceSats: 1.5 }),
  ]);
  const sp = spread(merged[0]);
  eq('real unit-price gap is reported', sp ? Math.round(sp.spreadPct) : null, 50);
}

{
  // A BRC-20 and a rune sharing a ticker are different assets.
  const merged = dedupe([
    L({ id: 'a', assetType: 'brc20', ticker: 'PEPE', priceSats: 100, unitPriceSats: 1 }),
    L({ id: 'b', assetType: 'rune', ticker: 'PEPE', priceSats: 900, unitPriceSats: 9 }),
  ]);
  eq('ticker collision across asset types stays separate', merged.length, 2);
}

{
  // A fungible with no unit price cannot be ranked — it must not corrupt a group.
  const merged = dedupe([
    L({ id: 'a', assetType: 'brc20', ticker: 'X', priceSats: 100, unitPriceSats: 1 }),
    L({ id: 'b', source: 'gamma', assetType: 'brc20', ticker: 'X', priceSats: 5_000_000, unitPriceSats: undefined }),
  ]);
  eq('unpriceable fungible stays its own row', merged.length, 2);
  ok('and is not marked cross-listed', merged.every((m) => !m.crossListed));
}

{
  const listings = [
    L({ id: 'a', priceSats: 300, rarity: 'common' }),
    L({ id: 'b', priceSats: 100, rarity: 'epic' }),
    L({ id: 'c', priceSats: 200, rarity: 'uncommon' }),
  ];
  eq('sort price_asc', sortListings(listings, 'price_asc').map((l) => l.id), ['b', 'c', 'a']);
  eq('sort price_desc', sortListings(listings, 'price_desc').map((l) => l.id), ['a', 'c', 'b']);
  eq('sort rarity_desc', sortListings(listings, 'rarity_desc').map((l) => l.id), ['b', 'c', 'a']);
}

{
  const listings = [
    L({ id: 'a', priceSats: 100, assetType: 'ordinal', title: 'Bitcoin Puppets' }),
    L({ id: 'b', priceSats: 5000, assetType: 'rune', title: 'DOG' }),
    L({ id: 'c', priceSats: 200, assetType: 'rare-sat', title: 'Pizza sat', rarity: 'rare' }),
  ];
  eq('filter by asset type', applyFilters(listings, { assetType: 'rune' }).length, 1);
  eq('filter by price ceiling', applyFilters(listings, { maxPriceSats: 250 }).length, 2);
  eq('filter by rarity', applyFilters(listings, { rarity: ['rare'] }).length, 1);
  eq('free-text search matches title', applyFilters(listings, { q: 'puppets' }).length, 1);
  eq('free-text search is case-insensitive', applyFilters(listings, { q: 'PIZZA' }).length, 1);
}

// The remaining suites need dynamic imports, so they live in an async main.
async function asyncSuites() {
// ── Rate limiting ────────────────────────────────────────────────────────────
console.log('\n\x1b[1m  Rate limiting\x1b[0m');

{
  const { rateLimit } = await import('../src/lib/ratelimit');

  // No Redis configured in test, so this exercises the in-process fallback.
  const ip = `test-${Date.now()}`;
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await rateLimit(ip, 'unit', 3, 60_000));

  eq('first 3 requests allowed', results.slice(0, 3).map((r) => r.ok), [true, true, true]);
  eq('4th and 5th blocked', results.slice(3).map((r) => r.ok), [false, false]);
  eq('remaining counts down', results[0].remaining, 2);
  ok('a different IP is unaffected', (await rateLimit(`${ip}-other`, 'unit', 3, 60_000)).ok);
}

// ── ORD.NET auth (BIP-322) ───────────────────────────────────────────────────
// This is the piece that must keep working unattended: ORD.NET tokens expire
// hourly, so if signing breaks the venue silently disappears.
console.log('\n\x1b[1m  ORD.NET auth\x1b[0m');

{
  const { deriveWallet } = await import('../src/lib/ordnet-auth');
  const bip322 = await import('bip322-js');
  const Signer = (bip322 as any).Signer ?? (bip322 as any).default?.Signer;
  const Verifier = (bip322 as any).Verifier ?? (bip322 as any).default?.Verifier;

  // Fixed test key — deterministic, never funded, never used for anything.
  const WIF = 'L4rK1yDtCWekvXuE6oXD9jCYfFNV2cWRpVuPLBcCU2z8TrisoyY1';
  const w = await deriveWallet(WIF);

  ok('derives a taproot ordinals address', w.ordinalsAddress.startsWith('bc1p'));
  ok('derives a segwit payment address', w.paymentAddress.startsWith('bc1q'));
  eq('x-only pubkey is 32 bytes', w.ordinalsPublicKey.length, 64);
  ok('derivation is deterministic', (await deriveWallet(WIF)).paymentAddress === w.paymentAddress);

  const msg = 'Sign in to ord.net at 2026-08-02T12:00:00Z (nonce: btcag-verify)';

  for (const [label, addr] of [
    ['payment', w.paymentAddress],
    ['ordinals', w.ordinalsAddress],
  ] as const) {
    const b64 = Signer.sign(WIF, addr, msg);
    ok(`${label}: BIP-322 signature verifies`, Verifier.verifySignature(addr, msg, b64));

    // ORD.NET requires hex, and caps signatures at 8192 chars.
    const hex = Buffer.from(b64, 'base64').toString('hex');
    ok(`${label}: hex encoding is valid`, /^[0-9a-f]+$/.test(hex));
    ok(`${label}: round-trips back to base64`, Buffer.from(hex, 'hex').toString('base64') === b64);
    ok(`${label}: within ORD.NET's 8192-char limit`, hex.length <= 8192);
  }

  ok(
    'a wrong message fails verification',
    !Verifier.verifySignature(w.paymentAddress, `${msg} tampered`, Signer.sign(WIF, w.paymentAddress, msg)),
  );
}
}

// ── Result ───────────────────────────────────────────────────────────────────
asyncSuites()
  .then(() => {
    console.log(
      `\n  ${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} passed, ${fail} failed\x1b[0m\n`,
    );
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
