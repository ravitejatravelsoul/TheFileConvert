import type { ToolFaq } from "@/lib/tools/registry";

/** Native <details> accordion: works without JavaScript and with every screen reader. */
export function Faq({ items }: { items: ToolFaq[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <details key={item.q} className="group card overflow-hidden" open={i === 0}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="tabular w-6 shrink-0 text-sm text-[var(--ink-2)]">{String(i + 1).padStart(2, "0")}</span>
            <span className="flex-1 font-semibold tracking-[-0.01em]">{item.q}</span>
            <span aria-hidden="true" className="relative h-3.5 w-3.5 shrink-0">
              <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-[var(--ink)]" />
              <span className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-[var(--ink)] transition-transform duration-200 group-open:scale-y-0" />
            </span>
          </summary>
          <p className="border-t border-[var(--line)] px-5 py-4 pl-15 leading-relaxed text-[var(--ink-2)]">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
