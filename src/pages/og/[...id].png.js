import { getAllEntries, displayTitle, sectionLabels } from '../../content-utils';
import { site } from '../../config';
import { socialCard } from '../../../scripts/social-card.mjs';

export async function getStaticPaths() {
  const entries = await getAllEntries();
  return [
    { params: { id: 'default' }, props: { title: site.name, label: '阅读 · 记录 · 创作' } },
    ...entries.map(entry => ({
      params: { id: `${entry.collection}/${entry.id}` },
      props: {
        title: displayTitle(entry.data.title, entry.data.demo),
        label: `${sectionLabels[entry.collection]}${entry.data.date ? ' · ' + entry.data.date : ''}${entry.data.demo ? ' · 演示内容' : ''}`,
      },
    })),
  ];
}
export async function GET({ props }) {
  const buffer = await socialCard({ ...props, siteName: site.name });
  return new Response(buffer, { headers: { 'Content-Type': 'image/png' } });
}
