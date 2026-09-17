import Link from "next/link";
import { getPopularTools } from "@/lib/tools/registry";
import { ToolCard } from "@/components/tools/ToolCard";

export function PopularTools() {
  const tools = getPopularTools();

  return (
    <section className="container-page py-16 sm:py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
            Popular tools
          </h2>
          <p className="mt-2 text-[var(--foreground-muted)]">The tools people reach for most.</p>
        </div>
        <Link href="/tools" className="text-sm font-medium text-[var(--brand)] hover:underline">
          View all 40+ tools →
        </Link>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tools.map((tool, i) => (
          <div key={tool.id} className={`animate-fade-up stagger-${Math.min(i + 1, 6)}`}>
            <ToolCard tool={tool} />
          </div>
        ))}
      </div>
    </section>
  );
}
