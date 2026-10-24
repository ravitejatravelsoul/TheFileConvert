"""What is inside a .docx — QA only, independent of the product (stdlib + Pillow).

    python qa/validate/docxinfo.py FILE.docx

Prints one JSON line:
  sections      number of Word sections (the product writes one per source page)
  pageSizes     [[width_pt, height_pt], …] from each section's w:pgSz
  textChars     visible characters in the body text runs (0 for a picture-only document)
  tables        w:tbl count
  paragraphs    w:p count
  drawings      pictures in the body (inline or anchored)
  media         [{name, bytes, sha1, width, height}, …] for word/media/*
  bytes         size of the .docx
  anchoredBehind pictures anchored behind text
"""
import hashlib
import io
import json
import os
import re
import sys
import zipfile

from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")


def main(path):
    z = zipfile.ZipFile(path)
    xml = z.read("word/document.xml").decode("utf8")
    sizes = [[int(w) / 20, int(h) / 20] for w, h in re.findall(r'<w:pgSz w:w="(\d+)" w:h="(\d+)"', xml)]
    text = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", xml))
    media = []
    for n in z.namelist():
        if n.startswith("word/media/"):
            b = z.read(n)
            try:
                w, h = Image.open(io.BytesIO(b)).size
            except Exception:
                w = h = None
            media.append({"name": n, "bytes": len(b), "sha1": hashlib.sha1(b).hexdigest(), "width": w, "height": h})
    print(
        json.dumps(
            {
                "sections": len(sizes),
                "pageSizes": sizes,
                "textChars": len(re.sub(r"\s", "", text)),
                "tables": xml.count("<w:tbl>"),
                "paragraphs": xml.count("<w:p>") + xml.count("<w:p "),
                "drawings": xml.count("<w:drawing>"),
                "anchoredBehind": len(re.findall(r'behindDoc="1"', xml)),
                "media": media,
                "bytes": os.path.getsize(path),
                "text": text[:4000],
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1])
