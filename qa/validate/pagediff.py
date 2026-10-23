"""Pixel comparison of two PDFs, page by page (QA only).

    python qa/validate/pagediff.py SRC.pdf OUT.pdf      -> one JSON line: {"pages": n, "maxDiffPct": x, "perPage": [...]}

Both are rendered with MuPDF at 72 dpi; a pixel differs when any grey level differs by more than 24. A scan that was only made
searchable (invisible text layer) must come out at 0.000 %.
"""
import json
import sys

import numpy as np
import pymupdf


def render(page):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(1, 1), colorspace=pymupdf.csGRAY, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width).astype(np.int16)


def main(a, b):
    da, db = pymupdf.open(a), pymupdf.open(b)
    if da.page_count != db.page_count:
        print(json.dumps({"error": "page count differs", "src": da.page_count, "out": db.page_count}))
        return
    per = []
    for i in range(da.page_count):
        x, y = render(da[i]), render(db[i])
        per.append(100.0 if x.shape != y.shape else round(float((np.abs(x - y) > 24).mean() * 100), 4))
    print(json.dumps({"pages": da.page_count, "maxDiffPct": max(per) if per else 0, "perPage": per}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
