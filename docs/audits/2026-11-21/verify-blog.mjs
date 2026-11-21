// Audit evidence only. Run from the project root after npm run build.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const outDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(outDir, '../../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const dist = path.join(root, 'dist');
const htmlFiles = walk(dist).filter(p => p.endsWith('.html'));
const syntaxErrors = [], brokenLocalLinks = [], invalidJsonLd = [];
let classicInlineScripts = 0, jsonLdBlocks = 0;
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(dist, file).replaceAll('\\', '/');
  const origin = new URL(rel === 'index.html' ? '/' : '/' + rel.replace(/index\.html$/, ''), 'https://qdxjs.github.io');
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type=["']application\/ld\+json/.test(match[1])) {
      jsonLdBlocks++;
      try { JSON.parse(match[2]); } catch (e) { invalidJsonLd.push({ file: rel, error: e.message }); }
    } else if (!/\bsrc\s*=|type=["']module/.test(match[1])) {
      classicInlineScripts++;
      try { new vm.Script(match[2]); } catch (e) { syntaxErrors.push({ file: rel, error: e.message }); }
    }
  }
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/gi)) {
    const raw = match[1].replaceAll('&amp;', '&');
    if (/^(?:https?:|\/\/|data:|mailto:|tel:|#)/i.test(raw)) continue;
    const url = new URL(raw, origin);
    let target = path.join(dist, decodeURIComponent(url.pathname));
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) brokenLocalLinks.push({ file: rel, url: raw });
  }
}
const search = JSON.parse(read('dist/search.json'));
const assets = walk(dist).filter(p => /\.(?:html|json|css|js)$/.test(p)).map(p => {
  const b = fs.readFileSync(p);
  return { file: path.relative(dist, p).replaceAll('\\', '/'), bytes: b.length, gzipBytes: zlib.gzipSync(b).length };
});
const source = read('public/downloads/hitokoto-universal.user.js');
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('Source structure changed: ' + start);
  return source.slice(a, b);
}
function makeBar(label) {
  return { innerHTML: label, querySelector: () => null, classList: { add() {}, remove() {} }, offsetWidth: 0 };
}
const fetchFn = between('    function fetchHitokoto()', '    function setupTimer()');
const races = ['onload', 'onerror', 'ontimeout'].map(callback => {
  const old = makeBar('old loading');
  const context = {
    CONFIG: { enabled: true, showFrom: false, animation: false, category: '', refreshInterval: 0 },
    isSiteAllowed: () => true,
    escapeHtml: s => s,
    bar: old,
    ensureBar() { return context.bar; },
    GM_xmlhttpRequest(options) { context.pending = options; },
  };
  vm.createContext(context);
  vm.runInContext('let isLoading = false;\n' + fetchFn + '\nfetchHitokoto();', context);
  context.bar = makeBar('new loading');
  vm.runInContext('fetchHitokoto();', context);
  context.pending[callback]({ responseText: JSON.stringify({ hitokoto: 'new quote' }) });
  return { callback, detachedBar: old.innerHTML, visibleBar: context.bar.innerHTML, reproduced: context.bar.innerHTML === 'new loading' };
});
const validateFn = between('    function validateConfig(raw)', '    function loadConfig()');
const configReload = [-1, 3601, 0, 3600].map(value => {
  const context = { DEFAULT_CONFIG: { refreshInterval: 30 }, value };
  vm.createContext(context);
  return vm.runInContext(validateFn + '\n({saved:value,reloaded:validateConfig({refreshInterval:value}).refreshInterval})', context);
});
const watcherFn = between('    function setupSPAWatcher()', '    /* ============================================================\n     *  设置面板');
let observedBody = null;
const originalBody = { name: 'old body' };
const watcherContext = {
  CONFIG: { enabled: true }, isSiteAllowed: () => true,
  document: { body: originalBody, getElementById: () => ({}) },
  MutationObserver: class { constructor(cb) { this.cb = cb; } observe(target) { observedBody = target; } },
  ensureBar() {}, fetchHitokoto() {},
};
vm.createContext(watcherContext);
vm.runInContext('let spaObserver = null;\n' + watcherFn + '\nsetupSPAWatcher();', watcherContext);
watcherContext.document.body = { name: 'new body' };
const startupFn = between('    function applyConfigChange()', '    /* ============================================================\n     *  油猴菜单');
let watcherSetupCalls = 0;
vm.runInNewContext(startupFn + '\napplyConfigChange();', {
  CONFIG: { enabled: true }, isSiteAllowed: () => true,
  ensureBar() {}, applyVars() {}, fetchHitokoto() {}, removeBar() {}, setupTimer() {},
  setupSPAWatcher() { watcherSetupCalls++; },
});
const rgb = hex => hex.match(/[\da-f]{2}/gi).map(v => parseInt(v, 16));
const mix = (front, back, alpha) => front.map((v, i) => v * alpha + back[i] * (1 - alpha));
const luminance = color => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return +((Math.max(x, y) + .05) / (Math.min(x, y) + .05)).toFixed(3); };
const themes = [
  { theme: 'light', accent: '#A23A2E', ink: '#2A2520', bg: '#F4EFE3', hover: '#EDE5D4' },
  { theme: 'dark', accent: '#E07560', ink: '#E9E2D1', bg: '#1A1713', hover: '#22201A' },
];
const colors = themes.map(t => ({ theme: t.theme, markNormal: contrast(rgb(t.accent), mix(rgb(t.accent), rgb(t.bg), .18)), markHover: contrast(rgb(t.accent), mix(rgb(t.accent), rgb(t.hover), .18)), linkVsText: contrast(rgb(t.accent), rgb(t.ink)) }));
const report = {
  generatedAt: new Date().toISOString(), node: process.version,
  limits: 'Local build and source-derived checks only; no browser, live-site availability, CWV or exploitability test.',
  baseline: { htmlPages: htmlFiles.length, contentEntries: search.length, demoEntries: search.filter(e => e.demo).length, classicInlineScripts, syntaxErrors, jsonLdBlocks, invalidJsonLd, brokenLocalLinks, robots: read('dist/robots.txt'), searchIndex: assets.find(a => a.file === 'search.json'), largestHtml: assets.filter(a => a.file.endsWith('.html')).sort((a, b) => b.bytes - a.bytes).slice(0, 3), bundledJs: assets.filter(a => a.file.startsWith('_astro/') && a.file.endsWith('.js')) },
  reproduced: { requestDetachedNode: races, configReload, observerRetainsOldBody: observedBody === originalBody && observedBody !== watcherContext.document.body, observerSetupCallsWhenEnabling: watcherSetupCalls, contrast: colors },
};
const output = path.join(outDir, 'verification.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
// This is a diagnostic snapshot: reproduced defects are expected and reported, not hidden.
if (syntaxErrors.length || invalidJsonLd.length || brokenLocalLinks.length) process.exitCode = 1;
