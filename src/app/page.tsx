import Link from "next/link";
import { SmartDrop } from "@/components/home/SmartDrop";
import { CompressVignette, ConvertVignette, EditorVignette, ImageCompressVignette, ImagesVignette, MergeVignette } from "@/components/home/Vignettes";
import { ToolIcon } from "@/components/brand/ToolIcon";
import { Faq } from "@/components/tool/Faq";
import { IconArrowRight, IconArrowUpRight, IconCheck, IconDevice, IconLock, IconPdf, IconScan, IconTarget } from "@/components/icons";
import { getTool, type ToolId } from "@/lib/tools/registry";
import { SITE_NAME, SITE_URL, jsonLdScript } from "@/lib/seo";

const POPULAR: { id: ToolId; art: React.ReactNode; wide?: boolean }[] = [
  { id: "compress-pdf", art: <CompressVignette />, wide: true },
  { id: "pdf-editor", art: <EditorVignette />, wide: true },
  { id: "merge-pdf", art: <MergeVignette /> },
  { id: "compress-image", art: <ImageCompressVignette /> },
  { id: "convert-image", art: <ConvertVignette /> },
  { id: "image-to-pdf", art: <ImagesVignette /> },
];

const HOME_FAQ = [
  {
    q: "Are my files uploaded anywhere?",
    a: "No. Every tool runs inside your browser tab — the page downloads once, then your files are processed on your own device. Nothing is sent to a server, and nothing is stored after you close the tab.",
  },
  {
    q: "Do I need an account?",
    a: "No account, no sign-up, no email. Open a tool and use it.",
  },
  {
    q: "Is it free?",
    a: "Yes. There are no paid tiers, no watermarks and no daily limits.",
  },
  {
    q: "Which files work?",
    a: "PDF, JPG, PNG and WebP, plus SVG for conversion to PNG. Very large files depend on your device's memory; most everyday documents and photos are processed in seconds.",
  },
  {
    q: "Can I edit a scanned PDF?",
    a: "Yes. The PDF editor can read scanned text with OCR on your device, then let you click a word to correct it. The correction is matched to the scan as closely as possible — check the preview before exporting.",
  },
];

