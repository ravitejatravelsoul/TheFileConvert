"""Independent validation of exported forms (QA only — nothing here is part of the product).

    python qa/validate/formcheck.py DIR     DIR/edited/NAME.pdf (+ .orig.pdf, .json) and DIR/same/NAME.pdf (+ .orig.pdf)

edited/  the editor filled fields in; for each field listed in NAME.json:
         qpdf opens the file and `check_pdf_syntax` is clean; MuPDF reads the field value; the text drawn inside the widget is the
         value, *once* (not twice); its font size, and left/centre/right placement, are what the field asks for; the text lies
         inside the widget; checkbox / radio state is the one chosen. Every other field's value is unchanged and the pages
         outside the edited widgets are pixel-identical to the original.
same/    opened and exported without a change: every page renders pixel-identical to the original.
Prints one JSON line per file and a summary; exit status 1 if anything failed.
"""
import json
import os
import sys

import numpy as np
import pikepdf
import pymupdf

DPI = 100


def render(page, clip=None):
    z = DPI / 72
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), colorspace=pymupdf.csGRAY, alpha=False, clip=clip)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.int16)


def qpdf_ok(path, problems):
    try:
        with pikepdf.open(path) as pk:
            p = pk.check_pdf_syntax()
            if p:
                problems.append(f"qpdf: {p[:2]}")
            for page in pk.pages:
                c = page.get("/Contents")  # a page of only fields may have none
                if c is not None:
                    _ = c.read_bytes() if not isinstance(c, pikepdf.Array) else b"".join(x.read_bytes() for x in c)
    except Exception as e:  # noqa: BLE001
        problems.append(f"qpdf failed to open: {e}")


def pdf_field_values(path):
    """name -> value as the file stores it (radio: the option label), read with pikepdf, not a renderer."""
    out = {}
    with pikepdf.open(path) as pk:
        acro = pk.Root.get("/AcroForm")
        if acro is None:
            return out

        def walk(f, prefix):
            t = f.get("/T")
            name = prefix + (("." if prefix else "") + str(t) if t is not None else "")
            kids = f.get("/Kids")
            if kids is not None and any("/T" in k or "/Kids" in k for k in kids):
                for k in kids:
                    walk(k, name)
                return
            v = f.get("/V")
            if v is None:
                out.setdefault(name, "")
                return
            s = str(v)
            if isinstance(v, pikepdf.Name):
                s = s[1:]
                opt = f.get("/Opt")
                if opt is not None and s.isdigit() and int(s) < len(opt):
                    s = str(opt[int(s)])
            out.setdefault(name, s)

        for f in acro.get("/Fields", []):
            walk(f, "")
    return out


def ap_size_and_text(path, name):
    """Font size and shown text of a text field's normal appearance stream (what a viewer that trusts /AP draws)."""
    import re

    with pikepdf.open(path) as pk:
        for page in pk.pages:
            for a in page.get("/Annots", []):
                n = a.get("/T")
                par = a.get("/Parent")
                parts = []
                cur = a
                while cur is not None:
                    if "/T" in cur:
                        parts.insert(0, str(cur.get("/T")))
                    cur = cur.get("/Parent")
                full = ".".join(parts)
                if full != name:
                    continue
                stream = a.AP.N
                data = stream.read_bytes().decode("latin-1")
                sizes = [float(m.group(1)) for m in re.finditer(r"([\d.]+)\s+Tf", data)]
                texts = []
                for m in re.finditer(r"<([0-9A-Fa-f]+)>\s*Tj|\(((?:\.|[^\)])*)\)\s*Tj", data):
                    texts.append(bytes.fromhex(m.group(1)).decode("latin-1") if m.group(1) else m.group(2))
                return (sizes[0] if sizes else None), texts
    return None, []


def field_da_size(path, name):
    """The font size in the field's /DA (0 = auto), looking up the /Parent chain."""
    import re

    with pikepdf.open(path) as pk:
        for page in pk.pages:
            for a in page.get("/Annots", []):
                parts, cur, da = [], a, None
                while cur is not None:
                    if "/T" in cur:
                        parts.insert(0, str(cur.get("/T")))
                    if da is None and "/DA" in cur:
                        da = str(cur.get("/DA"))
                    cur = cur.get("/Parent")
                if ".".join(parts) == name:
                    m = re.search(r"([\d.]+)\s+Tf", da or "")
                    return float(m.group(1)) if m else 0.0
    return 0.0


