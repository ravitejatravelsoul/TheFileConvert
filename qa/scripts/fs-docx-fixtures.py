"""Word -> PDF fixtures (WORD-01 .. WORD-13 plus error cases), made with python-docx so they are
real Word packages written by an independent library (not by our own converter).

    python qa/scripts/fs-docx-fixtures.py        -> qa/fresh-scenario-fixtures/docx/

truth.json records, per fixture, the text in reading order and what the PDF must show.
"""
import io
import json
import os
import random
import shutil
import sys

from docx import Document
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageDraw

OUT = os.path.join("qa", "fresh-scenario-fixtures", "docx")
os.makedirs(OUT, exist_ok=True)
truth = {}


def save(doc, name, texts, expect):
    path = os.path.join(OUT, name)
    doc.core_properties.title = ""
    doc.save(path)
    truth[name] = {"texts": texts, "expect": expect}
    return path


def field(paragraph, instr, placeholder="1"):
    """A complex field (PAGE / NUMPAGES) the way Word writes it."""
    def fld(kind):
        r = OxmlElement("w:r")
        c = OxmlElement("w:fldChar")
        c.set(qn("w:fldCharType"), kind)
        r.append(c)
        return r

    paragraph._p.append(fld("begin"))
    r = OxmlElement("w:r")
    t = OxmlElement("w:instrText")
    t.set(qn("xml:space"), "preserve")
    t.text = f" {instr} "
    r.append(t)
    paragraph._p.append(r)
    paragraph._p.append(fld("separate"))
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = placeholder
    r.append(t)
    paragraph._p.append(r)
    paragraph._p.append(fld("end"))


def hyperlink(paragraph, url, text):
    part = paragraph.part
    rid = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    h = OxmlElement("w:hyperlink")
    h.set(qn("r:id"), rid)
    r = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "0563C1")
    u = OxmlElement("w:u")
    u.set(qn("w:val"), "single")
    rpr.append(color)
    rpr.append(u)
    r.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    r.append(t)
    h.append(r)
    paragraph._p.append(h)


