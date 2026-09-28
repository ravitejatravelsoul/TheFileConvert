# P0 completeness report — fresh launch

Branch `rebuild/fresh-launch`, starting from `ea23e3c` (PDF to Word). Nothing deployed, nothing merged.
Companion documents: `qa/PRODUCT_CAPABILITY_MATRIX.md` (what exists, pair by pair), `qa/PRODUCT_BACKLOG.md`
(what's next and why), `qa/FULL_SCENARIO_ACCEPTANCE.md` (every scenario, every output reopened).

## How the audit was done

The capability list was rebuilt from the code — the tool registry, the routes under `src/app`, the desktop
menus and phone sheet, All tools, the sitemap and redirects, the homepage smart upload's accepted types and
suggestions, every tool's "Continue with" step and the processors themselves — not from earlier reports. Then
each conversion was checked for its reverse, each input type for what the smart upload offers, and six
complete user journeys were walked in a real browser.

## What obvious gaps existed

| # | Gap | How a first-time visitor would hit it | Severity |
|---|---|---|---|
| 1 | **Word → PDF did not exist**, while PDF → Word did | "I converted my PDF to Word, edited it — how do I get a PDF back?" The most-used document conversion on file-utility sites | P0 |
| 2 | The homepage upload **rejected Word files** ("isn't supported yet") | Dropping a .docx on the front page — a dead end on the first action | P0 |
| 3 | The **PDF Editor ended in a download with no next step** | Organize → edit → compress needed a manual download and re-pick; every other tool hands its result on | P0 |
| 4 | PDF to Word's result and related tools **never pointed back to PDF** | No discoverable way home from Word | P0 |
| 5 | **Inconsistent names**: "Convert Images" and "Images to PDF" next to "PDF to Image" / "PDF to Word"; the Convert menu wasn't ordered in pairs | Harder to scan; looked like a random collection rather than pairs | P0 |
| 6 | **Common URLs 404'd**: /jpg-to-pdf, /pdf-to-jpg, /docx-to-pdf, /pdf-to-docx, /edit-pdf, /rotate-pdf, /jpg-to-png… | Typed or remembered URLs from other sites ended in "not found" | P0 |
| 7 | **Hard-coded tool counts** ("See all ten tools", "Ten tools") | Bragging about count, and stale the moment a tool is added | P0 (copy) |
| 8 | A **Word file dropped on a PDF tool** got a generic "not supported" | Picked the wrong direction with no pointer to the right tool | P0 (UX) |
| 9 | **PDF → Word tables**: the last column was sized to the text with no padding, so "$36.00" wrapped in Word (found by the new PDF → Word → PDF round trip) | Tables needed a manual column drag after conversion | P0 (quality) |

The rest of the P0 baseline was already present and working: Compress PDF, Compress Image, PDF → JPG/PNG,
JPG/PNG/WebP → PDF (single and several), all six JPG/PNG/WebP pairs, SVG → PNG (and JPG/WebP), Merge, Split,
Organize (reorder, rotate, delete, duplicate), the PDF Editor, and OCR for scanned PDFs in both the editor and
PDF to Word.

## What was implemented

1. **Word to PDF** — `/word-to-pdf`, browser-only, no upload, no paid or cloud API.
   - `src/lib/processors/word-to-pdf/`: a DOCX (Office Open XML) reader — styles with inheritance, the
     theme's fonts, numbering (bullets, 1./a./i., nested, restarts), tables (grid, merged cells, borders,
     shading, table-style first-row/banding, repeated header rows, rows split across pages), pictures (inline
     and anchored), headers/footers (first/even/default, PAGE and NUMPAGES), footnotes, hyperlinks, fields,
     tabs with leaders, sections (page size, orientation, margins, columns); a layout
     engine (line breaking, justification, spacing, keep-with-next, widow/orphan control, page and column
     breaks); a pdf-lib renderer with subset-embedded fonts, links and heading bookmarks.
   - Fonts: Word's fonts can't be redistributed, so Calibri, Arial, Times New Roman and Courier New are drawn
     with open fonts of identical widths (Carlito, Liberation Sans/Serif/Mono), plus DejaVu Sans for symbols
     (₹ ✓ ☐ →). They're loaded only during a conversion. Carlito's glyph data is re-aligned in memory before
     pdf-lib subsets it (pdf-lib corrupts odd-length glyphs); the shipped font file stays unmodified.
   - The PDF is reopened before it's offered; a file that doesn't reopen is never handed over.
   - .doc (Word 97–2003) is **not** claimed: it's refused everywhere with "save it as .docx". Password-protected,
     damaged, empty and non-Word files each get their own plain message and no download.
   - Copy: "Convert Word documents to PDF while preserving common formatting, images, lists and tables." and
     "Complex Word layouts may vary slightly from Microsoft Word." No "perfect" claims.
