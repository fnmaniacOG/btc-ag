import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

const ASSET_VIEWS = ['ordinals', 'runes', 'rare-sats', 'brc20', 'tokens', 'pools'];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: config.site.url,
      lastModified: now,
      changeFrequency: 'hourly',
      priority: 1,
    },
    ...ASSET_VIEWS.map((view) => ({
      url: `${config.site.url}/?asset=${view}`,
      lastModified: now,
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
  ];
}