def picture(name, w, h, kind):
    img = Image.new("RGBA" if kind == "png" else "RGB", (w, h), (255, 255, 255, 0) if kind == "png" else (240, 244, 250))
    d = ImageDraw.Draw(img)
    if kind == "png":
        d.ellipse((10, 10, w - 10, h - 10), fill=(46, 125, 50, 255))
        d.rectangle((w // 3, h // 3, 2 * w // 3, 2 * h // 3), fill=(255, 193, 7, 255))
    else:
        for i in range(0, w, 8):
            d.line((i, 0, i, h), fill=(30 + i * 200 // w, 90, 160))
        d.rectangle((w // 4, h // 4, 3 * w // 4, 3 * h // 4), outline=(255, 255, 255), width=6)
    path = os.path.join(OUT, name)
    img.save(path, "PNG" if kind == "png" else "JPEG", quality=90)
    return path


SENTENCES = [
    "The regional office completed the quarterly review on schedule, and every site submitted its figures before the deadline.",
    "Customer response times improved across all three support channels after the new routing rules went live in March.",
    "The committee agreed to publish the revised travel policy once the finance team has confirmed the new mileage rates.",
    "Two warehouse locations will move to the shared inventory system next quarter, which should reduce duplicate orders.",
    "Training sessions for the new reporting dashboard are scheduled for the first week of every month until the end of the year.",
    "Suppliers were asked to confirm delivery windows in writing so that the receiving team can plan staffing in advance.",
]

# ---------------------------------------------------------------- WORD-01 simple paragraphs
doc = Document()
texts = []
for i in range(5):
    t = " ".join(SENTENCES[(i + k) % len(SENTENCES)] for k in range(2))
    doc.add_paragraph(t)
    texts.append(t)
save(doc, "WORD-01-simple.docx", texts, {"pages": [1, 1], "paragraphs": 5})

# ---------------------------------------------------------------- WORD-02 headings
doc = Document()
texts = []
for lvl, title in [(1, "Annual Report 2026"), (2, "Operations"), (3, "Staffing"), (2, "Finance"), (3, "Budget outlook")]:
    doc.add_heading(title, level=lvl)
    texts.append(title)
    doc.add_paragraph(SENTENCES[lvl])
    texts.append(SENTENCES[lvl])
save(doc, "WORD-02-headings.docx", texts, {"pages": [1, 1], "headings": {"Annual Report 2026": 1, "Operations": 2, "Staffing": 3}})

# ---------------------------------------------------------------- WORD-03 formatting
doc = Document()
texts = []
p = doc.add_paragraph()
p.add_run("This sentence has ")
p.add_run("bold words").bold = True
p.add_run(", ")
p.add_run("italic words").italic = True
p.add_run(", ")
r = p.add_run("underlined words")
r.underline = True
p.add_run(" and ")
r = p.add_run("bold italic words")
r.bold = True
r.italic = True
p.add_run(".")
texts.append("This sentence has bold words, italic words, underlined words and bold italic words.")
for size in (8, 12, 16, 24):
    p = doc.add_paragraph()
    r = p.add_run(f"This line is set in {size} point type.")
    r.font.size = Pt(size)
    texts.append(f"This line is set in {size} point type.")
for font in ("Arial", "Times New Roman", "Courier New", "Calibri"):
    p = doc.add_paragraph()
    r = p.add_run(f"The quick brown fox in {font}.")
    r.font.name = font
    texts.append(f"The quick brown fox in {font}.")
p = doc.add_paragraph()
r = p.add_run("Red text")
r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
p.add_run(", ")
r = p.add_run("struck text")
r.font.strike = True
p.add_run(" and E = mc")
r = p.add_run("2")
r.font.superscript = True
p.add_run(".")
texts.append("Red text, struck text and E = mc2.")
save(doc, "WORD-03-formatting.docx", texts, {"pages": [1, 1], "sizes": [8, 12, 16, 24], "fonts": ["Carlito", "LiberationSans", "LiberationSerif", "LiberationMono"], "bold": "bold words", "italic": "italic words", "underline": True, "color": "Red text"})

# ---------------------------------------------------------------- WORD-04 lists
doc = Document()
texts = []
doc.add_paragraph("Packing list")
texts.append("Packing list")
for t in ["Passport and tickets", "Phone charger", "Rain jacket"]:
    doc.add_paragraph(t, style="List Bullet")
    texts.append(t)
for t in ["Spare socks", "Hiking boots"]:
    doc.add_paragraph(t, style="List Bullet 2")
    texts.append(t)
doc.add_paragraph("Party plan")
texts.append("Party plan")
for t in ["Book the venue", "Send the invitations", "Order the food", "Confirm the numbers"]:
    doc.add_paragraph(t, style="List Number")
    texts.append(t)
for t in ["Vegetarian options", "Dessert"]:
    doc.add_paragraph(t, style="List Number 2")
    texts.append(t)
save(doc, "WORD-04-lists.docx", texts, {"pages": [1, 1], "bullets": 5, "numbers": ["1.", "2.", "3.", "4."], "nested": ["Spare socks", "Vegetarian options"]})

# ---------------------------------------------------------------- WORD-05 table
doc = Document()
texts = ["Quarterly sales by region"]
doc.add_paragraph("Quarterly sales by region")
rows = [["Region", "Q1", "Q2", "Q3"], ["North", "$12,400", "$13,100", "$14,250"], ["South", "$9,800", "$10,050", "$11,900"], ["East", "$15,600", "$15,200", "$16,780"], ["West", "$8,450", "$9,300", "$9,975"]]
table = doc.add_table(rows=len(rows), cols=4)
table.style = "Table Grid"
for ri, row in enumerate(rows):
    for ci, v in enumerate(row):
        cell = table.cell(ri, ci)
        cell.text = v
        if ri == 0:
            cell.paragraphs[0].runs[0].bold = True
    texts.extend(row)
doc.add_paragraph("Figures are in US dollars and include all channels.")
texts.append("Figures are in US dollars and include all channels.")
save(doc, "WORD-05-table.docx", texts, {"pages": [1, 1], "table": {"rows": 5, "cols": 4}})

# ---------------------------------------------------------------- WORD-06 images
doc = Document()
texts = []
doc.add_heading("Site photos", level=1)
texts.append("Site photos")
doc.add_paragraph("The first picture shows the new logo on a transparent background.")
texts.append("The first picture shows the new logo on a transparent background.")
doc.add_picture(picture("_logo.png", 400, 300, "png"), width=Inches(3))
doc.add_paragraph("Figure 1: Logo (PNG with transparency).")
texts.append("Figure 1: Logo (PNG with transparency).")
doc.add_paragraph("Customer response times improved after the new layout was installed at the front desk.")
texts.append("Customer response times improved after the new layout was installed at the front desk.")
doc.add_picture(picture("_photo.jpg", 800, 450, "jpg"), width=Inches(4))
doc.add_paragraph("Figure 2: Reception area (JPEG).")
texts.append("Figure 2: Reception area (JPEG).")
save(doc, "WORD-06-images.docx", texts, {"pages": [1, 1], "images": 2, "aspects": [400 / 300, 800 / 450]})

# ---------------------------------------------------------------- WORD-07 page breaks
doc = Document()
texts = []
for i, name in enumerate(["one", "two", "three"]):
    doc.add_heading(f"Page {name}", level=1)
    doc.add_paragraph(f"This text belongs on page {name}.")
    texts += [f"Page {name}", f"This text belongs on page {name}."]
    if i < 2:
        doc.add_page_break()
save(doc, "WORD-07-page-breaks.docx", texts, {"pages": [3, 3], "perPage": ["page one", "page two", "page three"]})

# ---------------------------------------------------------------- WORD-08 special characters
doc = Document()
lines = [
    "Prices: €120.50, £99.99, ₹1,250 and ¥3,000.",
    "Marks: ✓ done, ™ brand, © 2026, ® registered.",
    "Quotes: “double”, ‘single’, dashes – and — and an ellipsis…",
    "Accents: niño, café, Zürich, Łódź, crème brûlée, São Paulo.",
    "Greek: Ελληνικά — Cyrillic: Русский язык.",
    "Maths: ½ + ¼ ≈ 0.75, x ≤ 5, a → b, 90°.",
]
for t in lines:
    doc.add_paragraph(t)
save(doc, "WORD-08-special-characters.docx", lines, {"pages": [1, 1], "chars": ["€", "£", "₹", "✓", "™", "©", "“", "”", "‘", "’", "–", "—", "…", "ñ", "é", "ü", "Ł", "ź", "Ελληνικά", "Русский", "½", "≈", "≤", "→", "°"]})

# ---------------------------------------------------------------- WORD-09 alignment
doc = Document()
texts = []
for align, label in [(WD_ALIGN_PARAGRAPH.LEFT, "left"), (WD_ALIGN_PARAGRAPH.CENTER, "center"), (WD_ALIGN_PARAGRAPH.RIGHT, "right")]:
    p = doc.add_paragraph(f"This short line is aligned {label}.")
    p.alignment = align
    texts.append(f"This short line is aligned {label}.")
p = doc.add_paragraph(" ".join(SENTENCES[:3]))
p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
texts.append(" ".join(SENTENCES[:3]))
sec = doc.sections[0]
margins = [sec.left_margin.pt, sec.right_margin.pt]
save(doc, "WORD-09-alignment.docx", texts, {"pages": [1, 1], "margins": margins, "align": {"This short line is aligned left.": "left", "This short line is aligned center.": "center", "This short line is aligned right.": "right"}, "justified": SENTENCES[0][:40]})

# ---------------------------------------------------------------- WORD-10 header / footer
doc = Document()
texts = []
sec = doc.sections[0]
sec.header.paragraphs[0].text = "ACME Corporation — Confidential"
fp = sec.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
fp.add_run("Page ")
field(fp, "PAGE")
fp.add_run(" of ")
field(fp, "NUMPAGES")
for i in range(3):
    doc.add_heading(f"Chapter {i + 1}", level=1)
    texts.append(f"Chapter {i + 1}")
    for s in SENTENCES[:4]:
        doc.add_paragraph(s)
        texts.append(s)
    if i < 2:
        doc.add_page_break()
save(doc, "WORD-10-header-footer.docx", texts, {"pages": [3, 3], "header": "ACME Corporation — Confidential", "footer": "Page {n} of {total}"})

# ---------------------------------------------------------------- WORD-11 multipage (20+ pages)
doc = Document()
texts = []
rnd = random.Random(7)
for ch in range(1, 19):
    doc.add_heading(f"Section {ch}: Operating notes", level=1)
    texts.append(f"Section {ch}: Operating notes")
    for k in range(10):
        t = " ".join(rnd.choice(SENTENCES) for _ in range(3))
        doc.add_paragraph(t)
        texts.append(t)
    doc.add_heading(f"Summary {ch}", level=2)
    texts.append(f"Summary {ch}")
    for t in ["Review the figures", "Confirm the schedule", "Share the notes"]:
        doc.add_paragraph(f"{t} for section {ch}", style="List Bullet")
        texts.append(f"{t} for section {ch}")
save(doc, "WORD-11-multipage.docx", texts, {"pages": [20, 45], "bookmarks": 36})

# ---------------------------------------------------------------- WORD-12 complex
doc = Document()
texts = []
sec = doc.sections[0]
sec.header.paragraphs[0].text = "Project Falcon — Status Report"
fp = sec.footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
fp.add_run("Page ")
field(fp, "PAGE")
doc.add_heading("Project Falcon status report", level=0)
texts.append("Project Falcon status report")
p = doc.add_paragraph()
p.paragraph_format.tab_stops.add_tab_stop(Inches(6.0), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
p.add_run("Prepared by the operations team")
p.add_run("\t")
p.add_run("March 2026")
texts.append("Prepared by the operations team March 2026")
doc.add_heading("1. Highlights", level=1)
texts.append("1. Highlights")
p = doc.add_paragraph()
p.add_run("The rollout reached ")
p.add_run("94% of sites").bold = True
p.add_run(" on schedule. See the ")
hyperlink(p, "https://example.com/falcon", "project dashboard")
p.add_run(" for live numbers.")
texts.append("The rollout reached 94% of sites on schedule. See the project dashboard for live numbers.")
for t in ["Warehouse migration finished early", "Two regional offices joined the pilot", "Support backlog cut by a third"]:
    doc.add_paragraph(t, style="List Bullet")
    texts.append(t)
doc.add_heading("2. Budget", level=1)
texts.append("2. Budget")
table = doc.add_table(rows=4, cols=3)
table.style = "Table Grid"
data = [["Item", "Planned", "Actual"], ["Hardware", "$40,000", "$38,200"], ["Training", "$12,000", "$13,450"], ["Total", "$52,000", "$51,650"]]
for ri, row in enumerate(data):
    for ci, v in enumerate(row):
        table.cell(ri, ci).text = v
        if ri in (0, 3):
            table.cell(ri, ci).paragraphs[0].runs[0].bold = True
    texts.extend(row)
doc.add_heading("3. Next steps", level=1)
texts.append("3. Next steps")
for t in ["Finish the security review", "Train the remaining site leads", "Publish the final report"]:
    doc.add_paragraph(t, style="List Number")
    texts.append(t)
doc.add_picture(picture("_chart.png", 600, 300, "png"), width=Inches(4.5))
doc.add_paragraph("Figure 1: Rollout progress by month.").alignment = WD_ALIGN_PARAGRAPH.CENTER
texts.append("Figure 1: Rollout progress by month.")
# A landscape appendix in its own section.
new = doc.add_section(WD_SECTION.NEW_PAGE)
new.orientation = WD_ORIENT.LANDSCAPE
new.page_width, new.page_height = new.page_height, new.page_width
doc.add_heading("Appendix: site list", level=1)
texts.append("Appendix: site list")
for s in SENTENCES[:3]:
    doc.add_paragraph(s)
    texts.append(s)
save(doc, "WORD-12-complex.docx", texts, {"pages": [2, 3], "images": 1, "links": ["https://example.com/falcon"], "landscapeLast": True, "header": "Project Falcon — Status Report", "leader": True})

# ---------------------------------------------------------------- WORD-15 photo-heavy (journey: Word -> PDF -> compress under 1 MB)
doc = Document()
texts = []
doc.add_heading("Site inspection photos", level=1)
texts.append("Site inspection photos")
rnd2 = random.Random(3)
for k in range(3):
    img = Image.effect_noise((1800, 1200), 60).convert("RGB")
    d = ImageDraw.Draw(img)
    for _ in range(40):
        x, y = rnd2.randrange(1800), rnd2.randrange(1200)
        d.ellipse((x, y, x + rnd2.randrange(40, 300), y + rnd2.randrange(40, 300)), fill=(rnd2.randrange(256), rnd2.randrange(256), rnd2.randrange(256)))
    path = os.path.join(OUT, f"_p{k}.jpg")
    img.save(path, "JPEG", quality=92)
    doc.add_picture(path, width=Inches(6))
    t = f"Photo {k + 1}: north wall, level {k + 1}."
    doc.add_paragraph(t)
    texts.append(t)
save(doc, "WORD-15-photos.docx", texts, {"pages": [2, 3], "images": 3})

# ---------------------------------------------------------------- WORD-13 corrupt (truncated)
src = open(os.path.join(OUT, "WORD-01-simple.docx"), "rb").read()
open(os.path.join(OUT, "WORD-13-corrupt.docx"), "wb").write(src[: int(len(src) * 0.6)])
truth["WORD-13-corrupt.docx"] = {"texts": [], "expect": {"error": "couldn't be read"}}

# ---------------------------------------------------------------- error cases
open(os.path.join(OUT, "X-zero-byte.docx"), "wb").close()
truth["X-zero-byte.docx"] = {"texts": [], "expect": {"error": "is empty"}}
open(os.path.join(OUT, "X-fake.docx"), "w", encoding="utf8").write("This is a plain text file with a .docx name.")
truth["X-fake.docx"] = {"texts": [], "expect": {"error": "isn't a Word document"}}
# An OLE compound file header, like a Word 97-2003 .doc.
ole = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + bytes(504) + b"WordDocument".ljust(4096, b"\0")
open(os.path.join(OUT, "X-legacy.doc"), "wb").write(ole)
truth["X-legacy.doc"] = {"texts": [], "expect": {"error": "Word 97–2003"}}
try:
    import msoffcrypto.format.ooxml

    with open(os.path.join(OUT, "WORD-01-simple.docx"), "rb") as f:
        of = msoffcrypto.format.ooxml.OOXMLFile(f)
        with open(os.path.join(OUT, "X-encrypted.docx"), "wb") as out:
            of.encrypt("secret123", out)
    truth["X-encrypted.docx"] = {"texts": [], "expect": {"error": "password-protected"}}
except Exception as e:  # noqa: BLE001
    print("encrypted fixture skipped:", e, file=sys.stderr)
# A spreadsheet package renamed .docx.
buf = io.BytesIO()
import zipfile

with zipfile.ZipFile(buf, "w") as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    z.writestr("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')
open(os.path.join(OUT, "X-spreadsheet.docx"), "wb").write(buf.getvalue())
truth["X-spreadsheet.docx"] = {"texts": [], "expect": {"error": "isn't a Word document"}}

# ---------------------------------------------------------------- WORD-14: a .docx made by our own PDF -> Word converter
made = os.path.join("qa", "evidence", "fresh", "out", "word-PDFWORD03-PDF-WORD-03-headings.docx")
if os.path.exists(made):
    shutil.copy(made, os.path.join(OUT, "WORD-14-from-pdf-to-word.docx"))
    word_truth = json.load(open(os.path.join("qa", "fresh-scenario-fixtures", "word", "truth.json"), encoding="utf8"))
    entry = next(e for e in word_truth if e["file"] == "PDF-WORD-03-headings.pdf")
    truth["WORD-14-from-pdf-to-word.docx"] = {"texts": [b["text"] for b in entry["blocks"]], "expect": {"pages": [1, 1]}}

for f in os.listdir(OUT):
    if f.startswith("_"):
        os.remove(os.path.join(OUT, f))
json.dump(truth, open(os.path.join(OUT, "truth.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
print("\n".join(sorted(truth)))
