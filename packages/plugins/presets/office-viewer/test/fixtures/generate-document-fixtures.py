"""Rebuild test documents with python-docx and python-pptx; not needed by CI."""
from pathlib import Path
from docx import Document
from docx.shared import RGBColor, Pt
from pptx import Presentation

out = Path(__file__).resolve().parent
doc = Document()
run = doc.add_paragraph().add_run('Document preview sample')
run.bold = True
run.font.size = Pt(18)
run.font.color.rgb = RGBColor(0x22, 0x44, 0x66)
table = doc.add_table(rows=2, cols=2)
table.cell(0, 0).merge(table.cell(0, 1)).text = 'Merged document table'
table.cell(1, 0).text = '42'
table.cell(1, 1).text = 'Data remains readable'
doc.save(out / 'formatted-document.docx')
doc = Document()
doc.add_paragraph('Second document selected')
doc.save(out / 'second-document.docx')
presentation = Presentation()
for title in ['First slide sample', 'Second slide sample']:
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = title
    slide.placeholders[1].text = 'Presentation preview sample'
presentation.save(out / 'two-slides.pptx')

# A valid, small PDF with a predefined Adobe CJK map and no embedded font.
content = b'BT /F1 24 Tf 50 750 Td <' + '中文预览'.encode('utf-16-be').hex().encode() + b'> Tj ET'
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    b'<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>',
    b'<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 6 0 R /DW 1000 >>',
    b'<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>',
    b'<< /Length ' + str(len(content)).encode() + b' >>\nstream\n' + content + b'\nendstream',
]
body = bytearray(b'%PDF-1.4\n')
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(body))
    body += str(index).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
xref = len(body)
body += b'xref\n0 8\n0000000000 65535 f \n'
for offset in offsets[1:]:
    body += f'{offset:010d} 00000 n \n'.encode()
body += b'trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n' + str(xref).encode() + b'\n%%EOF\n'
(out / 'cjk-document.pdf').write_bytes(body)
