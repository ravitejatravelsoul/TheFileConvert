# Fidelity audit — layout, formatting and visual faithfulness

Branch `rebuild/fresh-launch` · baseline `f5a76769` · nothing deployed, main untouched.

Text preservation alone is not the bar. Every conversion and every PDF/image tool was run through the real
browser UI, its output reopened independently, and compared with its source for **text, layout,
formatting, tables, images** (PDF ↔ Word) or **pixels** (every other tool). Each aspect is graded on its own;
they are not collapsed into a single PASS.

## Verdict

**READY FOR FINAL USER REVIEW** (final closure, after commit `c277426`). PDF → Word, Word → PDF, round
trips, compression, the converters, page tools, the editor and OCR meet the fidelity contract for supported
cases; the remaining differences are documented as LIMITED with their cause. Exported OCR scans are now
searchable. **Correction:** an earlier version said Microsoft Word was unavailable. Word is installed, but
as an unlicensed product whose COM automation hangs, so no automated Word render exists; the reference
throughout is LibreOffice 26.2.6, Word fidelity has to be confirmed by opening the DOCX in Word, and where Word
and LibreOffice may disagree this report says so instead of claiming certainty.

Everything below was measured on the local **production build** (`next build && next start`, Next.js 16.3.8)
of the final code, desktop and Pixel 7 touch emulation. "Before" is the same harness run against the baseline
build `f5a76769`.

| Area | Scenarios | Before (P / L / F) | After (P / L / F) |
|---|---:|---|---|
| PDF → Word (12 realistic + 13 fixtures) | 25 | 4 / 3 / 18 | **22 / 3 / 0** |
| PDF → Word — mobile | 25 | — | **22 / 3 / 0** |
| Word → PDF (12 realistic) | 12 | 4 / 1 / 7 | **11 / 1 / 0** |
| Word → PDF — mobile | 12 | — | **11 / 1 / 0** |
| Round trips (5 documents × 2 directions) | 10 | 0 / 0 / 10 | **7 / 3 / 0** |
| Compress PDF | 9 | 9 / 0 / 0 | **9 / 0 / 0** |
| Compress Image | 8 | 1 / 6 / 1 | **1 / 7 / 0** |
| Image conversions | 11 | 10 / 1 / 0 | **10 / 1 / 0** |
| PDF → Image | 5 | 5 / 0 / 0 | **5 / 0 / 0** |
| Images → PDF | 5 | 4 / 1 / 0 | **4 / 1 / 0** |
| Merge / Split / Organize | 8 | 8 / 0 / 0 | **8 / 0 / 0** |
| PDF Editor (one operation per export) | 10 | 10 / 0 / 0 | **10 / 0 / 0** |
| OCR (recognition) | 4 | 4 / 0 / 0 | **4 / 0 / 0** |
| OCR searchable export (new) | 6 | — (not searchable) | **6 / 0 / 0** |
| **All fidelity scenarios** | **150** | | **130 / 20 / 0** |

### PDF → Word — per document

