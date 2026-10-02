"""Scanned PDF → Word fixtures (SCAN-WORD-01 … 07), made the way a flatbed scan looks.

    python qa/scripts/scan-fixtures.py          -> qa/fidelity/scan-word/SCAN-WORD-*.pdf (+ *-ref.pdf)

Each fixture is an image-only PDF: a page rendered at 200 dpi, on tinted paper, ink lifted to dark grey,
slightly blurred, with sensor noise, saved as JPEG — no text layer. The "-ref.pdf" next to it is the native
original the scan was made from (for text recall). SCAN-WORD-08 is the user's own scan, read in place and
never copied (qa/scripts/fid-scans.mjs).

    01-form            application form (labels, fill-in lines, boxes)
    02-invoice         invoice (header block, item table, totals)
    03-transcript      transcript (course tables)
    04-table-heavy     table report
    05-two-column      two-column report
    06-stamp-signature letter with a round ink stamp and a handwritten signature
    07-mixed-rules     boxed rows, a double rule, a shaded panel, underlines, a ruled table
"""
import io
import math
import os
import random

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

CORPUS = os.path.join("qa", "fidelity", "corpus")
OUT = os.path.join("qa", "fidelity", "scan-word")
os.makedirs(OUT, exist_ok=True)
DPI = 200
rnd = np.random.default_rng(7)


def scan_look(img: Image.Image, seed: int) -> Image.Image:
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    # Scanner contrast: ink at ~35, paper at a warm off-white.
    paper = np.array([246, 244, 238], np.float32)
    a = 35 + (a / 255.0) * (paper - 35)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    a = np.asarray(out, dtype=np.float32)
    a += np.random.default_rng(seed).normal(0, 3.0, a.shape[:2])[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def write_scan(pages: list[Image.Image], sizes: list[tuple[float, float]], path: str):
    doc = pymupdf.open()
    for img, (w, h) in zip(pages, sizes):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=85)
        page = doc.new_page(width=w, height=h)
        page.insert_image(page.rect, stream=buf.getvalue())
    doc.save(path, deflate=True)


def raster(page: pymupdf.Page) -> Image.Image:
    pix = page.get_pixmap(dpi=DPI, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def from_corpus(name: str, out: str, pages=2, extra=None):
    src = pymupdf.open(os.path.join(CORPUS, f"{name}.pdf"))
    n = min(pages, src.page_count)
    imgs, sizes = [], []
    for i in range(n):
        img = raster(src[i])
        if extra:
            extra(img, i)
        imgs.append(scan_look(img, 100 + i))
        sizes.append((src[i].rect.width, src[i].rect.height))
    write_scan(imgs, sizes, os.path.join(OUT, f"{out}.pdf"))
    ref = pymupdf.open()
    ref.insert_pdf(src, from_page=0, to_page=n - 1)
    ref.save(os.path.join(OUT, f"{out}-ref.pdf"))


def stamp_and_signature(img: Image.Image, i: int):
    if i:
        return
    d = ImageDraw.Draw(img)
    k = DPI / 72
    # A round ink stamp (blue-violet, two rings, text arcs as dashes), lower right.
    cx, cy, r = 470 * k, 640 * k, 46 * k
    for rr, wdt in ((r, int(2.2 * k)), (r * 0.78, int(1.2 * k))):
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), outline=(60, 50, 150), width=wdt)
    for t in range(0, 360, 9):
        a = math.radians(t)
        x, y = cx + r * 0.89 * math.cos(a), cy + r * 0.89 * math.sin(a)
        d.ellipse((x - 1.6 * k, y - 1.6 * k, x + 1.6 * k, y + 1.6 * k), fill=(60, 50, 150))
    d.text((cx - 22 * k, cy - 6 * k), "APPROVED", fill=(60, 50, 150))
    d.line((cx - 30 * k, cy + 10 * k, cx + 30 * k, cy + 10 * k), fill=(60, 50, 150), width=int(1.5 * k))
    # A handwritten signature: a smooth random scribble, lower left.
    rs = random.Random(5)
    pts, x, y = [], 80 * k, 660 * k
    for s in range(70):
        x += rs.uniform(1.0, 3.2) * k
        y = 660 * k + math.sin(s / 3.0) * 9 * k + rs.uniform(-2, 2) * k
        pts.append((x, y))
    d.line(pts, fill=(25, 30, 90), width=int(1.4 * k), joint="curve")


