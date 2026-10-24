# Product backlog — after the first launch

The P0 baseline is complete (see `qa/P0_COMPLETENESS_REPORT.md`). Nothing below is built yet; this is the
proposed order for the next releases. Every item has to follow the launch rules: runs on the device, no
upload, no paid or AI service, an honest result screen, and every output reopened by independent validators
before it counts as working.

**Scoring** (1 = low, 5 = high): *Demand* — how often people look for it (search volume for the job and what
users of file-utility sites ask for). *Feasibility* — whether an open, browser-local library or our own code
can do it. *Local quality* — how close a browser-only result gets to what people expect. *Risk* — effort and
the chance of shipping something that disappoints (higher = riskier). **Rank** favours demand and quality and
penalises risk.

| Rank | Feature | Demand | Feasibility | Local quality | Risk | Why here | Approach |
|---:|---|:-:|:-:|:-:|:-:|---|---|
| 1 | **Resize / crop image** (pixels, %, presets for social/ID photos) | 5 | 5 | 5 | 1 | Among the most searched image jobs; the canvas pipeline and EXIF handling already exist | Extend the image processor: target dimensions or aspect-locked crop; reuse the Compress Image result screen |
| 2 | **HEIC → JPG / PNG** | 5 | 3 | 4 | 3 | iPhone photos are HEIC by default; users hit this on the first upload form | libheif compiled to WASM (LGPL, loaded on demand, ~1.5 MB); Safari can decode natively — use that first |
| 3 | **Add page numbers / watermark to PDF** | 4 | 5 | 5 | 1 | Common finishing step after Merge; pdf-lib does it directly | New tool on the Organize/Edit shelf with a live preview; standard fonts only |
| 4 | **Protect / unlock PDF** (add a password; remove a known password) | 4 | 3 | 4 | 3 | People send contracts and payslips; today we only refuse encrypted files | pdf-lib has no encryption; needs qpdf-wasm (Apache-2.0) for AES-256 — verify output opens in Acrobat, Preview, Chrome |
| 5 | **Excel (.xlsx) → PDF** | 4 | 3 | 3 | 3 | The natural next document pair after Word ↔ PDF | Reuse the Word → PDF renderer: read the sheet (SheetJS CE or our own OOXML reader) → tables with page-width fitting and print areas; honest note that charts are shown as a frame |
| 6 | **PowerPoint (.pptx) → PDF** | 4 | 2 | 3 | 4 | Frequently requested, but slides are absolutely-positioned shapes, themes and charts | Reuse the Word → PDF fonts and drawing layer; text boxes, pictures and simple shapes first; charts/SmartArt as placeholders with a note |
| 7 | **GIF / BMP / TIFF → JPG / PNG / PDF** | 3 | 5 | 5 | 1 | Scanners and old systems still produce TIFF; multi-page TIFF → PDF is a real office job | Browser decode for GIF/BMP; UTIF.js (MIT) for TIFF; add to Image Converter and Image to PDF |
| 8 | **PDF → Excel** | 4 | 2 | 2 | 4 | Asked for with bank statements and invoices, but table recovery from PDFs is hard to get right | Build on PDF to Word's table detection; export only tables it's confident about; ship behind a clear "check your numbers" message |
| 9 | **Word (.docx) compression** | 3 | 4 | 4 | 2 | Email attachment limits; most of a .docx's weight is its pictures | Re-encode embedded pictures (reuse Compress Image), keep the package valid; target-size UI like Compress PDF |
| 10 | **PDF → PowerPoint** | 2 | 2 | 2 | 4 | Low demand relative to effort | One slide per page with text boxes from PDF to Word's layout; later |
| 11 | **Legacy .doc → PDF** | 2 | 1 | 2 | 5 | Binary Word 97 format; no reliable open browser parser | Keep the clear "save as .docx" message; revisit only if a well-tested WASM reader appears |
| 12 | **Right-to-left and CJK in Word → PDF** | 3 | 3 | 3 | 3 | Needed for Arabic, Hebrew, Chinese, Japanese, Korean documents | Bidi reordering + shaping (harfbuzzjs, MIT) and on-demand Noto fonts per script |

## Deliberately not planned (LATER)

Video, audio, ZIP/archives, EPUB, CAD, PDF/A, image vectorising (PNG/JPG → SVG), OCR in more languages beyond
the three shipped (can be added cheaply when asked for). Each either needs large codecs, can't be done well in
a browser, or has little demand from people who come for PDFs and documents.

## Quality follow-ups on shipped tools (not new tools)

| Tool | Follow-up | Why |
|---|---|---|
| Word to PDF | Text wrapped around floating pictures; text boxes positioned where Word puts them; Cambria/Aptos metric-compatible fonts | Today floating pictures sit on their own line and text boxes follow their anchor paragraph (stated on the result screen) |
| Word to PDF | Balanced columns at the end of a multi-column section; table styles beyond borders, first-row and banding | Seen in newsletters and designed reports |
| PDF to Word | Complex tables (merged cells) and text wrapped around pictures | The result screen already says complex pages may need touch-ups |
| PDF to Word | Stamps and handwriting in scans are read as noise | OCR limitation; the note asks people to check names and numbers |
