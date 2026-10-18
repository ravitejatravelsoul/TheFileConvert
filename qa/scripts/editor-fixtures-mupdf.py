"""PDF Editor fixtures built with MuPDF: AcroForm, rotated pages, mixed page sizes, watermark, annotations, CropBox.
Called by editor-fixtures.mjs:  python editor-fixtures-mupdf.py OUTDIR   (writes OUTDIR/_manifest-mupdf.json)."""
import json
import os
import sys

import pymupdf

OUT = sys.argv[1]
manifest = {}
ARIAL = r"C:\Windows\Fonts\arial.ttf"
ARIALB = r"C:\Windows\Fonts\arialbd.ttf"
TIMES = r"C:\Windows\Fonts\times.ttf"
LINES = [
    "The committee will recieve the final report before the end of the quarter.",
    "A seperate budget was prepared for the northern office, wich had occured late.",
    "We definately expect the new process to reduce waiting times.",
    "Please send your adress so that teh team can confirm the appointment.",
]


def text_page(doc, size=(612, 792), title="Test page", font="helv", fontfile=None, x=72, y0=90, step=22):
    p = doc.new_page(width=size[0], height=size[1])
    kw = {"fontfile": fontfile, "fontname": "F1"} if fontfile else {"fontname": font}
    p.insert_text((x, y0 - 30), title, fontsize=20, **kw)
    for i, line in enumerate(LINES):
        p.insert_text((x, y0 + i * step), line, fontsize=11, **kw)
    return p


def save(doc, name, producer, what, targets=()):
    doc.save(os.path.join(OUT, name), garbage=3, deflate=True)
    manifest[name] = {"producer": producer, "what": what, "targets": [list(t) for t in targets]}


# ---- 05 AcroForm: text, checkbox, radio group, dropdown, list box (+ a field with an existing value)
doc = pymupdf.open()
p = doc.new_page(width=612, height=792)
p.insert_text((72, 70), "Membership application", fontsize=20, fontname="helv")
p.insert_text((72, 96), "All people and numbers are invented. Please recieve this form with teh fee.", fontsize=10, fontname="helv")
rows = [("Full name", "full_name", "text", "Alex Morgan"), ("Email", "email", "text", ""), ("Phone", "phone", "text", ""), ("Subscribe to newsletter", "newsletter", "check", False)]
y = 130
for label, name, kind, val in rows:
    p.insert_text((72, y + 12), label, fontsize=11, fontname="helv")
    w = pymupdf.Widget()
    w.rect = pymupdf.Rect(230, y, 480, y + 20)
    w.field_name = name
    if kind == "text":
        w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        w.field_value = val
        w.text_fontsize = 11
    else:
        w.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
        w.rect = pymupdf.Rect(230, y + 2, 246, y + 18)
        w.field_value = False
    p.add_widget(w)
    y += 34
p.insert_text((72, y + 12), "Membership type", fontsize=11, fontname="helv")
for i, opt in enumerate(["Student", "Individual", "Family"]):
    w = pymupdf.Widget()
    w.field_type = pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON
    w.field_name = "member_type"
    w.rect = pymupdf.Rect(230 + i * 110, y + 2, 246 + i * 110, y + 18)
    w.field_value = False
    p.add_widget(w)
    p.insert_text((252 + i * 110, y + 14), opt, fontsize=10, fontname="helv")
y += 34
p.insert_text((72, y + 12), "Country", fontsize=11, fontname="helv")
w = pymupdf.Widget()
w.field_type = pymupdf.PDF_WIDGET_TYPE_COMBOBOX
w.field_name = "country"
w.rect = pymupdf.Rect(230, y, 400, y + 20)
w.choice_values = ["Utopia", "Freedonia", "Elbonia", "Ruritania"]
w.field_value = "Utopia"
w.text_fontsize = 11
p.add_widget(w)
y += 34
p.insert_text((72, y + 12), "Interests", fontsize=11, fontname="helv")
w = pymupdf.Widget()
w.field_type = pymupdf.PDF_WIDGET_TYPE_LISTBOX
w.field_name = "interests"
w.rect = pymupdf.Rect(230, y, 400, y + 60)
w.choice_values = ["Reading", "Hiking", "Chess", "Cooking"]
w.field_value = "Chess"
w.text_fontsize = 10
p.add_widget(w)
save(doc, "EDITOR-05-form-acroform.pdf", "MuPDF AcroForm", "text, checkbox, radio group, dropdown, list box", [("recieve", "receive"), ("teh", "the")])

# MuPDF writes three separate "member_type" fields, each with the on-state "Yes". A real radio group is one field with a
# widget per choice, each choice named (what pdf-lib and Acrobat read as the options): rebuild it that way.
import pikepdf  # noqa: E402

