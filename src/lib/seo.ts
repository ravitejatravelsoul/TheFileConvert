import type { Metadata } from "next";
import type { Tool } from "@/lib/tools/registry";

export const SITE_URL = "https://thefileconvert.com";
export const SITE_NAME = "TheFileConvert";

/**
 * Per-page metadata including OpenGraph/Twitter overrides. Next.js does not copy a page's
 * title/description into openGraph/twitter, so without this every shared link would show the
 * homepage's preview.
 */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  const url = `${SITE_URL}${path}`;
  const fullTitle = `${title} — ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, title: fullTitle, description, url },
    twitter: { card: "summary_large_image", title: fullTitle, description },
  };
}

export function toolMetadata(tool: Tool): Metadata {
  return pageMetadata({ title: tool.seoTitle, description: tool.seoDescription, path: tool.href });
}

/** schema.org WebApplication + FAQPage for a tool page. */
export function toolJsonLd(tool: Tool): object[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: `${tool.name} — ${SITE_NAME}`,
      url: `${SITE_URL}${tool.href}`,
      description: tool.seoDescription,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any (runs in the browser)",
      browserRequirements: "Requires JavaScript",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: tool.faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
}

/** Serializes JSON-LD for a <script> tag, escaping "<" so the payload can't close the tag. */
export function jsonLdScript(data: object | object[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
