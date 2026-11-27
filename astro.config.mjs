import { defineConfig } from 'astro/config';
import { satteri } from '@astrojs/markdown-satteri';
import responsiveImages from './scripts/rehype-responsive-images.mjs';

export default defineConfig({
  site: process.env.SITE_URL || 'https://qdxjs.github.io',
  base: '/',
  markdown: {
    processor: satteri({ hastPlugins: [responsiveImages()] }),
    shikiConfig: {
      themes: { light: 'github-light-default', dark: 'github-dark-default' },
      defaultColor: false,
    },
  },
});
