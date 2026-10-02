"""Layout and formatting fidelity between two PDFs (source vs. output), word by word — QA only.

    python qa/validate/layoutdiff.py SOURCE.pdf OUTPUT.pdf [--images DIR --name NAME]   -> one JSON line

Both files are read with MuPDF. Words are aligned in reading order (difflib), then for every matched word:
page, position (centre, in points, pages scaled to the source size), font size, bold, italic, colour, and
whether words that shared a line in the source still share one. Pictures are matched in order (bounding-box
IoU). Pages are also rendered and compared pixel-wise. With --images, writes per-page side-by-side + overlay
images (source ink red, output ink blue, shared ink black) for review.
"""
import argparse
import difflib
import json
import re
import sys

import numpy as np
import pymupdf

sys.stdout.reconfigure(encoding="utf-8")
NORM = re.compile(r"[^\w€£$¥₹%]+", re.UNICODE)


def words_of(doc):
    out = []
    for pi, page in enumerate(doc):
        spans = []
        for b in page.get_text("dict")["blocks"]:
            for l in b.get("lines", []):
                for s in l["spans"]:
                    if s["text"].strip():
                        spans.append(s)
        for x0, y0, x1, y1, w, bno, lno, wno in page.get_text("words"):
            key = NORM.sub("", w.lower()).replace("_", "")
            # Fill lines (“_____”) and dot leaders are drawing, not words.
            if not key:
                continue
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            span = None
            for s in spans:
                sx0, sy0, sx1, sy1 = s["bbox"]
                if sx0 - 1 <= cx <= sx1 + 1 and sy0 - 1 <= cy <= sy1 + 1:
                    span = s
                    break
            size = span["size"] if span else y1 - y0
            font = span["font"] if span else ""
            flags = span["flags"] if span else 0
            color = span["color"] if span else 0
            out.append(
                {
                    "key": key,
                    "page": pi,
                    "cx": cx,
                    "cy": cy,
                    "x0": x0,
                    "y0": y0,
                    "size": size,
                    "bold": bool(flags & 16) or bool(re.search(r"bold|black|heavy|semibold", font, re.I)),
                    "italic": bool(flags & 2) or bool(re.search(r"italic|oblique", font, re.I)),
                    "color": color,
                    "line": (pi, bno, lno),
                }
            )
    return out


def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def pct(a, q):
    return float(np.percentile(a, q)) if len(a) else None


def render(page, dpi=40):
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).astype(np.float32)


def resize_to(a, shape):
    from PIL import Image

    return np.asarray(Image.fromarray(a.astype(np.uint8)).resize((shape[1], shape[0]), Image.BILINEAR), dtype=np.float32)


