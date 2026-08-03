import type { MetadataRoute } from 'next';
import { config } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The API fans out to nine marketplaces on the operator's keys.
        // Crawlers have no reason to walk it, and every hit costs quota.
        disallow: ['/api/'],
      },
    ],
    sitemap: `${config.site.url}/sitemap.xml`,
    host: config.site.url,
  };
}
