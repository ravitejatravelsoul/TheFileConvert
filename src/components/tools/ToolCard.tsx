import Link from "next/link";
import type { ToolDefinition } from "@/lib/tools/types";
import { StatusBadge } from "@/components/ui/Badge";
import { IconChevronRight } from "@/components/icons";
import { CategoryIcon } from "@/components/tools/CategoryIcon";

export function ToolCard({ tool }: { tool: ToolDefinition }) {
  const isLive = tool.status !== "coming-soon";
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--brand-soft)] text-[var(--brand)]">
          <CategoryIcon category={tool.category} className="h-5 w-5" />
        </div>
        <StatusBadge status={tool.status} />
      </div>
      <p className="mt-4 font-semibold text-[var(--foreground)]">{tool.name}</p>
      <p className="mt-1 text-sm text-[var(--foreground-muted)] line-clamp-2">{tool.description}</p>
      {isLive && (
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--brand)] opacity-0 transition-opacity group-hover:opacity-100">
          Open tool <IconChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  if (!isLive) {
    return (
      <div className="group card-surface flex flex-col p-5 opacity-70">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={tool.href}
      className="group card-surface flex flex-col p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-[var(--shadow-lifted)]"
    >
      {content}
    </Link>
  );
}
