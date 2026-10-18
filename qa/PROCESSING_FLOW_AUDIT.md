# Processing-flow audit — one click, then hands off

**Verdict: PASS** — 90 runs · 90 PASS · 0 FAIL · extra interaction required: **NO**

A conversion must finish by itself after one click. It may never depend on a second click, a double-click, a focus change, mouse movement, a tab switch, a resize or a re-render caused by interaction. This audit presses each tool's primary action **once**, touches nothing afterwards, and waits for the result; the downloaded file is then checked by the shared output validator.

## The bug, and why a click fixed it

**Reported:** PDF → Word sat on "Recognizing page 1 of 1…" for almost five minutes and finished the moment the page was clicked.

**Reproduced** in real Chromium (headed), with the tab put behind another tab *before* pressing Convert: the page stayed on "Recognizing page 1 of 1…" (41 s and counting) and completed the instant the tab was brought forward. The same thing, deterministically, in an automated run that withholds animation frames until the first real input: stuck at "Preparing scanned page 1 of 1…" for 30 s+ with exactly one `requestAnimationFrame` callback queued, finished 5.7 s after one click on an empty part of the page.

**Root cause — processing was stuck, not the UI.** pdf.js renders a page for display by pacing every step with `requestAnimationFrame` (`InternalRenderTask._scheduleNext`, pdfjs-dist 6.3.289, `build/pdf.mjs`). A browser delivers **no animation frames to a tab or window that is in the background, minimised or covered**, so `page.render(...).promise` never settles. The converter awaited exactly such renders: `extract.ts` `renderPage` (every scanned page), `ocr.ts` `recognizePage` (the render that precedes recognition — the "Recognizing page…" label is shown before it starts, which is why the user saw that text), and `pdf.ts` (PDF → Image). Nothing was wrong with React state, listeners or the OCR worker.

**Why a click or double-click finished it:** the click brings the window to the front and gets it painted again; the browser resumes frames, the queued `requestAnimationFrame` callback fires, the render completes and the pipeline carries on. Any event that made the window visible would have done the same — it was never the click itself.

**Fix:** every render that is part of a conversion now uses pdf.js's *print* intent (`renderPageOffscreen`), which schedules its steps as promises, not frames. Output is unchanged (same OCR accuracy, same SSIM — see the real-user audit). Further hardening: encoding no longer waits for browser idle time (`canvas.toBlob` took ~7 s per call in a background tab; now `OffscreenCanvas.convertToBlob`, and Tesseract is handed a Blob so it doesn't call `toBlob` itself); every OCR step is bounded in time; the OCR that only *judges* a plain scan can never block a conversion (when it runs out of time the page simply keeps its look); Cancel and Retry; a stall notice; real stage names; and OCR is skipped entirely when a document contains pages that must stay pictures anyway.

## Method

- **Harness**: `qa/scripts/pf-audit.mjs` (Chromium desktop and Pixel 7 touch emulation). Inputs are set up like a person would (add file, choose option), then the primary action is sent **once** as an untrusted `click` and nothing else is touched. Genuine (trusted) input after the click is counted and fails the run.
- **Modes**: *normal* — a foreground tab. *starved* — from the moment of the click the browser delivers no animation frames until the user interacts, which is what a tab behind another tab or a covered/minimised window gets. This reproduces the original bug (and the e2e tests fail on the old code: verified by putting the old render call back).
- **Cold / warm**: cold = a fresh browser context (empty HTTP cache, no warm pdf.js/OCR state; the recognition model is same-origin, `cacheMethod: none`, no service worker); warm = the same context, second run.
- **Also run by hand** (headed Chromium, real background tab): `qa/scripts/pf-background-tab.mjs` — the page is put behind a second tab before Convert is pressed. Before the fix: no result in 41 s+ until foregrounded. After: the conversion finishes on its own.
- **Timing diagnostics** (`qa/scripts/pf-flow.mjs`): the stage timeline of one conversion — every status text with its time since the click.

## Results

Times are seconds from the one click to the result appearing. **Cold** = a fresh browser context (empty HTTP cache, no warm OCR/pdf.js state); **warm** = the same context, second run. **Starved** = the browser delivers no animation frames after the click until the user interacts (a tab behind another tab / a covered window).