def mixed_rules(out: str):
    """A page drawn natively (so it has a text reference), then scanned."""
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    tb, tr = "Times-Bold", "Times-Roman"
    p.insert_text((54, 70), "PERMIT APPLICATION RECORD", fontname=tb, fontsize=18)
    p.draw_line((50, 80), (562, 80), width=1)
    p.draw_line((50, 83), (562, 83), width=1)  # a double rule
    p.insert_text((54, 120), "Applicant", fontname=tb, fontsize=11)
    p.insert_text((150, 120), "Maria Lopez", fontname=tr, fontsize=12)
    p.draw_line((146, 124), (400, 124), width=0.8)
    p.insert_text((54, 150), "Reference", fontname=tb, fontsize=11)
    p.insert_text((150, 150), "PR-2026-0418", fontname=tr, fontsize=12)
    p.draw_line((146, 154), (400, 154), width=0.8)
    # A boxed row.
    p.draw_rect(pymupdf.Rect(50, 180, 562, 210), width=1)
    p.insert_text((58, 200), "ISSUED", fontname=tb, fontsize=11)
    p.insert_text((130, 200), "03/14/2026", fontname=tr, fontsize=12)
    p.insert_text((300, 200), "EXPIRES", fontname=tb, fontsize=11)
    p.insert_text((380, 200), "03/13/2027", fontname=tr, fontsize=12)
    # A shaded panel with a note.
    p.draw_rect(pymupdf.Rect(50, 235, 562, 290), color=(0.4, 0.4, 0.4), fill=(0.88, 0.9, 0.86), width=0.8)
    p.insert_text((60, 256), "Conditions: work hours are limited to 8am to 6pm on weekdays.", fontname=tr, fontsize=11)
    p.insert_text((60, 276), "The permit must be displayed at the site entrance.", fontname=tr, fontsize=11)
    # A ruled table.
    xs, ys = [50, 230, 400, 562], [320, 345, 370, 395, 420]
    for y in ys:
        p.draw_line((xs[0], y), (xs[-1], y), width=0.8)
    for x in xs:
        p.draw_line((x, ys[0]), (x, ys[-1]), width=0.8)
    rows = [("Inspection", "Date", "Result"), ("Foundation", "04/02/2026", "Passed"), ("Framing", "05/20/2026", "Passed"), ("Electrical", "06/11/2026", "Pending")]
    for r, row in enumerate(rows):
        for c, t in enumerate(row):
            p.insert_text((xs[c] + 8, ys[r] + 17), t, fontname=tb if r == 0 else tr, fontsize=11)
    p.insert_text((54, 470), "Inspector", fontname=tb, fontsize=11)
    p.draw_line((130, 474), (330, 474), width=0.8)
    p.insert_text((54, 520), "This record was produced for scanning tests.", fontname=tr, fontsize=10)
    ref = os.path.join(OUT, f"{out}-ref.pdf")
    doc.save(ref)
    write_scan([scan_look(raster(doc[0]), 300)], [(612, 792)], os.path.join(OUT, f"{out}.pdf"))


from_corpus("application-form", "SCAN-WORD-01-form", pages=2)
from_corpus("invoice", "SCAN-WORD-02-invoice", pages=1)
from_corpus("transcript", "SCAN-WORD-03-transcript", pages=2)
from_corpus("table-report", "SCAN-WORD-04-table-heavy", pages=2)
from_corpus("report-two-column", "SCAN-WORD-05-two-column", pages=1)
from_corpus("letter", "SCAN-WORD-06-stamp-signature", pages=1, extra=stamp_and_signature)
mixed_rules("SCAN-WORD-07-mixed-rules")
print("\n".join(sorted(f for f in os.listdir(OUT) if f.endswith(".pdf"))))
