# TheFileConvert

**Every file. Any format. Free.**

TheFileConvert is a free, privacy-first file conversion and compression platform. Most tools run entirely in the browser using JavaScript, Canvas, Web Crypto, and WebAssembly-adjacent libraries — no account, no subscription, and no server upload for local tools.

Live site: [thefileconvert.com](https://thefileconvert.com)

## Principles

- **Local over server** — process files on-device whenever technically possible.
- **Free, no account** — no login, no paywalled tiers, no email requirement.
- **Honest labeling** — every tool declares a status (`available`, `experimental`, `coming-soon`) and a processing mode (`local`, `server-assisted`, `unsupported`). See `/tools/status`.
- **No AI, no paid APIs** — this is a static/serverless app designed to run near domain-cost.

## Tech stack

- **Next.js 16** (App Router, TypeScript strict, React 19)
- **Tailwind CSS 4**
- **pdf-lib** (PDF creation/editing) + **pdfjs-dist** (PDF rendering to images)
- **JSZip** (archive creation/extraction)
- **tesseract.js** (local, in-browser OCR — lazy-loaded only on `/pdf/ocr`; see [`docs/OCR.md`](docs/OCR.md))
- Everything else (image processing, hashing, text/data tools) uses native browser APIs (`Canvas`, `Web Crypto`, `DOMParser`) — no extra dependency

No database, no auth provider, no payment processor, no AI API.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project structure

```
src/
  app/                 Route pages (App Router) — one folder per tool/category
  components/
    home/              Homepage sections
    layout/            Header, Footer
    tools/             Shared tool UI: DropZone, FileWorkflow, TextWorkflow, ToolCard, ...
    ui/                Small primitives: Button, Badge
  lib/
    tools/             Tool registry (metadata: name, category, accepted types, status, FAQ)
    processors/        Pure conversion logic (pdf.ts, image.ts, archive.ts, data.ts, markdown.ts, text-documents.ts, ocr.ts)
    file-detection/    Extension + magic-byte sniffing
    security/          File validation, SVG sanitization, ZIP-bomb guard, archive path sanitization
    download/          Object URL lifecycle + ZIP-of-results download
    format.ts          Byte formatting, filename helpers
e2e/                   Playwright end-to-end tests (+ fixtures/)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design, [`docs/TOOLS.md`](docs/TOOLS.md) for how to add a new tool, [`docs/PRIVACY-MODEL.md`](docs/PRIVACY-MODEL.md) for the privacy architecture, and [`docs/OCR.md`](docs/OCR.md) for the OCR engine, self-hosted assets, and verified-language policy.

## Testing

```bash
npm run test          # unit tests (Vitest)
npm run test:watch    # unit tests, watch mode
npm run test:e2e      # Playwright end-to-end tests (builds + serves the app first)
```

E2E tests cover real file uploads and downloads — merged PDFs are re-parsed with `pdf-lib` to check page counts, converted images are checked for correct magic bytes, and error states are exercised with intentionally bad input.

## Building & running

```bash
npm run build
npm run start
```

## Linting & types

```bash
npm run lint
npx tsc --noEmit
```

## Known limitations

- **PDF compress** performs a lossless structural re-save (compressed cross-reference streams). It does not re-sample embedded images, so savings are modest on already-optimized files.
- **SVG to PNG** is marked experimental — very complex SVGs (filters, external references) may not rasterize perfectly.
- **OCR PDF** is marked experimental — strong accuracy on clean/typed scans (verified, see `docs/OCR.md`), but no rotation auto-detection, no deskew, no handwriting support, and heavy scan noise reduces accuracy significantly.
- **DOCX/PPTX/XLSX conversion, PDF password protect/unlock, and audio/video conversion** are not implemented in V1. They would require server-side processing (e.g. LibreOffice, ffmpeg) or licensed libraries that don't have a reliable, free, purely client-side equivalent yet. They're listed as "Coming soon" on `/tools/status` rather than faked.
- **Markdown support** covers common syntax (headings, bold/italic, links, lists, blockquotes, fenced code, hr) — it is not a full CommonMark implementation.

## Deployment

Designed for Vercel's free tier: fully static/serverless, no database, no long-running processes. See `docs/ARCHITECTURE.md` for details.
