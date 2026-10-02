"""Scanned PDF → Word: does the Word document still look like the scan? — QA only.

    python qa/validate/scanform.py SRC.pdf WORD.pdf WORD.docx [--dir D --suffix S] [--expect expect.json]

SRC.pdf is the original (often image-only), WORD.pdf an independent rendering of WORD.docx (LibreOffice).
Both are rendered at the same scale and compared without trusting either side's text layer:

- layout: every word in the Word rendering must sit on ink at the same place in the original (its box,
  grown by 3 pt, holds ink whose own bounding box overlaps it well). Share of words in place, per page.
- rules: long thin dark lines (horizontal ≥ 60 pt, vertical ≥ 30 pt) found in both page images; share of
  the original's rule length drawn at the same place (±4 pt) in the Word rendering.
- garbage: words in the Word rendering with no ink under them in the original (invented text, OCR noise).
- typography: words whose glyph height follows the original's ink height (same scale ±25 %).
- tables: Word tables in the .docx (rows × columns, cell text).
- expect (optional, a JSON written for one document): phrases that must exist, share a line, sit inside a
  bordered box, or form a table with given cells; anchors that must stay in order top to bottom.

Writes original-page-N.png, word-page-N<suffix>.png and diff-page-N<suffix>.png (original ink red, Word
ink blue, both black) to --dir, and prints one JSON line.
"""
import argparse
import html
import json
import re
import sys

import numpy as np
import pymupdf
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
DPI = 110
K = DPI / 72  # pixels per point


def grey(page):
    pix = page.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.int16)


def ink_mask(img):
    # Ink = clearly darker than the page's own background (scans are off-white / tinted).
    bg = np.percentile(img, 75)
    return img < bg - 60


def runs(mask, axis, min_len_px, max_thick_px=4):
    """Long thin lines: rows (axis=0) or columns (axis=1) with a long continuous run of ink."""
    out = []
    lines = mask if axis == 0 else mask.T
    for i, row in enumerate(lines):
        if row.sum() < min_len_px:
            continue
        # continuous runs
        d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        for s, e in zip(starts, ends):
            if e - s >= min_len_px:
                out.append((i, s, e))
    # merge adjacent rows (a 2-px thick line is one rule)
    merged = []
    for i, s, e in sorted(out):
        if merged and i - merged[-1][0] <= 2 and min(e, merged[-1][2]) - max(s, merged[-1][1]) > 0.5 * (e - s):
            m = merged[-1]
            merged[-1] = (i, min(s, m[1]), max(e, m[2]), m[3] + 1)
        else:
            merged.append((i, s, e, 1))
    return [(i / K, s / K, e / K) for i, s, e, t in merged if t <= max_thick_px]


def rule_cover(src, out, tol=4.0):
    total = covered = 0.0
    for pos, a, b in src:
        total += b - a
        segs = sorted((max(a, oa), min(b, ob)) for op, oa, ob in out if abs(op - pos) <= tol and min(b, ob) > max(a, oa))
        end = a
        for sa, sb in segs:
            if sb > end:
                covered += sb - max(sa, end)
                end = sb
    return round(covered / total * 100, 1) if total else None


def tokens(text):
    """Comparable words: letters and digits only, lower case (OCR punctuation varies)."""
    out = []
    for t in text.split():
        t = re.sub(r"[^\w]", "", t, flags=re.UNICODE).lower()
        if t:
            out.append(t)
    return out


