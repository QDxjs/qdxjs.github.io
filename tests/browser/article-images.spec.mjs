import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`Hitokoto guide images load at the correct ratio and fit the article in ${theme} mode`, async ({ page, baseURL }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
    await page.addInitScript(value => localStorage.setItem('qd-theme', value), theme);
    await page.goto('/works/%E4%B8%80%E8%A8%80/');
    const figures = page.locator('.prose .plugin-figure');
    await expect(figures).toHaveCount(3);
    for (const figure of await figures.all()) {
      const image = figure.locator('img');
      await image.scrollIntoViewIfNeeded();
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
      const result = await image.evaluate(node => {
        const box = node.getBoundingClientRect();
        const prose = node.closest('.prose').getBoundingClientRect();
        return {
          src: node.getAttribute('src'),
          href: node.closest('a')?.getAttribute('href'),
          alt: node.getAttribute('alt'),
          declaredWidth: Number(node.getAttribute('width')),
          declaredHeight: Number(node.getAttribute('height')),
          naturalWidth: node.naturalWidth,
          naturalHeight: node.naturalHeight,
          renderedWidth: box.width,
          left: box.left,
          right: box.right,
          proseLeft: prose.left,
          proseRight: prose.right,
        };
      });
      expect(result.alt.length).toBeGreaterThan(10);
      expect(result.href, 'Image opens its full-resolution original').toBe(result.src);
      expect(result.naturalWidth / result.naturalHeight).toBeCloseTo(result.declaredWidth / result.declaredHeight, 3);
      expect(result.renderedWidth).toBeLessThanOrEqual(result.declaredWidth + 1);
      expect(result.left).toBeGreaterThanOrEqual(result.proseLeft - 1);
      expect(result.right).toBeLessThanOrEqual(result.proseRight + 1);
      await expect(figure.locator('figcaption')).not.toBeEmpty();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