| Tool | Fixture | Mode | Cold/warm | Start → finish (s) | OCR requests | Extra click required | Result valid | Verdict |
|---|---|---|---|---:|---:|---|---|---|
| Compress PDF | DOCUMENT-02-filled-application.pdf | normal | cold | 0 → 0.6 | 0 | NO | YES | **PASS** |
| Compress PDF | DOCUMENT-02-filled-application.pdf | normal | warm | 0 → 0.6 | 0 | NO | YES | **PASS** |
| Compress Image | DOCUMENT-10-filled-form.png | normal | cold | 0 → 0.7 | 0 | NO | YES | **PASS** |
| Compress Image | DOCUMENT-10-filled-form.png | normal | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | normal | cold | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | normal | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | normal+mobile | cold | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | normal+mobile | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-01-passport-scan.pdf (passport-like scan) | normal | cold | 0 → 0.6 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-01-passport-scan.pdf (passport-like scan) | normal | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-03-certificate.pdf | normal | cold | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-03-certificate.pdf | normal | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-06-resume-native.pdf (native text) | normal | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-06-resume-native.pdf (native text) | normal | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-06-resume-native.pdf (native text) | normal+mobile | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-06-resume-native.pdf (native text) | normal+mobile | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | normal | cold | 0 → 4.6 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | normal | warm | 0 → 4.3 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | normal+mobile | cold | 0 → 6 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | normal+mobile | warm | 0 → 4.9 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-08-signed-contract.pdf (scanned, 2 pages) | normal | cold | 0 → 9.9 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-08-signed-contract.pdf (scanned, 2 pages) | normal | warm | 0 → 9 | 3 | NO | YES | **PASS** |
| PDF → Word | five-mixed-scan.pdf (letter + form + invoice + statement + passport, 5 pages) | normal | cold | 0 → 2.3 | 0 | NO | YES | **PASS** |
| PDF → Word | five-mixed-scan.pdf (letter + form + invoice + statement + passport, 5 pages) | normal | warm | 0 → 2.3 | 0 | NO | YES | **PASS** |
| PDF → Word | five-letter-scan.pdf (5 plain scanned letters) | normal | cold | 0 → 29.7 | 3 | NO | YES | **PASS** |
| PDF → Word | five-letter-scan.pdf (5 plain scanned letters) | normal | warm | 0 → 45 | 3 | NO | YES | **PASS** |
| PDF → Word | five-letter-scan.pdf (5 plain scanned letters) | normal+mobile | cold | 0 → 40.3 | 3 | NO | YES | **PASS** |
| PDF → Word | five-letter-scan.pdf (5 plain scanned letters) | normal+mobile | warm | 0 → 45 | 3 | NO | YES | **PASS** |
| PDF → Word | the user's own scan | normal | cold | 0 → 2.2 | 0 | NO | YES | **PASS** |
| PDF → Word | the user's own scan | normal | warm | 0 → 2.2 | 0 | NO | YES | **PASS** |
| Word → PDF | DOCUMENT-16-complex-word-report.docx | normal | cold | 0 → 0.5 | 0 | NO | YES | **PASS** |
| Word → PDF | DOCUMENT-16-complex-word-report.docx | normal | warm | 0 → 0.4 | 0 | NO | YES | **PASS** |
| Image → Word | DOCUMENT-10-filled-form.png | normal | cold | 0 → 0.4 | 0 | NO | YES | **PASS** |
| Image → Word | DOCUMENT-10-filled-form.png | normal | warm | 0 → 0.4 | 0 | NO | YES | **PASS** |
| Image → Word | DOCUMENT-10-filled-form.png | normal+mobile | cold | 0 → 0.6 | 0 | NO | YES | **PASS** |
| Image → Word | DOCUMENT-10-filled-form.png | normal+mobile | warm | 0 → 0.6 | 0 | NO | YES | **PASS** |
| PDF → Image | DOCUMENT-05-bank-statement.pdf (scanned, 2 pages) → PNG | normal | cold | 0 → 0.6 | 0 | NO | YES | **PASS** |
| PDF → Image | DOCUMENT-05-bank-statement.pdf (scanned, 2 pages) → PNG | normal | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| Image → PDF | DOCUMENT-09 + 10 + 11 (ID PNG, form PNG, receipt JPG) | normal | cold | 0 → 2.2 | 0 | NO | YES | **PASS** |
| Image → PDF | DOCUMENT-09 + 10 + 11 (ID PNG, form PNG, receipt JPG) | normal | warm | 0 → 2 | 0 | NO | YES | **PASS** |
| Image Converter | DOCUMENT-10-filled-form.png → JPG | normal | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Image Converter | DOCUMENT-10-filled-form.png → JPG | normal | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Merge PDF | DOCUMENT-06 + 12 + 02 + 05 (native + scanned, 5 pages) | normal | cold | 0 → 0.3 | 0 | NO | YES | **PASS** |
| Merge PDF | DOCUMENT-06 + 12 + 02 + 05 (native + scanned, 5 pages) | normal | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Split PDF | DOCUMENT-05-bank-statement.pdf, page 2 | normal | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Split PDF | DOCUMENT-05-bank-statement.pdf, page 2 | normal | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Organize PDF | DOCUMENT-08-signed-contract.pdf, rotate page 2 | normal | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Organize PDF | DOCUMENT-08-signed-contract.pdf, rotate page 2 | normal | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| PDF Editor export | DOCUMENT-02-filled-application.pdf + a highlight | normal | cold | 0 → 0.1 | 0 | NO | YES | **PASS** |
| PDF Editor export | DOCUMENT-02-filled-application.pdf + a highlight | normal | warm | 0 → 0.1 | 0 | NO | YES | **PASS** |
| Compress PDF | DOCUMENT-02-filled-application.pdf | starved | cold | 0 → 0.8 | 0 | NO | YES | **PASS** |
| Compress PDF | DOCUMENT-02-filled-application.pdf | starved | warm | 0 → 0.8 | 0 | NO | YES | **PASS** |
| Compress Image | DOCUMENT-10-filled-form.png | starved | cold | 0 → 0.9 | 0 | NO | YES | **PASS** |
| Compress Image | DOCUMENT-10-filled-form.png | starved | warm | 0 → 0.7 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | starved | cold | 0 → 0.8 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | starved | warm | 0 → 0.8 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-01-passport-scan.pdf (passport-like scan) | starved | cold | 0 → 0.7 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-01-passport-scan.pdf (passport-like scan) | starved | warm | 0 → 0.8 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-03-certificate.pdf | starved | cold | 0 → 0.8 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-03-certificate.pdf | starved | warm | 0 → 0.8 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-06-resume-native.pdf (native text) | starved | cold | 0 → 0.4 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-06-resume-native.pdf (native text) | starved | warm | 0 → 0.4 | 0 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | starved | cold | 0 → 10.3 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | starved | warm | 0 → 10.6 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-08-signed-contract.pdf (scanned, 2 pages) | starved | cold | 0 → 18.6 | 3 | NO | YES | **PASS** |
| PDF → Word | DOCUMENT-08-signed-contract.pdf (scanned, 2 pages) | starved | warm | 0 → 18.6 | 3 | NO | YES | **PASS** |
| PDF → Word | five-mixed-scan.pdf (letter + form + invoice + statement + passport, 5 pages) | starved | cold | 0 → 4.6 | 0 | NO | YES | **PASS** |
| PDF → Word | five-mixed-scan.pdf (letter + form + invoice + statement + passport, 5 pages) | starved | warm | 0 → 4.4 | 0 | NO | YES | **PASS** |
| PDF → Word | five-letter-scan.pdf (5 plain scanned letters) | starved | cold | 0 → 51.9 | 3 | NO | YES | **PASS** |
| PDF → Word | five-letter-scan.pdf (5 plain scanned letters) | starved | warm | 0 → 51.4 | 3 | NO | YES | **PASS** |
| PDF → Word | the user's own scan | starved | cold | 0 → 2.7 | 0 | NO | YES | **PASS** |
| PDF → Word | the user's own scan | starved | warm | 0 → 2.6 | 0 | NO | YES | **PASS** |
| Word → PDF | DOCUMENT-16-complex-word-report.docx | starved | cold | 0 → 0.5 | 0 | NO | YES | **PASS** |
| Word → PDF | DOCUMENT-16-complex-word-report.docx | starved | warm | 0 → 0.5 | 0 | NO | YES | **PASS** |
| Image → Word | DOCUMENT-10-filled-form.png | starved | cold | 0 → 0.6 | 0 | NO | YES | **PASS** |
| Image → Word | DOCUMENT-10-filled-form.png | starved | warm | 0 → 0.6 | 0 | NO | YES | **PASS** |
| PDF → Image | DOCUMENT-05-bank-statement.pdf (scanned, 2 pages) → PNG | starved | cold | 0 → 0.6 | 0 | NO | YES | **PASS** |
| PDF → Image | DOCUMENT-05-bank-statement.pdf (scanned, 2 pages) → PNG | starved | warm | 0 → 0.6 | 0 | NO | YES | **PASS** |
| Image → PDF | DOCUMENT-09 + 10 + 11 (ID PNG, form PNG, receipt JPG) | starved | cold | 0 → 2.6 | 0 | NO | YES | **PASS** |
| Image → PDF | DOCUMENT-09 + 10 + 11 (ID PNG, form PNG, receipt JPG) | starved | warm | 0 → 2.7 | 0 | NO | YES | **PASS** |
| Image Converter | DOCUMENT-10-filled-form.png → JPG | starved | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Image Converter | DOCUMENT-10-filled-form.png → JPG | starved | warm | 0 → 0.4 | 0 | NO | YES | **PASS** |
| Merge PDF | DOCUMENT-06 + 12 + 02 + 05 (native + scanned, 5 pages) | starved | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Merge PDF | DOCUMENT-06 + 12 + 02 + 05 (native + scanned, 5 pages) | starved | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Split PDF | DOCUMENT-05-bank-statement.pdf, page 2 | starved | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Split PDF | DOCUMENT-05-bank-statement.pdf, page 2 | starved | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Organize PDF | DOCUMENT-08-signed-contract.pdf, rotate page 2 | starved | cold | 0 → 0.2 | 0 | NO | YES | **PASS** |
| Organize PDF | DOCUMENT-08-signed-contract.pdf, rotate page 2 | starved | warm | 0 → 0.2 | 0 | NO | YES | **PASS** |
| PDF Editor export | DOCUMENT-02-filled-application.pdf + a highlight | starved | cold | 0 → 0.1 | 0 | NO | YES | **PASS** |
| PDF Editor export | DOCUMENT-02-filled-application.pdf + a highlight | starved | warm | 0 → 0.1 | 0 | NO | YES | **PASS** |

