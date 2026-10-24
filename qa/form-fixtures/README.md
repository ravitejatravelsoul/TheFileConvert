# Form fixtures

Synthetic AcroForms (invented names, no real data), built by `node qa/scripts/form-fixtures.mjs` with pdf-lib; each isolates one
situation a filled form can be in. The public government forms (W-9, 1040-ES; see `../editor-fixtures/SOURCES.md`) are pre-filled
inside the tests. Independent validation: `npx playwright test e2e/editor-forms-export.spec.ts`, then
`python qa/validate/formcheck.py qa/fidelity/_work/form-out`.

| File | Situation |
|---|---|
| FORM-01-given-name | the reported case: Given Name (First Name) = Raviteja, 12 pt, left, next to an empty field |
| FORM-02-sizes | the value at 8 / 10 / 12 / 14 / 18 pt and a true auto-size field (`/DA` size 0) |
| FORM-03-alignment | `/Q` left, centre, right |
| FORM-04-multiline | multi-line, fixed 10 pt and auto-size |
| FORM-05-choices | checked and unchecked checkbox, radio group (states are indices, labels in `/Opt`), dropdown |
| FORM-06-needappearances | `/V` set, no `/AP`, `/NeedAppearances true` |
| FORM-07-stale-appearance | `/AP` draws "Old Value", `/V` is Raviteja |
| FORM-08-flattened | the value is page text, no AcroForm |
| FORM-09-long | 13 fields: text (one empty, one multi-line), checkbox, radio, dropdown |
| FORM-10-fonts-colours | Times / Courier, text colour, fill, border widths, borderless |
| FORM-11-rotated-page | pre-filled field on a `/Rotate 90` page |
