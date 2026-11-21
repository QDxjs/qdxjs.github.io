// One-off, narrow migration from the audited Astro 4 content API.
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const config = `${root}src/content/config.ts`;
let text = readFileSync(config, 'utf8');
text = text.replace("import { defineCollection, z } from 'astro:content';", "import { defineCollection } from 'astro:content';\nimport { z } from 'astro/zod';\nimport { glob } from 'astro/loaders';");
for (const section of ['notes', 'essays', 'works']) {
  text = text.replace(`const ${section} = defineCollection({\n  type: 'content',`, `const ${section} = defineCollection({\n  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/${section}' }),`);
}
writeFileSync(config, text);
renameSync(config, `${root}src/content.config.ts`);
for (const section of ['notes', 'essays', 'works']) {
  const file = `${root}src/pages/${section}/[...slug].astro`;
  text = readFileSync(file, 'utf8')
    .replace("import type { CollectionEntry } from 'astro:content';", "import { render, type CollectionEntry } from 'astro:content';")
    .replace('slug: item.slug', 'slug: item.id')
    .replace('await item.render()', 'await render(item)');
  writeFileSync(file, text);
}
const utils = `${root}src/content-utils.ts`;
text = readFileSync(utils, 'utf8').replaceAll('a.slug', 'a.id').replaceAll('b.slug', 'b.id').replaceAll('entry.slug', 'entry.id');
writeFileSync(utils, text);
console.log('Migrated collection loaders, route IDs, and rendering API.');
