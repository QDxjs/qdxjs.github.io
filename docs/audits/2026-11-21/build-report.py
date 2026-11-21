"""Create the Word reading copy and validate report/build structure."""
from pathlib import Path
import json
import re
from docx import Document
from docx.shared import Mm, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from lxml import etree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
NAME = '博客缺陷审查与修复优化方案'
text = (HERE / (NAME + '.md')).read_text(encoding='utf-8')
doc = Document()
section = doc.sections[0]
section.page_height, section.page_width = Mm(297), Mm(210)
section.top_margin = section.bottom_margin = Mm(19)
section.left_margin = section.right_margin = Mm(20)
section.header_distance = section.footer_distance = Mm(9)
for style_name in ['Normal', 'Title', 'Heading 1', 'Heading 2', 'Heading 3', 'List Bullet', 'List Number']:
    style = doc.styles[style_name]
    style.font.name = 'Microsoft YaHei'
    style._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    style.font.size = Pt(10.5)
    style.paragraph_format.line_spacing = 1.25
    style.paragraph_format.space_after = Pt(5)
for style_name, size in [('Title', 21), ('Heading 1', 15), ('Heading 2', 12), ('Heading 3', 11)]:
    s = doc.styles[style_name]
    s.font.size = Pt(size)
    s.font.color.rgb = RGBColor.from_string('263F50')
    s.paragraph_format.space_before = Pt(12)
    s.paragraph_format.keep_with_next = True
footer = section.footer.paragraphs[0]
footer.alignment = 2
footer.add_run('青灯黄卷 · 博客审查  |  ')
f = OxmlElement('w:fldSimple')
f.set(qn('w:instr'), 'PAGE')
footer._p.append(f)
for r in footer.runs:
    r.font.size = Pt(8)

# Use native hyperlinks and runs rather than exposing Markdown punctuation.
pattern = re.compile(r'(\[[^\]]+\]\([^\)]+\)|\*\*[^*]+\*\*|`[^`]+`)')
def inline(p, value):
    for token in pattern.split(value):
        if not token:
            continue
        if token.startswith('[') and '](' in token:
            label, target = token[1:].split('](', 1)
            target = target[:-1]
            h = OxmlElement('w:hyperlink')
            h.set(qn('r:id'), p.part.relate_to(target, RT.HYPERLINK, is_external=True))
            r = OxmlElement('w:r')
            props = OxmlElement('w:rPr')
            color = OxmlElement('w:color'); color.set(qn('w:val'), '22557A'); props.append(color)
            underline = OxmlElement('w:u'); underline.set(qn('w:val'), 'single'); props.append(underline)
            r.append(props)
            t = OxmlElement('w:t'); t.text = label; r.append(t)
            h.append(r); p._p.append(h)
        elif token.startswith('**'):
            p.add_run(token[2:-2]).bold = True
        elif token.startswith('`'):
            r = p.add_run(token[1:-1]); r.font.name = 'Consolas'; r.font.size = Pt(9)
        else:
            p.add_run(token)

def table(lines):
    rows = [[c.strip() for c in line.strip().strip('|').split('|')] for line in lines]
    data = [rows[0]] + rows[2:]
    t = doc.add_table(rows=1, cols=len(data[0]))
    t.style = 'Table Grid'
    t.autofit = True
    for i, row in enumerate(data):
        cells = t.rows[0].cells if i == 0 else t.add_row().cells
        for cell, value in zip(cells, row):
            p = cell.paragraphs[0]
            inline(p, value)
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.space_before = Pt(3)
            for run in p.runs:
                run.font.size = Pt(9)
                if i == 0:
                    run.bold = True
            if i == 0:
                shading = OxmlElement('w:shd'); shading.set(qn('w:fill'), 'EDF2F5')
                cell._tc.get_or_add_tcPr().append(shading)
    repeat = OxmlElement('w:tblHeader')
    t.rows[0]._tr.get_or_add_trPr().append(repeat)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)

lines = text.splitlines()
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1; continue
    if line.startswith('|'):
        block = []
        while i < len(lines) and lines[i].startswith('|'):
            block.append(lines[i]); i += 1
        table(block); continue
    if line.startswith('```'):
        i += 1
        while i < len(lines) and not lines[i].startswith('```'):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            r = p.add_run(lines[i]); r.font.name = 'Consolas'; r.font.size = Pt(8.5)
            i += 1
        i += 1; continue
    h = re.match(r'^(#{1,4}) (.*)', line)
    if h:
        level = len(h[1]) - 1
        p = doc.add_heading('', level=level)
        inline(p, h[2])
    elif line.startswith('- '):
        inline(doc.add_paragraph(style='List Bullet'), line[2:])
    elif re.match(r'^\d+\. ', line):
        inline(doc.add_paragraph(style='List Number'), re.sub(r'^\d+\. ', '', line))
    else:
        inline(doc.add_paragraph(), line.rstrip())
    i += 1
output = HERE / (NAME + '.docx')
doc.core_properties.title = '青灯黄卷博客：缺陷审查与修复优化方案'
doc.core_properties.subject = '本地代码审查、风险分级、修复计划与验收标准'
doc.core_properties.author = ''
doc.save(output)

# Reopen the final DOCX, not merely the in-memory document.
check = Document(output)
all_text = '\n'.join([p.text for p in check.paragraphs] + [c.text for t in check.tables for r in t.rows for c in r.cells])
required = ['1. 结论与审查边界', '2. 已确认缺陷与修复要求', '3. 工程风险与治理方案', '4. 内容、SEO、性能与体验优化', '5. 分阶段实施与回滚', '6. 验收矩阵', '7. 复核方式与文件说明', '8. 外部参考与证据限制', 'D01', 'D02', 'D03', 'D04', 'D05', 'R01', 'R02', 'R03', '4.398:1', '2.363:1', '未修复业务代码']
missing = [v for v in required if v not in all_text]
assert not missing, missing
expected_tables = sum(1 for line in lines if re.match(r'^\|\s*---', line))
assert len(check.tables) == expected_tables == 6, len(check.tables)
assert all(t.rows[0]._tr.trPr.find(qn('w:tblHeader')) is not None for t in check.tables)

parser = etree.XMLParser(resolve_entities=False, no_network=True)
sitemap = etree.parse(str(ROOT / 'dist/sitemap.xml'), parser)
rss = etree.parse(str(ROOT / 'dist/rss.xml'), parser)
ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
locs = sitemap.xpath('//s:url/s:loc/text()', namespaces=ns)
assert len(locs) == 20, len(locs)
assert all(v.startswith('https://qdxjs.github.io/') for v in locs)
assert not any((e.tail or '').strip() for e in sitemap.getroot())
rss_items = rss.xpath('//channel/item')
assert len(rss_items) == 7, len(rss_items)
result = {
    'report': output.name,
    'contentAndStructurePassed': True,
    'paragraphs': len(check.paragraphs),
    'nativeTables': len(check.tables),
    'requiredTextChecks': len(required),
    'missingRequiredText': missing,
    'sitemapXmlParsed': True,
    'sitemapUrls': len(locs),
    'rssXmlParsed': True,
    'rssItems': len(rss_items),
    'docxBytes': output.stat().st_size,
    'visualInspection': 'not performed; content and structure validation only',
}
(HERE / 'document-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, ensure_ascii=False, indent=2))
