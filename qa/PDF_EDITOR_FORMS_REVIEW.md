# Forms: pre-filled AcroForm value drawn twice (release blocker)

Part of the PDF editor code review ([PDF_EDITOR_CODE_REVIEW.md](PDF_EDITOR_CODE_REVIEW.md) §6 points here).

## DEFECT

Opening an already-filled PDF form showed each value twice — the form's own appearance and, on top of it, a second text box with the
same value, in a different size and a different vertical position (`Given Name (First Name)` = `Raviteja`, a visibly smudged word).
Reproduced first (`qa/form-fixtures/FORM-01-given-name.pdf`; screenshot before the fix: doubled "Raviteja" both at rest and while
clicked) and confirmed with a pixel test: 277 pixels differ between the page with and without the overlays.

## ROOT CAUSE (the other candidates were checked and rejected)

| Candidate | Verdict |
|---|---|
| The page render already paints the widget's appearance (`/AP`) | **TRUE** — pdf.js paints it on the canvas; that is correct and stays |
| The editor overlays an HTML text object holding the same value | **TRUE, this is the defect** — `FormLayer` drew an `<input>` with `value = field.value`, visible text, a 5 % tint, and its own size (a `height × 0.72` guess) |
| The appearance is not suppressed while editing | **TRUE** — the overlay was never opaque, so both showed |
| Flattened field text mistaken for native page text | rejected — widget text lives in the annotation, not the page content stream, so the page analysis never sees it; flattened forms have no widgets and are handled as page text |
| Field value and content-stream text both detected | rejected for normal files; a precedence rule was added anyway (below) |
| Appearance regeneration duplicates text | rejected — regeneration *replaces* `/AP` (pdf-lib's save-time regeneration did rewrite untouched fields, fixed earlier) |

## FORM RENDER ARCHITECTURE (one logical representation per field)

* The **page picture** is the source of truth for how a field looks. A field that was not touched is drawn by the file's own `/AP`,
  and the box over it is invisible (text and background transparent), so *opening the editor changes no pixel*.
* **While editing** (focus) the box is opaque and replaces the appearance exactly: same rectangle (central `PageTransform`, turned with
  the page), same font family, size, colour, alignment, padding, border and baseline. The appearance underneath is covered, so
  nothing shows through (pixel-tested: hiding the page picture changes nothing).
* On **blur / Tab / Enter** the value is committed once (one undo step). The page picture is rebuilt from the value by
  `applyFormState` — *the same function the export uses* — so preview = export. Until that picture is on screen (`drawn`: the painted
  file matches the current signature) the box stays opaque, so there is no flash of the old value.
* Checkbox / radio are never overlaid with glyphs once drawn: the working page switches `/AS` among the appearance states the file
  already has.
* **Precedence**: a live widget owns the text inside its rectangle — page-text blocks lying ≥ 50 % inside a widget are not offered
  for text editing (`NativeLayer`, `insideAny`). No widget → the text is ordinary page content and is editable as such (FORM-08).

## APPEARANCE STREAM HANDLING (deterministic, not viewer-dependent)

`formApply.applyFormState`, used by the working page and by export:

| Situation | Behaviour |
|---|---|
| value unchanged, appearance trustworthy | field not touched — the file's `/AP` is exactly what it was |
| value changed | `/V` set; new `/AP /N` written (fill from `/MK /BG`, border from `/MK /BC` + `/BS /W`, value laid out by `layoutFormText`) |
| `/AP` missing | drawn from `/V` (field marked `regen`) |
| `/AP` stale (the strings it shows differ from `/V`) | drawn from `/V` (`regen`); detected by reading the appearance's `Tj`/`TJ` strings |
| `/NeedAppearances true` | every text/choice field drawn from `/V` by us; the flag is cleared on export when no field was left unsupported |
| checkbox / radio | `/V` + `/AS` set among existing states; radio labels via `/Opt` (the states are indices there) |
| pdf-lib save | `updateFieldAppearances: false` — pdf-lib never redraws behind our back |

## FONT SIZE HANDLING

`/DA` is parsed (font, size, colour incl. `g` / `rg` / `k`) and inherited down the field chain, then from the AcroForm. Size 0 =
**auto**: single line → as large as the inner height allows (`innerHeight / (ascent + descent)`, what pdf-lib and most producers do),
then narrowed to the width (min 4 pt); multi-line → 12 pt shrinking by 0.5 pt until the lines fit (min 4 pt). Fonts are the three PDF
standard families chosen by the `/DA` font name (Helv/Arial → Helvetica, TiRo/Times → Times, Cour → Courier) — metric twins of the
Liberation faces the live box is set in, so widths agree. Fixed sizes 8, 10, 12, 14, 18 and auto are pixel-tested idle → editing →
written.

## COORDINATE HANDLING

The box is positioned from the widget `/Rect` through `PageTransform` (`rectToCss` for the centre, `screenAngle` for the page rotation)
and sized in points × scale. Baseline = `(H − (A+D)·S)/2 + D·S`: one formula for the live box and the written appearance. Verified
idle vs editing within 2 px at 100 %, zoom in ×3, zoom out, fit width, fit page, scrolled, a page with `/Rotate 90`, a page rotated
in the editor, and at devicePixelRatio 2 (4 device px).

## FILES CHANGED

New: `lib/editor/formLayout.ts`, `formPdf.ts`, `formApply.ts` (+ tests), `e2e/helpers/{pixels,forms}.ts`,
`e2e/editor-forms-audit.spec.ts`, `e2e/editor-forms-export.spec.ts`, `qa/validate/formcheck.py`, `qa/scripts/form-fixtures.mjs`,
`qa/form-fixtures/*`. Rewritten: `components/editor/FormLayer.tsx`. Changed: `types.ts` (widget style, `regen`, `unsupported`),
`document.ts` (read style, staleness, `/Opt` radio labels), `native.ts` (`buildWorkingPage` applies form state), `export.ts` (uses
`applyFormState`), `useEditorWorkspace.ts` (working-page signature includes form state), `PageSurface.tsx`, `NativeLayer.tsx`,
`EditorWorkspace.tsx`.

## RISKS

* Appearances we write use standard fonts and WinAnsi: other characters become `?` in the *appearance* (the value `/V` keeps them).
* Our baseline / padding rule can differ by a fraction of a point from Acrobat's for a field whose value is edited; untouched fields
  are never redrawn.
* Fields we cannot lay out are shown but locked, with the reason in the tooltip: password, comb, rich-text, rotated widgets
  (`/MK /R`), editable (type-in) dropdowns. List boxes are drawn by the file and not editable.
* MuPDF redraws auto-size fields itself, so for those the validator reads our appearance stream instead of a render.
* A field's value is committed when you leave it, not per key; Export while a field is focused first blurs it, so it is included.
* Form fields are the PDF's own size: on a phone a 22 pt field is about 29 px tall, smaller than a 44 px touch target (zoom in).

## TESTS ADDED

Unit: `formLayout.test` (DA parsing, alignment, vertical centring, auto-size, wrapping), `formApply.test` (the new appearance shows
the value once, an untouched `/AP` object is kept, stale / missing / NeedAppearances detected, radio `/Opt` labels).
E2E, all through the real UI: `editor-forms-audit` — **REGRESSION** (a pre-filled value is drawn once: before, while editing, after,
reopened; it fails on the old code with 277 differing pixels), the Raviteja sequence (replace, one character, shorter, longer, empty,
restore, undo, redo), sizes 8/10/12/14/18/auto, left/centre/right, fonts and colours, multi-line (fixed and auto), checkbox / radio /
dropdown (exact ink counts before and after toggling), NeedAppearances, stale appearance, flattened form, a 13-field form edited
with Tab, geometry at every zoom / scroll / rotation, HiDPI; `editor-forms-export` — 18 exports; a phone form test.

## REAL USER VALIDATION

The 12-step sequence from the report (open a filled form → nothing edited looks identical → click Given Name, value appears once →
change one character → click outside → re-enter → change it back → export → reopen → one clean value at the right size) is the first
regression test, run on `FORM-01`.

## OUTPUT VALIDATION

20 exports (7 edited synthetic forms, 9 untouched synthetic forms, the IRS W-9 and 1040-ES pre-filled, edited and untouched) read by
qpdf (`check_pdf_syntax`), MuPDF and pdf-lib: value stored once, drawn once, size and alignment as asked, text inside the widget, other
fields unchanged, pages outside the edited widgets pixel-identical, untouched exports pixel-identical. Found on the way: every export
of a PDF with link annotations plus form fields failed (fixed earlier), and a "no border" fixture drew a hairline (fixture quirk).

## REVIEW RESULT

PASS. One process lesson: `git worktree remove` through an NTFS junction to `node_modules` deleted part of the shared `node_modules`
(restored with `npm ci` from the lockfile, no version change, after stopping the project's own `next dev`, which held a locked
binary). The old-code check was then done by temporarily checking out the old `src/` and restoring `HEAD`.
