# Privacy model

## The rule

A tool may claim "Processed securely in your browser. Your file never leaves your
device." **only if** its `processingMode` in the tool registry is `"local"`, and the
`ToolPageShell` component derives that badge/claim directly from the registry — it is
never hardcoded per page, so it can't drift out of sync with reality.

## How local processing actually works

- **PDF tools** use `pdf-lib` (pure JS/WASM-free) and, for PDF→images, `pdfjs-dist`
  rendering to an in-memory `<canvas>`. Both run fully client-side.
- **Image tools** use the browser's native `Canvas` API and `createImageBitmap` —
  no library, no upload.
- **Archive tools** use `JSZip`, which reads/writes ZIP bytes entirely in memory.
- **Data/text tools** use native browser APIs: `DOMParser` (XML), `Web Crypto`
  (`crypto.subtle.digest`, `crypto.randomUUID`), and plain string processing.

None of these code paths perform a `fetch`/`XMLHttpRequest` with file contents. You can
verify this yourself: open any local tool, open your browser's Network tab, and process
a file — you will not see an upload request.

## What we never do

- We never read file contents for analytics.
- We never log filenames server-side (there is no server-side code that sees them).
- We never silently upgrade a "local" tool to upload data — a processing-mode change is
  a breaking change to this document and to the tool's page copy, made together.

## Object URL lifecycle

Object URLs created for previews and downloads (`src/lib/download/index.ts`) are tracked
and revoked after use or on component unmount, so processed file data doesn't linger in
memory longer than necessary.

## Server-assisted tools (none live yet)

Tools listed as `"coming-soon"` with `processingMode: "server-assisted"` in
`src/lib/tools/roadmap-tools.ts` are not reachable as working routes. If one is ever
shipped, before it goes live:

1. This document is updated to name the tool and describe exactly what is uploaded and
   why.
2. The tool's own page discloses the upload in plain language, not just a badge.
3. `/privacy` is updated in the same change.

## Cookies & storage

- No tracking or advertising cookies.
- The only client-side persistence is the theme preference (`localStorage["theme"]`),
  which never leaves the browser.

## Analytics

None in V1. If added later, per the product principles in the root `README.md`, it would
be limited to anonymous, aggregate events (tool opened / succeeded / failed) — never
filenames, file contents, or anything identifying.
