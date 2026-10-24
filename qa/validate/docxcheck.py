"""Independent DOCX validation for QA (not shipped).

    python qa/validate/docxcheck.py file.docx [...]   -> one JSON object per line

Two independent checks, neither sharing code with the app:
  * Package/OOXML structure with zipfile + lxml: required parts, every XML part well-formed, every
    part covered by [Content_Types].xml, every internal relationship target present, the main document
    rooted at w:document with a w:body, every embedded image decodable (Pillow).
  * python-docx opens the file and reads paragraphs (with style, list numbering format, bold/italic
    runs), tables, inline pictures and sections — the structure the report checks.
"""
import io
import json
import posixpath
import sys
import zipfile

from lxml import etree
from PIL import Image

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}


def check(path):
    out = {"file": path, "ok": True, "problems": []}

    def fail(msg):
        out["ok"] = False
        out["problems"].append(msg)

    # ---- package / OOXML
    try:
        z = zipfile.ZipFile(path)
    except Exception as e:  # noqa: BLE001
        fail(f"not a ZIP: {e}")
        return out
    names = set(z.namelist())
    for req in ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]:
        if req not in names:
            fail(f"missing {req}")
    parsed = {}
    for n in names:
        if n.endswith(".xml") or n.endswith(".rels"):
            try:
                parsed[n] = etree.fromstring(z.read(n))
            except Exception as e:  # noqa: BLE001
                fail(f"{n}: not well-formed ({e})")
    ct = parsed.get("[Content_Types].xml")
    if ct is not None:
        ctns = "{http://schemas.openxmlformats.org/package/2006/content-types}"
        defaults = {d.get("Extension").lower() for d in ct.iter(ctns + "Default")}
        overrides = {o.get("PartName").lstrip("/") for o in ct.iter(ctns + "Override")}
        for n in names:
            if n.endswith("/") or n == "[Content_Types].xml":
                continue
            if n not in overrides and n.rsplit(".", 1)[-1].lower() not in defaults:
                fail(f"{n} has no content type")
        for o in overrides:
            if o not in names:
                fail(f"content type override for missing part {o}")
    for n, root in parsed.items():
        if not n.endswith(".rels"):
            continue
        base = posixpath.dirname(posixpath.dirname(n))
        for rel in root:
            if rel.get("TargetMode") == "External":
                continue
            target = rel.get("Target")
            full = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(base, target))
            if full not in names:
                fail(f"{n}: relationship {rel.get('Id')} -> missing {full}")
    doc = parsed.get("word/document.xml")
    if doc is not None:
        if doc.tag != f"{{{W}}}document" or doc.find("w:body", NS) is None:
            fail("word/document.xml is not a w:document with a w:body")
    images = []
    for n in sorted(names):
        if n.startswith("word/media/") and not n.endswith("/"):
            try:
                im = Image.open(io.BytesIO(z.read(n)))
                im.load()
                images.append({"part": n, "px": [im.width, im.height], "decoded": True})
            except Exception as e:  # noqa: BLE001
                images.append({"part": n, "decoded": False})
                fail(f"{n}: image does not decode ({e})")

    # numbering formats: numId -> bullet/decimal
    fmt_of = {}
    num = parsed.get("word/numbering.xml")
    if num is not None:
        abstract = {a.get(f"{{{W}}}abstractNumId"): (a.find("w:lvl/w:numFmt", NS).get(f"{{{W}}}val") if a.find("w:lvl/w:numFmt", NS) is not None else None) for a in num.findall("w:abstractNum", NS)}
        for n in num.findall("w:num", NS):
            aid = n.find("w:abstractNumId", NS).get(f"{{{W}}}val")
            fmt_of[n.get(f"{{{W}}}numId")] = abstract.get(aid)

    # ---- python-docx
    try:
        import docx  # python-docx
        from docx.shared import Emu  # noqa: F401

        d = docx.Document(path)
        paras = []
        for p in d.paragraphs:
            text = p.text
            numPr = p._p.find("w:pPr/w:numPr", NS)
            lst = None
            if numPr is not None:
                nid = numPr.find("w:numId", NS).get(f"{{{W}}}val")
                lst = fmt_of.get(nid, "?")
            if not text.strip() and lst is None:
                continue
            paras.append(
                {
                    "style": p.style.name if p.style is not None else None,
                    "text": text,
                    "list": lst,
                    "bold": [r.text for r in p.runs if r.bold and r.text.strip()],
                    "italic": [r.text for r in p.runs if r.italic and r.text.strip()],
                    "align": str(p.alignment) if p.alignment is not None else None,
                }
            )
        tables = [[[c.text for c in row.cells] for row in t.rows] for t in d.tables]
        shapes = [{"w_pt": s.width.pt, "h_pt": s.height.pt} for s in d.inline_shapes]
        # "newPage": whether the section starts a page (a continuous section — Word's way of switching to
        # columns part-way down a page — doesn't).
        sections = [{"w_pt": round(s.page_width.pt, 1), "h_pt": round(s.page_height.pt, 1), "newPage": s.start_type != 0} for s in d.sections]
        out.update({"paragraphs": paras, "tables": tables, "pictures": shapes, "sections": sections, "images": images})
        # Text in document order (paragraphs and table rows as they appear in the body).
        order = []
        for el in d.element.body.iterchildren():
            tag = etree.QName(el).localname
            if tag == "p":
                t = "".join(x.text or "" for x in el.iter(f"{{{W}}}t"))
                if t.strip():
                    order.append(t)
            elif tag == "tbl":
                for tr in el.iter(f"{{{W}}}tr"):
                    order.append("\t".join("".join(x.text or "" for x in tc.iter(f"{{{W}}}t")) for tc in tr.iter(f"{{{W}}}tc")))
        out["text"] = "\n".join(order)
    except Exception as e:  # noqa: BLE001
        fail(f"python-docx: {e}")
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for f in sys.argv[1:]:
        print(json.dumps(check(f), ensure_ascii=False), flush=True)