def widget_spans(page, rect):
    """Text lines drawn inside `rect`: [(text, size, bbox)] — from the widget appearance as MuPDF draws it."""
    out = []
    d = page.get_text("dict", clip=rect + (-1, -1, 1, 1))
    for b in d["blocks"]:
        for ln in b.get("lines", []):
            txt = "".join(s["text"] for s in ln["spans"])
            if txt.strip():
                out.append((txt, max(s["size"] for s in ln["spans"]), pymupdf.Rect(ln["bbox"])))
    return out


def check_edited(path):
    base = path[:-4]
    meta = json.load(open(base + ".json", encoding="utf-8"))
    res = {"file": os.path.basename(path), "problems": [], "kind": "edited"}
    qpdf_ok(path, res["problems"])
    try:
        new, old = pymupdf.open(path), pymupdf.open(base + ".orig.pdf")
    except Exception as e:  # noqa: BLE001
        res["problems"].append(f"MuPDF failed to open: {e}")
        return res
    if new.page_count != old.page_count:
        res["problems"].append("page count changed")
        return res
    expect = meta["fields"]
    widgets = {}
    pages_alive = [new[i] for i in range(new.page_count)]  # widgets only live as long as their page object
    for pn, page in enumerate(pages_alive):
        for w in page.widgets() or []:
            widgets.setdefault(w.field_name, []).append((pn, w))
    touched_rects = {pn: [] for pn in range(new.page_count)}
    for name, want in expect.items():
        if name not in widgets:
            res["problems"].append(f"{name}: field missing from the export")
            continue
        for pn, w in widgets[name]:
            touched_rects[pn].append(w.rect)
            if "value" in want and str(w.field_value) != want["value"]:
                res["problems"].append(f"{name}: value is {w.field_value!r}, wanted {want['value']!r}")
            if "value" in want and w.field_type_string in ("Text", "ComboBox") and "size" not in want:
                # auto-size: MuPDF redraws these itself, so judge the appearance stream the editor wrote
                size, texts = ap_size_and_text(path, name)
                da = field_da_size(path, name)
                norm = lambda t: " ".join(t.split())  # noqa: E731
                if size is None or size < 3.99 or size > w.rect.height:
                    res["problems"].append(f"{name}: font size {size} does not fit the {w.rect.height:.0f} pt widget")
                if da and size is not None and abs(size - da) > 0.01:
                    res["problems"].append(f"{name}: appearance size {size}, the field's /DA says {da}")
                if norm(" ".join(texts)) != norm(want["value"]):
                    res["problems"].append(f"{name}: appearance shows {norm(' '.join(texts))!r}, wanted {norm(want['value'])!r}")
            elif "value" in want and w.field_type_string in ("Text", "ComboBox"):
                page = new[pn]
                spans = widget_spans(page, w.rect)
                drawn = " ".join(t.strip() for t, _, _ in spans)
                norm = lambda s: " ".join(s.split())  # noqa: E731
                if norm(drawn) != norm(want["value"]):
                    res["problems"].append(f"{name}: drawn text {norm(drawn)!r}, wanted {norm(want['value'])!r} (shown twice, or not at all?)")
                if spans:
                    if abs(max(s for _, s, _ in spans) - want["size"]) > 0.15:
                        res["problems"].append(f"{name}: font size {max(s for _, s, _ in spans):.2f}, wanted {want['size']}")
                    r = w.rect
                    for _, _, bb in spans:
                        if bb.x0 < r.x0 - 0.6 or bb.x1 > r.x1 + 0.6 or bb.y0 < r.y0 - 1.5 or bb.y1 > r.y1 + 1.5:
                            res["problems"].append(f"{name}: text {bb} lies outside the widget {r}")
                    a = want.get("align")
                    bb = spans[0][2]
                    if len(spans) == 1 and a == "left" and abs(bb.x0 - r.x0) > 4.5:
                        res["problems"].append(f"{name}: not left aligned")
                    if len(spans) == 1 and a == "center" and abs((bb.x0 + bb.x1) / 2 - (r.x0 + r.x1) / 2) > 2.5:
                        res["problems"].append(f"{name}: not centred")
                    if len(spans) == 1 and a == "right" and abs(r.x1 - bb.x1) > 4.5:
                        res["problems"].append(f"{name}: not right aligned")
                # nothing of the old appearance is left: the widget holds one text
                ink_before = render(old[pn], pymupdf.Rect(w.rect))
                ink_after = render(page, pymupdf.Rect(w.rect))
                if ink_after.shape == ink_before.shape and (ink_after < 120).sum() > (ink_before < 120).sum() * 3 + 400:
                    res["problems"].append(f"{name}: far more ink than before (doubled strokes?)")
    nv, ov = pdf_field_values(path), pdf_field_values(base + ".orig.pdf")
    for name, want in expect.items():
        if "selected" in want and nv.get(name) != want["selected"]:
            res["problems"].append(f"{name}: selected {nv.get(name)!r}, wanted {want['selected']!r}")
        if "checked" in want and (nv.get(name, "Off") not in ("Off", "")) != want["checked"]:
            res["problems"].append(f"{name}: checked state is {nv.get(name)!r}")
    for name, v in nv.items():
        if name not in expect and v != ov.get(name, v):
            res["problems"].append(f"{name}: changed although it was not edited ({ov.get(name)!r} -> {v!r})")
    # everything outside the edited widgets is pixel-identical
    for pn in range(new.page_count):
        a, b = render(old[pn]), render(new[pn])
        if a.shape != b.shape:
            res["problems"].append(f"page {pn + 1} size changed")
            continue
        diff = np.abs(a - b) > 24
        z = DPI / 72
        for r in touched_rects[pn]:
            r = pymupdf.Rect(r) * new[pn].rotation_matrix
            r.normalize()
            diff[max(0, int((r.y0 - 3) * z)) : int((r.y1 + 3) * z) + 1, max(0, int((r.x0 - 3) * z)) : int((r.x1 + 3) * z) + 1] = False
        if diff.any():
            res["problems"].append(f"page {pn + 1}: {int(diff.sum())} pixels changed outside the edited fields")
    res["ok"] = not res["problems"]
    return res


