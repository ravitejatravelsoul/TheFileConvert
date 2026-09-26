import { IconCheck, IconPdf } from "@/components/icons";

/**
 * Small drawn product vignettes for the homepage cards and sections. They're illustrations of the
 * interface (marked aria-hidden), not screenshots or real results.
 */

export function CompressVignette() {
  return (
    <div aria-hidden="true" className="relative flex h-full flex-col justify-end gap-3">
      <div className="flex flex-wrap gap-1.5">
        {["500 KB", "1 MB", "2 MB", "5 MB"].map((t) => (
          <span
            key={t}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${t === "1 MB" ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line-strong)] bg-[var(--surface)]"}`}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-2)]">
        <div className="flex items-center justify-between text-xs text-[var(--ink-2)]">
          <span>scan.pdf</span>
          <span className="inline-flex items-center gap-1 font-semibold text-[var(--success)]">
            <IconCheck className="h-3.5 w-3.5" strokeWidth={2.4} /> under 1 MB
          </span>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="h-2 rounded-full bg-[var(--surface-3)]" />
          <div className="h-2 w-[24%] rounded-full bg-[var(--cat-compress)]" />
        </div>
      </div>
    </div>
  );
}

export function EditorVignette() {
  return (
    <div aria-hidden="true" className="relative h-full">
      <div className="absolute inset-x-2 bottom-0 top-3 rounded-t-[12px] border border-b-0 border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-2)]">
        <div className="h-2 w-1/3 rounded-full bg-[var(--ink)]" />
        <div className="mt-3 space-y-2">
          <div className="h-1.5 w-full rounded-full bg-[var(--surface-3)]" />
          <div className="relative h-1.5 w-11/12 rounded-full bg-[var(--surface-3)]">
            <span className="absolute -inset-y-1 left-[18%] w-[38%] rounded-[3px] bg-[var(--accent)] opacity-80" />
          </div>
          <div className="h-1.5 w-4/5 rounded-full bg-[var(--surface-3)]" />
          <div className="relative flex h-5 w-2/3 items-center">
            <span className="rounded-[4px] border-[1.5px] border-[var(--cat-convert)] px-1 text-[10px] font-semibold leading-4 text-[var(--ink)]">12/20/2028</span>
            <span className="ml-0.5 h-4 w-[1.5px] animate-pulse bg-[var(--cat-convert)]" />
          </div>
          <div className="h-1.5 w-3/5 rounded-full bg-[var(--surface-3)]" />
        </div>
        <svg viewBox="0 0 120 30" className="mt-3 h-7 w-28 text-[var(--ink)]">
          <path d="M3 22c8-14 14-16 16-8s-4 12 2 6 10-16 14-10-2 12 6 6 9-9 13-4 6 4 12-2 12-4 18 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

export function MergeVignette() {
  return (
    <div aria-hidden="true" className="flex h-full items-end justify-center gap-2 pb-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex h-20 w-14 flex-col gap-1 rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow-2)]"
          style={{ transform: `rotate(${(i - 1) * 6}deg) translateY(${i === 1 ? -6 : 0}px)` }}
        >
          <span className="h-1 w-3/4 rounded-full bg-[var(--ink)]" />
          <span className="h-1 rounded-full bg-[var(--surface-3)]" />
          <span className="h-1 w-5/6 rounded-full bg-[var(--surface-3)]" />
          <span className="h-1 w-2/3 rounded-full bg-[var(--surface-3)]" />
        </div>
      ))}
    </div>
  );
}

export function ConvertVignette() {
  return (
    <div aria-hidden="true" className="flex h-full items-end gap-2">
      {["JPG", "PNG", "WebP", "SVG"].map((f, i) => (
        <span
          key={f}
          className={`flex h-14 flex-1 items-center justify-center rounded-[12px] border text-sm font-semibold tracking-[-0.01em] ${
            i === 1 ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--line)] bg-[var(--surface)]"
          }`}
        >
          {f}
        </span>
      ))}
    </div>
  );
}

export function ImagesVignette() {
  return (
    <div aria-hidden="true" className="flex h-full items-end gap-2">
      {["#e5ecfc", "#fbe7e1", "#e1f3ea"].map((c, i) => (
        <div key={c} className="relative h-16 flex-1 overflow-hidden rounded-[10px] border border-[var(--line)]" style={{ background: c }}>
          <svg viewBox="0 0 40 30" className="absolute inset-x-0 bottom-0 h-3/4 w-full" preserveAspectRatio="none">
            <path d="M0 30 12 14l8 9 7-6 13 13Z" fill="rgb(20 20 19 / 0.14)" />
          </svg>
          <span className="absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ink)] text-[9px] font-bold text-white">{i + 1}</span>
        </div>
      ))}
      <span className="text-[var(--ink-3)]">→</span>
      <span className="flex h-16 w-12 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-2)]">
        <IconPdf className="h-5 w-5" />
      </span>
    </div>
  );
}

export function ImageCompressVignette() {
  return (
    <div aria-hidden="true" className="flex h-full items-end gap-3">
      <div className="relative h-20 w-24 overflow-hidden rounded-[12px] border border-[var(--line)] bg-[#e5ecfc]">
        <svg viewBox="0 0 40 30" className="absolute inset-x-0 bottom-0 h-3/4 w-full" preserveAspectRatio="none">
          <path d="M0 30 12 12l9 10 7-7 12 15Z" fill="rgb(20 20 19 / 0.16)" />
        </svg>
        <span className="absolute right-2 top-2 h-3 w-3 rounded-full bg-[var(--accent)]" />
      </div>
      <div className="space-y-1.5 pb-1 text-xs font-semibold">
        <p className="text-[var(--ink-3)] line-through decoration-2">3.8 MB</p>
        <p className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[var(--success)]">under 250 KB</p>
      </div>
    </div>
  );
}
