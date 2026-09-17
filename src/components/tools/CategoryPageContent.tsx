import type { ToolCategory } from "@/lib/tools/types";
import { getToolsByCategory, CATEGORY_LABELS } from "@/lib/tools/registry";
import { ToolCard } from "@/components/tools/ToolCard";

const CATEGORY_INTROS: Record<ToolCategory, string> = {
  pdf: "Merge, split, compress, and edit PDF files — all processed locally in your browser.",
  image: "Compress, resize, crop, and convert images between JPG, PNG, and WebP.",
  document: "Convert plain text and Markdown into polished documents.",
  data: "Format, validate, and convert structured data and everyday developer utilities.",
  archive: "Create and extract ZIP archives without installing anything.",
  media: "Audio and video tools that need more processing power than a browser can safely offer for free — tracked here so we never overpromise.",
};

export function CategoryPageContent({ category }: { category: ToolCategory }) {
  const tools = getToolsByCategory(category);

  return (
    <div className="container-page py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
        {CATEGORY_LABELS[category]} tools
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--foreground-muted)]">{CATEGORY_INTROS[category]}</p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
