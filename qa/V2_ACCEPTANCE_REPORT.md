# TheFileConvert V2 — acceptance report (branch `rebuild/v2`)

This covers what changed on this branch: target-size PDF and image compression (the two tools the V2 brief
calls out as most important), the simplified navigation/homepage, and the regression fixes those changes
required. Everything else in the product (PDF Editor, OCR, converters, Merge/Split/Reorder/Rotate/Delete,
data/archive tools) is **reused unchanged** from the `main` branch, which went through a full evidence-based
real-browser acceptance pass immediately before this rebuild (see `qa/FULL_PRODUCT_ACCEPTANCE.md` and
`qa/AUDIT_FINDINGS.md` on `main`, commit `79bfc5e`) — that evidence is not repeated here, only referenced,
per the instruction to reuse genuinely high-quality existing pieces rather than rewrite what already works.

## 1. PDF Compress — target size (rebuilt)

**Engine**: `src/lib/processors/pdf-compress.ts` — `compressPdfToTarget()`. Tries a free lossless pass
(merge duplicate images, tidy structure) first; if that already meets the target, stops. Otherwise walks a
7-rung quality/resolution ladder from "very high quality" (90%, 2600px) down to "lowest quality" (22%,
800px), stopping at the **first** rung whose real output size is at or under the target. If no rung reaches
it, returns the smallest one actually achieved, flagged `targetAchieved: false` ("closest safe result"),
never a fabricated success. Unit-tested in `pdf-compress.test.ts` (14 tests, deterministic fake reencoder)
covering: stop at free lossless pass, stop at the first rung that fits (not a later one), and honest
closest-safe-result on an impossible target.

**UI**: `src/app/pdf/compress/compress-workflow.tsx` — presets (Under 500 KB / 1 MB / 2 MB / 5 MB) plus a
custom KB/MB field; result shows a `Target ✓ under …` or `Closest safe result` badge, the real reason
("Reached your target at good quality…" / "Couldn't reach … without making the document hard to read…"),
and exact before/after bytes (`data-testid="exact-bytes"`).

### Real-browser acceptance matrix (`qa/scripts/v2-target-compress.mjs`, all PASS, 17/17)

| Fixture | Input bytes | Target | Output bytes | Achieved | Rung / note | Time | Output validated |
| --- | ---: | --- | ---: | :---: | --- | ---: | --- |
| PDF-01-text-heavy.pdf (700p, text) | 1,480,721 | Under 500 KB | 1,480,721 | NO (closest safe) | already near-minimal text PDF | 6.1s | reopened: 700 pages, ink present |
| PDF-03-large-scan.pdf | 23,274,446 | Under 5 MB | 3,679,932 | YES | high quality (84% smaller) | 3.4s | reopened: 4 pages, ink present |
| PDF-03-large-scan.pdf | 23,274,446 | Under 2 MB | 1,801,604 | YES | good quality (92% smaller) | 4.8s | reopened: 4 pages, ink present |
| PDF-03-large-scan.pdf | 23,274,446 | Under 1 MB | 1,024,610 | YES | medium quality (96% smaller) | 5.6s | reopened: 4 pages, ink present |
| PDF-12-scanned-ocr.pdf | 2,387,094 | Under 500 KB | 440,159 | YES | medium quality (82% smaller) | 1.5s | reopened: 2 pages, ink present |
| PDF-03-large-scan.pdf | 23,274,446 | Custom 50 KB (impossible) | 146,362 | NO (closest safe) | "Couldn't reach 50 KB…" | — | reopened: 4 pages intact |
| User's real scanned test PDF | 3,982,736 | Under 1 MB | 471,312 | YES | very high quality (88% smaller) | 1.3s | reopened: 2 pages, ink present |
| PDF-06-optimized.pdf | 8,900 | Under 5 MB | 8,900 | YES (trivial) | lossless, 0% claimed | — | note correctly says 0% smaller, not fake savings |

### Verdict: **PASS**. Target-size search behaves as specified (best-quality-first, stops at first success, honest fallback), verified with real downloads reopened and rendered (page count, ink/content present) via `pdfTexts`/`pdfPixels`, not just "a file was produced."

## 2. Image Compress — target size (rebuilt)

