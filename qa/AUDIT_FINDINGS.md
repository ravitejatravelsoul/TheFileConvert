# Audit findings and fixes (from-scratch acceptance pass)

## Why did the ~3.8 MB compression test return about the same size?
The exact file the report came from was not available, so the closest real case was used: the product's own scanned test PDF (`TheFileConvert_Scanned_OCR_Test.pdf`, 3,982,736 bytes). It holds two 2550×3300 DeviceRGB images stored as `[/ASCII85Decode /FlateDecode]` — lossless scan data that is 99% of the file. The compressor only re-encoded JPEG (DCTDecode) images, so it treated these as "not recompressible", and the page also started on **Lossless**, which by definition cannot shrink a scan (3,982,736 → 3,981,768 bytes, 0.02%).
Classes of file that give this outcome: scans/exports with Flate or ASCII85+Flate images (ReportLab, PIL, many scanner and "print to PDF" tools), files whose images are already small JPEGs, text/vector PDFs that are already Flate + object-stream optimised, and anything run in Lossless mode.

## Defects found and fixed (10 found, 10 fixed, 0 unresolved)
| # | Defect | Fix | Regression coverage |
| - | --- | --- | --- |
| 1 | Flate / ASCII85+Flate / PNG-predictor RGB & grey images were ignored by PDF compression | New `pdf-image-decode.ts` (ASCII85, inflate via `DecompressionStream`, PNG predictors) + raw-pixel re-encoder; analysis and advice recognise them | `pdf-image-decode.test.ts`, `e2e/pdf-compress-flate-scan.spec.ts` |
| 2 | Compress page pre-selected Lossless even for scans | Pre-selects Balanced when the analysis says only a lossy level helps (labelled as quality-reducing) | e2e spec above |
| 3 | Result screen showed only rounded sizes ("3.8 MB → 3.8 MB") | Exact byte counts and difference shown for every single-file result | e2e spec above |
| 4 | XML formatter wrote invalid XML (`&` unescaped) and dropped comments, CDATA, PIs, DOCTYPE and mixed-content text | Lossless serializer | `data.test.ts` |
| 5 | JSON formatter silently changed integers beyond 2^53 and normalised number spelling/escapes | Token-level re-layout after `JSON.parse` validation | `data.test.ts` |
| 6 | CSV→JSON only understood commas (semicolon Excel exports became one column) | Delimiter auto-detection (`,` `;` tab `|`) | `data.test.ts` |
| 7 | Editor: a corrected native-text word was written twice (visible + invisible copy), so search/copy doubled it | Single real text run | re-run of editor session A |
| 8 | Error banners had no `role="alert"` (screen readers were not told) | Added on all shared banners | used by the QA harness |
| 9 | Breadcrumb links were 16 px tall touch targets | Larger hit area on coarse pointers | mobile run |
| 10 | Markdown→HTML documents overflowed on long unbroken strings | `overflow-wrap: anywhere` | docs-data run |

## Honest limitations (marked LIMITED, all disclosed in the UI)
- PDF Editor: text corrections and Whiteout cover the original, they do not delete it (FAQ + panel text). Mobile toolbars take ~45% of the screen height.
- Markdown/TXT → PDF and Watermark use built-in PDF fonts: non-Latin characters are replaced by "?" (with a note) or refused (watermark).
- Images → PDF accepts JPG and PNG only (WebP is refused with a clear message).
- Lossless PDF compression cannot shrink image scans; the UI says so before and after.

## Observations, not defects
- OCR "High accuracy" gave no measurable gain over "Standard" on the synthetic scan (94.8% vs 95.2% word recall); real test PDF: 100%.
- First OCR after a cold page load takes ~30 s (engine and language data load); later pages take seconds.
- Synthetic fixtures contain heavy artificial grain, so their PSNR after lossy compression is low; the real scan keeps ≈34 dB with crisp text.
