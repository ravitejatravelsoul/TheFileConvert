import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { CATEGORY_LABEL, toolsInCategory, type ToolCategory } from "@/lib/tools/registry";

const COLUMNS: ToolCategory[] = ["compress", "convert", "organize", "edit"];

export function SiteFooter() {
  return (
    <footer className="bg-[var(--ink)] text-white" aria-labelledby="footer-heading">
      <div className="container-x pb-10 pt-20 sm:pt-24">
        <h2 id="footer-heading" className="h2 max-w-3xl">
          <span className="text-white/45">Every file.</span>
          <br />
          One simple place.
        </h2>
        <p className="mt-5 max-w-md text-[1.0625rem] leading-relaxed text-white/65">
          Convert, compress and edit files without the clutter — and without sending them anywhere.
        </p>

        <div className="mt-16 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
          {COLUMNS.map((category) => (
            <div key={category}>
              <p className="text-sm font-medium text-white/45">{CATEGORY_LABEL[category]}</p>
              <ul className="mt-3 space-y-1">
                {toolsInCategory(category).map((tool) => (
                  <li key={tool.id}>
                    <Link href={tool.href} className="inline-flex min-h-9 items-center text-[0.9375rem] text-white/85 transition-colors hover:text-white">
                      {tool.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-white/12 pt-6 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={22} />
            <span>© {new Date().getFullYear()} TheFileConvert</span>
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
