import type { Metadata } from "next";
import Link from "next/link";
import { ToolIcon, toneStyle } from "@/components/brand/ToolIcon";
import { IconArrowRight } from "@/components/icons";
import { CATEGORY_LABEL, toolsInCategory, type ToolCategory } from "@/lib/tools/registry";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "All tools",
  description: "Every TheFileConvert tool in one place: compress, convert, organize and edit PDFs and images in your browser.",
  path: "/tools",
});

const ORDER: { category: ToolCategory; blurb: string }[] = [
  { category: "compress", blurb: "Hit a size limit without guessing." },
  { category: "convert", blurb: "Change format, nothing else." },
  { category: "organize", blurb: "Put pages where they belong." },
  { category: "edit", blurb: "Fix, mark up and sign." },
];

export default function ToolsPage() {
  return (
    <div className="frame">
      <section className="relative isolate">
        <div className="hero-backdrop" aria-hidden="true" />
        <div className="container-x pb-12 pt-10 sm:pb-16 sm:pt-16">
        <p className="kicker">Ten tools · all in your browser</p>
        <h1 className="h1 mt-4">
          <span className="muted-display">All</span> tools.
        </h1>
        <p className="lead mt-4 max-w-lg">Ten focused tools for PDFs and images. Each one does one job, right in your browser.</p>
        </div>
      </section>
      {ORDER.map(({ category, blurb }, i) => (
        <section key={category} className={i % 2 === 0 ? "band" : ""} aria-labelledby={`cat-${category}`}>
          <div className="container-x grid gap-8 py-12 sm:py-16 lg:grid-cols-[1fr_3fr]">
            <div style={toneStyle(category)}>
              <span aria-hidden="true" className="mb-4 block h-1.5 w-10 rounded-full bg-[var(--tone)]" />
              <h2 id={`cat-${category}`} className="text-2xl font-semibold tracking-[-0.03em]">
                {CATEGORY_LABEL[category]}
              </h2>
              <p className="mt-1.5 text-[var(--ink-2)]">{blurb}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {toolsInCategory(category).map((tool) => (
                <li key={tool.id}>
                  <Link href={tool.href} className="card card-link group flex h-full flex-col p-5 sm:p-6">
                    <div className="flex items-start justify-between">
                      <ToolIcon id={tool.id} category={tool.category} />
                      <span className="cta-arrow" aria-hidden="true">
                        <IconArrowRight className="h-4 w-4" />
                      </span>
                    </div>
                    <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em]">{tool.name}</h3>
                    <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-[var(--ink-2)]">{tool.short}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}
