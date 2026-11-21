// Reproduce guide images from the shipped script on an empty solid-color page.
// All browser requests stay inside this offline fixture. The background must not
// include blog biographies or other placeholder text. GM APIs use a sample quote.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/images/works/hitokoto');
const origin = 'https://demo.example';
const fixture = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>一言界面演示</title><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;min-height:100vh;background:#F4EFE3;color:#2A2520;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.85}</style></head><body><main id="demo-canvas" aria-label="纯色演示背景"></main></body></html>`;
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 900, height: 580 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url() === `${origin}/`
    ? route.fulfill({ body: fixture, contentType: 'text/html; charset=utf-8' })
    : route.abort());
  await page.goto(`${origin}/`);
  await expect(page.locator('body')).toHaveText('');
  await expect(page.locator('#demo-canvas')).toBeEmpty();
  await expect(page.locator('body')).toHaveCSS('background-image', 'none');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 239, 227)');
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
  await expect(page.locator('body > :not(#hito-bar):not(#demo-canvas)')).toHaveCount(0);
  await page.screenshot({ path: path.join(output, 'bar-solid.jpg'), type: 'jpeg', quality: 88, clip: { x: 0, y: 360, width: 900, height: 220 }, animations: 'disabled' });

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
    const pixels = name.endsWith('.png') ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: 1800, height: 440 };
    return { name, bytes: bytes.length, pixels, articleSize: { width: pixels.width / 2, height: pixels.height / 2 } };
  });
  console.log(JSON.stringify({ scriptVersion: '2.4', origin, sampleQuote: true, deviceScaleFactor: 2, files }, null, 2));
} finally {
  await browser.close();
}
