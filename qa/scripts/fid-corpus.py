"""Realistic document corpus for the fidelity audit.

    python qa/scripts/fid-corpus.py            -> qa/fidelity/corpus/*.docx

Each .docx is written with python-docx (an independent writer) and styled like the real thing — a resume,
an invoice, a business letter, a bank statement, an application form, a university transcript, a brochure,
a two-column report, a table-heavy report, an image-heavy document, a formatting sampler and a long report.
qa/scripts/fid-run.mjs turns each into a realistic PDF with LibreOffice (as a word processor would) for the
PDF -> Word direction, and uses the .docx itself for Word -> PDF.
"""
import os
import random

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join("qa", "fidelity", "corpus")
TMP = os.path.join(OUT, "_img")
os.makedirs(TMP, exist_ok=True)
rnd = random.Random(11)


# ------------------------------------------------------------------ helpers

def base(font="Calibri", size=11, margins=1.0):
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = font
    st.font.size = Pt(size)
    rpr = st.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        rfonts.set(qn(a), font)
    pf = st.paragraph_format
    pf.space_after = Pt(6)
    pf.space_before = Pt(0)
    pf.line_spacing = 1.08
    for s in doc.sections:
        s.left_margin = s.right_margin = s.top_margin = s.bottom_margin = Inches(margins)
    for lvl in (1, 2, 3):
        h = doc.styles[f"Heading {lvl}"]
        h.font.name = font
        hr = h.element.get_or_add_rPr().find(qn("w:rFonts"))
        if hr is not None:
            for a in list(hr.attrib):
                del hr.attrib[a]
            for a in ("w:ascii", "w:hAnsi", "w:cs"):
                hr.set(qn(a), font)
    return doc