2. **Smart upload** takes .docx (offers Convert to PDF) and explains .doc; mixed kinds get one clear message.
3. **PDF Editor** shows "Downloaded … — Continue with Compress PDF / Merge PDF / PDF to Word" after export.
4. **Related flows**: PDF to Word → "Edited it and need a PDF again? Word to PDF"; Word to PDF → Continue with
   Compress / Editor / Merge, and "Need editable text from a PDF? PDF to Word"; related cards updated.
5. **Naming** — one system: conversions are "X to Y" (PDF to Word, Word to PDF, PDF to Image, Image to PDF),
   actions are "Verb Noun" (Compress PDF, Merge PDF…), plus "Image Converter" and "PDF Editor". The Convert menu
   and All tools read in pairs.
6. **Redirects** for 19 common aliases, each to its one canonical page (no duplicate pages).
7. Tool counts removed from copy ("See all tools", "Every tool").
8. Validators point a .docx on a PDF tool to Word to PDF, and explain .doc on Word to PDF.
9. PDF to Word's last table column gets cell padding.

## Verification (details in `qa/FULL_SCENARIO_ACCEPTANCE.md`)

| Check | Result |
|---|---|
| Word → PDF, real browser (15 documents + 5 bad files, desktop and Pixel 7) | 42 runs, 42 PASS; 28 PDFs downloaded, 28 reopened by qpdf, MuPDF, pdf-lib and pdf.js; text recall and order 100 % on every document; 0 uploads |
| Round trips | PDF → Word → PDF: 9/9 PASS (text, order, pictures, bold and page count kept). Word → PDF → Word: 8/8 PASS (text, headings, bold/italic, lists, tables, pictures kept) |
| Journeys A–F (Word→PDF→compress <1 MB; PDF→Word→PDF; JPG→PDF→merge→compress; PDF→organize→edit→compress; scan→OCR→Word; PNG→WebP→compress) | 6/6 PASS, every hand-off through the product's own "Continue with" or link, 0 uploads |
| Existing tools, real browser | 117/117 PASS (converter now also covers SVG → WebP); PDF → Word regression 32/32 PASS (desktop + mobile) |
| Whole acceptance report | 308 scenarios: 305 PASS, 3 LIMITED (honest "target not reached" compressions, unchanged), 0 FAIL; 250 outputs downloaded, 250 reopened, 0 corrupt |
| Unit tests | 330/330 (16 new for Word → PDF) |
| Playwright (full, one worker) | 289 passed, 7 skipped (pre-existing, by design), 0 failed |
| TypeScript / ESLint / build / npm audit | 0 errors / 0 problems / PASS / 0 vulnerabilities |

## What was intentionally deferred, and why

| Deferred | Why | Where |
|---|---|---|
| Legacy .doc | Binary Word 97 format; no reliable open browser reader. Pretending would produce broken PDFs | Backlog #11 — refused honestly today |
| Excel / PowerPoint ↔ PDF | Real demand, but a separate engine each (sheets, slides); not needed for a complete PDF/Word/image core | Backlog #5, #6, #8, #10 |
| HEIC, TIFF/GIF/BMP | Valuable; needs a WASM decoder (HEIC) or more formats in the converter | Backlog #2, #7 |
| Resize/crop, page numbers/watermark, protect/unlock PDF | Next-release tools, not reverse-flow gaps | Backlog #1, #3, #4 |
| PNG/JPG → SVG | Tracing isn't faithful; would disappoint | LATER |
| Word → PDF: wrap text around floating pictures, positioned text boxes, RTL/CJK shaping | Floating pictures sit on their own line (nothing overlaps); the result screen notes text boxes, equations, right-to-left text and characters without a font when a document uses them | Backlog quality follow-ups, #12 |
| Video, audio, ZIP, EPUB, CAD | Outside the PDF/document/image product | LATER |

## First-time customer check

- **"I have a PDF."** Compress to a size, edit it (scans too), turn it into Word, into JPG/PNG, split it, reorder/rotate/delete pages, merge it with others — all offered the moment it's dropped on the homepage, and each result hands on to the next step.
- **"I have a Word document."** Drop it anywhere on the homepage → Convert to PDF → continue straight to Compress, Edit or Merge. An old .doc gets told exactly how to make it work.
- **"I have an image."** Compress to a size, convert between JPG/PNG/WebP (SVG to any), or make a PDF from one or many — then continue to compress or merge.

No pair is exposed in one direction only (except SVG → raster, which is intentional).
