import Link from "next/link";
import { ToolIcon } from "@/components/brand/ToolIcon";
import { IconArrowUpRight, IconLock } from "@/components/icons";
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
        <section className="container-x pb-16 pt-8 sm:pb-24 sm:pt-12">
          <nav aria-label="Breadcrumb" className="mb-8 text-sm text-[var(--ink-2)]">
            <ol className="flex items-center gap-2">
              <li>
                <Link href="/tools" className="hover:text-[var(--ink)]">
                  All tools
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li>{CATEGORY_LABEL[tool.category]}</li>
            </ol>
          </nav>

          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <ToolIcon id={tool.id} category={tool.category} size="lg" />
              <h1 className="h1 mt-5">{tool.name}</h1>
              <p className="lead mt-4 max-w-xl">{lead}</p>
            </div>
            <p className="flex items-center gap-2 text-sm text-[var(--ink-2)] sm:pb-2">
              <IconLock className="h-4 w-4" />
              Processed in your browser — never uploaded
            </p>
          </div>

          <div className="mt-10 sm:mt-12">{children}</div>
        </section>

        <section className="rule-t" aria-labelledby="how-heading">
          <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
            <h2 id="how-heading" className="h2">
              <span className="muted-display">How it</span>
              <br />
              works.
            </h2>
            <ol className="grid gap-6 sm:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step} className="border-t border-[var(--ink)] pt-4">
                  <span className="tabular text-sm font-medium text-[var(--ink-2)]">0{i + 1}</span>
                  <p className="mt-2 text-[1.0625rem] font-medium leading-snug tracking-[-0.01em]">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {notes && notes.length > 0 && (
          <section className="rule-t" aria-labelledby="notes-heading">
            <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
              <h2 id="notes-heading" className="h2">
                <span className="muted-display">Good</span>
                <br />
                to know.
              </h2>
              <dl className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
                {notes.map((n) => (
                  <div key={n.title}>
                    <dt className="h3">{n.title}</dt>
                    <dd className="mt-2 leading-relaxed text-[var(--ink-2)]">{n.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>
        )}

        <section className="rule-t" aria-labelledby="faq-heading">
          <div className="container-x section-y grid gap-10 lg:grid-cols-[1fr_2fr]">
            <h2 id="faq-heading" className="h2">
              Questions
              <br />
              <span className="muted-display">answered.</span>
            </h2>
            <Faq items={tool.faq} />
          </div>
        </section>

        <section className="rule-t" aria-labelledby="related-heading">
          <div className="container-x section-y">
            <h2 id="related-heading" className="h3">
              Often used next
            </h2>
            <ul className="mt-6 grid gap-3 sm:grid-cols-3">
              {related.map((id) => {
                const t = getTool(id);
                return (
                  <li key={id}>
                    <Link href={t.href} className="card group flex h-full items-center gap-4 p-4 transition-shadow hover:shadow-[var(--shadow-2)]">
                      <ToolIcon id={t.id} category={t.category} />
                      <span className="flex-1 font-semibold tracking-[-0.01em]">{t.name}</span>
                      <IconArrowUpRight className="h-4 w-4 text-[var(--ink-3)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--ink)]" />
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
