/**
 * Ordinals theory, implemented from the spec.
 *
 * This is what lets btc.ag classify a rare-sat listing itself instead of
 * trusting whatever tag the origin marketplace happened to attach. Venues
 * disagree about sattributes constantly; the chain does not.
 *
 * Reference: https://docs.ordinals.com/overview.html
 */

import type { SatRarity, Sattribute } from './types';

export const SUBSIDY_HALVING_INTERVAL = 210_000;
export const DIFFCHANGE_INTERVAL = 2_016;
export const CYCLE_EPOCHS = 6;
/** Total sats that will ever exist. Comfortably below Number.MAX_SAFE_INTEGER. */
export const SUPPLY = 2_099_999_997_690_000;

/** Block subsidy in sats at a given height. */
export function subsidy(height: number): number {
  const epoch = Math.floor(height / SUBSIDY_HALVING_INTERVAL);
  if (epoch >= 33) return 0;
  return Math.floor(50 * 1e8 / 2 ** epoch);
}

/** First sat number of a given epoch. */
export function epochStartSat(epoch: number): number {
  let total = 0;
  for (let e = 0; e < epoch && e < 33; e++) {
    total += SUBSIDY_HALVING_INTERVAL * Math.floor(50 * 1e8 / 2 ** e);
  }
  return total;
}

/** First sat number mined in a given block. */
export function blockStartSat(height: number): number {
  const epoch = Math.floor(height / SUBSIDY_HALVING_INTERVAL);
  const startOfEpoch = epochStartSat(epoch);
  const blocksIntoEpoch = height - epoch * SUBSIDY_HALVING_INTERVAL;
  return startOfEpoch + blocksIntoEpoch * subsidy(height);
}

/** The block that mined a given sat. Binary search over the epoch table. */
export function satHeight(sat: number): number {
  if (sat < 0 || sat >= SUPPLY) return -1;

  let epoch = 0;
  while (epoch < 33 && epochStartSat(epoch + 1) <= sat) epoch++;

  const into = sat - epochStartSat(epoch);
  const sub = subsidy(epoch * SUBSIDY_HALVING_INTERVAL);
  if (sub === 0) return epoch * SUBSIDY_HALVING_INTERVAL;
  return epoch * SUBSIDY_HALVING_INTERVAL + Math.floor(into / sub);
}

export interface Degree {
  /** Cycle — one per six halvings. */
  hour: number;
  /** Blocks into the halving epoch. */
  minute: number;
  /** Blocks into the difficulty adjustment period. */
  second: number;
  /** Sat offset within its block. */
  third: number;
}

export function degree(sat: number): Degree {
  const height = satHeight(sat);
  return {
    hour: Math.floor(height / (CYCLE_EPOCHS * SUBSIDY_HALVING_INTERVAL)),
    minute: height % SUBSIDY_HALVING_INTERVAL,
    second: height % DIFFCHANGE_INTERVAL,
    third: sat - blockStartSat(height),
  };
}

export function formatDegree(sat: number): string {
  const d = degree(sat);
  return `${d.hour}°${d.minute}′${d.second}″${d.third}‴`;
}

/**
 * Core rarity, exactly as `ord` defines it.
 *
 * mythic    — the very first sat ever mined
 * legendary — first sat of a cycle
 * epic      — first sat of a halving epoch
 * rare      — first sat of a difficulty adjustment period
 * uncommon  — first sat of any block
 * common    — the other 2.1 quadrillion
 */
export function rarity(sat: number): SatRarity {
  const { hour, minute, second, third } = degree(sat);
  if (hour === 0 && minute === 0 && second === 0 && third === 0) return 'mythic';
  if (minute === 0 && second === 0 && third === 0) return 'legendary';
  if (minute === 0 && third === 0) return 'epic';
  if (second === 0 && third === 0) return 'rare';
  if (third === 0) return 'uncommon';
  return 'common';
}

export const RARITY_ORDER: Record<SatRarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

