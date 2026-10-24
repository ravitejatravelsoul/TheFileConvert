import { ImageResponse } from "next/og";
import { HIGHLIGHT, INK, MARK_PATHS } from "@/components/brand/Logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: the mark full-bleed on ink, so iOS applies its own corner rounding.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: INK }}>
        <svg width={180} height={180} viewBox="0 0 32 32">
          <path d={MARK_PATHS.page} fill="#fff" />
          <path d={MARK_PATHS.flap} fill={HIGHLIGHT} />
          <path d={MARK_PATHS.lines} stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
