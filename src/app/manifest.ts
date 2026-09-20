import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TheFileConvert — Every File. Any Format. Free.",
    short_name: "TheFileConvert",
    description: "Free file conversion and compression tools that run privately in your browser.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#ea580c",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
