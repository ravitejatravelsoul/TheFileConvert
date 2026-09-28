# Fonts for Word → PDF

Loaded by `src/lib/processors/word-to-pdf/fonts.ts` only while a Word document is being converted, then
subset-embedded into the PDF. Word's own fonts (Calibri, Arial, Times New Roman, Courier New) can't be
redistributed, so each is drawn with an open font that has the **same character widths**, which keeps line
and page breaks close to Word's.

| File | Font | Stands in for | Licence |
|---|---|---|---|
| carlito-*.ttf | Carlito 1.103 (Google Fonts) | Calibri | SIL OFL 1.1 — LICENSE-Carlito-OFL.txt |
| sans-*.ttf | Liberation Sans 2.1.5 | Arial, Helvetica, Aptos and other sans fonts | SIL OFL 1.1 — LICENSE-Liberation-OFL.txt |
| serif-*.ttf | Liberation Serif 2.1.5 | Times New Roman, Cambria, Georgia and other serif fonts | SIL OFL 1.1 |
| mono-*.ttf | Liberation Mono 2.1.5 | Courier New, Consolas | SIL OFL 1.1 |
| dejavu-*.ttf | DejaVu Sans 2.37 | Fallback for characters the fonts above lack (₹, ✓, ☐, arrows…) | Bitstream Vera / DejaVu licence — LICENSE-DejaVu.txt |

Suffixes: `r` regular, `b` bold, `i` italic, `bi` bold italic. The files are unmodified; only the file names changed.
