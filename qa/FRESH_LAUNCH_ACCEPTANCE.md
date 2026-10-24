# TheFileConvert — First-launch acceptance

Branch `rebuild/fresh-launch` · generated 2026-09-27 by `qa/scripts/fl-report.mjs` from the JSON evidence in `qa/evidence/fresh/`.

**Production was not touched.** Nothing was merged to `main`, pushed, or deployed. Every check below ran against a local server.

## How this was tested

Every row is a real browser session (Playwright Chromium, desktop 1440×900 or Pixel 7 with touch) driving the actual UI:
files are added through the tool's own file picker, options are chosen by clicking/tapping, the result is downloaded
through the real download button, and the downloaded file is then **reopened independently** in Node (pdf-lib, pdf.js
with standard fonts, @napi-rs/canvas) and checked — page counts, text, rotations, crop boxes, pixel colours, image
format, dimensions and transparency, and exact byte sizes.

Verdicts: **PASS** — works and verified; **LIMITED** — behaves correctly but with a real, disclosed limit (e.g. a target
that can't be reached is honestly reported as not reached); **FAIL** — broken.

Totals across the scripted acceptance runs: **58 PASS · 1 LIMITED · 0 FAIL**.

## Fixtures

Generated deterministically by `qa/scripts/fl-fixtures.mjs` (no real documents), plus the user-supplied
`TheFileConvert_Scanned_OCR_Test.pdf` for the real-scan OCR session.

| File | Bytes | What |
|---|---:|---|
| FL-PDF-01-small-text.pdf | 2,542 | 2-page native-text PDF (small) |
| FL-PDF-02-scan-4mb.pdf | 4,630,188 | 3 JPEG scan pages (1700x2200) — ~4 MB class |
| FL-PDF-03-scan-10mb.pdf | 11,106,784 | 3 JPEG scan pages (2550x3300, 300 dpi) — ~10 MB class |
| FL-PDF-04-photo-heavy.pdf | 13,579,528 | 4 pages, each a distinct 3000x2000 photo |
| FL-PDF-05-multipage.pdf | 4,707 | 12 labelled pages ('DOC — Page N of 12', marker DOCn) |
| FL-PDF-06-rotated.pdf | 2,055 | 4 pages stored with /Rotate 0, 90, 180, 270 |
| FL-PDF-07-native-text.pdf | 1,478 | Native-text invoice: 'Jordan Smith', '12/20/2026', 'Consultation', '$1,250.00' |
| FL-PDF-08-scanned-text.pdf | 750,571 | Image-only receipt scan set in Arial: 'Jordan Smith', '12/20/2026', 'Consultation' (no native text) |
| FL-PDF-08b-scanned-condensed.pdf | 715,860 | Hard case: the same receipt set in a condensed face (as many till receipts are) |
| FL-PDF-09a-merge.pdf | 1,705 | Merge set A: 3 pages |
| FL-PDF-09b-merge.pdf | 1,368 | Merge set B: 2 pages |
| FL-PDF-09c-merge.pdf | 2,047 | Merge set C: 4 pages |
| FL-IMG-01-large.jpg | 7,515,912 | 4200x3000 photo JPEG q95 (large) |
| FL-IMG-02-huge.jpg | 24,746,905 | 7000x5000 photo JPEG q97 (huge) |
| FL-IMG-03-transparent.png | 5,722,018 | 2400x1800 PNG with elliptical transparency |
| FL-IMG-04-photo.png | 6,303,121 | 2600x1800 opaque photographic PNG |
| FL-IMG-05-photo.webp | 989,064 | 2000x1500 WebP photo |
| FL-IMG-06-vector.svg | 291 | 320x200 SVG, transparent background |
| FL-IMG-07-transparent.webp | 349,692 | 1600x1200 WebP with transparency |
| FL-IMG-08-portrait.jpg | 650,756 | 1200x1800 portrait JPEG |

## Compress PDF — target-size matrix

| Input | Input bytes | Target bytes | Output bytes | Target reached | Quality setting | Pages | Time | Verdict |
|---|---:|---:|---:|:-:|---|:-:|---:|:-:|
| FL-PDF-02-scan-4mb.pdf | 4,630,188 | 2,000,000 | 1,706,213 | ✓ | 75% | 3/3 | 3.2 s | PASS |
| FL-PDF-02-scan-4mb.pdf | 4,630,188 | 1,000,000 | 981,469 | ✓ | 65% | 3/3 | 4.7 s | PASS |
| FL-PDF-02-scan-4mb.pdf | 4,630,188 | 500,000 | 462,238 | ✓ | 49% | 3/3 | 5.1 s | PASS |
| FL-PDF-03-scan-10mb.pdf | 11,106,784 | 5,000,000 | 4,750,233 | ✓ | 88% | 3/3 | 6.4 s | PASS |
| FL-PDF-03-scan-10mb.pdf | 11,106,784 | 2,000,000 | 1,695,773 | ✓ | 75% | 3/3 | 7.0 s | PASS |
| FL-PDF-03-scan-10mb.pdf | 11,106,784 | 1,000,000 | 951,761 | ✓ | 65% | 3/3 | 7.5 s | PASS |
| FL-PDF-02-scan-4mb.pdf | 4,630,188 | 40,000 | 105,830 | ✗ (closest shown) | Lowest | 3/3 | 4.6 s | LIMITED |
| FL-PDF-01-small-text.pdf | 2,542 | 500,000 | 2,542 | ✓ | Original | 2/2 | 0.1 s | PASS |

The headline shown to the user matched the real outcome in every case (“Done — …” only when the output is at or under the
target; “Couldn't safely reach …” with the closest size otherwise; “Already under your target” returns the original
byte-for-byte).

## Compress Image — target-size matrix

| Input | Input bytes | Target bytes | Output bytes | Reached | Dimensions | Format | Alpha | Details shown | Verdict |
|---|---:|---:|---:|:-:|---|---|---|---|:-:|
| FL-IMG-01-large.jpg | 7,515,912 | 2,000,000 | 1,769,115 | ✓ | 4200x3000→3474x2482 | jpeg→jpeg | false→false | JPG · 3474 × 2482px (resized to 83%) · quality 75% · 4.3 s | PASS |
| FL-IMG-01-large.jpg | 7,515,912 | 1,000,000 | 778,505 | ✓ | 4200x3000→2286x1633 | jpeg→jpeg | false→false | JPG · 2286 × 1633px (resized to 54%) · quality 75% · 4.7 s | PASS |
| FL-IMG-01-large.jpg | 7,515,912 | 500,000 | 399,043 | ✓ | 4200x3000→1616x1154 | jpeg→jpeg | false→false | JPG · 1616 × 1154px (resized to 38%) · quality 75% · 4.7 s | PASS |
| FL-IMG-01-large.jpg | 7,515,912 | 250,000 | 204,439 | ✓ | 4200x3000→1143x816 | jpeg→jpeg | false→false | JPG · 1143 × 816px (resized to 27%) · quality 75% · 4.4 s | PASS |
| FL-IMG-02-huge.jpg | 24,746,905 | 5,000,000 | 4,826,599 | ✓ | 7000x5000→5362x3830 | jpeg→jpeg | false→false | JPG · 5362 × 3830px (resized to 77%) · quality 75% · 13.5 s | PASS |
| FL-IMG-02-huge.jpg | 24,746,905 | 2,000,000 | 1,586,052 | ✓ | 7000x5000→3045x2175 | jpeg→jpeg | false→false | JPG · 3045 × 2175px (resized to 44%) · quality 75% · 12.1 s | PASS |
| FL-IMG-02-huge.jpg | 24,746,905 | 1,000,000 | 811,715 | ✓ | 7000x5000→2153x1538 | jpeg→jpeg | false→false | JPG · 2153 × 1538px (resized to 31%) · quality 75% · 12.5 s | PASS |
| FL-IMG-03-transparent.png | 5,722,018 | 1,000,000 | 925,142 | ✓ | 2400x1800→2400x1800 | png→webp | true→true | WebP · 2400 × 1800px · quality 92% · 1.7 s — “Converted to WebP to keep transparency while reaching your target.” | PASS |
| FL-IMG-03-transparent.png | 5,722,018 | 500,000 | 429,978 | ✓ | 2400x1800→2400x1800 | png→webp | true→true | WebP · 2400 × 1800px · quality 78% · 5.4 s — “Converted to WebP to keep transparency while reaching your target.” | PASS |

## Converter, PDF → Image, Images → PDF, Merge, Split, Organize

| Tool | Test | Verification of the downloaded output | Verdict |
|---|---|---|:-:|
| Image Converter | FL-IMG-08-portrait.jpg → PNG | output: 4337922; format: png; dims: 1200x1800; alpha: false; name: conv-png-FL-IMG-08-portrait.png | PASS |
| Image Converter | FL-IMG-08-portrait.jpg → WebP | output: 845040; format: webp; dims: 1200x1800; alpha: false; name: conv-webp-FL-IMG-08-portrait.webp | PASS |
| Image Converter | FL-IMG-03-transparent.png → JPG | output: 658290; format: jpeg; dims: 2400x1800; alpha: false; name: conv-jpeg-FL-IMG-03-transparent.jpg | PASS |
| Image Converter | FL-IMG-03-transparent.png → WebP | output: 925142; format: webp; dims: 2400x1800; alpha: true; name: conv-webp-FL-IMG-03-transparent.webp | PASS |
| Image Converter | FL-IMG-05-photo.webp → JPG | output: 1305456; format: jpeg; dims: 2000x1500; alpha: false; name: conv-jpeg-FL-IMG-05-photo.jpg | PASS |
| Image Converter | FL-IMG-05-photo.webp → PNG | output: 6793502; format: png; dims: 2000x1500; alpha: false; name: conv-png-FL-IMG-05-photo.png | PASS |
| Image Converter | FL-IMG-06-vector.svg → PNG | output: 40134; format: png; dims: 1024x640; alpha: true; name: conv-png-FL-IMG-06-vector.png | PASS |
| Image Converter | batch of 3 → ZIP | entries: ["FL-IMG-08-portrait.png","FL-IMG-05-photo.png"]; skipped: 1 | PASS |
| PDF → Image | all pages → JPG (ZIP) | entries: 12; page7: 1224x1584 jpeg | PASS |
| PDF → Image | selected pages 2 and 5 → PNG | names: ["FL-PDF-05-multipage-page-2.png","FL-PDF-05-multipage-page-5.png"] | PASS |
| Images → PDF | 3 images, reordered by drag, fit-to-image | order: ["Page 1: FL-IMG-03-transparent.png","Page 2: FL-IMG-08-portrait.jpg","Page 3: FL-IMG-05-photo.webp"]; pageSizes: ["1800x1350","900x1350","1500x1125"]; output: 6357264 | PASS |
| Images → PDF | A4 with landscape auto-orientation | pageSizes: ["595x842","842x595"] | PASS |
| Merge PDF | 3 PDFs, reordered, merged | pages: 9; order: ["CHARLIE — Page 1 of 4","CHARLIE — Page 2 of 4","CHARLIE — Page 3 of 4","CHARLIE — Page 4 of 4","ALPHA — Page 1 of 3","ALPHA — Page 2 of 3","ALPHA — Page 3 of 3","BRAVO — Page 1 of 2","BRAVO — Page 2 of 2"] | PASS |
| Split PDF | extract selected pages 2, 3, 7 | pages: 3; labels: ["2","3","7"]; name: split-sel-FL-PDF-05-multipage-pages-2-3_7.pdf | PASS |
| Split PDF | typed range 10-12 | labels: ["10","11","12"] | PASS |
| Split PDF | split every page → ZIP | files: 12; first: FL-PDF-05-multipage-page-1.pdf | PASS |
| Organize PDF | reorder (drag), rotate, delete, duplicate, save | labels: 4,1,1,2,3,5,6,7,8,9,10,11; rotations: 0,0,0,90,0,0,0,0,0,0,0,0; page4: 317x245 | PASS |
| Organize PDF | rotated source keeps its own rotation and adds to it | rotations: 0,180,180,270 | PASS |
| All tools | console errors |  | PASS |

## PDF Editor

| Session | Checks on the exported, reopened PDF | Verdict |
|---|---|:-:|
| native session: edit, add text, 3× highlight, 3× underline, draw, shape, image, signature, whiteout, undo/redo, blank page, reorder, rotate, crop, export, reopen | {"steps":["region:\"Jordan Smith\"","edit-existing","add-text:\"Approved for payment\"","markup-armed:true","live-stroke:true","undo:13->12->13","pages:blank+move+rotate+crop"],"types":{"native-text-replacement":1,"added-text":1,"annotation":6,"drawing":1,"shape":1,"image":1,"signature":1,"whiteout":1},"checks":{"pages":true,"rotation":true,"editedText":true,"addedText":true,"highlights":true,"underlines":true,"drawing":true,"rectangle":true,"image":true,"signature":true,"whiteout":true,"originalLine11Intact":true,"crop":true},"output":657284} | PASS |
| scanned session (condensed): OCR 6.6s, 12/20/2026→12/20/2028, Jordan→Morgan, Consultation→Consultations, add text, highlight, draw, signature, export, reopen | {"edits":[{"word":"12/20/2026","replacement":"12/20/2028","current":"12/20/2026","overflow":false,"forced":false},{"word":"Jordan","replacement":"Morgan","current":"Jordan","overflow":false,"forced":false},{"word":"Consultation","replacement":"Consultations","current":"Consultation","overflow":false,"forced":false}],"textLayer":"12/20/2028  Morgan  Consultations  Checked on device","changedPct":1.2,"pages":"1/1"} | PASS |
| scanned session (fixture): OCR 8.7s, 12/20/2026→12/20/2028, Jordan→Morgan, Consultation→Consultations, add text, highlight, draw, signature, export, reopen | {"edits":[{"word":"12/20/2026","replacement":"12/20/2028","current":"12/20/2026","overflow":false,"forced":false},{"word":"Jordan","replacement":"Morgan","current":"Jordan","overflow":false,"forced":false},{"word":"Consultation","replacement":"Consultations","current":"Consultation","overflow":false,"forced":false}],"textLayer":"12/20/2028  Morgan  Consultations  Checked on device","changedPct":1.24,"pages":"1/1"} | PASS |
| scanned session (user-supplied): OCR 6.6s, 12/20/2026→12/20/2028, add text, highlight, draw, signature, export, reopen | {"edits":[{"word":"12/20/2026","replacement":"12/20/2028","current":"12/20/2026","overflow":false,"forced":false}],"textLayer":"12/20/2028  Checked on device","changedPct":1.02,"pages":"2/2"} | PASS |

## Mobile (Pixel 7, touch)

| Tool | Test | Result | Verdict |
|---|---|---|:-:|
| Compress PDF | mobile: homepage hand-off + custom 700 KB | {"output":638222,"pages":3} | PASS |
| Compress Image | mobile: custom 300 KB | {"output":245259} | PASS |
| Image Converter | mobile: WebP → JPG | {"output":1305456} | PASS |
| Merge PDF | mobile: touch-drag reorder then merge | {"firstDocument":"CHARLIE"} | PASS |
| Organize PDF | mobile: touch-drag, rotate, delete, save | {"labels":"3,1,2,4,5,6,7,8,9,10,11","rotations":"0,0,90,0,0,0,0,0,0,0,0"} | PASS |
| PDF Editor | mobile: OCR, edit word, add text, draw (touch), crop (touch), export | {"typed":"Mobile check","drawings":"0→1","crop":"575x689","text":"12/20/2028  Mobile check"} | PASS |
| Mobile | tap targets ≥ 44px on the editor dock and top bar | {"small":[]} | PASS |
| Mobile | console errors | {} | PASS |

## Privacy (network)

| Check | Result | Verdict |
|---|---|:-:|
| no request carries a body (no uploads) across all 9 tools | {"requests":253,"withBody":[]} | PASS |
| every request goes to the site's own origin | {"foreign":[]} | PASS |
| no cookies, nothing written to local/session storage or IndexedDB | {"cookies":0,"storage":{"local":0,"session":0,"idb":[]}} | PASS |
| OCR engine and model load from the site itself | {"ocrAssets":["/tesseract/worker.min.js","/tesseract/tesseract-core-lstm.wasm.js","/tesseract/lang-data/eng.traineddata.gz"]} | PASS |
| requests per flow (page code, fonts, pdf.js worker, OCR assets only) | {"byTool":{"compress-pdf":25,"compress-image":24,"convert-image":23,"pdf-to-image":30,"image-to-pdf":27,"merge-pdf":30,"split-pdf":29,"organize-pdf":29,"pdf-editor (OCR + export)":36}} | PASS |

## Performance (decoded JavaScript, local production build)

| Check | Result | Verdict |
|---|---|:-:|
| /: JavaScript before a file is chosen | {"jsKB":528,"files":10,"heavyEngines":[]} | PASS |
| /tools: JavaScript before a file is chosen | {"jsKB":680,"files":17,"heavyEngines":[]} | PASS |
| /compress-pdf: JavaScript before a file is chosen | {"jsKB":528,"files":10,"heavyEngines":[]} | PASS |
| /pdf-editor: JavaScript before a file is chosen | {"jsKB":508,"files":9,"heavyEngines":[]} | PASS |
| editor code and pdf.js load only after a PDF is chosen | {"jsKBLoadedOnOpen":6082} | PASS |
| OCR engine loads only when Recognize text is pressed | {"ocrAssets":["worker.min.js","tesseract-core-lstm.wasm.js","eng.traineddata.gz"]} | PASS |

## Automated suites

- Unit tests (Vitest): 263 passed, 0 failed (28 files)
- Playwright (full suite, 4 projects: chromium, mobile-chromium, chromium-ocr, mobile-chromium-ocr, --workers=1): 235 passed, 0 failed, 5 skipped (viewport-specific tests skipped on the other viewport by design)
- TypeScript (tsc --noEmit): 0 errors
- ESLint: 0 problems
- next build: success, 19 static routes
- npm audit: 0 vulnerabilities
- Viewports checked for sideways scroll and console errors: 390x844, 430x932, 768x1024, 1440x900, 1920x1080 (/, /tools, /compress-pdf, /pdf-editor) — none

## Defects found during acceptance, and what was done

| # | Where | Defect (found in a real-browser run) | Fix | Verified by |
|---|---|---|---|---|
| 1 | Compress PDF | The fixed quality ladder overshot targets: 11.1 MB → 5 MB target gave 2.42 MB (quality needlessly low). | Two bisection steps between the rung that missed and the rung that fit; the largest result under the target wins. Now 4.75 MB. | Matrix above; unit test `refines between the rung that missed and the rung that fit` |
| 2 | Compress Image | Quality was walked down to 25% at full size before any resizing, producing blocky images. | New search (`image-search.ts`): full size only down to 70%, then scale estimated from measured size at 75% quality, then refine; low quality only as last resort. | Matrix above; 6 unit tests |
| 3 | Compress Image / Converter | Browsers that can't write WebP (Safari) silently return PNG — would have been labelled WebP. | Encoder output type is checked; unsupported formats give a clear message and the compressor picks JPG/PNG instead. | Unit tests for `targetFormatFor` |
| 4 | PDF Editor (native text) | A form line “Billed to:      Jordan Smith” was one region; editing the name redrew the whole line small at the label's position and left specks. | Runs split at wide gaps; region covers descenders; replacement drawn on the original baseline at the original size; on-canvas preview matches export. | Native session (export render) ; `nativeText.test.ts` |
| 5 | PDF Editor (scans) | A wider replacement ran into the next word (“MorganSmith”). | Replacement ink starts at the original word's left edge; width budget excludes the gap before the next word; growth stops a word-space short of a neighbour. | Scanned sessions (before/after renders) |
| 6 | PDF Editor (scans) | Condensed receipt faces were matched to bold serif. | Narrow sans candidates added to the matcher. | Condensed hard-case session |
| 7 | PDF Editor | “Tap to place” and crop prompts pushed the page down under the pointer (taps landed ~40 px off; crop drags started on the prompt). | Prompts float over the page; a text-only prompt is click-through. | Desktop and mobile editor sessions |
| 8 | PDF Editor (phone) | Desktop panels were only CSS-hidden on phones, so two copies of the Properties panel and rail existed. | Layouts render exclusively per breakpoint (`useMediaQuery`). | Mobile OCR specs |
| 9 | Design system | Base/component CSS was unlayered, so Tailwind utilities (`px-4`, `w-20`, `border-transparent`) were silently overridden — e.g. every native text line showed an outline. | Base and components moved into `@layer base` / `@layer components`. | Editor screenshots |
| 10 | Organize PDF | A rotated page's card collapsed, making the grid uneven. | Thumbnails use a fixed frame; rotated pages fit inside it. | Organize screenshot |
| 11 | Privacy | Tesseract caches its model in IndexedDB by default, contradicting “nothing stored”. | `cacheMethod: "none"` (browser HTTP cache still applies). | Privacy run: no IndexedDB, no storage, no cookies |

Tried and **reverted**: cloning real scanned glyphs from elsewhere on the page for digit edits. On a real scan at fit-to-page
zoom the donor glyph is sampled from the on-screen canvas and came out soft/grey, which looked worse than a crisp font glyph.

## Known limitations (honest)

- **Scanned-text weight on small serif digits.** On the user-supplied scan, the corrected “8” in 12/20/2028 is drawn a
  little bolder than its neighbours. The date and position are right and the text layer is correct; the stroke weight
  is not a perfect match. Word edits in common faces (Arial, condensed sans) match well — see the before/after renders
  in `qa/review/fresh-launch/18-scan-edit-*.png` (the user-supplied scan crops are kept local, not committed). The editor never claims pixel-perfect results and always shows the
  export-identical preview before saving.
- **A longer replacement word in a scan** is shrunk to fit the original word's space when there is no free space after
  it; the dialog says so.
- **Unreachable targets** (e.g. a 4.6 MB scan to 40 KB) are reported as not reached, with the closest safe size
  offered — by design, never faked.
- **Whiteout** covers content visually; it is not redaction (stated in the tool, FAQ and terms).
- **Signatures** are visual images, not cryptographic signatures (stated in the dialog, FAQ and terms).
- **Light theme only** for the first launch.
- **Touch automation**: Chrome drops the click of the first tap after a synthetic CDP touch sequence even when the
  drag touched no app element (`qa/scripts/touch-diagnostic.mjs` evidence). The mobile script absorbs it with a tap in an
  empty gutter; real devices were not available for this run.
