"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/ui/Button";
import { IconMenu, IconClose, IconChevronDown } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV_LINKS = [
  {
    label: "PDF",
    href: "/pdf",
    items: [
      { label: "Merge PDF", href: "/pdf/merge" },
      { label: "Split PDF", href: "/pdf/split" },
      { label: "Compress PDF", href: "/pdf/compress" },
      { label: "PDF to Images", href: "/pdf/to-images" },
      { label: "Images to PDF", href: "/pdf/images-to-pdf" },
      { label: "All PDF tools", href: "/pdf" },
    ],
  },
  {
    label: "Images",
    href: "/image",
    items: [
      { label: "Compress Image", href: "/image/compress" },
      { label: "Resize Image", href: "/image/resize" },
      { label: "JPG to PNG", href: "/convert/jpg-to-png" },
      { label: "PNG to WebP", href: "/convert/png-to-webp" },
      { label: "All image tools", href: "/image" },
    ],
  },
  {
    label: "Documents",
    href: "/document",
    items: [
      { label: "Markdown to PDF", href: "/document/markdown-to-pdf" },
      { label: "TXT to PDF", href: "/document/txt-to-pdf" },
      { label: "CSV to JSON", href: "/data/csv-to-json" },
      { label: "All document tools", href: "/document" },
    ],
  },
  {
    label: "More tools",
    href: "/tools",
    items: [
      { label: "Data & developer tools", href: "/data" },
      { label: "Archive tools", href: "/archive" },
      { label: "Audio & video (roadmap)", href: "/media" },
      { label: "All tools", href: "/tools" },
    ],
  },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? "glass-panel shadow-[var(--shadow-soft)]" : "bg-transparent"
      }`}
    >
      <div className="container-page flex h-16 items-center justify-between">
        <Logo />

        <nav className="hidden lg:flex items-center gap-1" aria-label="Primary">
          {NAV_LINKS.map((section) => (
            <div key={section.label} className="relative group">
              <Link
                href={section.href}
                className="flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                {section.label}
                <IconChevronDown className="h-3.5 w-3.5 text-[var(--foreground-muted)]" />
              </Link>
              <div className="invisible absolute left-0 top-full pt-2 opacity-0 transition-all duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="card-surface min-w-56 overflow-hidden p-2">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="block rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <Link
            href="/about"
            className="rounded-full px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            About
          </Link>
        </nav>

        <div className="hidden lg:flex items-center gap-3">
          <Link
            href="/tools"
            className="rounded-full px-4 py-2 text-sm font-medium text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          >
            Search tools
          </Link>
          <LinkButton href="/tools" size="md">
            Convert a File
          </LinkButton>
          <ThemeToggle />
        </div>

        <button
          type="button"
          className="lg:hidden inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <IconClose className="h-6 w-6" /> : <IconMenu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-[var(--border)] bg-[var(--surface)] animate-fade-in">
          <div className="container-page py-4 flex flex-col gap-1">
            {NAV_LINKS.map((section) => (
              <div key={section.label} className="py-2">
                <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                  {section.label}
                </p>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="block rounded-[var(--radius-sm)] px-2 py-2.5 text-sm text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
            <Link
              href="/about"
              onClick={() => setMobileOpen(false)}
              className="rounded-[var(--radius-sm)] px-2 py-2.5 text-sm font-medium text-[var(--foreground)] hover:bg-[var(--surface-muted)]"
            >
              About
            </Link>
            <LinkButton href="/tools" className="mt-3 w-full">
              Convert a File
            </LinkButton>
            <div className="mt-3 flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-2">
              <span className="text-sm text-[var(--foreground-muted)]">Appearance</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
