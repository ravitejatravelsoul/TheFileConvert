# Manual Microsoft Word review

**MANUAL WORD REVIEW REQUIRED.** Microsoft Word is installed on the development machine but runs as an
unlicensed product, and its automation (`qa/validate/wordrender.ps1`) hangs. Every automated render in this branch
is LibreOffice 26.2.6, so **nothing here has been checked in Word itself**. Please open each file in Word (desktop)
and check the points below. If Word opens a file in Protected View, choose **Enable Editing** before judging.

The files were downloaded from the real `/pdf-to-word` and `/image-to-word` pages (production build of this branch)
from the fake documents in `qa/real-user-fixtures/`. Side-by-side images (source | LibreOffice render | difference)
are in `qa/fidelity/real-user/`; the measured results are in `qa/REAL_USER_PRODUCT_AUDIT.md`.
`user-scan.docx` is made from your own scan: it exists on this machine only (git-ignored), never committed.

This package replaces the earlier one (made when scanned pages were rebuilt as editable text). Scanned pages are now
kept as they look — see `qa/CONVERSION_SEMANTICS.md`.

## Scanned documents kept as they look
`DOCUMENT-01-passport-scan`, `-02-filled-application`, `-03-certificate`, `-04-invoice`, `-05-bank-statement`
(2 pages), `-08-signed-contract` (2 pages), `user-scan` (2 pages).
- One Word page per original page, **same page size** (Letter portrait; the certificate is landscape).
- The page looks like the original: photo, handwriting, stamp, signature, check boxes, borders, table lines.
- The picture fills the page edge to edge, sits **behind** an empty paragraph, and does not shift when you click in
  the page, press Enter or change zoom. Clicking selects the picture (it is a movable, resizable picture on purpose).
- No stray text, and no second page appearing after each page.
- Readable at normal zoom (about 180–200 dpi); file size about 0.4–1 MB per page.

## Native PDFs made editable
`DOCUMENT-06-resume-native`, `-04b-invoice-native`, `-12-table-report`, `-13-brochure`.
- Text is real and editable; headings use Heading styles; lists are real lists; tables are real tables.
- 06: the dark name band is only as wide as its text (known LIMITED); the skills table has horizontal lines only.
- 13: grey bars above the three columns and the full-height title band are not reproduced (known LIMITED); check
  the page stays one page.
- 12: the data table and the chart picture are in place.

## A plain scanned letter (hybrid)
`DOCUMENT-07-scanned-letter` — chosen as editable text because the on-device reading was reliable. Compare the
wording with the original; the paper grain is gone by design.

## Images
`image-filled-form` — one page, the picture is the page (proportions of the PNG, no margins); no text.

## In every file
- No stray characters or symbols; page count as stated above.
- Report anything that surprises you — that is the test applied to every tool.
