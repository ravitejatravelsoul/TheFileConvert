import Link from "next/link";
import { CATEGORY_LABELS, getToolsByCategory } from "@/lib/tools/registry";
import { CategoryIcon } from "@/components/tools/CategoryIcon";
import { IconChevronRight } from "@/components/icons";
import type { ToolCategory } from "@/lib/tools/types";

const CATEGORIES: { category: ToolCategory; blurb: string; href: string }[] = [
  { category: "pdf", blurb: "Merge, split, compress, and edit PDFs.", href: "/pdf" },
  { category: "image", blurb: "Compress, resize, and convert images.", href: "/image" },
  { category: "document", blurb: "Turn text and Markdown into documents.", href: "/document" },
  { category: "data", blurb: "Format JSON, XML, and everyday dev tools.", href: "/data" },
  { category: "archive", blurb: "Create and extract ZIP archives.", href: "/archive" },
  { category: "media", blurb: "Audio & video tools — on the roadmap.", href: "/media" },
];

export function CategoriesShowcase() {
  return (
    <section className="bg-[var(--surface)] py-16 sm:py-20">
      <div className="container-page">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
          All your files. One place.
        </h2>
        <p className="mt-2 max-w-xl text-[var(--foreground-muted)]">
          Every category of tool you need, built on the same fast, private engine.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CATEGORIES.map(({ category, blurb, href }) => {
            const count = getToolsByCategory(category).filter((t) => t.status !== "coming-soon").length;
            return (
              <Link
                key={category}
                href={href}
                className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--background)] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-lifted)]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-[var(--brand)] transition-transform duration-200 group-hover:scale-110">
                  <CategoryIcon category={category} className="h-6 w-6" />
                </div>
                <p className="mt-5 text-lg font-semibold text-[var(--foreground)]">{CATEGORY_LABELS[category]}</p>
                <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">{blurb}</p>
                <div className="mt-5 flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--foreground-muted)]">
                    {count > 0 ? `${count} tool${count === 1 ? "" : "s"}` : "Coming soon"}
                  </span>
                  <IconChevronRight className="h-4 w-4 text-[var(--foreground-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--brand)]" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
