import type { Metadata, Viewport } from 'next';
import './globals.css';
import { WalletProvider } from '@/wallet/useWallet';
import { config } from '@/lib/config';

const description =
  'Every Ordinal, Rune and Rare Sat listing from nine Bitcoin marketplaces in one order book. Cross-venue deduplication, rarity computed from ordinals theory, live on-chain fees. Buy from any venue with your own wallet — non-custodial.';

export const metadata: Metadata = {
  metadataBase: new URL(config.site.url),
  title: {
    default: 'btc.ag — Bitcoin marketplace aggregator | Ordinals, Runes & Rare Sats',
    template: '%s · btc.ag',
  },
  description,
  applicationName: 'btc.ag',
  keywords: [
    'bitcoin marketplace aggregator',
    'ordinals aggregator',
    'runes marketplace',
    'rare sats',
    'inscriptions',
    'bitcoin nft',
    'brc-20',
    'ordinals floor price',
    'unisat',
    'magisat',
    'satflow',
  ],
  alternates: { canonical: '/' },
  // The social card is a static asset rather than a generated one. `next/og`
  // would pull satori + resvg WASM into the bundle, adding meaningful build
  // time and cold-start weight — for a card whose content never changes and
  // which social scrapers cache anyway. Regenerate with scripts/make-og.py.
  openGraph: {
    type: 'website',
    url: config.site.url,
    siteName: 'btc.ag',
    title: 'btc.ag — Nine Bitcoin marketplaces. One order book.',
    description,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'btc.ag' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'btc.ag — Nine Bitcoin marketplaces. One order book.',
    description,
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
};

/** Structured data, so search engines can describe the site correctly. */
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'btc.ag',
  url: config.site.url,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Any',
  description,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
