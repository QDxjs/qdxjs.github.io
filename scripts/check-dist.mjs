// Validate generated output rather than treating a successful compiler as release readiness.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import config from '../astro.config.mjs';
import { site as siteConfig } from '../src/config.ts';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const site = new URL(config.site);
const read = name => fs.readFileSync(path.join(dist, name), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const routeOf = file => '/' + path.relative(dist, file).split(path.sep).join('/').replace(/index\.html$/, '');
const files = walk(dist).filter(file => file.endsWith('.html'));
assert.ok(files.length > 0, 'No generated HTML files');
const documents = new Map();
let inlineScripts = 0, jsonLd = 0, localReferences = 0;
function visit(node, fn) {
  fn(node);
  for (const child of node.childNodes || []) visit(child, fn);
  if (node.content) visit(node.content, fn);
}
for (const file of files) {
  const route = routeOf(file);
  const html = read(path.relative(dist, file));
  const tree = parse(html);
  const nodes = [];
  visit(tree, node => { if (node.tagName) nodes.push({ tag: node.tagName, attrs: Object.fromEntries((node.attrs || []).map(a => [a.name, a.value])), node }); });
  const ids = new Set(nodes.map(n => n.attrs.id).filter(Boolean));
  assert.ok(ids.has('main-content'), `${route}: missing main landmark`);
  const canonical = nodes.filter(n => n.tag === 'link' && n.attrs.rel === 'canonical');
  assert.equal(canonical.length, 1, `${route}: expected one canonical`);
  assert.equal(decodeURI(new URL(canonical[0].attrs.href).href), decodeURI(new URL(route === '/404.html' ? '/404/' : route, site).href), `${route}: canonical changed`);
  for (const { tag, attrs, node } of nodes) {
    if (tag !== 'script' || attrs.src) continue;
    const text = (node.childNodes || []).map(n => n.value || '').join('');
    if (attrs.type === 'application/ld+json') {
      assert.ok(JSON.parse(text)['@type'], `${route}: invalid JSON-LD`);
      jsonLd++;
    } else if (!attrs.type || ['text/javascript', 'application/javascript'].includes(attrs.type)) {
      new vm.Script(text, { filename: route });
      inlineScripts++;
    }
  }
  documents.set(decodeURI(route), { file, nodes, ids, html });
}
function targetFor(url) {
  let target = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
  assert.ok(target === dist || target.startsWith(dist + path.sep), `Path escapes output: ${url}`);
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `Missing local target: ${url}`);
  return target;
}
for (const [route, { nodes }] of documents) {
  for (const { attrs } of nodes) {
    // Astro's special 404.html has the virtual canonical /404/; validate canonicals above.
    if (attrs.rel === 'canonical') continue;
    for (const raw of [attrs.href, attrs.src].filter(Boolean)) {
      const url = new URL(raw, new URL(route, site));
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== site.origin) continue;
      const target = targetFor(url);
      localReferences++;
      if (url.hash && target.endsWith('.html')) {
        const doc = documents.get(decodeURI(routeOf(target)));
        assert.ok(doc.ids.has(decodeURIComponent(url.hash.slice(1))), `${route}: missing anchor ${raw}`);
      }
    }
  }
}
const socialImages = new Set();
let responsiveSources = 0;
for (const [route, { nodes, html }] of documents) {
  assert.ok(!/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net\/npm\/lunar-javascript/.test(html), `${route}: unexpected third-party rendering dependency`);
  const meta = (attribute, value) => nodes.filter(n => n.tag === 'meta' && n.attrs[attribute] === value);
  const image = meta('property', 'og:image');
  assert.equal(image.length, 1, `${route}: missing share image`);
  const imageURL = new URL(image[0].attrs.content);
  assert.equal(imageURL.origin, site.origin, `${route}: share image must be hosted locally`);
  const target = targetFor(imageURL);
  socialImages.add(target);
  assert.equal(meta('name', 'twitter:card')[0]?.attrs.content, 'summary_large_image', `${route}: wrong Twitter card`);
  assert.equal(meta('name', 'twitter:image')[0]?.attrs.content, imageURL.href, `${route}: Twitter image mismatch`);
  for (const rel of ['icon', 'apple-touch-icon', 'manifest']) assert.ok(nodes.some(n => n.tag === 'link' && n.attrs.rel === rel), `${route}: missing ${rel}`);
  for (const { tag, attrs, node } of nodes) {
    if (tag === 'source' && attrs.srcset) {
      assert.ok(attrs.sizes, `${route}: missing responsive image sizes`);
      for (const candidate of attrs.srcset.split(',')) {
        const [src, width] = candidate.trim().split(/\s+/);
        assert.match(width, /^\d+w$/, `${route}: invalid responsive descriptor`);
        targetFor(new URL(src, site));
        responsiveSources++;
      }
    }
    if (tag === 'img' && attrs.src?.startsWith('/images/')) {
      assert.ok(Number(attrs.width) > 0 && Number(attrs.height) > 0, `${route}: image must reserve its aspect ratio`);
      assert.equal(attrs.loading, 'lazy', `${route}: article image missing lazy loading`);
      assert.equal(attrs.decoding, 'async', `${route}: article image missing async decoding`);
    }
    if (tag === 'script' && attrs.type === 'application/ld+json') {
      const data = JSON.parse(node.childNodes.map(n => n.value || '').join(''));
      if (['BlogPosting', 'CreativeWork'].includes(data['@type'])) {
        assert.deepEqual(data.image, [imageURL.href], `${route}: JSON-LD share image mismatch`);
        assert.equal(meta('property', 'og:type')[0]?.attrs.content, 'article', `${route}: article Open Graph type missing`);
      }
    }
  }
}
for (const image of socialImages) {
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 1200, `Share image width: ${image}`);
  assert.equal(metadata.height, 630, `Share image height: ${image}`);
}
assert.ok(responsiveSources >= 8, 'Responsive picture sources missing');
const appManifest = JSON.parse(read('manifest.webmanifest'));
for (const icon of appManifest.icons) {
  const metadata = await sharp(targetFor(new URL(icon.src, site))).metadata();
  assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes, 'Manifest icon dimensions mismatch');
}
for (const name of ['noto-serif-sc', 'ma-shan-zheng', 'cormorant-garamond', 'lunar-javascript']) {
  assert.ok(read(`licenses/${name}.txt`).trim(), `Missing redistributed asset license: ${name}`);
}
const search = JSON.parse(read('search.json'));
assert.equal(socialImages.size, search.length + 1, 'Expected one default and one share image per content entry');
const contentFiles = walk(path.join(root, 'src/content')).filter(f => f.endsWith('.md') && !path.basename(f).startsWith('_'));
assert.equal(search.length, contentFiles.length, 'Search entries lost during content migration');
assert.equal(new Set(search.map(e => e.url)).size, search.length, 'Duplicate search URLs');
const published = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/published-routes.json'), 'utf8'));
for (const route of published) assert.ok(search.some(e => e.url === route), `Previously published URL lost: ${route}`);
for (const entry of search) {
  const html = documents.get(decodeURI(entry.url))?.html;
  assert.ok(html, `Search target missing: ${entry.url}`);
  assert.ok(entry.title && typeof entry.body === 'string' && entry.body.trim(), `Empty search content: ${entry.url}`);
  assert.ok(html.includes('class="prose"') && html.includes(entry.title), `Article content missing: ${entry.url}`);
}
const parser = new XMLParser({ isArray: (_name, jpath) => ['urlset.url', 'rss.channel.item'].includes(jpath) });
function xml(name) {
  const text = read(name);
  assert.equal(SyntaxValidator.validate(text, { multipleRoots: false }), true, `${name}: invalid XML`);
  return parser.parse(text);
}
const sitemap = xml('sitemap.xml').urlset.url;
const locations = sitemap.map(u => decodeURI(u.loc));
const expected = [...documents.keys()].filter(route => route !== '/404.html').map(route => decodeURI(new URL(route, site).href));
assert.deepEqual([...locations].sort(), expected.sort(), 'Sitemap does not match generated pages');
for (const loc of locations) targetFor(new URL(loc));
const contentDates = new Map(search.map(entry => {
  const doc = documents.get(decodeURI(entry.url));
  const data = doc.nodes.filter(n => n.tag === 'script' && n.attrs.type === 'application/ld+json')
    .map(n => JSON.parse(n.node.childNodes.map(child => child.value || '').join('')))
    .find(data => ['BlogPosting', 'CreativeWork'].includes(data['@type']));
  return [decodeURI(entry.url), data?.dateModified || data?.datePublished];
}));
const latestDate = entries => entries.map(entry => contentDates.get(decodeURI(entry.url))).filter(Boolean).sort().at(-1);
const expectedDates = new Map(contentDates);
for (const route of ['/', '/search/', '/tags/']) expectedDates.set(route, latestDate(search));
for (const section of ['notes', 'essays', 'works']) expectedDates.set(`/${section}/`, latestDate(search.filter(entry => entry.section === section)));
for (const item of sitemap) {
  const route = decodeURI(new URL(item.loc).pathname);
  assert.equal(item.lastmod, expectedDates.get(route), `${route}: sitemap must use known content dates, not build timestamps`);
}
const rssBytes = fs.readFileSync(path.join(dist, 'rss.xml'));
const rssText = new TextDecoder('utf-8', { fatal: true }).decode(rssBytes);
assert.deepEqual(Buffer.from(rssText, 'utf8'), rssBytes, 'RSS UTF-8 round trip changed bytes');
assert.ok(!rssText.includes('\uFFFD'), 'RSS contains a Unicode replacement character');
const channel = xml('rss.xml').rss.channel;
assert.equal(channel.title, siteConfig.name, 'RSS Chinese channel title changed');
const rss = channel.item;
const feedEntries = search.filter(e => ['notes', 'essays'].includes(e.section));
for (const entry of feedEntries) {
  const item = rss.find(item => decodeURI(item.link) === decodeURI(new URL(entry.url, site).href));
  assert.equal(item?.title, entry.demo ? `【演示内容】${entry.title}` : entry.title, `RSS title changed: ${entry.url}`);
}
const expectedFeed = feedEntries.map(e => decodeURI(new URL(e.url, site).href));
assert.deepEqual(rss.map(item => decodeURI(item.link)).sort(), expectedFeed.sort(), 'RSS membership changed');
assert.ok(read('robots.txt').includes(`Sitemap: ${new URL('sitemap.xml', site)}`), 'robots sitemap URL mismatch');
console.log(JSON.stringify({ htmlPages: files.length, contentEntries: search.length, inlineScripts, jsonLd, localReferences, sitemapUrls: locations.length, sitemapDatedUrls: sitemap.filter(item => item.lastmod).length, rssItems: rss.length, rssUtf8: true, socialImages: socialImages.size, responsiveCandidates: responsiveSources, publishedUrlsPreserved: published.length }, null, 2));