| Document | Text | Layout | Formatting | Tables | Images | Overall | Recall % | Median shift (pt) | Within 12 pt % | Lines kept % |
|---|---|---|---|---|---|---|---:|---:|---:|---:|
| resume | PASS | PASS | PASS | PASS | n/a | **PASS** | 100 | 0.3 | 99.4 | 100 |
| invoice | PASS | PASS | PASS | PASS | PASS | **PASS** | 100 | 2.7 | 92.5 | 100 |
| letter | PASS | LIMITED | PASS | n/a | PASS | **LIMITED** | 100 | 5.1 | 56.2 | 97.5 |
| bank-statement (3 → 2 pp) | PASS | PASS | PASS | PASS | n/a | **PASS** | 100 | 1.0 | 100 | 100 |
| application-form | PASS | PASS | PASS | LIMITED | n/a | **LIMITED** | 100 | 0.6 | 84.9 | 100 |
| transcript | PASS | PASS | PASS | PASS | n/a | **PASS** | 99.2 | 1.0 | 100 | 100 |
| brochure (2 columns) | PASS | PASS | PASS | PASS | PASS | **PASS** | 100 | 0.3 | 100 | 100 |
| report-two-column | PASS | PASS | PASS | n/a | PASS | **PASS** | 100 | 0.5 | 84.0 | 98.1 |
| table-report | PASS | PASS | PASS | PASS | n/a | **PASS** | 100 | 3.4 | 100 | 100 |
| image-heavy | PASS | PASS | PASS | LIMITED | PASS | **LIMITED** | 100 | 0.4 | 87.0 | 100 |
| formatting sampler | PASS | PASS | PASS | n/a | n/a | **PASS** | 100 | 0.4 | 96.5 | 100 |
| long-report (11 pp) | PASS | PASS | PASS | n/a | n/a | **PASS** | 100 | 0.2 | 99.3 | 99.9 |
| PDF-WORD-01…13 (incl. 24 pages, rotated, two columns, special characters, mixed) | PASS | PASS | PASS | n/a | PASS | **PASS ×13** | 100 | 0.8–8.8 | 63.5–100 | 98.8–100 |
| PDF-WORD-09 scanned | PASS (OCR vs ground truth) | n/a | n/a | n/a | n/a | **PASS** | — | — | — | — |

