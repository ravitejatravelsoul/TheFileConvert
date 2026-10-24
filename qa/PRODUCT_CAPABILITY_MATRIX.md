# Product capability matrix — fresh launch

Built from the repository, not from earlier reports: `src/lib/tools/registry.ts` (tools, accepted types, smart-upload suggestions), `src/app/*/page.tsx` (routes), `src/components/layout/nav.ts` + `SiteHeader.tsx` (menus, phone sheet), `src/app/tools/page.tsx` (All tools), `src/app/sitemap.ts`, `next.config.ts` (redirects), each tool's `ContinueWith` step and the processors under `src/lib/processors/`.

**Columns.** *Implemented*: a processor and a UI exist and produce the output. *Discoverable*: reachable from the nav menu, the phone menu, All tools, the sitemap, and — where the input type fits — the homepage smart upload. *Tested*: automated unit/Playwright tests plus the real-browser scenario runs in `qa/FULL_SCENARIO_ACCEPTANCE.md` (every output reopened by independent validators). *Reverse*: whether the opposite direction exists. *Priority*: **P0** = a first-time visitor would expect it at launch; **P1** = valuable next release; **LATER** = low demand or can't be done reliably in a browser.

## PDF

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| PDF → smaller PDF (target size) | Compress PDF `/compress-pdf` | YES | YES | YES | PASS — hits the target or says honestly it can't | n/a | P0 |
| PDF → Word (.docx), incl. scans via OCR | PDF to Word `/pdf-to-word` | YES | YES | YES | PASS — text/order 100 % on native fixtures, OCR ≥ 90 % | Word → PDF: **YES (added in this pass)** | P0 |
| PDF → JPG | PDF to Image `/pdf-to-image` | YES | YES (also `/pdf-to-jpg`) | YES | PASS | JPG → PDF: YES | P0 |
| PDF → PNG | PDF to Image `/pdf-to-image` | YES | YES (also `/pdf-to-png`) | YES | PASS | PNG → PDF: YES | P0 |
| Scanned PDF → editable text | PDF Editor (Recognize text) + PDF to Word | YES | YES | YES | PASS (on-device OCR; check names and numbers) | n/a | P0 |
| PDF → Excel | — | NO | — | — | — | Excel → PDF: NO | P1 |
| PDF → PowerPoint | — | NO | — | — | — | PowerPoint → PDF: NO | P1 |
| PDF → plain text (.txt) | — | NO (PDF to Word covers the need) | — | — | — | — | LATER |
| PDF → PDF/A | — | NO | — | — | — | — | LATER |

