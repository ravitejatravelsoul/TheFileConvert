# Final release report — TheFileConvert fresh launch

**Verdict: PRODUCTION LIVE AND VERIFIED** — https://thefileconvert.com serves GitHub `main` `3e09fcf`.

## 1. Commits

| | SHA |
|---|---|
| Candidate (branch `rebuild/fresh-launch`, tested) | `5d2f187` |
| Merged `main` (merge commit; tree identical to the candidate) | `3e09fcf` |
| GitHub `main` after the push | `3e09fcf` (fast-forward from `c9fbdf9`, no force) |
| Vercel production deployment | `3e09fcf` — status *success* (deployment `7299460119`, environment *Production*) |

This report and the production-smoke spec were added afterwards as a documentation/test-only commit on `main`; the application code in production is the `3e09fcf` build.

## 2. Feature inventory (read from `src/lib/tools/registry.ts` and the app)

Home page and smart upload · navigation (Compress, Convert, PDF Editor, PDF Tools, All Tools) · 12 tools: **Compress PDF, Compress Image, Image Converter (JPG/PNG/WebP/SVG→raster), PDF → Image, Image → PDF, PDF → Word, Word → PDF, Image → Word, Merge PDF, Split PDF, Organize PDF (reorder/rotate/delete/duplicate), PDF Editor** (native text editing, add text, picture editing, annotations, drawing, shapes, signature, forms, whiteout, crop, page organization, header/footer/page numbers/watermark, undo/redo, search, mobile layout, scanned-page handling, Recognize text) · privacy page, terms, sitemap, robots, redirects/aliases.

## 3. Local acceptance (candidate build, Next.js 16.4.3)

