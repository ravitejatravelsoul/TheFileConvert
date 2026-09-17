# OCR

`/pdf/ocr` — **OCR PDF** — makes scanned/image-only PDFs searchable and extracts their
text, entirely in the browser. Status: **experimental** (see `/tools/status`).

## Engine and license

| Component | Package | Version | License |
| --- | --- | --- | --- |
| OCR engine (JS API + worker) | `tesseract.js` | 7.0.0 | Apache-2.0 |
| OCR engine (WASM core) | `tesseract.js-core` | 7.0.0 | Apache-2.0 |
| In-browser model cache | `idb-keyval` (dependency of tesseract.js) | 6.x | Apache-2.0 |
| Trained language data | `tesseract-ocr/tessdata` (via `@tesseract.js-data`) | `4.0.0_best_int` | Apache-2.0 |

Everything in the OCR stack is Apache-2.0. No AGPL, no copyleft, no paid API, no
per-request cost. Scribe.js (AGPL) was considered per the brief and explicitly **not**
used — Tesseract.js's license and browser-local WASM architecture were a strictly better
fit and made a deeper licensing review unnecessary.

## Why Tesseract.js

- Runs OCR as WebAssembly inside a Web Worker — never blocks the main thread, never
  leaves the browser.
- Mature, widely used, permissively licensed, no server component required.
- Ships a "LSTM-only" engine mode (`OEM.LSTM_ONLY`) that's smaller and faster than the
  legacy engine while still accurate for printed text, which is what this tool targets.

## Self-hosting (privacy + reliability)

By default Tesseract.js fetches its WASM core, worker script, and language data from
jsDelivr's CDN. This project self-hosts all three under `/public/tesseract/` instead:

```
public/tesseract/
  worker.min.js                    # Tesseract.js worker script
  tesseract-core-lstm.wasm.js      # WASM engine (LSTM-only, non-SIMD — universally compatible)
  lang-data/
    eng.traineddata.gz             # English (~2.9 MB)
    spa.traineddata.gz             # Spanish (~2.1 MB)
    fra.traineddata.gz             # French (~0.7 MB)
```

This means the only network requests OCR ever makes are to `thefileconvert.com` itself —
never a third party — and they never carry the document, the rendered page image, or any
recognized text. See `e2e/ocr.spec.ts`'s "network privacy" test, which captures every
request during a real OCR run and asserts this.

These are static assets with no server compute behind them, so self-hosting costs nothing
beyond ordinary static bandwidth, and the browser's own HTTP cache (plus Tesseract.js's
built-in IndexedDB cache for language data, via `idb-keyval`) means a given browser only
downloads them once.

**Not self-hosted:** nothing. Everything OCR needs ships from this origin.

## Verified languages

Only languages that have been tested end-to-end with real fixtures (see
`e2e/fixtures/ocr/`) are exposed in the language picker:

| Language | Code | Status |
| --- | --- | --- |
| English | `eng` | Verified — `e2e/ocr.spec.ts` |
| Spanish | `spa` | Verified — `e2e/ocr.spec.ts` |
| French | `fra` | Shipped, not yet covered by an automated accuracy test |

Adding a language means: download its `.traineddata.gz` into `public/tesseract/lang-data/`,
add it to `SUPPORTED_OCR_LANGUAGES` in `src/lib/processors/ocr.ts`, and add a fixture +
test before calling it verified.

## How page classification works

Before OCR runs, every page is classified using `pdf.js`'s native text extraction
(`getTextContent`), counting non-whitespace characters:

- **Native** (≥ 20 chars): already has real, selectable text — skipped by default.
- **Scanned** (≤ 1 char): essentially no embedded text — recommended for OCR.
- **Mixed** (2–19 chars): a little embedded text (e.g. a stamped page number) but likely
  still an image underneath — recommended for OCR.

This is a simple heuristic, not layout analysis, and is described as such on the tool
page. A page with only a short native heading (e.g. "Chapter 3") could be misclassified
as "mixed" — the user can always override page selection manually.

## Searchable PDF export

OCR results are mapped from canvas pixel coordinates back to PDF point space using
`pdf.js`'s `viewport.convertToPdfPoint()`, so the mapping is correct for scale and for
any pre-recognition rotation applied. An invisible (`opacity: 0`) text layer is drawn
**per recognized line** (not per word) using `pdf-lib`, sized to match the line's real
width — this keeps multi-word phrase search working in the exported PDF, which per-word
placement did not (see "Findings" below). The original scanned image is never modified;
the export only adds a text layer on top.

## Findings from real accuracy testing

Per the brief's requirement to test rather than assert, `e2e/ocr.spec.ts` runs real OCR
against fixtures in `e2e/fixtures/ocr/` and checks recognized text against known content:

- **Clean scan** (invoice-style, typed text): 95% average confidence, exact text match,
  including a currency value (`$182.50`) and an account-style string.
- **Currency/numbers-heavy scan**: exact match on `$1,204.56`, `$1,315.94`, and an
  account number `4471-8890-2231`.
- **Form-like scan** (name/DOB/email/phone): exact match on all fields, including an
  email address and a formatted phone number.
- **Low-resolution scan** (700×900): exact match, confirming the tool doesn't need a
  high-DPI source to work.
- **Rotated scan**: recognized correctly once "Rotate before OCR" is set to correct the
  orientation — the tool does not attempt to guess rotation automatically.
- **Spanish**: exact match on a sample invoice-style document.
- **Multi-page scan** (3 pages): all 3 pages recognized correctly and independently.
- **Genuinely low-contrast scan (no added noise)**: 95% confidence, exact match — low
  contrast alone is handled well.
- **Poor-contrast scan with heavy random pixel noise**: recognition failed (near-empty
  output) and took ~85s. This is a real, documented limitation — see below.
- **The optional "Enhance scan" preprocessing (grayscale + contrast stretch) made the
  noisy case *worse***, not better: naive global contrast stretching amplifies random
  noise into false text-like patterns. This is exactly the outcome the brief asked to
  check for before enabling any preprocessing by default — it is **off by default** and
  should be treated as situational, not a general accuracy improvement.

## Known limitations (by design, communicated in the UI)

- Best for correcting/extracting individual words, values, and short text — not
  paragraph reflow, complex layout, or table structure.
- No automatic rotation/orientation detection — the user corrects rotation before OCR.
- No deskew (crooked-scan straightening) — out of scope for this phase; the simple
  contrast-based preprocessing that exists is optional and off by default.
- No handwriting support claimed; Tesseract will attempt recognition but accuracy on
  handwriting is not reliable and isn't presented as such.
- No in-place visual editing of recognized text on the page (that requires a full PDF
  editor, which does not exist in this project yet — see the tool's own FAQ).
- Heavy random image noise (as opposed to plain low contrast) significantly degrades
  accuracy and speed; there is no denoising step.

## Performance

- OCR runs sequentially, one page at a time, using a single reused Tesseract worker per
  session — this was chosen over concurrent pages for predictable memory/CPU use in a
  browser tab, per the brief's "prioritize browser stability over maximum speed."
- Typical clean scan: ~2 seconds per page (excluding first-run engine/model download).
- A 1200×1500–1700×2200px clean page is the tested range; the worst-case fixture
  (1400×900 with heavy synthetic noise) took ~85s, which is the outlier the "device
  safety" warning in the UI is aimed at, not the common case.
- Cancel is real: it stops before starting the next page and keeps already-recognized
  pages rather than discarding the whole batch.
