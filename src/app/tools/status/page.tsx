import type { Metadata } from "next";
import { allTools, CATEGORY_LABELS } from "@/lib/tools/registry";
import { StatusBadge, ProcessingModeBadge } from "@/components/ui/Badge";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Tool Status Directory",
  description: "Every tool on TheFileConvert, its processing mode, and whether it's available, experimental, or coming soon. Marketing never gets ahead of what's actually built.",
  path: "/tools/status",
});

export default function Page() {
  return (
    <div className="container-page py-12 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
        Tool status directory
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--foreground-muted)]">
        A complete, honest list of every tool on TheFileConvert — including what&apos;s still on the
        roadmap. If a tool isn&apos;t marked &ldquo;Available&rdquo;, it isn&apos;t live yet.
      </p>

      <div className="mt-10 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)]">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-left">
              <th className="px-4 py-3 font-semibold text-[var(--foreground)]">Tool</th>
              <th className="px-4 py-3 font-semibold text-[var(--foreground)]">Category</th>
              <th className="px-4 py-3 font-semibold text-[var(--foreground)]">Input</th>
              <th className="px-4 py-3 font-semibold text-[var(--foreground)]">Output</th>
              <th className="px-4 py-3 font-semibold text-[var(--foreground)]">Processing</th>
              <th className="px-4 py-3 font-semibold text-[var(--foreground)]">Status</th>
            </tr>
          </thead>
          <tbody>
            {allTools.map((tool) => (
              <tr key={tool.id} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-3 font-medium text-[var(--foreground)]">{tool.name}</td>
                <td className="px-4 py-3 text-[var(--foreground-muted)]">{CATEGORY_LABELS[tool.category]}</td>
                <td className="px-4 py-3 text-[var(--foreground-muted)] uppercase">
                  {tool.acceptedExtensions.filter((e) => e !== "*").join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-[var(--foreground-muted)] uppercase">
                  {tool.outputExtensions.filter((e) => e !== "*").join(", ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <ProcessingModeBadge mode={tool.processingMode} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={tool.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
