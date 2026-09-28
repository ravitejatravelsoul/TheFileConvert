"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Wordmark } from "@/components/brand/Logo";
import { ToolIcon } from "@/components/brand/ToolIcon";
import { IconChevronDown, IconClose, IconLock, IconMenu, IconArrowRight } from "@/components/icons";
import { getTool } from "@/lib/tools/registry";
import { NAV_GROUPS, type NavGroup } from "./nav";

export function SiteHeader() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Close menus on navigation (adjusting state during render, not in an effect).
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpenMenu(null);
    setSheetOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenMenu(null);
    const onPointer = (e: PointerEvent) => {
      if (!(e.target as Element).closest("[data-nav-menu]")) setOpenMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [openMenu]);

  return (
    <header
      className={`sticky top-0 z-50 transition-[box-shadow,border-color] duration-300 ${
        scrolled ? "border-b border-[var(--line)] shadow-[0_8px_24px_-18px_rgb(45_38_20/0.35)]" : "border-b border-transparent"
      }`}
    >
      {/* The frosted background is its own layer: a backdrop-filter on the header itself would make it the
          containing block for the full-screen mobile menu inside it and squash that menu into the bar. */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 -z-10 transition-colors duration-300 ${scrolled ? "bg-[var(--paper)]/80 backdrop-blur-xl backdrop-saturate-150" : "bg-[var(--paper)]/60 backdrop-blur-md"}`}
      />
      <div className="container-x flex h-16 items-center gap-6">
        <Link href="/" className="-m-1 rounded-lg p-1" aria-label="TheFileConvert home">
          <Wordmark />
        </Link>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-0.5 rounded-full lg:ml-2 lg:flex">
          <NavMenu group={NAV_GROUPS[0]} open={openMenu} setOpen={setOpenMenu} pathname={pathname} />
          <NavMenu group={NAV_GROUPS[1]} open={openMenu} setOpen={setOpenMenu} pathname={pathname} />
          <NavLink href="/pdf-editor" active={pathname === "/pdf-editor"}>
            PDF Editor
          </NavLink>
          <NavMenu group={NAV_GROUPS[2]} open={openMenu} setOpen={setOpenMenu} pathname={pathname} />
          <NavLink href="/tools" active={pathname === "/tools"}>
            All tools
          </NavLink>
        </nav>

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <Link href="/privacy" className="pill hover:border-[var(--ink)]">
            <span className="status-dot" aria-hidden="true" />
            <IconLock className="h-3.5 w-3.5 text-[var(--ink-2)]" />
            Files stay on your device
          </Link>
        </div>

        <button
          type="button"
          className="-mr-2 ml-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink)] hover:bg-[var(--surface-2)] lg:hidden"
          aria-label="Open menu"
          aria-expanded={sheetOpen}
          aria-controls="mobile-menu"
          onClick={() => setSheetOpen(true)}
        >
          <IconMenu className="h-6 w-6" />
        </button>
      </div>

      {sheetOpen && <MobileSheet onClose={() => setSheetOpen(false)} />}
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="relative inline-flex h-10 items-center rounded-full px-3.5 text-[0.9375rem] font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink)] hover:shadow-[var(--shadow-1)] aria-[current=page]:text-[var(--ink)] aria-[current=page]:after:absolute aria-[current=page]:after:bottom-1 aria-[current=page]:after:left-1/2 aria-[current=page]:after:h-1 aria-[current=page]:after:w-1 aria-[current=page]:after:-translate-x-1/2 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-[var(--ink)] aria-[current=page]:after:content-['']"
    >
      {children}
    </Link>
  );
}

function NavMenu({
  group,
  open,
  setOpen,
  pathname,
}: {
  group: NavGroup;
  open: string | null;
  setOpen: (v: string | null) => void;
  pathname: string;
}) {
  const isOpen = open === group.label;
  const id = `menu-${group.label.toLowerCase().replace(/\s+/g, "-")}`;
  const active = group.tools.some((t) => getTool(t).href === pathname);
  return (
    <div className="relative" data-nav-menu>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setOpen(isOpen ? null : group.label)}
        className={`relative inline-flex h-10 items-center gap-1 rounded-full px-3.5 text-[0.9375rem] font-medium transition-colors hover:bg-[var(--surface)] hover:text-[var(--ink)] hover:shadow-[var(--shadow-1)] ${
          isOpen || active ? "text-[var(--ink)]" : "text-[var(--ink-2)]"
        } ${isOpen ? "bg-[var(--surface)] shadow-[var(--shadow-1)]" : ""}`}
      >
        {group.label}
        <IconChevronDown className={`h-4 w-4 text-[var(--ink-3)] transition-transform duration-300 ${isOpen ? "rotate-180 text-[var(--ink)]" : ""}`} />
        {active && <span aria-hidden="true" className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--ink)]" />}
      </button>
      {isOpen && (
        <div
          id={id}
          className="animate-sheet absolute left-0 top-[calc(100%+10px)] w-[360px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-float)]"
        >
          <p className="kicker px-5 pb-1 pt-4">{group.label}</p>
          <ul className="p-2">
            {group.tools.map((toolId) => {
              const tool = getTool(toolId);
              return (
                <li key={toolId}>
                  <Link
                    href={tool.href}
                    className="group/item flex items-start gap-3 rounded-[var(--radius-md)] p-3 transition-colors hover:bg-[var(--band)]"
                    onClick={() => setOpen(null)}
                  >
                    <ToolIcon id={tool.id} category={tool.category} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-[0.9375rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                        {tool.name}
                        <IconArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all duration-200 group-hover/item:translate-x-0 group-hover/item:opacity-100" />
                      </span>
                      <span className="mt-0.5 block text-[0.8125rem] leading-snug text-[var(--ink-2)]">{tool.short}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href="/tools"
            onClick={() => setOpen(null)}
            className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--band)] px-5 py-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
          >
            See all ten tools
            <IconArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}

function MobileSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        // Keep focus inside the open sheet.
        const focusables = panelRef.current.querySelectorAll<HTMLElement>("a[href], button");
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" id="mobile-menu">
      <div className="absolute inset-0 bg-[rgb(20_20_19/0.35)]" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="animate-sheet absolute inset-x-0 top-0 flex max-h-dvh flex-col overflow-y-auto rounded-b-[var(--radius-xl)] bg-[var(--paper)] pb-6">
        <div className="container-x flex h-16 shrink-0 items-center justify-between">
          <Link href="/" onClick={onClose} aria-label="TheFileConvert home">
            <Wordmark />
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-2)]"
          >
            <IconClose className="h-6 w-6" />
          </button>
        </div>
        <nav aria-label="Mobile" className="container-x space-y-6 pt-2">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="eyebrow mb-2 px-1">{group.label}</p>
              <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)]">
                {group.tools.map((toolId, i) => {
                  const tool = getTool(toolId);
                  return (
                    <li key={toolId} className={i > 0 ? "border-t border-[var(--line)]" : ""}>
                      <Link href={tool.href} onClick={onClose} className="flex min-h-14 items-center gap-3 px-3 py-2.5 active:bg-[var(--surface-2)]">
                        <ToolIcon id={tool.id} category={tool.category} size="sm" />
                        <span className="flex-1 text-base font-semibold tracking-[-0.01em]">{tool.name}</span>
                        <IconArrowRight className="h-4 w-4 text-[var(--ink-3)]" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="flex flex-col gap-3">
            <Link href="/tools" onClick={onClose} className="btn btn-primary btn-lg w-full">
              Browse all tools
            </Link>
            <p className="flex items-center justify-center gap-2 text-sm text-[var(--ink-2)]">
              <IconLock className="h-4 w-4" /> Files stay on your device
            </p>
          </div>
        </nav>
      </div>
    </div>
  );
}
