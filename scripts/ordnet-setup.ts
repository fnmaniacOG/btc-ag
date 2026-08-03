/**
 * ORD.NET signing wallet setup.  `npx tsx scripts/ordnet-setup.ts`
 *
 * ORD.NET issues no API keys. It requires a wallet that BIP-322 signs an auth
 * challenge, and whose payment address holds at least 0.01 BTC confirmed.
 * Tokens last one hour, so a public site has to be able to re-sign unattended —
 * which means the key lives in the deployment environment.
 *
 * This script does three things:
 *   --generate   mint a fresh throwaway wallet and print the WIF + addresses
 *   (default)    show the addresses for an existing ORDNET_SIGNING_WIF
 *   --test       run the real auth flow and report whether a token was issued
 *
 * SECURITY: the generated key is a hot key. Fund its payment address with a
 * little over 0.01 BTC and nothing more. Never use a wallet that holds
 * inscriptions, runes, or savings.
 */

import { deriveWallet, getOrdnetSession } from '../src/lib/ordnet-auth';
import { getAddressStats } from '../src/lib/chain';
import { config } from '../src/lib/config';

const orange = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const grey = (s: string) => `\x1b[90m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const REQUIRED_SATS = 1_000_000; // 0.01 BTC

async function showFunding(paymentAddress: string) {
  try {
    const stats = await getAddressStats(paymentAddress);
    const confirmed = stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
    const btc = (confirmed / 1e8).toFixed(8);

    if (confirmed >= REQUIRED_SATS) {
      console.log(`  funding      ${green(`${btc} BTC confirmed — meets the 0.01 BTC requirement`)}`);
    } else {
      console.log(`  funding      ${red(`${btc} BTC confirmed — needs ≥ 0.01 BTC`)}`);
      console.log(grey(`               send ${((REQUIRED_SATS - confirmed) / 1e8).toFixed(8)} BTC to the payment address above`));
    }
  } catch {
    console.log(grey('  funding      could not check (mempool.space unreachable)'));
  }
}

async function main() {
  const args = process.argv.slice(2);
  console.log(bold(orange('\n  ORD.NET signing wallet\n')));

  if (args.includes('--generate')) {
    const [bitcoin, ecpairMod, eccMod] = await Promise.all([
      import('bitcoinjs-lib'),
      import('ecpair'),
      import('@bitcoinerlab/secp256k1'),
    ]);
    const ecc = (eccMod as { default?: unknown }).default ?? eccMod;
    const factory = (ecpairMod as { default?: unknown }).default ?? ecpairMod;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ECPair = (factory as any)(ecc);

    const wif = ECPair.makeRandom({ network: bitcoin.networks.bitcoin }).toWIF();
    const w = await deriveWallet(wif);

    console.log(bold('  A new wallet has been generated.\n'));
    console.log(`  ${red('ORDNET_SIGNING_WIF')}  ${wif}`);
    console.log(`  ordinals     ${w.ordinalsAddress}`);
    console.log(`  payment      ${orange(w.paymentAddress)}   ${grey('← fund this one')}\n`);
    console.log(grey('  1. Save the WIF into your deployment environment (Vercel → Settings → Environment Variables).'));
    console.log(grey('  2. Send a little over 0.01 BTC to the payment address.'));
    console.log(grey('  3. Wait for one confirmation, then run: npx tsx scripts/ordnet-setup.ts --test\n'));
    console.log(red('  This is a hot key. Fund it with the minimum and nothing else.\n'));
    return;
  }

  const wif = config.sources.ordnet.signingWif;
  if (!wif) {
    console.log(red('  ORDNET_SIGNING_WIF is not set.\n'));
    console.log(grey('  Generate a wallet:  npx tsx scripts/ordnet-setup.ts --generate\n'));
    process.exit(1);
  }

  let w;
  try {
    w = await deriveWallet(wif);
  } catch (e) {
    console.log(red(`  Invalid WIF: ${e instanceof Error ? e.message : e}\n`));
    process.exit(1);
  }

  console.log(`  ordinals     ${w.ordinalsAddress}`);
  console.log(`  payment      ${orange(w.paymentAddress)}`);
  await showFunding(w.paymentAddress);

  if (!args.includes('--test')) {
    console.log(grey('\n  Run with --test to attempt the real auth flow.\n'));
    return;
  }

  console.log(grey('\n  Running the ORD.NET auth flow…'));
  try {
    const session = await getOrdnetSession();
    if (!session) {
      console.log(red('  No session returned.\n'));
      process.exit(1);
    }
    const mins = Math.round((session.expiresAt - Date.now()) / 60_000);
    console.log(green(`  Token issued — valid for ${mins} minutes.`));
    console.log(grey(`  walletBindingId: ${session.walletBindingId ?? '(none returned)'}`));
    console.log(grey('  btc.ag will refresh this automatically every 5 minutes via cron.\n'));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(red(`  Auth failed: ${msg}\n`));
    if (msg.includes('403') || msg.toLowerCase().includes('0.01')) {
      console.log(grey('  403 means the payment address does not hold 0.01 BTC confirmed yet.\n'));
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