/** Rodarmor name: base-26 encoding of the sats remaining after this one. */
export function satName(sat: number): string {
  let x = SUPPLY - sat;
  let name = '';
  while (x > 0) {
    name = String.fromCharCode(((x - 1) % 26) + 97) + name;
    x = Math.floor((x - 1) / 26);
  }
  return name;
}

const isPalindrome = (s: string) => {
  for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false;
  return true;
};

/**
 * "Perfect palinception": the sat number is a palindrome, and remains a
 * palindrome after repeatedly stripping the outermost digit pair.
 */
function perfectPalinception(s: string): boolean {
  let cur = s;
  while (cur.length > 1) {
    if (!isPalindrome(cur)) return false;
    cur = cur.slice(1, -1);
    if (cur.length === 0) return true;
  }
  return true;
}

/** All digits identical, e.g. 7777777. */
const isUniform = (s: string) => s.length > 1 && new Set(s).size === 1;

/** Blocks whose coinbase is attributed to Satoshi-era mining, by convention. */
const PIZZA_BLOCK = 57_043;
const FIRST_TX_BLOCK = 170;

/**
 * Collector attributes beyond core rarity. This mirrors what Magisat, Satflow
 * and wecsats tag, computed locally so cross-venue listings are comparable.
 */
export function sattributes(sat: number): Sattribute[] {
  const out: Sattribute[] = [];
  const height = satHeight(sat);
  const s = String(sat);

  if (isPalindrome(s)) {
    out.push('palindrome');
    if (isUniform(s)) out.push('uniform_palinception');
    else if (perfectPalinception(s)) out.push('perfect_palinception');
  }

  if (height === 9) {
    out.push('block9');
    // The 450x sats: the first 450 million sats of block 9, the only ones
    // from Satoshi's block 9 coinbase that ever moved to Hal Finney.
    if (sat - blockStartSat(9) < 450_000_000) out.push('block9_450x');
  }
  if (height === 78) out.push('block78');
  if (height === 286) out.push('block286');
  if (height === 666) out.push('block666');
  if (height === PIZZA_BLOCK) out.push('pizza');
  if (height === FIRST_TX_BLOCK) out.push('first_tx');
  if (height > 0 && height < 1_000) out.push('vintage');
  if (height < 210_000) out.push('nakamoto');

  const name = satName(sat);
  if (name.length <= 5) out.push('rodarmor_name');
  if (name.length <= 4) out.push('name_rare');

  if (sat === 0) out.push('alpha');
  if (sat === SUPPLY - 1) out.push('omega');

  return out;
}

/** Rarity of the rarest sat in a set of ranges, plus the union of sattributes. */
export function classifyRanges(ranges: Array<{ start: number; size: number }>): {
  rarity: SatRarity;
  sattributes: Sattribute[];
  totalSats: number;
} {
  let best: SatRarity = 'common';
  const attrs = new Set<Sattribute>();
  let totalSats = 0;

  for (const r of ranges) {
    totalSats += r.size;
    // A range's rarest sat is always its first — rarity classes are defined by
    // block/period/epoch boundaries, which a range can only start on.
    const rr = rarity(r.start);
    if (RARITY_ORDER[rr] > RARITY_ORDER[best]) best = rr;
    for (const a of sattributes(r.start)) attrs.add(a);
    // Cheap sweep for palindromes inside small ranges.
    if (r.size > 1 && r.size <= 64) {
      for (let i = 1; i < r.size; i++) {
        for (const a of sattributes(r.start + i)) attrs.add(a);
      }
    }
  }

  return { rarity: best, sattributes: [...attrs], totalSats };
}

/** Normalise arbitrary vendor rarity strings onto the ord scale. */
export function normalizeRarity(v: unknown): SatRarity | undefined {
  if (typeof v !== 'string') return undefined;
  const k = v.trim().toLowerCase();
  if (k in RARITY_ORDER) return k as SatRarity;
  return undefined;
}
