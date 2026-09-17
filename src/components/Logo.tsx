import Link from "next/link";

/** Two file corners mid-transition into one another — the brand's format-switch mark. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M7 4h10l6 6v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        fill="var(--brand)"
        opacity="0.16"
      />
      <path
        d="M7 4h10l6 6v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
        stroke="var(--brand)"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
      <path d="M17 4v6h6" stroke="var(--brand)" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      <path
        d="m12.5 15.5 3 3-3 3M19.5 21.5l-3-3 3-3"
        stroke="var(--accent-mint)"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 group ${className}`}>
      <LogoMark className="h-8 w-8 transition-transform duration-300 group-hover:scale-105" />
      <span className="text-lg font-semibold tracking-tight text-[var(--foreground)]">
        TheFileConvert
      </span>
    </Link>
  );
}
