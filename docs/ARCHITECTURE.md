# Architecture

## Goals

TheFileConvert is built to run at near-zero recurring cost while feeling like a polished
commercial product. That means:

- Static/serverless hosting (Vercel free tier compatible)
- No database, no auth, no payment processing
- Client-side processing wherever technically possible
- A tool architecture that scales to dozens of converters without duplicating UI code

## Request flow

Every route is either a static marketing/SEO page (Server Component) or a tool page that
pairs a static shell (metadata, headings, FAQ, related tools — all server-rendered) with a
small client component that owns the actual upload → configure → process → download
workflow.

```
page.tsx (Server Component)
  ├─ exports generateMetadata()/metadata from the tool registry
  ├─ renders <ToolPageShell tool={tool}> ... </ToolPageShell>
  └─ renders a client workflow component inside the shell
        │
        ▼
  *-workflow.tsx ("use client")
        │
        ├─ <FileWorkflow> or <TextWorkflow> (shared state machine + UI)
        │     idle → ready → processing → done/error
        │
        └─ calls a pure function from src/lib/processors/*
              (mergePdfs, convertImage, csvToJson, ...)
```

Server Components never receive function props from Client Components (and vice versa
isn't an issue here) — every tool page keeps its interactive logic in a small
`"use client"` file next to `page.tsx`, so `page.tsx` itself stays a Server Component and
can export `metadata` for SEO.

## The tool registry

`src/lib/tools/*.ts` is the single source of truth for what a tool is, whether it's live,
and how it should be discovered. A `ToolDefinition` never contains a function reference —
it's pure metadata (id, route, accepted file types, category, processing mode, status,
FAQ, related tool ids). This is what powers:

- The homepage's smart file-type detection (drop a file, see only compatible tools)
- `/tools` search and category browsing
- `/tools/status`, the honest "what's actually built" directory
- Per-tool SEO metadata and related-tools sections

Adding a new tool never requires touching the search UI, the homepage, or the status
page — they all read from the registry.

## Processing engine

`src/lib/processors/*.ts` holds pure, framework-free functions:

- `pdf.ts` — pdf-lib for document manipulation, pdfjs-dist (dynamically imported, lazy)
  for rendering pages to images
- `image.ts` — Canvas + `createImageBitmap` for compress/resize/crop/rotate/convert
- `archive.ts` — JSZip for create/inspect/extract, with a zip-bomb guard based on measured
  (not claimed) uncompressed size
- `data.ts` — JSON/XML/CSV formatting, hashing (Web Crypto `SubtleCrypto`), text utilities
- `markdown.ts` / `text-documents.ts` — a small hand-rolled Markdown parser (not full
  CommonMark) and PDF/HTML text rendering

These functions are unit-testable in isolation (see `src/lib/processors/*.test.ts`) and
never touch React, so they can be reused by any future workflow.

Heavy engines are dynamically imported only inside the function that needs them
(`pdfjs-dist` inside `pdfToImages`, `jszip` inside the archive/download helpers), so the
homepage bundle never pays for tools the visitor isn't using.

## Shared UI primitives

- `DropZone` — drag/drop + file picker, purely presentational
- `FileWorkflow` — the state machine for file-in/file-out tools: validates files against
  the tool's accepted types, tracks `idle/ready/processing/done/error`, renders results
  with per-file and "download all as ZIP" options, and shows a before/after size
  comparison when applicable
- `TextWorkflow` / `TextToBlobWorkflow` — the equivalent for paste-text tools (JSON
  formatter, hash generator, Markdown → PDF, etc.)
- `ToolPageShell` — the consistent per-tool page chrome: breadcrumb, H1, status badges,
  "how it works", FAQ, related tools

## Privacy model

See [`PRIVACY-MODEL.md`](./PRIVACY-MODEL.md).

## Why no generic "handler dispatch" engine

An earlier design considered giving every `ToolDefinition` a `handler` function and an
`optionsSchema`, then rendering options generically. In practice, tool options are too
different (page ranges vs. crop rectangles vs. hash algorithms) for a generic schema to
stay simple, so each tool page wires its own small options UI using the shared field
components in `src/components/tools/fields.tsx`. The registry stays pure metadata; the
`FileWorkflow`/`TextWorkflow` shell absorbs everything that actually is common
(validation, state machine, results, download).
