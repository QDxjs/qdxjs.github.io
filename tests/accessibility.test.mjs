import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const globalCSS = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const searchSource = readFileSync(new URL('../src/pages/search.astro', import.meta.url), 'utf8');
const searchCSS = searchSource.match(/<style>([\s\S]*?)<\/style>/)?.[1];
assert.ok(searchCSS, 'Search page must expose its scoped styles for this source regression');

// This intentionally supports the CSS forms used here, not the complete cascade.
// Fail closed if a selector or color expression changes beyond this model.
function declarations(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^{}]*)\\}`, 'g'))];
  assert.equal(matches.length, 1, `Expected one rule for ${selector}`);
  return Object.fromEntries(matches[0][1].split(';').filter(value => value.trim()).map(value => {
    const colon = value.indexOf(':');
    assert.ok(colon > 0, `Invalid declaration: ${value}`);
    return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
  }));
}

function resolveRGB(expression, palette) {
  const variable = expression.match(/^var\((--[\w-]+)\)$/);
  if (variable) {
    assert.ok(palette[variable[1]], `Missing theme token ${variable[1]}`);
    return resolveRGB(palette[variable[1]], palette);
  }
  assert.match(expression, /^#[\da-f]{6}$/i, `Unsupported color expression: ${expression}`);
  return [1, 3, 5].map(offset => Number.parseInt(expression.slice(offset, offset + 2), 16) / 255);
}

function luminance(rgb) {
  const linear = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function highlightBackground(expression, palette, surface) {
  const mix = expression.match(/^color-mix\(in\s+srgb,\s*(var\(--[\w-]+\)|#[\da-f]{6})\s+(\d+(?:\.\d+)?)%,\s*transparent\)$/i);
  assert.ok(mix, `Unsupported highlight mix: ${expression}`);
  const alpha = Number(mix[2]) / 100;
  assert.ok(alpha >= 0 && alpha <= 1);
  // CSS color-mix uses premultiplied alpha: mixing an opaque sRGB color
  // with transparent preserves that color at the specified opacity. Composite
  // it over the actual ancestor surface before computing WCAG luminance.
  return resolveRGB(mix[1], palette).map((channel, index) => channel * alpha + surface[index] * (1 - alpha));
}

test('WCAG relative luminance and contrast reference values', () => {
  assert.equal(contrast([0, 0, 0], [1, 1, 1]), 21);
  assert.equal(contrast([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]), 1);
  assert.ok(Math.abs(luminance([1, 0, 0]) - 0.2126) < 1e-12);
});

const mark = declarations(searchCSS, '#searchPage :global(mark)');
const result = declarations(searchCSS, '#searchPage :global(.sr-item)');
const resultHover = declarations(searchCSS, '#searchPage :global(.sr-item:hover)');
const tagHover = declarations(searchCSS, '#searchPage :global(.stag:hover)');
const body = declarations(globalCSS, 'body');

test('search highlight preserves its accent 18% background', () => {
  assert.match(mark.background, /^color-mix\(in\s+srgb,\s*var\(--accent\)\s+18%,\s*transparent\)$/);
});

for (const theme of ['light', 'dark']) {
  test(`${theme} search highlights meet 4.5:1 on normal and hover surfaces`, t => {
    const palette = declarations(globalCSS, `html[data-theme="${theme}"]`);
    const normalSurface = result['background-color'] ?? result.background ?? body.background;
    const states = {
      normal: normalSurface,
      'result hover': resultHover['background-color'] ?? resultHover.background,
      'tag hover': tagHover['background-color'] ?? tagHover.background,
    };
    for (const [state, expression] of Object.entries(states)) {
      assert.ok(expression, `Missing ${state} surface`);
      const surface = resolveRGB(expression, palette);
      const background = highlightBackground(mark['background-color'] ?? mark.background, palette, surface);
      const ratio = contrast(resolveRGB(mark.color, palette), background);
      t.diagnostic(`${theme} / ${state}: ${ratio.toFixed(3)}:1`);
      assert.ok(ratio >= 4.5, `${theme} / ${state} contrast ${ratio.toFixed(3)}:1 is below 4.5:1`);
    }
  });
}

test('prose links have a persistent non-color cue without requiring hover or focus', () => {
  const proseLink = declarations(globalCSS, '.prose a');
  const decoration = proseLink['text-decoration-line'] ?? proseLink['text-decoration'];
  assert.ok(decoration?.split(/\s+/).includes('underline'), 'The default .prose a rule must underline links');
});
