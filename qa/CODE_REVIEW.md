# Code review — fidelity audit fixes

Branch `rebuild/fresh-launch`, baseline `f5a76769` ("feat: complete first-launch conversion journeys").
Every product change made during the fidelity audit is reviewed below, one entry per defect, followed by a
review of the shared architecture. Measurements are from `qa/evidence/fresh/fid-*.json` (harness:
`qa/scripts/fid-run.mjs`, `qa/scripts/fid-tools.mjs`, `qa/validate/layoutdiff.py`, `qa/validate/visdiff.py`);
see `qa/FIDELITY_AUDIT.md` for the method and the per-scenario results.

Reviewer's standard for APPROVED: the root cause is understood (not just the symptom), the fix is at the
cause, a unit test fails without the fix (spot-checked by mutation where noted), the real-UI fidelity run
improved or held on every document, and nothing else regressed (348/348 unit tests, Playwright, tsc, ESLint).

Files changed (product): `src/lib/processors/pdf-to-word/{extract,layout,docx,index}.ts`,
`src/lib/processors/word-to-pdf/{layout,fonts,index}.ts`, `src/lib/processors/image.ts`,
`package.json`/`package-lock.json` (Next.js security patch).
Final closure (after c277426): `src/lib/processors/word-to-pdf/{model,parse,fonts,layout}.ts`,
`public/fonts/word/` (Gelasio, Caladea, DejaVu Sans Oblique/Bold Oblique + licences),
`src/lib/editor/{searchLayer,export}.ts`, `src/lib/processors/ocr.ts`,
`src/components/editor/{useEditorWorkspace.ts,PropertiesPanel.tsx}`, `src/lib/processors/pdf-to-word/extract.ts`.
Tests: `pdf-to-word/{layout,docx}.test.ts`, `word-to-pdf/word-to-pdf.test.ts`, `editor/searchLayer.test.ts`.

---

## PDF → Word

The converter used to rebuild only text and paragraph order: every run was Arial, spacing and margins were
fixed values, colours/underlines/tabs/rules/headers were dropped. The baseline fidelity run graded 3 of 25
documents PASS (`fid-all-before.json`). The fixes below are what the PDF → Word rewrite consists of.

