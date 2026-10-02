# Third-party licences — bundled fonts

Every font shipped by TheFileConvert lives in `public/fonts/word/`. It is served from the site itself (no font
CDN), loaded only while a Word document is converted to PDF, and subset-embedded into the user's PDF. The full
licence text of each family is in the same folder, next to the files. No font with unclear, paid or
restricted licensing is included. All files are byte-identical to the upstream release (only renamed); their
SHA-256 checksums are below.

OCR engine and language data are covered separately in `docs/OCR.md` ("Engine and license").

## Review checklist (applies to every font below)

| Question | Answer |
|---|---|
| Licence allows redistribution, including bundling in this repository and serving to browsers? | Yes — SIL OFL 1.1 (§1–2: use, study, copy, merge, embed, modify, redistribute, sell with software) and the Bitstream Vera / DejaVu licence (copy, redistribute, embed). |
| Embedding in the PDFs users download? | Yes — OFL explicitly permits embedding in documents; every file's OS/2 `fsType` is 0 (installable). |
| Reserved Font Names that would restrict renaming? | None declared in any copyright notice. We only renamed files, never the fonts' internal names, and do not modify the fonts. |
| Conditions we must meet | Ship the copyright notice and licence with the fonts (done: `LICENSE-*.txt`); don't sell the fonts by themselves; don't use the authors' names to promote the product. |
| Paid or restricted files? | None. Microsoft's fonts (Calibri, Cambria, Georgia, …) are **not** shipped; they were used only on the QA machine to measure widths. |

## Fonts

| Files | Font / version | Copyright | Licence | Source | Stands in for |
|---|---|---|---|---|---|
| carlito-{r,b,i,bi}.ttf | Carlito 1.104 | © 2013 The Carlito Project Authors (https://github.com/googlefonts/carlito) | SIL OFL 1.1 — `LICENSE-Carlito-OFL.txt` | github.com/googlefonts/carlito | Calibri (identical widths) |
| sans-, serif-, mono-{r,b,i,bi}.ttf | Liberation Sans / Serif / Mono 2.1.5 | Digitized data © 2010 Google Corporation; © 2012 Red Hat, Inc. | SIL OFL 1.1 — `LICENSE-Liberation-OFL.txt` | github.com/liberationfonts/liberation-fonts (release 2.1.5) | Arial, Times New Roman, Courier New (identical widths); Tahoma (closest) |
| **gelasio-{r,b,i,bi}.ttf** (new) | Gelasio 1.008, static instances | © 2022 The Gelasio Project Authors (https://github.com/SorkinType/Gelasio) | SIL OFL 1.1 — `LICENSE-Gelasio-OFL.txt` | https://github.com/SorkinType/Gelasio/tree/main/fonts/ttf (upstream of Google Fonts' Gelasio; licence: …/Gelasio/main/OFL.txt) | Georgia — identical advance widths in all four styles (measured) |
| **caladea-{r,b,i,bi}.ttf** (new) | Caladea 1.001 | © 2012 The Caladea Project Authors (https://github.com/huertatipografica/Caladea) | SIL OFL 1.1 — `LICENSE-Caladea-OFL.txt` | https://github.com/google/fonts/tree/main/ofl/caladea | Cambria — closest open match, not identical (0.95–0.99 of Cambria 6.99's widths) |
| dejavu-{r,b}.ttf; **dejavu-{i,bi}.ttf** (new) | DejaVu Sans 2.37 (Book, Bold, Oblique, Bold Oblique) | © 2003 Bitstream, Inc.; © 2006 Tavmjong Bah; DejaVu changes public domain | Bitstream Vera / Arev / DejaVu licence — `LICENSE-DejaVu.txt` (identical to the release's LICENSE) | dejavu-fonts-ttf-2.37 release (github.com/dejavu-fonts/dejavu-fonts) | Verdana (0.99–1.00 of its widths); fallback for symbols |

Why these and not others: each stand-in was picked by measuring its advance widths on 3,743 characters of
English text against the Microsoft font (all four styles) — see `public/fonts/word/README.md`. Caladea was
*not* adopted on reputation alone: it is documented as Cambria-compatible, but against the Cambria that ships
with Windows today it measures 0.95–0.99, so Word → PDF still tells the user when a document uses Cambria.

## Checksums (SHA-256)

```
48c797fbe0e07c48a18cb962e7bdfa23f19618327dddf54093265328dc9eb39d  gelasio-r.ttf   (Gelasio-Regular.ttf)
e0ef3addf1acf35f5c6aef2be00d0a2c01363bf70a5950e16650976051a0c462  gelasio-b.ttf   (Gelasio-Bold.ttf)
1d8bda4ff258bb8251eae4f7d7500c8d97d084136192bb264bc2305168765d1b  gelasio-i.ttf   (Gelasio-Italic.ttf)
aa87e21b46aef3dcb50a68dc6e1946f0c0a9819d067e4be6a98a6daa8f5b3c16  gelasio-bi.ttf  (Gelasio-BoldItalic.ttf)
f1e899278b7b4491aba5b6a8253c4b04c050cc59b21865be5c37559a775153cd  caladea-r.ttf   (Caladea-Regular.ttf)
ae3cb2dcbc925809dd29d2a44e9802211cab66be541bacbfc9c08c74b27c3742  caladea-b.ttf   (Caladea-Bold.ttf)
4359a8e24f748b6447b1ff6d7a174febe70961d29f8bb8634b56dacd740a3deb  caladea-i.ttf   (Caladea-Italic.ttf)
ccabaa7b7e2fdf253d2b1a5fa699dd8a3df8d835a9eb285ad82631a677eb76c0  caladea-bi.ttf  (Caladea-BoldItalic.ttf)
7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954  dejavu-r.ttf    (DejaVuSans.ttf)
e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724  dejavu-b.ttf    (DejaVuSans-Bold.ttf)
4af75fa16ee6d3ad43e1ecec41862c24954af26a55c6bb1ebb27bd486a50f5f4  dejavu-i.ttf    (DejaVuSans-Oblique.ttf)
eb436dca0c2594b73d8b603b892e374fdfd8d885d25ffb4f18df4c4c0b49e50f  dejavu-bi.ttf   (DejaVuSans-BoldOblique.ttf)
f6418f708baede9789daef5d458c0f53d2a888af9820e8062934e504fedc6595  carlito-r.ttf
bb5d20f79b82599ec72983597437373a80f2d2085fa91fc144fd74e876a594db  carlito-b.ttf
0b019225e58d702bfedcbd35c21696769f8ee115cb6343f84c2f240312450d1c  carlito-i.ttf
b32928186c119599e03ca6a1ffc680fdcb7fac95772f4b95d989cf6cd3861517  carlito-bi.ttf
76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8  sans-r.ttf
788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173  sans-b.ttf
e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0  sans-i.ttf
698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee  sans-bi.ttf
058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74  serif-r.ttf
d754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce  serif-b.ttf
0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e  serif-i.ttf
f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7  serif-bi.ttf
f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1  mono-r.ttf
bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb  mono-b.ttf
605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1  mono-i.ttf
79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130  mono-bi.ttf
```
