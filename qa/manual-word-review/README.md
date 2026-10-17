# Manual Microsoft Word review — scanned PDF → Word

**MANUAL WORD REVIEW REQUIRED.** Microsoft Word is installed on this machine but runs as an unlicensed
product, and its automation (`qa/validate/wordrender.ps1`) hangs. Every automated render in this branch is
LibreOffice 26.2.6. Nothing here has been checked in Word yet. Please open each file in Word (desktop) and
check the points below. If Word opens a file in Protected View, choose **Enable Editing** before judging the
layout.

The DOCX files were downloaded from the real `/pdf-to-word` page (production build of this branch). The
originals and LibreOffice renders, side by side, are in `qa/fidelity/final-scan-review/<name>/`
(`original.png`, `word-render.png`, `diff.png`: red = only in the original, blue = only in the Word render,
black = both).

`user-scan.docx` and `qa/fidelity/final-scan-review/user-scan/` are your own document. They are on this
machine only (git-ignored), never committed.

## What to check in every file
- One page in Word for each page of the original, with the same page size.
- No stray characters, fragments or symbols ("[J", "|", "ER CC CS TR").
- Text you can select and edit (pictures are used only for stamps, signatures and charts).

## user-scan.docx — your scan (2 pages)
- **Page 1**
  - OFFICIAL RECORD - SCANNED COPY at the top, with the rule under it.
  - "Student Information" under it.
  - *Name:* and *John Smith* on one line, the line under the name kept.
  - The sentence with its rule.
  - VALID FROM · 02/08/2026 · UNTIL · 12/20/2026 on one row inside a box with four sides.
  - Account Number and Invoice Total rows aligned.
  - A real 4 × 3 table (Item / Status / Value) with borders.
  - Registrar line.
- **Page 2**
  - Double page border.
  - CERTIFICATE OF COMPLETION.
  - Robert Johnson.
  - The Award Date line with its rule.
  - Classification and Score rows.
  - The verification code inside its box.

## form.docx — application form
- Purple section bars ("Section A — Applicant" …) as full-width shaded boxes with white text.
- Fill-in lines after Organisation name, Registered charity number, Contact person, Email address, Telephone,
  Project title, Signature and Date. They are underline tab leaders: click after a label and type, and the
  text should sit on the line.
- Check boxes ☐ Education ☑ Health ☐ Environment ☐ Arts and culture ☐ Other on one row, Health ticked.
- The Budget table: 4 rows × 3 columns, shaded header row.

## invoice.docx — invoice
- Seller address (left) and invoice number / issue date / due date (right) side by side, each block with its
  own line spacing, and the right block aligned right.
- BILL TO / SHIP TO in two columns.
- The item table: a dark blue header row with white text, 6 rows of items (alternate rows lightly tinted)
  and amounts aligned right.
- Subtotal / VAT / Total due aligned with the amounts.
- The logo, kept as a picture.

## two-column.docx — two-column report
- Title and authors across the page, the abstract, then two columns.
- Headings "1. Introduction", "2. Method", "3. Results", "4. Discussion" in **bold** Georgia, about 13 pt, the
  same size as each other.
- The chart (bars and axes) at the top of the right column, with its caption under it, and "4. Discussion"
  under the caption.
- Lines in both columns break where the original's do.

## transcript.docx — transcript (LIMITED in the automated check)
- The header table (Student / Student ID / Programme / Date issued).
- Three course tables with grey grids and shaded header rows.
- Known limitation: the term headings ("Autumn 2024" …) come out regular and 2–3 pt too large where the
  original is bold. "General Chemistry I" may show the "I" a few points to the right.

## table-heavy.docx — table report
- "Regional performance": blue header row with white text, the Total row tinted, amounts aligned right.
- "Staffing plan": merged "Warehouse" cell spanning two rows.
- "Top issues" table.

## letter.docx — letter with stamp and signature
- Letterhead, the rule under the address, the date, the recipient's address and the body paragraphs.
- The handwritten signature and the round stamp kept as pictures in their places, not turned into text.
- The signed name under the signature is part of the signature picture (it was written over by the
  signature).
