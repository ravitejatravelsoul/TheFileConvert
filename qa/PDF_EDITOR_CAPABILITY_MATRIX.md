# PDF Editor — capability matrix

Branch `rebuild/fresh-launch`. Everything here runs in the browser; nothing is uploaded. "Verified by" names the test that
exercises it through the real UI (Playwright, Chromium desktop and Pixel 7 emulation) or the engine's own tests.
Status words are literal: **YES** = works and is verified, **LIMITED** = works within the stated limits, **NOT SHIPPED** = not offered.

| Area | Capability | Status | Verified by / limits |
|---|---|---|---|
| Native text | Double-click (or Edit text tool, one click) puts a caret in the PDF's own text | YES | `editor-native-text`, `editor-native-matrix` |
| | Typing, Backspace, Delete, arrows, Home/End, Ctrl+A/C/V, Enter, Escape, mouse caret and selection | YES | `editor-session` (keyboard test); it is a real text box, so the browser's own editing applies |
| | Original font, size, weight, italic, colour, baseline, spacing, alignment, rotation kept | YES | engine tests; independent validator: 0.000 % of the page changes outside the edited line on the files that carry no form fields |
| | Uses the file's own embedded font when it can write every new character, otherwise a bundled metric-compatible one (Liberation, Carlito, Gelasio, Caladea, DejaVu) | YES | engine tests; `usedSubstituteFont` reported |
| | Reflow inside a paragraph (a longer line re-wraps; a shorter one is kept in place), no overlap, no clipping | YES | `edit-block.test`, matrix cases `longer`, `line-end`, `multiple-words` |
| | A change that cannot be made safely (no room below, no font for a character, text in a shared element) | YES (refuses, says why) | `text-edit-error` alert; never a silent cover or clip |
| | True content edit — no white box, no duplicate, no hidden text; search and copy see the edit | YES | `editor-session` search test; pdf.js, MuPDF and poppler read the new text and not the old |
| | Scenarios: same length, shorter, longer, single character, whole word, several words, line end, bold, italic, coloured, large heading, small body, rotated pages, special characters, form page, later page of a long file | YES | 58-case `editor-native-matrix` (all green) |
| | Type 3 / outlined / image-of-text | NOT EDITABLE | reported as "can't be edited" on hover/click; the page is not altered |
| | Right-to-left and complex scripts (shaping) in new text | LIMITED | per-character encoding, no shaping: Latin, Greek, Cyrillic and symbols of the bundled fonts only |
| Add text | Click to place, type on the canvas, move, resize, font family (sans/serif/mono), size, bold, italic, underline, colour, alignment | YES | `editor-addtext`, `pdf-editor-interaction`; PDF standard fonts, WinAnsi characters only (others become "?") |
| Images (in the file) | Select, move, resize (proportions kept; Shift frees), rotate (handle or ±90), replace, delete | YES | `editor-images` (move/resize/delete/undo/redo/replace/turn, six-picture page); `edit-image.test` |
| | A picture that is nearly the whole page (a scan, a full-bleed background) is not a grab target | YES | by design; `editor-scanned` |
| Images (new) | Place an image, move, resize with proportions, rotate on rotated pages | YES | `pdf-editor-advanced`, `pdf-editor-rotation` |
| Annotations | Highlight, underline, strikethrough; tools stay armed until Escape / another tool | YES | `pdf-editor-interaction` |
| | Existing annotations in the file | LIMITED | kept and drawn; not selectable or deletable |
| | Comments / sticky notes | NOT SHIPPED | |
| Draw | Freehand ink live under mouse, touch and pen (coalesced samples) | YES | `pdf-editor-interaction`, mobile touch spec |
| Shapes | Rectangle, ellipse, line, arrow; stroke/fill/colour | YES | `pdf-editor`, `pdf-editor-interaction` |
| Signature | Draw or upload; placed as an image and labelled "visual signature — not a cryptographic digital signature" | YES | `pdf-editor-advanced` |
| Forms | Fill text, checkbox, radio, dropdown directly on the page; values survive export and reopen; untouched fields are not rewritten | YES | `editor-forms` |
| | List boxes, signature fields, field property editing | NOT SHIPPED | list boxes are drawn but not editable |
| Whiteout | Cover with a white box, labelled "Whiteout is not secure redaction" | YES | `pdf-editor-interaction` |
| Secure redaction | Removing content so it cannot be recovered | NOT SHIPPED | the editor can remove text from a stream, but not picture pixels under a box, so it does not claim redaction |
| Crop | Visual crop writing the exact CropBox; adjustable handles; this page or all | YES | `pdf-editor-advanced`, `pdf-editor-interaction` |
| Pages | Select, reorder, rotate, duplicate, delete, insert blank, insert pages from another PDF | YES | `pdf-editor` |
| | Header/footer, page numbers, watermark | YES | `pdf-editor-advanced` |
| Undo / redo | Every edit (text, picture, form, object, page); 200 steps; bursts coalesce into one step | YES | `editor-session`, `history.test` |
| Dirty state | "Unsaved changes" marker, leave-page warning; no upload, no persistence | YES | `editor-session`, `pdf-editor` privacy tests |
| Search | Finds the new text and not the old, across all pages | YES | `editor-session` |
| | Ctrl+F opens the editor's search | NOT SHIPPED | the Search section of the properties panel is used |
| Scanned pages | Detected, labelled "Scanned page", text is not offered for editing; add text, whiteout, highlight, draw, image, signature, crop, page operations work | YES | `editor-scanned` |
| | Recognize text (search / copy only) | YES | existing OCR specs; recognized words are **not** an editing surface |
| | Editing recognized words (paint-over) | OFF by default | behind `NEXT_PUBLIC_TFC_OCR_EDITING=1`; its specs run only with `TFC_OCR_EDITING=1` |
| Mobile | Compact top bar, bottom tool tray, pages and properties as sheets, tap-to-select with an "Edit text" chip, ≥ 44 px controls | YES | `editor-mobile` |
| Accessibility | Named controls, tooltips with shortcuts (V E T H U D), `aria-pressed`, roles on hit targets, keyboard Enter on a selected text | YES | `editor-session` |
| Performance | 25-page file opens editable in ≈ 0.8 s; 8 canvases after open; an edit commits in ≈ 0.6 s | YES | `qa/review/pdf-editor/performance.json` |
| Background | Editing and export do not depend on animation frames or window focus | YES | `editor-robustness` |
| Privacy | No request leaves the origin; no non-GET request | YES | `editor-robustness`, existing privacy specs |
