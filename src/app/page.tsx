import Link from "next/link";
import { SmartDrop } from "@/components/home/SmartDrop";
import { CompressVignette, ConvertVignette, EditorVignette, ImageCompressVignette, ImagesVignette, MergeVignette } from "@/components/home/Vignettes";
import { ToolIcon, toneStyle } from "@/components/brand/ToolIcon";
import { Faq } from "@/components/tool/Faq";
import { IconArrowRight, IconCheck, IconDevice, IconLock, IconPdf, IconScan, IconTarget } from "@/components/icons";
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
const MORE: ToolId[] = ["pdf-to-word", "split-pdf", "organize-pdf", "pdf-to-image"];

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
      <section className="relative isolate">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="container-x pb-14 pt-8 sm:pb-24 sm:pt-14 lg:pb-28 lg:pt-20">
          <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-[1.02fr_1fr] lg:gap-16">
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
              <ul className="mt-8 hidden flex-wrap gap-2 sm:flex">
                {[
                  { t: "Files stay on your device", icon: <IconLock className="h-3.5 w-3.5" /> },
                  { t: "Free, no sign-up", icon: <IconCheck className="h-3.5 w-3.5" strokeWidth={2.4} /> },
                  { t: "No watermarks", icon: <IconCheck className="h-3.5 w-3.5" strokeWidth={2.4} /> },
                ].map(({ t, icon }) => (
                  <li key={t} className="pill py-1.5 text-[0.8125rem] text-[var(--ink-2)]">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success)]">{icon}</span>
                    {t}
                  </li>
                ))}
              </ul>
              <p className="mt-6 hidden items-center gap-2 text-[0.8125rem] text-[var(--ink-2)] sm:flex">
                Works with
                {["PDF", "JPG", "PNG", "WebP", "SVG"].map((f) => (
                  <span key={f} className="rounded-md border border-[var(--line)] bg-[var(--surface)]/70 px-1.5 py-0.5 font-mono text-[0.72rem] font-medium text-[var(--ink)]">
                    {f}
                  </span>
                ))}
              </p>
            </div>
            <div id="start" className="relative animate-rise scroll-mt-24 [animation-delay:120ms]">
              <HeroFloats />
              <div className="stage">
                <SmartDrop />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Popular tools */}
      <section className="band" aria-labelledby="popular-heading">
        <div className="container-x section-y">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="kicker">Start here</p>
              <h2 id="popular-heading" className="h2 mt-4">
                <span className="muted-display">Popular</span> tools.
              </h2>
            </div>
            <Link href="/tools" className="btn btn-secondary self-start sm:self-auto">
              Browse all tools
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
            {POPULAR.map(({ id, art, wide }) => {
              const tool = getTool(id);
              return (
                <li key={id} className={wide ? "lg:col-span-2" : ""}>
                  <Link
                    href={tool.href}
                    className="card card-link group flex h-full flex-col overflow-hidden rounded-[var(--radius-xl)]"
                  >
                    <div className={`art border-b border-[var(--line)] px-5 pt-5 ${wide ? "h-44" : "h-36"}`} style={toneStyle(tool.category)}>
                      <div className="relative z-[1] h-full">{art}</div>
                    </div>
                    <div className="flex flex-1 flex-col p-5 sm:p-6">
                      <div className="flex items-center gap-3">
                        <ToolIcon id={tool.id} category={tool.category} size="sm" />
                        <h3 className="text-lg font-semibold tracking-[-0.02em]">{tool.name}</h3>
                      </div>
                      <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">{tool.short}</p>
                      <span className="mt-5 flex items-center justify-between gap-3 text-sm font-semibold">
                        Open {tool.name}
                        <span className="cta-arrow" aria-hidden="true">
                          <IconArrowRight className="h-4 w-4" />
                        </span>
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm text-[var(--ink-2)]">Also here:</span>
            {MORE.map((id) => {
              const t = getTool(id);
              return (
                <Link key={id} href={t.href} className="pill min-h-11 gap-2 py-1 pl-1.5 pr-3.5 hover:border-[var(--ink)]">
                  <ToolIcon id={id} category={t.category} size="sm" />
                  {t.name}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* One file, several possibilities */}
      <section aria-labelledby="possibilities-heading" className="relative isolate overflow-hidden">
        <div className="container-x section-y grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="kicker">Smart start</p>
            <h2 id="possibilities-heading" className="h2 mt-4">
              One file.
              <br />
              <span className="muted-display">Several possibilities.</span>
            </h2>
            <p className="lead mt-5 max-w-md">
              Drop a file on the homepage and see only what makes sense for it. A PDF offers compress, edit, Word, merge, split, images and page order. A photo offers compress, convert and PDF.
            </p>
            <Link href="#start" className="btn btn-primary mt-8">
              Try it with a file
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div aria-hidden="true" className="stage">
            <div className="rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-7">
              <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--band)] p-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[var(--ink)] text-white shadow-[var(--shadow-button)]">
                  <IconPdf className="h-5 w-5" />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">lease-agreement.pdf</span>
                  <span className="text-sm text-[var(--ink-2)]">12 pages · stays on this device</span>
                </span>
              </div>
              <p className="mt-5 text-sm font-semibold">Suggested for this PDF</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(["compress-pdf", "pdf-editor", "merge-pdf", "split-pdf", "pdf-to-image", "organize-pdf"] as ToolId[]).map((id, i) => {
                  const t = getTool(id);
                  return (
                    <span
                      key={id}
                      className={`flex items-center gap-2 rounded-[12px] border p-2 text-sm font-semibold ${i === 0 ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-[var(--surface)]"}`}
                    >
                      <ToolIcon id={id} category={t.category} size="sm" />
                      <span className="truncate">{t.name.replace(" PDF", "").replace("PDF ", "")}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature trio: target size, no-settings conversion, editor */}
      <section className="band-warm" aria-labelledby="features-heading">
        <div className="container-x section-y">
          <p className="kicker">Why it feels different</p>
          <h2 id="features-heading" className="h2 mt-4 max-w-3xl">
            Built around what you actually need —<span className="muted-display"> not around settings.</span>
          </h2>
          <div className="mt-12 grid gap-4 lg:grid-cols-3 lg:gap-5">
            <Feature
              tone="compress"
              icon={<IconTarget className="h-5 w-5" />}
              title="Say the size. Get the file."
              body="Upload forms ask for “under 1 MB”, not “quality 62”. Pick the size; we find the best quality that fits — and tell you honestly if it can't be done."
              href="/compress-pdf"
              cta="Compress a PDF"
              art={
                <div className="flex flex-wrap gap-1.5">
                  {["500 KB", "1 MB", "2 MB"].map((t) => (
                    <span key={t} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${t === "1 MB" ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line-strong)] bg-[var(--surface)]"}`}>
                      {t}
                    </span>
                  ))}
                </div>
              }
            />
            <Feature
              tone="convert"
              icon={<IconArrowRight className="h-5 w-5" />}
              title="Convert without the settings."
              body="Choose the format you need. JPG, PNG, WebP and SVG — sensible defaults, transparency kept where the format allows."
              href="/convert-image"
              cta="Convert an image"
              art={
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  {["JPG", "PNG", "WebP"].map((t, i) => (
                    <span key={t} className="flex items-center gap-1.5">
                      {i > 0 && <IconArrowRight className="h-3.5 w-3.5 text-[var(--ink-3)]" />}
                      <span className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 font-mono">{t}</span>
                    </span>
                  ))}
                </div>
              }
            />
            <Feature
              tone="edit"
              icon={<IconScan className="h-5 w-5" />}
              title="A real PDF editor, in a tab."
              body="Fix a typo in native text, correct a date in a scan with on-device OCR, highlight, draw, sign and add images."
              href="/pdf-editor"
              cta="Open the editor"
              art={
                <p className="text-sm text-[var(--ink-2)]">
                  Due <span className="rounded-[4px] bg-[var(--accent)] px-1 font-semibold text-[var(--ink)]">12/20/2026</span> — signed
                </p>
              }
            />
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="glow-dark relative isolate overflow-hidden text-white" aria-labelledby="privacy-heading">
        <div className="grid-dark absolute inset-0 -z-10" aria-hidden="true" />
        <div className="container-x section-y grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="kicker kicker-dark">Private by design</p>
            <h2 id="privacy-heading" className="h2 mt-4">
              <span className="text-white/45">Your files</span>
              <br />
              never leave this tab.
            </h2>
            <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-white/65">
              TheFileConvert is built so that it can&rsquo;t see your documents. Processing happens with your browser&rsquo;s own engine, on your device.
            </p>
            <Link href="/privacy" className="btn btn-light mt-8">
              How privacy works here
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: <IconDevice className="h-5 w-5" />, title: "Processed on your device", body: "Compression, conversion, OCR and editing run in the browser. No file is ever sent to a server." },
              { icon: <IconLock className="h-5 w-5" />, title: "No account, no storage", body: "Nothing to sign up for, and nothing is kept once you close the tab." },
              { icon: <IconScan className="h-5 w-5" />, title: "OCR included", body: "Text recognition runs locally too — scanned IDs and contracts don't go to a cloud service." },
              { icon: <IconCheck className="h-5 w-5" />, title: "You can check", body: "Open your browser's network panel while a file is processed: you'll see no upload." },
            ].map((p) => (
              <li key={p.title} className="rounded-[var(--radius-lg)] border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition-colors hover:bg-white/[0.07]">
                <span className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[var(--accent)] text-[var(--ink)]">{p.icon}</span>
                <p className="mt-4 font-semibold tracking-[-0.01em]">{p.title}</p>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-white/60">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading">
        <div className="container-x section-y">
          <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="kicker">Three steps</p>
              <h2 id="how-heading" className="h2 mt-4">
                <span className="muted-display">How it</span>
                <br />
                works.
              </h2>
            </div>
            <ol className="relative grid gap-4 sm:grid-cols-3">
              <span aria-hidden="true" className="absolute left-[16%] right-[16%] top-[42px] hidden border-t border-dashed border-[var(--line-strong)] sm:block" />
              {[
                { t: "Drop your file", b: "Or tap to choose one. It opens right here — no upload bar, no waiting in a queue." },
                { t: "Pick what you need", b: "A target size, a format, pages to keep or text to fix. One clear choice at a time." },
                { t: "Download", b: "Get the result with its exact size. Your original is never changed." },
              ].map((s, i) => (
                <li key={s.t} className="card relative p-6">
                  <span className="step-num">0{i + 1}</span>
                  <p className="mt-5 text-lg font-semibold tracking-[-0.02em]">{s.t}</p>
                  <p className="mt-1.5 leading-relaxed text-[var(--ink-2)]">{s.b}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="band" aria-labelledby="faq-heading">
        <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
          <div>
            <p className="kicker">FAQ</p>
            <h2 id="faq-heading" className="h2 mt-4">
              Questions
              <br />
              <span className="muted-display">answered.</span>
            </h2>
            <p className="mt-5 max-w-xs leading-relaxed text-[var(--ink-2)]">
              Anything else?{" "}
              <Link href="/privacy" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4 hover:decoration-[var(--ink)]">
                Read how privacy works
              </Link>
              .
            </p>
          </div>
          <Faq items={HOME_FAQ} />
        </div>
      </section>
    </div>
  );
}

/** Two small illustrative file cards floating around the uploader (wide screens only, decorative). */
function HeroFloats() {
  const compress = getTool("compress-pdf");
  const convert = getTool("convert-image");
  return (
    <div aria-hidden="true">
      <div className="float-card -left-12 top-10 z-10 hidden xl:flex">
        <ToolIcon id={compress.id} category={compress.category} size="sm" />
        <span className="text-left leading-tight">
          <span className="block text-[0.8125rem] font-semibold">report.pdf</span>
          <span className="tabular text-xs text-[var(--ink-2)]">
            4.2 MB <span className="text-[var(--ink-3)]">→</span> <span className="font-semibold text-[var(--success)]">890 KB</span>
          </span>
        </span>
      </div>
      <div className="float-card -right-6 bottom-20 z-10 hidden [animation-delay:-3.5s] xl:flex">
        <ToolIcon id={convert.id} category={convert.category} size="sm" />
        <span className="text-left leading-tight">
          <span className="block text-[0.8125rem] font-semibold">photo.png</span>
          <span className="text-xs text-[var(--ink-2)]">
            converted to <span className="font-semibold text-[var(--cat-convert)]">WebP</span>
          </span>
        </span>
      </div>
    </div>
  );
}

const FEATURE_TONE = {
  compress: "bg-[var(--cat-compress-soft)] text-[var(--cat-compress)]",
  convert: "bg-[var(--cat-convert-soft)] text-[var(--cat-convert)]",
  edit: "bg-[var(--accent)] text-[var(--ink)]",
} as const;

function Feature({
  tone,
  icon,
  title,
  body,
  href,
  cta,
  art,
}: {
  tone: keyof typeof FEATURE_TONE;
  icon: React.ReactNode;
  title: string;
  body: string;
  href: string;
  cta: string;
  art: React.ReactNode;
}) {
  return (
    <Link href={href} className="card card-link group flex flex-col overflow-hidden rounded-[var(--radius-xl)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] bg-[var(--band)] px-6 py-5 sm:px-7">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${FEATURE_TONE[tone]}`}>{icon}</span>
        <div aria-hidden="true">{art}</div>
      </div>
      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <h3 className="text-xl font-semibold tracking-[-0.025em]">{title}</h3>
        <p className="mt-2 flex-1 leading-relaxed text-[var(--ink-2)]">{body}</p>
        <span className="mt-6 flex items-center justify-between gap-3 text-sm font-semibold">
          {cta}
          <span className="cta-arrow" aria-hidden="true">
            <IconArrowRight className="h-4 w-4" />
          </span>
        </span>
      </div>
    </Link>
  );
}
