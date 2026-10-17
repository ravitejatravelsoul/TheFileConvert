"""Scanned PDF → Word fixture variants (SCAN-WORD-10 … 19) — they keep fixes general, not fitted to one page.

    python qa/scripts/scan-variants.py     -> qa/fidelity/scan-word/SCAN-WORD-1x-*.pdf (+ *-ref.pdf)

Each page is drawn natively (so there is a text reference), then made to look like a flatbed scan with the
helpers of scan-fixtures.py (tinted paper, grey ink, blur, noise, JPEG, no text layer).

    10-form-simple          fill-in lines after labels, three fields on one row, signature + date
    11-form-checkbox        a vertical option list, "Yes ☐ No ☐" after the label, several on one row
    12-form-mixed           fill-ins + a ruled table with a shaded header + a check box
    13-invoice-simple       address blocks, a small ruled table, a total
    14-invoice-both-sides   key/value metadata on both sides at different sizes (baselines differ)
    15-invoice-dense        a dense, banded, right-aligned numeric table with totals
    16-twocol-text          title over two columns of running text
    17-twocol-chart         text in one column, a chart with a caption in the other
    18-twocol-heading-column  headings that belong to one column
    19-twocol-heading-span    a rule and a heading across both columns between two column bands
"""
import importlib.util
import os

import pymupdf

spec = importlib.util.spec_from_file_location("scanlib", os.path.join(os.path.dirname(__file__), "scan-fixtures.py"))
# scan-fixtures.py generates its own fixtures when run; load only its helpers.
src = open(spec.origin, encoding="utf8").read().split("from_corpus(\"application-form\"")[0]
ns: dict = {"__name__": "scanlib", "__file__": spec.origin}
exec(compile(src, spec.origin, "exec"), ns)
scan_look, write_scan, raster, OUT = ns["scan_look"], ns["write_scan"], ns["raster"], ns["OUT"]


def save_native(doc, out):
    doc.save(os.path.join(OUT, f"{out}-ref.pdf"))
    write_scan([scan_look(raster(pg), 400 + i) for i, pg in enumerate(doc)], [(pg.rect.width, pg.rect.height) for pg in doc], os.path.join(OUT, f"{out}.pdf"))


def newpage(doc):
    return doc.new_page(width=612, height=792)


def box(p, x, y, size=10, checked=False):
    """A check box `size` pt square with its top-left at (x, y)."""
    p.draw_rect(pymupdf.Rect(x, y, x + size, y + size), width=0.9)
    if checked:
        p.draw_line((x + 2, y + size * 0.55), (x + size * 0.42, y + size - 2), width=1.3)
        p.draw_line((x + size * 0.42, y + size - 2), (x + size - 1.5, y + 1.5), width=1.3)


def blank(p, x0, x1, y):
    p.draw_line((x0, y + 3), (x1, y + 3), width=0.8)


def form_simple():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((60, 80), "Membership Registration", fontname="hebo", fontsize=20)
    p.insert_text((60, 102), "Please print clearly. Fields marked * are required.", fontname="heit", fontsize=10)
    y = 150
    for label, x1 in (("Full name *", 540), ("Street address", 540), ("Telephone", 300), ("Email *", 540)):
        p.insert_text((60, y), label, fontname="helv", fontsize=11)
        blank(p, 60 + pymupdf.get_text_length(label, "helv", 11) + 8, x1, y)
        y += 38
    x = 60
    for label, w in (("City", 150), ("State", 70), ("Postal code", 100)):
        p.insert_text((x, y), label, fontname="helv", fontsize=11)
        lw = pymupdf.get_text_length(label, "helv", 11)
        blank(p, x + lw + 8, x + lw + 8 + w, y)
        x += lw + 8 + w + 22
    y += 60
    p.insert_text((60, y), "Signature", fontname="helv", fontsize=11)
    blank(p, 125, 330, y)
    p.insert_text((360, y), "Date", fontname="helv", fontsize=11)
    blank(p, 392, 540, y)
    save_native(d, "SCAN-WORD-10-form-simple")