_path = os.path.join(OUT, "EDITOR-05-form-acroform.pdf")
with pikepdf.open(_path, allow_overwriting_input=True) as _pk:
    _fields = _pk.Root.AcroForm.Fields
    _radios = [f for f in _fields if str(f.get("/T", "")) == "member_type"]
    _parent = _pk.make_indirect(pikepdf.Dictionary(FT=pikepdf.Name("/Btn"), T=pikepdf.String("member_type"), Ff=49152, V=pikepdf.Name("/Off")))
    _kids = pikepdf.Array()
    for _w, _opt in zip(_radios, ["Student", "Individual", "Family"]):
        for _key in ("/T", "/FT", "/Ff", "/V"):
            if _key in _w:
                del _w[_key]
        for _k in ("/N", "/D"):
            if _k in _w.AP and "/Yes" in _w.AP[_k]:
                _w.AP[_k][pikepdf.Name("/" + _opt)] = _w.AP[_k]["/Yes"]
                del _w.AP[_k]["/Yes"]
        _w.AS = pikepdf.Name("/Off")
        _w.Parent = _parent
        _kids.append(_w)
    _parent.Kids = _kids
    _keep = [f for f in _fields if str(f.get("/T", "")) != "member_type" and not any(f.objgen == r.objgen for r in _radios)]
    _pk.Root.AcroForm.Fields = pikepdf.Array(_keep + [_parent])
    _pk.save(_path)

# ---- 09 rotated pages (the /Rotate entry on text pages)
doc = pymupdf.open()
for rot in (0, 90, 180, 270):
    p = text_page(doc, title=f"Page rotated {rot}", fontfile=ARIAL)
    p.set_rotation(rot)
save(doc, "EDITOR-09-rotated-pages.pdf", "MuPDF, /Rotate 0/90/180/270", "rotated pages", [("recieve", "receive"), ("teh", "the")])

# ---- 10 mixed page sizes
doc = pymupdf.open()
for name, size in [("Letter", (612, 792)), ("A4", (595.28, 841.89)), ("A5", (419.53, 595.28)), ("Landscape", (792, 612)), ("Legal", (612, 1008))]:
    text_page(doc, size=size, title=f"{name} page", fontfile=ARIAL)
save(doc, "EDITOR-10-mixed-page-sizes.pdf", "MuPDF, five page sizes", "mixed page sizes", [("recieve", "receive"), ("teh", "the")])

# ---- 17 watermark (a rotated grey word on every page + native text)
doc = pymupdf.open()
for i in range(3):
    p = text_page(doc, title=f"Draft contract — page {i + 1}", fontfile=ARIAL)
    p.insert_text((120, 560), "CONFIDENTIAL", fontsize=64, fontname="helv", color=(0.82, 0.82, 0.82), rotate=0, morph=(pymupdf.Point(120, 560), pymupdf.Matrix(1, 0, 0, 1, 0, 0).prerotate(35)))
save(doc, "EDITOR-17-watermark.pdf", "MuPDF, grey rotated watermark text", "watermark on each page", [("recieve", "receive"), ("teh", "the")])

# ---- 18 annotations (real PDF annotations: highlight, underline, strike, note, free text, ink, square, line)
doc = pymupdf.open()
p = text_page(doc, title="Reviewed draft", fontfile=ARIAL)
hits = p.search_for("recieve")
if hits:
    p.add_highlight_annot(hits[0])
hits = p.search_for("seperate")
if hits:
    p.add_underline_annot(hits[0])
hits = p.search_for("definately")
if hits:
    p.add_strikeout_annot(hits[0])
p.add_text_annot((400, 80), "Check this paragraph with the author.")
p.add_freetext_annot(pymupdf.Rect(72, 300, 340, 340), "Free text note", fontsize=12, text_color=(0.7, 0, 0))
p.add_ink_annot([[(72, 400), (120, 380), (170, 420), (220, 390)]])
p.add_rect_annot(pymupdf.Rect(72, 450, 240, 500))
p.add_line_annot((260, 450), (420, 500))
save(doc, "EDITOR-18-annotations.pdf", "MuPDF, real annotations", "eight annotation kinds", [("recieve", "receive")])

# ---- 19 CropBox (MediaBox with a non-zero origin, and a CropBox smaller than the MediaBox)
doc = pymupdf.open()
p = text_page(doc, size=(700, 900), title="Cropped page", fontfile=ARIAL, x=120, y0=150)
p.set_cropbox(pymupdf.Rect(60, 90, 640, 760))
p2 = text_page(doc, size=(612, 792), title="Second page, default boxes", fontfile=ARIAL)
save(doc, "EDITOR-19-cropbox.pdf", "MuPDF, CropBox ≠ MediaBox", "CropBox", [("recieve", "receive"), ("teh", "the")])

json.dump(manifest, open(os.path.join(OUT, "_manifest-mupdf.json"), "w"), indent=1)
print("MuPDF fixtures:", len(manifest))
