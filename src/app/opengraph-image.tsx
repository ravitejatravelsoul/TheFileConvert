import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#16161a",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width={64} height={64} viewBox="0 0 32 32">
            <rect width="32" height="32" rx="8" fill="#ea580c" />
            <path d="M10 5.5H19.6L25.5 11.4V14.6H10Z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M19.6 5.5V11.4H25.5Z" fill="#ea580c" opacity="0.4" />
            <path d="M6.5 17.4H22V26.5H6.5Z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          <span style={{ display: "flex", fontSize: 40, letterSpacing: -0.5 }}>
            <span style={{ color: "#a6a6ab", fontWeight: 500 }}>The</span>
            <span style={{ color: "#f5f5f4", fontWeight: 700 }}>File</span>
            <span style={{ color: "#fb923c", fontWeight: 700 }}>Convert</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
          <span style={{ fontSize: 78, color: "#ffffff", fontWeight: 700, lineHeight: 1.05 }}>
            Every file.
          </span>
          <span style={{ fontSize: 78, color: "#ea580c", fontWeight: 700, lineHeight: 1.05 }}>
            Any format.
          </span>
        </div>
        <span style={{ fontSize: 28, color: "#a6a6ab", marginTop: 32 }}>
          Free file tools. No signup. No subscriptions.
        </span>
      </div>
    ),
    { ...size }
  );
}
