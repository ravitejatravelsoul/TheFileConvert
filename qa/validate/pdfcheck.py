"""Strict, independent PDF validation for QA (not shipped).

    python qa/validate/pdfcheck.py file.pdf [more.pdf ...]   -> one JSON object per line

Uses two engines that share no code with the app (which uses pdf-lib and pdf.js):
  * qpdf (via pikepdf): structural check — xref, trailer, object references, and a full decode of every
    stream, so a stream whose data doesn't match its /Filter or /Length is caught.
  * MuPDF (via PyMuPDF): opens the file the way many real viewers do, renders every page and reports
    MuPDF's own repair/decode warnings. A page that renders to a single flat colour is flagged blank.
"""
import json
import sys

import pikepdf
import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)


def check(path):
    out = {"file": path, "ok": True, "problems": []}

    def fail(msg):
        out["ok"] = False
        out["problems"].append(msg)

    # --- qpdf
    try:
        with pikepdf.open(path) as pdf:
            out["qpdf_pages"] = len(pdf.pages)
            out["encrypted"] = pdf.is_encrypted
            for p in pdf.check_pdf_syntax():
                fail(f"qpdf: {p}")
            streams = 0
            for obj in pdf.objects:
                if isinstance(obj, pikepdf.Stream):
                    streams += 1
                    filters = obj.get("/Filter")
                    names = [str(f) for f in filters] if isinstance(filters, pikepdf.Array) else ([str(filters)] if filters is not None else [])
                    try:
                        if names and names[-1] == "/DCTDecode":
                            # qpdf doesn't decode JPEG: check it's a complete JPEG (SOI ... EOI) after any
                            # other filters; MuPDF's render below decodes the pixels themselves.
                            data = obj.read_bytes(pikepdf.StreamDecodeLevel.specialized) if len(names) > 1 else obj.read_raw_bytes()
                            declared = int(obj.get("/Length", len(data)))
                            if data[:2] != b"\xff\xd8" or b"\xff\xd9" not in data[-16:]:
                                fail(f"stream {obj.objgen}: JPEG data is not a complete JPEG")
                            if len(names) == 1 and declared != len(obj.read_raw_bytes()):
                                fail(f"stream {obj.objgen}: /Length {declared} != data {len(data)}")
                        else:
                            obj.read_bytes(pikepdf.StreamDecodeLevel.generalized)
                    except Exception as e:  # noqa: BLE001
                        fail(f"qpdf stream {obj.objgen}: {e}")
            out["streams"] = streams
    except Exception as e:  # noqa: BLE001
        fail(f"qpdf open: {e}")

    # --- MuPDF
    pymupdf.TOOLS.mupdf_warnings()  # clear
    try:
        doc = pymupdf.open(path)
        if doc.needs_pass:
            fail("mupdf: needs a password")
        out["mupdf_pages"] = doc.page_count
        if doc.is_repaired:
            fail("mupdf: file was damaged and had to be repaired")
        blank = []
        chars = 0
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5))
            samples = pix.samples
            step = max(1, len(samples) // 4000)
            sample = samples[::step]
            if max(sample) - min(sample) < 8:
                blank.append(i + 1)
            chars += len(page.get_text("text").strip())
        out["blank_pages"] = blank
        out["text_chars"] = chars
        doc.close()
    except Exception as e:  # noqa: BLE001
        fail(f"mupdf open/render: {e}")
    warnings = pymupdf.TOOLS.mupdf_warnings().strip()
    if warnings:
        out["mupdf_warnings"] = warnings.splitlines()[:8]
        fail("mupdf warnings: " + " | ".join(warnings.splitlines()[:3]))
    if out.get("qpdf_pages") is not None and out.get("mupdf_pages") is not None and out["qpdf_pages"] != out["mupdf_pages"]:
        fail(f"page count disagrees: qpdf {out['qpdf_pages']} vs mupdf {out['mupdf_pages']}")
    return out


if __name__ == "__main__":
    for f in sys.argv[1:]:
        print(json.dumps(check(f)), flush=True)
