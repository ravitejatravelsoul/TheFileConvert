# Conversion semantics — what each tool means to a normal person

**The rule.** *Convert* means: keep the document's visual meaning and structure in a different container. It does
**not** mean *read the words and retype them*. Text recognition (OCR) is a separate, explicit capability — **Recognize
text** in the PDF Editor — and is never what a converter shows the user by default. Inside a converter OCR may be
used quietly to *decide* something (is this plain scanned text reliable enough to become editable paragraphs?), but
whatever it reads must not replace what the user sees unless the reading is extremely reliable.

**The product-owner test** applied to every tool below: *would a normal user be surprised by this output?* If yes,
that is a FAIL, however good the metrics look. A user who converts a filled-in passport application and gets Word text
with lost handwriting, a missing signature or re-typed field values has been surprised.

Microsoft Word cannot be automated on the development machine (installed, unlicensed, COM hangs). Every `.docx`
verdict in this repository is therefore about the file's structure and about LibreOffice's rendering of it —
**manual Word review is still required** (`qa/manual-word-review/`).

## What kind of document is it? (PDF → Word)

Every page is classified from measured signals — text drawn visibly vs. invisibly (render mode 3), image coverage,
and, for picture pages, pixel analysis (photo regions, page border, rules, check boxes, tinted fills):

| Class | What it is | Default strategy |
|---|---|---|
| `NATIVE_TEXT` | A page with real text (made on a computer) | **editable** Word content |
| `MIXED` | Real text plus large pictures | **editable** (pictures kept in place) |
| `SCANNED_TEXT` | A picture of plain running text, no pictures/fields/shading | **visual**; **hybrid** (editable) only when the on-device reading is extremely reliable |
| `FORM` | A picture of a form: fields, check boxes, shaded bands | **visual** |
| `OFFICIAL_DOCUMENT` | Passport/ID/certificate: portrait photo, page border, stamps | **visual** |
| `SCANNED_TABLE` | A picture of a ruled table (statement, invoice) | **visual** |
| `IMAGE_PAGE` | A photograph of something | **visual** |

