// Reproduce the guide images from the shipped script and built site.
// Run `npm run build` first. All browser requests stay inside an offline fixture;
// GM APIs return a fixed sample sentence, never a fabricated extension interface.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const output = path.join(root, 'public/images/works/hitokoto');
const origin = 'https://demo.example';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 580 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    let file = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(dist + path.sep)) return route.abort();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
    return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
  });
  await page.addInitScript(() => localStorage.setItem('qd-theme', 'light'));
  await page.goto(`${origin}/about/`);
  await page.evaluate(() => {
    const menus = window.__hitokotoCaptureMenus = [];
    window.GM_getValue = (_key, fallback) => ({ ...fallback, category: 'd', position: 'bottom', fontSize: 18, opacity: 1, refreshInterval: 0, animation: false });
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = (label, callback) => menus.push({ label, callback });
    window.GM_addStyle = css => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); };
    Object.assign(window, {
      GM_xmlhttpRequest(options) {
        queueMicrotask(() => options.onload({ responseText: JSON.stringify({ hitokoto: '把网页的一角，留给一句话。', from: '演示句子' }) }));
        return { abort() {} };
      },
    });
  });
  await page.addScriptTag({ path: path.join(root, 'public/downloads/hitokoto-universal.user.js') });
  await expect(page.locator('#hito-bar .hito-text')).toHaveText('把网页的一角，留给一句话。');
  await expect(page.locator('#hito-bar')).toHaveCSS('font-size', '18px');
  await expect(page.locator('#hito-bar')).toHaveClass(/hito-bottom/);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, 'bar.jpg'), type: 'jpeg', quality: 88, animations: 'disabled' });

  await page.setViewportSize({ width: 900, height: 900 });
  await page.locator('#hito-bar').click({ button: 'right' });
  const panel = page.locator('#hito-settings-panel');
  await expect(panel).toBeVisible();
  // Wait for the panel's own opening transition without altering product CSS.
  await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  const box = await panel.boundingBox();
  await page.screenshot({ path: path.join(output, 'settings.png'), clip: { x: box.x, y: box.y, width: box.width, height: Math.min(620, box.height) }, animations: 'disabled' });

  await page.locator('#hito-cfg-siteMode').selectOption('whitelist');
  await page.locator('#hito-cfg-siteList').fill('demo.example\n*.example.com');
  await panel.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(page.locator('#hito-btn-save')).toBeVisible();
  await panel.screenshot({ path: path.join(output, 'sites.png'), animations: 'disabled' });
  expect(errors, 'Capture must not hide browser errors').toEqual([]);
  const files = fs.readdirSync(output).map(name => {
    const bytes = fs.readFileSync(path.join(output, name));
    const pixels = name.endsWith('.png') ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: 1800, height: 1160 };
    return { name, bytes: bytes.length, pixels, articleSize: { width: pixels.width / 2, height: pixels.height / 2 } };
  });
  console.log(JSON.stringify({ scriptVersion: '2.4', origin, sampleQuote: true, deviceScaleFactor: 2, files }, null, 2));
} finally {
  await browser.close();
}
