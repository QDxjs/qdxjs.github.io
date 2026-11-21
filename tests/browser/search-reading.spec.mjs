import { test as base, expect } from '@playwright/test';

const articleURL = '/works/%E4%B8%80%E8%A8%80/';
const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
      ? route.continue() : route.abort());
    await use(page);
    expect(errors, 'No uncaught search/reading errors').toEqual([]);
  },
});

function entry(title, fields = {}) {
  return { title, excerpt: '', src: '', body: '', tags: [], sectionLabel: '作品',
    date: '2026-11-20', url: articleURL, ...fields };
}

const rankingFixture = [
  entry('正文先到', { body: 'NEEDLE '.repeat(30) }),
  entry('摘要先到', { excerpt: 'needle' }),
  entry('needle 标题甲'),
  entry('标签先到', { tags: ['needle'] }),
  entry('needle 标题乙', { body: 'needle '.repeat(50) }),
  entry('来源先到', { src: 'needle' }),
  entry('摘要后到', { excerpt: 'needle' }),
  entry('<img src=x onerror="window.searchXSS=true"> needle 标题丙', { url: 'javascript:window.searchXSS=true' }),
  // Adjacent tags are not a single searchable phrase.
  entry('不要跨标签命中', { tags: ['nee', 'dle'] }),
];

async function submit(page, query) {
  await page.getByRole('searchbox', { name: '关键词' }).fill(query);
  await page.getByRole('searchbox', { name: '关键词' }).press('Enter');
}

async function progress(page) {
  return page.locator('#progFill').evaluate(node => Number.parseFloat(node.style.width));
}

async function scrollTo(page, top) {
  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), top);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('search ranks title, tags, excerpt, source and body with stable ties and safe text', async ({ page }) => {
  await page.route('**/search.json', route => route.fulfill({ json: rankingFixture }));
  await page.goto('/search/?q=needle');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('.st a')).toHaveText([
    'needle 标题甲', 'needle 标题乙', rankingFixture[7].title,
    '标签先到', '摘要先到', '摘要后到', '来源先到', '正文先到',
  ]);
  expect(await page.locator('#results img, #results script').count()).toBe(0);
  expect(await page.evaluate(() => window.searchXSS)).toBeUndefined();
  await expect(page.locator('.st a').nth(2)).toHaveAttribute('href', '/search/');
  await expect(page.locator('.st mark').first()).toHaveText('needle');
  await submit(page, '不存在');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'empty');
  await page.goBack();
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('.st a').first()).toHaveText('needle 标题甲');
  await expect(page.getByRole('searchbox', { name: '关键词' })).toHaveValue('needle');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'blank');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
});

test('search retries failures and ignores a stale pending response after clearing', async ({ page }) => {
  let requests = 0;
  let release;
  await page.route('**/search.json', async route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, body: 'Unavailable' });
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ json: rankingFixture });
  });
  await page.goto('/search/?q=needle');
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'error');
  await page.getByRole('button', { name: '重试搜索' }).click();
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'loading');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: '清空', exact: true }).click();
  release();
  await expect(page.locator('#searchOutput')).toHaveAttribute('data-state', 'blank');
  await expect(page.locator('.sr-item')).toHaveCount(0);
  await expect(page.locator('#results')).toHaveAttribute('aria-busy', 'false');
});

test('returning from a result restores the query, relevance order and list position', async ({ page }) => {
  const fixture = Array.from({ length: 25 }, (_, index) => entry(`needle 结果 ${index}`));
  await page.route('**/search.json', route => route.fulfill({ json: fixture }));
  await page.goto('/search/?q=needle');
  const result = page.locator('.st a').nth(15);
  await result.scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => scrollY);
  await result.click();
  await expect(page.locator('[data-return-list]')).toHaveText('返回搜索结果');
  await page.locator('[data-return-list]').click();
  await expect(page).toHaveURL(/\/search\/\?q=needle$/);
  await expect(page.locator('.st a').nth(15)).toHaveText('needle 结果 15');
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - position)).toBeLessThan(4);
});

