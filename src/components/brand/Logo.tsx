/**
 * The mark: a page whose corner lifts off as a highlighter-yellow wedge — a file in the middle of
 * becoming something else. The same geometry is used for the favicon (public/favicon.svg), the
 * app icon and the social image, so keep them in sync.
 */
export const MARK_PATHS = {
  page: "M8.2 9.2a2 2 0 0 1 2-2h7.2l5 5V22.8a2 2 0 0 1-2 2H10.2a2 2 0 0 1-2-2z",
  flap: "M17.4 7.2l5 5 2.6-7.6z",
  lines: "M11.4 15.5h7.6M11.4 19h4.6",
} as const;

export const INK = "#141413";
export const HIGHLIGHT = "#ffd43b";

export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="9" fill={INK} />
      <path d={MARK_PATHS.page} fill="#fff" />
      <path d={MARK_PATHS.flap} fill={HIGHLIGHT} />
      <path d={MARK_PATHS.lines} stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={30} />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.03em] text-[var(--ink)]">
        <span className="font-medium text-[var(--ink-3)]">The</span>FileConvert
      </span>
    </span>
  );
}
