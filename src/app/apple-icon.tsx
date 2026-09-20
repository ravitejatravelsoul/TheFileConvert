import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: the same mark as the favicon, full-bleed so iOS applies its own rounding.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#ea580c" }}>
        <svg width={180} height={180} viewBox="-2 -2 36 36">
          <path d="M10 5.5H19.6L25.5 11.4V14.6H10Z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M19.6 5.5V11.4H25.5Z" fill="#ea580c" opacity="0.4" />
          <path d="M6.5 17.4H22V26.5H6.5Z" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
