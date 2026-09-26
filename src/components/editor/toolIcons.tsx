import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Editor-toolbar-only icons, in the same hand-rolled inline-SVG style as
 * src/components/icons.tsx (no icon library dependency). */

export function IconSelect(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M5 3l5.5 15L13 12l6-2.5L5 3Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEditText(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 6h16M4 12h10M4 18h7" />
      <path d="m17 14 3 3-6 6h-3v-3Z" />
    </svg>
  );
}

export function IconHighlight(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="m13 3 8 8-7 7-8-8Z" />
      <path d="m6 17-3 4h4l3-3" />
      <path d="m9 6 9 9" />
    </svg>
  );
}

export function IconUnderline(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M6 4v7a6 6 0 0 0 12 0V4" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function IconStrikethrough(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M6 7c0-2 2-3.5 6-3.5s6 1.2 6 3" />
      <path d="M7 17c0 2 2 3.5 5.5 3.5S18 19 18 17" />
      <path d="M4 12h16" />
    </svg>
  );
}

export function IconDraw(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 20c2-6 3-10 6-14 1.4-1.8 4-1.8 5 0 1 1.8-.2 3.6-2 4.4-3 1.4-6 2.6-9 9.6Z" />
      <path d="M15 5.5 18.5 9" />
    </svg>
  );
}

export function IconRectangleShape(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="4" y="6" width="16" height="12" rx="1.5" />
    </svg>
  );
}

export function IconEllipseShape(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <ellipse cx="12" cy="12" rx="8" ry="6" />
    </svg>
  );
}

export function IconLineShape(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M5 19 19 5" />
      <circle cx="5" cy="19" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowShape(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M5 19 19 5" />
      <path d="M10 5h9v9" />
    </svg>
  );
}

export function IconWhiteout(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M6 15 15 6l3 3-9 9H6Z" />
      <path d="m13 8 3 3" />
      <path d="M4 20h9" strokeDasharray="0.5 3.2" />
    </svg>
  );
}

export function IconCrop(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M7 2v14a1 1 0 0 0 1 1h14" />
      <path d="M17 22V8a1 1 0 0 0-1-1H2" />
    </svg>
  );
}

export function IconSignature(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M3 17c2-1 3-3 4-6 1-3 2-3 3 0s1.5 2.5 3-1c1-2.3 2-2 2.5 0s1 3 3.5 3" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function IconRecognizeText(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  );
}

export function IconPages(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="7" y="3" width="12" height="15" rx="1.5" />
      <path d="M5 7v13a1 1 0 0 0 1 1h11" />
    </svg>
  );
}

export function IconWatermark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z" />
    </svg>
  );
}

export function IconPageNumbers(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9.5 14.5h1.2v3.5H9.5m3.3-3.5h1.6a1 1 0 0 1 0 2h-1.6v1.5h1.6" />
    </svg>
  );
}

export function IconHeaderFooter(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 8h16M4 16h16" />
    </svg>
  );
}

export function IconUndo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M7 8H4V5" />
      <path d="M4 8c2.5-3 6-4.5 9.5-3.5A8 8 0 1 1 5 18" />
    </svg>
  );
}

export function IconRedo(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M17 8h3V5" />
      <path d="M20 8c-2.5-3-6-4.5-9.5-3.5A8 8 0 1 0 19 18" />
    </svg>
  );
}

export function IconZoomIn(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.3-4.3M10.5 7.5v6M7.5 10.5h6" />
    </svg>
  );
}

export function IconZoomOut(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.3-4.3M7.5 10.5h6" />
    </svg>
  );
}

export function IconFitWidth(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="7" y="5" width="10" height="14" rx="1" />
      <path d="M3 12h2m14 0h2" />
    </svg>
  );
}

export function IconFitPage(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <path d="M3 6V4m0 16v-2M21 6V4m0 16v-2" />
    </svg>
  );
}

export function IconFullscreen(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" {...base} {...props}>
      <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}
