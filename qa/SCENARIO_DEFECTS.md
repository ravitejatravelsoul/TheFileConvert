# Scenario defects — full fresh-launch functional + output-quality audit

Branch `rebuild/fresh-launch`. Every defect below was reproduced before it was fixed. D1–D6, D9 and D10 have regression tests that fail on the old code; D11 (OCR rotation) is verified by the OCR scenario; D7, D8, D12 and D13 are quality/wording fixes verified in the scenario runs.
Evidence: `qa/evidence/fresh/*.json`, full scenario table: `qa/FULL_SCENARIO_ACCEPTANCE.md`.

| # | Severity | Area | Summary | Status |
|---|---|---|---|---|
| D1 | **Release blocker** | Compress PDF (and every tool that loads and re-saves a PDF) | Output under the target but unopenable in Acrobat / Windows / strict readers | Fixed |
| D2 | **Release blocker (class)** | All PDF writers | No output integrity check: a broken PDF could be offered as "Done" | Fixed |
| D3 | **Release blocker (class)** | Merge, Split, Organize, Compress, Editor, OCR export | Encrypted PDFs that open without a password produced blank or unopenable output | Fixed (refused with a clear message) |
| D4 | High | Compress PDF | Duplicate-image merge left references dangling when the duplicate was used from a form XObject / shared resources | Fixed |
| D5 | Medium | Compress PDF | A damaged PDF or a non-PDF named `.pdf` came back as "Already under your target" | Fixed |
| D6 | Medium | Compress PDF | Text-heavy PDFs with uncompressed content streams were never compressed losslessly ("Target not reached" for a 3–6× lossless win) | Fixed |
| D7 | Low | Image Converter | WebP encoded at 0.92 — converted photos came out larger than their JPEG source despite "Small files" | Fixed (0.85) |
| D8 | Low | PDF → Image | Button read "Convert all 1 pages" for a single-page PDF | Fixed ("Convert page") |
| D9 | **High** | Images → PDF (+ converter, compressor) | A damaged JPEG became "Your PDF is ready"; a JPEG cut off halfway decodes grey without an error | Fixed |
| D10 | **High** | PDF Editor | Text, pictures and signatures added to a page shown rotated (scan stored sideways with /Rotate, or a page turned in the editor) came out sideways / stretched | Fixed |
| D11 | Medium | PDF Editor OCR | OCR read pages stored sideways without their rotation — 8.9 % word accuracy | Fixed (recognition); word *correction* on rotated pages now refused with a clear message |
| D12 | Medium | Compress PDF | Generous targets still downscaled scans to 2600 px (the user's scan: same 457 KB result for 500 KB, 1 MB and 2 MB targets) | Fixed (full-resolution top rung) |
| D13 | Low | Image Converter | When every file failed, the result said "Nothing to convert" in a success-coloured banner | Fixed |

---

## D1 — Compressed PDF under the target but corrupt (the reported bug)

**Report.** A user compressed a ~3.8 MB PDF to "under 1 MB", got ~480 KB, and the file would not open: "We can't open this file. Something went wrong."

**Reproduction (real browser, real file).** `BASE=http://localhost:3000 node qa/scripts/fl-repro-real.mjs 1000 before` with the user-supplied `TheFileConvert_Scanned_OCR_Test.pdf` (3,982,736 bytes), target 1,000,000 bytes, on commit `3eaae3e`:
headline **"Done — 471 KB"**, output **471,312 bytes**; qpdf: `unable to find /Root dictionary`; MuPDF: `invalid reference to an objstm that does not exist: 14 (1 0 R)`, `Trailer Size is off-by-one`, file had to be repaired. pdf.js and pdf-lib (lenient) still showed it — which is why the app's own checks and the earlier QA passed it. Evidence: `qa/evidence/fresh/repro-before-1000.json`.

**Root cause.** The user's file was edited after it was created (ReportLab original + an incremental update that adds a "content credentials" attachment; the trailer has `/Prev`). The update re-created the catalog as object **7, generation 1**. pdf-lib's writer does not handle objects with a generation above 0: it writes them into object streams (where only generation 0 is allowed) or into the classic xref with the wrong number, so the trailer's `/Root 7 1 R` points at nothing. Both save modes were affected. Every tool that loads a PDF with pdf-lib and saves it again was exposed: Compress PDF, the editor's watermark / page numbers / header-footer, OCR searchable export; copy-based tools (merge, split, organize, images→PDF, editor export) happened to write fresh generation-0 objects.

**Fix.** `src/lib/pdf/load.ts` — `loadPdfForEditing()` is now the only way the app loads a PDF it will modify. It renumbers every generation-above-0 object to a fresh generation-0 number and rewrites every reference to it (all objects and the trailer's Root/Info/Encrypt) before anything else touches the document. Wired into `pdf-compress.ts`, `pdf.ts`, `editor/document.ts`, `editor/export.ts`, `ocr.ts`.

**Verification.**
- Real file, real UI, fixed build: 3,982,736 → **471,193 bytes** with the loader fix alone; on the final build (with D12's full-resolution rung) → **928,322 bytes** — qpdf ✓ (no problems), MuPDF ✓ (no repair, no warnings), pdf-lib ✓, pdf.js ✓, **2/2 pages**, both render, PSNR 50.8 dB / SSIM 0.9985 against the original, target achieved. Evidence `repro-after-1000.json` and the "REAL user scan" rows of the Compress PDF matrix (1 MB → 928,322; 2 MB → 928,322; 500 KB → 457,690).
- Synthetic fixture with the same structure (`PDF-C-scan-3.8mb-incremental.pdf`, catalog re-created at generation 1 by an incremental update) through Compress (2 MB / 1 MB / 500 KB), Merge, Split (every page), Organize, PDF→Image: all outputs pass all four engines.
- Regression tests: `src/lib/pdf/load.test.ts` (renumbering; saved file has no `1 R` refs and reopens in both save modes), `src/lib/pdf/save.test.ts` ("catches the release-blocking bug": the old load+save of a generation-1 file fails `verifyPdfBytes`; the new path passes; compress/merge/extract of it are valid), `e2e/integrity.spec.ts` A/C/D (browser: compress under target → strict xref check passes; merge/split/organize; editor export).

## D2 — No output integrity check before "Done"

**Old behaviour.** Nothing re-read a finished PDF before offering it. D1 shipped because the output parsed in pdf-lib/pdf.js (they scan objects and repair silently) while strict readers use the cross-reference table.

**Fix.** `src/lib/pdf/save.ts` — `savePdfChecked()` replaces every `doc.save()` in the app (compress, merge, split, organize, images→PDF, watermark, page numbers, header/footer, OCR export, editor export). After saving it runs `verifyPdfBytes()`:
- header, `%%EOF`, `startxref` present;
- **reads the final cross-reference section by byte offset, the way Acrobat/qpdf do** (classic table or xref stream, Flate + PNG predictors decoded): every in-use entry must point at `N G obj` with the same number and generation; objects in object streams must name an object stream that exists; `/Size` must cover every object; `/Root` must have a matching entry; no object listed twice;
- re-parses, the trailer must lead to a catalog with a page tree, page count must equal what the tool meant to produce, and no reference may point at a missing object (references already broken in the source are tolerated, new ones are not).
A failure throws `OutputIntegrityError` and the user sees "The result didn't pass our file check, so it wasn't saved…" instead of a broken download.

**Verification.** On the real before/after files: the old 471,312-byte output → 16 problems (`/Size 16 doesn't cover object 16`, `object 1 is in object stream 14, which doesn't exist`, …); the new output → none. Unit tests in `src/lib/pdf/save.test.ts` (old generation-1 save rejected in both modes; truncated/empty/wrong page count rejected). Every scenario output is additionally checked outside the app by the QA validator (qpdf + MuPDF + pdf-lib + pdf.js).

## D3 — Encrypted PDFs produced blank or corrupt output

**Reproduction.** `PDF-Q-owner-password-only.pdf` (PDF-B encrypted with an owner password only, RC4-128 — opens without a password, like many bank statements, tickets and government forms). Node-level through the app's own processors on the old code: `mergePdfs` → 12 pages, **all blank** (qpdf: `errors while decoding content stream`, MuPDF `zlib error: incorrect header check`); `extractPages` → 2 blank pages; `compressPdfToTarget` → **unopenable** (`unable to find /Root dictionary`). AES-encrypted files failed with a raw pdf-lib error ("Expected instance of PDFDict").

**Root cause.** Loads used `ignoreEncryption: true`. pdf-lib cannot decrypt: it copied still-encrypted strings and streams into new files that have no key (merge/split/organize/editor), or re-saved them with the `/Encrypt` dictionary but unencrypted object streams (compress).

**Fix.** `loadPdfForEditing()` refuses any encrypted PDF with `EncryptedPdfError`: "This PDF is protected with a password or encryption, so it can't be changed here. Remove the protection first (for example, print it to a new PDF from your PDF viewer), then try again." The message reaches the user in every tool (`pdf.ts`, editor `document.ts`, `ocr.ts`, Compress PDF shows it as soon as the file is chosen). PDF → Image is unaffected: it renders with pdf.js, which decrypts owner-password files correctly (verified: 6/6 pages rendered).

**Verification.** Error scenarios for every PDF tool with `PDF-P` (user password) and `PDF-Q` (owner password only): clear message, no output. `e2e/integrity.spec.ts` "encrypted PDFs are refused…" (Compress + Merge), `src/lib/pdf/load.test.ts` (owner-only and user-password fixtures refused; merge/extract/compress pass the reason through). New fixtures: `e2e/fixtures/encrypted-owner-only.pdf`, `e2e/fixtures/encrypted-user-password.pdf`.

## D4 — Duplicate-image merge left dangling references

**Old behaviour.** Compress PDF's lossless step merges byte-identical images, but only repointed each page's own `/XObject` entries before deleting the duplicates. A duplicate used from a form XObject (stamps, letterheads, repeated headers), an annotation appearance or a shared resource dictionary was left pointing at a deleted object.

**Fix.** `replaceReferences()` in `src/lib/pdf/load.ts` rewrites every reference in the document (all objects + trailer); the compressor uses it before deleting duplicates.

**Verification.** `pdf-compress.test.ts` "a duplicate used inside a form XObject still resolves after the merge" — on the old logic it fails with `1 reference(s) to missing objects`; on the new logic it passes and the stamp's image resolves.

## D5 — Damaged PDF / non-PDF returned as "Already under your target"

**Reproduction.** Error scenarios: `/compress-pdf` with `PDF-O-corrupted.pdf` (304,848 bytes) and `X-fake.pdf` (text named `.pdf`) — both under the default 1 MB target — produced a result screen "Already under your target" and handed the file back.

**Root cause.** The "input is already under the target" short-cut returned the original bytes without checking that they were a readable PDF.

**Fix.** The short-cut now loads the file first (and requires ≥ 1 page); Compress PDF also reports an unreadable file as soon as it is chosen ("This PDF couldn't be read. It may be damaged, password-protected or incomplete.").

**Verification.** `pdf-compress.test.ts` "does not return a damaged PDF or a non-PDF as 'already under your target'" (and a valid under-target file still comes back byte-for-byte). Browser: error-scenario rows for `/compress-pdf`.

## D6 — Uncompressed text was never compressed

**Finding.** Many producers store page text uncompressed. The compressor only re-encoded images, so a 290 KB text-heavy report could not reach 250/200/150 KB ("Target not reached") although Flate would shrink it ~6× with no visible change.

**Fix.** Lossless step `deflateUnfilteredStreams()` — Flate-compresses every stream stored without a filter (content, fonts, forms, raw images) when that saves ≥ 10 %; XMP metadata stays readable. The pre-compression outlook now says when a file has a lot of uncompressed data.

**Verification.** `PDF-A-text-heavy-300k.pdf` (290,011 bytes): 250/200/150 KB targets → **45,258 bytes**, lossless, 28/28 pages, 88,669/88,669 text characters, PSNR 99 dB (identical render). Unit test "Flate-compresses unfiltered content streams…".

## D7 — WebP conversion larger than the source

**Finding.** Image Converter encoded WebP at quality 0.92, although the option is described as "Small files": `X-portrait-1200x1800.jpg` (705,945 bytes) → 872,256-byte WebP; `IMAGE-E` (14,688,976-byte, very noisy 48 MP JPEG) → 23,897,990 bytes. **Fix:** WebP at 0.85 (visually equivalent to JPEG 0.92; PSNR 37.6 dB vs the source). After: 705,945 → **643,258** bytes. The extreme-noise 48 MP fixture still grows (→ 19,616,272 bytes) — WebP spends bits on sensor-like noise; the converter keeps quality rather than chasing size, and Compress Image is the tool for a size target. JPG output unchanged.

## D8 — "Convert all 1 pages"

PDF → Image showed "Convert all 1 pages" for a one-page PDF. Now "Convert page".

## D9 — Damaged images turned into "successful" outputs

**Reproduction.** Error scenarios: `/image-to-pdf` with `X-corrupt.jpg` (the first 4,000 bytes of a JPEG) → **"Your PDF is ready"** with a broken page. A JPEG cut off halfway (`X-truncated-half.jpg`) is worse: browsers decode it without any error, the missing half grey — so the converter and compressor would have produced a half-grey picture too.

**Root cause.** Images → PDF embeds JPEG/PNG bytes with pdf-lib, which reads only the header and never decodes the data. Canvas decoding (converter, compressor) accepts truncated JPEGs silently.

**Fix.** `src/lib/processors/image-integrity.ts` — `isCompleteImage()` walks the JPEG marker segments to the main start-of-scan and requires an end-of-image marker after it (data after it, e.g. a phone "motion photo" video, is fine), requires PNG's IEND chunk and a WebP RIFF length that fits the file. Used before every decode (`loadBitmap`: converter, compressor) and before every embed (`prepareImageForPdf` also decodes JPEG/PNG first; `imagesToPdf` checks again). Images → PDF names the file: "“X” couldn't be read. It may be damaged — remove it and try again."

**Verification.** `image-integrity.test.ts` (complete files accepted; JPEG cut at 100 B / 3 KB / half / all-but-2 bytes rejected; motion-photo trailer accepted; cut PNG/WebP rejected). `e2e/integrity.spec.ts` E (header-only and half JPEG through converter, compressor and Images → PDF: message, no download). Error-scenario rows for all three image tools.

## D10 — Content added to a rotated page came out sideways

**Reproduction.** `OCR-D-rotated.pdf` (a portrait scan stored landscape with /Rotate 90 — how many office scanners save) in the editor: text typed across the page was shown running **down** the page in the editor and exported the same way; a landscape photo placed on it showed stretched into a portrait box on screen and exported **sideways**. Same for any page turned with the editor's own Rotate button. Before/after renders: `qa/evidence/fresh/out/rot-probe-export-BEFORE.png` / `rot-probe-export.png` (local).

**Root cause.** Objects were drawn in the page's stored (unrotated) frame, so their content "turned with the page": correct for the page's own content, wrong for anything the user adds while looking at the page upright.

**Fix.** `src/lib/editor/contentFrame.ts` — text, pictures, signatures and scanned-word patches carry a content rotation, set to the page's displayed rotation when they are created. Export (`export.ts`) lays text out and draws images in that frame (pdf-lib `rotate`), the editor (`ObjectView.tsx` `ContentLayer`) shows exactly the same, text boxes grow downward on screen whichever way the page is turned (`withContentHeight`). Objects from earlier sessions (no rotation) behave exactly as before.

**Verification.** `contentFrame.test.ts` (for 90/180/270 the content's reading direction is screen-right and up is screen-up; the on-screen box has the content's proportions; growing text keeps its top edge). `e2e/pdf-editor-rotation.spec.ts`: text on a /Rotate 90 page is upright in the editor, its exported text matrix runs along +y and its rendered ink is wider than tall; a landscape photo keeps its proportions on screen and in the export.

## D11 — OCR ignored page rotation

**Reproduction.** OCR scenario `OCR-D` (same sideways-stored scan): **8.9 %** word accuracy (129 garbage words) vs 100 % for the same text on an unrotated page.

**Root cause.** The editor called `recognizePage(…)` without a rotation; the OCR session defaulted to 0, and pdf.js treats an explicit `rotation` as absolute — so the page was rendered in its stored, sideways orientation.

**Fix.** Recognition renders the page as it is shown (`rotate: effectiveRotation(page)`); word boxes are still mapped back to PDF space by the viewport, so search/selection line up. The scanned-word *correction* pipeline (patch padding, baseline and neighbour sampling) works along the unrotated text direction, so on a page shown rotated a click on a recognised word now explains that correcting words there isn't supported yet (add text / signature / whiteout still work) instead of producing a misplaced patch.

**Verification.** OCR scenario `OCR-D` after the fix: **45/45 words, 100 %** (was 8.9 %), 1.9 s. Spanish (`OCR-E`) 100 %, multi-page 100 %.

## D12 — Generous PDF targets still lost resolution

**Finding.** The best rung of the target search capped images at 2600 px, so the user's 2550×3300 scan came back at 457,690 bytes (downscaled) whether the target was 500 KB, 1 MB or 2 MB.

**Fix.** A first rung "maximum quality" (JPEG 0.92, up to 3600 px — full resolution for 300 dpi Letter/A4). The existing bisection then searches between it and the next rung. Browser, final build, user's scan: 1 MB and 2 MB targets → **928,322 bytes** at full resolution, PSNR **50.8 dB** / SSIM 0.9985 (was 457,690 bytes, 31.6 dB / 0.946); 500 KB → 457,690 bytes as before.

## D13 — "Nothing to convert" in green when everything failed

Image Converter with only unreadable files showed "Nothing to convert" on the success colour. Now "This image couldn't be converted" / "These images couldn't be converted" on the danger colour, and "N converted · M couldn't be read" when some failed. The per-file reason is unchanged.

---

## Checked and not a defect

- EXIF Orientation 6 photos: converter, compressor and Images→PDF all output upright images; GPS/camera EXIF is not carried over.
- Unsafe SVG (`<script>`, `onload`, external `<image>`, `<foreignObject><iframe>`, `javascript:` link): converted without running script or fetching any of its URLs (0 requests to the attacker host), no dialogs.
- Transparent PNG → JPG: transparent areas become white (corner pixel 255,255,255), never black.
- AcroForm PDFs through Merge: the page appearance (filled values) is kept; interactive fields are not carried into the merged file — documented limitation (pdf-lib `copyPages` doesn't copy the form).

## Known limitations (not fixed in this change)

- **Encrypted PDFs** (including owner-password-only files that open without a password) are refused by every tool that rewrites a PDF, with a clear message. PDF → Image still works for them (pdf.js decrypts). Decrypting in the browser would need an RC4/AES implementation.
- **OCR word corrections on a page shown rotated** are refused with a message; recognition, text, signatures, pictures and whiteout on those pages work.
- **The editor's export has no searchable text layer for OCR words that weren't edited** — OCR in the editor is for correcting words (corrected words are searchable). Nothing in the product promises a searchable PDF.
- **Merge keeps a form's filled-in appearance but not its interactive fields** (pdf-lib `copyPages` doesn't copy the AcroForm).
- **Floors on target compression**: images aren't shrunk below 480 px on the long side or 35 % JPEG quality, PDFs not below the lowest rung (22 %, 800 px). Targets below that are reported as "Target not reached" with the closest valid file — e.g. a 23,430-byte 480×320 JPEG → 20 KB ends at 20,007 bytes.
- **Image encodings kept as they are** by Compress PDF: JBIG2, CCITT fax, CMYK, indexed and masked images (counted and reported up front).