def form_checkbox():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((60, 80), "Event Feedback Survey", fontname="hebo", fontsize=20)
    p.insert_text((60, 125), "1. How did you hear about us?", fontname="hebo", fontsize=11)
    y = 148
    for i, t in enumerate(("Friend or colleague", "Social media", "Newspaper", "Other")):
        box(p, 72, y - 8, 10, checked=(i == 1))
        p.insert_text((90, y), t, fontname="helv", fontsize=11)
        y += 22
    p.insert_text((60, y + 20), "2. Would you attend again?", fontname="hebo", fontsize=11)
    y += 44
    p.insert_text((72, y), "Yes", fontname="helv", fontsize=11)
    box(p, 100, y - 8, 10, checked=True)
    p.insert_text((140, y), "No", fontname="helv", fontsize=11)
    box(p, 160, y - 8, 10)
    p.insert_text((200, y), "Maybe", fontname="helv", fontsize=11)
    box(p, 240, y - 8, 10)
    p.insert_text((60, y + 44), "3. Which sessions did you join?", fontname="hebo", fontsize=11)
    y += 66
    x = 72
    for i, t in enumerate(("Keynote", "Workshop A", "Workshop B", "Panel")):
        box(p, x, y - 8, 10, checked=i in (0, 2))
        p.insert_text((x + 16, y), t, fontname="helv", fontsize=11)
        x += 16 + pymupdf.get_text_length(t, "helv", 11) + 26
    p.insert_text((60, y + 50), "Comments", fontname="helv", fontsize=11)
    for k in range(3):
        p.draw_line((60, y + 80 + k * 26), (540, y + 80 + k * 26), width=0.8)
    save_native(d, "SCAN-WORD-11-form-checkbox")


def form_mixed():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((60, 80), "Equipment Loan Request", fontname="tibo", fontsize=20)
    y = 125
    for label in ("Borrower", "Department"):
        p.insert_text((60, y), label, fontname="tiro", fontsize=12)
        blank(p, 60 + pymupdf.get_text_length(label, "tiro", 12) + 8, 360, y)
        y += 32
    xs, ys = [60, 250, 340, 540], [y + 10, y + 36, y + 62, y + 88, y + 114]
    p.draw_rect(pymupdf.Rect(xs[0], ys[0], xs[-1], ys[1]), fill=(0.9, 0.92, 0.96), width=0)
    for yy in ys:
        p.draw_line((xs[0], yy), (xs[-1], yy), width=0.8)
    for x in xs:
        p.draw_line((x, ys[0]), (x, ys[-1]), width=0.8)
    for c, t in enumerate(("Item", "Quantity", "Return date")):
        p.insert_text((xs[c] + 6, ys[0] + 17), t, fontname="tibo", fontsize=11)
    for r, row in enumerate((("Projector", "1", ""), ("Laptop", "2", ""), ("Microphone", "4", ""))):
        for c, t in enumerate(row):
            if t:
                p.insert_text((xs[c] + 6, ys[r + 1] + 17), t, fontname="tiro", fontsize=11)
    y = ys[-1] + 50
    p.insert_text((60, y), "Approved by", fontname="tiro", fontsize=12)
    blank(p, 140, 330, y)
    p.insert_text((360, y), "Date", fontname="tiro", fontsize=12)
    blank(p, 392, 540, y)
    y += 40
    box(p, 60, y - 8, 10)
    p.insert_text((76, y), "Equipment returned in good condition", fontname="tiro", fontsize=12)
    save_native(d, "SCAN-WORD-12-form-mixed")


def table(p, xs, ys, width=0.7):
    for yy in ys:
        p.draw_line((xs[0], yy), (xs[-1], yy), width=width)
    for x in xs:
        p.draw_line((x, ys[0]), (x, ys[-1]), width=width)


def invoice_simple():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((60, 80), "INVOICE", fontname="hebo", fontsize=26)
    p.insert_text((60, 120), "Northwind Studio", fontname="hebo", fontsize=12)
    for k, t in enumerate(("14 Mill Lane", "Leeds LS1 4AB")):
        p.insert_text((60, 136 + k * 14), t, fontname="helv", fontsize=10)
    p.insert_text((60, 190), "Billed to", fontname="hebo", fontsize=10)
    for k, t in enumerate(("Alder & Finch Ltd", "9 Station Road", "York YO1 6GA")):
        p.insert_text((60, 206 + k * 14), t, fontname="helv", fontsize=10)
    p.insert_text((400, 120), "Invoice no.  2026-117", fontname="helv", fontsize=10)
    p.insert_text((400, 134), "Date  04 October 2026", fontname="helv", fontsize=10)
    xs, ys = [60, 330, 400, 480, 552], [280, 302, 324, 346, 368]
    for yy in ys:
        p.draw_line((xs[0], yy), (xs[-1], yy), width=0.7)
    for c, t in enumerate(("Description", "Qty", "Rate", "Amount")):
        p.insert_text((xs[c] + 4, ys[0] + 15), t, fontname="hebo", fontsize=10)
    for r, row in enumerate((("Brand identity workshop", "2", "£450.00", "£900.00"), ("Website copy review", "1", "£320.00", "£320.00"), ("Print proofing", "3", "£60.00", "£180.00"))):
        for c, t in enumerate(row):
            p.insert_text((xs[c] + 4, ys[r + 1] + 15), t, fontname="helv", fontsize=10)
    p.insert_text((400, 410), "Total", fontname="hebo", fontsize=11)
    p.insert_text((480, 410), "£1,400.00", fontname="hebo", fontsize=11)
    p.insert_text((60, 470), "Payment due within 14 days. Thank you.", fontname="heit", fontsize=10)
    save_native(d, "SCAN-WORD-13-invoice-simple")


