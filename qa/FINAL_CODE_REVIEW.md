# Final code review — release gate

Candidate: branch `rebuild/fresh-launch`, 34 commits ahead of `main` (`c9fbdf9`). Scope: every launch-visible feature (12 tools), reviewed as
code, not only as behaviour. Per-area detail lives in the earlier reviews this one builds on:
[CODE_REVIEW.md](CODE_REVIEW.md) (converters), [PDF_EDITOR_CODE_REVIEW.md](PDF_EDITOR_CODE_REVIEW.md) (editor, engine, forms),
[SCENARIO_DEFECTS.md](SCENARIO_DEFECTS.md) (output integrity). This file records the review verdicts and every fix made in the release pass.

## 1. Architecture review

| Area | What it is | Verdict |
|---|---|---|
| Conversion architecture | Each tool = a pure processor in `src/lib/processors/*` (no DOM except canvas/pdf.js) + a thin page component. Registry (`lib/tools/registry.ts`) is the single source for routes, nav, sitemap, smart-entry suggestions, SEO. Product semantics are written down (`CONVERSION_SEMANTICS.md`) and every scenario is graded against them. | PASS |
| PDF writing | pdf-lib everywhere; every PDF a tool hands the user goes through `savePdfChecked` (re-parse, page count, dangling-reference check) so a file that only lenient viewers open cannot be offered as a result. Found and fixed earlier: object-stream corruption in compressed output (D1). | PASS |
| DOCX writing | Hand-written OOXML (`pdf-to-word/docx.ts`): exact spacing, tables, pictures, sections per page; validated by python-docx, mammoth and LibreOffice. Word itself cannot be automated on the review machine — **manual Word review is still recommended** and is stated in the report. | PASS (structure, LibreOffice rendering) |
| PDF editor | Content-stream engine (`lib/pdf-engine`): parse → interpret → edit by byte patching → simulate and verify → refuse on any doubt. Editor model: edits are ordered objects replayed on the source page; the page shown *is* the export (working page). One coordinate service (`PageTransform`). | PASS |
| Form handling | `formLayout` / `formPdf` / `formApply` write values and appearances for screen and export from one code path; the live box over a field is invisible until edited and then replaces the appearance exactly. | PASS |
| OCR | Tesseract (WASM) from the site's own origin, lazy (never loaded until Recognize text), worker lifecycle owned by `createOcrSession`, finishes without animation frames (hands-off audit). Recognized text is an invisible layer for search/copy; recognized words are **not** an editing surface (flag `NEXT_PUBLIC_TFC_OCR_EDITING` keeps the old experimental path off). | PASS |
| Image processing | Canvas re-encode with explicit size disclosure, EXIF handling, alpha flattening rules, SVG sanitized before rendering (`sanitizeSvgMarkup`: scripts, foreign objects, external references removed). | PASS |
| Coordinate transforms | Affine layer (`coordinates.ts`, tested at every rotation/box) wrapped by `PageTransform`; no tool does its own arithmetic. Verified for pointer placement, edit boxes, form widgets at 100–200 %, fit modes, scroll, rotated pages, devicePixelRatio 2. | PASS |
| Worker lifecycle | pdf.js worker and OCR worker created on demand and terminated on reset/unmount; `loadPdfJsDocument` caches per file; the editor's working-page builds are de-duplicated per page and signature (`inflight`) and stale results are dropped by a sequence token. | PASS |
| Error handling | Typed errors with plain-language messages (corrupt, encrypted, wrong type, empty, too large); an edit the engine cannot make safely is refused with a reason and changes nothing. 53 error scenarios in the scenario audit. | PASS |
| Output validation | Shared validator gate in every QA script: qpdf + MuPDF + pdf.js + pdf-lib agree on page count, every page renders non-blank; images decode fully; DOCX packages validate. A verdict cannot be PASS if any download fails it. | PASS |
| Security | See §3. | PASS |
| Dependency changes vs `main` | `next` 16.3.5 → 16.3.8 (security patch), `eslint-config-next` likewise; added `@pdf-lib/fontkit` and `@pdf-lib/standard-fonts` (font embedding / metrics in the editor engine, no network). `npm audit --omit=dev`: 0 vulnerabilities. Full `npm audit`: 5 high advisories, all in the dev-only lint chain (`braces` → `eslint-config-next`), not shipped. | PASS |
| Race conditions | Editor builds (sequence tokens + in-flight map), history coalescing (key + 1.5 s window), form commit on blur, OCR cancel flag, download triggers. One race class found and fixed in the release pass (R1). | PASS |
| Privacy | No upload path exists: no `fetch`/XHR/beacon with user data anywhere in `src` (the only `fetch` calls read same-origin fonts and data URLs), no `localStorage`/`sessionStorage`/`indexedDB`/cookies, the only `dangerouslySetInnerHTML` is escaped JSON-LD. Verified on the wire by the privacy audit and by Playwright network checks. | PASS |

## 2. Fixes made during the release pass