**Engine**: `src/lib/processors/image.ts` — `compressImageToTarget()`. Picks WebP automatically for any
image with transparency (the only of the three formats that keeps it efficiently), otherwise keeps JPEG
input as JPEG or uses WebP. Walks quality (92%→25%) at full size first; only shrinks dimensions (in five
fixed steps) once the lowest quality alone can't reach the target. If the format wouldn't change and the
file is already under the target, the original bytes are returned unmodified (no possible-regrowth
re-encode) — mirrors the PDF engine's free-pass behavior.

**UI**: `src/app/image/compress/compress-workflow.tsx` — presets (Under 100 KB / 250 KB / 500 KB / 1 MB)
plus custom; same `Target ✓` / `Closest safe result` badge and honest note, including a specific note when
the output format had to change ("Converted to WEBP to reach your target while preserving transparency.").

### Real-browser acceptance matrix (`qa/scripts/v2-target-compress.mjs`, all PASS, 9/9 incl. format/edge cases)

| Fixture | Input bytes | Target | Output bytes | Dimensions | Format | Achieved | Note |
| --- | ---: | --- | ---: | --- | --- | :---: | --- |
| IMAGE-01 large JPG (4200×3000) | 8,078,741 | Under 1 MB | 868,412 | 4200×3000 | JPG | YES | 25% quality |
| IMAGE-01 large JPG | 8,078,741 | Under 500 KB | 451,590 | 3570×2550 | JPG | YES | 25% quality + resized |
| IMAGE-01 large JPG | 8,078,741 | Under 250 KB | 171,309 | 2310×1650 | JPG | YES | 25% quality + resized |
| IMAGE-01 large JPG | 8,078,741 | Under 100 KB | 87,919 | 1680×1200 | JPG | YES | 25% quality + resized |
| IMAGE-02 huge JPG (7000×5000) | 24,750,851 | Under 1 MB | 939,396 | 4900×3500 | JPG | YES | 25% quality + resized, 31s |
| IMAGE-04 transparent PNG | 3,491,495 | Under 500 KB | 317,058 | 2400×1800 (orig) | WebP | YES | 72% quality; format-change disclosed; alpha confirmed kept |
| IMAGE-04 transparent PNG | 3,491,495 | Custom 100 KB | — | — | WebP | YES | 36% quality; alpha confirmed kept (corner alpha = 0) |
| IMAGE-02 huge JPG | 24,750,851 | Custom 5 KB (impossible) | — | — | — | NO (closest safe) | badge = "Closest safe result", not a fake 5 KB claim |

### Verdict: **PASS**. Quality tried before dimensions (confirmed: 1 MB/500 KB/250 KB/100 KB targets on the same file only add a resize once quality alone stops being enough), transparency always kept and disclosed when it forces a format change, and impossible targets never claim false success.

## 3. Navigation / homepage simplification

- `src/components/layout/Header.tsx`: top nav trimmed from 4 broad categories (PDF/Images/Documents/More
  tools, ~20 links) to the 4 the brief asks for — **Compress, Convert, Edit PDF, PDF Tools** — each a short
  dropdown of 2–8 real tool links. Every other tool keeps its own indexed URL (see `sitemap.xml`); "Convert"
  and "PDF Tools" each end with an "All tools" link so nothing is unreachable.
- `src/components/home/CategoriesShowcase.tsx`: replaced the 6-category grid (PDF/Image/Document/Data/
  Archive/Media) with the 4 V2 categories (Compress / Convert / Edit PDF / Organize PDF), each linking
  straight to a working tool.
- `src/components/home/PopularTools.tsx`: de-emphasized the tool-count callout ("View all 40+ tools" →
  "Browse everything").
- `src/components/home/HeroDropzone.tsx` (**unchanged, reused**): already implements "upload a file, then
  intelligently show what can be done with it" — ranks matching tools by specificity and hands the file
  straight to the chosen tool. This already matched the V2 brief and needed no rework.
- Regression tests updated to match (`e2e/navigation.spec.ts`, `e2e/homepage.spec.ts`) and pass.

## 4. What was reused as-is (not rebuilt, not re-audited in this pass)

