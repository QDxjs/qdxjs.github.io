import path from 'node:path';
import fs from 'node:fs';
import { create } from 'fontkit';
import sharp from 'sharp';

let font, latin;
function getFont(character) {
  font ||= create(fs.readFileSync(path.resolve('node_modules/@fontsource/ma-shan-zheng/files/ma-shan-zheng-chinese-simplified-400-normal.woff')));
  if (font.hasGlyphForCodePoint(character.codePointAt(0))) return font;
  latin ||= create(fs.readFileSync(path.resolve('node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff')));
  if (!latin.hasGlyphForCodePoint(character.codePointAt(0))) throw new Error(`Share card font lacks character: ${character}`);
  return latin;
}
const escape = value => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function textPaths(text, size, x, baseline, color) {
  let cursor = x;
  return Array.from(text).map(character => {
    const font = getFont(character);
    const scale = size / font.unitsPerEm;
    const run = font.layout(character);
    return run.glyphs.map((glyph, index) => {
      const position = run.positions[index];
      const element = `<path d="${escape(glyph.path.toSVG())}" transform="translate(${cursor + position.xOffset * scale} ${baseline - position.yOffset * scale}) scale(${scale} ${-scale})" fill="${color}"/>`;
      cursor += position.xAdvance * scale;
      return element;
    }).join('');
  }).join('');
}
function wrap(text, limit) {
  const chars = Array.from(text);
  const lines = [];
  while (chars.length && lines.length < 3) lines.push(chars.splice(0, limit).join(''));
  if (chars.length) lines[2] = Array.from(lines[2]).slice(0, limit - 1).join('') + '…';
  return lines;
}
export async function socialCard({ title, label, siteName }) {
  const lines = wrap(title, 15);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4EFE3"/><rect x="26" y="26" width="1148" height="578" rx="4" fill="#FBF7EC" stroke="#D9CFB8" stroke-width="2"/>
  <path d="M76 142H1124M76 506H1124" stroke="#D9CFB8" stroke-width="2"/><rect x="76" y="77" width="7" height="44" fill="#A23A2E"/>
  ${textPaths(siteName, 38, 103, 113, '#A23A2E')}
  ${lines.map((line, i) => textPaths(line, 68, 76, 252 + i * 84, '#2A2520')).join('')}
  ${textPaths(label, 29, 76, 560, '#6F6657')}
  <path d="M1062 537h58v38h-58z" fill="none" stroke="#A23A2E" stroke-width="3"/>
  ${textPaths('青灯', 24, 1067, 565, '#A23A2E')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