### P2W-01 · Fonts lost — every run written as Arial
- **Root cause:** `extract.ts` kept only bold/italic from the PDF font; `docx.ts` wrote `w:rFonts="Arial"` on every run.
- **Files / functions:** `extract.ts` `wordFontName`, `fontInfo`; `layout.ts` `Run.font`, `pushRun`, `sameLook`, `documentStats.bodyFont`; `docx.ts` `rPr`, `styles.xml` docDefaults.
- **Why this fix:** maps the PDF's (often subset-prefixed) font names to the Word names they stand for (Carlito→Calibri, Liberation/Arimo/Tinos→Arial/Times New Roman, …); the document's most-used font becomes the default so runs only name fonts that differ (smaller XML, and Word's "theme" behaviour stays sane).
- **Architectural impact:** local. **Regression risk:** low. **What could break:** an unknown PDF font name is written CamelCase-split (Word substitutes it) — no worse than before.
- **Tests:** `layout.test.ts` "keeps each run's font and colour…", `docx.test.ts` "keeps fonts other than the body font…".
- **Manual / output validation:** formatting sampler fidelity: size kept 98–100 %, fonts visible in LibreOffice and in the DOCX XML.
- **Review result:** APPROVED.

### P2W-02 · Text colour lost
- **Root cause:** pdf.js `getTextContent()` carries no colour; the operator list does, but was never read.
- **Files / functions:** `extract.ts` `readPage` (single operator pass: `setFillRGBColor` + `showText` build a character→colour stream that is aligned to the text items by majority over a 40-character window), `hexColor`.
- **Why this fix:** one pass over the operator list (already needed for images) gives colour without a second parse; alignment by characters tolerates pdf.js merging/splitting items.
- **Architectural impact:** local. **Regression risk:** medium (heuristic alignment). **What could break:** text drawn with a pattern/shading fill comes out black (as before).
- **Tests:** colour asserted in `layout.test.ts` and `docx.test.ts`. **Output validation:** colour kept 100 % on every corpus document (`colorKept`).
- **Review result:** APPROVED.

### P2W-03 · Bullets became empty boxes
- **Root cause:** Symbol/Wingdings bullets arrive as private-use code points (U+F0B7 …) that no Word font draws.
- **Fix:** `extract.ts` `PUA_BULLETS` / `mapSymbols` map them to •, ◦, ▪ before layout. Symbol font names map to "" so no symbol font is requested.
- **Impact:** local. **Risk:** low. **Tests:** list fixtures (PDF-WORD-05) and corpus (resume, brochure) render real bullets. **Review result:** APPROVED.

### P2W-04 · Fixed margins, spacing and line pitch
- **Root cause:** margins and paragraph spacing were constants; Word's line height (≈1.15–1.22 em by font) replaced the PDF's pitch, so every page drifted down and often spilled onto an extra page (bank statement 3→7 pages, invoice 1→2).
- **Files / functions:** `layout.ts` `layoutPage` (margins from content, floored to twips so lines still fit), `formatFor` (exact line pitch from the median baseline gap), `lineBoxTop`/`place` (box top = baseline − (pitch − descent)), `setSpaceBefore`/`spaceOut` (space-before from positions); `docx.ts` `pPrXml` (`w:spacing w:line … w:lineRule="exact"`).
- **Why this fix:** Word honours exact spacing, so positions can be reproduced to a fraction of a point instead of approximated.
- **Impact:** shared within the converter (every block). **Risk:** medium. **What could break:** a document edited later in Word keeps exact spacing (adding a larger font in a line clips) — the standard trade-off of faithful PDF→Word converters; documented.
- **Tests:** layout tests (paragraph join/split), fidelity run. **Output validation:** median word displacement on the corpus fell from 10–323 pt to 0.2–5 pt; page counts now match on every document.
- **Review result:** APPROVED.

### P2W-05 · Lines re-wrapped in Word
- **Root cause:** the text area was the bounding box of the text (+1.5 pt) at half-point precision; Word's widths differ slightly, so lines that just fit wrapped early and wrapped lines with room re-flowed.
- **Files / functions:** `layout.ts` `textAreaRight` (bound from the first word of each next line: a wrapped line's next word must still not fit; justified text ends exactly at the edge; un-wrapped text gets a generous mirrored margin), `wrapBound` + `formatFor` (per-paragraph right indent only when the paragraph's own wraps prove it), `tw` (1/20 pt precision), `WRAP_SLACK`.
- **Why this fix:** it models *why* a line ended where it did, instead of guessing a margin.
- **Impact:** local. **Risk:** medium. **What could break:** a justified paragraph re-wraps in LibreOffice (compat mode 15 shrinks spaces); the letter is LIMITED for this reason — documented, not hacked around.
- **Tests:** `layout.test.ts` "sets the right margin so wrapped lines still wrap where they did". **Output validation:** `lineKept` 97.5–100 % across the corpus.
- **Review result:** APPROVED.

### P2W-06 · Tabs, right-aligned dates, TOC leaders and form blanks lost
- **Root cause:** gaps inside a line were collapsed into a space.
- **Files / functions:** `layout.ts` `buildLine` (cells at gaps > 1.6 em), `splitLeaders` (trailing `____`/`....` become a leader cell), `formatFor` (tab stops: left at cell starts, right at the edge, right + leader for blanks/TOCs); `docx.ts` tab XML with `w:leader`.
- **Impact:** local. **Risk:** low. **Tests:** `layout.test.ts` "turns a dotted leader into a right tab with a dot leader", `docx.test.ts` "writes right tabs with dot leaders…". **Review result:** APPROVED.

### P2W-07 · Ruled tables not rebuilt (lines dropped, cells merged into paragraphs)
- **Root cause:** tables were only inferred from text alignment; the drawn grid was ignored.
- **Files / functions:** `extract.ts` `readPage` (stroked axis-aligned segments and thin filled bars → `rules`; non-white fills → `fills`), `layout.ts` `findGrids` (union-find of touching rules), `gridTable` (columns/rows from the lines, `gridSpan` from missing verticals, `vMerge` from missing horizontals, shading from fills, measured cell padding and in-cell pitch, row height = line gap − border thickness, which Word adds back), `docx.ts` table writer.
- **Impact:** local. **Risk:** medium. **What could break:** a decorative box around text becomes a 1×1 table (acceptable; it keeps the box). `findGrids` is O(n²) over rules — fine for hundreds of lines, slow for a page with thousands of hairline vectors (noted below).
- **Tests:** `layout.test.ts` "rebuilds a ruled table from its lines, with a cell spanning two columns", `docx.test.ts` "pins a table … and merges cells". **Output validation:** bank statement, invoice, transcript, table report: tables PASS (rule length kept ≥ 90 %).
- **Review result:** APPROVED.

### P2W-08 · Borderless tables mis-columned; cell padding inflated
- **Root cause:** columns were taken from the first row's cell starts, so right-aligned amounts created new columns; padding was measured from right-aligned text.
- **Fix:** `layout.ts` `borderlessTable` (columns = merged horizontal extents of all rows' cells; per-column alignment from common left/right/centre; edges placed so cells need no padding).
- **Impact:** local. **Risk:** low. **Tests:** `layout.test.ts` "rebuilds a simple table from aligned cells". **Review result:** APPROVED.

### P2W-09 · Two-column pages read as one column
- **Root cause:** the gutter search counted every line crossing the gutter, so a full-width title or abstract vetoed it.
- **Fix:** `layout.ts` `findGutter` (only text in the vertical zone where both columns have text counts; ≤ 6 % crossing; both sides must contain running text — p75 line width ≥ 60 % of the column, so key/value forms aren't mistaken for columns); `layoutPage` builds a `columns` block per band between spanning lines; `docx.ts` writes a continuous 2-column section with a column break.
- **Impact:** local. **Risk:** medium. **Tests:** `layout.test.ts` "reads two columns left column first". **Output validation:** report-two-column PASS (median 0.5 pt), brochure PASS (0.3 pt), PDF-WORD-08 PASS. **Review result:** APPROVED.

### P2W-10 · Running headers and footers never detected
- **Root cause:** `findHeadersFooters` compared `Line` objects by identity, but `groupLines` builds new objects on every call, so the "no neighbours" test always found the line itself and rejected it.
- **Fix:** compare by position (`inBand`); repeated top/bottom-band lines (digits normalised) or page numbers go to real header/footer parts (`docx.ts` deduplicates `header{n}.xml`/`footer{n}.xml`), page numbers become `PAGE`/`NUMPAGES` fields.
- **Impact:** local. **Risk:** low. **Tests:** `layout.test.ts` "finds the running header and the page-number footer…", `docx.test.ts` "writes the running header and footer once, with live page-number fields". **Review result:** APPROVED.

### P2W-11 · Pictures floated over column text / beside-text pictures pushed the flow
- **Fix:** `layoutPage` — a picture inside one column belongs to that column's flow; a picture with text beside it is anchored to the page (`wp:anchor`, wrapNone) at its exact position.
- **Impact:** local. **Risk:** low. **Output validation:** image IoU 0.87–1.0 on the corpus. **Review result:** APPROVED.

### P2W-12 · A table beside text pushed the text below it
- **Fix:** `layoutPage` marks a ruled table with running text beside it as floating; `docx.ts` writes `w:tblpPr` (page-anchored) + `w:tblOverlap`, no `tblInd`, zero height in the flow.
- **Impact:** local. **Risk:** medium (floating tables are handled differently by older readers). **Tests:** `docx.test.ts` "pins a table with text beside it to the page". **Review result:** APPROVED.

### P2W-13 · Address lines merged into one paragraph
- **Root cause:** joining only looked at the gap and the indent.
- **Fix:** `blocksFor` — a line that ends well short of the text area (< 60 % of the width, or < 72 % ending in punctuation) ends its paragraph.
- **Impact:** local. **Risk:** low (short-line heuristic). **Tests:** updated layout tests use realistic widths. **Review result:** APPROVED.

### P2W-14 · Underline and strikethrough lost; P2W-15 · paragraph rules and shading lost
- **Fix:** `decorate` assigns thin rules at the baseline/strike height to the text above them; `formatFor` turns a rule just under a paragraph into a bottom border and a fill behind it into shading.
- **Impact:** local. **Risk:** low. **Review result:** APPROVED.

### P2W-16 · (found in this review) Text in the lower half of a vertically merged ruled cell was dropped
- **Defect:** `gridTable` emptied every `vMerge="continue"` cell. Text that sits in the lower row of a merged cell (vertically centred, or wrapped) was silently lost — a text-preservation failure.
- **Root cause:** cell content was collected per row band and discarded for continuation cells.
- **Fix:** `gridTable` keeps a `mergeOwner` per grid column; text found in a continuation cell is appended to the cell that started the merge; if there is no such cell the text stays where it is (never dropped).
- **Impact:** local. **Risk:** low. **What could break:** nothing observed; corpus unchanged.
- **Tests:** `layout.test.ts` "keeps the text of a vertically merged cell that sits in its lower row".
- **Review result:** APPROVED.

### P2W-17 · (found in this review) A number at the edge of the page could be replaced by a page counter
- **Defect:** any bare number alone in the top/bottom 10 % band (e.g. a total "1250" at the foot of a one-page invoice) became a `PAGE` field, so Word would print "1" instead of the original value.
- **Root cause:** `PAGE_NUMBER` matched any lone number; nothing checked it was the page's number.
- **Fix:** `findHeadersFooters` accepts a lone number only if it equals the page's position (or says "page"), and `bandParagraphs` turns a number into a field only when it equals this page's number (and the total equals the page count); otherwise the text is kept as written. New `PageBands` type carries `pageNo`/`pageCount`.
- **Impact:** local. **Risk:** low. **What could break:** a document whose printed page numbers start at an offset keeps them as literal text instead of a field (correct text, not live).
- **Tests:** `layout.test.ts` "turns a number at the foot of the page into a page-number field only when it is the page number".
- **Review result:** APPROVED.

### P2W-19 · (found by the final journey run) Table borders taken as underlines — rows falsely merged
- **Defect:** Word → PDF → Word of a ruled table kept only 57.6 % of its words in separate cells: four rows
  came back as one vertically merged block, and the header words were underlined.
- **Root cause:** `decorate` accepted any thin rule 0–0.3 em under a word as that word's underline when the
  rule was at most 3× the word's width + 20 pt. In Word's tables the cell border sits ~0.29 em under the
  baseline, and a 108 pt cell is within that bound for a 33 pt word, so the border was consumed as an
  underline and removed from the rules; `gridTable` then found no line between the rows and merged them.
- **Fix:** `decorate` only takes a rule as an underline/strike when ≥ 70 % of its length lies along glyphs on
  that baseline (`along`, memoised per rule). A border spanning a whole cell under one short word stays a border.
- **Impact:** local. **Risk:** low. **What could break:** an underline drawn far longer than its text (a
  signature line under a short label) stays a separate rule — correct.
- **Tests:** `layout.test.ts` "keeps a cell border just under a short word as a border" (fails without the
  fix — mutation-checked), "still recognises a real underline drawn along its words".
- **Review result:** APPROVED.

### P2W-20 · (found by the final scenario run) A scanned paragraph's wrapped lines split apart
- **Defect:** on the scanned receipt each paragraph came out as two (5/7 paragraphs intact; PASS at baseline).
- **Root cause:** the new "different look → new paragraph" rule compared font sizes, and OCR sizes are
  estimated per word box, varying by up to a point between lines of one paragraph.
- **Fix:** `buildLine` leaves size out of a recognised (OCR) line's look; bold/italic/font/colour still count.
- **Impact:** local (OCR only). **Risk:** low. **Tests:** `layout.test.ts` "joins a recognised paragraph's
  wrapped lines…" (fails before the fix). **Review result:** APPROVED.

### P2W-18 · (found in this review) Quadratic list membership in the column split
- **Fix:** `layoutPage` uses `Set`s instead of `Array.includes` inside `filter` for the spanning/left/right split. **Risk:** none (same result). **Review result:** APPROVED.

---

## Word → PDF

The engine already kept text; the audit showed the *layout* drifted (resume median 15.6 pt, bank statement
pages broke in different places, a 40 pt jump after page breaks).

### W2P-01 · Space between paragraphs was the sum of "after" and "before"
- **Root cause:** `stack()` added the previous paragraph's space-after to the next one's space-before; Word uses the larger of the two.
- **Files / functions:** `word-to-pdf/layout.ts` `stack`, `beforeOf`, keep-with-next chain height.
- **Impact:** shared (every paragraph boundary). **Risk:** medium (affects pagination everywhere). **What could break:** documents that relied on the old over-spacing look tighter — they now match Word.
- **Tests:** `word-to-pdf.test.ts` "collapses paragraph spacing to the larger of space after and space before". **Output validation:** resume median 15.6 → 0.7 pt.
- **Review result:** APPROVED.

### W2P-02 · Line heights not in whole twips
- **Root cause:** Word rounds each line height up to 1/20 pt; we used exact floats, and over a long document the fractions decided whether the last line fitted.
- **Fix:** `renderLine` — `h = ceil(h × 20) / 20` (a floor-after-rounding variant was measured and made every document worse; reverted).
- **Tests:** "lays lines out in whole twips, rounding each line up". **Output validation:** long report: 11/11 pages, median 0.6 pt. **Review result:** APPROVED.

### W2P-03 · The header row didn't repeat above the rest of a row split across pages
- **Root cause:** a split row's continuation box was created without the table's `repeat` (header rows).
- **Fix:** `layout.ts` — `parts[1].repeat = b.repeat` at both split sites.
- **Tests:** "repeats the header row above the rest of a row that breaks across pages" (fails without the fix — mutation-checked). **Review result:** APPROVED.

### W2P-04 · Table rows were short by their bottom border
- **Root cause:** row height = content + cell margins; Word adds the width of the border under the row. 0.25–0.5 pt per row accumulated (the bank statement broke pages at different rows).
- **Fix:** `tableBoxes` row heights add the row's bottom-border width (not for exact-height rows).
- **Tests:** "gives each table row its bottom border's thickness on top of its content" (mutation-checked). **Output validation:** bank statement FAIL → PASS (median 1.0 pt), transcript 3.1 → 0.9 pt. **Review result:** APPROVED.

### W2P-05 · A paragraph ending in a page break left an empty line and space-before on the next page
- **Root cause:** the paragraph mark after the break was laid out as an empty line at the top of the next page, and the next paragraph kept its space-before (≈ 40 pt drift on the formatting sampler).
- **Fix:** `paragraphBoxes` emits a zero-height `breakMark` box for that empty remainder; the page loop starts the new page, counts it as content (two breaks still make a blank page) and starts the next paragraph like a page filled by flowing text (no space-before) — Word 2013+ behaviour.
- **Tests:** "a paragraph ending in a page break leaves neither an empty line nor space before…" (also checks the blank page between two breaks). **Output validation:** formatting sampler LIMITED → PASS (median 0.9 pt). **Review result:** APPROVED.

### W2P-06 · Line height taken from the substitute font
- **Root cause:** Cambria, Georgia, Verdana, Tahoma and Segoe UI are drawn with a bundled substitute whose ascent/descent differ; Word spaces lines by the requested font.
- **Fix:** `fonts.ts` `VERTICAL` table + `verticalMetrics(fontName)`; `FaceStyle.vm`; `metrics()` uses it when present; `layout.ts` `faceStyle` passes it.
- **Impact:** shared (fonts API, optional field). **Risk:** low. **Tests:** "spaces lines by the requested font's own height…". **Output validation:** transcript (Cambria) median 3.1 → 0.9 pt. **Review result:** APPROVED.

### W2P-07 · (found in this review) Font substitution was silent
- **Defect:** the model records each run's requested font "for reporting substitutions", but nothing reported them; a Georgia/Cambria/Aptos document re-wraps with no warning — a silent fallback the audit contract forbids.
- **Fix:** `fonts.ts` `substitutedFonts(model)` (fonts without a metric-compatible bundled face, on ≥ 5 % of the text, symbol fonts excluded; `forEachText` shared with `collectText`); `index.ts` adds a plain-words note to the result.
- **Impact:** local (one more result note). **Risk:** low. **What could break:** documents using Word's 2007 theme (Cambria headings) or Aptos now show the note — truthful.
- **Tests:** "names the fonts that are drawn with a similar but not identical font"; end-to-end test now expects exactly the Cambria note.
- **Review result:** APPROVED.

---

## Other tools

### IMG-01 · Shrinking photos aliased (Compress Image)
- **Defect:** when a target needs smaller dimensions, the canvas resample used the browser default (`imageSmoothingQuality = "low"`, bilinear without pre-filtering). A 48 MP photo reduced to 36 % scored 25.7 dB PSNR against the source at the same size.
- **Fix:** `image.ts` `drawToCanvas` sets `imageSmoothingQuality = "high"`.
- **Impact:** local (every resize in Compress Image / Image Converter). **Risk:** low (supported by all evergreen browsers; falls back to default elsewhere). **Output validation:** same photo 25.7 → 32.7 dB; because the filtered image compresses better, the search now keeps more pixels (WebP 34 % → 51 % of the original width).
- **Tests:** existing `image.test.ts` / `image-search.test.ts` pass; fidelity run `fid-tools-cimg-dev.json`.
- **Review result:** APPROVED.

### SEC-01 · Critical advisory against the pinned Next.js (found by the regression's `npm audit`)
- **Defect:** `next@16.3.5` is affected by GHSA-vcvr-r3jv-pc5j (remote code execution in `next/og`
  `ImageResponse`); the app uses `ImageResponse` in `src/app/opengraph-image.tsx` and `src/app/apple-icon.tsx`.
- **Fix:** `next` and `eslint-config-next` 16.3.5 → 16.3.8 (patch release, exact pins kept); `package-lock.json`.
- **Impact:** shared (framework). **Risk:** low (patch). **Validation:** `npm audit` 0 vulnerabilities; build,
  tsc, ESLint, 348/348 unit tests; the Open Graph image route returns 200; every fidelity and scenario suite and
  the full Playwright run were executed on the 16.3.8 production build.
- **Review result:** APPROVED.

---

## Final fidelity closure (after commit c277426)

### FONT-01 · Georgia, Cambria and Verdana drawn with fonts of the wrong widths
- **Defect:** the Georgia two-column report re-wrapped (61 % / 54 % of lines broke where Word's do; median
  shift 36 pt; FAIL). Georgia and Cambria were drawn with Liberation Serif (0.914 / 0.946 of their widths) and
  Verdana with Liberation Sans (0.869 — 13 % narrow).
- **Root cause:** the family mapping (`parse.ts` `familyFor`) only knew four open families; it sent every serif
  to Liberation Serif and every unknown sans to Liberation Sans, whatever their widths.
- **How the stand-ins were chosen (not by name):** advance widths of each candidate were measured against the
  Microsoft font installed on Windows 11 over 3,743 characters of English text in all four styles.
  Gelasio = Georgia exactly (1.000 ×4). Caladea, documented as Cambria-compatible, measures 0.953–0.987
  against today's Cambria 6.99 — closer than Liberation Serif in 3 of 4 styles, so bundled but *not* claimed
  as exact (the substitution notice stays for Cambria). DejaVu Sans (already shipped as the symbol fallback)
  measures 0.991–1.002 against Verdana. Tahoma stays on Liberation Sans (0.995 / 0.938, the closest).
- **Files:** `public/fonts/word/{gelasio,caladea}-{r,b,i,bi}.ttf`, `dejavu-{i,bi}.ttf` (new, unmodified
  upstream files), `LICENSE-{Gelasio,Caladea}-OFL.txt`, `README.md`; `model.ts` (`Family` + gelasio, caladea,
  dejavu), `parse.ts` (`familyFor` — exact names first, exported for tests), `fonts.ts` (`METRIC_COMPATIBLE`,
  Cambria's measured vertical metrics 1946/455, comments), `pdf-to-word/extract.ts` (`wordFontName`: Gelasio →
  Georgia, DejaVu Sans → Verdana, so PDFs made with the stand-ins ask Word for the right font);
  `qa/THIRD_PARTY_LICENSES.md`.
- **Font loading architecture:** unchanged — faces are fetched from `/fonts/word/<family>-<variant>.ttf` only
  when the document uses them (`collectStyles`), subset-embedded by pdf-lib; no CDN. A Georgia document now
  downloads ~620 KB of Gelasio instead of Liberation Serif.
- **Licences:** SIL OFL 1.1 (Gelasio, Caladea), Bitstream Vera/DejaVu (DejaVu); `fsType` 0; no Reserved Font
  Names; licence texts shipped beside the files. PASS.
- **Risk:** low (new families only for the named fonts; others unchanged). **What could break:** a Georgia
  document now uses Georgia's own line height with Gelasio's glyphs (Gelasio's ascent/descent are taller; the
  `VERTICAL` entry keeps Word's spacing).
- **Tests:** `word-to-pdf.test.ts` "draws each common Word font with its measured stand-in, and every family
  is bundled in four styles"; "names the fonts…" (Georgia no longer named, Cambria/Tahoma still are);
  `layout.test.ts` "maps the open stand-ins back to the Word fonts they match".
- **Validation:** Georgia report: 36/36 and 16/16 lines break where the reference breaks (was 61 % / 54 %),
  median shift 2.4 pt, PASS; Gelasio embedded.
- **Review result:** APPROVED.

### W2P-08 · Lines measured narrower than they are drawn (kerning on one side only)
- **Defect:** in the brochure, a 245.5 pt line was laid into a 244.8 pt column ("…revised travel policy"),
  overflowing by 0.7 pt and breaking every following line differently from Word/LibreOffice.
- **Root cause:** `fonts.ts` measured text with fontkit's default layout (kerning applied) while pdf-lib draws
  glyphs at their plain advances (no kerning). Word also leaves kerning off for body text by default.
- **Fix:** measure with `layout(text, { kern: false })` — measured width now equals drawn width exactly.
- **Risk:** low (lines can only get slightly shorter → wrap a word earlier where they used to overflow).
- **Tests:** "a line is measured exactly as wide as pdf-lib draws it" (Carlito, Gelasio, Caladea Bold; fails
  without the fix — mutation-checked). **Validation:** brochure 25/29 → 29/29 lines break identically.
- **Review result:** APPROVED.

### W2P-09 · Columns of a continuous section started at different heights; previous spacing lost
- **Defect:** in a continuous two-column section, column 2 started ~10 pt above column 1's first line (brochure,
  two-column report). Investigated directly in the layout math, not assumed to be LibreOffice's fault.
- **Root cause (ours):** at a continuous break the section's region began at the previous line's bottom; column
  1's first paragraph then added only its own space-before (`beforeOf` ignores `prevAfter` at a column top),
  and column 2 restarted at the region top with no spacing at all. The previous paragraph's space-after was
  dropped whenever it was the larger of the two. Also, the next section started at the bottom of the *last
  column filled*, which could overlap a longer first column.
- **Fix:** `layoutDocument` — a continuous section's region starts at the previous bottom + max(previous
  after, first before) (Word collapses adjacent paragraph spacing; a continuous break doesn't reset it); every
  column starts there and the first paragraph doesn't add its space-before again (`atTopByOverflow`). The
  section's end is the lowest point any column reached (`regionBottom`).
- **Risk:** medium (every continuous section). Single-column continuous sections now also collapse spacing
  correctly. **Tests:** "starts both columns of a continuous section below the spacing…", "starts the next
  section below the longest column…" (both fail on the old code — mutation-checked).
- **Validation:** brochure column 2 start 10 pt → 0.4 pt from the reference; report-two-column both columns
  within 0.8 pt.
- **Remaining difference (renderer-specific, LIMITED):** the brochure's last table row in column 1 is 13.3 pt
  tall in LibreOffice and 20.4 pt in ours. LibreOffice's own identical rows in column 2 are 20.4 pt (text 13.8
  + 6 pt paragraph spacing + 0.5 pt border), the row fits above the margin with 8.8 pt to spare, and nothing
  in the markup shortens it — LibreOffice shortens only the row that ends a column. Ours is consistent with
  every other row. No automated Microsoft Word render (Word is installed but unlicensed; automation hangs), so this stays LIMITED rather than PASS.
- **Review result:** APPROVED.

### OCR-01 · Exported scans weren't searchable
- **Defect:** OCR recognised 100 % of words, but the exported PDF only carried text for *corrected* words.
- **Root cause:** the export never received the recognition results (`ocrResultsByPage` lives in editor state);
  `buildSearchablePdf` existed but was unused — and reviewed as unsafe to reuse: it drew every line along the
  page's unrotated x-axis (wrong on pages shown rotated), dropped a whole line on one unencodable character,
  and knew nothing of corrections (old and new words would both be searchable).
- **Fix:** new `src/lib/editor/searchLayer.ts`: `applyCorrections` (the corrected word nearest the correction's
  position, only within its own line — now shared with the editor's search), `correctionsInLayer` (decided
  before drawing), `drawOcrTextLayer` (each line as fully transparent text in the line's own frame via
  `contentFrame` and the rotation the page was *read* at, sized to span the line; unencodable characters →
  "?"; lines lying over the page's own text are skipped). `export.ts` takes `ocrResultsByPage` (and a
  native-text lookup, pdf.js by default) and draws the layer; a correction contributes searchable text exactly
  once — in the layer if it's a raster patch, as its visible text otherwise (this also removes an old
  duplicate: the visible fallback text plus its own hidden run). `ocr.ts` records the read rotation;
  `buildSearchablePdf` removed. Callers: the editor's Export and the bake-then-reload used by watermark/page
  numbers (which used to drop recognised text). Fixed a stale-closure bug found by ESLint: the export callback
  didn't depend on `ocrResultsByPage`.
- **Rotation handling:** OCR reads a page as displayed (`effectiveRotation`); the layer text is turned by that
  rotation in the page's own space, so it reads along the scan in every viewer whatever /Rotate says.
- **Risk:** medium (export pipeline). Pixels: the text is drawn with opacity 0 — measured 0.000 % changed.
- **Tests:** `searchLayer.test.ts` (6): nearest-occurrence correction; recognised lines searchable with the
  corrected word in its new form, the old absent and the new found once; visible-text corrections found once;
  mixed page — no duplicate of native text; no OCR → no layer; rotated page — text runs along the scan.
- **Manual / output validation:** `qa/scripts/fid-tools.mjs ocrsearch` through the real editor: clean,
  low-resolution, rotated (/Rotate 90), mixed native + scanned, 3-page and the user's scan — 100 % of words
  searchable, no duplicates, corrected word found once / old gone, 0.000 % pixels changed outside the
  correction, page counts kept.
- **Review result:** APPROVED.

---

## Scanned PDF → Word reconstruction (after commit 69c8a27)

**Correction to the previous report.** It said "Microsoft Word reference available: NO". That was wrong:
Microsoft Word (Office16, `WINWORD.EXE`) is installed. It runs as an *unlicensed product* and COM automation
(`qa/validate/wordrender.ps1`) hangs on export, so no automated Word render could be made. All renders below
are LibreOffice (independent of our code); **Word fidelity must still be confirmed by opening the DOCX in Word
by hand.** Nothing here claims Word fidelity.

### Why structure was lost (SCAN-01)
On a scanned page the old pipeline had only OCR words. Everything else on the page — rules, underlines,
boxes, table grids, shading, bold — exists only as pixels, and nothing looked at the pixels:
- **rules/borders:** never detected → every line, box and table border vanished (user scan: 0 % of rules);
- **tables:** the grid lines were read by OCR as characters ("ER / CC / CS / TR", "= ee") and the cell text
  around them lost or garbled; a table without lines can't be recognised from words alone;
- **typography:** sizes came from OCR box heights (which depend on the letters, not the size) and every word
  was regular → body text, labels and titles came out at random sizes;
- **noise:** speckle read as words was written as text.

### Architecture (staged)
`extract.ts` classifies each page (`readPage`: text / scanned / blank — text pages keep the native pipeline).
A scanned page then goes through:
1. **render** at 3 px/pt (216 dpi; was 2 — at 144 dpi body text is ~9 px x-height and the recogniser misses
   and misreads words);
2. **pixel layout analysis** (`scan.ts`, pure, unit-tested on synthetic rasters): rules, solid bands, enclosed
   tints (below);
3. **OCR preparation:** light-on-dark bands made dark-on-paper (`invertBars`), tints flattened to paper
   (`flattenFills`), rules erased (`eraseRules`) — so the recogniser reads the words, not the grid;
4. **OCR** (local Tesseract, with each word's line and each line's baseline);
5. **assembly** (`scanPage.ts`): noise filter, baselines per visual row, typography from widths, bold per
   phrase, words joined into runs, rules/fills/bands mapped to page space, hybrid crops, ink accounting,
   strategy choice;
6. **semantic reconstruction** (`layout.ts`, shared with native PDFs): page frame → page border, grids →
   Word tables, rows of label/value → borderless tables or tab stops, rules → paragraph/cell borders or rule
   paragraphs, tints/bands → shading;
7. **DOCX generation** (`docx.ts`) and **validation** (`verifyDocx`; QA adds python-docx, mammoth, an
   independent LibreOffice render and the visual diff).

### Layout and table detection (`scan.ts`)
- **Rules:** runs of ink ≥ 36 pt (horizontal) / 14 pt (vertical) collected at a permissive level
  (paper − 20, each pixel averaged with its neighbours along the line so noise doesn't break a faint line;
  3 px gaps bridged), stacked into strokes. A stack's **dark cores** (rows darker than halfway between its
  darkest row and the paper) are the lines — a line bordering a tinted row stacks with the tint, and one stack
  can hold several lines. A core must be thin (≤ 3.5 pt), stand alone (neighbours lighter than the core on
  60 % of its length), be dark along its whole length (median contrast ≥ 25, ≥ 80 % covered) and — when
  vertical and shorter than 48 pt — meet horizontal rules at both ends (a box side, a cell wall; alone it is a
  letter stem of large bold type). Colour = darkest third; **weight** = ink mass ÷ contrast (a blurred grey
  1 pt line is rebuilt as 1 pt of that grey, not a pale hairline), snapped to Word's border widths.
