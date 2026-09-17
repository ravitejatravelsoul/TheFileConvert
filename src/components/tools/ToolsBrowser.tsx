"use client";

import { useMemo, useState } from "react";
import { IconSearch } from "@/components/icons";
import { ToolCard } from "@/components/tools/ToolCard";
import { allTools, searchTools, CATEGORY_LABELS, POPULAR_TOOL_IDS } from "@/lib/tools/registry";
import type { ToolCategory } from "@/lib/tools/types";

const TABS: { label: string; value: ToolCategory | "all" | "popular" }[] = [
  { label: "Popular", value: "popular" },
  { label: "All", value: "all" },
  { label: CATEGORY_LABELS.pdf, value: "pdf" },
  { label: CATEGORY_LABELS.image, value: "image" },
  { label: CATEGORY_LABELS.document, value: "document" },
  { label: CATEGORY_LABELS.data, value: "data" },
  { label: CATEGORY_LABELS.archive, value: "archive" },
  { label: CATEGORY_LABELS.media, value: "media" },
];

const POPULAR_IDS = new Set(POPULAR_TOOL_IDS);

export function ToolsBrowser({ initialQuery = "" }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [tab, setTab] = useState<ToolCategory | "all" | "popular">("popular");

  const results = useMemo(() => {
    if (query.trim()) return searchTools(query);
    if (tab === "popular") return allTools.filter((t) => POPULAR_IDS.has(t.id));
    if (tab === "all") return allTools;
    return allTools.filter((t) => t.category === tab);
  }, [query, tab]);

  return (
    <div>
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--foreground-muted)]" />
        <input
          type="search"
          aria-label="Search file tools"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 40+ file tools… (e.g. PDF to Word, compress image)"
          className="w-full rounded-full border border-[var(--border)] bg-[var(--surface)] py-3.5 pl-12 pr-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)]"
        />
      </div>

      {!query.trim() && (
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.value
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "bg-[var(--surface-muted)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <p className="mt-6 text-sm text-[var(--foreground-muted)]">
        {results.length} tool{results.length === 1 ? "" : "s"}
        {query.trim() ? ` matching "${query}"` : ""}
      </p>

      <div data-testid="tool-results" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>

      {results.length === 0 && (
        <p className="mt-10 text-center text-sm text-[var(--foreground-muted)]">
          No tools match that search yet. Try a different keyword.
        </p>
      )}
    </div>
  );
}
