import type { Metadata } from "next";

const SITE_URL = "https://thefileconvert.com";

/**
 * Builds per-page metadata including OpenGraph/Twitter overrides. Next.js does not
 * automatically propagate a page's title/description into openGraph/twitter fields —
 * without this, every page's social preview silently falls back to the root layout's
 * (homepage) OG data, which is wrong for a shared link to e.g. /pdf/merge.
 */
export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url,
    },
    twitter: {
      title,
      description,
    },
  };
}