- **Bands** (`solidBars`): flat dark rectangles ≥ 60 × 8 pt on a 4 px grid (a cell must have dark
  neighbours both across and along, so a table's rules don't join a band to its table); colour variance
  rejects photos. A band crossed by a table's verticals becomes that table's header row (its edges join the
  grid).
- **Tints** (`enclosedFills`): colour inside each rule-bounded rectangle vs the paper (≥ 10 levels).
- **Tables:** grids (≥ 2 h × ≥ 2 v rules) become Word tables with real borders; cell text keeps its own tab
  stops and position (padding carried as space-before so LibreOffice and Word agree); a fill-in line under a
  value in a label/value table becomes that cell's bottom border.

### Text assembly (`scanPage.ts`)
- **Noise:** confidence < 25, or < 45 with < 3 letters / mostly symbols → dropped (reported, never written).
- **Baselines:** each OCR line is split into visual rows (parts > 3 em apart — a left address and right invoice
  details are read as one line); a row uses the recogniser's baseline when it crosses most of its words, else
  the median of the words' box estimates; outliers within 0.75 em snap (box bottoms are stretched by stray
  marks).
- **Typography:** font family and size from word *widths* (advance widths of metric-compatible open fonts:
  Liberation ≙ Times/Arial/Courier, Gelasio ≙ Georgia, Carlito ≙ Calibri, Caladea ≙ Cambria; the family with
  the least size scatter over the page wins). **Bold** per phrase: stroke width − ½ pt blur ÷ (size), > 1.3 ×
  the page's median.
