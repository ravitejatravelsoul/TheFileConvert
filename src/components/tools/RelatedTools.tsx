import Link from "next/link";
import { getRelatedTools } from "@/lib/tools/registry";
import type { ToolDefinition } from "@/lib/tools/types";
import { IconChevronRight } from "@/components/icons";

export function RelatedTools({ tool, heading = "You may also want to" }: { tool: ToolDefinition; heading?: string }) {
  const related = getRelatedTools(tool);
  if (related.length === 0) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--foreground)]">{heading}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {related.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className="group flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 transition-all hover:border-[var(--brand)] hover:shadow-[var(--shadow-soft)]"
          >
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">{t.name}</p>
              <p className="mt-0.5 text-xs text-[var(--foreground-muted)] line-clamp-1">{t.description}</p>
            </div>
            <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand)]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
