import { ImageResponse } from "next/og";
import { HIGHLIGHT, INK, MARK_PATHS } from "@/components/brand/Logo";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "TheFileConvert — Every file. One simple place.";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#f7f6f2",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width={64} height={64} viewBox="0 0 32 32">
            <rect width="32" height="32" rx="9" fill={INK} />
            <path d={MARK_PATHS.page} fill="#fff" />
            <path d={MARK_PATHS.flap} fill={HIGHLIGHT} />
            <path d={MARK_PATHS.lines} stroke={INK} strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span style={{ display: "flex", fontSize: 38, letterSpacing: -1.2 }}>
            <span style={{ color: "#8a877f", fontWeight: 500 }}>The</span>
            <span style={{ color: INK, fontWeight: 700 }}>FileConvert</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 96, color: "#8a877f", fontWeight: 600, lineHeight: 1, letterSpacing: -4 }}>Every file.</span>
          <span style={{ display: "flex", fontSize: 96, color: INK, fontWeight: 600, lineHeight: 1.05, letterSpacing: -4 }}>
            <span>One simple&nbsp;</span>
            <span style={{ background: HIGHLIGHT, padding: "0 12px", borderRadius: 12 }}>place.</span>
          </span>
        </div>
        <span style={{ fontSize: 30, color: "#57544e" }}>Compress, convert and edit files — right in your browser.</span>
      </div>
    ),
    { ...size }
  );
}
