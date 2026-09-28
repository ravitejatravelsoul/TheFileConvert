"""Structure of a PDF as MuPDF sees it, for Word -> PDF checks (independent of the app and of pdf.js).

    python qa/validate/pdfstruct.py file.pdf   -> one JSON line

Per page: size, text in reading order, text spans (text, font, size, bold/italic flags, colour, bbox),
pictures (placement bbox + pixel size), links, vector line/rect count. Plus the bookmark tree.
"""
import json
import sys

import pymupdf

sys.stdout.reconfigure(encoding="utf-8")


def main(path):
    doc = pymupdf.open(path)
    pages = []
    for page in doc:
        spans = []
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for s in line["spans"]:
                    if not s["text"].strip():
                        continue
                    spans.append(
                        {
                            "text": s["text"],
                            "font": s["font"],
                            "size": round(s["size"], 2),
                            "bold": bool(s["flags"] & 16) or "Bold" in s["font"],
                            "italic": bool(s["flags"] & 2) or "Italic" in s["font"] or "Oblique" in s["font"],
                            "color": "%06x" % s["color"],
                            "bbox": [round(v, 1) for v in s["bbox"]],
                        }
                    )
        images = []
        for info in page.get_image_info(xrefs=True):
            images.append({"bbox": [round(v, 1) for v in info["bbox"]], "width": info["width"], "height": info["height"]})
        links = [{"uri": l.get("uri"), "rect": [round(v, 1) for v in l["from"]]} for l in page.get_links() if l.get("uri")]
        drawings = page.get_drawings()
        lines = sum(1 for d in drawings for item in d["items"] if item[0] in ("l", "re"))
        pages.append(
            {
                "width": round(page.rect.width, 1),
                "height": round(page.rect.height, 1),
                "text": page.get_text("text"),
                "spans": spans,
                "images": images,
                "links": links,
                "vectorLines": lines,
                "fonts": sorted({f[3] for f in page.get_fonts(full=True)}),
            }
        )
    print(json.dumps({"pages": pages, "toc": [[lvl, title, pg] for lvl, title, pg in doc.get_toc()], "metadata": doc.metadata}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
