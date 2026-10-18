"""Independent validation of edited PDFs (QA only — nothing here is part of the product).

    python qa/validate/editorcheck.py DIR           every NAME.pdf in DIR with NAME.orig.pdf and NAME.json

For each edited file:
  qpdf     pikepdf (libqpdf) opens it and `check()` reports no problems
  MuPDF    opens it, every page renders, and the text of the edited page has the new words and not the old
  poppler  `pdftotext` agrees (new present, old gone)
  pixels   rendered at 100 dpi, the edited page differs from the original only inside the edited line's box
           (changed pixels outside it, in per cent of the page, must be ~0); the other pages are identical
Prints one JSON line per file and a summary; exit status 1 if anything failed.
"""
import json
import os
import subprocess
import sys

import numpy as np
import pikepdf
import pymupdf

DPI = 100


def render(page):
    z = DPI / 72
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), colorspace=pymupdf.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.int16)


def words(page):
    return [w[4] for w in page.get_text("words")]


def check(path):
    base = path[:-4]
    meta = json.load(open(base + ".json", encoding="utf-8"))
    orig_path = base + ".orig.pdf"
    res = {"file": os.path.basename(path), "from": meta["from"], "to": meta["to"], "problems": []}
    # qpdf
    try:
        with pikepdf.open(path) as pk:
            problems = pk.check_pdf_syntax()  # libqpdf's structural check (what `qpdf --check` reports)
            if problems:
                res["problems"].append(f"qpdf: {problems[:2]}")
            # every page's content must also parse and every object must be readable
            for page in pk.pages:
                _ = page.Contents.read_bytes() if not isinstance(page.Contents, pikepdf.Array) else b"".join(c.read_bytes() for c in page.Contents)
    except Exception as e:  # noqa: BLE001
        res["problems"].append(f"qpdf failed to open: {e}")
    # MuPDF
    try:
        new = pymupdf.open(path)
        old = pymupdf.open(orig_path)
    except Exception as e:  # noqa: BLE001
        res["problems"].append(f"MuPDF failed to open: {e}")
        return res
    pg = meta["page"] - 1
    if new.page_count != old.page_count:
        res["problems"].append("page count changed")
        return res
    norm = lambda t: " ".join(t.split())  # noqa: E731  (line wraps must not matter)
    txt_new = norm(new[pg].get_text())
    txt_old = norm(old[pg].get_text())
    frm, to = norm(meta["from"]), norm(meta["to"])
    overlap = frm in to or to in frm  # an edit that only adds or only removes text leaves part of the old words in place
    if not overlap and txt_new.count(to) < txt_old.count(to) + 1:
        res["problems"].append("MuPDF: the new text is not in the extracted text")
    if overlap and to not in txt_new:
        res["problems"].append("MuPDF: the new text is not in the extracted text")
    if not overlap and txt_new.count(frm) != txt_old.count(frm) - 1:
        res["problems"].append("MuPDF: the old text is still in the extracted text (or too much was removed)")
    # poppler
    try:
        tn = norm(subprocess.run(["pdftotext", "-enc", "UTF-8", "-f", str(meta["page"]), "-l", str(meta["page"]), path, "-"], capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace").stdout)
        if (not overlap and (tn.count(to) < txt_old.count(to) + 1 or tn.count(frm) > txt_old.count(frm) - 1)) or (overlap and to not in tn):
            res["problems"].append("poppler: extraction disagrees")
    except Exception as e:  # noqa: BLE001
        res["problems"].append(f"pdftotext failed: {e}")
    # pixels
    for i in range(new.page_count):
        a, b = render(old[i]), render(new[i])
        if a.shape != b.shape:
            res["problems"].append(f"page {i + 1} size changed")
            continue
        diff = np.abs(a - b) > 24
        if i != pg:
            if diff.any():
                res["problems"].append(f"page {i + 1} changed ({diff.mean() * 100:.3f}%)")
            continue
        # the edited line's box: the old one, extended by the new words' boxes, padded
        x0, y0, x1, y1 = meta["bbox"]["x"], meta["bbox"]["y"], meta["bbox"]["x"] + meta["bbox"]["width"], meta["bbox"]["y"] + meta["bbox"]["height"]
        # pdf space (y up) → MuPDF page space (y down), and the page's own rotation/cropbox are handled by MuPDF's rect
        pr = old[i].rect
        mb = old[i].mediabox
        fy0, fy1 = (mb.y1 - y1), (mb.y1 - y0)
        box = pymupdf.Rect(x0, fy0, x1, fy1) * old[i].rotation_matrix
        box = pymupdf.Rect(min(box.x0, box.x1), min(box.y0, box.y1), max(box.x0, box.x1), max(box.y0, box.y1))
        for hit in new[i].search_for(to.split()[-1] if to.split() else to):
            box |= hit
        pad = 6
        z = DPI / 72
        mask = np.zeros(diff.shape, bool)
        # the whole line may have shifted: its box spans the page width of the line plus padding
        mask[max(0, int((box.y0 - pad) * z)) : int((box.y1 + pad) * z) + 1, max(0, int((box.x0 - pad) * z)) : int((min(box.x1 + 60, pr.x1)) * z) + 1] = True
        outside = diff & ~mask
        res["changedOutsidePct"] = round(float(outside.mean()) * 100, 4)
        res["changedInsidePx"] = int((diff & mask).sum())
        if outside.mean() * 100 > 0.02:
            res["problems"].append(f"{outside.mean() * 100:.3f}% of the page changed outside the edited line")
        if not (diff & mask).any():
            res["problems"].append("nothing changed inside the edited line")
    res["ok"] = not res["problems"]
    return res


def main(d):
    names = sorted(f[:-4] for f in os.listdir(d) if f.endswith(".pdf") and not f.endswith(".orig.pdf"))
    bad = 0
    for n in names:
        r = check(os.path.join(d, n + ".pdf"))
        bad += 0 if r["ok"] else 1
        print(json.dumps(r, ensure_ascii=False))
    print(json.dumps({"checked": len(names), "failed": bad}))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
