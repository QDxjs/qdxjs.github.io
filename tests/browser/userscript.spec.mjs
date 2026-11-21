import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

const scriptPath = fileURLToPath(new URL('../../public/downloads/hitokoto-universal.user.js', import.meta.url));
const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      return new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort();
    });
    await use(page);
    expect(errors, 'No uncaught userscript/browser errors').toEqual([]);
  },
});

async function bootUserscript(page, saved = { enabled: true, refreshInterval: 0, animation: false }) {
  // Obtain the local site's origin, then replace the document with a small host
  // page. Browser DOM, MutationObserver, layout and validity APIs stay native.
  await page.goto('/');
  await page.setContent('<!doctype html><html><head><title>Userscript host</title></head><body><main>Host content</main></body></html>');
  await page.evaluate(initial => {
    const harness = window.__hitoTest = {
      saved: structuredClone(initial), saves: [], requests: [], menus: [], invalidFields: [],
    };
    window.GM_getValue = (key, fallback) => key === 'hitokoto_config' ? structuredClone(harness.saved) : fallback;
    window.GM_setValue = (key, value) => {
      harness.saved = structuredClone(value);
      harness.saves.push({ key, value: structuredClone(value) });
    };
    window.GM_addStyle = css => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      return style;
    };
    window.GM_registerMenuCommand = (label, callback) => harness.menus.push({ label, callback });
    window.GM_xmlhttpRequest = options => {
      const request = { options, aborted: false };
      harness.requests.push(request);
      return {
        abort() {
          request.aborted = true;
          // Managers can deliver onabort immediately. Keep callbacks available
          // afterward so a hostile late completion can also be exercised.
          options.onabort?.();
        },
      };
    };
    document.addEventListener('invalid', event => harness.invalidFields.push(event.target.id), true);
  }, saved);
  await page.addScriptTag({ path: scriptPath });
  await expect.poll(() => page.evaluate(() => window.__hitoTest.requests.length)).toBe(1);
  await expect(page.locator('#hito-bar')).toBeVisible();
}

async function invokeMenu(page, text) {
  await page.evaluate(fragment => {
    const menu = window.__hitoTest.menus.find(item => item.label.includes(fragment));
    if (!menu) throw new Error(`Missing GM menu: ${fragment}`);
    menu.callback();
  }, text);
}

test('pending quote survives native body replacement and cannot return after disabling', async ({ page }) => {
  await bootUserscript(page);
  await page.evaluate(() => {
    window.__hitoTest.originalBar = document.getElementById('hito-bar');
    const replacement = document.createElement('body');
    replacement.innerHTML = '<main>SPA replacement body</main>';
    document.body.replaceWith(replacement);
  });
  await expect(page.locator('#hito-bar')).toBeVisible();
  expect(await page.evaluate(() => document.getElementById('hito-bar') !== window.__hitoTest.originalBar)).toBe(true);
  expect(await page.evaluate(() => window.__hitoTest.requests.length)).toBe(1);
  await page.evaluate(() => window.__hitoTest.requests[0].options.onload({
    responseText: JSON.stringify({ hitokoto: 'A quote for the live body', from: 'Browser regression' }),
  }));
  await expect(page.locator('#hito-bar .hito-text')).toHaveText('A quote for the live body');

  await invokeMenu(page, '换一句');
  await expect.poll(() => page.evaluate(() => window.__hitoTest.requests.length)).toBe(2);
  await invokeMenu(page, '开关一言');
  await expect(page.locator('#hito-bar')).toHaveCount(0);
  expect(await page.evaluate(() => window.__hitoTest.requests[1].aborted)).toBe(true);
  expect(await page.evaluate(() => window.__hitoTest.saved.enabled)).toBe(false);
  await page.evaluate(async () => {
    window.__hitoTest.requests[1].options.onload({
      responseText: JSON.stringify({ hitokoto: 'Must remain hidden' }),
    });
    document.body.append(document.createElement('p'));
    // Let genuine MutationObserver and rendering callbacks run before asserting
    // that neither a late response nor a host mutation resurrected the bar.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator('#hito-bar')).toHaveCount(0);
  expect(await page.evaluate(() => window.__hitoTest.requests.length)).toBe(2);
});

test('native settings validation rejects invalid refresh values and persists both boundaries', async ({ page }) => {
  await bootUserscript(page);
  await invokeMenu(page, '一言设置');
  const refresh = page.locator('#hito-cfg-refresh');
  const save = page.locator('#hito-btn-save');
  for (const value of ['-1', '3601', '1.5']) {
    await refresh.fill(value);
    await save.click();
    await expect(refresh).toBeVisible();
    await expect(refresh).toBeFocused();
    expect(await refresh.evaluate(node => node.matches(':invalid'))).toBe(true);
    expect(await refresh.evaluate(node => node.validationMessage)).not.toBe('');
    expect(await page.evaluate(() => window.__hitoTest.saves.length)).toBe(0);
    expect(await page.evaluate(() => window.__hitoTest.saved.refreshInterval)).toBe(0);
  }
  expect(await page.evaluate(() => window.__hitoTest.invalidFields)).toEqual([
    'hito-cfg-refresh', 'hito-cfg-refresh', 'hito-cfg-refresh',
  ]);

  for (const value of [0, 3600]) {
    await refresh.fill(String(value));
    await save.click();
    await expect(page.locator('#hito-settings-overlay')).toHaveCount(0);
    const persisted = await page.evaluate(() => window.__hitoTest.saved);
    expect(persisted.refreshInterval).toBe(value);
    expect(await page.evaluate(() => window.__hitoTest.saves.at(-1).key)).toBe('hitokoto_config');
    // Reboot from the saved GM data to exercise loadConfig as well as reopening
    // the panel; a value accepted only until reload would fail this assertion.
    await bootUserscript(page, persisted);
    await invokeMenu(page, '一言设置');
    await expect(refresh).toHaveValue(String(value));
  }
});
