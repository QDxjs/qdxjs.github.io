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
const search = JSON.parse(read('search.json'));
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
const rss = xml('rss.xml').rss.channel.item;
const expectedFeed = search.filter(e => ['notes', 'essays'].includes(e.section)).map(e => decodeURI(new URL(e.url, site).href));
assert.deepEqual(rss.map(item => decodeURI(item.link)).sort(), expectedFeed.sort(), 'RSS membership changed');
assert.ok(read('robots.txt').includes(`Sitemap: ${new URL('sitemap.xml', site)}`), 'robots sitemap URL mismatch');
console.log(JSON.stringify({ htmlPages: files.length, contentEntries: search.length, inlineScripts, jsonLd, localReferences, sitemapUrls: locations.length, rssItems: rss.length, publishedUrlsPreserved: published.length }, null, 2));
