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
  every other row. Microsoft Word reference unavailable, so this stays LIMITED rather than PASS.
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
