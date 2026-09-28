import type { ToolCategory, ToolId } from "@/lib/tools/registry";

/**
 * Each tool has its own drawn glyph (not a generic library icon) on a tile tinted by its category.
 * Glyphs share one grammar: a page or frame in ink, with the action in a heavier stroke.
 */
const GLYPHS: Record<ToolId, React.ReactNode> = {
  "compress-pdf": (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z" />
      <path d="M9.5 9.5 12 12l2.5-2.5M9.5 17.5 12 15l2.5 2.5" strokeWidth={2} />
    </>
  ),
  "compress-image": (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M8 8.5h2.5V6M16 8.5h-2.5V6M8 15.5h2.5V18M16 15.5h-2.5V18" strokeWidth={2} />
    </>
  ),
  "convert-image": (
    <>
      <rect x="3" y="3" width="11" height="11" rx="2" />
      <rect x="10" y="10" width="11" height="11" rx="2" fill="var(--glyph-fill, #fff)" />
      <path d="M13.5 14.5h4M15.5 12.5l2 2-2 2" strokeWidth={2} />
    </>
  ),
  "pdf-to-image": (
    <>
      <path d="M4.5 3.5h5l3 3V14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <rect x="11" y="11" width="9.5" height="9" rx="1.8" fill="var(--glyph-fill, #fff)" />
      <path d="m12 18.5 2.6-2.4 1.8 1.6 1.4-1.2 1.7 1.5" strokeWidth={1.6} />
    </>
  ),
  "pdf-to-word": (
    <>
      <path d="M4.5 3.5h5l3 3V14a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <rect x="10.5" y="9.5" width="10" height="11" rx="1.8" fill="var(--glyph-fill, #fff)" />
      <path d="m12.8 12.6 1 5 1.7-3.4 1.7 3.4 1-5" strokeWidth={1.7} />
    </>
  ),
  "image-to-pdf": (
    <>
      <rect x="3.5" y="3.5" width="9.5" height="9" rx="1.8" />
      <path d="m4.5 11 2.6-2.4 1.8 1.6 1.4-1.2 1.7 1.5" strokeWidth={1.6} />
      <path d="M12 9.5h5l3 3V20a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-9.5a1 1 0 0 1 1-1Z" fill="var(--glyph-fill, #fff)" />
    </>
  ),
  "merge-pdf": (
    <>
      <rect x="3" y="3.5" width="7.5" height="10" rx="1.5" />
      <rect x="13.5" y="3.5" width="7.5" height="10" rx="1.5" />
      <path d="M6.75 13.5v1.5a2 2 0 0 0 2 2H12m5.25-3.5v1.5a2 2 0 0 1-2 2H12m0 0v3.5" strokeWidth={2} />
    </>
  ),
  "split-pdf": (
    <>
      <path d="M6 3.5h12a1.5 1.5 0 0 1 1.5 1.5v5.5h-15V5A1.5 1.5 0 0 1 6 3.5ZM4.5 13.5h15V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19Z" />
      <path d="M2.5 12h2M8 12h2M13.5 12h2M19 12h2.5" strokeWidth={2} />
    </>
  ),
  "organize-pdf": (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" strokeDasharray="2.2 2" />
      <path d="M17 11.5v1" strokeWidth={2} />
    </>
  ),
  "pdf-editor": (
    <>
      <path d="M14 20.5H6.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5H14l4 4v3" />
      <path d="M8 9h5M8 12.5h3" />
      <path d="m13.5 19.5.6-2.8 5.4-5.4a1.4 1.4 0 0 1 2 2l-5.4 5.4Z" strokeWidth={2} />
    </>
  ),
};

const TILE: Record<ToolCategory, { bg: string; fg: string }> = {
  compress: { bg: "var(--cat-compress-soft)", fg: "var(--cat-compress)" },
  convert: { bg: "var(--cat-convert-soft)", fg: "var(--cat-convert)" },
  edit: { bg: "var(--cat-edit-soft)", fg: "var(--cat-edit)" },
  organize: { bg: "var(--cat-organize-soft)", fg: "var(--cat-organize)" },
};

export function ToolGlyph({ id, className }: { id: ToolId; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {GLYPHS[id]}
    </svg>
  );
}

const SIZES = {
  sm: { box: "h-9 w-9 rounded-[10px]", glyph: "h-5 w-5" },
  md: { box: "h-11 w-11 rounded-[12px]", glyph: "h-6 w-6" },
  lg: { box: "h-14 w-14 rounded-[16px]", glyph: "h-7 w-7" },
} as const;

export function ToolIcon({ id, category, size = "md" }: { id: ToolId; category: ToolCategory; size?: keyof typeof SIZES }) {
  const tone = TILE[category];
  const s = SIZES[size];
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${s.box}`}
      style={{ background: tone.bg, color: tone.fg, ["--glyph-fill" as string]: tone.bg }}
    >
      <ToolGlyph id={id} className={s.glyph} />
    </span>
  );
}

/** CSS custom properties that tint a surface with a category's colour (used by `.art` and `.tool-hero`). */
export function toneStyle(category: ToolCategory): React.CSSProperties {
  return { ["--tone" as string]: TILE[category].fg, ["--tone-soft" as string]: TILE[category].bg };
}