## PDF → Word: what each document was, and whether OCR ran

| Document | Page classes | Strategy | OCR used | Why | Time (s, foreground) |
|---|---|---|---|---|---:|
| DOCUMENT-02-filled-application.pdf (scanned form, 1 page) | FORM | visual | NO | a form / ID / certificate / table / photo: kept as it looks, decided from pixels — no OCR needed | 0.5 |
| DOCUMENT-01-passport-scan.pdf (passport-like scan) | OFFICIAL_DOCUMENT | visual | NO | a form / ID / certificate / table / photo: kept as it looks, decided from pixels — no OCR needed | 0.5 |
| DOCUMENT-03-certificate.pdf | OFFICIAL_DOCUMENT | visual | NO | a form / ID / certificate / table / photo: kept as it looks, decided from pixels — no OCR needed | 0.5 |
| DOCUMENT-06-resume-native.pdf (native text) | NATIVE_TEXT | editable | NO | real text — nothing to read | 0.2 |
| DOCUMENT-07-scanned-letter.pdf (plain scanned letter, 1 page) | SCANNED_TEXT | hybrid | YES | a plain scan of running text: read once to decide whether it is reliable enough to become editable text (otherwise it keeps its look) | 4.3 |
| DOCUMENT-08-signed-contract.pdf (scanned, 2 pages) | SCANNED_TEXT,SCANNED_TEXT | visual,visual | YES | a plain scan of running text: read once to decide whether it is reliable enough to become editable text (otherwise it keeps its look) | 9 |
| five-mixed-scan.pdf (letter + form + invoice + statement + passport, 5 pages) | SCANNED_TEXT,FORM,SCANNED_TABLE,SCANNED_TABLE,OFFICIAL_DOCUMENT | visual,visual,visual,visual,visual | NO | a form / ID / certificate / table / photo: kept as it looks, decided from pixels — no OCR needed | 2.3 |
| five-letter-scan.pdf (5 plain scanned letters) | SCANNED_TEXT,SCANNED_TEXT,SCANNED_TEXT,SCANNED_TEXT,SCANNED_TEXT | hybrid,hybrid,hybrid,hybrid,hybrid | YES | a plain scan of running text: read once to decide whether it is reliable enough to become editable text (otherwise it keeps its look) | 45 |
| the user's own scan | FORM,OFFICIAL_DOCUMENT | visual,visual | NO | a form / ID / certificate / table / photo: kept as it looks, decided from pixels — no OCR needed | 2.2 |

## Failures

None.

## Honest notes

- A tab in the background still converts more slowly than a foreground tab (the scanned letter took about 33 s against 6 s): the operating system gives a background browser tab less CPU. That is not something the page can change; it now finishes unattended instead of stalling.
- The OCR that judges a plain scan of text still takes about 5 s per page in the foreground (about 5 pages in 25 s). It runs only for documents whose scanned pages are *all* plain text; forms, passports, certificates, tables and photos are decided from pixels in about a second, and a document with any such page skips OCR altogether.
- The recognition model (about 3 MB, same origin) loads in well under a second here; on a slow connection the new *Loading text recognition…* stage says what is happening, a stage that goes quiet gets the "taking longer than expected" notice with Retry and Cancel, and a model that has not loaded within 60 s is given up on (the page keeps its look).
- Playwright's own click waits for animation frames, so the harness sends the primary click as a DOM event; real users click with a real pointer, which is not delayed by frames.
- Microsoft Word is not involved in this audit; it measures the page's behaviour, not `.docx` rendering (see `qa/REAL_USER_PRODUCT_AUDIT.md` for that).