def invoice_both_sides():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((60, 80), "Tax Invoice", fontname="tibo", fontsize=24)
    left = (("Invoice number", "INV-5521"), ("Issue date", "02/10/2026"), ("Customer ID", "C-0093"))
    right = (("Due date", "16/10/2026"), ("Purchase order", "PO-77120"), ("Terms", "Net 14"))
    for k, (a, b) in enumerate(left):
        p.insert_text((60, 130 + k * 17), a, fontname="tiro", fontsize=11)
        p.insert_text((165, 130 + k * 17), b, fontname="tiro", fontsize=11)
    for k, (a, b) in enumerate(right):
        p.insert_text((340, 126 + k * 15), a, fontname="tiro", fontsize=10)
        p.insert_text((440, 126 + k * 15), b, fontname="tiro", fontsize=10)
    p.insert_text((60, 230), "Ship to", fontname="tibo", fontsize=11)
    for k, t in enumerate(("Maple Grove Surgery", "3 Elm Court", "Bath BA1 2AA")):
        p.insert_text((60, 246 + k * 14), t, fontname="tiro", fontsize=11)
    xs, ys = [60, 300, 380, 470, 552], [330, 354, 378, 402]
    table(p, xs, ys)
    for c, t in enumerate(("Product", "Units", "Price", "Total")):
        p.insert_text((xs[c] + 5, ys[0] + 16), t, fontname="tibo", fontsize=11)
    for r, row in enumerate((("Dressing pack", "20", "£4.20", "£84.00"), ("Sterile gloves", "10", "£6.90", "£69.00"))):
        for c, t in enumerate(row):
            p.insert_text((xs[c] + 5, ys[r + 1] + 16), t, fontname="tiro", fontsize=11)
    for k, (a, b, f) in enumerate((("Subtotal", "£153.00", "tiro"), ("VAT 20%", "£30.60", "tiro"), ("Amount due", "£183.60", "tibo"))):
        p.insert_text((380, 440 + k * 18), a, fontname=f, fontsize=11)
        p.insert_text((480, 440 + k * 18), b, fontname=f, fontsize=11)
    save_native(d, "SCAN-WORD-14-invoice-both-sides")


def invoice_dense():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((50, 70), "Statement of Charges", fontname="hebo", fontsize=18)
    p.insert_text((50, 92), "Account 40-221-0057 · period 01 Sep – 30 Sep 2026", fontname="helv", fontsize=9)
    xs, y0 = [50, 130, 330, 400, 470, 562], 120
    p.draw_rect(pymupdf.Rect(xs[0], y0, xs[-1], y0 + 20), fill=(0.16, 0.32, 0.55), width=0)
    for c, t in enumerate(("Date", "Description", "Qty", "Rate", "Amount")):
        p.insert_text((xs[c] + 4, y0 + 14), t, fontname="hebo", fontsize=9, color=(1, 1, 1))
    rows = [("01 Sep", "Consulting – discovery", "6", "95.00", "570.00"), ("03 Sep", "Consulting – design", "8", "95.00", "760.00"), ("05 Sep", "Travel", "1", "42.50", "42.50"), ("08 Sep", "Licence – annual", "1", "310.00", "310.00"), ("11 Sep", "Consulting – build", "12", "95.00", "1,140.00"), ("12 Sep", "Hosting", "1", "28.00", "28.00"), ("15 Sep", "Consulting – build", "10", "95.00", "950.00"), ("18 Sep", "Travel", "2", "42.50", "85.00"), ("22 Sep", "Consulting – review", "4", "95.00", "380.00"), ("25 Sep", "Support retainer", "1", "150.00", "150.00"), ("29 Sep", "Consulting – handover", "3", "95.00", "285.00")]
    y = y0 + 20
    for r, row in enumerate(rows):
        if r % 2:
            p.draw_rect(pymupdf.Rect(xs[0], y, xs[-1], y + 20), fill=(0.93, 0.95, 0.98), width=0)
        for c, t in enumerate(row):
            if c >= 2:
                w = pymupdf.get_text_length(t, "helv", 9)
                p.insert_text((xs[c + 1] - 6 - w, y + 14), t, fontname="helv", fontsize=9)
            else:
                p.insert_text((xs[c] + 4, y + 14), t, fontname="helv", fontsize=9)
        y += 20
    for k in range(len(rows) + 1):
        yy = y0 + 20 + 20 * k
        p.draw_line((xs[0], yy), (xs[-1], yy), width=0.5, color=(0.6, 0.6, 0.6))
    for t, v in (("Subtotal", "4,700.50"), ("VAT 20%", "940.10"), ("Total due", "5,640.60")):
        y += 20
        f = "hebo" if t == "Total due" else "helv"
        p.insert_text((400, y), t, fontname=f, fontsize=10)
        p.insert_text((556 - pymupdf.get_text_length(v, f, 10), y), v, fontname=f, fontsize=10)
    save_native(d, "SCAN-WORD-15-invoice-dense")


