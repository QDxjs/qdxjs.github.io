import { getAllEntries, entryURL } from '../content-utils';
import { site } from '../config';

export async function GET(context) {
  const base = context.site || `https://${site.domain}/`;
  const entries = await getAllEntries();
  // A build timestamp is not evidence that a page changed. Omit unknown dates.
  const lastmod = items => items.map(item => item.data.updated || item.data.date).filter(Boolean).sort().at(-1);
  const latest = lastmod(entries);
  const pages = [
    ...['/', '/search/', '/tags/'].map(url => ({ url, lastmod: latest })),
    ...['notes', 'essays', 'works'].map(section => ({ url: `/${section}/`, lastmod: lastmod(entries.filter(item => item.collection === section)) })),
    { url: '/about/' },
    ...entries.map(item => ({ url: entryURL(item), lastmod: item.data.updated || item.data.date })),
  ];
  const escapeXML = value => value.replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(page => `  <url><loc>${escapeXML(new URL(page.url, base).href)}</loc>${page.lastmod ? `<lastmod>${page.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
