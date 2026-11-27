import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { satteri } from '@astrojs/markdown-satteri';
import responsiveImages from '../scripts/rehype-responsive-images.mjs';

const source = '/images/示例.jpg';
const image = { width: 1000, height: 750, avif: [{ src: '/images/generated/old.avif', width: 768 }], webp: [{ src: '/images/generated/old.webp', width: 768 }] };
const node = { type: 'element', tagName: 'img', properties: { src: encodeURI(source), alt: '图片说明', title: '原图' }, children: [] };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qingdeng-images-'));
  const manifest = path.join(directory, 'images.json');
  fs.writeFileSync(manifest, JSON.stringify({ [source]: image }));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return manifest;
}

test('responsive image output keeps original fallback and metadata while reserving its aspect ratio', t => {
  const output = responsiveImages(fixture(t)).element.visit(node);
  assert.equal(output.tagName, 'picture');
  assert.deepEqual(output.children.slice(0, 2).map(child => [child.properties.type, child.properties.srcSet]), [
    ['image/avif', '/images/generated/old.avif 768w'], ['image/webp', '/images/generated/old.webp 768w'],
  ]);
  assert.deepEqual(output.children[2].properties, { ...node.properties, width: 1000, height: 750, loading: 'lazy', decoding: 'async' });
  assert.equal(node.properties.width, undefined);
});

test('replacing only image manifest data invalidates serialized Astro processor options and updates rendered sources', t => {
  const manifest = fixture(t);
  const previous = responsiveImages(manifest);
  const serialize = plugin => JSON.stringify(satteri({ hastPlugins: [plugin] }));
  fs.writeFileSync(manifest, JSON.stringify({ [source]: { ...image, avif: [{ src: '/images/generated/new.avif', width: 768 }] } }));
  const current = responsiveImages(manifest);
  assert.notEqual(serialize(previous), serialize(current));
  assert.equal(current.element.visit(node).children[0].properties.srcSet, '/images/generated/new.avif 768w');
  assert.equal(previous.element.visit(node).children[0].properties.srcSet, '/images/generated/old.avif 768w');
});

test('unknown images remain intact and an unprepared local image gives an actionable build error', t => {
  const manifest = fixture(t);
  const plugin = responsiveImages(manifest);
  assert.equal(plugin.element.visit({ ...node, properties: { src: 'https://example.com/photo.jpg' } }), undefined);
  assert.equal(plugin.element.visit({ ...node, properties: { src: '/images/unknown.jpg' } }), undefined);
  fs.unlinkSync(manifest);
  assert.throws(() => responsiveImages(manifest).element.visit(node), /npm run prepare:assets/);
});
