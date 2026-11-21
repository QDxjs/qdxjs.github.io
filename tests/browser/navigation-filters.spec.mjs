import { test as base, expect } from '@playwright/test';

const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
      return route.abort();
    });
    await use(page);
    expect(errors, 'No uncaught navigation/filter JavaScript errors').toEqual([]);
  },
});

const list = page => page.locator('[data-paginated-list]');
const ready = async page => expect(list(page)).toHaveAttribute('data-state', 'ready');

// Supply enough tagged notes for a real second page without mutating content files.
async function withTwoPageTags(page) {
  await page.route('**/tags/**', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    const fixtures = Array.from({ length: 12 }, (_, index) =>
      `<div data-list-item data-section="notes" data-tags='["阅读","城市"]' hidden><p>标签分页回归 ${index + 1}</p></div>`
    ).join('');
    const marker = /(<div\b[^>]*\bdata-list-item\b[^>]*>)/;
    expect(body).toMatch(marker);
    await route.fulfill({ response, body: body.replace(marker, `${fixtures}$1`) });
  });
}

function expectParams(page, params) {
  return expect(page).toHaveURL(url => Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value));
}

test('menu and desktop navigation follow keyboard order; Escape returns mobile focus', async ({ page }) => {
  await page.goto('/notes/');
  await ready(page);
  const menu = page.locator('#menuBtn');
  const links = page.locator('#nav a');
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(links.first()).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(menu).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(links.first()).toBeFocused();
    for (let index = 1; index < await links.count(); index++) {
      await page.keyboard.press('Tab');
      await expect(links.nth(index)).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await expect(page.locator('#nav')).toBeHidden();
    // A hidden menu must not leave its links in the tab sequence.
    await page.keyboard.press('Tab');
    await expect(links.first()).not.toBeFocused();
  } else {
    await page.locator('.brand').focus();
    await page.keyboard.press('Tab');
    await expect(links.first()).toBeFocused();
    await links.last().focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.search-entry')).toBeFocused();
  }
});

test('selecting and switching tags retains section, resets page, and supports history', async ({ page }) => {
  await withTwoPageTags(page);
  await page.goto('/tags/?section=notes&page=1&source=regression');
  await ready(page);
  const reading = page.locator('[data-tag-choice="阅读"]');
  const city = page.locator('[data-tag-choice="城市"]');
  const href = new URL(await reading.getAttribute('href'), page.url());
  expect(href.searchParams.get('section')).toBe('notes');
  expect(href.searchParams.get('source')).toBe('regression');
  await reading.focus();
  await page.keyboard.press('Enter');
  await expectParams(page, { tag: '阅读', section: 'notes', page: '1' });
  await expect(page.locator('[data-section-filter="notes"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('[data-page-next]').click();
  await expectParams(page, { tag: '阅读', section: 'notes', page: '2' });
  await city.click();
  await expectParams(page, { tag: '城市', section: 'notes', page: '1', source: 'regression' });
  await expect(city).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-list-status]')).toContainText('札记');
  expect(await page.locator('[data-list-item]:visible').evaluateAll(nodes => nodes.every(node => node.dataset.section === 'notes'))).toBe(true);
  await expect(page.locator('[data-list-top]')).toBeFocused();
  await page.goBack();
  await expectParams(page, { tag: '阅读', section: 'notes', page: '2' });
  await expect(reading).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-page-label]')).toHaveText('第 2 / 2 页');
  await page.goForward();
  await expectParams(page, { tag: '城市', section: 'notes', page: '1' });
  await page.reload();
  await ready(page);
  await expectParams(page, { tag: '城市', section: 'notes', page: '1' });
});

test('single-page lists hide pagination and expose an accessible all-tags entry', async ({ page }) => {
  for (const section of ['notes', 'essays', 'works']) {
    await page.goto(`/${section}/`);
    await ready(page);
    const count = await page.locator('[data-list-item]').count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(10);
    await expect(page.getByRole('navigation', { name: '内容分页', includeHidden: true })).toBeHidden();
    const entry = page.getByRole('link', { name: '浏览全部标签', exact: true });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('href', `/tags/?section=${section}&page=1`);
    await entry.focus();
    await page.keyboard.press('Enter');
    await ready(page);
    await expectParams(page, { section, page: '1' });
    await expect(page.getByRole('navigation', { name: '选择标签' })).toBeVisible();
  }
  await page.goto('/tags/?tag=阅读&section=notes&page=1');
  await ready(page);
  await expect(page.locator('[data-list-item]:visible').first()).toBeVisible();
  await expect(page.locator('[data-pagination]')).toBeHidden();
});

test('without JavaScript navigation and the tag entry remain ordinary links', async ({ browser, baseURL, viewport }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport });
  const page = await context.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  try {
    await page.goto(`${baseURL}/notes/`);
    await expect(page.locator('#menuBtn')).toBeHidden();
    await expect(page.locator('#themeBtn')).toBeHidden();
    await expect(page.locator('#nav a').first()).toBeVisible();
    await expect(page.locator('[data-pagination]')).toBeHidden();
    await page.getByRole('link', { name: '浏览全部标签', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '选择标签' })).toBeVisible();
    await expect(page.locator('[data-tag-choice]').first()).toHaveAttribute('href', /\/tags\/\?tag=/);
  } finally {
    await context.close();
  }
});
