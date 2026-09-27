import type { ToolFaq } from "@/lib/tools/registry";

/** Native <details> accordion: works without JavaScript and with every screen reader. */
export function Faq({ items }: { items: ToolFaq[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <details key={item.q} className="group card overflow-hidden transition-[border-color,box-shadow] duration-300 open:border-[var(--line-strong)] open:shadow-[var(--ring-highlight),var(--shadow-3)]" open={i === 0}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="tabular flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--band)] text-xs font-semibold text-[var(--ink-2)] ring-1 ring-[var(--line)] transition-colors group-open:bg-[var(--accent)] group-open:text-[var(--ink)] group-open:ring-transparent">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 font-semibold tracking-[-0.01em]">{item.q}</span>
            <span aria-hidden="true" className="relative h-3.5 w-3.5 shrink-0">
              <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-[var(--ink)]" />
              <span className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-[var(--ink)] transition-transform duration-200 group-open:scale-y-0" />
            </span>
          </summary>
          <p className="border-t border-[var(--line)] px-5 py-4 leading-relaxed text-[var(--ink-2)] sm:pl-[4.25rem]">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