def check_same(path):
    base = path[:-4]
    res = {"file": os.path.basename(path), "problems": [], "kind": "same"}
    qpdf_ok(path, res["problems"])
    try:
        new, old = pymupdf.open(path), pymupdf.open(base + ".orig.pdf")
    except Exception as e:  # noqa: BLE001
        res["problems"].append(f"MuPDF failed to open: {e}")
        return res
    if new.page_count != old.page_count:
        res["problems"].append("page count changed")
        return res
    ov, nv = pdf_field_values(base + ".orig.pdf"), pdf_field_values(path)
    for name, v in nv.items():
        if v != ov.get(name, v):
            res["problems"].append(f"{name}: value changed just by opening and exporting ({ov.get(name)!r} -> {v!r})")
    for pn in range(new.page_count):
        a, b = render(old[pn]), render(new[pn])
        if a.shape != b.shape or (np.abs(a - b) > 24).any():
            res["problems"].append(f"page {pn + 1} changed ({(np.abs(a - b) > 24).sum() if a.shape == b.shape else 'size'} px)")
    res["ok"] = not res["problems"]
    return res


def main(d):
    results = []
    for kind, fn in (("edited", check_edited), ("same", check_same)):
        folder = os.path.join(d, kind)
        if not os.path.isdir(folder):
            continue
        for f in sorted(os.listdir(folder)):
            if f.endswith(".pdf") and not f.endswith(".orig.pdf"):
                results.append(fn(os.path.join(folder, f)))
    bad = 0
    for r in results:
        bad += 0 if r.get("ok") else 1
        print(json.dumps(r, ensure_ascii=False))
    print(json.dumps({"checked": len(results), "failed": bad}))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
