"""Rebuild the independent OOXML regression fixture with openpyxl."""
from datetime import datetime
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Color, Font, PatternFill, Side

book = Workbook()
book.properties.created = book.properties.modified = datetime(2026, 1, 1)
sheet = book.active
sheet.title = "样式示例"
sheet["A1"] = "报表标题"
sheet["A1"].font = Font(name="Arial", size=18, bold=True, color="FFFFFF")
sheet["A1"].fill = PatternFill("solid", fgColor="334455")
sheet["A1"].alignment = Alignment(horizontal="center", vertical="center")
sheet.column_dimensions["A"].width = 22
sheet.row_dimensions[1].height = 30
sheet.merge_cells("B2:D5")
sheet["B2"] = "跨视口合并标题"
sheet["B2"].alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
sheet["B2"].fill = PatternFill("solid", fgColor="DDEEFF")
edge = Side(style="thin", color="112233")
sheet["B2"].border = Border(left=edge, right=edge, top=edge, bottom=edge)
sheet.merge_cells("E2:F4")
sheet["E2"].fill = PatternFill("solid", fgColor="AAFFAA")
sheet["E2"].border = Border(left=edge, right=edge, top=edge, bottom=edge)
sheet["G2"] = "两行\n文字"
sheet["G2"].font = Font(italic=True, underline="single", color="880000")
sheet["G2"].alignment = Alignment(horizontal="right", vertical="center", wrap_text=True)
sheet["G2"].border = Border(bottom=Side(style="double", color="00AA00"))
sheet["J2"].fill = PatternFill("solid", fgColor="FFA500")
sheet["D7"] = 1234.5
sheet["D7"].number_format = '"$"#,##0.00'
sheet["A8"] = "00042"
sheet["B8"] = "<img src=x onerror=alert(1)>"
sheet["A9"] = "主题底色"
sheet["A9"].fill = PatternFill("solid", fgColor=Color(theme=4, tint=0.4))
sheet.row_dimensions[10].hidden = True
sheet.column_dimensions["H"].hidden = True
book.create_sheet("另一页")["A1"] = "第二个工作表"
buffer = BytesIO()
book.save(buffer)
target = Path(__file__).with_name("styled-workbook.xlsx")
with ZipFile(buffer) as source, ZipFile(target, "w", ZIP_DEFLATED) as output:
    for name in sorted(source.namelist()):
        info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        output.writestr(info, source.read(name))
