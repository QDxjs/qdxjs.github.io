import { test, expect } from '@playwright/test';

// Use the shipped content; external font services are irrelevant to the flow.
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
});

test('home leads with real content and keeps demo content identified', async ({ page }) => {
  await page.goto('/');
  const index = await (await page.request.get('/search.json')).json();
  const featured = page.locator('[data-home-featured]');
  await expect(featured).toBeVisible();
  const href = await featured.locator('h2 a').getAttribute('href');
  const item = index.find(entry => entry.url === href);
  expect(item, 'The lead must be actual indexed content').toBeTruthy();
  expect(item.demo).toBe(false);
  await expect(featured.locator('img')).toHaveJSProperty('complete', true);
  expect(await featured.locator('img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.home-note')).toContainText('演示内容');
  await expect(page.locator('.home-columns .demo-badge').first()).toBeVisible();
  const shortcuts = page.getByRole('navigation', { name: '首页栏目快捷入口' });
  await expect(shortcuts.getByRole('link', { name: /作品/ })).toHaveAttribute('href', '#home-works');
  await expect(shortcuts.getByRole('link', { name: /按标签浏览/ })).toHaveAttribute('href', '/tags/');
});

test('work image opens the introduction and its tags stay separate links', async ({ page }) => {
  await page.goto('/works/');
  const work = page.locator('.work').filter({ has: page.getByRole('heading', { name: '一言 · 全站通用版', exact: true }) });
  const primary = work.locator('.work-primary');
  const url = await primary.getAttribute('href');
  await expect(work.locator('.work-thumb img')).toBeVisible();
  expect(await work.locator('.work-thumb').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(244, 239, 227)');
  expect(await work.locator('.work-thumb img').evaluate(node => getComputedStyle(node).objectFit)).toBe('contain');
  await work.locator('.work-thumb img').click();
  await expect(page).toHaveURL(value => decodeURIComponent(value.pathname) === decodeURIComponent(url));
  await page.goBack();
  await expect(work).toBeVisible();
  const tag = work.locator('.tags a').first();
  const text = await tag.textContent();
  await tag.click();
  await expect(page).toHaveURL(value => value.pathname === '/tags/' && value.searchParams.get('tag') === text);
});

for (const theme of ['light', 'dark']) {
  test(`${theme} home and work layouts fit the viewport and metadata stays readable`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem('qd-theme', theme), theme);
    for (const route of ['/', '/works/']) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      for (const item of await page.locator('.demo-badge, .work-date, .work-platforms, .work-read, .tag, .nav .cnt, .search-entry').all()) {
        if (await item.isVisible()) {
          expect(await item.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(14);
        }
      }
      for (const image of await page.locator('img').all()) {
        await image.scrollIntoViewIfNeeded();
        await expect(image).toHaveJSProperty('complete', true);
        expect(await image.evaluate(node => node.naturalWidth)).toBeGreaterThan(0);
        const box = await image.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth + 1));
      }
    }
  });
}
