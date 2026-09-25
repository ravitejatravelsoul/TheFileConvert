import Link from "next/link";
import { IconChevronRight } from "@/components/icons";
import { IconPdf, IconImage } from "@/components/icons";

// V2 keeps the homepage to the handful of things most people come here to do — everything else
// still has a working page, it just isn't the first thing shown.
const CATEGORIES = [
  { label: "Compress", blurb: "Shrink a PDF or photo to a size you choose, automatically.", href: "/pdf/compress", icon: IconPdf },
  { label: "Convert", blurb: "JPG, PNG, WebP, SVG, and images ↔ PDF.", href: "/convert/jpg-to-png", icon: IconImage },
  { label: "Edit PDF", blurb: "Add text, sign, highlight, OCR scans — right in your browser.", href: "/pdf/editor", icon: IconPdf },
  { label: "Organize PDF", blurb: "Merge, split, reorder, rotate, and delete pages.", href: "/pdf/merge", icon: IconPdf },
];

export function CategoriesShowcase() {
  return (
    <section className="bg-[var(--surface)] py-16 sm:py-20">
      <div className="container-page">
        <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
          Start with a category
        </h2>
        <p className="mt-2 max-w-xl text-[var(--foreground-muted)]">
          Built on the same fast, private, in-browser engine — no upload, no login.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATEGORIES.map(({ label, blurb, href, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="group relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--background)] p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-lifted)]"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--brand-soft)] text-[var(--brand)] transition-transform duration-200 group-hover:scale-110">
                <Icon className="h-6 w-6" />
              </div>
              <p className="mt-5 text-lg font-semibold text-[var(--foreground)]">{label}</p>
              <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">{blurb}</p>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--foreground-muted)]">Start</span>
                <IconChevronRight className="h-4 w-4 text-[var(--foreground-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--brand)]" />
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-6 text-sm text-[var(--foreground-muted)]">
          Need something else?{" "}
          <Link href="/tools" className="font-medium text-[var(--brand)] hover:underline">
            Browse every tool
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
