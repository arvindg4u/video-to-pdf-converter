"""Optional post-test PDF inspection: pip install pymupdf; python tests/inspect-print-pdfs.py.
Reads Chromium test output only. Never used by the production converter.
"""
from pathlib import Path
import json
import pymupdf

names = {'A4-Study.pdf', 'A4-Revision.pdf', 'Letter-Study.pdf', 'Letter-Revision.pdf', 'single-header-no-backgrounds.pdf'}
reports = []
for path in sorted(Path('test-results').rglob('*.pdf')):
    if path.name not in names:
        continue
    doc = pymupdf.open(path)
    single = path.name.startswith('single-header')
    for index, page in enumerate(doc):
        # Furniture occupies the page margins, away from the content rectangle.
        footer = page.get_text(clip=pymupdf.Rect(0, page.rect.height - 40, page.rect.width, page.rect.height))
        assert str(index + 1) in footer.split(), (path, index + 1, 'missing page counter')
        header = page.get_text(clip=pymupdf.Rect(0, 0, page.rect.width, 35)).strip()
        assert ('Indian Polity' in header) if single else not header, (path, index + 1, 'running header')
        for block in page.get_text('blocks'):
            assert block[0] >= 43 and block[2] <= page.rect.width - 43, (path, index + 1, 'horizontal overflow', block[:4])
        for image in page.get_image_info():
            x0, y0, x1, y1 = image['bbox']
            assert x0 >= 43 and x1 <= page.rect.width - 43, (path, index + 1, 'image width')
            assert y0 >= 43 and y1 <= page.rect.height - 49, (path, index + 1, 'image height')
            assert y1 - y0 <= 210 * 72 / 25.4 + 1, (path, 'image exceeds 210mm')
        text = page.get_text()
        assert len(text.split()) > (3 if single else 1), (path, index + 1, 'blank content page')
        if 'A useful explanation of constitutional law.' in text:
            assert 'Table header' in text, (path, index + 1, 'missing repeated table header')
    all_text = '\n'.join(page.get_text() for page in doc)
    if not single:
        assert len(doc.resolve_names()) >= 301, (path, 'missing TOC destinations')
        for link in doc[0].get_links():
            assert 0 <= link.get('page', -1) < len(doc), (path, 'unresolved TOC link')
        assert 'भारतीय' in all_text, (path, 'Hindi missing')
        assert 'This sentence must be printed' in all_text, (path, 'disclosure missing')
        for row in range(100):
            assert f'Row {row}\n' in all_text, (path, row, 'missing table row')
    else:
        assert 'Always include this in the PDF.' in all_text
    reports.append({'file': str(path), 'pages': len(doc), 'size_pt': list(doc[0].rect), 'title': doc.metadata['title'], 'all_page_counters': True, 'headers_correct': True, 'text_inside_horizontal_margins': True})
assert len(reports) == 5, 'Run tests/browser/print-quality.spec.js first (all five PDFs required).'
print(json.dumps(reports, indent=2, ensure_ascii=False))
