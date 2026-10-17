"""Visual fidelity between a source and a tool's output — QA only.

    python qa/validate/visdiff.py pdf  SRC.pdf OUT.pdf [--map 1,3,2] [--rot 0,90,0] [--offset K] [--mask P:x0,y0,x1,y1] [--dir D --name N]
    python qa/validate/visdiff.py img  SRC.img OUT.img [--dir D --name N]
    python qa/validate/visdiff.py page SRC.pdf OUT.img --page K [--dir D --name N]     (PDF page vs. its image)
    python qa/validate/visdiff.py place SRC.img OUT.pdf --page K [--dir D --name N]    (image vs. where it sits on a PDF page)

Prints one JSON line. Pages/images are rendered (grey, 100 dpi for PDFs), brought to one pixel size (a
downsized output image is compared with the source downsized the same way), then compared: SSIM (8x8 blocks), PSNR, mean absolute difference and the share of pixels that
changed visibly (|diff| > 24 of 255). `pdf` also compares page sizes, rotation, page count and the words on
each page (recall), and `--mask` reports the changed share outside a region (the PDF editor's patch: points,
top-left origin) separately. `--map` names, for each output page, the source page it should show; `--rot` the
clockwise turn the tool should have applied to it; `--offset` the output page the comparison starts at.
`place` also compares the picture stored in the PDF with the source (bytes, then decoded pixels).
With --dir, writes  source | output | difference (red = changed)  JPEGs for review.
"""
import argparse
import io
import json
import os
import re
import sys

import numpy as np
import pymupdf
from PIL import Image, ImageOps

sys.stdout.reconfigure(encoding="utf-8")
DPI = 100


