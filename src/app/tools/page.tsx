import type { Metadata } from "next";
import Link from "next/link";
import { ToolsBrowser } from "@/components/tools/ToolsBrowser";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "All File Tools",
  description: "Browse and search every file tool on TheFileConvert — PDF, image, document, data, and archive utilities, all free.",
  path: "/tools",
});

export default function Page() {
  return (
    <div className="container-page py-12 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
            What do you want to do?
          </h1>
          <p className="mt-3 max-w-xl text-lg text-[var(--foreground-muted)]">
            Search or browse every tool on TheFileConvert.
          </p>
        </div>
        <Link href="/tools/status" className="text-sm font-medium text-[var(--brand)] hover:underline">
          View tool status directory →
        </Link>
      </div>

      <div className="mt-8">
        <ToolsBrowser />
      </div>
    </div>
  );
}