(The bank statement's source PDF has 2 pages after the fixture fix; the DOCX keeps 2.)

LIMITED, with the reason:
- **letter** — justified paragraphs: LibreOffice's Word-2013 compatibility mode shrinks spaces in justified lines,
  so lines re-wrap there; positions stay within 36 pt for 73 %. We did not imitate this renderer quirk.
- **application-form** — section bars drawn as shaded bands come back as shaded paragraphs, not 1-row tables.
- **image-heavy** — a borderless table used only to put two pictures side by side comes back as two positioned
  pictures (identical place, IoU ≥ 0.87), not as a table.

### Word → PDF — per document

| Document | Text | Layout | Formatting | Tables | Images | Overall | Median shift (pt) | Within 12 pt % |
|---|---|---|---|---|---|---|---:|---:|
| resume, invoice, letter, bank-statement, application-form, transcript, formatting, long-report, table-report, image-heavy | PASS | PASS | PASS | PASS / n/a | PASS / n/a | **PASS ×10** | 0.6–2.8 | 100 |
| report-two-column (Georgia) | PASS | PASS | PASS | n/a | PASS | **PASS** (was FAIL) | 2.4 | 100 |
| brochure (2 columns, Calibri) | PASS | PASS | PASS | LIMITED | PASS | **LIMITED** (was FAIL) | 2.9 | 100 |

Text is 100 % on every document; every page count matches.

**Georgia two-column report** (`qa/validate/colmeasure.py`, column region only):

| | Before (Liberation Serif) | After (Gelasio + Georgia's line metrics) | Reference |
|---|---|---|---|
| Lines that break where the reference breaks — column 1 / column 2 | 21 / 36 · 7 / 16 | **36 / 36 · 16 / 16** | — |
| Line count — column 1 / column 2 | 36 / 16 | 36 / 16 | 36 / 16 |
| Column x-range (pt) | 57.6–300.9 · 294.9–554.4 | 57.6–300.9 · 294.9–554.4 | 57.7–300.8 · 294.8–554.3 |
| Column start (pt from top) | 109.6 | 109.2 | 108.4 |
| Pages | 1 | 1 | 1 |
| Median word shift / overall | 36 pt / FAIL | 2.4 pt / PASS | — |

Root cause of the old re-wrap: font metrics only (Liberation Serif is 0.914 of Georgia's width); column
widths, margins, indents and spacing already matched. Gelasio has Georgia's exact advance widths (measured,
all four styles), so lines break identically; the remaining ~2 pt is glyph shape/vertical placement.

**Brochure:** column 2 now starts 0.4 pt from the reference (was ~10 pt — our continuous-section spacing,
fixed: W2P-09) and all 29/29 + 2/2 lines break as in the reference (a kerning measurement bug made one line
overflow its column — fixed: W2P-08). LIMITED: LibreOffice draws the last table row of column 1 at 13.3 pt while
its identical rows in column 2 are 20.4 pt, as ours are; nothing in the document shortens that row. Renderer
behaviour; no automated Microsoft Word render (see the correction above).

### Round trips

| Document | PDF → Word → PDF | Word → PDF → Word |
|---|---|---|
| resume | PASS (0.3 pt) | PASS (1.0 pt) |
| invoice | PASS | PASS |
| letter | LIMITED (justification re-wrap, signature picture shifted) | LIMITED |
| table-report | PASS | PASS |
| image-heavy | PASS | LIMITED (picture table → positioned pictures) |

Text survives 100 % in every round trip.

### Other tools (visual)

- **Compress PDF** — 9/9 PASS, including the user's own scan (3.98 MB → 928 KB, SSIM 0.997): pages, sizes and
  text identical, min SSIM 0.967 (photo pages), 1.0 on text-only pages.
- **Compress Image** — every result is visually PASS (PSNR 31–41 dB at the output size); 7 are LIMITED because
  the requested size could only be reached by shrinking the picture, which the result states ("resized to 59 %").
- **Image conversions** — lossless outputs identical (SSIM 1.0), lossy ≥ 0.96, transparency kept (alpha Δ 0);
  LIMITED: a 1001×777 PNG → JPG at SSIM 0.946 (JPEG quality on a sharp synthetic chart).
- **PDF → Image** — every page matches MuPDF's own render (SSIM 0.969–0.996), aspect and rotation kept.
- **Images → PDF** — the stored picture is the original file byte-for-byte (or SSIM 1.0 with the PNG's alpha as a
  soft mask); LIMITED: a WebP re-encoded for the PDF (SSIM 0.964).
- **Merge / Split / Organize** — every output page pixel-identical to its source page (SSIM 1.0, 0 % changed),
  rotations and sizes kept, including rotate + reorder + delete in one save.
- **PDF Editor** — add text, highlight, underline, strikethrough, draw, rectangle, arrow, whiteout, edit
  existing text, export without edits: **0.000 % of pixels changed outside the edited area** in every case.
- **OCR** — 100 % of the ground-truth words recognised on clean, low-resolution, rotated and multi-page scans;
  the exported PDF looks identical to the input (SSIM 1.0).
- **Searchable OCR export (new)** — clean, low-resolution, rotated (/Rotate 90), mixed native + scanned,
  3-page and the user's own 2-page scan: 100 % of the recognised words are searchable in the exported PDF, no
  word appears twice (the mixed page's own text isn't duplicated), a corrected word is found once in its new
  form and the old form is gone, 0.000 % of pixels changed outside the correction, page counts kept.
  the exported PDF looks identical to the input (SSIM 1.0).

Visual diffs: `qa/fidelity/pdf-to-word/`, `word-to-pdf/`, `round-trip/` (source | output | overlay, red =
source only, blue = output only), and `compress-pdf/`, `compress-image/`, `converters/`,
`merge-split-organize/`, `pdf-editor/`, `ocr/` (source | output | changed pixels). Files tagged `before` show
the baseline build, `final` the current one. Renders of the user's scan stay in git-ignored `_private/`.

## Scanned PDF → Word (after commit 69c8a27)

Every scanned page is now analysed from its pixels (rules, boxes, grids, bands, tints, bold) before OCR and
rebuilt as Word structure (tables with borders, paragraph/cell borders, shading, page border), with pictures
for what can't be read (stamps, signatures, unreadable regions) and a visual fallback for unreadable pages —
see `qa/CODE_REVIEW.md` "Scanned PDF → Word reconstruction". Graded by `qa/validate/scanform.py` through the
real UI (`qa/scripts/fid-scans.mjs`, production build), LibreOffice render at 110 dpi:

| Fixture | Text recall | Words in place | Rules kept | Typography | Garbage words | Verdict |
|---|---:|---:|---:|---:|---:|---|
| SCAN-WORD-01 form (section bands, fill-in lines, check boxes) | 90.4 % | 60.7 % | 0 % | 35 % | 29 | FAIL |
| SCAN-WORD-02 invoice (banded item table, side-by-side blocks) | 95.0 % | 37.2 % | n/a | 59 % | 49 | FAIL |
| SCAN-WORD-03 transcript (grey grids, tinted headers) | 93.8 % | 93.5 % | n/a¹ | 98 % | 0 | LIMITED |
| SCAN-WORD-04 table-heavy (blue band, tinted total row) | 98.1 % | 91.6 % | 100 % | 92 % | 0 | LIMITED |
| SCAN-WORD-05 two-column (Georgia, chart) | 99.7 % | 89.9 % | 0 %² | 40 % | 21 | FAIL |
| SCAN-WORD-06 letter + stamp + signature | 97.4 % | 98.5 % | 100 % | 81 % | 0 | LIMITED |
| SCAN-WORD-07 mixed rules (boxes, double rule, panel, grid) | 100 % | 96.2 % | 94.7 % | 100 % | 0 | PASS |
| SCAN-WORD-08 the user's scan (2 pages) | — | 100 % | 99.8 % | 100 % | 0 | PASS (17/17 structure checks) |

¹ the transcript's grid is lighter than the measurement's ink threshold — rebuilt as 4 bordered tables, not
measured. ² the only rule is the chart's axis, kept inside the chart picture.

The user's scan at 69c8a27 (same harness): words in place 80.6 %, 14 garbage words, rules 0 %, typography
80 %, one 2 × 3 table, 6 structure checks failed → FAIL. Desktop and mobile (Pixel 7) both PASS now; 0 uploads.

At 519ce0d, the known causes of the remaining FAIL/LIMITED (fixed since — see below): side-by-side text blocks on slightly different baselines are
stacked (invoice header); fill-in lines after a label and check boxes on forms are not rebuilt as leader tabs /
symbols; bold Georgia headings are measured as regular and set ~19 % too large (two-column); the stamp's
picture is placed in the flow rather than floating.

### Generalisation pass (after commit 519ce0d) — current results

The three classes that failed above (form, invoice, two-column) were fixed generically and checked on ten
new variants drawn for this pass (`qa/scripts/scan-variants.py`, SCAN-WORD-10 … 19). Each fixture has its own
structure checks (`qa/fidelity/scan-word/expect/`). Each dimension is graded separately, and any FAIL fails
the fixture. Production build, real `/pdf-to-word`, LibreOffice render (`qa/evidence/fresh/fid-scans.json`):

| Fixture | Text recall | Words in place | Typography | Garbage | Dimensions failing | Verdict |
|---|---:|---:|---:|---:|---|---|
| 01 form | 100 % | 95.3 % | 98.8 % | 0 | — | PASS |
| 02 invoice | 99.4 % | 98.1 % | 99.4 % | 0 | — | PASS |
| 03 transcript | 96.9 % | 94.5 % | 97.5 % | 3 | TEXT, LAYOUT limited | LIMITED |
| 04 table-heavy | 100 % | 96.3 % | 99.0 % | 0 | — | PASS |
| 05 two-column | 100 % | 99.2 % | 95.2 % | 0 | — | PASS |
| 06 letter + stamp + signature | 98.2 % | 99.6 % | 94.0 % | 0 | — | PASS |
| 07 mixed rules | 100 % | 100 % | 98.1 % | 0 | — | PASS |
| 10 form, simple fill-ins | 100 % | 100 % | 100 % | 0 | — | PASS |
| 11 form, check boxes | 100 % | 100 % | 100 % | 0 | — | PASS |
| 12 form, fill-ins + table + box | 100 % | 100 % | 95.7 % | 0 | — | PASS |
| 13 invoice, simple | 100 % | 100 % | 100 % | 0 | — | PASS |
| 14 invoice, metadata both sides | 98.1 % | 100 % | 100 % | 0 | — | PASS |
| 15 invoice, dense banded table | 100 % | 95.9 % | 98.9 % | 0 | — | PASS |
| 16 two-column text | 100 % | 97.0 % | 92.8 % | 0 | — | PASS |
| 17 two-column + chart | 100 % | 97.0 % | 92.3 % | 0 | — | PASS |
| 18 headings in one column | 100 % | 95.5 % | 94.5 % | 0 | — | PASS |
| 19 heading + rule across columns | 100 % | 96.5 % | 93.7 % | 0 | — | PASS |
| 08 the user's scan (2 pages) | — | 100 % | 97.0 % | 0 | — (17/17 structure checks) | PASS |

**17 PASS · 1 LIMITED · 0 FAIL.** The user's scan also passes on mobile (Pixel 7): 17/17, 2 pages, 0 uploads.
The transcript stays LIMITED: bold term headings that contain digits ("Autumn 2024") come out regular and 2–3 pt
large, and three "I"s sit a few points right. The document is complete and its tables are intact.

Microsoft Word: **manual review required** (installed but unlicensed; automation hangs). The DOCX files and a
checklist are in `qa/manual-word-review/`. Side-by-side images (original / LibreOffice render / diff) are in
`qa/fidelity/final-scan-review/`. The user's scan has its own local, git-ignored subfolder there.

Performance on the production build (`fid-scanperf.json`): 2-page scan 6.6 s, 5 pages 32.5 s, 10 pages 51.4 s.
The longest main-thread task was 0.6 s, and progress updates every page.

## Defects

33 product defects found and fixed during the audit (P2W-01…20, W2P-01…09, IMG-01, SEC-01, FONT-01, OCR-01). Each has a
code-review entry in `qa/CODE_REVIEW.md` (root cause, files, risk, tests, validation).

## Unresolved

None of the three items left open after `c277426`:
1. Georgia (and Verdana) re-wrap — fixed with measured, licence-clean stand-ins (FONT-01).
2. Brochure column start — fixed (W2P-09, W2P-08); one LibreOffice-specific row height documented (LIMITED).
3. OCR export not searchable — fixed (OCR-01).

## Known limitations (LIMITED, honest)

Cambria (Caladea, 0.95–0.99 of Cambria's widths), Tahoma (Liberation Sans) and other fonts without an
exact open match may re-wrap slightly — the user is told; justified text re-wrap in LibreOffice (letter); shaded section bars as paragraphs (application form); a
picture-layout table as positioned pictures (image-heavy); Compress Image shrinks noisy photos to reach small
targets (stated in the result); PDF → Word cannot rebuild text effects (shadow, outline) or rotated text inside a
page; the brochure's last column-1 table row (LibreOffice-specific, above).

## Also verified

- **Integrity / content:** 309 scenario-suite scenarios, 251 outputs downloaded and reopened by four PDF engines
  or the OOXML/image validators, 0 corrupt (`qa/FULL_SCENARIO_ACCEPTANCE.md`).
- **Real-user journeys:** 24/24 (each step handed to the next through the product's own "Continue with").
- **Mobile:** fidelity suites above on Pixel 7, plus the mobile scenario suite 8/8.
- **Privacy:** 5/5 — no upload, no third-party request, nothing stored; every fidelity scenario also failed on
  any request carrying file bytes (none did).

---

## How it was measured

### PDF ↔ Word — `qa/scripts/fid-run.mjs` + `qa/validate/layoutdiff.py`

- **Driver:** real Chromium (Playwright), the product's own upload control and Download button, desktop and
  Pixel 7 (touch) — every download passes the shared integrity gate (qpdf, MuPDF, pdf-lib, pdf.js / OOXML +
  python-docx) before a verdict is recorded. Any network request carrying file bytes fails the scenario.
- **Independent renderer:** LibreOffice 26.2.6, a portable copy unpacked from the official MSI for QA only
  (`qa/validate/lo.py`; SHA-256 checked; never part of the product, never installed system-wide). It renders
  our .docx to PDF (PDF → Word) and renders the source .docx as the reference (Word → PDF).
- **Comparison:** MuPDF words of source and output are aligned in reading order (difflib), leftovers paired
  with the nearest same word on the same page (then any page). Per scenario:
  - *Text:* recall (share of source words present), reading order.
  - *Layout:* page count, same page, median / P90 displacement (pt), share within 12 pt and 36 pt, line
    breaks kept (words sharing a line in the source still share one).
  - *Formatting:* font size kept (±8 %), bold/italic kept, false bold, colour kept.
  - *Tables:* share of the source's ruled-line length drawn at the same place (±3 pt), plus cell text position.
  - *Images:* count and best-overlap IoU of picture boxes.
  - Page SSIM and a red/blue overlay per page (`qa/fidelity/pdf-to-word/`, `word-to-pdf/`, `round-trip/`).
- **Scanned input:** no source text exists, so text is graded as OCR accuracy against ground truth
  (`qa/fresh-scenario-fixtures/word/truth.json`); layout is n/a.

| Grade | Text | Layout | Formatting | Tables | Images |
|---|---|---|---|---|---|
| **PDF → Word** PASS | recall ≥ 98 % | pages equal, same page ≥ 95 %, within 36 pt ≥ 85 %, lines kept ≥ 80 % | size ≥ 90 %, bold/italic ≥ 90 %, colour ≥ 90 % | rule length ≥ 90 % at place | count equal, IoU ≥ 0.6 |
| PDF → Word LIMITED | ≥ 90 % | ≥ 85 / 60 / 60 % | ≥ 70 % | ≥ 70 %, or fewer tables while layout passes | IoU ≥ 0.3 |
| **Word → PDF** PASS | recall ≥ 99 % | pages equal, same page ≥ 97 %, within 12 pt ≥ 85 %, lines kept ≥ 90 % | ≥ 97 % | rule length ≥ 90 %, cell text within 12 pt ≥ 80 % | IoU ≥ 0.75 |
| Word → PDF LIMITED | ≥ 95 % | ≥ 85 / 60 / 75 % | ≥ 85 % | ≥ 70 % / 55 % | IoU ≥ 0.4 |

Word → PDF is held to tighter limits than PDF → Word: it renders a document whose layout rules are fully
known, while PDF → Word has to *infer* structure from drawn glyphs.

### Every other tool — `qa/scripts/fid-tools.mjs` + `qa/validate/visdiff.py`

Pages are rendered by MuPDF (100 dpi, grey) and compared with the source: SSIM over 8×8 blocks, PSNR, share
of visibly changed pixels (|Δ| > 24/255), page sizes, rotation, the words on each page. Source | output |
difference images (red = changed) are written for review.

| Tool | What is compared | PASS | LIMITED |
|---|---|---|---|
| Compress PDF | every page vs. source; text kept | text/vector pages SSIM ≥ 0.97, photo/scan pages ≥ 0.90; 100 % words; sizes equal | SSIM ≥ 0.90 / 0.80; target missed but honest |
| Compress Image | output vs. source at the output's size | PSNR ≥ 30 dB, alpha kept, same size | PSNR ≥ 27 dB, or resized to meet the target (always stated in the UI) |
| Image conversions | output vs. source | lossless (PNG) SSIM ≥ 0.995, lossy (JPG/WebP) ≥ 0.95; size equal; alpha kept (JPG: flattened on white by design) | 0.98 / 0.90 |
| PDF → Image | each image vs. MuPDF's render at the same resolution | SSIM ≥ 0.93, aspect equal | ≥ 0.85 |
| Images → PDF | the picture stored in the PDF vs. the source (decoded pixels), and its placement | SSIM ≥ 0.98, aspect equal, inside the page, transparency kept as a soft mask | ≥ 0.95 |
| Merge / Split / Organize | each output page vs. the source page it should be (order, rotation) | identical: SSIM ≥ 0.999, ≤ 0.05 % pixels changed, 100 % words, sizes equal | ≤ 0.5 % changed |
| PDF Editor | page vs. source **outside the edited area** (one operation per export) | ≤ 0.05 % pixels changed outside, the edit visible inside, other pages identical | ≤ 0.5 % |
| OCR | exported scan vs. input; recognised words vs. ground truth | identical look; ≥ 95 % of words recognised | ≥ 85 % |

Why PSNR for Compress Image: the test photos carry heavy sensor-like noise so that they compress like real
photos; at a 2–8× size cut no codec keeps that grain, and 8×8-block SSIM punishes its loss far more than a
viewer sees (a PIL experiment confirmed no full-size quality setting reaches these targets — shrinking is
required). Both numbers are reported.

### Corpus

**Twelve realistic documents** (`qa/scripts/fid-corpus.py`, written with python-docx — an independent
writer — and rendered to PDF by LibreOffice): resume, invoice, business letter, bank statement (3 pages,
repeated table header), application form, university transcript, brochure (2 columns), two-column research
report, table-heavy report, image-heavy document, formatting sampler, 11-page long report. Fixtures were
made unambiguous during the audit (python-docx writes conflicting cell/grid widths and an extra empty
section-break paragraph that renderers treat differently; Word itself writes neither).

**Thirteen PDF fixtures** from the earlier suite (`PDF-WORD-01…13`: simple text, multipage, headings,
bold/italic, lists, table, images, two columns, scanned, mixed native+scan, rotated, special characters,
24 pages), plus every fixture of the earlier scenario suites for the other tools, plus the user's own scan
(`TheFileConvert_Scanned_OCR_Test.pdf`, read in place; its renders stay in git-ignored `_private` folders).

| Feature (brief A–T) | Covered by |
|---|---|
| A paragraphs · M margins | every document (margins 0.6″–1.0″) |
| B headings H1–H3 | formatting, long-report, PDF-WORD-03 |
| C bold / italic / underline · D sizes · E alignment | formatting (left/centre/right/justified), PDF-WORD-04 |
| F lists, nested | formatting (bullets, nested bullets, numbers), resume, PDF-WORD-05 |
| G tables, merged cells | table-report (horizontal + vertical merges), invoice, bank-statement, transcript, application-form, PDF-WORD-06 |
| H images + captions | image-heavy, report-two-column, brochure, PDF-WORD-07 |
| I two columns | report-two-column, brochure, PDF-WORD-08 |
| J header/footer · K page numbers | bank-statement ("Page X of Y"), formatting, long-report |
| L page breaks | formatting, long-report |
| N special characters · O mixed fonts | formatting (Arial, Times, Courier, Georgia; € £ ₹ ✓ Ελληνικά Русский), PDF-WORD-12 |
| P scanned · Q mixed | PDF-WORD-09, PDF-WORD-10, the user's scan (OCR suites) |
| R resume · S invoice · T letter | resume, invoice, letter |
| Round trips | resume, invoice, letter, table-report, image-heavy — PDF → Word → PDF and Word → PDF → Word |

### Reproduce

```
python qa/scripts/fid-corpus.py && python qa/validate/lo.py pdf qa/fidelity/corpus qa/fidelity/corpus/*.docx
LIBREOFFICE=…/soffice.exe BASE=http://localhost:3000 node qa/scripts/fid-run.mjs all  --tag=final
LIBREOFFICE=…/soffice.exe BASE=http://localhost:3000 node qa/scripts/fid-run.mjs p2w mobile --tag=final
LIBREOFFICE=…/soffice.exe BASE=http://localhost:3000 node qa/scripts/fid-run.mjs w2p mobile --tag=final
BASE=http://localhost:3000 node qa/scripts/fid-tools.mjs all --tag=final
python qa/scripts/fid-summary.py qa/evidence/fresh/fid-all-final.json
```