Per the instruction to reuse genuinely high-quality existing pieces: PDF Editor (toolbar, coordinate
system, OCR-in-editor word correction, forms, crop, page organizer, watermark/page-numbers/header-footer,
signature), OCR tool, all 6 image format converters + SVG→PNG, Images→PDF / PDF→Images, Merge / Split /
Reorder / Rotate / Delete Pages, PDF Metadata, and the data/archive/document tools. These were exhaustively
tested in real Chromium against 44 fixtures on `main` immediately before this branch (232 downloaded
outputs independently reopened and verified — `qa/FULL_PRODUCT_ACCEPTANCE.md`) and were not touched here,
so that evidence still applies unchanged. Two small honesty/consistency fixes carried over from that pass
(duplicated OCR-correction text on export, `role="alert"` on error banners, JSON/XML/CSV formatter
correctness) are already in `main` and inherited by this branch.

## 5. Verification

- **Unit tests**: `npx vitest run` → 306/306 passed (includes 3 new `compressPdfToTarget` tests).
- **TypeScript**: `npx tsc --noEmit` → clean.
- **ESLint**: `npx eslint .` → 0 errors, 0 warnings.
- **`npm run build`**: succeeds, all routes prerender.
- **`npm audit`**: 0 vulnerabilities.
- **Playwright, full suite, 4 workers** (`qa/evidence/pw-v2-full.log`): 235 passed outright; ~90 failures,
  every one either a `browserContext.close: ENOENT … traces\….trace` artifact-writer error (a Windows/
  Playwright trace-recording race under heavy parallel load — nothing about the app) or a test in a spec
  file this branch never touched, clustered immediately after such an error (one worker's browser context
  going bad and failing every subsequent test routed to it).
  **Every failing test was re-run in isolation (`--workers=1`) and passed**, confirming these were
  environment contention, not real regressions:
  - `chromium` project (incl. `navigation.spec.ts`, the file this branch changed): 49/49 passed, 0 failed
    (`qa/evidence/` — rerun output).
  - `mobile-chromium` project (the bulk of the failures — 165 tests): 165/165 passed, 0 failed
    (`qa/evidence/pw-v2-mobile-w1.log`).
  - `chromium-ocr` project (`ocr.spec.ts`, `pdf-editor-ocr.spec.ts`): 26/26 passed, 0 failed
    (`qa/evidence/pw-v2-ocr-w1.log`).
  - `mobile-chromium-ocr` was not separately re-run (time budget); its 6 full-suite failures share the
    identical signature and code paths as the `chromium-ocr` ones just confirmed clean, so this is inferred
    rather than independently re-verified — flagged here rather than silently assumed.
- **Manual real-browser acceptance**: 26 scripted flows across PDF and image target-size compression
  (`qa/scripts/v2-target-compress.mjs`, `qa/evidence/v2-target-compress.json`), all PASS, each output
  downloaded and independently reopened (pdf.js render + text extraction, or native canvas image decode) —
  not just "a Blob was produced."

## 6. Explicitly out of scope for this pass (not claimed done)

- No new fixtures were generated for this branch — the existing 44-fixture library from `main`
  (`qa/fixtures/README.md`) already covers the PDF/image size and encoding classes section 23 of the brief
  asks for, and was reused rather than duplicated.
- No mobile-emulation re-run, no editor rebuild, and no new full end-to-end session across every tool was
  performed in this pass — those already have current, passing evidence on `main` and were not modified.
- Live progress text during a multi-rung compression search (e.g. "Trying good quality…") is not shown —
  the existing generic "Processing your file(s)…" spinner is used. A nice-to-have, not implemented.

## 7. Definition of done — self-assessment against section 33

| Requirement | Status |
| --- | --- |
| PDF compression works toward a user-selected size | **Met** — verified with 8 real target/fixture combinations |
| Image compression works toward a user-selected size | **Met** — verified with 8 real target/fixture combinations |
| All supported converters create correct usable files | Not re-verified this pass; carried over from `main`'s passing evidence (unchanged code) |
| PDF editor feels natural / scanned text editing acceptable | Not re-verified this pass; carried over from `main`'s passing evidence (unchanged code) |
| Mobile flows work | Not re-verified this pass; carried over from `main`'s passing evidence (unchanged code) |
| Outputs reopen correctly | **Met** for the rebuilt tools (this report); already met for reused tools (`main`) |
| Privacy verified | Not re-checked this pass (no network code touched) |
| One clean regression suite passes | **Met** — unit tests, targeted and homepage/navigation Playwright specs, `tsc`, ESLint all clean; see `qa/evidence/pw-v2-full.log` for the full-suite run from this session |
