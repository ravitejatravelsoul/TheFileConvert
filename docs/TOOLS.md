# Tools

## Current tool count

- **PDF**: 12 available (merge, split, extract pages, delete pages, rotate, reorder,
  images→PDF, PDF→images, page numbers, watermark, metadata viewer/remover, compress)
- **Image**: 11 available + 1 experimental (compress, resize, crop, rotate/flip, remove
  metadata, 6 format-conversion routes, SVG→PNG as experimental)
- **Data & Developer**: 11 available (JSON formatter/minifier/validator, XML formatter,
  CSV↔JSON, Base64 encode/decode, URL encode/decode, case converter, word counter, UUID
  generator, hash generator, text diff)
- **Document**: 4 available (Markdown→HTML, Markdown→PDF, TXT→PDF, TXT→HTML)
- **Archive**: 2 available (create ZIP, extract ZIP)
- **Roadmap ("Coming soon")**: PDF protect/unlock, DOCX↔PDF, video→audio, media trim —
  intentionally not built in V1 because they need server infrastructure or a licensed
  engine we don't have a free, reliable, purely-client-side equivalent for yet.

The canonical, always-up-to-date list is the tool registry itself
(`src/lib/tools/*.ts`), rendered at `/tools/status`.

## Adding a new local tool

1. **Write the processor.** Add a pure function to the right file in
   `src/lib/processors/` (or a new file if it's a new category). It should take a `File`
   (or string, for text tools) plus an options object, and return a `Blob` (or string).
   Throw a `ProcessorError` with a user-facing message for expected failure cases
   (invalid input, corrupt file, unsupported feature) — `FileWorkflow`/`TextWorkflow`
   surface `error.message` directly to the user.
2. **Add unit tests** next to the processor (`your-file.test.ts`) covering the normal
   case, at least one edge case, and the error path.
3. **Register the tool** in the matching file under `src/lib/tools/` (`pdf-tools.ts`,
   `image-tools.ts`, `data-tools.ts`, ...): id, slug, href, name, description, accepted
   extensions/MIME types, `processingMode: "local"`, `status: "available"`, keywords,
   and `relatedToolIds`.
4. **Build the page.** Create `src/app/<category>/<slug>/page.tsx` (Server Component,
   exports `metadata`, renders `<ToolPageShell tool={tool}><YourWorkflow /></ToolPageShell>`)
   and `<slug>-workflow.tsx` (`"use client"`, wires `FileWorkflow`/`TextWorkflow` to your
   processor using the field components in `src/components/tools/fields.tsx`).
5. **Add it to `sitemap.ts`** — it's automatic: `liveTools` (everything not
   `coming-soon`) is included already.
6. **Smoke-test it.** `e2e/smoke.spec.ts` automatically visits every tool in
   `liveTools` and checks the page renders without a runtime error — no extra wiring
   needed. Add a dedicated `e2e/*.spec.ts` test if the tool has a non-trivial workflow
   worth exercising with a real file.

## Adding a tool that needs a server

Don't build it as if it were local. Instead:

1. Add it to `src/lib/tools/roadmap-tools.ts` with `processingMode: "server-assisted"`
   and `status: "coming-soon"`.
2. It will show up on `/tools/status` and the relevant category page as "Coming soon" —
   never linked as a working route, never advertised as functional.
3. When server infrastructure actually exists, flip its status, give it a real route,
   and update `docs/PRIVACY-MODEL.md` to disclose the upload before shipping it.

## Processing mode reference

| Mode              | Meaning                                                             |
| ------------------ | -------------------------------------------------------------------- |
| `local`            | Runs entirely in the browser. File never leaves the device.         |
| `server-assisted`  | Would require uploading the file to a server. Not implemented yet.  |
| `unsupported`      | Not technically feasible to support reliably; not on the roadmap.   |