test('reading progress is zero at the body start, half midway, and complete at its end', async ({ page }) => {
  await page.goto(articleURL);
  await scrollTo(page, 0);
  await expect.poll(() => progress(page)).toBe(0);
  const range = await page.locator('#articleBody').evaluate(body => {
    const rect = body.getBoundingClientRect();
    const top = rect.top + scrollY;
    return { start: top - 96, end: top + rect.height - innerHeight };
  });
  await scrollTo(page, range.start);
  expect(await progress(page)).toBeLessThan(0.2);
  await scrollTo(page, (range.start + range.end) / 2);
  expect(await progress(page)).toBeGreaterThan(49);
  expect(await progress(page)).toBeLessThan(51);
  await scrollTo(page, range.end + 2);
  await expect.poll(() => progress(page)).toBe(100);
  await scrollTo(page, 0);
  await expect.poll(() => progress(page)).toBe(0);
});

test('short bodies start unread, finish at page end, and have no floating directory', async ({ page }) => {
  await page.goto(articleURL);
  await page.locator('#articleBody').evaluate(body => {
    body.replaceChildren(Object.assign(document.createElement('p'), { textContent: '短文阅读边界。' }));
    body.style.minHeight = '120px';
  });
  await scrollTo(page, 0);
  await expect.poll(() => progress(page)).toBe(0);
  await scrollTo(page, Number.MAX_SAFE_INTEGER);
  await expect.poll(() => progress(page)).toBe(100);
  await expect(page.locator('#tocReopen')).toBeHidden();
});

test('long mobile articles reopen the existing directory with keyboard focus and Escape', async ({ page }) => {
  test.skip((page.viewportSize()?.width || 1280) > 900, 'Mobile disclosure behavior');
  await page.goto(articleURL);
  const disclosure = page.locator('#articleTocMobile');
  await expect(disclosure).not.toHaveAttribute('open');
  await page.locator('#articleTocMobile summary').click();
  await expect(disclosure).toHaveAttribute('open', '');
  await page.locator('#articleTocMobile summary').click();
  const top = await page.locator('#articleBody').evaluate(body => body.getBoundingClientRect().top + scrollY + innerHeight);
  await scrollTo(page, top);
  const button = page.getByRole('button', { name: '本文目录', exact: true });
  await expect(button).toBeVisible();
  const before = await page.evaluate(() => scrollY);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(disclosure).toHaveClass(/toc-floating/);
  await expect(page.locator('#articleTocMobile summary')).toBeFocused();
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await expect(disclosure).not.toHaveAttribute('open');
  await expect(button).toBeFocused();
  await button.click();
  const target = disclosure.locator('a').nth(2);
  const id = await target.getAttribute('data-heading-id');
  await target.click();
  await expect(page.locator(`#articleBody [id="${id}"]`)).toBeFocused();
  await expect(disclosure).not.toHaveAttribute('open');
  expect(decodeURIComponent(new URL(page.url()).hash.slice(1))).toBe(id);
});

test('copy preserves exact code text and Shiki markup and announces denied clipboard access', async ({ page }) => {
  await page.addInitScript(() => {
    window.copiedCode = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.copiedCode.push(text); },
    } });
  });
  await page.goto(articleURL);
  const pre = page.locator('.prose pre').first();
  const original = await pre.evaluate(node => ({ html: node.innerHTML, text: node.querySelector('code').textContent }));
  const button = page.getByRole('button', { name: '复制第 1 段代码', exact: true });
  await button.click();
  await expect(page.locator('#copy-status-1')).toHaveText('代码已复制。');
  expect(await page.evaluate(() => window.copiedCode)).toEqual([original.text]);
  expect(await pre.innerHTML()).toBe(original.html);
  expect(await pre.locator('button').count()).toBe(0);
  expect(await pre.evaluate(node => getComputedStyle(node).overflowX)).toBe('auto');
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  await button.click();
  await expect(page.locator('#copy-status-1')).toHaveText('复制失败，请选中下方代码手动复制。');
  await expect(page.locator('#copy-status-1')).toHaveAttribute('role', 'status');
  await expect(button).toBeEnabled();
  expect(await pre.innerHTML()).toBe(original.html);
});

test('article code and native directory remain readable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
    ? route.continue() : route.abort());
  await page.goto(articleURL);
  await expect(page.locator('.prose pre').first()).toContainText('github.com');
  await expect(page.locator('.code-copy')).toHaveCount(0);
  await page.locator('#articleTocMobile summary').click();
  await expect(page.locator('#articleTocMobile')).toHaveAttribute('open', '');
  await expect(page.locator('#articleTocMobile a').first()).toBeVisible();
  await context.close();
});
