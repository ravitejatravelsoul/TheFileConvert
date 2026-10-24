"""Realistic dummy documents — what people actually upload. ALL IDENTITIES, NUMBERS AND ORGANISATIONS ARE FAKE.

    python qa/scripts/real-user-fixtures.py     -> qa/real-user-fixtures/DOCUMENT-*.{pdf,png,jpg,docx}

Scanned ones are drawn natively, then made to look like a flatbed scan or a phone photo (tinted paper, blur,
noise, slight skew, JPEG, no text layer). A "-ref.pdf" of each scanned PDF is kept in `refs/` (the native
original, for text checks of the OCR journey). Identity-style documents say SPECIMEN and use Utopia, a
country that doesn't exist.

    01 passport scan (PDF)           02 filled application (scanned PDF)   03 certificate (scanned PDF)
    04 invoice (scanned PDF)         04b invoice, native PDF               05 bank statement (scanned, 2 pages)
    06 resume (native PDF)           07 scanned letter (clean, plain)      08 signed contract (scanned, 2 pages)
    09 ID card (PNG)                 10 filled form (PNG)                  11 receipt (JPG)
    12 table report (native PDF)     13 brochure (native PDF)              14 photo with text (PNG)
    15 business letter (DOCX)        16 complex Word report (DOCX)         17 screenshot (PNG)   18 table image (PNG)
"""
import io
import math
import os
import random

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join("qa", "real-user-fixtures")
REFS = os.path.join(OUT, "refs")
os.makedirs(REFS, exist_ok=True)
FONTS = "C:/Windows/Fonts"
DPI = 200
rng = random.Random(2026)
nrng = np.random.default_rng(2026)


