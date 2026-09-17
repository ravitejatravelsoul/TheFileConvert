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
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#ea580c",
              display: "flex",
            }}
          />
          <span style={{ fontSize: 34, color: "#f5f5f4", fontWeight: 600 }}>TheFileConvert</span>
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