PARA = "The regional office completed the quarterly review on schedule, and every site submitted its figures before the deadline. Customer response times improved across all three support channels after the new routing rules went live in March. The committee agreed to publish the revised travel policy once the finance team has confirmed the new mileage rates. "


def para(p, rect, text, size=10):
    p.insert_textbox(rect, text, fontname="tiro", fontsize=size, lineheight=1.25, align=0)


def twocol(kind, number):
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((60, 78), "Coastal Habitat Monitoring", fontname="tibo", fontsize=20)
    p.insert_text((60, 98), "A. Rivera and M. Osei — Marine Research Unit", fontname="tiit", fontsize=10)
    L, R = pymupdf.Rect(60, 130, 292, 740), pymupdf.Rect(320, 130, 552, 740)
    if kind == "text":
        para(p, L, PARA * 5)
        para(p, R, PARA * 5)
    elif kind == "chart":
        para(p, L, PARA * 4)
        x0, base = 330, 330
        p.draw_line((x0, 150), (x0, base), width=0.8)
        p.draw_line((x0, base), (545, base), width=0.8)
        for i, h in enumerate((60, 95, 130, 110, 80, 45)):
            p.draw_rect(pymupdf.Rect(x0 + 10 + i * 34, base - h, x0 + 34 + i * 34, base), fill=(0.2, 0.45, 0.7), width=0)
        p.insert_text((330, base + 16), "Figure 1. Survey counts by site.", fontname="tiit", fontsize=9)
        para(p, pymupdf.Rect(320, base + 40, 552, 740), PARA * 3)
    elif kind == "heading-column":
        p.insert_text((60, 142), "1. Methods", fontname="tibo", fontsize=13)
        para(p, pymupdf.Rect(60, 154, 292, 440), PARA * 2)
        p.insert_text((320, 142), "2. Findings", fontname="tibo", fontsize=13)
        para(p, pymupdf.Rect(320, 154, 552, 740), PARA * 3)
        p.insert_text((60, 460), "3. Limits", fontname="tibo", fontsize=13)
        para(p, pymupdf.Rect(60, 472, 292, 740), PARA * 2)
    elif kind == "heading-span":
        para(p, pymupdf.Rect(60, 130, 292, 400), PARA * 2)
        para(p, pymupdf.Rect(320, 130, 552, 400), PARA * 2)
        p.draw_line((60, 418), (552, 418), width=0.8)
        p.insert_text((60, 440), "Summary of the second survey season", fontname="tibo", fontsize=14)
        para(p, pymupdf.Rect(60, 458, 292, 740), PARA * 2)
        para(p, pymupdf.Rect(320, 458, 552, 740), PARA * 2)
    save_native(d, f"SCAN-WORD-{number}-twocol-{kind}")


form_simple()
form_checkbox()
form_mixed()
invoice_simple()
invoice_both_sides()
invoice_dense()
for number, kind in ((16, "text"), (17, "chart"), (18, "heading-column"), (19, "heading-span")):
    twocol(kind, number)
print("\n".join(sorted(f for f in os.listdir(OUT) if f.startswith("SCAN-WORD-1") and f.endswith(".pdf") and not f.endswith("-ref.pdf"))))