- **Runs:** neighbouring words of one style join into one run (as a native PDF gives it) — without this, the
  aligned word gaps of justified text were taken for a column gutter.

### Hybrid fallback and confidence thresholds (`SCAN_THRESHOLDS`)
| Threshold | Value | Effect |
|---|---|---|
| noiseConfidence / hardNoiseConfidence | 45 / 25 | OCR fragments dropped |
| regionConfidence | 60 | a ruled region whose words average below → kept as a picture of the region (hybrid) |
| graphicWordConfidence | 70 | words below don't explain ink; ink clusters ≥ 24 × 12 pt nothing explains (stamps, signatures, logos) → pictures, the garbage OCR made of them dropped |
| pageConfidence / pageInkExplained | 50 / 0.45 | page kept as its image behind invisible text (visual fallback) |
| boldRatio | 1.3 | bold phrase |
The strategy is chosen per page and reported (`strategies`, `scanReports`); the UI only says "Convert to
Word" and shows the stages (Analyzing → Detecting layout → Recognizing → Building → Validating).

### Layout fixes found by the scanned suite (also affect native PDFs)
- paragraph line pitch is the paragraph's *mean* baseline gap (median drifted with OCR jitter);
- a rule is a paragraph's bottom border only if no other text lies between them (a title took the address
  line's rule);
