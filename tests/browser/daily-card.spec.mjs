import { test as base, expect } from '@playwright/test';

const lunarAsset = /\/_astro\/lunar[.-][^/]+\.js(?:\?.*)?$/;
const hitokotoAPI = 'https://v1.hitokoto.cn/**';

// Only local build artifacts may execute. Hitokoto responses are explicit test data.
const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
      return route.abort();
    });
    await use(page);
    expect(errors, 'No uncaught daily-card JavaScript errors').toEqual([]);
  },
});

test.use({ timezoneId: 'Asia/Shanghai' });

// Freeze before navigation so slow asset loading cannot consume the test's time window.
// These are synthetic dates in an explicit timezone, independent of the host clock.
async function freezeClockAt(page, isoTime) {
  const instant = new Date(isoTime);
  await page.clock.install({ time: new Date(instant.getTime() - 60_000) });
  await page.clock.pauseAt(instant);
}

test('local lunar asset renders offline and the card still exports with the quote fallback', async ({ page, baseURL }) => {
  const requests = [];
  page.on('request', request => {
    if (lunarAsset.test(request.url())) requests.push(request.url());
  });
  await page.goto('/about/');
  await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('[data-cal-lunar]')).toHaveText(/^农历.+月.+/);
  await expect(page.locator('[data-cal-day]')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}$/);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).origin).toBe(new URL(baseURL).origin);
  await expect(page.locator('[data-hitokoto]')).toHaveAttribute('data-state', 'failure');
  await expect(page.locator('[data-hk-text]')).toHaveText('青灯之下，黄卷之间，为值得重读的字句留一笔朱批。');
  await expect(page.locator('[data-hk-status]')).toContainText('本地兜底句');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '存图', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^daily-\d{4}-\d{2}-\d{2}\.png$/);
  await expect(page.locator('[data-export-status]')).toContainText('PNG 已生成');
});

test('a failed local lunar request leaves Gregorian dates available and can be retried', async ({ page }) => {
  let requests = 0;
  await page.route(lunarAsset, route => {
    requests += 1;
    return requests === 1 ? route.abort() : route.continue();
  });
  await page.goto('/about/');
  await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'failure');
  await expect(page.locator('[data-cal-status]')).toHaveText('农历加载失败，公历仍可用。');
  await expect(page.locator('[data-cal-day]')).not.toHaveText('—');
  await page.getByRole('button', { name: '重试农历', exact: true }).click();
  await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('[data-cal-lunar]')).toHaveText(/^农历.+月.+/);
  await expect(page.locator('[data-cal-retry]')).toBeHidden();
  expect(requests).toBe(2);
});

test('a stalled local lunar asset times out and a new local request recovers', async ({ page }) => {
  const pending = [];
  let requests = 0;
  await freezeClockAt(page, '2026-11-27T04:00:00Z');
  await page.route(lunarAsset, route => {
    requests += 1;
    if (requests === 1) {
      pending.push(route);
      return;
    }
    return route.continue();
  });
  try {
    await page.goto('/about/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'loading');
    await expect.poll(() => pending.length).toBe(1);
    const timeoutMs = Number(await page.locator('[data-calendar]').getAttribute('data-timeout'));
    expect(Number.isFinite(timeoutMs) && timeoutMs > 0).toBe(true);
    await page.clock.fastForward(timeoutMs + 1);
    await expect(page.locator('[data-cal-status]')).toHaveText('农历加载超时，公历仍可用。');
    await expect(page.locator('[data-cal-day]')).not.toHaveText('—');
    await pending.shift().abort().catch(() => {});
    await page.getByRole('button', { name: '重试农历', exact: true }).click();
    await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'success');
    expect(requests).toBe(2);
  } finally {
    for (const route of pending) await route.abort().catch(() => {});
  }
});

test('the local calendar follows midnight without reloading the lunar asset', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (lunarAsset.test(request.url())) requests += 1; });
  await freezeClockAt(page, '2026-11-27T15:59:59Z');
  await page.goto('/about/');
  await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('[data-cal-day]')).toHaveAttribute('datetime', '2026-11-27');
  const before = await page.locator('[data-cal-lunar]').textContent();
  await page.clock.fastForward(2000);
  await expect(page.locator('[data-cal-day]')).toHaveAttribute('datetime', '2026-11-28');
  await expect(page.locator('[data-cal-lunar]')).not.toHaveText(before);
  await expect(page.locator('[data-calendar]')).toHaveAttribute('data-state', 'success');
  expect(requests).toBe(1);
});

test('quote validation keeps the fallback, retries, and preserves the last online quote', async ({ page }) => {
  let requests = 0;
  await page.route(hitokotoAPI, route => {
    requests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(requests === 2 ? { hitokoto: '测试在线句。', from: '本地测试' } : { hitokoto: '' }),
    });
  });
  await page.goto('/about/');
  await expect(page.locator('[data-hitokoto]')).toHaveAttribute('data-state', 'failure');
  await expect(page.locator('[data-hk-status]')).toContainText('当前为本地兜底句');
  await page.getByRole('button', { name: '重试一言', exact: true }).click();
  await expect(page.locator('[data-hitokoto]')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('[data-hk-text]')).toHaveText('测试在线句。');
  await page.getByRole('button', { name: '换一句一言', exact: true }).click();
  await expect(page.locator('[data-hitokoto]')).toHaveAttribute('data-state', 'failure');
  await expect(page.locator('[data-hk-text]')).toHaveText('测试在线句。');
  await expect(page.locator('[data-hk-status]')).toContainText('已保留上次在线句');
  expect(requests).toBe(3);
});
