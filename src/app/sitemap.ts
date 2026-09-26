import type { MetadataRoute } from "next";
import { TOOLS } from "@/lib/tools/registry";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/tools`, changeFrequency: "weekly", priority: 0.8 },
    ...TOOLS.map((tool) => ({ url: `${SITE_URL}${tool.href}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
