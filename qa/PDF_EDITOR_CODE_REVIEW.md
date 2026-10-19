# PDF Editor — code review

Scope: the editor rebuild on `rebuild/fresh-launch` (commits `27e2d5b` … HEAD). Companion to
[PDF_EDITOR_ARCHITECTURE_REVIEW.md](PDF_EDITOR_ARCHITECTURE_REVIEW.md) (what was wrong) and
[PDF_EDITOR_CAPABILITY_MATRIX.md](PDF_EDITOR_CAPABILITY_MATRIX.md) (what works).

## 1. What was replaced and why

The user's own test — correct a misspelling in an existing PDF — failed because the old editor never edited text: it covered the
old word with a patch and drew new text over it, in a modal dialog, with a model that could not see the page. The rebuild replaces
that with a content-stream engine and a working-page model.

| Layer | New code | Replaces |
|---|---|---|
| Engine | `src/lib/pdf-engine/*` — tokenizer, font decoding (cmap/encodings/fontinfo), graphics/text interpreter, line/block model, diff, stream patching with simulation-verified fix-up, paragraph reflow, image placement | "cover and redraw" for native text |
| Editor model | `src/lib/editor/native.ts` — edits are ordered objects replayed on the source page; the *working page* is what is drawn and what is exported | separate preview and export code paths |
| Coordinates | `src/lib/editor/pageTransform.ts` wrapping the tested affine layer — the only place PDF ↔ screen is computed | per-tool arithmetic |
| UI | `NativeLayer` (hit targets, image handles), `TextEditorOverlay` (live text box), `FormLayer`, `NativeProperties`, tool dock with Edit text | `TextEditModal`, native-region buttons |
| Flags | `lib/editor/flags.ts` — OCR word editing is off unless built with `NEXT_PUBLIC_TFC_OCR_EDITING=1` | OCR as the default editing story |

## 2. Design decisions worth knowing

1. **Byte-patching, not regeneration.** Only the operations that change are rewritten. Everything else in the page's content
   stream is byte-identical, which is why a spelling fix changes 0 pixels outside the edited line.
2. **Simulation before trust.** Every edit is applied, the page is re-interpreted, and the engine verifies: the line reads exactly
   what the user typed, no other glyph moved (a fix-up loop inserts `Td`/`TJ` adjustments to restore the positions of what
   follows), and the result does not overlap other content. If any check fails the edit is refused with a reason; nothing is
   applied partially.
3. **Fonts.** The file's own font is reused when it can encode every new character (subset fonts usually can for a spelling
   fix). Otherwise a bundled metric-compatible face is embedded and the *whole inserted run* uses it (changes closer than three
   characters are merged so a word never mixes two fonts — regression `diff.test`: Bold → Strong).
4. **Lazy embedding.** pdf-lib writes fonts and images at save time. The engine therefore describes fallback fonts synthetically
   during simulation and flushes the document after an image replace (regression `native.test`: replace then turn).
5. **Working page = export.** The editor draws the page with its edits replayed; export replays the same list. A prefix cache
   makes each new edit cost one edit and undo a cache hit.
6. **Honest refusal.** Text that cannot be edited safely is marked and explains itself; it is never covered.

## 3. Defects found and fixed during this phase (each has a regression test)

| # | Defect | Found by | Fix / test |
|---|---|---|---|
| 1 | Single-line headings or short lines could not grow by one letter ("no room below") — their column width was their own width | matrix `large-heading`, `fix-occured` on EDITOR-06 | room to the page's text margin, stopped by a neighbour on the same line (`textmodel.freeRight`); `edit-block.test` |
| 2 | "Bold" → "Strong" mixed glyphs of two fonts inside one word (kept `o`) | matrix `bold`, `italic` | merge nearby diff hunks; `diff.test` |
| 3 | Replacing a picture and then editing it failed on export ("picture no longer on the page") | `editor-images` | the new image was not yet in the document; flush after replace; `native.test` |
| 4 | Edited-picture records were drawn as an overlay box that swallowed clicks | `editor-images` | native-edit objects are never drawn as objects |
| 5 | The "Downloaded" card floated over the page after an export and intercepted clicks | `editor-images` | the card disappears when the document changes |
| 6 | Form export re-rendered every field, shifting untouched fields by a pixel | independent validator on EDITOR-05 | only fields whose value changed are rewritten |
| 7 | Fixture radio group had three separate fields all named "Yes" | `editor-forms` | fixture rebuilt as one group with named choices |
| 8 | The text box was built asynchronously; a fast typist's first keys could be lost | robustness test design | built and focused synchronously, fonts load alongside |
| 9 | A full-page scan was a draggable "picture" | review of `editor-scanned` | pictures covering ≥ 85 % of the page are not grab targets |
| 10 | Every thumbnail re-rendered on every edit and none showed edits | review | thumbnails render when near the viewport, from the working page, only when their own picture changes |
| 11 | Undo history capped at 50 | long-session design | 200 |

## 4. Review findings that remain (not defects of the shipped behaviour)

| Finding | Severity | Note |
|---|---|---|
| Right after "Done" the page canvas is repainted asynchronously; the live text box is removed at once | cosmetic | a frame or two where the old canvas is visible behind the removed box; no data effect |
| Paragraph detection is geometric (alignment, spacing, size); unusual layouts can split a paragraph into several blocks | low | each block still edits correctly; wrapping is per block |
| Type 3 fonts, text drawn as paths, and text inside shared Form XObjects are refused | by design | explained in the UI |
| New characters outside the bundled fonts' coverage are refused, not substituted | by design | message names the problem |
| Existing annotations are drawn but not selectable | limitation | |
| `npm audit` reports 5 high advisories, all in the dev-only lint chain (`braces` → `eslint-config-next`); `npm audit --omit=dev` is clean | tooling | the only offered fix downgrades `eslint-config-next` across a major version, so it was not applied |

## 5. Security and privacy review

* Nothing in the editor makes a network request that carries document data. The privacy specs fail on any cross-origin request
  or non-GET request during open → edit → export (text, picture and form flows).
* Fonts come from `/fonts/word/*.ttf` on the same origin; no CDN.
* Inline images and pictures are decoded by the browser / pdf-lib only; no `eval`, no HTML injection (the live text box is
  `contentEditable="plaintext-only"` and its content is read back as text).
* Output integrity: every export goes through the existing `savePdfChecked` and was re-read by qpdf, MuPDF, poppler, pdf.js
  and pdf-lib in the matrix.

## 6. Forms: pre-filled value drawn twice

A release-blocking defect found by the user; root cause, architecture, appearance handling and tests are in [PDF_EDITOR_FORMS_REVIEW.md](PDF_EDITOR_FORMS_REVIEW.md). Review result: PASS.
