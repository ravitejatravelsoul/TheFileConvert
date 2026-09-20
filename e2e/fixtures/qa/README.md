# QA fixtures

Generated deterministically by `node scripts/qa-fixtures.mjs` (seeded PRNG; no real user data).
Files over ~1 MB are git-ignored and regenerated on demand.

| File | Purpose |
| --- | --- |
| `img-photo-large.jpg` | 4000x3000 noisy photo-like JPEG at q95 (several MB) — compression target |
| `img-photo-highres.png` | 3000x2000 photographic PNG (large, lossless) |
| `img-photo-noisy.jpg` | heavy-noise photo JPEG (hard to compress) |
| `img-photo-small-optimized.jpg` | small, already q60 JPEG (little headroom) |
| `img-photo-transparent.png` | PNG photo with an elliptical alpha cut-out (transparency test) |
| `img-photo-opaque.png` | opaque PNG photo |
| `img-logo-flat.png` | flat opaque logo graphic PNG |
| `img-logo-transparent.png` | flat logo with transparent background PNG |
| `img-photo.webp` | WebP photo (opaque) |
| `img-transparent.webp` | WebP photo with alpha |
| `img-landscape.jpg` | 1600x900 landscape JPEG |
| `img-portrait.jpg` | 900x1600 portrait JPEG |
| `img-quadrants.png` | 400x300: TL red, TR green, BL blue, BR yellow — exact pixel checks for rotate/flip/crop/resize |
| `img-with-exif.jpg` | 800x600 JPEG carrying EXIF strings QAcam Make / QAcam Model-9000 / QASoftware 1.2 |
| `img-vector.svg` | 480x320 SVG with shapes, text, transparency |
| `img-malicious.svg` | SVG with <script>, onload and an external image reference (must be neutralised) |
| `pdf-text-heavy.pdf` | 20 pages of real text, no images |
| `pdf-multipage.pdf` | 6 pages labelled 'Page N of 6' — page-order/extract/delete/split checks |
| `pdf-rotations.pdf` | 4 pages with /Rotate 0,90,180,270 |
| `pdf-metadata.pdf` | 2 pages, known metadata: Title/Author/Subject/Keywords/Creator/Producer = QA … |
| `pdf-watermarked.pdf` | 2 pages with a pre-applied diagonal CONFIDENTIAL watermark |
| `pdf-optimized.pdf` | 3 text pages already saved with object streams (nothing left to squeeze) |
| `pdf-scanned.pdf` | 4 full-page JPEG scans (image-only pages, no text layer) |
| `pdf-mixed.pdf` | 3 text pages each with a 1800x1200 embedded photo |
| `pdf-bloated.pdf` | 6 pages, each embedding an oversized q97 3200x2400 JPEG shown at ~552pt wide (heavily over-resolved) |
| `pdf-dup-images.pdf` | 4 pages each embedding the SAME 900x700 q92 JPEG as separate objects (duplicate-image merge, lossy recompression) |
| `pdf-scanned-small.pdf` | 2 image-only scanned pages (JPEG) — image-heavy compression case |
| `pdf-corrupted.pdf` | truncated PDF (negative test) |
| `pdf-not-a-pdf.pdf` | text file renamed .pdf (negative test) |
| `pdf-form.pdf` | AcroForm: text field full_name, checkbox agree, dropdown plan |
| `doc-realistic.txt` | multi-paragraph TXT with unicode, angle brackets, ampersands, quotes, a 300-char line |
| `doc-realistic.md` | Markdown: H1-H3, bold/italic/code/link, nested+ordered lists, fenced code, blockquote, table, raw <script> |
| `data-nested.json` | minified nested JSON with unicode, null, empty containers |
| `data-malformed.json` | invalid JSON |
| `data-large.json` | 3000-record JSON array (~350 KB) |
| `data-realistic.csv` | CSV with quoted commas, doubled quotes, multiline cell, empty cells, unicode, negative number |
| `data-flat-records.json` | flat JSON records with missing fields, commas, quotes, newline |
| `data-realistic.xml` | XML with attributes, entities, CDATA, empty element, unicode |
| `data-malformed.xml` | mismatched-tag XML |
| `data-sample.b64` | Base64 of a multiline unicode string |
| `data-urlencoded.txt` | URL-encoded sample (unicode, reserved characters) |
| `zip-realistic.zip` | nested folders, spaces, unicode names, binary file (seeded bytes), an empty dir |
| `zip-malformed.zip` | corrupt ZIP (negative test) |
| `zip-traversal.zip` | entries named ../../evil.txt and /abs/evil2.txt (path-traversal check) |
