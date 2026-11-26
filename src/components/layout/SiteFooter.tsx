import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { ToolGlyph } from "@/components/brand/ToolIcon";
import { IconArrowRight, IconLock } from "@/components/icons";
import { CATEGORY_LABEL, toolsInCategory, type ToolCategory } from "@/lib/tools/registry";

const COLUMNS: ToolCategory[] = ["compress", "convert", "organize", "edit"];

export function SiteFooter() {
  return (
    <footer className="glow-dark relative isolate overflow-hidden text-white" aria-labelledby="footer-heading">
      <div className="grid-dark absolute inset-0 -z-10" aria-hidden="true" />
      <div className="container-x pb-10 pt-20 sm:pt-24">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <h2 id="footer-heading" className="h2 max-w-3xl">
              <span className="text-white/45">Every file.</span>
              <br />
              One simple place.
            </h2>
            <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-white/65">
              Convert, compress and edit files without the clutter — and without sending them anywhere.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
            <Link href="/#start" className="btn btn-light btn-lg">
              Choose a file
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/tools" className="btn btn-lg text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.22)] hover:bg-white/10">
              Browse all tools
            </Link>
          </div>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-x-6 gap-y-10 rounded-[var(--radius-xl)] border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-4 sm:p-8">
          {COLUMNS.map((category) => (
            <div key={category}>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/45">{CATEGORY_LABEL[category]}</p>
              <ul className="mt-3 space-y-1">
                {toolsInCategory(category).map((tool) => (
                  <li key={tool.id}>
                    <Link href={tool.href} className="group inline-flex min-h-9 items-center gap-2 text-[0.9375rem] text-white/85 transition-colors hover:text-white">
                      {/* glyph fills match the dark footer instead of the light tile they're drawn for */}
                      <span style={{ ["--glyph-fill" as string]: "#1f1e1c" }} className="inline-flex">
                        <ToolGlyph id={tool.id} className="h-4 w-4 text-white/40 transition-colors group-hover:text-[var(--accent)]" />
                      </span>
                      {tool.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-white/12 pt-6 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-2.5">
              <LogoMark size={22} />
              <span>© {new Date().getFullYear()} TheFileConvert</span>
            </span>
            <span className="text-white/65">Developed by Raviteja Vemulapelli</span>
            <span className="flex items-center gap-1.5 text-white/45">
              <IconLock className="h-3.5 w-3.5" /> Files never leave your device
            </span>
          </div>
          <nav aria-label="Legal" className="flex gap-5">
            <Link href="/tools" className="inline-flex min-h-9 items-center hover:text-white">
              All tools
            </Link>
            <Link href="/privacy" className="inline-flex min-h-9 items-center hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="inline-flex min-h-9 items-center hover:text-white">
              Terms
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
