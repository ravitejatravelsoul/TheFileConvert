import type { ToolFaqItem } from "@/lib/tools/types";

export function Faq({ items, heading = "Frequently asked questions" }: { items: ToolFaqItem[]; heading?: string }) {
  if (items.length === 0) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--foreground)]">{heading}</h2>
      <div className="mt-4 divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        {items.map((item) => (
          <details key={item.question} className="group p-4 open:bg-[var(--surface-muted)]/40">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--foreground)]">
              {item.question}
              <span className="ml-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-2.5 text-sm text-[var(--foreground-muted)]">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