### R1 — "Recognize all scanned pages" and the scanned-page prompt only knew pages that had been opened
- **DEFECT:** After the editor rebuild the list of scanned pages was derived from per-page analysis that only existed for pages the user had visited; on a multi-page scan "Recognize all scanned pages (N)" counted only visited pages and the prompt depended on which page was open (regression found by the OCR audit: the multi-page and mixed fixtures).
- **ROOT CAUSE:** the old whole-document page classification was replaced by lazy per-page analysis without a document-wide pass.
- **FILES:** `useEditorWorkspace.ts` (`ensureWorking` returns its analysis and de-duplicates in-flight builds; new `recognizeScanned`), `EditorWorkspace.tsx` (background read of up to 60 pages, banner from all analysed pages), `PropertiesPanel.tsx`.
- **FIX:** pages are read in the background one at a time (yielding in between); "Recognize text" / "Recognize all scanned pages" analyse every page first, then recognise exactly the scanned ones.
- **RISK:** low — read-only analysis; a 60-page cap on the background pass (the explicit buttons read every page).
- **TEST:** `fs-ocr` (7 fixtures incl. multi-page and mixed), `native.test` (scan detection).
- **REAL USER VALIDATION / OUTPUT VALIDATION:** OCR-A…G through the real UI: searchable accuracy 100 %, scan pixels unchanged (0 % diff), no edit targets, exports valid.
- **REVIEW RESULT:** PASS.

### R2 — A scan with a native heading was not recognised as a scan
- **ROOT CAUSE:** `scanned` required almost no native text (< 12 characters).
- **FILES:** `lib/editor/native.ts` (`analyzeContent(content, pageArea)`).
- **FIX:** a page is scanned when a picture covers ≥ 60 % of it and there are < 300 characters of real text.
- **TEST:** `native.test` "scanned pages" (scan, text page, small pictures, mixed page). **REVIEW RESULT:** PASS.

### R3 — Dialogs did not take focus (keyboard / screen-reader users)
- **ROOT CAUSE:** the signature dialog and the phone bottom sheets rendered `role="dialog"` without managing focus.
- **FILES:** new `components/editor/useDialogFocus.ts`; `SignaturePad.tsx`, `EditorWorkspace.tsx` (`Sheet`).
- **FIX:** focus moves into the dialog, Tab/Shift+Tab stay inside, Escape closes, focus returns to the opener.
- **TEST:** `release-a11y.spec` "dialogs…". **REVIEW RESULT:** PASS.

### R4 — A moved or resized picture lost its selection
- **ROOT CAUSE:** the picture's id is derived from its place in the content stream and changes with every edit.
- **FILES:** `useEditorWorkspace.ts` (`transformImage` re-selects the picture nearest the target box); `commitNativeEdit` returns the new analysis.
- **TEST:** `release-editor-session.spec` (move then resize with no re-click). **REVIEW RESULT:** PASS.

### R5 — Homepage had no canonical URL; R6 — logo links 37 px tall on phones
- **FILES:** `app/page.tsx` (`alternates.canonical = "/"`), `components/layout/SiteHeader.tsx`.
- **TEST:** local metadata check; `release-a11y.spec` (touch targets). **REVIEW RESULT:** PASS.

### R8 — Critical advisories in the shipped Next.js
- **DEFECT:** the final `npm audit --omit=dev` (run on the release day) reported a critical vulnerability set in `next` 16.0.0–16.4.0 (image-optimization RCE with SVG, `use cache` RCE, Server Actions DoS). The app was on 16.3.8. (The advisories were published after the previous gate.)
- **ROOT CAUSE:** exact-pinned dependency on an affected release.
- **FILES:** `package.json`, `package-lock.json` (`next` and `eslint-config-next` → 16.4.3, the fixed release; dev-only advisories in vitest/vite/zod cleared with `npm audit fix`, no breaking changes).
- **RISK:** minor-version framework upgrade — the whole gate was re-run on it (588 unit, 622 Playwright, every audit).
- **TEST / VALIDATION:** `npm audit --omit=dev` and `npm audit`: 0 vulnerabilities; build, unit, full Playwright and all audits green on 16.4.3. The app does not use the image optimizer, server actions or `use cache`, so it was not exposed in practice, but the dependency gate is zero.
- **REVIEW RESULT:** PASS.

### R7 — QA harness out of step with the product (not a product defect)
Scripts that drove the old editor (a "Text" button, recognised-word buttons, a correction dialog) and an old OCR-note expectation were
updated to the current editor and to `CONVERSION_SEMANTICS.md` (`fs-ocr`, `fs-journeys`, `fs-tools`, `fl-mobile`, `fl-privacy`,
`rup-audit`). No assertion was relaxed: OCR is now graded on exported searchable accuracy, **zero** pixel change, and zero edit targets.

## 3. Security review

* **Input handling:** every tool validates type by content (magic bytes), size and emptiness before processing; encrypted and corrupt PDFs are refused with a plain message; fake extensions are caught.
* **SVG:** sanitized (scripts, event handlers, foreign objects, external URLs) before it is drawn; the unsafe fixture renders without any request or script.
* **Injection:** no `eval` / `new Function`; the only HTML injection is `JSON.stringify(...).replace(/</g, "\\u003c")` JSON-LD; the live text box is `contentEditable="plaintext-only"` and read back as text.
* **Network:** no cross-origin request and no non-GET request in any audited flow (see §4).
* **Storage:** none (no cookies, local/session storage, IndexedDB).
* **Headers:** the app sets none of its own; Vercel supplies HSTS on the custom domain. Recommended follow-up (not done in the release pass to avoid late runtime risk): `X-Content-Type-Options: nosniff`, `Referrer-Policy`, a conservative `Permissions-Policy`; a CSP needs care for the blob/wasm workers.
* **Dependencies:** production audit clean; dev-only advisories in the lint chain.

## 4. Evidence

`qa/evidence/release/final/` — logs of the final gate on the candidate build (unit, full Playwright, every audit); `qa/evidence/fresh/*.json`
— per-scenario records; `qa/FINAL_RELEASE_REPORT.md` — results and verdict.