def ssim(a, b):
    # Global SSIM over 8x8 blocks (enough to rank layouts; not a perceptual gold standard).
    h, w = (a.shape[0] // 8) * 8, (a.shape[1] // 8) * 8
    a, b = a[:h, :w], b[:h, :w]
    A = a.reshape(h // 8, 8, w // 8, 8).swapaxes(1, 2).reshape(-1, 64)
    B = b.reshape(h // 8, 8, w // 8, 8).swapaxes(1, 2).reshape(-1, 64)
    ma, mb = A.mean(1), B.mean(1)
    va, vb = A.var(1), B.var(1)
    cov = ((A - ma[:, None]) * (B - mb[:, None])).mean(1)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma**2 + mb**2 + c1) * (va + vb + c2))
    return float(s.mean())


def overlay(src_page, out_page, path, dpi=60):
    from PIL import Image

    a = render(src_page, dpi)
    b = resize_to(render(out_page, dpi), a.shape)
    ink_a, ink_b = a < 160, b < 160
    ov = np.full(a.shape + (3,), 255, np.uint8)
    ov[ink_a & ~ink_b] = (220, 40, 40)
    ov[ink_b & ~ink_a] = (40, 90, 220)
    ov[ink_a & ink_b] = (0, 0, 0)
    gap = np.full((a.shape[0], 12, 3), 200, np.uint8)
    sa = np.repeat(a.astype(np.uint8)[:, :, None], 3, 2)
    sb = np.repeat(b.astype(np.uint8)[:, :, None], 3, 2)
    Image.fromarray(np.concatenate([sa, gap, sb, gap, ov], 1)).save(path)


def rules(doc):
    """Axis-aligned rules per (page, horizontal?) as merged (position, start, end) lines."""
    raw = {}
    for pi, page in enumerate(doc):
        for d in page.get_drawings():
            stroked = "s" in (d.get("type") or "")
            for it in d["items"]:
                segs = []
                if it[0] == "l":
                    p, q = it[1], it[2]
                    if abs(p.y - q.y) < 0.5:
                        segs.append((True, p.y, min(p.x, q.x), max(p.x, q.x)))
                    elif abs(p.x - q.x) < 0.5:
                        segs.append((False, p.x, min(p.y, q.y), max(p.y, q.y)))
                elif it[0] == "re":
                    rc = it[1]
                    if rc.height <= 2.5 and rc.width > rc.height:
                        segs.append((True, (rc.y0 + rc.y1) / 2, rc.x0, rc.x1))
                    elif rc.width <= 2.5 and rc.height > rc.width:
                        segs.append((False, (rc.x0 + rc.x1) / 2, rc.y0, rc.y1))
                    elif stroked:
                        segs += [(True, rc.y0, rc.x0, rc.x1), (True, rc.y1, rc.x0, rc.x1), (False, rc.x0, rc.y0, rc.y1), (False, rc.x1, rc.y0, rc.y1)]
                for horiz, pos, a, b in segs:
                    if b - a >= 4:
                        raw.setdefault((pi, horiz), []).append((pos, a, b))
    out = {}
    for key, segs in raw.items():
        merged = []
        for pos, a, b in sorted(segs, key=lambda s: (round(s[0] / 1.5), s[1])):
            m = merged[-1] if merged else None
            if m and abs(m[0] - pos) <= 1.5 and a <= m[2] + 2:
                m[2] = max(m[2], b)
            else:
                merged.append([pos, a, b])
        out[key] = [tuple(m) for m in merged]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--images")
    ap.add_argument("--name", default="page")
    ap.add_argument("--max-image-pages", type=int, default=3)
    a = ap.parse_args()
    S, O = pymupdf.open(a.src), pymupdf.open(a.out)
    ws, wo = words_of(S), words_of(O)
    sm = difflib.SequenceMatcher(None, [w["key"] for w in ws], [w["key"] for w in wo], autojunk=False)
    pairs = [(ws[m.a + k], wo[m.b + k]) for m in sm.get_matching_blocks() for k in range(m.size)]
    in_order = len(pairs)
    # A running header read in a different place can make the in-order alignment pair page 1's copy with
    # page 2's: release pairs that cross pages and let the passes below pair them properly.
    pairs = [(s_, o_) for s_, o_ in pairs if s_["page"] == o_["page"]]
    # Words that are present but read in a different order (a table read row by row instead of column by
    # column) still count as kept: pair the leftovers with the nearest same word, on the same page first.
    used_s = {id(s_) for s_, _ in pairs}
    used_o = {id(o_) for _, o_ in pairs}
    free_o = {}
    for o_ in wo:
        if id(o_) not in used_o:
            free_o.setdefault((o_["page"], o_["key"]), []).append(o_)
    rest = []
    for s_ in ws:
        if id(s_) in used_s:
            continue
        cands = free_o.get((s_["page"], s_["key"]))
        if cands:
            best = min(cands, key=lambda o_: (o_["cx"] - s_["cx"]) ** 2 + (o_["cy"] - s_["cy"]) ** 2)
            cands.remove(best)
            pairs.append((s_, best))
        else:
            rest.append(s_)
    # Then a word that moved to another page is still present (samePage reports the move).
    for s_ in rest:
        cands = [(k, c) for k, c in free_o.items() if k[1] == s_["key"] and c]
        if cands:
            k, c = min(cands, key=lambda kc: abs(kc[0][0] - s_["page"]))
            pairs.append((s_, c.pop(0)))
    r = {"srcPages": S.page_count, "outPages": O.page_count, "srcWords": len(ws), "outWords": len(wo), "matched": len(pairs)}
    r["textRecall"] = round(len(pairs) / max(1, len(ws)) * 100, 1)
    r["readingOrder"] = round(in_order / max(1, len(ws)) * 100, 1)
    r["extraWords"] = round((len(wo) - len(pairs)) / max(1, len(ws)) * 100, 1)
    same = [(s, o) for s, o in pairs if s["page"] == o["page"]]
    r["samePage"] = round(len(same) / max(1, len(pairs)) * 100, 1)
    d = []
    for s, o in same:
        # Text boxes are in the unrotated page frame (PDF to Word writes a /Rotate page upright), so scale
        # by the unrotated sizes.
        ps, po = S[s["page"]].cropbox, O[o["page"]].cropbox
        kx, ky = ps.width / po.width, ps.height / po.height
        d.append(np.hypot(s["cx"] - o["cx"] * kx, s["cy"] - o["cy"] * ky))
    d = np.array(d)
    r["posMedianPt"] = round(pct(d, 50), 1) if len(d) else None
    r["posP90Pt"] = round(pct(d, 90), 1) if len(d) else None
    r["within12pt"] = round(float((d <= 12).mean()) * 100, 1) if len(d) else 0
    r["within36pt"] = round(float((d <= 36).mean()) * 100, 1) if len(d) else 0
    # Line breaks: consecutive source words on one line should stay on one output line.
    ordered = pairs[:in_order]
    lp = [(ordered[i], ordered[i + 1]) for i in range(len(ordered) - 1) if ordered[i][0]["line"] == ordered[i + 1][0]["line"]]
    kept = sum(1 for (s1, o1), (s2, o2) in lp if o1["page"] == o2["page"] and abs(o1["cy"] - o2["cy"]) < 0.5 * max(o1["size"], 1))
    r["lineKept"] = round(kept / max(1, len(lp)) * 100, 1)
    # Size, relative to the document's own scale (a uniformly scaled page still keeps its hierarchy).
    ratios = np.array([o["size"] / s["size"] for s, o in pairs if s["size"] > 0])
    med = float(np.median(ratios)) if len(ratios) else 1
    r["sizeScale"] = round(med, 3)
    r["sizeKept"] = round(float((np.abs(ratios / med - 1) <= 0.08).mean()) * 100, 1) if len(ratios) else 0
    r["sizeAbsKept"] = round(float((np.abs(ratios - 1) <= 0.08).mean()) * 100, 1) if len(ratios) else 0
    sb = [p for p in pairs if p[0]["bold"]]
    si = [p for p in pairs if p[0]["italic"]]
    r["boldKept"] = round(sum(o["bold"] for _, o in sb) / len(sb) * 100, 1) if sb else None
    r["italicKept"] = round(sum(o["italic"] for _, o in si) / len(si) * 100, 1) if si else None
    r["falseBold"] = round(sum(o["bold"] for s, o in pairs if not s["bold"]) / max(1, len(pairs) - len(sb)) * 100, 1)
    col = [(s, o) for s, o in pairs if s["color"] != 0]
    r["colorKept"] = round(sum(1 for s, o in col if np.linalg.norm(np.subtract(rgb(s["color"]), rgb(o["color"]))) < 60) / len(col) * 100, 1) if col else None
    # Pictures, in document order.
    def imgs(doc):
        # A full-page picture on a page is a scan: PDF to Word turns it into text (by design), so it isn't
        # a picture that should survive.
        out = []
        for pi, p in enumerate(doc):
            area = p.rect.width * p.rect.height
            for info in p.get_image_info():
                b = pymupdf.Rect(info["bbox"])
                if b.width > 8 and b.width * b.height < area * 0.8:
                    out.append((pi, list(b)))
        return out

    im_s, im_o = imgs(S), imgs(O)

    def iou(bs, bo):
        ix = max(0, min(bs[2], bo[2]) - max(bs[0], bo[0]))
        iy = max(0, min(bs[3], bo[3]) - max(bs[1], bo[1]))
        inter = ix * iy
        union = (bs[2] - bs[0]) * (bs[3] - bs[1]) + (bo[2] - bo[0]) * (bo[3] - bo[1]) - inter
        return inter / union if union > 0 else 0

    # Each source picture is paired with the best-overlapping unused output picture on the same page
    # (pictures pinned to the page are stored in a different order than they're read).
    ious = []
    left = list(im_o)
    for ps, bs in im_s:
        cands = [(po, bo) for po, bo in left if po == ps]
        if not cands:
            ious.append(0.0)
            continue
        k = S[ps].cropbox.width / O[cands[0][0]].cropbox.width
        best = max(cands, key=lambda c: iou(bs, [v * k for v in c[1]]))
        ious.append(iou(bs, [v * k for v in best[1]]))
        left.remove(best)
    r["imagesSrc"], r["imagesOut"] = len(im_s), len(im_o)
    r["imageIoU"] = round(float(np.mean(ious)), 3) if ious else None
    # Ruled lines (table borders, paragraph rules): how much of the source's rule length is drawn at the
    # same place. Renderers cut borders into different pieces, so rules are merged into whole lines first.
    rs = rules(S)
    ro = rules(O)
    total = covered = 0.0
    for (pg, horiz), lines_s in rs.items():
        k = S[pg].cropbox.width / O[pg].cropbox.width if pg < O.page_count else 1
        cands = [(pos * k, a * k, b * k) for pos, a, b in ro.get((pg, horiz), [])]
        for pos, x0, x1 in lines_s:
            total += x1 - x0
            spans = sorted((max(x0, ca), min(x1, cb)) for cp, ca, cb in cands if abs(cp - pos) <= 3 and min(x1, cb) > max(x0, ca))
            end = x0
            for sa, sb_ in spans:
                if sb_ > end:
                    covered += sb_ - max(sa, end)
                    end = sb_
    r["rulesSrc"] = round(total)
    r["rulesKept"] = round(covered / total * 100, 1) if total else None
    # Pixels, page by page.
    ss = []
    for i in range(min(S.page_count, O.page_count, 12)):
        pa = render(S[i])
        pb = resize_to(render(O[i]), pa.shape)
        ss.append(ssim(pa, pb))
    r["pageSSIM"] = round(float(np.mean(ss)), 3) if ss else None
    if a.images:
        import os

        os.makedirs(a.images, exist_ok=True)
        for i in range(min(S.page_count, O.page_count, a.max_image_pages)):
            overlay(S[i], O[i], os.path.join(a.images, f"{a.name}-p{i + 1}.png"))
    print(json.dumps(r))


if __name__ == "__main__":
    main()
