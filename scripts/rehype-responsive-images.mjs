import fs from 'node:fs';
import { createHash } from 'node:crypto';

const defaultManifestURL = new URL('../.generated/images.json', import.meta.url);
// Native Sätteri HAST visitor: preserve Astro 7's Markdown parser and code output.
export default function responsiveImages(manifestURL = defaultManifestURL) {
  const manifestText = fs.existsSync(manifestURL) ? fs.readFileSync(manifestURL, 'utf8') : null;
  const images = manifestText ? JSON.parse(manifestText) : null;
  // Astro serializes processor options to invalidate its rendered Markdown cache.
  // Include external image data in that key; bump v1 when transformation rules change.
  const digest = createHash('sha256').update(manifestText || 'missing').digest('hex').slice(0, 16);
  return {
    name: `responsive-public-images-v1-${digest}`,
    element: {
      filter: ['img'],
      visit(node) {
        const src = node.properties?.src;
        if (typeof src !== 'string' || !src.startsWith('/images/')) return;
        if (!images) throw new Error('Image manifest missing. Run npm run prepare:assets before Astro.');
        const image = images[decodeURI(src)];
        if (!image) return;
        const sources = ['avif', 'webp'].map(format => ({
          type: 'element', tagName: 'source', children: [],
          properties: {
            type: `image/${format}`,
            srcSet: image[format].map(variant => `${variant.src} ${variant.width}w`).join(', '),
            sizes: '(max-width: 680px) calc(100vw - 3rem), 672px',
          },
        }));
        return {
          type: 'element', tagName: 'picture', properties: {},
          children: [...sources, {
            type: 'element', tagName: 'img', children: [],
            properties: { ...node.properties, width: image.width, height: image.height, loading: node.properties.loading || 'lazy', decoding: 'async' },
          }],
        };
      },
    },
  };
}
