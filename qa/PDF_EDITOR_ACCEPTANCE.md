# PDF Editor — acceptance

Branch `rebuild/fresh-launch`. Nothing deployed, nothing merged to `main`. Evidence: `qa/review/pdf-editor/`.

## Gate (final run on the finished build)

| Check | Result |
|---|---|
| Unit tests (Vitest) | 577 passed, 50 files, 0 failed |
| Playwright, whole suite, `--workers=1`, 4 projects (Chromium, Pixel 7, and the two OCR projects) | 400 passed, 110 skipped, 0 failed |
| TypeScript `tsc --noEmit` | clean |
| ESLint | 0 errors (0 warnings after the last edit) |
| `next build` | passes |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (with dev tools) | 5 high advisories, all in the dev-only lint chain (`braces` → … → `eslint-config-next`); the only offered fix is a major-version downgrade of `eslint-config-next`, so it was not applied |

Skipped tests, with reasons: 22 are the experimental "edit recognized OCR words" specs (feature off by default; they run with
`TFC_OCR_EDITING=1` on a build made with `NEXT_PUBLIC_TFC_OCR_EDITING=1`); the remaining editor skips are desktop-only specs
skipping on the phone project and phone-only specs skipping on desktop.

## Real-user matrices (through the real UI)

| Matrix | Cases | Result |
|---|---|---|
| Native text: every native fixture × its deliberate mistakes (teh → the, recieve → receive, …) | 40 | all pass |
| Native text scenarios: same length, shorter, longer, single character insert / replace / delete, whole word, several words, line end, bold, italic, coloured, large heading, small body, rotated pages 2–4, special characters, currency, form page, page 12 of 25 | 18 | all pass |
| Other producers (Adobe Designer W-9, Antenna House 1040-ES, Acrobat PDFMaker table) | 3 | all pass |
| Independent validation of all 61 exports: qpdf opens and checks them, MuPDF and poppler read the new text and not the old, other pages are pixel-identical, and pixels outside the edited paragraph | 61 | 61 ok; largest share of a page changed outside the edited paragraph 0.0053 % (anti-alias noise) |
| Pictures: select, move, resize (proportions kept), turn, replace, delete, undo, redo; six-picture page moves only the touched one | 3 specs | pass |
| Forms: text, checkbox, radio, dropdown filled on the page, export, reopen in the editor, undo | 2 specs | pass |
| Scanned pages: labelled, no text editing offered, add text / whiteout / highlight / draw work | 2 fixtures | pass |
| Undo/redo, dirty marker, search new-not-old, Cancel leaves the page, keyboard in the text box | 3 specs | pass |
| Long uninterrupted session: 12 edits on 12 pages of a 25-page file plus added text between, one export, every edit present, untouched page identical | 1 | pass |
| Manual-typing stress: type straight after the double-click, 40 words with no delay, Done at once | 1 | pass |
| Backgrounded tab (no animation frames, no window focus): edit and export complete | 1 | pass |
| Privacy: no cross-origin request and no non-GET request while editing text and pictures and exporting | 1 + existing | pass |
| Added text: serif + bold + italic + underline + align + move, correct font in the export | 1 | pass |
| Phone: tap text, "Edit text", type, Done, export; ≥ 44 px controls; no horizontal overflow; pages and properties as sheets | 2 | pass |
| Shortcuts V E T H U D (not while typing), Escape, accessible names | 1 | pass |
| Performance: 25-page file opens editable in 0.76 s, 8 canvases, an edit commits in 0.62 s | 1 | pass |

## Defects found by this acceptance run, all fixed with regression tests

* single-line headings could not grow; "Bold" → "Strong" mixed two fonts in a word; replace-then-edit of a picture failed on
  export; a link annotation in a PDF with form fields made **every export of that file fail** (IRS 1040-ES); untouched form
  fields were re-rendered a pixel off. Details: [PDF_EDITOR_CODE_REVIEW.md](PDF_EDITOR_CODE_REVIEW.md) §3.

## Not claimed

* Secure redaction, comments, and editing of existing annotations are **not shipped**.
* Whiteout is a visual cover and says so.
* Signatures are visual signatures, not digital signatures.
* Microsoft Word was not used for any validation. PDF readers used: qpdf, MuPDF, poppler, pdf.js, pdf-lib.
* Editing text outside the bundled fonts' character coverage, Type 3 / outlined text, and complex-script shaping are refused with a reason.
* Browsers tested: Chromium (desktop and Pixel 7 emulation) only. Firefox and Safari were not run.
