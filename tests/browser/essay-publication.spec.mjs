import { test, expect } from '@playwright/test';

test('published essay page and root-based image load without layout overflow', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/essays/20261121-%E8%A6%86%E7%94%91%E4%B9%8B%E4%B8%8B/');
  await expect(page.getByRole('heading', { name: '覆甑之下', level: 1 })).toBeVisible();
  await expect(page.getByText('随笔·生活', { exact: true })).toBeVisible();
  await expect(page.locator('.article-head .by')).toContainText('约 3 分钟');
  await expect(page.locator('.article-head .by')).not.toContainText('约 约');
  await expect(page.locator('.readinfo')).toContainText('约 3 分钟');
  await expect(page.locator('.readinfo')).not.toContainText('约 约');
  const image = page.locator('.prose img');
  await expect(image).toHaveCount(1);
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  const result = await image.evaluate(node => {
    const imageBox = node.getBoundingClientRect();
    const proseBox = node.closest('.prose').getBoundingClientRect();
    return {
      src: node.getAttribute('src'), alt: node.getAttribute('alt'),
      width: node.naturalWidth, height: node.naturalHeight,
      left: imageBox.left, right: imageBox.right,
      proseLeft: proseBox.left, proseRight: proseBox.right,
    };
  });
  expect(decodeURI(result.src)).toBe('/images/essays/20261121-fuzeng-zhixia/20261121-花体.jpg');
  expect(result.alt).toContain('练习纸');
  expect(result.width).toBeGreaterThan(0);
  expect(result.height).toBeGreaterThan(0);
  expect(result.left).toBeGreaterThanOrEqual(result.proseLeft - 1);
  expect(result.right).toBeLessThanOrEqual(result.proseRight + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
  console.log('ARTICLE_IMAGE_SMOKE=' + JSON.stringify(result));
});
