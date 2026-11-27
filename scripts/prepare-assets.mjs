import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const images = path.join(root, 'public/images');
const generated = path.join(images, 'generated');
await fs.mkdir(generated, { recursive: true });
await fs.mkdir(path.join(root, '.generated'), { recursive: true });
async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const groups = await Promise.all(entries.filter(e => e.name !== 'generated').map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : path.join(dir, e.name)));
  return groups.flat();
}
const manifest = {};
for (const file of (await walk(images)).filter(file => /\.(jpe?g|png)$/i.test(file))) {
  const input = await fs.readFile(file);
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Image dimensions missing: ${file}`);
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const digest = createHash('sha256').update(input).update('responsive-v1').digest('hex').slice(0, 16);
  const widths = [...new Set([480, 768, 1200, 1600, Math.min(width, 1600)].filter(size => size <= width))].sort((a, b) => a - b);
  const variants = { avif: [], webp: [] };
  for (const size of widths) {
    for (const format of ['avif', 'webp']) {
      const name = `${digest}-${size}.${format}`;
      const output = path.join(generated, name);
      try { await fs.access(output); }
      catch { await sharp(input).rotate().resize({ width: size, withoutEnlargement: true })[format]({ quality: format === 'avif' ? 55 : 82 }).toFile(output); }
      variants[format].push({ src: `/images/generated/${name}`, width: size, bytes: (await fs.stat(output)).size });
    }
  }
  const url = '/' + path.relative(path.join(root, 'public'), file).split(path.sep).join('/');
  manifest[url] = { width, height, originalBytes: input.length, ...variants };
}
await fs.writeFile(path.join(root, '.generated/images.json'), JSON.stringify(manifest, null, 2) + '\n');
// Keep the licenses beside the third-party assets redistributed by the build.
await fs.mkdir(path.join(root, 'public/licenses'), { recursive: true });
for (const [name, packageName] of [['noto-serif-sc', '@fontsource-variable/noto-serif-sc'], ['ma-shan-zheng', '@fontsource/ma-shan-zheng'], ['cormorant-garamond', '@fontsource/cormorant-garamond'], ['lunar-javascript', 'lunar-javascript']]) {
  await fs.copyFile(path.join(root, 'node_modules', packageName, 'LICENSE'), path.join(root, 'public/licenses', `${name}.txt`));
}
const favicon = await fs.readFile(path.join(root, 'public/favicon.svg'));
for (const [name, size] of [['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512]]) {
  await sharp(favicon).resize(size, size).png().toFile(path.join(root, 'public', `${name}.png`));
}
const iconPNG = await sharp(favicon).resize(32, 32).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 32; ico[7] = 32;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(iconPNG.length, 14); ico.writeUInt32LE(22, 18);
await fs.writeFile(path.join(root, 'public/favicon.ico'), Buffer.concat([ico, iconPNG]));
console.log(`Prepared ${Object.keys(manifest).length} local images with AVIF/WebP variants and site icons.`);