- a single-line paragraph's border runs exactly from the rule's start to its end (indents + first-line
  indent keep the text in place);
- a ruled table's outer border lies half outside its lines (accounted, ~1 pt per table of drift removed);
- a free rule paragraph reserves 1 pt + the border (was 1 pt + half);
- a borderless table's last left-aligned column runs to the text edge (values set a little wider no longer
  wrap and push the page down);
- a column gutter needs continuous running text on both sides (an invoice's item table is not two columns).

### Visual diff system (`qa/validate/scanform.py`, `qa/scripts/fid-scans.mjs`)
Original and LibreOffice render at 110 dpi, compared without trusting text layers: words in place (a rendered
word's box must hold original ink, IoU ≥ 0.35), words without ink (garbage), rules kept (long dark lines at the
same place ± 4 pt), typography (glyph-height ratio, rule pixels excluded), text recall against the native
original (`--ref`), plus document-specific structure checks (`expect.json`: same line, boxed, order, table
cells, near top). Writes `original-page-N.png`, `word-page-N.png`, `diff-page-N.png` (red = original only,
blue = Word only, black = both). Known gap: rules lighter than the ink threshold (≈ paper − 60) aren't
measured by `rules kept` (the transcript's grey grid shows "n/a").

### Regression risks and performance
- **Native PDFs** go through the changed layout rules above — re-run of the full PDF → Word suite: see the
  final report.
- **Rule detection** is now permissive-then-validated; a page of dense hatching could still yield short false
  rules (they need ≥ 36 pt, thin, standing alone, dark along their length).
- **Typography** is width-based: an unusual font is mapped to the nearest of six families by width.
- **Performance:** rendering at 216 dpi makes OCR ≈ 2.2 × slower per page than at 144 dpi (user scan: ~10 s
  for 2 pages on this machine); pixel analysis is linear in pixels (+ the 4 px grid). The UI stays responsive
  (work runs between progress updates; no freeze observed).

### Tests (each fails on 69c8a27 — verified in a worktree of that commit)
`scan.test.ts` (16, the module doesn't exist at 69c8a27): rules found / text strokes ignored; blurred grey line
rebuilt at weight and darkness; title + rule; label/value aligned with its underline; sentence rule kept;
boxed date row one row in its border; 4 × 3 table with borders; label/value rows aligned; OCR noise dropped;
order + file check; hybrid table picture; visual fallback (invisible text over image); dark band found and
inverted; banded/tinted table keeps every line; faint grey line found whole; justified line joined (no
false columns). `layout.test.ts` (+5) and `docx.test.ts` (+2): page border, free rule, border snapping,
sparse-column table rejected, boxed-row tabs / space before, pgBorders / rule paragraph / cell tabs, w14
transparent text — all 7 fail on the old code, and the scan suite fails to load there.

---

## Scanned PDF → Word generalisation pass (after commit 519ce0d)

Goal: the three classes that still failed (form, invoice, two-column report) fixed **generically**, checked on
ten new variants made for this pass (SCAN-WORD-10 … 19: simple / check-box / mixed forms; simple / both-sides /
dense invoices; text / chart / column-heading / spanning-heading two-column reports), without regressing the
user's scan or the fixtures that passed. Result (production build, real `/pdf-to-word`, LibreOffice render,
`qa/evidence/fresh/fid-scans.json`): **17 PASS · 1 LIMITED · 0 FAIL** of 18 (was 2 / 3 / 3 of 8). User scan:
17/17 structure checks, desktop and mobile, 0 uploads. **Microsoft Word: not automated (installed but
unlicensed; COM automation hangs) — manual review package in `qa/manual-word-review/`.**

### Defects found and fixed (each with a test that fails on 519ce0d unless marked *guard*)
| # | Defect (class) | Fix (where) |
|---|---|---|
| G-01 | Fill-in lines after labels became stacked rule paragraphs (forms) | `layout.ts` `fillInBlanks`: a rule that starts just after text on its baseline, with no text over it, is a leader piece → a Word tab stop where it started (`leadGap`) and a right tab with an underscore leader where it ended |
| G-02 | Check boxes read as "[J" or dropped (forms) | `scan.ts` `checkBoxes` (two straight sides of equal height joined by straight top and bottom, square corners, a thin stroke under ⅕ of the side, ink inside = checked) and `eraseCheckboxes` before OCR; `scanPage.ts` places ☐ / ☑ on the label's baseline at its size; `layout.ts` a box starts its own tab-stop cell (`optionStart`, `afterBox`) |
| G-03 | Section bars were paragraph shading one line high (forms) | `scan.ts`: a standalone band gets its four edges in its own colour → a one-cell shaded table of the band's height |
| G-04 | Side-by-side blocks on different baselines interleaved and stacked (invoices) | `layout.ts` `sideBySide`: a run of same-size lines split by a ≥ 3 em gutter that no text crosses, whose sides don't pair row by row where both have text → a borderless 1 × 2 table, each cell with its own pitch and alignment |
| G-05 | A recogniser line's baseline belonged to the other block read in the same line | `scanPage.ts`: a row uses that baseline only when it lies in the bottom 35 % of most of its words' boxes, else the median of its lettered words (symbols such as "*" float) |
| G-06 | Rows ruled by horizontal lines only were never tables (dense invoice) | `layout.ts` `findGrids`: 3+ lone lines of one extent, evenly stacked → a rows-only grid; its columns from merged text extents, pieces that no row shares merged (a header over right-aligned amounts), edges aligned to the column's text |
| G-07 | A dark band over such rows became a separate box | `scan.ts`: a band on a stack of row lines of its width gives its top and bottom edges to the rows (the header row) |
| G-08 | Bold Georgia headings read as regular, ~19 % too large (two-column) | `scanPage.ts`: x-height (cap height for capitals) measured from the ink, pooled per family × size class; bold when the bold widths' size fits it within 5 % and the regular widths' misses it by > 10 % (margin ≥ 7 points). Font x- and cap-heights come from the bundled fonts' OS/2 tables (`HEIGHTS`, generated) |
| G-09 | A column section's right column started high by the section's own spacing | `docx.ts`: the section's space-before is added to the right column's first block; a spaced first block gets its column break in a 1 pt paragraph of its own (a paragraph that starts with a break takes its space-before in the column it leaves) |
| G-10 | Chart axes left as rules beside the chart picture | `scanPage.ts`: a graphic's crop takes in lines touching it (up to 1.5 × its size) |
| G-11 | Column edges exactly at the longest line wrapped last words | `layout.ts`: each column's edge chosen inside its own range — past its longest line, short of its wrap bound (justified text: at the line); the right column's edge moves the page's text edge when needed |
| G-12 | A rule across the gutter didn't separate column stretches | `layout.ts`: such rules are band cuts (the cut list carries its spanning entry, if any) |
| G-13 | Low-confidence rows, words and unread display text lost or garbled (all) | `ocr.ts` `refine`: rows averaging < 70 re-read as one line (kept when clearly better and no fewer words); unread text-shaped ink re-read (kept at ≥ 80); single words < 60 re-read (kept when of similar length). Measured: "Tact" → "Issue"; the caption "figure. siuyey counts by aie" → "Figure 1. Survey counts by site."; the "INVOICE" title recovered |
| G-14 | OCR "&#124;" for a capital I; lone symbols; 2-letter specks | `scanPage.ts`: a "&#124;" as tall as the capitals beside it at the start or end of a word run → "I"; symbols kept only between words; 2-letter words need ≥ 40 confidence |
| G-15 | A borderless table's rows all one height (a heading row followed by more space) | `layout.ts`: each row as tall as its baseline gap to the next |
| G-16 | Cambria sized ~5 % large | Caladea is not width-compatible with the Cambria that Word ships (6.4 % / 3.9 % narrower, measured); `gen-font-widths.py` scales its table by the measured ratio (one number per style; no Cambria data copied) |
| G-17 | A cell of several lines used the table's pitch (a shaded panel) | `layout.ts` `gridTable`: a multi-line cell keeps its own baseline gap |
| G-18 | A value's fill-in underline went to the label's cell | `layout.ts` `underlineCells`: the column the line mostly lies under |
| G-19 | A header set at the left over right-aligned amounts was aligned right with them (rows-only tables) | `layout.ts` `gridTable`: a right-aligned column after a left-aligned one starts at its leftmost text (its header) when that is nearer than the middle of the gap |
| — | *guards*: a line under a value stays its underline; rows that pair stay an ordinary borderless table | pass before and after (no over-reach) |

QA-harness fixes (they mis-graded the product; none loosens a bar): a word's original extent is measured on
the text line that best overlaps the rendered word (the padded box caught the next line's ascenders and
inflated heights); 1–2 character words are judged by centre distance (a few-pixel box loses its IoU to a 1 px
offset); light-on-dark text is measured as light pixels; text recall is measured on the render (list numbers
and page-number fields aren't XML text runs); leader underscores are never words; grades are per dimension
(TEXT, LAYOUT, TABLES, BORDERS/RULES, FORMS, IMAGES, TYPOGRAPHY, READING ORDER) and any FAIL fails the fixture.

### Review for generality
- **Fixture-specific constants:** none. No coordinate, page size, text or fixture name appears in product
  code; every new rule was checked on at least two fixtures of its class and on the user's scan.
- **Magic pixel thresholds / DPI:** distances are points × `pxPerPt` (pixels) or em of the text's own size
  (layout): check box 5–18 pt, band ≥ 60 × 8 pt, gutter ≥ 3 em, baseline snap 0.75 em, x-band −½ px for
  anti-aliasing. The only raw pixel constants are in `ocr.ts` (unread text 20–150 px), tied to `OCR_SCALE`
  (3 px/pt, ≈ 7–50 pt). Ratios (⅕ stroke, 35 % density, 5 % / 10 % fits) are scale-free.
- **Quadratic loops:** `findGrids` (rules²) and the new lone-line stacking (lone lines²): tens of rules per
  page. `sideBySide` scans each line's gaps once per start line (lines × gaps). The symbol / "I" checks scan
  the words per symbol (few symbols). `checkBoxes` and `unreadText` are flood fills, linear in pixels / cells,
  with an early exit for pieces larger than a box. No pass is quadratic in pixels.
- **Duplicated grouping logic:** visual rows (words < 3 em apart within a recogniser line) are computed in
  `ocr.ts` (re-read) and in `scanPage.ts` (baselines): the same rule on different data (pixels vs page
  points), kept separate on purpose so the OCR module stays independent of PDF → Word.
- **False-positive columns:** a gutter still needs running text on both sides; the column edge now comes from
  each column's own lines; a justified paragraph's word gaps never form a gutter (words are joined into runs).
- **False-positive lines and boxes:** a check box needs square corners and a thin stroke (the "Q" of "Quay" was
  rejected only by the stroke test — measured); no false box on any fixture or on the user's scan.
- **Fallback quality:** the contract is unchanged — a region read badly stays a picture (stamp, signature,
  chart); text is recovered from it only when read at ≥ 80 confidence.
- **Memory / performance:** extra per page: one luminance copy (`textLum`) and a cell grid. Measured on the
  production build (`fid-scanperf.json`): 2 pages 6.6 s, 5 pages 32.5 s, 10 pages 51.4 s (3.3–6.5 s per page;
  the re-read adds at most 60 reads per page). The longest main-thread task was 0.6 s (one page's pixel
  analysis) and progress updates every page — no freeze. Moving pixel analysis to a Web Worker would remove
  the 0.3–0.6 s pauses; not done in this pass.

### Remaining limitations (honest)
- Transcript (LIMITED): bold term headings with digits ("Autumn 2024") are measured as regular and come out
  2–3 pt large; a recognised "I" may sit a few points right of the original.
- Bold by stroke weight still marks a few short regular words bold (a table cell): the ratios overlap (real
  labels 1.26–1.48 × the page's reference, false ones 1.37–1.46).
- Pixel analysis runs on the main thread (pauses of up to 0.6 s per page).

---

## Conversion semantics pass — conversion is not OCR (after commit 89d9271)

**The mistake being corrected.** The previous two passes made scanned PDF → Word *better at rebuilding text*
(tables, rules, boxes, typography from OCR). For a passport, an application, a certificate, an invoice, a
statement or a signed contract that is the wrong goal: a normal person expects the page to look like their page.
The default for a scanned page is now **visual preservation** (the page itself goes into Word as a picture at the
source size); OCR may only *judge* a plain scanned letter, and hybrid editable text is accepted only when the
reading is extremely reliable. Product contract: `qa/CONVERSION_SEMANTICS.md`; evidence:
`qa/REAL_USER_PRODUCT_AUDIT.md`.

### Every conversion path, reviewed for the five questions

| Path | OCR called automatically where it shouldn't be? | Extraction replacing visual conversion? | Unnecessary rasterization / recompression? | Desktop vs mobile | Unexpected fallbacks |
|---|---|---|---|---|---|
| PDF → Word, native/mixed page (`extract.ts`, `layout.ts`, `docx.ts`) | No — never reaches OCR | By design (native text is the content), verified text recall 100 % | None: pictures kept as their own bytes | Same code, same strategies (audit: mobile = desktop) | A page that can't be rendered fails with a message; no silent downgrade |
| PDF → Word, scanned page | **Only** for class `SCANNED_TEXT` (plain running text) to decide hybrid vs visual; forms, IDs, certificates, tables, photos never reach it (audit: 0 OCR requests) | **Fixed** (was the defect): default is the picture; OCR text is shown only after `hybridDecision` passes for the whole document | The page is rendered once (≤ 200 dpi, ≤ 5000 px side) and encoded JPEG q92; **fixed:** PNG is used only when smaller than the JPEG (a faint-noise scan was written as a 3 MB PNG, 3.4 MB DOCX for an 856 KB PDF → 0.85 MB) | Same | If OCR itself can't load, the page stays visual (the safe default) |
| Image → Word (`image-to-word.ts`) | No OCR code path | No — image is the content | JPEG/PNG bytes untouched (`prepareImageForPdf`: only sideways JPEGs redrawn, WebP → JPEG/PNG) | Same | Unreadable image → named error, no partial file |
| Image → PDF (`pdf.ts`) | No | No | JPEG byte-for-byte, PNG lossless | Same | — |
| PDF → Image | No | No — a render | One render at the requested scale | Same | — |
| Word → PDF (`word-to-pdf/*`) | No | **Not extraction:** our own layout engine renders the .docx XML to vector text + pictures; not Word's engine (documented) | None | Same | Font substitution and unsupported pictures are reported in notes |
| Compress PDF / Image, Merge, Split, Organize | No | No | Compress re-encodes images by design; the others copy pages untouched | Same | Compress states a missed target |
| PDF Editor — Recognize text | **Only when the user presses it**; export adds an invisible layer | n/a (explicit feature) | Pages untouched | Same | — |

OCR call sites (complete list, `grep createOcrSession|recognizePage`): `pdf-to-word/extract.ts` (judging
`SCANNED_TEXT` pages only) and the editor (`useEditorWorkspace`/`PageSurface`, on user action).

### Defects found by the real-user audit and fixed (each with a regression test or audit check)

1. **Scanned pages became text by default** (the whole point of this pass) — `classify.ts` + `extract.ts`; `classify.test.ts` (24), `docx.test.ts` (picture-only pages), e2e `pdf-to-word-ocr.spec.ts`.
2. **PNG chosen for a "few-colour" scan** (colour test is coarse; faint scanner noise makes the PNG huge) — `encodePagePicture` now keeps the smaller of the two; audit check `weight` (≤ 1.2 MB/page). Signed contract DOCX 3.39 MB → 0.85 MB; the user's scan 3.89 MB → 0.33 MB.
3. **Native page overflowed onto a second page** (brochure: a shaded call-out near the bottom edge plus a few points of line-height drift) — bottom-margin slack 10 pt → 20 pt in `layout.ts`; audit check `pagesKept`.
4. **Tesseract printed "Estimating resolution as N" to the console** on some scans — `ocr.ts` now passes the real render density (`user_defined_dpi`); audit: 0 console errors; OCR accuracy unchanged on the OCR suites.
5. **Editor corrected native text as black-on-white** even on a dark band (résumé header: a white box with black text over white-on-dark-grey) — colours are now read from the page (`regionColor.ts` `legibleOn`, `PageSurface.tsx`, `export.ts`, `ObjectView.tsx`); `regionColor.test.ts`; audit check `cover differs from the background by ≤ 30/255`.
6. **A poster-size scan could request a canvas beyond browser limits** — page picture capped at 5000 px on the long side.
7. **A table swallowed the heading underlines above it, and was drawn with sides** (native résumé: the EDUCATION line and the SKILLS heading ended up inside the skills table, which got full gridlines although the source only has light row lines) — rows-only table detection now requires the stacked rules to look alike (same stroke), and such tables are written with horizontal lines only (`rowsOnly`); tests in `layout.test.ts` and `docx.test.ts`; audit checks `readingOrder`, `fillsKept` (page tone).
8. **Stale e2e expectations** (`pdf-to-word.spec.ts` copy, OCR spec asserting recognised text) — rewritten to the new contract; `readDocx` counts anchored pictures and page sizes.

### Review for generality / risks

- The class decision uses measured signals, not file names or fixture shapes. Thresholds are in one place (`classify.ts`), each with a test.
- `quickSignals` runs before rendering, so a 100-page native PDF never rasterises a page.
- Hybrid is all-or-nothing per document to avoid a Word file where page 1 is text and page 2 a picture of the same kind of page.
- Known cost: a plain scanned letter runs OCR once to be judged (≈ 10 s per page); a 2-page letter-like contract took 22 s. Forms/IDs/tables are instant (~1.2 s).
- Not verified in Microsoft Word (cannot be automated here): the picture-only pages use a full-page anchored picture behind an empty paragraph; manual review checklist in `qa/manual-word-review/README.md`.

## Investigated, not product defects (kept for the record)

| Symptom | Finding |
|---|---|
| Organize: drag-reorder "stopped working" after deleting a page | Deleting page 10 scrolls the page down 772 px; the QA script then pressed outside the viewport. With the cards on screen the drag works (pixel-identical output). Script fixed. |
| Compress Image: halving a 500 KB JPEG resized it to 59 % | The synthetic test photos are noise-dominated: even quality 40 at full size is 535 KB (> 250 KB target), so shrinking is required; the UI states "resized to 59 %". Graded LIMITED (disclosed resize), not FAIL. |
| Word → PDF two-column report re-wraps | Real Georgia is ≈ 10 % wider than the bundled serif; same column split, figure and headings. Font coverage limitation; now announced to the user (W2P-07). |
| Word → PDF brochure: picture 9 pt right, column 2 starts 10 pt lower than LibreOffice | The markup is a plain inline picture with no indent; Word places it at the column edge as we do. LibreOffice-specific; not imitated. |
| React "state update on a component that hasn't mounted" | Seen once while source files were being edited (dev-server hot reload during the run); 0 console errors in all later runs, desktop and mobile. |

QA-harness defects fixed along the way (they would have mis-graded the product): recall under-counted when a
repeated header paired across pages (`layoutdiff.py`); table grading by renderer-dependent vector-line counts
replaced by geometric rule coverage (`rulesKept`); fixtures made unambiguous (python-docx wrote conflicting
`tcW`/`gridCol` widths, an extra empty section-break paragraph and a table wider than its column); image
comparison now at the output's own size and real (not opaque) alpha only; Images → PDF graded on the picture
stored in the PDF; organize rotation reference rendered by MuPDF itself; the PDF → Word "one section per page"
check now ignores continuous (column) sections, which are how Word itself switches to columns mid-page.

One automated test was made robust, not loosened: `e2e/word-to-pdf.spec.ts` checked that page 1 isn't blank
by sampling every 3rd pixel at half scale (> 50 dark samples). Correct Cambria line heights (W2P-06) moved lines
by a fraction of a pixel and the sparse grid fell to 27 while the page was visually unchanged (verified against
the baseline build: every-pixel count 1,136 before vs. 1,130 after). It now counts every pixel (< 160) and
requires > 500 — a blank page scores 0.

One scenario timed out once and did not reproduce: the Word → PDF → Word journey for WORD-04 waited 60 s for the
Convert button in one run; the rerun passed 24/24, as did the earlier final run.

---

## Shared architecture review

**Duplicated conversion logic.** Word's layout rules now live in two places that must agree: PDF → Word
*writes* DOCX that relies on them (exact spacing, twips, border-in-row-height, max(after, before)), Word → PDF
*implements* them. They agree today and both directions are covered by fidelity runs and round trips, but
there is no shared module. Recommendation (not done — refactor risk outweighs benefit before launch): a small
`word-rules.ts` with `twips()`, `collapseSpacing()`, `rowHeightWithBorder()` used by both.

**PDF parsing.** Three parsers by purpose: pdf.js (text, operator lists, rendering — PDF → Word, PDF → Image,
editor), pdf-lib (page operations, writing), MuPDF/qpdf only in QA. The new operator-list pass in
`extract.ts` reads opcodes by number (pdf.js `OPS`) — tied to pdfjs-dist 6.x; a major upgrade must re-run the
PDF → Word fidelity suite. Unknown operators are ignored, never fatal.

**Coordinate math.** PDF space (origin bottom-left, points) → Word (top-left, twips) conversions are confined
to named helpers (`lineBoxTop`, `lineBoxBottom`, `gridTable` row math, floating `x/y`) and rounded once, in
the writer's direction (`tw`, outward flooring for margins). Rotated pages are unrotated in `extract.ts`
before layout; the rotated fixture passes. Image placement uses the same frame in Images → PDF and the editor
(verified: aspect kept, inside page, 0 % change outside edits).

**Unsafe stream rewriting.** Compress PDF rewrites image streams (`pdf-compress.ts`); the earlier corruption
defect (D1) was fixed before this audit. This audit adds the visual check: 9/9 PDFs, including the user's
scan, are visually equivalent (min SSIM 0.967) with identical page sizes and 100 % text kept. Merge, Split and
Organize copy pages without re-encoding: pixel-identical.

**Validation and error handling.** Every tool's output passes the same integrity gate before any verdict
(`fl-lib.mjs` `rec()`); PDF → Word verifies its own package (`verifyDocx`) and Word → PDF reopens its PDF and
checks the page count before offering a download. Consistent.

**Silent fallbacks.** Found and fixed: font substitution (W2P-07); recognised text silently dropped from exports and from baked whole-document operations (OCR-01). Remaining, all disclosed to the user:
pictures in EMF/WMF (empty frame + note), characters without a glyph (note), text boxes and equations (note),
right-to-left text (note). Compress Image states any resize. Not disclosed: PDF → Word cannot reproduce
text effects such as shadows, outlines or rotated text inside a page (rare; listed as a limitation).

**Format-specific hacks.** None added for LibreOffice. Where LibreOffice and Word disagree (justified text in
compatibility mode 15, the empty section-break paragraph, the brochure's column-2 start) the code follows
Word and the difference is documented. The harness uses LibreOffice only as an independent QA renderer.

**Dead code.** `buildSearchablePdf` in `src/lib/processors/ocr.ts` was unused and, on review, unsafe to reuse
(rotation, unencodable characters, corrections). It has been removed; the searchable layer now lives in
`src/lib/editor/searchLayer.ts`, used by the editor's export (OCR-01).

**Performance notes.** `findGrids` is O(n²) in the number of rules and `findGutter` scans ~100 candidate
x positions × items; both measured fine on the corpus (24-page document converts in a few seconds) but a page
of thousands of hairline vectors (CAD drawings) would be slow. Not changed.
