# Fonts for Word → PDF

Loaded by `src/lib/processors/word-to-pdf/fonts.ts` only while a Word document is being converted (only the
faces the document uses), then subset-embedded into the PDF. Served from this folder — no font CDN.

Microsoft's fonts can't be redistributed, so each is drawn with an open font. Each stand-in was chosen by
**measuring** advance widths against the Microsoft font installed on Windows 11 (3,743 characters of English
text, all four styles): the closer the widths, the closer Word's line and page breaks. Where no open font has
Word's line height, the Microsoft font's own ascent/descent are used for spacing (`VERTICAL` in `fonts.ts`).

| File | Font | Stands in for | Width vs. the Microsoft font (R / B / I / BI) | Licence |
|---|---|---|---|---|
| carlito-*.ttf | Carlito 1.104 | Calibri | identical | SIL OFL 1.1 — LICENSE-Carlito-OFL.txt |
| sans-*.ttf | Liberation Sans 2.1.5 | Arial, Helvetica; also Tahoma (0.995 / 0.938) and other sans fonts | identical to Arial | SIL OFL 1.1 — LICENSE-Liberation-OFL.txt |
| serif-*.ttf | Liberation Serif 2.1.5 | Times New Roman and other serif fonts | identical to Times New Roman | SIL OFL 1.1 |
| mono-*.ttf | Liberation Mono 2.1.5 | Courier New, Consolas | identical to Courier New | SIL OFL 1.1 |
| gelasio-*.ttf | Gelasio (static instances, SorkinType/Gelasio, 2022) | Georgia | identical (1.000 / 1.000 / 1.000 / 1.000) | SIL OFL 1.1 — LICENSE-Gelasio-OFL.txt |
| caladea-*.ttf | Caladea 1.001 (google/fonts, upstream huertatipografica/Caladea) | Cambria | closest open match, **not identical** (0.953 / 0.975 / 0.964 / 0.987; Liberation Serif: 0.946 / 0.935 / 0.978 / 0.927) — Word → PDF tells the user | SIL OFL 1.1 — LICENSE-Caladea-OFL.txt |
| dejavu-*.ttf | DejaVu Sans 2.37 | Verdana (0.991 / 1.002 / 0.991 / 1.002; Liberation Sans is 0.869 / 0.836), and the fallback for characters the fonts above lack (₹, ✓, ☐, arrows…) | close, not identical | Bitstream Vera / DejaVu licence — LICENSE-DejaVu.txt |

Suffixes: `r` regular, `b` bold, `i` italic, `bi` bold italic. The files are unmodified; only the file names
changed. All have OS/2 `fsType` 0 (installable embedding — embedding in PDFs is allowed). See
`qa/THIRD_PARTY_LICENSES.md` for copyright, source URLs and checksums.