*Visual* = the page goes into Word as a picture at the source page size (≤ 200 dpi, never above the scan's own,
JPEG q92 or PNG if smaller), one section per page, no text layer. *Hybrid* is all-or-nothing per document and gated by
`hybridDecision` (≥ 40 words, mean confidence ≥ 92, ≥ 97 % of the page's ink explained by recognised words, ≤ 5 % noise fragments, no pictures or shading, at most 2 rules, ≥ 70 % of words in running-text lines).

**Native vs. scan, by example.** A résumé exported from a word processor: real text → editable Word (headings, list,
table). The same résumé printed and scanned: a picture of paper → the page keeps its look; to edit the words, use
Recognize text. A bank statement downloaded from a bank: native → editable table. The same statement photocopied: a
picture → visual. A form with typed fields exported to PDF: native → editable. The same form filled in by hand and
scanned: visual (handwriting and ticks are ink, not text).

---

## PDF → Word (`/pdf-to-word`)
- **SOURCE** A PDF: native, scanned, or both.
- **ACTION** Convert to a `.docx`.
- **NORMAL USER EXPECTATION** "It looks like my PDF, in Word. If it was typed I can edit it; if it was a scan it just looks like the scan."
- **WHAT MUST BE PRESERVED** Page count and sizes; for scans, everything on the page (borders, lines, handwriting, signatures, stamps, photos, check boxes, logos, typography) — it is the page; for native PDFs, text (100 % recall), headings, lists, tables, pictures, columns, alignment, page breaks.
- **WHAT MAY CHANGE** Native: spacing within a few points, unusual fonts substituted, decorative shapes simplified (documented LIMITED). Scans: not editable text.
- **WHAT MUST NEVER HAPPEN** A scanned form/ID/certificate/statement turning into retyped (possibly wrong) Word text; OCR text shown over or instead of the picture; a DOCX several times the size of the PDF; an upload.
- **HOW WE TEST IT** `qa/scripts/rup-audit.mjs p2w`: 11 fake documents + the user's own scan through the real page; the DOCX is rendered by LibreOffice and compared with the source (SSIM with ±1 px alignment, page sizes, text characters = 0, one picture per page, ≥ 140 dpi, ≤ 1.2 MB/page, no OCR text); native pages by text recall, reading order, table/picture counts, SSIM. Unit tests: `classify.test.ts`, `docx.test.ts`. e2e: `pdf-to-word-ocr.spec.ts`, `pdf-to-word.spec.ts`.

## Image → Word (`/image-to-word`)
- **SOURCE** PNG/JPG/WebP photos, scans, screenshots.
- **ACTION** Put each image on a Word page.
- **NORMAL USER EXPECTATION** "My picture, in a Word file, the way it looks. One image per page, in order, not stretched, not cut off."
- **WHAT MUST BE PRESERVED** The pixels (JPG/PNG bytes embedded untouched; sideways JPEGs turned upright; WebP saved as JPG/PNG), proportions, order, orientation (wide images get a landscape page).
- **WHAT MAY CHANGE** Page size (Fit to image ≤ Letter, A4, Letter with margin); small images are not enlarged past 96 dpi on A4/Letter.
- **WHAT MUST NEVER HAPPEN** Recognised text instead of the picture; clipping; stretching; recompression of JPG/PNG.
- **HOW WE TEST IT** `rup-audit.mjs i2w` (9 scenarios: filled form, ID, receipt, screenshot, photo with text, table image, A4, Letter, four images in order) — media SHA-1 equals the source, page aspect, no text, LibreOffice render vs image; `image-to-word.test.ts` (placement maths); `image-to-word.spec.ts`.

## Word → PDF (`/word-to-pdf`)
- **SOURCE** A `.docx`.
- **ACTION** Render it as a PDF.
- **NORMAL USER EXPECTATION** "Same as printing it to PDF from Word."
- **HOW IT REALLY WORKS** A rendering conversion, not extraction-and-rebuild: our own layout engine parses the document's XML (styles, numbering, tables, headers/footers, pictures, fields), loads or substitutes fonts, lays the pages out and draws real vector text and pictures with pdf-lib. It is **not Word's engine**, so line breaks and spacing can differ from Word by a few points (LIMITED on complex files); fonts that cannot be loaded are substituted and the user is told.
- **WHAT MUST BE PRESERVED** Pages, text (selectable), fonts where available, tables, pictures, headers/footers, page numbers.
- **WHAT MUST NEVER HAPPEN** A flat picture of the pages; lost text; an upload.
- **HOW WE TEST IT** `rup-audit.mjs w2p` against LibreOffice's rendering of the same file (pages, sizes, text recall, SSIM); `word-to-pdf.test.ts`; `word-to-pdf.spec.ts`.

## PDF → Image (`/pdf-to-image`)
- **SOURCE** A PDF. **ACTION** Render each page to PNG/JPG.
- **NORMAL USER EXPECTATION** "A picture of each page exactly as it looks."
- **PRESERVED** Appearance, aspect ratio, readability at normal zoom (≥ 140 dpi). **MAY CHANGE** Anti-aliasing; JPG is lossy. **NEVER** OCR, text rewriting, cropped pages.
- **TEST** `rup-audit.mjs p2i` (scan, form, certificate landscape, two-page statement, native résumé, report) — render vs independent MuPDF render (SSIM, aspect, dpi, image count, no OCR requests); `fid-tools.mjs p2i`.

## Image → PDF (`/image-to-pdf`)
- **SOURCE** Images. **ACTION** One image per PDF page.
- **EXPECTATION** "My images in a PDF, same look, in order."
- **PRESERVED** Pixels (JPEG embedded byte-for-byte; PNG lossless incl. transparency), proportions, orientation, order. **MAY CHANGE** Page size (Fit/A4/Letter). **NEVER** OCR text added, recompression, clipping, stretching.
- **TEST** `rup-audit.mjs i2p` + `fid-tools.mjs i2p` — embedded bytes/pixels vs source, aspect, inside page, zero text characters in the PDF.

## Compress PDF (`/compress-pdf`)
- **SOURCE** A PDF and a target size. **ACTION** Make it smaller.
- **EXPECTATION** "Smaller, still readable, still looks like mine, still has the same pages. Tell me if it can't reach the target."
- **PRESERVED** Pages, sizes, rotation, text (not rasterised when it is real text), form fields where possible, readable scans (signatures, stamps). **MAY CHANGE** Images are re-encoded/downsampled. **NEVER** A file that doesn't open, lost pages, text turned into a blurry picture, a larger output presented as success.
- **TEST** `rup-audit.mjs cpdf` (four scans; SSIM, pages, size, target) + `fid-tools.mjs cpdf` (text, mixed, photo, rotated, form, scan fixtures).

## Compress Image (`/compress-image`)
- **EXPECTATION** "Smaller picture that looks the same at normal size; text in it still readable; tell me if you shrank it."
- **PRESERVED** Look (PSNR ≥ 30 dB), orientation, transparency where the format allows, EXIF orientation applied. **MAY CHANGE** Lossy re-encode, resize if the target needs it (stated). **NEVER** Silent resize, a larger output, lost transparency without a word.
- **TEST** `rup-audit.mjs cimg` (filled form PNG, photo with text, receipt JPG, ID PNG) + `fid-tools.mjs cimg`.

## Image Converter (`/convert-image`)
- **EXPECTATION** "The same picture in another format." **PRESERVED** Pixels (lossless targets exact), size, transparency (JPG flattened on white by design). **NEVER** Resizing, colour shifts, OCR.
- **TEST** `fid-tools.mjs convert` (11 conversions).

## Merge PDF (`/merge-pdf`)
- **EXPECTATION** "My files, one after another, untouched." **PRESERVED** Every page identical to its source, order, page sizes, rotation, text. **NEVER** Re-rendering, recompression, reordering, dropped pages.
- **TEST** `rup-audit.mjs merge` (native + scanned documents) + `fid-tools.mjs merge` — per-page SSIM ≥ 0.999, text recall 100 %.

## Split PDF (`/split-pdf`)
- **EXPECTATION** "Exactly the pages I picked, unchanged." **PRESERVED** Selected pages identical to their source pages. **NEVER** Extra or missing pages, altered content.
- **TEST** `rup-audit.mjs split` (extract page 2 of a scan; every page → ZIP) + `fid-tools.mjs split`.

## Organize PDF (`/organize-pdf`)
- **EXPECTATION** "Reorder, turn and delete pages — nothing else changes." **PRESERVED** Page content; rotation applied exactly as asked (also on already-rotated pages). **NEVER** Content re-rendered.
- **TEST** `rup-audit.mjs organize` + `fid-tools.mjs organize`.

## PDF Editor (`/pdf-editor`)
- **EXPECTATION** "I change what I meant to change; the rest of the page stays exactly as it was." **PRESERVED** Everything outside the edit (≤ 0.05 % pixels changed outside). **MAY CHANGE** The edit; a corrected native word is drawn in Helvetica at the line's size, in the line's own colour on the page's own background (white-on-dark stays white-on-dark) — bold/other typefaces are not matched (LIMITED). **NEVER** Re-rendered pages, lost text, a white box on a dark band.
- **TEST** `rup-audit.mjs editor` (no-edit export of a scan, typed note, highlight, native correction on a dark band) + `fid-tools.mjs editor` (10 operations).

## Recognize text / OCR (inside the PDF Editor — the only place OCR is a result)
- **SOURCE** A scanned PDF. **ACTION** The user presses *Recognize text*.
- **EXPECTATION** "The scan looks exactly as before, but I can search it, select text and fix a misread word."
- **PRESERVED** Every pixel (invisible text layer only), page count/sizes. **NEVER** Run without being asked in this tool; change the look of the page; export words twice.
- **TEST** `rup-audit.mjs ocr` (scanned letter, filled application, invoice: searchable % of the document's words, editable %, pixels unchanged) + `fid-tools.mjs ocr ocrsearch`.