export default function Home() {
  return (
    <div className="frame">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: SITE_NAME,
            url: SITE_URL,
            description: "Compress, convert and edit PDFs and images directly in your browser.",
          }),
        }}
      />

      {/* Hero */}
      <section className="container-x pb-16 pt-8 sm:pb-28 sm:pt-16 lg:pt-20">
        <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="animate-rise">
            <p className="pill">
              <span className="status-dot" aria-hidden="true" />
              Runs in your browser — no uploads
            </p>
            <h1 className="display isolate mt-6">
              <span className="muted-display">Files in.</span>
              <br />
              Done in{" "}
              <span className="whitespace-nowrap">seconds.</span>
            </h1>
            <p className="lead mt-6 max-w-md">Compress, convert and edit your files directly in your browser. No account, no clutter.</p>
            <ul className="mt-8 hidden flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--ink-2)] sm:flex">
              {["Files stay on your device", "Free, no sign-up", "No watermarks"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <IconCheck className="h-4 w-4 text-[var(--success)]" strokeWidth={2.2} />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="animate-rise [animation-delay:120ms]">
            <SmartDrop />
          </div>
        </div>
      </section>

      {/* Popular tools */}
      <section className="rule-t" aria-labelledby="popular-heading">
        <div className="container-x section-y">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="popular-heading" className="h2">
              <span className="muted-display">Popular</span> tools.
            </h2>
            <Link href="/tools" className="group inline-flex items-center gap-1.5 font-medium">
              Browse all tools
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {POPULAR.map(({ id, art, wide }) => {
              const tool = getTool(id);
              return (
                <li key={id} className={wide ? "lg:col-span-2" : ""}>
                  <Link
                    href={tool.href}
                    className="group flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)] transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-3)]"
                  >
                    <div className={`hatch border-b border-[var(--line)] bg-[var(--surface-2)] px-5 pt-5 ${wide ? "h-44" : "h-36"}`}>{art}</div>
                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex items-center gap-3">
                        <ToolIcon id={tool.id} category={tool.category} size="sm" />
                        <h3 className="text-lg font-semibold tracking-[-0.02em]">{tool.name}</h3>
                      </div>
                      <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">{tool.short}</p>
                      <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold">
                        Open {tool.name}
                        <IconArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* One file, several possibilities */}
      <section className="rule-t" aria-labelledby="possibilities-heading">
        <div className="container-x section-y grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h2 id="possibilities-heading" className="h2">
              One file.
              <br />
              <span className="muted-display">Several possibilities.</span>
            </h2>
            <p className="lead mt-5 max-w-md">
              Drop a file on the homepage and see only what makes sense for it. A PDF offers compress, edit, merge, split, images and page order. A photo offers compress, convert and PDF.
            </p>
          </div>
          <div aria-hidden="true" className="card relative p-5 sm:p-7">
            <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--surface-2)] p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[var(--surface)]">
                <IconPdf className="h-5 w-5" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">lease-agreement.pdf</span>
                <span className="text-sm text-[var(--ink-2)]">12 pages</span>
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(["compress-pdf", "pdf-editor", "merge-pdf", "split-pdf", "pdf-to-image", "organize-pdf"] as ToolId[]).map((id, i) => {
                const t = getTool(id);
                return (
                  <span key={id} className={`flex items-center gap-2 rounded-[12px] border p-2 text-sm font-semibold ${i === 0 ? "border-[var(--ink)]" : "border-[var(--line)]"}`}>
                    <ToolIcon id={id} category={t.category} size="sm" />
                    <span className="truncate">{t.name.replace(" PDF", "").replace("PDF ", "")}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Feature trio: target size, no-settings conversion, editor */}
      <section className="rule-t" aria-labelledby="features-heading">
        <div className="container-x section-y">
          <h2 id="features-heading" className="h2 max-w-3xl">
            Built around what you actually need —<span className="muted-display"> not around settings.</span>
          </h2>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <Feature
              icon={<IconTarget className="h-5 w-5" />}
              title="Say the size. Get the file."
              body="Upload forms ask for “under 1 MB”, not “quality 62”. Pick the size; we find the best quality that fits — and tell you honestly if it can't be done."
              href="/compress-pdf"
              cta="Compress a PDF"
            />
            <Feature
              icon={<IconArrowRight className="h-5 w-5" />}
              title="Convert without the settings."
              body="Choose the format you need. JPG, PNG, WebP and SVG — sensible defaults, transparency kept where the format allows."
              href="/convert-image"
              cta="Convert an image"
            />
            <Feature
              icon={<IconScan className="h-5 w-5" />}
              title="A real PDF editor, in a tab."
              body="Fix a typo in native text, correct a date in a scan with on-device OCR, highlight, draw, sign and add images."
              href="/pdf-editor"
              cta="Open the editor"
            />
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="bg-[var(--ink)] text-white" aria-labelledby="privacy-heading">
        <div className="container-x section-y grid gap-12 lg:grid-cols-2">
          <div>
            <h2 id="privacy-heading" className="h2">
              <span className="text-white/45">Your files</span>
              <br />
              never leave this tab.
            </h2>
            <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-white/65">
              TheFileConvert is built so that it can&rsquo;t see your documents. Processing happens with your browser&rsquo;s own engine, on your device.
            </p>
            <Link href="/privacy" className="mt-8 inline-flex items-center gap-1.5 font-medium text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
              How privacy works here
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <ul className="grid gap-px overflow-hidden rounded-[var(--radius-xl)] bg-white/10 sm:grid-cols-2">
            {[
              { icon: <IconDevice className="h-5 w-5" />, title: "Processed on your device", body: "Compression, conversion, OCR and editing run in the browser. No file is ever sent to a server." },
              { icon: <IconLock className="h-5 w-5" />, title: "No account, no storage", body: "Nothing to sign up for, and nothing is kept once you close the tab." },
              { icon: <IconScan className="h-5 w-5" />, title: "OCR included", body: "Text recognition runs locally too — scanned IDs and contracts don't go to a cloud service." },
              { icon: <IconCheck className="h-5 w-5" />, title: "You can check", body: "Open your browser's network panel while a file is processed: you'll see no upload." },
            ].map((p) => (
              <li key={p.title} className="bg-[var(--ink)] p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/10">{p.icon}</span>
                <p className="mt-4 font-semibold tracking-[-0.01em]">{p.title}</p>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-white/60">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading">
        <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
          <h2 id="how-heading" className="h2">
            <span className="muted-display">How it</span>
            <br />
            works.
          </h2>
          <ol className="grid gap-6 sm:grid-cols-3">
            {[
              { t: "Drop your file", b: "Or tap to choose one. It opens right here — no upload bar, no waiting in a queue." },
              { t: "Pick what you need", b: "A target size, a format, pages to keep or text to fix. One clear choice at a time." },
              { t: "Download", b: "Get the result with its exact size. Your original is never changed." },
            ].map((s, i) => (
              <li key={s.t} className="border-t border-[var(--ink)] pt-4">
                <span className="tabular text-sm font-medium text-[var(--ink-2)]">0{i + 1}</span>
                <p className="mt-2 text-lg font-semibold tracking-[-0.02em]">{s.t}</p>
                <p className="mt-1.5 leading-relaxed text-[var(--ink-2)]">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* FAQ */}
      <section className="rule-t" aria-labelledby="faq-heading">
        <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
          <h2 id="faq-heading" className="h2">
            Questions
            <br />
            <span className="muted-display">answered.</span>
          </h2>
          <Faq items={HOME_FAQ} />
        </div>
      </section>
    </div>
  );
}

function Feature({ icon, title, body, href, cta }: { icon: React.ReactNode; title: string; body: string; href: string; cta: string }) {
  return (
    <Link href={href} className="card group flex flex-col p-6 transition-shadow duration-300 hover:shadow-[var(--shadow-3)] sm:p-7">
      <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--accent)] text-[var(--ink)]">{icon}</span>
      <h3 className="mt-6 text-xl font-semibold tracking-[-0.025em]">{title}</h3>
      <p className="mt-2 flex-1 leading-relaxed text-[var(--ink-2)]">{body}</p>
      <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold">
        {cta}
        <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