## Documents (Word)

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| Word (.docx) → PDF | Word to PDF `/word-to-pdf` **(new)** | YES | YES — Convert menu, All tools, phone menu, sitemap, smart upload for .docx, `/docx-to-pdf` | YES | PASS — see the Word → PDF section of the acceptance report | PDF → Word: YES | **P0 — was missing** |
| Legacy Word 97–2003 (.doc) → PDF | — | NO, on purpose (can't be read reliably in a browser); .doc gets a clear “save as .docx” message everywhere | — | YES (refusal) | Honest refusal | — | LATER |
| Word → smaller Word | — | NO | — | — | — | — | P1 (“document compression”) |
| Excel (.xlsx) → PDF | — | NO | — | — | — | — | P1 |
| PowerPoint (.pptx) → PDF | — | NO | — | — | — | — | P1 |
| ODT / RTF / EPUB → PDF | — | NO | — | — | — | — | LATER |

## Images

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| JPG → PNG | Image Converter `/convert-image` | YES | YES (`/jpg-to-png`) | YES | PASS | PNG → JPG: YES | P0 |
| JPG → WebP | Image Converter | YES | YES (`/jpg-to-webp`) | YES | PASS | WebP → JPG: YES | P0 |
| PNG → JPG | Image Converter | YES | YES (`/png-to-jpg`) | YES | PASS (transparency → white, stated) | JPG → PNG: YES | P0 |
| PNG → WebP | Image Converter | YES | YES (`/png-to-webp`) | YES | PASS (alpha kept) | WebP → PNG: YES | P0 |
| WebP → JPG | Image Converter | YES | YES (`/webp-to-jpg`) | YES | PASS | JPG → WebP: YES | P0 |
| WebP → PNG | Image Converter | YES | YES (`/webp-to-png`) | YES | PASS | PNG → WebP: YES | P0 |
| SVG → PNG | Image Converter | YES | YES (`/svg-to-png`, smart upload for .svg) | YES | PASS (scripts stripped) | PNG → SVG: NO | P0 |
| SVG → JPG / WebP | Image Converter | YES | YES | YES | PASS | — | P0 (bonus) |
| PNG/JPG → SVG (vectorise) | — | NO | — | — | — | — | LATER (tracing isn't faithful) |
| HEIC → JPG / PNG | — | NO | — | — | — | — | P1 |
| GIF / BMP / TIFF → JPG / PNG | — | NO | — | — | — | — | P1 |
| Resize / crop image | — | NO (Compress Image reduces dimensions only to hit a size) | — | — | — | — | P1 |

## Compression

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| PDF → under 500 KB / 1 MB / 2 MB / custom | Compress PDF | YES | YES | YES | PASS | n/a | P0 |
| JPG / PNG / WebP → under 100 KB / 500 KB / custom | Compress Image | YES | YES | YES | PASS | n/a | P0 |
| Word / PowerPoint compression | — | NO | — | — | — | — | P1 |

## Conversion to PDF

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| JPG → PDF | Image to PDF `/image-to-pdf` | YES | YES (`/jpg-to-pdf`) | YES | PASS | PDF → JPG: YES | P0 |
| PNG → PDF | Image to PDF | YES | YES (`/png-to-pdf`) | YES | PASS | PDF → PNG: YES | P0 |
| WebP → PDF | Image to PDF | YES | YES | YES | PASS | PDF → WebP: NO (JPG/PNG cover it) | P0 |
| Several images → one PDF (ordered) | Image to PDF | YES | YES (smart upload offers “Combine N into a PDF”) | YES | PASS | PDF → images (ZIP): YES | P0 |
| Word → PDF | Word to PDF | YES (new) | YES | YES | PASS | PDF → Word: YES | P0 |

## Edit

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| Edit native PDF text | PDF Editor `/pdf-editor` | YES | YES (own nav link, `/edit-pdf`) | YES | PASS | n/a | P0 |
| Edit scanned PDF text (OCR) | PDF Editor | YES | YES | YES | PASS | n/a | P0 |
| Highlight, draw, shapes, whiteout, images, visual signature | PDF Editor | YES | YES | YES | PASS | n/a | P0 |
| After export: continue to Compress / Merge / PDF to Word | PDF Editor | YES **(added in this pass)** | YES | YES (journey D, e2e) | PASS | n/a | P0 |
| Add page numbers / watermark | — | NO | — | — | — | — | P1 |
| Password-protect / unlock PDF | — | NO | — | — | — | — | P1 |
| Redact (true removal) | — | NO (whiteout is stated as not secure) | — | — | — | — | P1 |

## Organize

| Source → Target / action | Tool (route) | Implemented | Discoverable | Tested | Quality status | Reverse flow | Priority |
|---|---|---|---|---|---|---|---|
| Several PDFs → one (ordered) | Merge PDF `/merge-pdf` | YES | YES | YES | PASS | Split: YES | P0 |
| PDF → chosen pages / one PDF per page | Split PDF `/split-pdf` | YES | YES | YES | PASS | Merge: YES | P0 |
| Reorder pages | Organize PDF `/organize-pdf` | YES | YES | YES | PASS | n/a | P0 |
| Rotate pages | Organize PDF | YES | YES (`/rotate-pdf`) | YES | PASS | n/a | P0 |
| Delete pages | Organize PDF | YES | YES (`/delete-pdf-pages`) | YES | PASS | n/a | P0 |
| Duplicate pages | Organize PDF | YES | YES | YES | PASS | n/a | P0 (bonus) |

## Asymmetry check (every exposed A → B)

| Pair | A → B | B → A | Verdict |
|---|---|---|---|
| PDF ↔ Word | YES | YES (new) | complete — the gap that started this pass |
| PDF ↔ Image (JPG/PNG) | YES | YES | complete |
| JPG ↔ PNG | YES | YES | complete |
| JPG ↔ WebP | YES | YES | complete |
| PNG ↔ WebP | YES | YES | complete |
| SVG → raster | YES | NO | intended (vectorising isn't reliable) — LATER |
| Merge ↔ Split | YES | YES | complete |
| PDF ↔ Excel / PowerPoint | NO | NO | neither exposed — P1 as a pair |

## Discoverability check (every tool)

| Tool | Nav menu | Phone menu | All tools | Sitemap | Smart upload | Related / continue from |
|---|---|---|---|---|---|---|
| Compress PDF | Compress | ✓ | Compress | ✓ | PDF (first) | Word to PDF, Image to PDF, Merge, Split, Organize, Editor |
| Compress Image | Compress | ✓ | Compress | ✓ | image (first) | Image Converter, PDF to Image |
| PDF to Word | Convert | ✓ | Convert | ✓ | PDF | Editor (after export), Word to PDF page |
| Word to PDF | Convert | ✓ | Convert | ✓ | .docx (only action) | PDF to Word page and result |
| PDF to Image | Convert | ✓ | Convert | ✓ | PDF | — |
| Image to PDF | Convert | ✓ | Convert | ✓ | image(s) | Compress Image, Image Converter, PDF to Image |
| Image Converter | Convert | ✓ | Convert | ✓ | image(s), SVG | Compress Image |
| Merge PDF | PDF Tools | ✓ | Organize | ✓ | PDF / several PDFs | Compress, Split, Organize, Image to PDF, Word to PDF, Editor |
| Split PDF | PDF Tools | ✓ | Organize | ✓ | PDF | Compress |
| Organize PDF | PDF Tools | ✓ | Organize | ✓ | PDF | Merge |
| PDF Editor | own link + PDF Tools | ✓ | Edit | ✓ | PDF | Compress, Organize, Split, Merge, Image to PDF, Word to PDF |

No tool is reachable only by a hidden URL.
