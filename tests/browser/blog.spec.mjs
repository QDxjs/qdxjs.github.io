import { test as base, expect } from '@playwright/test';

// Keep the smoke suite independent of font CDNs and other external services.
// A fresh context for each test also isolates persisted theme/navigation state.
const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === new URL(baseURL).origin) return route.continue();
      return route.abort();
    });
    await use(page);
    expect(errors, 'No uncaught page JavaScript errors').toEqual([]);
  },
});

async function searchForHitokoto(page) {
  await page.goto('/search/');
  await page.getByRole('searchbox', { name: '关键词' }).fill('一言');
  await page.getByRole('searchbox', { name: '关键词' }).press('Enter');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('.sr-item .st a').filter({ hasText: '一言 · 全站通用版' })).toBeVisible();
}

test('keyboard navigation reaches content, menu links, and the search page', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到正文' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  const menu = page.locator('#menuBtn');
  if (await menu.isVisible()) {
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await page.keyboard.press('Enter');
  }
  const works = page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: /^作品/ });
  await works.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === '/works/');
  await expect(page.locator('#nav a[href="/works/"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('.search-entry').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/search\/$/);
  await expect(page.getByRole('searchbox', { name: '关键词' })).toBeVisible();
});

test('real search index produces highlighted results and clearing resets the page', async ({ page }) => {
  await searchForHitokoto(page);
  expect(new URL(page.url()).searchParams.get('q')).toBe('一言');
  await expect(page.locator('#results mark').first()).toHaveText('一言');
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '关键词' })).toHaveValue('');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'blank');
  await expect(page.locator('.sr-item')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
});

test('theme button persists dark and light choices across reloads', async ({ page }) => {
  await page.goto('/search/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '切换为深色主题', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('qd-theme'))).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换为明亮主题', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('qd-theme'))).toBe('light');
});

test('article prose links have a computed underline before hover or focus', async ({ page }) => {
  await page.goto('/works/%E4%B8%80%E8%A8%80/');
  const link = page.locator('.prose a[href="https://hitokoto.cn/"]');
  await expect(link).toBeVisible();
  const decoration = await link.evaluate(node => getComputedStyle(node).textDecorationLine);
  expect(decoration.split(/\s+/)).toContain('underline');
});

// Resolve real browser color/color-mix values through canvas, composite computed
// ancestor background colors, and apply WCAG luminance. This measures CSS color
// contrast; it does not sample decorative background images or glyph pixels.
async function computedMarkContrast(mark) {
  return mark.evaluate(node => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const colorPixel = color => {
      if (!CSS.supports('color', color)) throw new Error(`Unsupported computed color: ${color}`);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const ancestors = [];
    for (let current = node; current; current = current.parentElement) ancestors.unshift(current);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 1);
    for (const ancestor of ancestors) {
      context.fillStyle = getComputedStyle(ancestor).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    const background = [...context.getImageData(0, 0, 1, 1).data];
    const computed = getComputedStyle(node);
    const foreground = colorPixel(computed.color);
    const inkProbe = document.createElement('span');
    inkProbe.style.color = 'var(--ink)';
    node.append(inkProbe);
    const ink = colorPixel(getComputedStyle(inkProbe).color);
    inkProbe.remove();
    const luminance = rgb => {
      const channels = rgb.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return {
      ratio: (values[0] + 0.05) / (values[1] + 0.05),
      foreground,
      ink,
      background,
      computedBackground: computed.backgroundColor,
    };
  });
}

for (const theme of ['light', 'dark']) {
  test(`${theme} computed search highlight contrast passes normally and on hover`, async ({ page }, testInfo) => {
    await searchForHitokoto(page);
    if (theme === 'dark') await page.getByRole('button', { name: '切换为深色主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const result = page.locator('.sr-item').filter({ has: page.locator('.st a', { hasText: '一言 · 全站通用版' }) }).first();
    const mark = result.locator('.st mark').first();
    await page.mouse.move(0, 0);
    const normal = await computedMarkContrast(mark);
    await result.hover();
    expect(await result.evaluate(node => node.matches(':hover'))).toBe(true);
    const hover = await computedMarkContrast(mark);
    for (const measurement of [normal, hover]) {
      expect(measurement.foreground).toEqual(measurement.ink);
      expect(measurement.foreground[3]).toBe(255);
      expect(measurement.ratio).toBeGreaterThanOrEqual(4.5);
    }
    expect(hover.background).not.toEqual(normal.background);
    await testInfo.attach(`computed-contrast-${theme}`, {
      body: JSON.stringify({ normal, hover }, null, 2),
      contentType: 'application/json',
    });
    console.log(`${testInfo.project.name} ${theme}: normal ${normal.ratio.toFixed(3)}:1, hover ${hover.ratio.toFixed(3)}:1`);
  });
}