def ssim(a, b):
    h, w = (a.shape[0] // 8) * 8, (a.shape[1] // 8) * 8
    if h == 0 or w == 0:
        return 1.0 if np.array_equal(a, b) else 0.0
    a, b = a[:h, :w], b[:h, :w]
    A = a.reshape(h // 8, 8, w // 8, 8).swapaxes(1, 2).reshape(-1, 64)
    B = b.reshape(h // 8, 8, w // 8, 8).swapaxes(1, 2).reshape(-1, 64)
    ma, mb = A.mean(1), B.mean(1)
    va, vb = A.var(1), B.var(1)
    cov = ((A - ma[:, None]) * (B - mb[:, None])).mean(1)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    return float((((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma**2 + mb**2 + c1) * (va + vb + c2))).mean())


def grey(img):
    """PIL image -> float grey array, transparency composited on white (as a viewer shows it)."""
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    return np.asarray(img.convert("L"), dtype=np.float64)


def render(page, dpi=DPI):
    z = dpi / 72  # a zoom matrix: fractional resolutions are allowed (get_pixmap's dpi must be whole)
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), colorspace=pymupdf.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.float64)


def fit(b, shape):
    if b.shape == shape:
        return b
    return np.asarray(Image.fromarray(b.astype(np.uint8)).resize((shape[1], shape[0]), Image.BILINEAR), dtype=np.float64)


def align(a, b, tol=1):
    """b shifted by up to ±tol pixels to best match a (a renderer may place a full-page picture a hair off)."""
    best = (ssim(a, b), 0, 0)
    for dy in range(-tol, tol + 1):
        for dx in range(-tol, tol + 1):
            if dx == 0 and dy == 0:
                continue
            shifted = np.full_like(b, 255.0)
            ys, yd = (slice(dy, None), slice(0, b.shape[0] - dy)) if dy >= 0 else (slice(0, b.shape[0] + dy), slice(-dy, None))
            xs, xd = (slice(dx, None), slice(0, b.shape[1] - dx)) if dx >= 0 else (slice(0, b.shape[1] + dx), slice(-dx, None))
            shifted[yd, xd] = b[ys, xs]
            sc = ssim(a, shifted)
            if sc > best[0]:
                best = (sc, dx, dy)
    if best[1] == 0 and best[2] == 0:
        return b, (0, 0)
    dx, dy = best[1], best[2]
    shifted = np.full_like(b, 255.0)
    ys, yd = (slice(dy, None), slice(0, b.shape[0] - dy)) if dy >= 0 else (slice(0, b.shape[0] + dy), slice(-dy, None))
    xs, xd = (slice(dx, None), slice(0, b.shape[1] - dx)) if dx >= 0 else (slice(0, b.shape[1] + dx), slice(-dx, None))
    shifted[yd, xd] = b[ys, xs]
    return shifted, (dx, dy)


def compare(a, b, mask=None, tol=0):
    b = fit(b, a.shape)
    shift = (0, 0)
    if tol:
        b, shift = align(a, b, tol)
    d = np.abs(a - b)
    mse = float((d**2).mean())
    r = {
        "ssim": round(ssim(a, b), 4),
        "psnr": round(99.0 if mse == 0 else 10 * np.log10(255**2 / mse), 2),
        "meanDiff": round(float(d.mean()), 2),
        "changedPct": round(float((d > 24).mean()) * 100, 3),
    }
    if tol:
        r["alignedBy"] = list(shift)
    if mask is not None:
        outside = ~mask
        r["changedOutsidePct"] = round(float((d[outside] > 24).mean()) * 100, 4) if outside.any() else 0.0
        r["maxDiffOutside"] = int(d[outside].max()) if outside.any() else 0
        r["changedInsidePct"] = round(float((d[mask] > 24).mean()) * 100, 2) if mask.any() else 0.0
    return r, b, d


def write_diff(a, b, d, path):
    gap = np.full((a.shape[0], 10, 3), 200, np.uint8)
    sa = np.repeat(a.astype(np.uint8)[:, :, None], 3, 2)
    sb = np.repeat(b.astype(np.uint8)[:, :, None], 3, 2)
    heat = np.repeat((a * 0.25 + 190).astype(np.uint8)[:, :, None], 3, 2)  # faint source for context
    changed = d > 24
    heat[changed] = (220, 30, 30)
    img = Image.fromarray(np.concatenate([sa, gap, sb, gap, heat], 1))
    # Review images, not measurements: small enough to keep in the repository.
    if img.width > 1400:
        img = img.resize((1400, int(img.height * 1400 / img.width)), Image.LANCZOS)
    img.save(path, "JPEG", quality=82)


def words(page):
    return [re.sub(r"\W+", "", w[4].lower()) for w in page.get_text("words") if re.sub(r"\W+", "", w[4])]


def recall(src_words, out_words):
    if not src_words:
        return None
    pool = {}
    for w in out_words:
        pool[w] = pool.get(w, 0) + 1
    hit = 0
    for w in src_words:
        if pool.get(w, 0) > 0:
            pool[w] -= 1
            hit += 1
    return round(hit / len(src_words) * 100, 2)


def shown_size(page):
    r = page.rect  # MuPDF's rect already has /Rotate applied
    return [round(r.width, 1), round(r.height, 1)]


def cmd_pdf(a):
    S, O = pymupdf.open(a.src), pymupdf.open(a.out)
    mapping = [int(x) - 1 for x in a.map.split(",")] if a.map else list(range(min(S.page_count, O.page_count - a.offset)))
    turns = [int(x) for x in a.rot.split(",")] if a.rot else [0] * len(mapping)
    masks = {}
    for m in a.mask or []:
        p, box = m.split(":")
        masks.setdefault(int(p) - 1, []).append([float(v) for v in box.split(",")])
    pages = []
    for k, si in enumerate(mapping):
        oi = k + a.offset
        if oi >= O.page_count:
            pages.append({"out": oi + 1, "src": si + 1, "error": "output page missing"})
            continue
        if si >= S.page_count:
            pages.append({"out": oi + 1, "src": si + 1, "error": "no such source page"})
            continue
        sp, op = S[si], O[oi]
        expect_size = shown_size(sp) if turns[k] % 180 == 0 else shown_size(sp)[::-1]
        # The page should have been turned this far (clockwise, degrees) by the tool: render the source
        # turned the same way by MuPDF itself, so both sides are rasterised identically.
        if turns[k] % 360:
            original = sp.rotation
            sp.set_rotation((original + turns[k]) % 360)
            A = render(sp)
            sp.set_rotation(original)
        else:
            A = render(sp)
        B = render(op)
        mask = None
        if oi in masks:
            mask = np.zeros(A.shape, bool)
            sc = DPI / 72
            for x0, y0, x1, y1 in masks[oi]:
                mask[max(0, int(y0 * sc) - 2) : int(y1 * sc) + 3, max(0, int(x0 * sc) - 2) : int(x1 * sc) + 3] = True
        r, Bf, d = compare(A, B, mask, a.align)
        r.update({"out": oi + 1, "src": si + 1, "sizeSrc": shown_size(sp), "sizeOut": shown_size(op), "sizeKept": expect_size == shown_size(op)})
        r["rotationSrc"], r["rotationOut"] = sp.rotation, op.rotation
        sw = words(sp)
        r["words"] = len(sw)
        r["textRecall"] = recall(sw, words(op))
        if a.dir and k < a.max_images:
            os.makedirs(a.dir, exist_ok=True)
            write_diff(A, Bf, d, os.path.join(a.dir, f"{a.name}-p{oi + 1}.jpg"))
        pages.append(r)
    ok = [p for p in pages if "ssim" in p]
    res = {
        "mode": "pdf",
        "pagesSrc": S.page_count,
        "pagesOut": O.page_count,
        "pagesExpected": len(mapping),
        "minSsim": min((p["ssim"] for p in ok), default=None),
        "meanSsim": round(float(np.mean([p["ssim"] for p in ok])), 4) if ok else None,
        "minPsnr": min((p["psnr"] for p in ok), default=None),
        "maxChangedPct": max((p["changedPct"] for p in ok), default=None),
        "allSizesKept": all(p.get("sizeKept") for p in ok),
        "minTextRecall": min((p["textRecall"] for p in ok if p["textRecall"] is not None), default=None),
        "pages": pages,
    }
    if masks:
        res["maxChangedOutsidePct"] = max((p.get("changedOutsidePct", 0) for p in ok), default=None)
    return res


def has_alpha(img):
    """Real transparency: an alpha channel with at least one pixel that isn't fully opaque."""
    if img.mode not in ("RGBA", "LA", "PA") and "transparency" not in img.info:
        return False
    return int(np.asarray(img.convert("RGBA"))[:, :, 3].min()) < 255


def cmd_img(a):
    src_img = ImageOps.exif_transpose(Image.open(a.src))
    ob = Image.open(a.out)
    A = grey(src_img)
    B = grey(ob)
    # Quality is judged at the output's own size (a downsized image is compared with the source downsized
    # the same way); the resize itself is reported separately (sizeKept).
    if B.shape != A.shape and B.size < A.size:
        A = np.asarray(Image.fromarray(A.astype(np.uint8)).resize((B.shape[1], B.shape[0]), Image.LANCZOS), dtype=np.float64)
    r, Bf, d = compare(A, B)
    r.update({"mode": "img", "sizeSrc": list(src_img.size), "sizeOut": list(ob.size), "sizeKept": tuple(src_img.size) == tuple(ob.size)})
    r["alphaSrc"] = has_alpha(src_img)
    r["alphaOut"] = has_alpha(ob)
    if r["alphaSrc"] and r["alphaOut"]:
        sa = np.asarray(src_img.convert("RGBA"))[:, :, 3].astype(np.float64)
        oa = fit(np.asarray(ob.convert("RGBA"))[:, :, 3].astype(np.float64), sa.shape)
        r["alphaMeanDiff"] = round(float(np.abs(sa - oa).mean()), 2)
    if a.dir:
        os.makedirs(a.dir, exist_ok=True)
        write_diff(A, Bf, d, os.path.join(a.dir, f"{a.name}.jpg"))
    return r


def cmd_page(a):
    S = pymupdf.open(a.src)
    sp = S[a.page - 1]
    ob = Image.open(a.out)
    B = grey(ob)
    # Render the page at the image's own resolution.
    dpi = 72 * ob.size[0] / sp.rect.width
    A = render(sp, dpi)
    r, Bf, d = compare(A, B)
    r.update({"mode": "page", "page": a.page, "imageSize": list(ob.size), "dpi": round(dpi, 1)})
    r["aspectSrc"], r["aspectOut"] = round(sp.rect.width / sp.rect.height, 4), round(ob.size[0] / ob.size[1], 4)
    r["aspectKept"] = abs(r["aspectSrc"] - r["aspectOut"]) < 0.01
    if a.dir:
        os.makedirs(a.dir, exist_ok=True)
        write_diff(A, Bf, d, os.path.join(a.dir, f"{a.name}.jpg"))
    return r


def cmd_place(a):
    src_img = ImageOps.exif_transpose(Image.open(a.src))
    O = pymupdf.open(a.out)
    op = O[a.page - 1]
    infos = [i for i in op.get_image_info() if i["bbox"][2] - i["bbox"][0] > 4]
    if not infos:
        return {"mode": "place", "error": "no picture on the page"}
    box = pymupdf.Rect(max(infos, key=lambda i: (i["bbox"][2] - i["bbox"][0]) * (i["bbox"][3] - i["bbox"][1]))["bbox"])
    dpi = min(300, max(72, 72 * src_img.size[0] / max(1, box.width)))
    pix = op.get_pixmap(matrix=pymupdf.Matrix(dpi / 72, dpi / 72), clip=box, colorspace=pymupdf.csGRAY, alpha=False)
    B = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.float64)
    A = grey(src_img)
    r, Bf, d = compare(A, B)
    pr = op.rect
    r.update({"mode": "place", "page": a.page, "pageSize": [round(pr.width, 1), round(pr.height, 1)], "box": [round(v, 1) for v in box]})
    # The picture as stored in the PDF: the source's own bytes, or its decoded pixels compared directly
    # (rendering into the page box resamples, which on noisy photos says more about resampling than fidelity).
    imgs = op.get_images(full=True)
    if imgs:
        biggest = max(imgs, key=lambda im: im[2] * im[3])
        x = O.extract_image(biggest[0])
        raw = open(a.src, "rb").read()
        r["embeddedBytesIdentical"] = x["image"] == raw
        try:
            emb = Image.open(io.BytesIO(x["image"]))
            E = np.asarray(emb.convert("L"), dtype=np.float64)
            best = None
            # Stored upright, or stored as shot with the page turning it (EXIF orientation): either is faithful.
            for cand in (grey(Image.open(a.src)), np.asarray(Image.open(a.src).convert("L"), dtype=np.float64)):
                if cand.shape == E.shape or cand.shape == E.shape[::-1]:
                    c = cand if cand.shape == E.shape else None
                    if c is None:
                        continue
                    s = ssim(c, E)
                    best = s if best is None else max(best, s)
            r["embeddedSize"] = [emb.size[0], emb.size[1]]
            r["embeddedSsim"] = round(best, 4) if best is not None else None
            r["embeddedSmask"] = biggest[1] != 0
        except Exception as e:  # an encoding PIL can't open: report it, don't guess
            r["embeddedError"] = str(e)[:120]
    r["aspectSrc"], r["aspectPlaced"] = round(src_img.size[0] / src_img.size[1], 4), round(box.width / box.height, 4)
    r["aspectKept"] = abs(r["aspectSrc"] / r["aspectPlaced"] - 1) < 0.01
    r["insidePage"] = box.x0 >= -0.5 and box.y0 >= -0.5 and box.x1 <= pr.width + 0.5 and box.y1 <= pr.height + 0.5
    if a.dir:
        os.makedirs(a.dir, exist_ok=True)
        write_diff(A, Bf, d, os.path.join(a.dir, f"{a.name}.jpg"))
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["pdf", "img", "page", "place"])
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--map")
    ap.add_argument("--mask", action="append")
    ap.add_argument("--offset", type=int, default=0, help="output page (0-based) the comparison starts at")
    ap.add_argument("--rot", help="per compared page: clockwise turn (degrees) the tool should have applied")
    ap.add_argument("--align", type=int, default=0, help="pdf mode: forgive a renderer shifting the page by up to N px (reported as alignedBy)")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--dir")
    ap.add_argument("--name", default="diff")
    ap.add_argument("--max-images", type=int, default=4)
    a = ap.parse_args()
    fn = {"pdf": cmd_pdf, "img": cmd_img, "page": cmd_page, "place": cmd_place}[a.mode]
    print(json.dumps(fn(a)))


if __name__ == "__main__":
    main()
