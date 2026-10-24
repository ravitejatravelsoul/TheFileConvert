import Link from "next/link";
import { ToolIcon, toneStyle } from "@/components/brand/ToolIcon";
import { IconArrowRight, IconLock } from "@/components/icons";
import { CATEGORY_LABEL, getTool, type Tool, type ToolId } from "@/lib/tools/registry";
import { jsonLdScript, toolJsonLd } from "@/lib/seo";
import { Faq } from "./Faq";

interface ToolPageProps {
  tool: Tool;
  lead: string;
  steps: [string, string, string];
  notes?: { title: string; body: string }[];
  related: ToolId[];
  children: React.ReactNode;
}

/** Shared frame for every tool page: title, the working area, then the reference content. */
export function ToolPage({ tool, lead, steps, notes, related, children }: ToolPageProps) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(toolJsonLd(tool)) }} />
      <div className="frame">
        <section className="tool-hero" style={toneStyle(tool.category)}>
          <div className="container-x pb-16 pt-8 sm:pb-24 sm:pt-12">
            <nav aria-label="Breadcrumb" className="mb-8 text-sm text-[var(--ink-2)]">
              <ol className="flex items-center gap-2">
                <li>
                  <Link href="/tools" className="inline-flex min-h-8 items-center hover:text-[var(--ink)]">
                    All tools
                  </Link>
                </li>
                <li aria-hidden="true" className="text-[var(--ink-3)]">
                  /
                </li>
                <li className="font-medium text-[var(--ink)]">{CATEGORY_LABEL[tool.category]}</li>
              </ol>
            </nav>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex max-w-2xl flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
                <span className="self-start rounded-[20px] bg-white p-1.5 shadow-[var(--shadow-2)] ring-1 ring-[var(--line)] sm:mt-1">
                  <ToolIcon id={tool.id} category={tool.category} size="lg" />
                </span>
                <div>
                  <h1 className="h1">{tool.name}</h1>
                  <p className="lead mt-4 max-w-xl">{lead}</p>
                </div>
              </div>
              <p className="pill self-start text-[var(--ink-2)] sm:mb-2 sm:self-auto">
                <span className="status-dot" aria-hidden="true" />
                <IconLock className="h-3.5 w-3.5" />
                Processed in your browser — never uploaded
              </p>
            </div>

            <div className="mt-10 sm:mt-12">{children}</div>
          </div>
        </section>

        <section className="band" aria-labelledby="how-heading">
          <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="kicker">Three steps</p>
              <h2 id="how-heading" className="h2 mt-4">
                <span className="muted-display">How it</span>
                <br />
                works.
              </h2>
            </div>
            <ol className="grid gap-4 sm:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step} className="card p-6">
                  <span className="step-num">0{i + 1}</span>
                  <p className="mt-5 text-[1.0625rem] font-medium leading-snug tracking-[-0.01em]">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {notes && notes.length > 0 && (
          <section aria-labelledby="notes-heading">
            <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
              <div>
                <p className="kicker">Details</p>
                <h2 id="notes-heading" className="h2 mt-4">
                  <span className="muted-display">Good</span>
                  <br />
                  to know.
                </h2>
              </div>
              <dl className="grid gap-4 sm:grid-cols-2">
                {notes.map((n) => (
                  <div key={n.title} className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]/70 p-6">
                    <dt className="h3">{n.title}</dt>
                    <dd className="mt-2 leading-relaxed text-[var(--ink-2)]">{n.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        )}

        <section className={notes && notes.length > 0 ? "band" : "rule-t"} aria-labelledby="faq-heading">
          <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
            <div>
              <p className="kicker">FAQ</p>
              <h2 id="faq-heading" className="h2 mt-4">
                Questions
                <br />
                <span className="muted-display">answered.</span>
              </h2>
            </div>
            <Faq items={tool.faq} />
          </div>
        </section>

        <section aria-labelledby="related-heading">
          <div className="container-x section-y">
            <h2 id="related-heading" className="h3">
              Often used next
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {related.map((id) => {
                const t = getTool(id);
                return (
                  <li key={id}>
                    <Link href={t.href} className="card card-link group flex h-full items-center gap-4 p-4">
                      <ToolIcon id={t.id} category={t.category} />
                      <span className="flex-1 font-semibold tracking-[-0.01em]">{t.name}</span>
                      <span className="cta-arrow" aria-hidden="true">
                        <IconArrowRight className="h-4 w-4" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
