import type { MetadataRoute } from "next";
import { liveTools } from "@/lib/tools/registry";

const SITE_URL = "https://thefileconvert.com";

const STATIC_PATHS = [
  "",
  "/tools",
  "/tools/status",
  "/about",
  "/privacy",
  "/terms",
  "/pdf",
  "/image",
  "/document",
  "/data",
  "/archive",
  "/media",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }));

  const toolEntries: MetadataRoute.Sitemap = liveTools.map((tool) => ({
    url: `${SITE_URL}${tool.href}`,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...toolEntries];
}
