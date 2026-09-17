import Link from "next/link";
import { Logo } from "@/components/Logo";

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "PDF",
    links: [
      { label: "PDF Editor", href: "/pdf/editor" },
      { label: "Merge PDF", href: "/pdf/merge" },
      { label: "Split PDF", href: "/pdf/split" },
      { label: "Compress PDF", href: "/pdf/compress" },
      { label: "PDF to Images", href: "/pdf/to-images" },
    ],
  },
  {
    title: "Images",
    links: [
      { label: "Compress Image", href: "/image/compress" },
      { label: "Resize Image", href: "/image/resize" },
      { label: "JPG to PNG", href: "/convert/jpg-to-png" },
      { label: "PNG to WebP", href: "/convert/png-to-webp" },
    ],
  },
  {
    title: "Data & Documents",
    links: [
      { label: "JSON Formatter", href: "/data/json-formatter" },
      { label: "CSV to JSON", href: "/data/csv-to-json" },
      { label: "Markdown to PDF", href: "/document/markdown-to-pdf" },
      { label: "Hash Generator", href: "/data/hash-generator" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "All tools", href: "/tools" },
      { label: "Privacy policy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--border)] bg-[var(--surface)]">
      <div className="container-page py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <Logo />
            <p className="mt-4 max-w-xs text-sm text-[var(--foreground-muted)]">
              Every file. Any format. Free. Convert, compress, and work with your files
              without creating an account.
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent-mint)]">
              Free &middot; Private &middot; No signup
            </p>
          </div>
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-semibold text-[var(--foreground)]">{column.title}</p>
              <ul className="mt-3 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--foreground-muted)] transition-colors hover:text-[var(--brand)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-[var(--border)] pt-6 text-xs text-[var(--foreground-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} TheFileConvert. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-[var(--foreground)]">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[var(--foreground)]">
              Terms
            </Link>
            <Link href="/tools" className="hover:text-[var(--foreground)]">
              Tool status
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
