import { test, expect } from '@playwright/test';
import { codeToHtml } from 'shiki';
import config from '../../astro.config.mjs';

const article = '/works/%E4%B8%80%E8%A8%80/';

// Measure every rendered text run, including inherited plain-text fence colors.
// Canvas resolves CSS colors and composites ancestor/foreground alpha before WCAG luminance.
async function auditCode(page) {
  return page.locator('.prose').evaluate(prose => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const luminance = rgb => {
      const [r, g, b] = rgb.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const nodes = [...prose.querySelectorAll('pre, code, pre *')];
    const samples = nodes.filter(node => node.matches('pre, code') || [...node.childNodes]
      .some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())).map(node => {
      const ancestors = [];
      for (let current = node; current; current = current.parentElement) ancestors.unshift(current);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 1, 1);
      for (const ancestor of ancestors) {
        context.fillStyle = getComputedStyle(ancestor).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const background = [...context.getImageData(0, 0, 1, 1).data];
      const computed = getComputedStyle(node);
      context.fillStyle = computed.color;
      context.fillRect(0, 0, 1, 1);
      const foreground = [...context.getImageData(0, 0, 1, 1).data];
      const values = [luminance(background), luminance(foreground)].sort((a, b) => b - a);
      return {
        tag: node.tagName, text: node.textContent.trim().slice(0, 80),
        color: computed.color, background, fontSize: parseFloat(computed.fontSize),
        ratio: (values[0] + .05) / (values[1] + .05),
      };
    });
    return {
      samples,
      blocks: [...prose.querySelectorAll('pre')].map(pre => ({
        overflow: getComputedStyle(pre).overflowX,
        left: pre.getBoundingClientRect().left, right: pre.getBoundingClientRect().right,
        width: pre.clientWidth, scrollWidth: pre.scrollWidth,
      })),
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
}

function expectReadable(audit) {
  expect(audit.samples.length).toBeGreaterThan(0);
  for (const sample of audit.samples) {
    expect(sample.ratio, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
    expect(sample.fontSize, JSON.stringify(sample)).toBeGreaterThanOrEqual(14);
  }
  for (const block of audit.blocks) {
    expect(block.overflow).toBe('auto');
    expect(block.left).toBeGreaterThanOrEqual(0);
    expect(block.right).toBeLessThanOrEqual(audit.viewport + 1);
  }
  expect(audit.documentWidth).toBeLessThanOrEqual(audit.viewport + 1);
}

for (const theme of ['light', 'dark']) {
  test(`article code is readable and contained in ${theme} theme`, async ({ page, baseURL }, testInfo) => {
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
      ? route.continue() : route.abort());
    await page.addInitScript(value => localStorage.setItem('qd-theme', value), theme);
    await page.goto(article);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.locator('.prose pre[data-language="text"]').count()).toBeGreaterThanOrEqual(3);
    expect(await page.locator('.prose code').count()).toBeGreaterThan(3);
    const actual = await auditCode(page);
    expectReadable(actual);

    // This article has only text fences. Exercise real Shiki token palettes too,
    // plus a long unbroken line that must scroll inside its block on both viewports.
    const snippets = [
      ['javascript', '// Comment\nconst count = 42;\nexport async function greet(name) { return `Hello ${name}`; }\nconsole.log(greet("reader"), true, /hello/g);'],
      ['css', '/* Comment */\n.card:hover { color: #ff0000; width: 100%; display: block !important; }'],
      ['html', '<!-- Comment -->\n<a href="https://example.com" class="link">Readable &amp; colorful</a>'],
      ['text', 'https://example.com/' + 'long-domain-segment.'.repeat(30)],
    ];
    const markup = await Promise.all(snippets.map(([lang, source]) => codeToHtml(source, {
      ...config.markdown.shikiConfig, lang,
    })));
    await page.locator('.prose').evaluate((prose, blocks) => {
      const fixture = document.createElement('section');
      fixture.dataset.codePaletteFixture = '';
      fixture.innerHTML = blocks.join('\n');
      for (const pre of fixture.querySelectorAll('pre')) pre.classList.add('astro-code');
      prose.append(fixture);
    }, markup);
    const palette = await auditCode(page);
    expectReadable(palette);
    expect(new Set(palette.samples.map(sample => sample.color)).size).toBeGreaterThan(4);
    const longBlock = palette.blocks.at(-1);
    expect(longBlock.scrollWidth).toBeGreaterThan(longBlock.width);
    await page.locator('[data-code-palette-fixture] pre').last().evaluate(pre => { pre.scrollLeft = 100; });
    expect(await page.locator('[data-code-palette-fixture] pre').last().evaluate(pre => pre.scrollLeft)).toBeGreaterThan(0);
    await testInfo.attach('computed-code-readability', {
      body: JSON.stringify({ actual, palette }, null, 2), contentType: 'application/json',
    });
  });
}
