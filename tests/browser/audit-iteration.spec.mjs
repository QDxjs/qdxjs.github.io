import { test, expect } from '@playwright/test';

const essay = '/essays/20261121-%E8%A6%86%E7%94%91%E4%B9%8B%E4%B8%8B/';
test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
});

test('article chooses a responsive modern image and uses local fonts with complete sharing metadata', async ({ page }) => {
  const imageRequests = [];
  page.on('request', request => { if (/\.(avif|webp|jpg)(?:\?|$)/.test(request.url())) imageRequests.push(request.url()); });
  await page.goto(essay);
  const image = page.locator('.prose img');
  await image.scrollIntoViewIfNeeded();
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  expect(await image.getAttribute('width')).toBe('4080');
  expect(await image.getAttribute('height')).toBe('3060');
  await expect(image).toHaveAttribute('loading', 'lazy');
  const current = await image.evaluate(node => node.currentSrc);
  expect(current).toMatch(/\/images\/generated\/.*-\d+\.avif$/);
  const resource = await image.evaluate(node => {
    const timing = performance.getEntriesByName(node.currentSrc).at(-1);
    return { path: new URL(node.currentSrc).pathname, encodedBytes: timing?.encodedBodySize, naturalWidth: node.naturalWidth };
  });
  expect(resource.encodedBytes).toBeGreaterThan(0);
  expect(resource.encodedBytes).toBeLessThan(155_000);
  console.log('RESPONSIVE_IMAGE=' + JSON.stringify(resource));
  expect(imageRequests.some(url => url.includes('%E8%8A%B1%E4%BD%93.jpg') || url.includes('花体.jpg'))).toBe(false);
  const data = await image.evaluate(node => ({ natural: node.naturalWidth / node.naturalHeight, box: node.getBoundingClientRect().width / node.getBoundingClientRect().height }));
  expect(data.box).toBeCloseTo(data.natural, 2);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  const socialURL = await page.locator('meta[property="og:image"]').getAttribute('content');
  expect(new URL(socialURL).pathname).toContain('/og/essays/');
  expect((await page.request.get(new URL(socialURL).pathname)).status()).toBe(200);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').filter(item => /\.(woff2?|css)(\?|$)/.test(item.name)).every(item => new URL(item.name).origin === location.origin))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('content scopes keep published and demo lists distinct through browser history', async ({ page }) => {
  const works = (await (await page.request.get('/search.json')).json()).filter(item => item.section === 'works');
  const publishedWorks = works.filter(item => !item.demo);
  const demoWorks = works.filter(item => item.demo);
  expect(publishedWorks.length).toBeGreaterThan(0);
  expect(demoWorks.length).toBeGreaterThan(0);
  await page.goto('/works/?scope=published');
  const visible = page.locator('[data-list-item]:visible');
  await expect(visible).toHaveCount(publishedWorks.length);
  expect(await visible.evaluateAll(nodes => nodes.every(node => node.dataset.demo === 'false'))).toBe(true);
  await page.locator('[data-scope-filter="demo"]').click();
  await expect(visible).toHaveCount(demoWorks.length);
  expect(await visible.evaluateAll(nodes => nodes.every(node => node.dataset.demo === 'true'))).toBe(true);
  await page.goBack();
  await expect(visible).toHaveCount(publishedWorks.length);
  await expect(page.locator('[data-scope-filter="published"]')).toHaveAttribute('aria-current', 'true');
  const published = publishedWorks[0];
  await page.goto('/tags/?' + new URLSearchParams({ tag: published.tags[0], scope: 'published' }));
  expect(await page.locator('[data-list-item]:visible').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.dataset.demo === 'false'))).toBe(true);
});

test('search scopes survive navigation and share a content versioned index request', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/search.json') requests.push(request.url()); });
  await page.goto('/search/?q=一言&scope=published');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('#scope')).toHaveValue('published');
  await expect(page.locator('#results .demo')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0]).searchParams.get('v')).toMatch(/^[a-f0-9]{16}$/);
  await page.locator('#scope').selectOption('demo');
  await expect(page).toHaveURL(url => url.searchParams.get('scope') === 'demo');
  await page.goBack();
  await expect(page.locator('#scope')).toHaveValue('published');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'success');
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('#scope')).toHaveValue('all');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'blank');
});