def text_recall(ref_pdf, out_docx):
    """Share of the original's words (as a multiset) found in the Word document's text."""
    import collections
    import zipfile
    ref = collections.Counter(tokens(" ".join(p.get_text() for p in pymupdf.open(ref_pdf))))
    xml = zipfile.ZipFile(out_docx).read("word/document.xml").decode("utf8")
    xml = re.sub(r"<w:tab/>|</w:p>", " ", xml)
    got = collections.Counter(tokens(html.unescape(" ".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>|(?<=>) (?=<)", xml)))))
    total = sum(ref.values())
    hit = sum(min(n, got[w]) for w, n in ref.items())
    return round(hit / max(1, total) * 100, 1)


def words_of(page):
    return [(w[0], w[1], w[2], w[3], w[4]) for w in page.get_text("words") if re.sub(r"\W+", "", w[4])]


def strip_rules(mask):
    """Ink without long thin lines (rows/columns of ≥ 30 pt continuous ink, ±1 px), so table borders next to
    a word don't count as that word's glyph height."""
    out = mask.copy()
    min_len = int(30 * K)
    for axis in (0, 1):
        lines = mask if axis == 0 else mask.T
        d = np.diff(np.pad(lines.astype(np.int8), ((0, 0), (1, 1))), axis=1)
        for i, j in zip(*np.where(d == 1)):
            e = j + np.argmax(d[i, j:] == -1)
            if e - j >= min_len:
                lo, hi = max(0, i - 1), i + 2
                if axis == 0:
                    out[lo:hi, j:e] = False
                else:
                    out[j:e, lo:hi] = False
    return out


def in_place(word, src_ink, out_ink):
    """The original has ink where this word is, of about the word's extent."""
    x0, y0, x1, y1 = [int(round(v * K)) for v in word[:4]]
    pad = int(3 * K)
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(src_ink.shape[1], x1 + pad), min(src_ink.shape[0], y1 + pad)
    region = src_ink[Y0:Y1, X0:X1]
    if region.size == 0 or region.mean() < 0.02:
        return False, 0.0, None
    ys, xs = np.where(region)
    sb = (xs.min() + X0, ys.min() + Y0, xs.max() + X0, ys.max() + Y0)
    ix = max(0, min(x1, sb[2]) - max(x0, sb[0]))
    iy = max(0, min(y1, sb[3]) - max(y0, sb[1]))
    inter = ix * iy
    union = (x1 - x0) * (y1 - y0) + (sb[2] - sb[0]) * (sb[3] - sb[1]) - inter
    iou = inter / union if union > 0 else 0
    # glyph-height agreement: ink height of the original vs the rendered word's own ink height
    oy, ox = np.where(out_ink[max(0, y0):y1, max(0, x0):x1])
    out_h = (oy.max() - oy.min() + 1) if oy.size else None
    src_h = sb[3] - sb[1] + 1
    ratio = (out_h / src_h) if out_h else None
    return iou >= 0.35, round(iou, 3), ratio


def overlay(a, b, path):
    ia, ib = ink_mask(a), ink_mask(b)
    h, w = max(ia.shape[0], ib.shape[0]), max(ia.shape[1], ib.shape[1])
    pa = np.zeros((h, w), bool)
    pb = np.zeros((h, w), bool)
    pa[: ia.shape[0], : ia.shape[1]] = ia
    pb[: ib.shape[0], : ib.shape[1]] = ib
    img = np.full((h, w, 3), 255, np.uint8)
    img[pa & ~pb] = (220, 40, 40)
    img[pb & ~pa] = (40, 90, 220)
    img[pa & pb] = (0, 0, 0)
    Image.fromarray(img).save(path)


def check_expect(exp, doc, out_doc_pdf):
    """Document-specific structure checks (see module doc)."""
    import docx as pydocx

    results = []
    pages = [words_of(p) for p in out_doc_pdf]
    norm = lambda s: re.sub(r"[^\w$/.,:-]+", "", s.lower())

    def find(phrase, page_no):
        # Punctuation-only tokens ("-") aren't words on either side.
        toks = [norm(t) for t in phrase.split() if re.sub(r"\W+", "", t)]
        ws = pages[page_no - 1] if page_no - 1 < len(pages) else []
        keys = [norm(w[4]) for w in ws]
        for i in range(len(keys) - len(toks) + 1):
            if keys[i : i + len(toks)] == toks:
                sel = ws[i : i + len(toks)]
                return (min(w[0] for w in sel), min(w[1] for w in sel), max(w[2] for w in sel), max(w[3] for w in sel))
        return None

    # Drawn lines per page (table borders are drawn as separate lines, boxes as rectangles or lines).
    segs = {}
    for pi, p in enumerate(out_doc_pdf):
        out = segs.setdefault(pi + 1, [])
        for d in p.get_drawings():
            for it in d["items"]:
                if it[0] == "l":
                    a_, b_ = it[1], it[2]
                    out.append((min(a_.x, b_.x), min(a_.y, b_.y), max(a_.x, b_.x), max(a_.y, b_.y)))
                elif it[0] == "re":
                    r = it[1]
                    out += [(r.x0, r.y0, r.x1, r.y0), (r.x0, r.y1, r.x1, r.y1), (r.x0, r.y0, r.x0, r.y1), (r.x1, r.y0, r.x1, r.y1)]

    def enclosed(pg, x0, y0, x1, y1):
        """Lines above, below, left and right of the box, each spanning it."""
        ls = segs.get(pg, [])
        hz = [l for l in ls if abs(l[3] - l[1]) < 1.5 and l[0] <= x0 + 2 and l[2] >= x1 - 2]
        vt = [l for l in ls if abs(l[2] - l[0]) < 1.5 and l[1] <= y0 + 2 and l[3] >= y1 - 2]
        above = [l for l in hz if l[1] <= y0 + 1 and y0 - l[1] < 40]
        below = [l for l in hz if l[1] >= y1 - 1 and l[1] - y1 < 45]
        left = [l for l in vt if l[0] <= x0 + 1 and x0 - l[0] < 60]
        right = [l for l in vt if l[0] >= x1 - 1 and l[0] - x1 < 300]
        return bool(above and below and left and right), (len(above), len(below), len(left), len(right))
    tables = [[[c.text.strip() for c in row.cells] for row in t.rows] for t in doc.tables]

    for c in exp.get("checks", []):
        kind, pg = c["kind"], c.get("page", 1)
        ok, detail = False, ""
        if kind == "present":
            box = find(c["phrase"], pg)
            ok, detail = box is not None, str(box)
        elif kind == "same_line":
            boxes = [find(p, pg) for p in c["phrases"]]
            if all(boxes):
                mids = [(b[1] + b[3]) / 2 for b in boxes]
                xs = [b[0] for b in boxes]
                ok = max(mids) - min(mids) <= c.get("tol", 6) and xs == sorted(xs)
                detail = f"mid-y {[round(m, 1) for m in mids]} x {[round(x, 1) for x in xs]}"
            else:
                detail = f"missing {[p for p, b in zip(c['phrases'], boxes) if not b]}"
        elif kind == "boxed":
            boxes = [find(p, pg) for p in c["phrases"]]
            if all(boxes):
                x0 = min(b[0] for b in boxes); y0 = min(b[1] for b in boxes); x1 = max(b[2] for b in boxes); y1 = max(b[3] for b in boxes)
                ok, sides = enclosed(pg, x0, y0, x1, y1)
                detail = f"lines above/below/left/right: {sides}"
            else:
                detail = "phrases missing"
        elif kind == "order":
            boxes = [find(p, pg) for p in c["phrases"]]
            ok = all(boxes) and all(boxes[i][1] < boxes[i + 1][1] for i in range(len(boxes) - 1))
            detail = str([round(b[1], 1) if b else None for b in boxes])
        elif kind == "table":
            want = c["cells"]
            match = [t for t in tables if len(t) == len(want) and all(len(r) >= len(w) for r, w in zip(t, want)) and all(norm(" ".join(r[: len(w)])) == norm(" ".join(w)) for r, w in zip(t, want))]
            ok = bool(match)
            detail = f"tables in docx: {[f'{len(t)}x{len(t[0]) if t else 0}' for t in tables]}"
        elif kind == "near_top":
            box = find(c["phrase"], pg)
            first = min((w[1] for w in pages[pg - 1]), default=None) if pg - 1 < len(pages) else None
            ok = box is not None and first is not None and box[1] <= first + 2
            detail = str(box)
        results.append({"id": c["id"], "ok": ok, "detail": detail})
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out_pdf")
    ap.add_argument("out_docx")
    ap.add_argument("--dir")
    ap.add_argument("--suffix", default="")
    ap.add_argument("--expect")
    ap.add_argument("--ref", help="native PDF the scan was made from: text recall against its words")
    a = ap.parse_args()
    import os
    import docx as pydocx

    S, O = pymupdf.open(a.src), pymupdf.open(a.out_pdf)
    doc = pydocx.Document(a.out_docx)
    res = {"pagesSrc": S.page_count, "pagesOut": O.page_count, "pages": []}
    all_words = placed = garbage = 0
    ratios = []
    rule_scores = []
    for i in range(S.page_count):
        A = grey(S[i])
        if i >= O.page_count:
            res["pages"].append({"page": i + 1, "error": "missing in Word"})
            continue
        B = grey(O[i])
        if B.shape != A.shape:
            B = np.asarray(Image.fromarray(B.astype(np.uint8)).resize((A.shape[1], A.shape[0])), dtype=np.int16)
        ia, ib = ink_mask(A), ink_mask(B)
        if a.dir:
            os.makedirs(a.dir, exist_ok=True)
            Image.fromarray(A.astype(np.uint8)).save(os.path.join(a.dir, f"original-page-{i + 1}.png"))
            Image.fromarray(B.astype(np.uint8)).save(os.path.join(a.dir, f"word-page-{i + 1}{a.suffix}.png"))
            overlay(A, B, os.path.join(a.dir, f"diff-page-{i + 1}{a.suffix}.png"))
        hs, ho = runs(ia, 0, int(60 * K)), runs(ib, 0, int(60 * K))
        vs, vo = runs(ia, 1, int(30 * K)), runs(ib, 1, int(30 * K))
        rules_h, rules_v = rule_cover(hs, ho), rule_cover(vs, vo)
        ws = words_of(O[i])
        ok_words, bad = 0, []
        ta, tb = strip_rules(ia), strip_rules(ib)
        for w in ws:
            ok, iou, ratio = in_place(w, ta, tb)
            if ok:
                ok_words += 1
                if ratio:
                    ratios.append(ratio)
            elif iou == 0.0:
                bad.append(w[4])
        all_words += len(ws)
        placed += ok_words
        garbage += len(bad)
        parts = [v for v in (rules_h, rules_v) if v is not None]
        rule_scores += parts
        res["pages"].append({
            "page": i + 1,
            "wordsOut": len(ws),
            "wordsInPlacePct": round(ok_words / max(1, len(ws)) * 100, 1),
            "wordsWithoutInk": bad[:20],
            "rulesH": {"src": len(hs), "out": len(ho), "keptPct": rules_h},
            "rulesV": {"src": len(vs), "out": len(vo), "keptPct": rules_v},
        })
    med = float(np.median(ratios)) if ratios else None
    res["wordsInPlacePct"] = round(placed / max(1, all_words) * 100, 1)
    res["wordsWithoutInk"] = garbage
    res["rulesKeptPct"] = round(float(np.mean(rule_scores)), 1) if rule_scores else None
    res["typographyPct"] = round(float(np.mean([abs(r / med - 1) <= 0.25 for r in ratios])) * 100, 1) if ratios else None
    res["tables"] = [f"{len(t.rows)}x{len(t.columns)}" for t in doc.tables]
    if a.expect:
        exp = json.load(open(a.expect, encoding="utf8"))
        res["checks"] = check_expect(exp, doc, O)
    if a.ref:
        res["textRecallPct"] = text_recall(a.ref, a.out_docx)
    # Grades
    band = lambda v, p, l: "n/a" if v is None else "PASS" if v >= p else "LIMITED" if v >= l else "FAIL"
    res["layout"] = band(res["wordsInPlacePct"], 95, 80) if res["pagesOut"] == res["pagesSrc"] else "FAIL"
    res["rules"] = band(res["rulesKeptPct"], 90, 60)
    res["typography"] = band(res["typographyPct"], 85, 65)
    if "textRecallPct" in res:
        res["text"] = band(res["textRecallPct"], 97, 90)
    res["garbage"] = "PASS" if garbage == 0 else "LIMITED" if garbage <= 2 else "FAIL"
    if "checks" in res:
        failed = [c["id"] for c in res["checks"] if not c["ok"]]
        res["checksFailed"] = failed
        res["structure"] = "PASS" if not failed else "FAIL"
    grades = [res[k] for k in ("text", "layout", "rules", "typography", "garbage", "structure") if k in res and res[k] != "n/a"]
    res["overall"] = "FAIL" if "FAIL" in grades else "LIMITED" if "LIMITED" in grades else "PASS"
    print(json.dumps(res))


if __name__ == "__main__":
    main()
