
## Defects found during acceptance, and what was done

| # | Where | Defect (found in a real-browser run) | Fix | Verified by |
|---|---|---|---|---|
| 1 | Compress PDF | The fixed quality ladder overshot targets: 11.1 MB → 5 MB target gave 2.42 MB (quality needlessly low). | Two bisection steps between the rung that missed and the rung that fit; the largest result under the target wins. Now 4.75 MB. | Matrix above; unit test `refines between the rung that missed and the rung that fit` |
| 2 | Compress Image | Quality was walked down to 25% at full size before any resizing, producing blocky images. | New search (`image-search.ts`): full size only down to 70%, then scale estimated from measured size at 75% quality, then refine; low quality only as last resort. | Matrix above; 6 unit tests |
| 3 | Compress Image / Converter | Browsers that can't write WebP (Safari) silently return PNG — would have been labelled WebP. | Encoder output type is checked; unsupported formats give a clear message and the compressor picks JPG/PNG instead. | Unit tests for `targetFormatFor` |
| 4 | PDF Editor (native text) | A form line “Billed to:      Jordan Smith” was one region; editing the name redrew the whole line small at the label's position and left specks. | Runs split at wide gaps; region covers descenders; replacement drawn on the original baseline at the original size; on-canvas preview matches export. | Native session (export render) ; `nativeText.test.ts` |
| 5 | PDF Editor (scans) | A wider replacement ran into the next word (“MorganSmith”). | Replacement ink starts at the original word's left edge; width budget excludes the gap before the next word; growth stops a word-space short of a neighbour. | Scanned sessions (before/after renders) |
| 6 | PDF Editor (scans) | Condensed receipt faces were matched to bold serif. | Narrow sans candidates added to the matcher. | Condensed hard-case session |
| 7 | PDF Editor | “Tap to place” and crop prompts pushed the page down under the pointer (taps landed ~40 px off; crop drags started on the prompt). | Prompts float over the page; a text-only prompt is click-through. | Desktop and mobile editor sessions |
| 8 | PDF Editor (phone) | Desktop panels were only CSS-hidden on phones, so two copies of the Properties panel and rail existed. | Layouts render exclusively per breakpoint (`useMediaQuery`). | Mobile OCR specs |
| 9 | Design system | Base/component CSS was unlayered, so Tailwind utilities (`px-4`, `w-20`, `border-transparent`) were silently overridden — e.g. every native text line showed an outline. | Base and components moved into `@layer base` / `@layer components`. | Editor screenshots |
| 10 | Organize PDF | A rotated page's card collapsed, making the grid uneven. | Thumbnails use a fixed frame; rotated pages fit inside it. | Organize screenshot |
| 11 | Privacy | Tesseract caches its model in IndexedDB by default, contradicting “nothing stored”. | `cacheMethod: "none"` (browser HTTP cache still applies). | Privacy run: no IndexedDB, no storage, no cookies |

Tried and **reverted**: cloning real scanned glyphs from elsewhere on the page for digit edits. On a real scan at fit-to-page
zoom the donor glyph is sampled from the on-screen canvas and came out soft/grey, which looked worse than a crisp font glyph.

## Known limitations (honest)

- **Scanned-text weight on small serif digits.** On the user-supplied scan, the corrected “8” in 12/20/2028 is drawn a
  little bolder than its neighbours. The date and position are right and the text layer is correct; the stroke weight
  is not a perfect match. Word edits in common faces (Arial, condensed sans) match well — see the before/after renders
  in `qa/review/fresh-launch/18-scan-edit-*.png` (the user-supplied scan crops are kept local, not committed). The editor never claims pixel-perfect results and always shows the
  export-identical preview before saving.
- **A longer replacement word in a scan** is shrunk to fit the original word's space when there is no free space after
  it; the dialog says so.
- **Unreachable targets** (e.g. a 4.6 MB scan to 40 KB) are reported as not reached, with the closest safe size
  offered — by design, never faked.
- **Whiteout** covers content visually; it is not redaction (stated in the tool, FAQ and terms).
- **Signatures** are visual images, not cryptographic signatures (stated in the dialog, FAQ and terms).
- **Light theme only** for the first launch.
- **Touch automation**: Chrome drops the click of the first tap after a synthetic CDP touch sequence even when the
  drag touched no app element (`qa/scripts/touch-diagnostic.mjs` evidence). The mobile script absorbs it with a tap in an
  empty gutter; real devices were not available for this run.