| Gate | Result |
|---|---|
| Unit tests | **588 passed, 0 failed** (52 files) |
| Playwright, whole suite, `--workers=1`, 4 projects | **469 passed, 153 skipped, 0 failed** (the skips are desktop-only/phone-only specs on the other viewport and the 22 off-by-default OCR word-editing specs) — run on the branch and again on merged `main` |
| TypeScript / ESLint / production build | 0 errors / 0 errors / success |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| Full `npm audit` | 0 vulnerabilities |
| Compress audit (PDF + image, real scan 3.98 MB → < 1 MB, optimized, incremental-update, 5–20 MB) | 59 PASS, 3 LIMITED (honest "target not reached" on already-optimized tiny files), 0 FAIL |
| Converters / PDF→Image / Image→PDF / Merge / Split / Organize / errors / repeat use | 117 PASS, 0 LIMITED, 0 FAIL |
| PDF → Word (16 documents incl. the user's scan) | 14 PASS, 2 LIMITED (documented), 0 FAIL |
| Word → PDF (21) | 21 PASS |
| Journeys and round trips (24) | 24 PASS |
| OCR / Recognize text (7 documents) | 8 PASS — searchable accuracy 100 %, scan pixels unchanged (0 % diff), no edit targets, valid exports |
| Real-user product audit (59 documents × tools) | 56 PASS, 3 LIMITED (documented), 0 FAIL |
| Privacy (all 9 tool flows on the wire) | 5/5 PASS — no body, no foreign origin, no storage |
| Mobile (Pixel 7) | 9/9 PASS |
| Hands-off ("click once") incl. starved animation frames, cold/warm | 90/90 PASS |
| Background tab (headed, hidden tab, one click) | 6/6 finished by themselves |
| Editor: 20+ action session on a 12-page PDF; native text matrix (61 cases, independently validated 61/61); pre-filled forms (35 scenarios, 20 exports independently validated); picture editing; signature/whiteout/crop/page organization/undo-redo | all PASS |
| Accessibility (axe-core WCAG 2.0/2.1 A+AA on 6 pages + the open editor + dialog), keyboard, dialog focus, 44 px targets | PASS |
| Lazy loading (no OCR/pdf.js/fonts before use; editor code on demand) | PASS |

Outputs downloaded and independently validated by the scenario audits: **276**, 276 reopened, **0 corrupt**; plus 90 hands-off downloads, 61 + 20 editor exports read by qpdf/MuPDF/poppler/pdf-lib, and the editor session export.

The LIMITED verdicts are the documented ones: native PDF → editable Word keeps 100 % of the text, positions and pictures but simplifies decorative shapes (dark name band width, grey rule bars); a complex Word report loses some exact fonts/decorative detail; a scan of a form keeps its look as a picture rather than editable text (by design — see `CONVERSION_SEMANTICS.md`).

## 4. Defects found and fixed in the release pass

R1 "Recognize all scanned pages" only knew visited pages · R2 a scan with a native heading was not detected as a scan · R3 dialogs did not take focus · R4 a moved picture lost its selection · R5 homepage had no canonical URL · R6 logo links 37 px on phones · **R8 critical advisories in the shipped Next.js (16.0–16.4.0): upgraded to 16.4.3** · R7 QA scripts updated to the current editor/OCR semantics. Details, root causes, risks and tests: [FINAL_CODE_REVIEW.md](FINAL_CODE_REVIEW.md). Earlier in the same programme: the pre-filled form value drawn twice, native text editing, export of PDFs with link annotations, and others (see `PDF_EDITOR_CODE_REVIEW.md`).

## 5. Production acceptance (https://thefileconvert.com, `3e09fcf`)

| Check | Result |
|---|---|
| Fingerprint: fresh-launch UI, no old yellow hero highlight, nav Compress/Convert/PDF Editor/PDF Tools, all tool routes 200 | PASS |
| Compress PDF — the real scanned PDF (3,982,736 B) → custom 1 MB | PASS (valid, ≤ 1,000,000 B, same page count; qpdf/MuPDF/pdf.js/pdf-lib) |
| Compress Image 3 MB photo → 500 KB | PASS |
| PDF → Word: scanned form keeps its look (picture, no retyped text); native résumé → editable text | PASS / PASS |
| Word → PDF complex report (text of every page present) | PASS |
| Image → Word, PDF → Image, Image → PDF, Image converter, Merge, Split, Organize | PASS (outputs validated; page counts, rotation) |
| Pre-filled form "Raviteja": one value at rest / editing / after export and reopen | PASS |
| Native typo teh → the: search finds the new text and not the old; export valid | PASS |
| Phone (Pixel 7): the same flows plus tap-to-edit text, form field, Compress PDF, PDF → Word, image converter | PASS (10/10) |
| Accessibility + lazy-loading specs on production | PASS (31) |
| Privacy on the live site (9 tool flows) | PASS (267 requests, 0 with a body, 0 foreign, no storage) |
| Console / network during the smoke | no uncaught error, no hydration error, no 4xx/5xx, no third-party request |
| SEO: canonical + OpenGraph on home and tool pages, sitemap (16 URLs), robots, 404 page — all on `https://thefileconvert.com` | PASS |
| `www` → apex permanent redirect (308); HTTP → HTTPS (308); TLS valid (Let's Encrypt, to 2026-12-20) for apex and www | PASS |

Production flows run: 34 (desktop 16 + phone 18) plus 9 network-audited tool flows; 30 files downloaded, 30 validated and reopened, 0 corrupt. **Production defects found: 0.** (Two mistakes in the new smoke script — a missing output-format click, and reading one page of a multi-page PDF — were fixed in the script; the product was right both times.)

## 6. Remaining limitations

* Native PDF → Word is LIMITED where PDFs use decorative shapes/unusual fonts; Word itself could not be automated on the review machine (**a manual Word review is still recommended** — `qa/manual-word-review/`).
* Compress cannot always reach a target on already-optimized or tiny files; it says so with the exact bytes.
* PDF editor: secure redaction, comments, selecting existing annotations, editing list boxes, Type 3/outlined text, complex-script shaping in new text are not offered; password/comb/rich-text/rotated form fields are locked; recognized-text word editing is off by default.
* Tested in Chromium (desktop and Pixel 7 emulation) only.
* The app sets no security headers of its own (Vercel supplies HSTS); recommended follow-up: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.

## 7. Privacy and security

No file leaves the device: no request with a body, no third-party origin, no cookies/local storage/IndexedDB — verified locally and on the live site. SVG is sanitized before drawing; no `eval`; production dependency audit is clean.