def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def borders(table, sz=4, color="808080", inside=True):
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    edges = ["top", "left", "bottom", "right"] + (["insideH", "insideV"] if inside else [])
    for e in edges:
        el = OxmlElement(f"w:{e}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(sz))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        b.append(el)
    tblPr.append(b)


def no_borders(table):
    tblPr = table._tbl.tblPr
    b = OxmlElement("w:tblBorders")
    for e in ["top", "left", "bottom", "right", "insideH", "insideV"]:
        el = OxmlElement(f"w:{e}")
        el.set(qn("w:val"), "nil")
        b.append(el)
    tblPr.append(b)


def widths(table, inches):
    # Word sizes columns from the cells' widths, LibreOffice from the table grid: set both so the
    # fixture means the same thing to either.
    for col, w in zip(table._tbl.tblGrid.findall(qn("w:gridCol")), inches):
        col.set(qn("w:w"), str(int(round(w * 1440))))
    for row in table.rows:
        for i, w in enumerate(inches):
            row.cells[i].width = Inches(w)


def bottom_rule(paragraph, color="2F5496", sz=8):
    pPr = paragraph._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    b.set(qn("w:val"), "single")
    b.set(qn("w:sz"), str(sz))
    b.set(qn("w:space"), "1")
    b.set(qn("w:color"), color)
    bdr.append(b)
    pPr.append(bdr)


def run(p, text, bold=False, italic=False, underline=False, size=None, color=None, font=None):
    r = p.add_run(text)
    r.bold = bold
    r.italic = italic
    r.underline = underline
    if size:
        r.font.size = Pt(size)
    if color:
        r.font.color.rgb = RGBColor.from_string(color)
    if font:
        r.font.name = font
        r._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:hAnsi"), font)
    return r


def para(doc, text="", align=None, space_after=None, space_before=None, **kw):
    p = doc.add_paragraph()
    if text:
        run(p, text, **kw)
    if align is not None:
        p.alignment = align
    if space_after is not None:
        p.paragraph_format.space_after = Pt(space_after)
    if space_before is not None:
        p.paragraph_format.space_before = Pt(space_before)
    return p


def field(p, instr):
    def fld(kind):
        r = OxmlElement("w:r")
        c = OxmlElement("w:fldChar")
        c.set(qn("w:fldCharType"), kind)
        r.append(c)
        return r

    p._p.append(fld("begin"))
    r = OxmlElement("w:r")
    t = OxmlElement("w:instrText")
    t.set(qn("xml:space"), "preserve")
    t.text = f" {instr} "
    r.append(t)
    p._p.append(r)
    p._p.append(fld("separate"))
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    r.append(t)
    p._p.append(r)
    p._p.append(fld("end"))


def page_footer(section, text="Page ", total=True, align=WD_ALIGN_PARAGRAPH.CENTER, size=9):
    p = section.footer.paragraphs[0]
    p.alignment = align
    run(p, text, size=size, color="595959")
    field(p, "PAGE")
    if total:
        run(p, " of ", size=size, color="595959")
        field(p, "NUMPAGES")


def break_on_last_paragraph(doc):
    # python-docx ends the previous section with an extra empty paragraph that carries only the break;
    # Word puts the break on the last paragraph itself (renderers disagree about the empty one's height).
    holder = doc.paragraphs[-1]._p
    ppr = holder.find(qn("w:pPr"))
    sect = ppr.find(qn("w:sectPr")) if ppr is not None else None
    prev = holder.getprevious()
    if sect is None or holder.findall(qn("w:r")) or prev is None or prev.tag != qn("w:p"):
        return
    pp = prev.find(qn("w:pPr"))
    if pp is None:
        pp = OxmlElement("w:pPr")
        prev.insert(0, pp)
    pp.append(sect)
    holder.getparent().remove(holder)


def columns(section, num=2, space_in=0.35):
    sectPr = section._sectPr
    cols = sectPr.find(qn("w:cols"))
    if cols is None:
        cols = OxmlElement("w:cols")
        sectPr.append(cols)
    cols.set(qn("w:num"), str(num))
    cols.set(qn("w:space"), str(int(space_in * 1440)))


def picture(name, w, h, kind="photo", label=None):
    path = os.path.join(TMP, name)
    if kind == "logo":
        img = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((0, 0, h, h), radius=h // 5, fill=(31, 78, 121, 255))
        d.polygon([(h * 0.25, h * 0.7), (h * 0.5, h * 0.25), (h * 0.75, h * 0.7)], fill=(255, 192, 0, 255))
        if label:
            try:
                f = ImageFont.truetype("arialbd.ttf", int(h * 0.42))
            except OSError:
                f = ImageFont.load_default()
            d.text((h * 1.15, h * 0.22), label, fill=(31, 78, 121, 255), font=f)
        img.save(path, "PNG")
    elif kind == "chart":
        img = Image.new("RGB", (w, h), (255, 255, 255))
        d = ImageDraw.Draw(img)
        d.line((60, 20, 60, h - 40), fill=(90, 90, 90), width=2)
        d.line((60, h - 40, w - 20, h - 40), fill=(90, 90, 90), width=2)
        vals = [rnd.randint(30, 100) for _ in range(8)]
        bw = (w - 100) / len(vals)
        for i, v in enumerate(vals):
            x = 70 + i * bw
            d.rectangle((x, h - 40 - v * (h - 80) / 100, x + bw * 0.7, h - 40), fill=(68, 114, 196))
        img.save(path, "PNG")
    elif kind == "signature":
        img = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        d = ImageDraw.Draw(img)
        pts = [(10 + i * (w - 20) / 40, h / 2 + (h / 3) * ((-1) ** i) * rnd.random()) for i in range(41)]
        d.line(pts, fill=(20, 40, 110, 255), width=4, joint="curve")
        img.save(path, "PNG")
    else:
        img = Image.new("RGB", (w, h))
        d = ImageDraw.Draw(img)
        top = (rnd.randint(90, 160), rnd.randint(140, 200), rnd.randint(190, 240))
        for y in range(h):
            k = y / h
            d.line((0, y, w, y), fill=tuple(int(top[i] * (1 - k) + (60, 110, 60)[i] * k) for i in range(3)))
        for _ in range(12):
            x, y = rnd.randrange(w), rnd.randrange(h // 2, h)
            s = rnd.randint(20, 90)
            d.ellipse((x, y, x + s, y + s), fill=(rnd.randint(30, 90), rnd.randint(90, 150), rnd.randint(30, 80)))
        img.save(path, "JPEG", quality=88)
    return path


def caption(doc, text):
    return para(doc, text, align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, size=9, color="595959", space_after=10)


LOREM = [
    "The regional office completed the quarterly review on schedule, and every site submitted its figures before the deadline.",
    "Customer response times improved across all three support channels after the new routing rules went live in March.",
    "The committee agreed to publish the revised travel policy once the finance team has confirmed the new mileage rates.",
    "Two warehouse locations will move to the shared inventory system next quarter, which should reduce duplicate orders.",
    "Training sessions for the new reporting dashboard are scheduled for the first week of every month until the end of the year.",
    "Suppliers were asked to confirm delivery windows in writing so that the receiving team can plan staffing in advance.",
]


def lorem(n, k=0):
    return " ".join(LOREM[(k + i) % len(LOREM)] for i in range(n))


# ------------------------------------------------------------------ 1. resume
doc = base("Calibri", 10.5, margins=0.7)
p = para(doc, "Alexandra J. Morgan", size=24, bold=True, color="1F3864", space_after=0)
p = para(doc, "Senior Operations Analyst", size=12, color="2F5496", space_after=2)
p = para(doc, "", space_after=8)
run(p, "Seattle, WA  |  (206) 555-0142  |  alex.morgan@example.com  |  linkedin.com/in/alexmorgan", size=9.5, color="404040")
bottom_rule(p)
tab_pos = Inches(7.1)


def section_title(t):
    p = para(doc, t.upper(), bold=True, size=11, color="1F3864", space_before=10, space_after=3)
    bottom_rule(p, color="BFBFBF", sz=4)


def job(title, org, dates, bullets):
    p = para(doc, space_after=0, space_before=4)
    p.paragraph_format.tab_stops.add_tab_stop(tab_pos, WD_TAB_ALIGNMENT.RIGHT)
    run(p, title, bold=True)
    run(p, "\t")
    run(p, dates, italic=True, color="595959")
    para(doc, org, italic=True, color="2F5496", space_after=2)
    for b in bullets:
        q = doc.add_paragraph(b, style="List Bullet")
        q.paragraph_format.space_after = Pt(1)


section_title("Profile")
para(doc, "Operations analyst with nine years of experience improving logistics, reporting and customer support processes for multi-site retail and distribution businesses. Known for turning messy data into clear decisions.", space_after=4)
section_title("Experience")
job("Senior Operations Analyst", "Northwind Distribution, Seattle", "2021 – Present", ["Cut average order-to-ship time from 3.4 to 2.1 days by redesigning pick routes across four warehouses.", "Built the weekly performance dashboard used by 40 site managers; retired six manual spreadsheets.", "Led the inventory system migration for two regional sites with zero missed shipments."])
job("Operations Analyst", "Contoso Retail Group, Portland", "2017 – 2021", ["Modelled staffing against demand forecasts, saving $310,000 a year in overtime.", "Introduced supplier delivery windows, improving on-time receiving from 78% to 94%."])
job("Business Analyst", "Fabrikam Services, Tacoma", "2015 – 2017", ["Documented 120 support workflows and automated the top ten with the IT team."])
section_title("Education")
p = para(doc, space_after=0)
p.paragraph_format.tab_stops.add_tab_stop(tab_pos, WD_TAB_ALIGNMENT.RIGHT)
run(p, "B.Sc. Industrial Engineering", bold=True)
run(p, "\t")
run(p, "2011 – 2015", italic=True, color="595959")
para(doc, "University of Washington — Magna cum laude", italic=True, color="2F5496")
section_title("Skills")
t = doc.add_table(rows=3, cols=2)
no_borders(t)
skills = [("Analysis", "SQL, Python (pandas), Excel modelling, forecasting"), ("Tools", "Power BI, Tableau, SAP, NetSuite, Jira"), ("Languages", "English (native), Spanish (professional)")]
for i, (k, v) in enumerate(skills):
    t.cell(i, 0).text = ""
    run(t.cell(i, 0).paragraphs[0], k, bold=True)
    t.cell(i, 1).text = v
widths(t, [1.4, 5.7])
doc.save(os.path.join(OUT, "resume.docx"))

# ------------------------------------------------------------------ 2. invoice
doc = base("Arial", 10, margins=0.75)
sec = doc.sections[0]
page_footer(sec, "Page ", total=True, size=8)
head = doc.add_table(rows=1, cols=2)
no_borders(head)
widths(head, [3.5, 3.5])
c0 = head.cell(0, 0)
c0.paragraphs[0].add_run().add_picture(picture("inv-logo.png", 520, 120, "logo", "BRIGHTLINE"), width=Inches(2.4))
para_c0 = c0.add_paragraph()
run(para_c0, "Brightline Supplies Ltd.\n48 Harbour Road, Unit 5\nBristol BS1 4QA, United Kingdom\nVAT: GB 123 4567 89", size=9, color="404040")
c1 = head.cell(0, 1)
p = c1.paragraphs[0]
p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run(p, "INVOICE", bold=True, size=26, color="1F4E79")
p = c1.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run(p, "Invoice no.  INV-2026-0418\nIssue date  28 September 2026\nDue date  28 October 2026", size=9.5)
para(doc, "", space_after=6)
bill = doc.add_table(rows=1, cols=2)
no_borders(bill)
widths(bill, [3.5, 3.5])
for i, (title, lines) in enumerate([("BILL TO", "Harbourview Dental Clinic\nAttn: Dr. Priya Shah\n12 Quay Street\nCardiff CF10 1EP"), ("SHIP TO", "Harbourview Dental Clinic\nLoading bay B\n12 Quay Street\nCardiff CF10 1EP")]):
    c = bill.cell(0, i)
    run(c.paragraphs[0], title, bold=True, size=9, color="1F4E79")
    run(c.add_paragraph(), lines, size=10)
para(doc, "", space_after=8)
items = [("DX-200", "Nitrile examination gloves, box of 200", 24, 11.50), ("SM-50", "Surgical face masks, pack of 50", 40, 6.25), ("CT-10", "Cotton rolls, 1,000 count", 6, 14.90), ("DS-5L", "Surface disinfectant, 5 litre", 8, 22.40), ("BB-100", "Patient bibs, pack of 100", 12, 9.75), ("ST-30", "Sterilisation pouches, 200 count", 10, 17.30)]
t = doc.add_table(rows=1 + len(items), cols=5)
borders(t, sz=4, color="BFBFBF")
widths(t, [0.9, 3.2, 0.7, 1.1, 1.1])
for i, h in enumerate(["Item", "Description", "Qty", "Unit price", "Amount"]):
    c = t.cell(0, i)
    c.text = ""
    run(c.paragraphs[0], h, bold=True, color="FFFFFF", size=9.5)
    shade(c, "1F4E79")
    if i >= 2:
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
subtotal = 0
for r, (code, desc, q, price) in enumerate(items, start=1):
    amount = q * price
    subtotal += amount
    vals = [code, desc, str(q), f"£{price:,.2f}", f"£{amount:,.2f}"]
    for i, v in enumerate(vals):
        c = t.cell(r, i)
        c.text = v
        if i >= 2:
            c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if r % 2 == 0:
            shade(c, "F2F2F2")
vat = subtotal * 0.2
para(doc, "", space_after=4)
tot = doc.add_table(rows=3, cols=2)
no_borders(tot)
tot.alignment = WD_TABLE_ALIGNMENT.RIGHT
widths(tot, [1.6, 1.3])
for i, (k, v) in enumerate([("Subtotal", subtotal), ("VAT (20%)", vat), ("Total due", subtotal + vat)]):
    a = tot.cell(i, 0)
    b = tot.cell(i, 1)
    a.text = ""
    b.text = ""
    run(a.paragraphs[0], k, bold=i == 2)
    run(b.paragraphs[0], f"£{v:,.2f}", bold=i == 2)
    b.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if i == 2:
        shade(a, "DEEAF6")
        shade(b, "DEEAF6")
para(doc, "", space_after=10)
para(doc, "Payment terms", bold=True, color="1F4E79", space_after=2)
para(doc, "Please pay within 30 days by bank transfer to Brightline Supplies Ltd., sort code 20-45-77, account 43218765, quoting the invoice number. Thank you for your business.", size=9.5)
doc.save(os.path.join(OUT, "invoice.docx"))

# ------------------------------------------------------------------ 3. business letter
doc = base("Times New Roman", 12, margins=1.0)
page_footer(doc.sections[0], "Page ", total=False, size=9)
p = para(doc, "CRESTVIEW ARCHITECTS", align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, size=18, color="203864", space_after=0)
p = para(doc, "210 Market Street, Suite 400  •  Denver, CO 80202  •  (303) 555-0199", align=WD_ALIGN_PARAGRAPH.CENTER, size=10, color="404040", space_after=18)
bottom_rule(p, color="203864", sz=6)
para(doc, "September 28, 2026", space_after=12)
for line in ["Ms. Laura Chen", "Director of Facilities", "Greenfield Medical Center", "1400 Oak Avenue", "Boulder, CO 80301"]:
    para(doc, line, space_after=0)
para(doc, "", space_after=0)
p = para(doc, "", space_before=6, space_after=12)
run(p, "Re: Proposal for the east wing renovation", bold=True)
para(doc, "Dear Ms. Chen,", space_after=12)
for k in range(4):
    q = para(doc, lorem(3, k), align=WD_ALIGN_PARAGRAPH.JUSTIFY, space_after=12)
    q.paragraph_format.first_line_indent = Inches(0.5)
para(doc, "Sincerely,", space_after=4)
doc.add_picture(picture("sig.png", 480, 120, "signature"), width=Inches(1.8))
para(doc, "Daniel R. Ortiz, AIA", bold=True, space_after=0)
para(doc, "Principal Architect", italic=True, space_after=0)
doc.save(os.path.join(OUT, "letter.docx"))

# ------------------------------------------------------------------ 4. bank statement
doc = base("Arial", 9, margins=0.6)
sec = doc.sections[0]
hp = sec.header.paragraphs[0]
run(hp, "Evergreen Community Bank", bold=True, size=14, color="385723")
hp2 = sec.header.add_paragraph()
run(hp2, "Account statement  •  Customer service 0800 555 0123  •  evergreenbank.example", size=8, color="595959")
page_footer(sec, "Page ", total=True, size=8)
summary = doc.add_table(rows=4, cols=4)
borders(summary, sz=4, color="A9D08E")
widths(summary, [1.6, 1.9, 1.6, 2.2])
cells = [("Account holder", "Jordan A. Smith", "Statement period", "1 Aug – 31 Aug 2026"), ("Account number", "4402 1188 7730", "Sort code", "40-12-88"), ("Opening balance", "£2,418.36", "Money in", "£3,905.00"), ("Closing balance", "£3,011.84", "Money out", "£3,311.52")]
for r, row in enumerate(cells):
    for i, v in enumerate(row):
        c = summary.cell(r, i)
        c.text = ""
        run(c.paragraphs[0], v, bold=i % 2 == 0)
        if i % 2 == 0:
            shade(c, "E2EFDA")
para(doc, "", space_after=6)
para(doc, "Transactions", bold=True, size=11, color="385723", space_after=4)
tx = doc.add_table(rows=1, cols=5)
borders(tx, sz=2, color="C9C9C9")
widths(tx, [0.9, 3.3, 1.0, 1.0, 1.1])
hdr = tx.rows[0]
trPr = hdr._tr.get_or_add_trPr()
th = OxmlElement("w:tblHeader")
trPr.append(th)
for i, h in enumerate(["Date", "Description", "Money out", "Money in", "Balance"]):
    c = tx.cell(0, i)
    c.text = ""
    run(c.paragraphs[0], h, bold=True, color="FFFFFF")
    shade(c, "548235")
    if i >= 2:
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
bal = 2418.36
descs = ["Card payment — Tesco Stores", "Direct debit — Bristol Energy", "Salary — Northwind Ltd", "Card payment — Costa Coffee", "Transfer to savings", "Card payment — Amazon UK", "Standing order — Rent", "Refund — Argos", "Cash withdrawal — ATM Clifton", "Card payment — Shell Fuel"]
for d in range(1, 58):
    out_ = in_ = 0.0
    desc = descs[d % len(descs)]
    if "Salary" in desc:
        in_ = 1952.50
    elif "Refund" in desc:
        in_ = 34.99
    else:
        out_ = round(rnd.uniform(3, 180), 2)
    bal += in_ - out_
    row = tx.add_row()
    vals = [f"{(d % 31) + 1:02d} Aug", desc, f"{out_:,.2f}" if out_ else "", f"{in_:,.2f}" if in_ else "", f"{bal:,.2f}"]
    for i, v in enumerate(vals):
        c = row.cells[i]
        c.text = v
        if i >= 2:
            c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if d % 2 == 0:
            shade(c, "F2F2F2")
doc.save(os.path.join(OUT, "bank-statement.docx"))

# ------------------------------------------------------------------ 5. application form
doc = base("Calibri", 11, margins=0.9)
para(doc, "Community Grant Application", bold=True, size=20, color="7030A0", space_after=2)
para(doc, "Please complete every section in capital letters and return the form by 31 October 2026.", italic=True, size=10, color="595959", space_after=10)


def form_section(title):
    t = doc.add_table(rows=1, cols=1)
    c = t.cell(0, 0)
    c.text = ""
    run(c.paragraphs[0], title, bold=True, color="FFFFFF")
    shade(c, "7030A0")
    para(doc, "", space_after=2)


def blank(label):
    p = para(doc, space_after=6)
    p.paragraph_format.tab_stops.add_tab_stop(Inches(6.7), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.LINES)
    run(p, label + " ")
    run(p, "\t")


form_section("Section A — Applicant")
for f in ["Organisation name", "Registered charity number", "Contact person", "Email address", "Telephone"]:
    blank(f)
form_section("Section B — Project")
blank("Project title")
p = para(doc, "Project type (tick one):", space_after=4)
p = para(doc, "☐ Education     ☑ Health     ☐ Environment     ☐ Arts and culture     ☐ Other", space_after=8)
t = doc.add_table(rows=4, cols=3)
borders(t, sz=4, color="7F7F7F")
widths(t, [2.6, 2.1, 2.1])
for i, h in enumerate(["Budget line", "Amount requested", "Match funding"]):
    t.cell(0, i).text = ""
    run(t.cell(0, i).paragraphs[0], h, bold=True)
    shade(t.cell(0, i), "E4DFEC")
for r, name in enumerate(["Staff costs", "Equipment", "Venue hire"], start=1):
    t.cell(r, 0).text = name
para(doc, "", space_after=4)
form_section("Section C — Declaration")
para(doc, "I confirm that the information in this application is correct and that the organisation will use any grant only for the project described.", size=10, space_after=12)
p = para(doc)
p.paragraph_format.tab_stops.add_tab_stop(Inches(3.2), WD_TAB_ALIGNMENT.LEFT, WD_TAB_LEADER.LINES)
p.paragraph_format.tab_stops.add_tab_stop(Inches(3.6), WD_TAB_ALIGNMENT.LEFT)
p.paragraph_format.tab_stops.add_tab_stop(Inches(6.7), WD_TAB_ALIGNMENT.LEFT, WD_TAB_LEADER.LINES)
run(p, "Signature \t\tDate \t")
doc.save(os.path.join(OUT, "application-form.docx"))

# ------------------------------------------------------------------ 6. transcript
doc = base("Cambria", 10, margins=0.8)
page_footer(doc.sections[0], "Page ", total=True, size=8)
para(doc, "UNIVERSITY OF WESTBROOK", align=WD_ALIGN_PARAGRAPH.CENTER, bold=True, size=16, color="7F6000", space_after=0)
para(doc, "Office of the Registrar — Official Academic Transcript", align=WD_ALIGN_PARAGRAPH.CENTER, italic=True, size=10, space_after=10)
info = doc.add_table(rows=2, cols=4)
no_borders(info)
widths(info, [1.3, 2.2, 1.3, 2.2])
for r, row in enumerate([("Student", "Maria L. Fernández", "Student ID", "W20231187"), ("Programme", "B.Sc. Environmental Science", "Date issued", "28 Sep 2026")]):
    for i, v in enumerate(row):
        info.cell(r, i).text = ""
        run(info.cell(r, i).paragraphs[0], v, bold=i % 2 == 0)
courses = [("ENV101", "Introduction to Environmental Science", 4, "A"), ("CHM110", "General Chemistry I", 4, "B+"), ("MTH120", "Calculus for Scientists", 3, "A-"), ("ENG100", "Academic Writing", 3, "A"), ("BIO130", "Ecology and Evolution", 4, "B"), ("GEO140", "Physical Geography", 3, "A-")]
for term in ["Autumn 2024", "Spring 2025", "Autumn 2025"]:
    para(doc, term, bold=True, size=11, color="7F6000", space_before=8, space_after=2)
    t = doc.add_table(rows=1 + 4, cols=4)
    borders(t, sz=4, color="A6A6A6")
    widths(t, [1.0, 4.0, 0.9, 0.9])
    for i, h in enumerate(["Code", "Course title", "Credits", "Grade"]):
        t.cell(0, i).text = ""
        run(t.cell(0, i).paragraphs[0], h, bold=True)
        shade(t.cell(0, i), "FFF2CC")
    for r in range(1, 5):
        c = courses[(r + len(term)) % len(courses)]
        for i, v in enumerate(c):
            t.cell(r, i).text = str(v)
            if i >= 2:
                t.cell(r, i).paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
para(doc, "", space_after=6)
p = para(doc, "", align=WD_ALIGN_PARAGRAPH.RIGHT)
run(p, "Cumulative GPA: 3.62   •   Credits earned: 44", bold=True)
doc.save(os.path.join(OUT, "transcript.docx"))

# ------------------------------------------------------------------ 7. brochure (two columns, pictures)
doc = base("Calibri", 10.5, margins=0.7)
para(doc, "Lakeside Community Centre", bold=True, size=26, color="C55A11", space_after=0)
para(doc, "Autumn programme 2026", size=14, color="7F7F7F", space_after=8)
new = doc.add_section(WD_SECTION.CONTINUOUS)
break_on_last_paragraph(doc)
columns(new, 2, 0.3)
for k, title in enumerate(["Classes for everyone", "Family weekends", "Volunteering", "Opening hours"]):
    doc.add_heading(title, level=2)
    para(doc, lorem(2, k), space_after=6)
    if k == 0:
        doc.add_picture(picture("bro1.jpg", 900, 560), width=Inches(3.2))
        caption(doc, "The new studio opens in October.")
    if k == 2:
        for b in ["Café and front desk", "Youth club mentors", "Garden team (Saturdays)"]:
            doc.add_paragraph(b, style="List Bullet")
    if k == 3:
        t = doc.add_table(rows=3, cols=2)
        borders(t, sz=4, color="F4B183")
        widths(t, [1.5, 1.6])  # sized to the column, as Word sizes a table inserted there
        for r, (d, h) in enumerate([("Mon – Fri", "8:00 – 21:00"), ("Saturday", "9:00 – 17:00"), ("Sunday", "10:00 – 16:00")]):
            t.cell(r, 0).text = d
            t.cell(r, 1).text = h
doc.save(os.path.join(OUT, "brochure.docx"))

# ------------------------------------------------------------------ 8. two-column report
doc = base("Georgia", 10, margins=0.8)
page_footer(doc.sections[0], "", total=False, size=9)
para(doc, "Urban Heat and Tree Cover: A Field Study", bold=True, size=20, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
para(doc, "R. Patel, S. Okafor and L. Brandt — Westbrook Institute", italic=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10)
p = para(doc, "Abstract. " + lorem(2, 3), space_after=10, size=9.5)
p.paragraph_format.left_indent = Inches(0.5)
p.paragraph_format.right_indent = Inches(0.5)
new = doc.add_section(WD_SECTION.CONTINUOUS)
break_on_last_paragraph(doc)
columns(new, 2, 0.35)
for k, title in enumerate(["1. Introduction", "2. Method", "3. Results", "4. Discussion"]):
    doc.add_heading(title, level=2)
    for j in range(2):
        q = para(doc, lorem(2, k + j), align=WD_ALIGN_PARAGRAPH.JUSTIFY, space_after=6)
    if k == 2:
        doc.add_picture(picture("chart.png", 800, 460, "chart"), width=Inches(3.1))
        caption(doc, "Figure 1. Mean surface temperature by canopy cover.")
doc.save(os.path.join(OUT, "report-two-column.docx"))

# ------------------------------------------------------------------ 9. table-heavy report
doc = base("Calibri", 10, margins=0.8)
doc.add_heading("Quarterly Operations Report — Q3 2026", level=1)
para(doc, lorem(1), space_after=8)
doc.add_heading("Regional performance", level=2)
t = doc.add_table(rows=6, cols=5)
borders(t, sz=6, color="4472C4")
widths(t, [1.6, 1.3, 1.3, 1.3, 1.4])
hdr = ["Region", "Revenue", "Orders", "Returns", "On-time"]
data = [("North", "£412,300", "8,214", "2.1%", "96%"), ("South", "£388,950", "7,902", "2.6%", "94%"), ("East", "£455,120", "9,033", "1.8%", "97%"), ("West", "£301,775", "6,118", "3.0%", "91%"), ("Total", "£1,558,145", "31,267", "2.3%", "95%")]
for i, h in enumerate(hdr):
    t.cell(0, i).text = ""
    run(t.cell(0, i).paragraphs[0], h, bold=True, color="FFFFFF")
    shade(t.cell(0, i), "4472C4")
for r, row in enumerate(data, start=1):
    for i, v in enumerate(row):
        c = t.cell(r, i)
        c.text = ""
        run(c.paragraphs[0], v, bold=r == 5)
        if i > 0:
            c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if r == 5:
            shade(c, "D9E1F2")
para(doc, "", space_after=6)
doc.add_heading("Staffing plan (merged cells)", level=2)
t = doc.add_table(rows=4, cols=4)
borders(t, sz=4, color="808080")
widths(t, [1.8, 1.6, 1.6, 1.6])
m = t.cell(0, 1).merge(t.cell(0, 3))
m.text = ""
run(m.paragraphs[0], "Headcount by quarter", bold=True)
m.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
t.cell(0, 0).text = ""
run(t.cell(0, 0).paragraphs[0], "Team", bold=True)
for i, q in enumerate(["Q3", "Q4", "Q1"], start=1):
    t.cell(1, i).text = q
v = t.cell(1, 0).merge(t.cell(2, 0))
v.text = "Warehouse"
t.cell(3, 0).text = "Support"
for r in (2, 3):
    for i in range(1, 4):
        t.cell(r, i).text = str(rnd.randint(12, 60))
t.cell(1, 1).text = "48"
t.cell(1, 2).text = "52"
t.cell(1, 3).text = "55"
para(doc, "", space_after=6)
doc.add_heading("Top issues", level=2)
t = doc.add_table(rows=5, cols=3)
borders(t, sz=4, color="A5A5A5")
widths(t, [0.5, 4.2, 1.6])
for i, h in enumerate(["#", "Issue", "Owner"]):
    t.cell(0, i).text = ""
    run(t.cell(0, i).paragraphs[0], h, bold=True)
    shade(t.cell(0, i), "EDEDED")
for r, (a, b) in enumerate([("Late supplier confirmations on imported stock", "Procurement"), ("Returns backlog at the West depot", "Operations"), ("Dashboard refresh fails on Mondays", "IT"), ("Overtime above plan in September", "HR")], start=1):
    t.cell(r, 0).text = str(r)
    t.cell(r, 1).text = a
    t.cell(r, 2).text = b
doc.save(os.path.join(OUT, "table-report.docx"))

# ------------------------------------------------------------------ 10. image-heavy
doc = base("Calibri", 11, margins=1.0)
doc.add_heading("Site visit — Riverside Park", level=1)
para(doc, lorem(1, 2), space_after=8)
doc.add_picture(picture("park1.jpg", 1600, 900), width=Inches(6.0))
caption(doc, "Photo 1. The restored boardwalk, looking north.")
para(doc, lorem(1, 4), space_after=8)
t = doc.add_table(rows=2, cols=2)
no_borders(t)
for i in range(2):
    t.cell(0, i).paragraphs[0].add_run().add_picture(picture(f"park{i + 2}.jpg", 800, 600), width=Inches(2.9))
    t.cell(1, i).text = ""
    run(t.cell(1, i).paragraphs[0], f"Photo {i + 2}. {'Wildflower meadow' if i == 0 else 'New play area'}.", italic=True, size=9, color="595959")
    t.cell(1, i).paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
para(doc, "", space_after=6)
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
p.add_run().add_picture(picture("chart2.png", 700, 420, "chart"), width=Inches(3.0))
caption(doc, "Figure 1. Visitor counts by month (right-aligned figure).").alignment = WD_ALIGN_PARAGRAPH.RIGHT
doc.save(os.path.join(OUT, "image-heavy.docx"))

# ------------------------------------------------------------------ 11. formatting sampler
doc = base("Calibri", 11, margins=1.0)
sec = doc.sections[0]
run(sec.header.paragraphs[0], "Formatting sampler — internal", size=9, color="7F7F7F")
page_footer(sec)
doc.add_heading("Heading level 1", level=1)
para(doc, "Body text in Calibri 11 pt with " , space_after=6)
p = doc.paragraphs[-1]
run(p, "bold")
p.runs[-1].bold = True
run(p, ", ")
run(p, "italic", italic=True)
run(p, ", ")
run(p, "underlined", underline=True)
run(p, ", ")
run(p, "coloured", color="C00000")
run(p, " and ")
run(p, "highlighted", bold=True, italic=True)
run(p, " words.")
doc.add_heading("Heading level 2", level=2)
for size in (8, 10, 14, 18):
    para(doc, f"{size} pt line for size hierarchy.", size=size, space_after=3)
doc.add_heading("Heading level 3", level=3)
para(doc, "Left aligned paragraph.", align=WD_ALIGN_PARAGRAPH.LEFT)
para(doc, "Centred paragraph.", align=WD_ALIGN_PARAGRAPH.CENTER)
para(doc, "Right aligned paragraph.", align=WD_ALIGN_PARAGRAPH.RIGHT)
para(doc, lorem(2), align=WD_ALIGN_PARAGRAPH.JUSTIFY)
doc.add_heading("Lists", level=2)
for t_ in ["First bullet", "Second bullet"]:
    doc.add_paragraph(t_, style="List Bullet")
doc.add_paragraph("Nested bullet", style="List Bullet 2")
for t_ in ["Step one", "Step two", "Step three"]:
    doc.add_paragraph(t_, style="List Number")
doc.add_heading("Mixed fonts and characters", level=2)
p = para(doc)
run(p, "Arial, ", font="Arial")
run(p, "Times New Roman, ", font="Times New Roman")
run(p, "Courier New, ", font="Courier New")
run(p, "Georgia.", font="Georgia")
para(doc, "€ £ ₹ ¥ — “quotes” ‘single’ … ✓ © ® ™ ½ ≤ → niño café Łódź Ελληνικά Русский")
doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
doc.add_heading("After a page break", level=1)
para(doc, lorem(3, 1))
doc.save(os.path.join(OUT, "formatting.docx"))

# ------------------------------------------------------------------ 12. long report
doc = base("Calibri", 11, margins=1.0)
page_footer(doc.sections[0])
run(doc.sections[0].header.paragraphs[0], "Annual Review 2026", size=9, color="7F7F7F")
for ch in range(1, 13):
    doc.add_heading(f"{ch}. Operating notes", level=1)
    for k in range(7):
        para(doc, lorem(3, ch + k))
    doc.add_heading(f"{ch}.1 Actions", level=2)
    for a in ["Review the figures", "Confirm the schedule", "Share the notes"]:
        doc.add_paragraph(f"{a} for section {ch}", style="List Bullet")
doc.save(os.path.join(OUT, "long-report.docx"))

import shutil

shutil.rmtree(TMP)
print("\n".join(sorted(f for f in os.listdir(OUT) if f.endswith(".docx"))))
