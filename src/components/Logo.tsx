import Link from "next/link";

/**
 * The TheFileConvert mark: one page sliced across the middle, its halves shifted apart — a file in
 * the middle of changing format. Solid orange tile with white halves, so it reads the same on light
 * and dark pages, at 16px in a browser tab, and as an app icon. The same geometry is used by
 * public/favicon.svg, the app icon and the social image.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#ea580c" />
      <path d="M10 5.5H19.6L25.5 11.4V14.6H10Z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M19.6 5.5V11.4H25.5Z" fill="#ea580c" opacity="0.4" />
      <path d="M6.5 17.4H22V26.5H6.5Z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" aria-label="TheFileConvert home" className={`group inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-8 w-8 shrink-0 transition-transform duration-300 group-hover:scale-105" />
      <span className="text-[1.15rem] leading-none tracking-tight text-[var(--foreground)]">
        <span className="font-medium text-[var(--foreground-muted)]">The</span>
        <span className="font-bold">File</span>
        <span className="font-bold text-[var(--brand)]">Convert</span>
      </span>
    </Link>
  );
}
