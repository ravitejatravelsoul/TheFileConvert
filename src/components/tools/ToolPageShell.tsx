import type { ReactNode } from "react";
import Link from "next/link";
import type { ToolDefinition } from "@/lib/tools/types";
import { StatusBadge, ProcessingModeBadge } from "@/components/ui/Badge";
import { RelatedTools } from "./RelatedTools";
import { Faq } from "./Faq";
import { IconShield, IconChevronRight } from "@/components/icons";
import { CATEGORY_LABELS } from "@/lib/tools/registry";

interface ToolPageShellProps {
  tool: ToolDefinition;
  children: ReactNode;
  howItWorks?: string[];
  whyUse?: string[];
}

const DEFAULT_HOW_IT_WORKS = [
  "Upload or drop your file — nothing is sent to a server.",
  "Choose your options for this tool.",
  "Process the file instantly in your browser.",
  "Download the result. That's it.",
];

export function ToolPageShell({ tool, children, howItWorks, whyUse }: ToolPageShellProps) {
  const steps = howItWorks ?? DEFAULT_HOW_IT_WORKS;

  return (
    <div className="container-page py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
        <Link href="/" className="hover:text-[var(--foreground)] [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:px-1">
          Home
        </Link>
        <IconChevronRight className="h-3 w-3" />
        <Link href="/tools" className="hover:text-[var(--foreground)] [@media(pointer:coarse)]:inline-flex [@media(pointer:coarse)]:min-h-9 [@media(pointer:coarse)]:items-center [@media(pointer:coarse)]:px-1">
          Tools
        </Link>
        <IconChevronRight className="h-3 w-3" />
        <span>{CATEGORY_LABELS[tool.category]}</span>
        <IconChevronRight className="h-3 w-3" />
        <span className="text-[var(--foreground)]">{tool.name}</span>
      </nav>

      <div className="max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={tool.status} />
          <ProcessingModeBadge mode={tool.processingMode} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl text-balance">
          {tool.name}
        </h1>
        <p className="mt-3 text-lg text-[var(--foreground-muted)] text-balance">{tool.description}</p>
        {tool.processingMode === "local" && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-mint)]">
            <IconShield className="h-4 w-4" />
            Processed securely in your browser. Your file never leaves your device.
          </p>
        )}
      </div>

      <div className="mt-8 max-w-3xl">{children}</div>

      <div className="mt-16 grid gap-12 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-12">
          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">How it works</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {steps.map((step, i) => (
                <li
                  key={step}
                  className="flex gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand)]">
                    {i + 1}
                  </span>
                  <span className="text-sm text-[var(--foreground-muted)]">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {whyUse && whyUse.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Why use TheFileConvert</h2>
              <ul className="mt-4 space-y-2.5">
                {whyUse.map((reason) => (
                  <li key={reason} className="flex gap-2.5 text-sm text-[var(--foreground-muted)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    {reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tool.longDescription && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Good to know</h2>
              <p className="mt-3 text-sm leading-relaxed text-[var(--foreground-muted)]">{tool.longDescription}</p>
            </section>
          )}

          {tool.faq && <Faq items={tool.faq} />}
        </div>

        <div>
          <RelatedTools tool={tool} />
        </div>
      </div>
    </div>
  );
}