# ------------------------------------------------------------------ looks
def scan_look(img: Image.Image, seed: int, skew: float = 0.0, strength: float = 1.0) -> Image.Image:
    """A flatbed scan: warm paper, ink lifted to dark grey, blur, sensor noise, an optional slight skew."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    paper = np.array([246, 244, 238], np.float32)
    a = 35 + (a / 255.0) * (paper - 35)
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7 * strength))
    if skew:
        im = im.rotate(skew, resample=Image.BICUBIC, expand=False, fillcolor=(246, 244, 238))
    a = np.asarray(im, dtype=np.float32)
    a += np.random.default_rng(seed).normal(0, 3.0 * strength, a.shape[:2])[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def raster(page: pymupdf.Page, dpi=DPI) -> Image.Image:
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def write_scan_pdf(pages, sizes, path):
    doc = pymupdf.open()
    for img, (w, h) in zip(pages, sizes):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
        pg = doc.new_page(width=w, height=h)
        pg.insert_image(pg.rect, stream=buf.getvalue())
    doc.save(path, deflate=True)


def save_scanned(doc: pymupdf.Document, name: str, skew=0.0, seed=1):
    """Native doc → image-only scanned PDF (+ the native reference in refs/)."""
    doc.save(os.path.join(REFS, f"{name}-ref.pdf"))
    pages = [scan_look(raster(pg), seed + i, skew=skew if i % 2 == 0 else -skew * 0.6) for i, pg in enumerate(doc)]
    write_scan_pdf(pages, [(pg.rect.width, pg.rect.height) for pg in doc], os.path.join(OUT, f"{name}.pdf"))


def newpage(doc, w=612, h=792):
    return doc.new_page(width=w, height=h)


def pil_font(name, size):
    for cand in (f"{FONTS}/{name}", f"{FONTS}/arial.ttf"):
        if os.path.exists(cand):
            return ImageFont.truetype(cand, size)
    return ImageFont.load_default()


def scribble(p, x, y, w, seed=0, color=(0.1, 0.12, 0.45), width=1.4):
    """A signature-like scribble (smooth random curve) from (x, y) over `w` pt."""
    r = random.Random(seed)
    pts, cx = [], x
    for k in range(60):
        cx += w / 60 * r.uniform(0.7, 1.4)
        pts.append(pymupdf.Point(cx, y + math.sin(k / 2.2) * 8 + r.uniform(-3, 3) - (k % 9 == 0) * 6))
    p.draw_polyline(pts, color=color, width=width, closePath=False)


def avatar(w=300, h=380, seed=0, tone=(222, 184, 150)) -> Image.Image:
    """A synthetic portrait (no real person): gradient backdrop, head, hair, shoulders, grain."""
    r = random.Random(seed)
    im = Image.new("RGB", (w, h))
    px = np.zeros((h, w, 3), np.float32)
    for c, (a, b) in enumerate(zip((150, 170, 195), (205, 215, 230))):
        px[..., c] = np.linspace(a, b, h)[:, None]
    im = Image.fromarray(px.astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.ellipse((w * 0.12, h * 0.72, w * 0.88, h * 1.35), fill=(52, 58, 80))  # shoulders
    d.rectangle((w * 0.42, h * 0.58, w * 0.58, h * 0.78), fill=tuple(int(c * 0.9) for c in tone))  # neck
    d.ellipse((w * 0.27, h * 0.16, w * 0.73, h * 0.66), fill=tone)  # head
    d.pieslice((w * 0.24, h * 0.1, w * 0.76, h * 0.5), 180, 360, fill=(60 + r.randint(0, 30), 40, 30))  # hair
    for ex in (0.40, 0.60):
        d.ellipse((w * (ex - 0.03), h * 0.38, w * (ex + 0.03), h * 0.41), fill=(40, 35, 35))
    d.arc((w * 0.4, h * 0.48, w * 0.6, h * 0.56), 20, 160, fill=(150, 80, 80), width=3)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.6)), dtype=np.float32) + nrng.normal(0, 7, (h, w, 3))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def insert_pil(p, img: Image.Image, rect, fmt="JPEG"):
    buf = io.BytesIO()
    img.save(buf, fmt, quality=88) if fmt == "JPEG" else img.save(buf, fmt)
    p.insert_image(rect, stream=buf.getvalue())


def guilloche(p, rect, color=(0.82, 0.88, 0.95), n=26):
    for k in range(n):
        pts = [pymupdf.Point(rect.x0 + i * rect.width / 120, rect.y0 + rect.height / 2 + math.sin(i / 7 + k / 3) * rect.height * 0.42 * math.cos(k / 4)) for i in range(121)]
        p.draw_polyline(pts, color=color, width=0.4, closePath=False)


def box(p, x, y, size=10, checked=False):
    p.draw_rect(pymupdf.Rect(x, y, x + size, y + size), width=0.9)
    if checked:
        p.draw_line((x + 2, y + size * 0.55), (x + size * 0.42, y + size - 2), width=1.4)
        p.draw_line((x + size * 0.42, y + size - 2), (x + size - 1.5, y + 1.5), width=1.4)


def blank(p, x0, x1, y, w=0.8):
    p.draw_line((x0, y + 3), (x1, y + 3), width=w)


# ------------------------------------------------------------------ 01 passport
def passport():
    d = pymupdf.open()
    p = newpage(d)
    page = pymupdf.Rect(46, 70, 566, 430)
    p.draw_rect(page, fill=(0.97, 0.96, 0.9), color=(0.5, 0.5, 0.5), width=1)
    guilloche(p, page)
    p.draw_rect(pymupdf.Rect(46, 70, 566, 100), fill=(0.12, 0.2, 0.45), width=0)
    p.insert_text((58, 91), "PASSPORT  ·  PASSEPORT  ·  PASAPORTE", fontname="hebo", fontsize=12, color=(1, 1, 1))
    p.insert_text((430, 91), "SPECIMEN", fontname="hebo", fontsize=12, color=(1, 0.85, 0.3))
    insert_pil(p, avatar(seed=3), pymupdf.Rect(60, 112, 200, 276))
    p.draw_rect(pymupdf.Rect(60, 112, 200, 276), width=0.8)
    insert_pil(p, avatar(w=90, h=114, seed=3).convert("L").convert("RGB"), pymupdf.Rect(470, 330, 540, 418))  # ghost portrait
    fields = (("Type / Type", "P"), ("Code / Code", "UTO"), ("Passport No. / N° de passeport", "X1234567"))
    x = 216
    for k, (lab, val) in enumerate(fields):
        p.insert_text((x, 118), lab, fontname="helv", fontsize=6.5, color=(0.35, 0.35, 0.35))
        p.insert_text((x, 132), val, fontname="cour", fontsize=11)
        x += [50, 70, 150][k]
    rows = (
        ("Surname / Nom", "ANDERSEN-LOPEZ"),
        ("Given names / Prénoms", "MARIA ELENA"),
        ("Nationality / Nationalité", "UTOPIAN"),
        ("Date of birth / Date de naissance", "14 MAR 1991"),
        ("Sex / Sexe", "F"),
        ("Place of birth / Lieu de naissance", "NEW HARBOUR"),
        ("Date of issue / Date de délivrance", "02 JUN 2024"),
        ("Date of expiry / Date d'expiration", "01 JUN 2034"),
        ("Authority / Autorité", "PASSPORT OFFICE"),
    )
    y = 150
    for k, (lab, val) in enumerate(rows):
        col = k % 2
        xx = 216 + col * 170 if k > 1 else 216
        if k <= 1:
            yy = 150 + k * 28
        else:
            yy = 206 + ((k - 2) // 2) * 28
        p.insert_text((xx, yy), lab, fontname="helv", fontsize=6.5, color=(0.35, 0.35, 0.35))
        p.insert_text((xx, yy + 12), val, fontname="cour", fontsize=11)
    p.insert_text((60, 296), "Holder's signature / Signature du titulaire", fontname="helv", fontsize=6.5, color=(0.35, 0.35, 0.35))
    scribble(p, 70, 322, 110, seed=11)
    # machine-readable zone
    p.draw_rect(pymupdf.Rect(46, 372, 566, 430), fill=(1, 1, 1), width=0)
    p.insert_text((56, 398), "P<UTOANDERSEN<LOPEZ<<MARIA<ELENA<<<<<<<<<<<<<", fontname="cour", fontsize=11.5)
    p.insert_text((56, 418), "X1234567<4UTO9103142F3406014<<<<<<<<<<<<<<04", fontname="cour", fontsize=11.5)
    p.insert_text((46, 470), "SPECIMEN — synthetic document with invented data. Not a real passport.", fontname="heit", fontsize=8, color=(0.5, 0.5, 0.5))
    save_scanned(d, "DOCUMENT-01-passport-scan", skew=0.7, seed=10)


# ------------------------------------------------------------------ 02 filled application (handwriting)
def application(path_name="DOCUMENT-02-filled-application"):
    d = pymupdf.open()
    p = newpage(d)
    hand = os.path.join(FONTS, "segoesc.ttf")
    p.insert_font("hand", hand) if os.path.exists(hand) else None
    hf = "hand" if os.path.exists(hand) else "heit"
    ink = (0.08, 0.12, 0.5)
    p.insert_text((54, 70), "RIVERSIDE COMMUNITY COLLEGE", fontname="tibo", fontsize=16)
    p.insert_text((54, 90), "Student Application Form — Autumn 2026", fontname="tiro", fontsize=11)
    p.draw_line((54, 98), (558, 98), width=1.2)
    def field(label, value, y, x0=54, x1=558):
        p.insert_text((x0, y), label, fontname="helv", fontsize=9.5)
        lx = x0 + pymupdf.get_text_length(label, "helv", 9.5) + 6
        blank(p, lx, x1, y)
        p.insert_text((lx + 6, y - 1), value, fontname=hf, fontsize=11, color=ink)
    field("Full name:", "Daniel R. Okafor", 130)
    field("Date of birth:", "08 / 02 / 2001", 160, 54, 300)
    field("Phone:", "(555) 014-2233", 160, 320, 558)
    field("Address:", "412 Linden Court, Apt 3B", 190)
    field("City / State / ZIP:", "Springfield, UT 84000", 220)
    field("Email:", "daniel.okafor@example.test", 250)
    p.insert_text((54, 290), "Programme of study", fontname="hebo", fontsize=10)
    y = 308
    for k, t in enumerate(("Business Administration", "Computer Science", "Nursing", "Fine Arts")):
        box(p, 64, y - 8, 10, checked=(k == 1))
        p.insert_text((82, y), t, fontname="helv", fontsize=10)
        y += 20
    p.insert_text((54, y + 14), "Enrolment type", fontname="hebo", fontsize=10)
    y += 36
    for k, t in enumerate(("Full-time", "Part-time")):
        box(p, 64 + k * 110, y - 8, 10, checked=(k == 0))
        p.insert_text((82 + k * 110, y), t, fontname="helv", fontsize=10)
    p.insert_text((54, y + 40), "Previous school and graduation year:", fontname="helv", fontsize=9.5)
    p.insert_text((70, y + 62), "Lakeview High School, 2019", fontname=hf, fontsize=11, color=ink)
    for k in range(2):
        p.draw_line((54, y + 68 + k * 26), (558, y + 68 + k * 26), width=0.7)
    p.insert_text((54, y + 150), "I confirm that the information above is correct.", fontname="helv", fontsize=9.5)
    p.insert_text((54, y + 185), "Signature", fontname="helv", fontsize=9.5)
    blank(p, 108, 300, y + 185)
    scribble(p, 114, y + 182, 120, seed=21, color=ink)
    p.insert_text((330, y + 185), "Date", fontname="helv", fontsize=9.5)
    blank(p, 358, 558, y + 185)
    p.insert_text((364, y + 184), "10 / 09 / 2026", fontname=hf, fontsize=11, color=ink)
    save_scanned(d, path_name, skew=-0.5, seed=20)


# ------------------------------------------------------------------ 03 certificate
def certificate():
    d = pymupdf.open()
    p = newpage(d, 792, 612)
    p.draw_rect(pymupdf.Rect(24, 24, 768, 588), color=(0.6, 0.45, 0.1), width=3)
    p.draw_rect(pymupdf.Rect(34, 34, 758, 578), color=(0.6, 0.45, 0.1), width=0.9)
    guilloche(p, pymupdf.Rect(44, 44, 748, 568), color=(0.93, 0.89, 0.8), n=18)
    p.insert_text((250, 110), "CERTIFICATE", fontname="tibo", fontsize=40, color=(0.45, 0.3, 0.05))
    p.insert_text((290, 140), "OF ACHIEVEMENT", fontname="tiro", fontsize=20, color=(0.45, 0.3, 0.05))
    p.insert_text((290, 200), "This certificate is proudly presented to", fontname="tiit", fontsize=12)
    p.insert_text((230, 260), "Priya Raman-Whitfield", fontname="tibo", fontsize=34)
    p.draw_line((200, 272), (592, 272), width=0.8)
    p.insert_text((180, 310), "for outstanding performance and dedication in completing the", fontname="tiro", fontsize=14)
    p.insert_text((240, 332), "Advanced Data Analysis Programme with distinction", fontname="tiro", fontsize=14)
    p.insert_text((284, 360), "Awarded on 14 June 2026 · Certificate No. CA-2026-00417", fontname="tiro", fontsize=10.5)
    for cx, label in ((200, "Programme Director"), (592, "Chair of the Board")):
        p.draw_line((cx - 90, 470), (cx + 90, 470), width=0.8)
        p.insert_text((cx - pymupdf.get_text_length(label, "tiro", 10) / 2, 486), label, fontname="tiro", fontsize=10)
        scribble(p, cx - 70, 462, 110, seed=cx)
    # round seal
    cx, cy = 396, 450
    for r, w in ((46, 2.4), (38, 1.2)):
        p.draw_circle((cx, cy), r, color=(0.62, 0.1, 0.1), width=w)
    p.insert_text((cx - 28, cy - 4), "FICTIONAL", fontname="hebo", fontsize=8, color=(0.62, 0.1, 0.1))
    p.insert_text((cx - 24, cy + 9), "INSTITUTE", fontname="hebo", fontsize=8, color=(0.62, 0.1, 0.1))
    save_scanned(d, "DOCUMENT-03-certificate", skew=0.4, seed=30)


# ------------------------------------------------------------------ 04 invoice (scanned + native)
def invoice(native: bool):
    d = pymupdf.open()
    p = newpage(d)
    p.draw_rect(pymupdf.Rect(54, 54, 100, 100), fill=(0.1, 0.3, 0.5), width=0)
    p.insert_text((64, 88), "NW", fontname="hebo", fontsize=22, color=(1, 1, 1))
    p.insert_text((110, 80), "NORTHWIND STUDIO", fontname="hebo", fontsize=16)
    p.insert_text((110, 94), "14 Mill Lane, Leeds LS1 4AB · accounts@northwind.example", fontname="helv", fontsize=8.5)
    p.insert_text((430, 80), "INVOICE", fontname="hebo", fontsize=24)
    for k, (a, b) in enumerate((("Invoice no.", "2026-0418"), ("Issue date", "04 Oct 2026"), ("Due date", "18 Oct 2026"), ("PO", "PO-77120"))):
        p.insert_text((400, 112 + k * 13), a, fontname="helv", fontsize=9)
        p.insert_text((470, 112 + k * 13), b, fontname="hebo", fontsize=9)
    p.insert_text((54, 140), "BILL TO", fontname="hebo", fontsize=9)
    for k, t in enumerate(("Alder & Finch Ltd", "Attn: Accounts Payable", "9 Station Road", "York YO1 6GA")):
        p.insert_text((54, 155 + k * 13), t, fontname="helv", fontsize=10)
    xs, y0 = [54, 300, 360, 440, 558], 240
    p.draw_rect(pymupdf.Rect(xs[0], y0, xs[-1], y0 + 22), fill=(0.1, 0.3, 0.5), width=0)
    for c, t in enumerate(("Description", "Qty", "Rate", "Amount")):
        p.insert_text((xs[c] + 6, y0 + 15), t, fontname="hebo", fontsize=9.5, color=(1, 1, 1))
    rows = (("Brand identity workshop", "2", "£450.00", "£900.00"), ("Website copy review", "1", "£320.00", "£320.00"), ("Print proofing", "3", "£60.00", "£180.00"), ("Photography licence", "1", "£275.00", "£275.00"))
    for r, row in enumerate(rows):
        y = y0 + 22 + r * 24
        if r % 2:
            p.draw_rect(pymupdf.Rect(xs[0], y, xs[-1], y + 24), fill=(0.93, 0.95, 0.98), width=0)
        for c, t in enumerate(row):
            p.insert_text((xs[c] + 6, y + 16), t, fontname="helv", fontsize=10)
        p.draw_line((xs[0], y + 24), (xs[-1], y + 24), width=0.5, color=(0.6, 0.6, 0.6))
    for k, (a, b, f) in enumerate((("Subtotal", "£1,675.00", "helv"), ("VAT 20%", "£335.00", "helv"), ("Total due", "£2,010.00", "hebo"))):
        p.insert_text((400, 380 + k * 18), a, fontname=f, fontsize=10.5)
        p.insert_text((480, 380 + k * 18), b, fontname=f, fontsize=10.5)
    p.insert_text((54, 470), "Payment terms", fontname="hebo", fontsize=10)
    p.insert_text((54, 485), "Bank transfer within 14 days · sort code 20-45-77 · account 43218765 · reference 2026-0418.", fontname="helv", fontsize=9.5)
    p.insert_text((54, 500), "Thank you for your business.", fontname="heit", fontsize=9.5)
    if native:
        d.save(os.path.join(OUT, "DOCUMENT-04b-invoice-native.pdf"))
    else:
        save_scanned(d, "DOCUMENT-04-invoice", skew=0.5, seed=40)


# ------------------------------------------------------------------ 05 bank statement (2 pages)
def statement():
    d = pymupdf.open()
    rows = []
    bal = 4210.55
    for k in range(34):
        day = 1 + k
        desc = ("Grocery Mart", "Electric utility", "Salary — Contoso Ltd", "Coffee Corner", "Rent transfer", "Online shop", "Pharmacy", "Bus pass", "Mobile plan")[k % 9]
        amt = [-62.40, -88.15, 2450.00, -4.80, -1100.00, -39.99, -18.25, -55.00, -24.00][k % 9]
        bal += amt
        rows.append((f"{(day - 1) % 28 + 1:02d} Sep", desc, amt, bal))
    for pg_no, chunk in enumerate((rows[:17], rows[17:])):
        p = newpage(d)
        p.draw_rect(pymupdf.Rect(0, 0, 612, 70), fill=(0.08, 0.35, 0.3), width=0)
        p.insert_text((54, 44), "EVERGREEN COMMUNITY BANK", fontname="hebo", fontsize=16, color=(1, 1, 1))
        p.insert_text((54, 100), "Statement of account", fontname="hebo", fontsize=14)
        p.insert_text((54, 118), "Account holder: A. SAMPLE · Account 0099-1122-3344 (FICTIONAL) · September 2026", fontname="helv", fontsize=9)
        xs = [54, 120, 380, 460, 558]
        y0 = 150
        p.draw_rect(pymupdf.Rect(xs[0], y0, xs[-1], y0 + 20), fill=(0.9, 0.94, 0.92), width=0)
        for c, t in enumerate(("Date", "Description", "Amount", "Balance")):
            p.insert_text((xs[c] + 4, y0 + 14), t, fontname="hebo", fontsize=9.5)
        for r, (dt, desc, amt, b) in enumerate(chunk):
            y = y0 + 20 + r * 22
            p.insert_text((xs[0] + 4, y + 15), dt, fontname="helv", fontsize=9.5)
            p.insert_text((xs[1] + 4, y + 15), desc, fontname="helv", fontsize=9.5)
            for c, val in ((2, f"{amt:,.2f}"), (3, f"{b:,.2f}")):
                p.insert_text((xs[c + 1] - 6 - pymupdf.get_text_length(val, "helv", 9.5), y + 15), val, fontname="helv", fontsize=9.5, color=(0.7, 0.1, 0.1) if (c == 2 and amt < 0) else (0, 0, 0))
            p.draw_line((xs[0], y + 22), (xs[-1], y + 22), width=0.4, color=(0.7, 0.7, 0.7))
        p.insert_text((54, 760), f"Page {pg_no + 1} of 2 · Synthetic statement for testing — all figures invented.", fontname="heit", fontsize=8)
    save_scanned(d, "DOCUMENT-05-bank-statement", skew=0.3, seed=50)


# ------------------------------------------------------------------ 06 resume (native)
def resume():
    d = pymupdf.open()
    p = newpage(d)
    p.draw_rect(pymupdf.Rect(0, 0, 612, 96), fill=(0.17, 0.24, 0.35), width=0)
    p.insert_text((50, 52), "Jordan A. Whitfield", fontname="hebo", fontsize=26, color=(1, 1, 1))
    p.insert_text((50, 74), "Senior Data Analyst · jordan.whitfield@example.test · (555) 018-9921 · Utopia City", fontname="helv", fontsize=9.5, color=(0.85, 0.9, 1))
    y = 124
    def section(title):
        nonlocal y
        p.insert_text((50, y), title.upper(), fontname="hebo", fontsize=11, color=(0.17, 0.24, 0.35))
        p.draw_line((50, y + 4), (562, y + 4), width=0.8, color=(0.17, 0.24, 0.35))
        y += 22
    section("Summary")
    for line in ("Analyst with 8 years of experience turning messy operational data into decisions.", "Led a team of four, cut monthly reporting time by 60% and introduced a shared metrics layer."):
        p.insert_text((50, y), line, fontname="helv", fontsize=10); y += 15
    y += 10
    section("Experience")
    for role, org, dates, bullets in (
        ("Senior Data Analyst", "Contoso Retail (fictional)", "2022 – present", ("Built the weekly sales dashboard used by 120 managers.", "Automated stock forecasting; stock-outs fell 18%.", "Mentored three junior analysts.")),
        ("Data Analyst", "Fabrikam Logistics (fictional)", "2018 – 2022", ("Cleaned and joined 14 source systems into one warehouse.", "Presented quarterly findings to the board.")),
    ):
        p.insert_text((50, y), role, fontname="hebo", fontsize=10.5)
        p.insert_text((50 + pymupdf.get_text_length(role, "hebo", 10.5) + 6, y), "— " + org, fontname="helv", fontsize=10)
        p.insert_text((562 - pymupdf.get_text_length(dates, "heit", 9.5), y), dates, fontname="heit", fontsize=9.5)
        y += 16
        for b in bullets:
            p.insert_text((62, y), "•", fontname="helv", fontsize=10)
            p.insert_text((74, y), b, fontname="helv", fontsize=10); y += 14
        y += 8
    section("Education")
    p.insert_text((50, y), "B.Sc. Statistics", fontname="hebo", fontsize=10.5); p.insert_text((150, y), "— University of Utopia, 2017", fontname="helv", fontsize=10); y += 24
    section("Skills")
    xs, ys = [50, 230, 410, 562], [y, y + 22, y + 44]
    for yy in ys:
        p.draw_line((xs[0], yy), (xs[-1], yy), width=0.5, color=(0.7, 0.7, 0.7))
    for r, row in enumerate((("SQL", "Python", "Power BI"), ("Forecasting", "A/B testing", "Data modelling"))):
        for c, t in enumerate(row):
            p.insert_text((xs[c] + 4, ys[r] + 15), t, fontname="helv", fontsize=10)
    d.save(os.path.join(OUT, "DOCUMENT-06-resume-native.pdf"))


# ------------------------------------------------------------------ 07 scanned letter (clean, plain)
LETTER_BODY = (
    "Thank you for your letter of 12 September regarding the planned maintenance of the shared garden. "
    "The residents' committee met on Tuesday and agreed that the work should start in the first week of November, "
    "subject to the weather.",
    "We will write to every household at least ten days before the work begins. Access to the garden will be limited "
    "for about two weeks, and a temporary path will be marked along the north fence so that nobody has to walk "
    "around the building.",
    "If you have questions in the meantime, please contact me on the number above, or leave a note with the porter. "
    "We are grateful for your patience and for the care you take of the garden.",
)


def scanned_letter():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((72, 80), "Margaret L. Hollis", fontname="tiro", fontsize=13)
    p.insert_text((72, 96), "Chair, Residents' Committee", fontname="tiro", fontsize=11)
    p.insert_text((72, 110), "Willow Court, Utopia City", fontname="tiro", fontsize=11)
    p.insert_text((72, 150), "3 October 2026", fontname="tiro", fontsize=11.5)
    p.insert_text((72, 190), "Mr. Anthony Reyes", fontname="tiro", fontsize=11.5)
    p.insert_text((72, 205), "Flat 4, Willow Court", fontname="tiro", fontsize=11.5)
    p.insert_text((72, 245), "Dear Mr. Reyes,", fontname="tiro", fontsize=11.5)
    y = 275
    for para in LETTER_BODY:
        p.insert_textbox(pymupdf.Rect(72, y, 540, y + 120), para, fontname="tiro", fontsize=11.5, lineheight=1.35)
        y += 112
    p.insert_text((72, y + 10), "Yours sincerely,", fontname="tiro", fontsize=11.5)
    p.insert_text((72, y + 70), "Margaret L. Hollis", fontname="tiro", fontsize=11.5)
    save_scanned(d, "DOCUMENT-07-scanned-letter", skew=0.25, seed=70)


# ------------------------------------------------------------------ 08 signed contract (2 pages)
CONTRACT = (
    ("1. Services", "The Contractor will provide the design and installation of the irrigation system described in Schedule A at the Client's property, completing the work within thirty (30) days of the start date."),
    ("2. Payment", "The Client will pay a fixed fee of $8,400, in two equal instalments: the first on signing and the second on completion. Late payments incur a charge of 1.5% per month."),
    ("3. Warranty", "The Contractor warrants the workmanship for twelve (12) months from completion and will repair defects at no charge, excluding damage caused by misuse or frost."),
    ("4. Termination", "Either party may end this agreement with fourteen (14) days' written notice. Work completed to the date of termination will be paid for pro rata."),
)


def contract():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((54, 76), "SERVICE AGREEMENT", fontname="tibo", fontsize=17)
    p.insert_text((54, 94), "between Greenfield Landscaping Ltd (the Contractor) and J. Sample (the Client) — fictional parties", fontname="tiit", fontsize=10)
    y = 130
    for head, body in CONTRACT:
        p.insert_text((54, y), head, fontname="tibo", fontsize=11.5)
        p.insert_textbox(pymupdf.Rect(54, y + 6, 558, y + 90), body, fontname="tiro", fontsize=11, lineheight=1.3)
        y += 100
    p.insert_text((54, 760), "Page 1 of 2", fontname="tiro", fontsize=9)
    p = newpage(d)
    p.insert_text((54, 76), "5. Governing terms", fontname="tibo", fontsize=11.5)
    p.insert_textbox(pymupdf.Rect(54, 82, 558, 160), "This agreement is the entire understanding between the parties and may be changed only in writing signed by both. It is governed by the laws of Utopia.", fontname="tiro", fontsize=11, lineheight=1.3)
    p.insert_text((54, 210), "Signed by the parties on 5 October 2026:", fontname="tiro", fontsize=11)
    for k, (who, seed) in enumerate((("For the Contractor — Greenfield Landscaping Ltd", 31), ("The Client — J. Sample", 32))):
        x = 54 + k * 262
        p.draw_line((x, 330), (x + 220, 330), width=0.8)
        p.insert_text((x, 344), who, fontname="tiro", fontsize=9.5)
        scribble(p, x + 14, 320, 150, seed=seed)
        p.insert_text((x, 370), "Date: 05 / 10 / 2026", fontname="tiro", fontsize=9.5)
    p.draw_circle((300, 470), 40, color=(0.1, 0.2, 0.6), width=2)
    p.insert_text((272, 466), "WITNESSED", fontname="hebo", fontsize=8, color=(0.1, 0.2, 0.6))
    p.insert_text((54, 760), "Page 2 of 2", fontname="tiro", fontsize=9)
    save_scanned(d, "DOCUMENT-08-signed-contract", skew=0.3, seed=80)


# ------------------------------------------------------------------ images: ID card, form png, receipt, photo, screenshot, table
def id_card():
    W, H = 1011, 638
    im = Image.new("RGB", (W, H), (236, 242, 248))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 96), fill=(20, 60, 120))
    d.text((34, 26), "NATIONAL IDENTITY CARD — SPECIMEN", fill=(255, 255, 255), font=pil_font("arialbd.ttf", 34))
    d.text((W - 150, 30), "UTOPIA", fill=(255, 215, 90), font=pil_font("arialbd.ttf", 28))
    im.paste(avatar(w=260, h=330, seed=7, tone=(205, 165, 135)), (40, 130))
    d.rectangle((40, 130, 300, 460), outline=(60, 60, 60), width=2)
    f, fb = pil_font("arial.ttf", 22), pil_font("arialbd.ttf", 30)
    y = 128
    for lab, val in (("Surname", "OKAFOR"), ("Given names", "DANIEL RAY"), ("Date of birth", "08 FEB 2001"), ("Sex", "M"), ("ID number", "UT-4471-0982-K"), ("Valid until", "30 NOV 2033")):
        d.text((340, y), lab, fill=(90, 100, 120), font=f)
        d.text((340, y + 24), val, fill=(10, 10, 10), font=fb)
        y += 74
    for k in range(60):
        d.rectangle((60 + k * 14, 500, 60 + k * 14 + rng.choice((3, 5, 8)), 590), fill=(20, 20, 20))
    d.text((580, 520), "SYNTHETIC — INVENTED DATA", fill=(160, 40, 40), font=pil_font("arialbd.ttf", 24))
    im = scan_look(im, 90, skew=-1.2, strength=0.8)
    im.save(os.path.join(OUT, "DOCUMENT-09-id-card-image.png"))


def filled_form_png():
    application("_tmp_form")
    # the same drawn page, as a straight PNG photo of a form (phone-scan look: slightly warm, blurred)
    ref = pymupdf.open(os.path.join(REFS, "_tmp_form-ref.pdf"))
    im = raster(ref[0], 170)
    ref.close()
    im = scan_look(im, 100, skew=0.9, strength=1.2)
    im.save(os.path.join(OUT, "DOCUMENT-10-filled-form.png"))
    os.remove(os.path.join(OUT, "_tmp_form.pdf"))
    os.remove(os.path.join(REFS, "_tmp_form-ref.pdf"))


def receipt():
    W, H = 640, 1500
    im = Image.new("RGB", (W, H), (250, 249, 244))
    d = ImageDraw.Draw(im)
    mono, monob = pil_font("cour.ttf", 26), pil_font("courbd.ttf", 28)
    y = 40
    d.text((120, y), "CORNER MARKET (FICTIONAL)", fill=(20, 20, 20), font=monob); y += 38
    d.text((150, y), "21 Mill Street, Utopia City", fill=(40, 40, 40), font=mono); y += 32
    d.text((190, y), "Tel 555 010 7788", fill=(40, 40, 40), font=mono); y += 56
    d.text((30, y), "04/10/2026  14:32  Till 2  Cashier: JO", fill=(40, 40, 40), font=pil_font("cour.ttf", 22)); y += 44
    d.line((30, y, W - 30, y), fill=(60, 60, 60), width=2); y += 14
    items = (("Bananas 1.2kg", 1.79), ("Whole milk 2L", 2.10), ("Sourdough loaf", 3.45), ("Free-range eggs x12", 4.20), ("Cheddar 400g", 5.60), ("Orange juice 1L", 2.95), ("Dish soap", 1.85), ("Tomatoes 500g", 2.30))
    total = 0
    for name, price in items:
        d.text((30, y), name, fill=(25, 25, 25), font=mono)
        s = f"{price:6.2f}"
        d.text((W - 30 - d.textlength(s, font=mono), y), s, fill=(25, 25, 25), font=mono)
        total += price; y += 40
    y += 6
    d.line((30, y, W - 30, y), fill=(60, 60, 60), width=2); y += 16
    for lab, val, f in (("SUBTOTAL", total, mono), ("VAT incl.", total * 0.1667, mono), ("TOTAL", total, monob)):
        d.text((30, y), lab, fill=(20, 20, 20), font=f)
        s = f"{val:6.2f}"
        d.text((W - 30 - d.textlength(s, font=f), y), s, fill=(20, 20, 20), font=f); y += 44
    y += 14
    d.text((30, y), "CARD ****4821  APPROVED", fill=(40, 40, 40), font=mono); y += 70
    for k in range(70):
        d.rectangle((70 + k * 7.4, y, 70 + k * 7.4 + rng.choice((2, 3, 5)), y + 120), fill=(20, 20, 20))
    y += 150
    d.text((110, y), "THANK YOU — COME AGAIN", fill=(30, 30, 30), font=mono)
    im = scan_look(im.crop((0, 0, W, y + 70)), 110, skew=1.5, strength=1.3)
    im.save(os.path.join(OUT, "DOCUMENT-11-receipt.jpg"), "JPEG", quality=88)


def photo_with_text():
    W, H = 1600, 1066
    y = np.linspace(0, 1, H)[:, None, None]
    sky = np.array([110, 170, 235], np.float32)
    grass = np.array([60, 130, 70], np.float32)
    a = np.where(y < 0.55, sky * (1 - y * 0.5), grass * (0.6 + y * 0.5)) * np.ones((H, W, 3), np.float32)
    xx = np.linspace(0, 6 * math.pi, W)
    ridge = (0.5 + 0.06 * np.sin(xx) + 0.03 * np.sin(2.7 * xx)) * H
    for x in range(W):
        a[int(ridge[x]) : int(ridge[x]) + 160, x] = np.array([85, 100, 120]) * (0.8 + 0.2 * np.sin(x / 40.0))
    a += nrng.normal(0, 6, a.shape)
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    d = ImageDraw.Draw(im)
    d.rectangle((520, 620, 1080, 860), fill=(250, 248, 240), outline=(60, 40, 20), width=8)
    d.text((560, 650), "LAKESIDE CAFE", fill=(120, 30, 30), font=pil_font("arialbd.ttf", 74))
    d.text((590, 760), "Open daily 8–6", fill=(40, 40, 40), font=pil_font("arial.ttf", 56))
    d.rectangle((780, 860, 820, 1066), fill=(110, 80, 50))
    im.save(os.path.join(OUT, "DOCUMENT-14-photo-with-text.png"))


def screenshot():
    W, H = 1440, 900
    im = Image.new("RGB", (W, H), (245, 247, 250))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W, 56), fill=(255, 255, 255)); d.line((0, 56, W, 56), fill=(220, 224, 230), width=2)
    d.text((24, 14), "Acme Dashboard", fill=(30, 40, 60), font=pil_font("arialbd.ttf", 26))
    for k, t in enumerate(("Overview", "Orders", "Customers", "Reports")):
        d.text((330 + k * 130, 18), t, fill=(70, 80, 100) if k else (20, 90, 200), font=pil_font("arial.ttf", 22))
    d.rectangle((0, 56, 230, H), fill=(36, 44, 62))
    for k, t in enumerate(("Home", "Sales", "Inventory", "Settings")):
        d.text((30, 90 + k * 52), t, fill=(210, 218, 232), font=pil_font("arial.ttf", 24))
    for k, (lab, val) in enumerate((("Revenue", "$48,210"), ("Orders", "1,284"), ("Refunds", "37"))):
        x = 270 + k * 380
        d.rounded_rectangle((x, 100, x + 340, 250), radius=14, fill=(255, 255, 255), outline=(222, 226, 232), width=2)
        d.text((x + 24, 124), lab, fill=(110, 120, 140), font=pil_font("arial.ttf", 22))
        d.text((x + 24, 160), val, fill=(20, 30, 50), font=pil_font("arialbd.ttf", 52))
    d.rounded_rectangle((270, 290, 1400, 860), radius=14, fill=(255, 255, 255), outline=(222, 226, 232), width=2)
    for k, h in enumerate((220, 300, 180, 380, 260, 340, 420, 300)):
        d.rectangle((330 + k * 130, 800 - h, 330 + k * 130 + 80, 800), fill=(40, 110, 220))
    d.text((300, 305), "Monthly sales", fill=(30, 40, 60), font=pil_font("arialbd.ttf", 28))
    im.save(os.path.join(OUT, "DOCUMENT-17-screenshot.png"))


def table_image():
    W, H = 1400, 760
    im = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    f, fb = pil_font("arial.ttf", 30), pil_font("arialbd.ttf", 30)
    d.text((40, 24), "Quarterly sales by region (USD thousands)", fill=(20, 20, 20), font=pil_font("arialbd.ttf", 36))
    xs, y0 = [40, 380, 620, 860, 1100, 1360], 100
    d.rectangle((xs[0], y0, xs[-1], y0 + 64), fill=(30, 90, 160))
    for c, t in enumerate(("Region", "Q1", "Q2", "Q3", "Q4")):
        d.text((xs[c] + 20, y0 + 16), t, fill=(255, 255, 255), font=fb)
    data = (("North", 412, 455, 498, 540), ("South", 388, 402, 431, 466), ("East", 455, 470, 512, 560), ("West", 301, 330, 349, 388), ("Total", 1556, 1657, 1790, 1954))
    for r, row in enumerate(data):
        y = y0 + 64 + r * 80
        if r == len(data) - 1:
            d.rectangle((xs[0], y, xs[-1], y + 80), fill=(222, 232, 245))
        for c, v in enumerate(row):
            d.text((xs[c] + 20, y + 22), str(v), fill=(20, 20, 20), font=fb if r == len(data) - 1 else f)
        d.line((xs[0], y + 80, xs[-1], y + 80), fill=(150, 150, 150), width=2)
    for x in xs:
        d.line((x, y0, x, y0 + 64 + len(data) * 80), fill=(150, 150, 150), width=2)
    im.save(os.path.join(OUT, "DOCUMENT-18-table-image.png"))


# ------------------------------------------------------------------ 12 table report, 13 brochure (native)
def table_report():
    d = pymupdf.open()
    p = newpage(d)
    p.insert_text((54, 72), "Quarterly Operations Report — Q3 2026", fontname="hebo", fontsize=18)
    p.insert_text((54, 92), "Prepared for the leadership team · all figures invented for testing.", fontname="heit", fontsize=9.5)
    p.insert_text((54, 128), "Regional performance", fontname="hebo", fontsize=12, color=(0.1, 0.3, 0.55))
    xs, ys = [54, 170, 280, 390, 500, 558], [140 + 26 * k for k in range(6)]
    p.draw_rect(pymupdf.Rect(xs[0], ys[0], xs[-1], ys[1]), fill=(0.15, 0.35, 0.6), width=0)
    p.draw_rect(pymupdf.Rect(xs[0], ys[5] - 26, xs[-1], ys[5]), fill=(0.88, 0.92, 0.97), width=0)
    for y in ys:
        p.draw_line((xs[0], y), (xs[-1], y), width=0.7, color=(0.15, 0.35, 0.6))
    for x in xs:
        p.draw_line((x, ys[0]), (x, ys[-1]), width=0.7, color=(0.15, 0.35, 0.6))
    data = (("Region", "Revenue", "Orders", "Returns", "On-time"), ("North", "£412,300", "8,214", "2.1%", "96%"), ("South", "£388,950", "7,902", "2.6%", "94%"), ("East", "£455,120", "9,033", "1.8%", "97%"), ("Total", "£1,256,370", "25,149", "2.2%", "96%"))
    for r, row in enumerate(data):
        for c, t in enumerate(row):
            f = "hebo" if r in (0, 4) else "helv"
            col = (1, 1, 1) if r == 0 else (0, 0, 0)
            if c == 0 or r == 0:
                p.insert_text((xs[c] + 6, ys[r] + 17), t, fontname=f, fontsize=10, color=col)
            else:
                p.insert_text((xs[c + 1] - 8 - pymupdf.get_text_length(t, f, 10), ys[r] + 17), t, fontname=f, fontsize=10)
    p.insert_text((54, 330), "Staffing plan", fontname="hebo", fontsize=12, color=(0.1, 0.3, 0.55))
    xs2, ys2 = [54, 210, 350, 456, 558], [342 + 24 * k for k in range(5)]
    for y in ys2:
        p.draw_line((xs2[0], y), (xs2[-1], y), width=0.7)
    for x in xs2:
        p.draw_line((x, ys2[0]), (x, ys2[-1]), width=0.7)
    for r, row in enumerate((("Team", "Q1", "Q2", "Q3"), ("Warehouse", "48", "52", "55"), ("Support", "23", "30", "35"), ("Finance", "12", "12", "14"))):
        for c, t in enumerate(row):
            p.insert_text((xs2[c] + 6, ys2[r] + 16), t, fontname="hebo" if r == 0 else "helv", fontsize=10)
    p.insert_text((54, 480), "Top issues", fontname="hebo", fontsize=12, color=(0.1, 0.3, 0.55))
    for k, t in enumerate(("1. Late supplier confirmations on imported stock", "2. Returns backlog at the West depot", "3. Dashboard refresh fails on Mondays")):
        p.insert_text((62, 500 + k * 16), t, fontname="helv", fontsize=10)
    d.save(os.path.join(OUT, "DOCUMENT-12-table-report.pdf"))


def brochure():
    d = pymupdf.open()
    p = newpage(d)
    p.draw_rect(pymupdf.Rect(0, 0, 612, 230), fill=(0.1, 0.45, 0.4), width=0)
    insert_pil(p, photo_like(400, 220, 4), pymupdf.Rect(212, 0, 612, 230))
    p.draw_rect(pymupdf.Rect(0, 0, 232, 230), fill=(0.1, 0.45, 0.4), width=0)
    p.insert_text((28, 90), "Discover", fontname="hebo", fontsize=30, color=(1, 1, 1))
    p.insert_text((28, 124), "Lake Utopia", fontname="hebo", fontsize=30, color=(1, 0.88, 0.45))
    p.insert_text((28, 156), "A weekend by the water", fontname="heit", fontsize=12, color=(1, 1, 1))
    cols = ((40, "Stay", "Twelve lakeside cabins with kitchens, wood stoves and decks facing the water. Open all year."), (225, "Explore", "Kayak hire, marked trails for every ability and a ranger-led evening walk each Friday."), (410, "Eat", "The boathouse café serves breakfast, lunch and a seasonal dinner menu using local produce."))
    for x, head, body in cols:
        p.draw_rect(pymupdf.Rect(x, 262, x + 160, 266), fill=(0.1, 0.45, 0.4), width=0)
        p.insert_text((x, 290), head, fontname="hebo", fontsize=15, color=(0.1, 0.45, 0.4))
        p.insert_textbox(pymupdf.Rect(x, 300, x + 160, 420), body, fontname="helv", fontsize=10.5, lineheight=1.35)
    insert_pil(p, photo_like(512, 200, 9), pymupdf.Rect(40, 450, 552, 650))
    p.draw_rect(pymupdf.Rect(40, 670, 552, 730), fill=(0.97, 0.93, 0.8), width=0)
    p.insert_text((58, 697), "Book now: lakeutopia.example · 555 010 4400", fontname="hebo", fontsize=14)
    p.insert_text((58, 716), "Fictional resort — details invented for testing.", fontname="heit", fontsize=9.5)
    d.save(os.path.join(OUT, "DOCUMENT-13-brochure.pdf"))


def photo_like(w, h, seed):
    r = np.random.default_rng(seed)
    y = np.linspace(0, 1, h)[:, None, None]
    a = np.array([90, 150 + seed * 4, 210 - seed * 6], np.float32) * (1 - 0.5 * y) + np.array([30, 80, 50], np.float32) * y
    a = a * np.ones((h, w, 3), np.float32) + r.normal(0, 8, (h, w, 3))
    xx = np.linspace(0, 5 * math.pi, w)
    ridge = ((0.55 + 0.08 * np.sin(xx + seed)) * h).astype(int)
    for x in range(w):
        a[ridge[x] :, x] *= 0.55
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1))


# ------------------------------------------------------------------ 15, 16 Word documents
def word_docs():
    from docx import Document
    from docx.enum.section import WD_SECTION
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    def shade(cell, fill):
        tc = cell._tc.get_or_add_tcPr()
        s = OxmlElement("w:shd")
        s.set(qn("w:val"), "clear"); s.set(qn("w:color"), "auto"); s.set(qn("w:fill"), fill)
        tc.append(s)

    doc = Document()
    st = doc.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(11)
    for s in doc.sections:
        s.left_margin = s.right_margin = Inches(1); s.top_margin = Inches(1); s.bottom_margin = Inches(0.9)
    h = doc.add_paragraph(); r = h.add_run("Brightside Consulting Ltd"); r.bold = True; r.font.size = Pt(16); r.font.color.rgb = RGBColor(0x1F, 0x4E, 0x79)
    doc.add_paragraph("27 Harbour Street, Utopia City · hello@brightside.example · 555 010 2020")
    doc.add_paragraph("4 October 2026")
    for t in ("Ms. Elena Marchetti", "Director of Operations", "Fabrikam Logistics (fictional)", "88 Dockside Way, Utopia City"):
        doc.add_paragraph(t).paragraph_format.space_after = Pt(0)
    doc.add_paragraph()
    p = doc.add_paragraph(); r = p.add_run("Re: Proposal for the warehouse reporting project"); r.bold = True
    doc.add_paragraph("Dear Ms. Marchetti,")
    for t in ("Thank you for meeting with us last week. As discussed, we propose a six-week engagement to consolidate your stock, orders and returns data into a single dashboard that your managers can open every morning.",
              "The work has three phases: a short discovery to confirm the questions the dashboard must answer, a build phase with weekly demonstrations, and a handover with training for your team. We will keep a running list of decisions so that nothing is lost between meetings."):
        q = doc.add_paragraph(t); q.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.add_paragraph("Our fee is a fixed £18,500 plus VAT, invoiced in three equal instalments. We can start as early as 2 November.")
    doc.add_paragraph("With kind regards,")
    doc.add_paragraph()
    doc.add_paragraph("Samuel Okonkwo-Reid\nPartner, Brightside Consulting Ltd")
    doc.save(os.path.join(OUT, "DOCUMENT-15-native-business-letter.docx"))

    doc = Document()
    st = doc.styles["Normal"]; st.font.name = "Cambria"; st.font.size = Pt(11)
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(1)
    sec.header.paragraphs[0].text = "Annual Operations Review 2026 — Confidential (fictional)"
    fp = sec.footer.paragraphs[0]; fp.text = "Utopia Logistics · page footer"; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    t = doc.add_heading("Annual Operations Review", 0)
    doc.add_paragraph("Prepared by the Operations Team · all names and numbers invented for testing").runs[0].italic = True
    doc.add_heading("1. Summary", 1)
    doc.add_paragraph("This review covers throughput, quality and cost across the year. Throughput rose by 11%, while the cost per parcel fell by 6%. The main risks are supplier lead times and the ageing sorting line at the northern depot.")
    for b in ("Throughput: 2.4 million parcels (up 11%)", "On-time delivery: 96.2% (target 95%)", "Cost per parcel: £1.84 (down 6%)"):
        doc.add_paragraph(b, style="List Bullet")
    doc.add_heading("2. Results by region", 1)
    tbl = doc.add_table(rows=1, cols=4)
    tbl.style = "Table Grid"
    for i, tx in enumerate(("Region", "Parcels (k)", "On-time", "Cost / parcel")):
        c = tbl.rows[0].cells[i]; c.text = tx; shade(c, "1F4E79")
        for r_ in c.paragraphs[0].runs:
            r_.bold = True; r_.font.color.rgb = RGBColor(255, 255, 255)
    for row in (("North", "820", "96.8%", "£1.71"), ("South", "690", "95.9%", "£1.86"), ("East", "540", "96.4%", "£1.90"), ("West", "350", "95.2%", "£2.01")):
        cells = tbl.add_row().cells
        for i, tx in enumerate(row):
            cells[i].text = tx
            if i:
                cells[i].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
    doc.add_paragraph()
    doc.add_heading("3. Throughput by quarter", 1)
    buf = io.BytesIO()
    chart = Image.new("RGB", (640, 260), (255, 255, 255))
    cd = ImageDraw.Draw(chart)
    for k, hgt in enumerate((120, 150, 175, 205)):
        cd.rectangle((70 + k * 140, 230 - hgt, 150 + k * 140, 230), fill=(31, 78, 121))
        cd.text((90 + k * 140, 236), f"Q{k + 1}", fill=(0, 0, 0))
    cd.line((50, 230, 620, 230), fill=(0, 0, 0), width=2); cd.line((50, 20, 50, 230), fill=(0, 0, 0), width=2)
    chart.save(buf, "PNG"); buf.seek(0)
    doc.add_picture(buf, width=Inches(4.6))
    doc.add_paragraph("Figure 1. Parcels handled per quarter (index).").runs[0].italic = True
    doc.add_page_break()
    doc.add_heading("4. Outlook", 1)
    s2 = doc.add_section(WD_SECTION.CONTINUOUS)
    cols = s2._sectPr.xpath("./w:cols")
    c = cols[0] if cols else OxmlElement("w:cols")
    c.set(qn("w:num"), "2"); c.set(qn("w:space"), "540")
    if not cols:
        s2._sectPr.append(c)
    for t in ("The coming year focuses on replacing the northern sorting line, shortening supplier lead times with two new regional partners, and extending the morning dashboard to every depot manager.",
              "We expect throughput to grow a further 8% without new floor space, because the new line removes the main bottleneck. Cost per parcel should fall below £1.75 once the line is bedded in.",
              "The largest uncertainty is the schedule of the supplier contracts; we will report on it monthly.") * 2:
        q = doc.add_paragraph(t); q.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    doc.save(os.path.join(OUT, "DOCUMENT-16-complex-word-report.docx"))


if __name__ == "__main__":
    passport()
    application()
    certificate()
    invoice(False)
    invoice(True)
    statement()
    resume()
    scanned_letter()
    contract()
    id_card()
    filled_form_png()
    receipt()
    table_report()
    brochure()
    photo_with_text()
    word_docs()
    screenshot()
    table_image()
    print("\n".join(sorted(f for f in os.listdir(OUT) if f.startswith("DOCUMENT-"))))
