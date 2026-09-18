"use client";

/** Pure-CSS tooltip for icon-only toolbar controls: appears on hover *and* keyboard focus
 * (group-focus-within, not just group-hover), never blocks pointer interaction with
 * whatever's underneath (pointer-events-none), and never doubles as the control's
 * accessible name — the wrapped control still needs its own aria-label/title, since this
 * is a purely visual supplement for sighted mouse/keyboard users. */
export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2 scale-95 whitespace-nowrap rounded-md bg-[var(--foreground)] px-2 py-1 text-[11px] font-medium text-[var(--background)] opacity-0 shadow-[var(--shadow-soft)] transition-all duration-100 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 group-focus-within/tooltip:scale-100 group-focus-within/tooltip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
