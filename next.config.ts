import type { NextConfig } from "next";

/** Old (pre-launch) URLs of the tools that carried over, so existing links and search results land on the new pages.
 * Tools that were removed are left to 404 rather than pointing somewhere misleading. */
const MOVED: [string, string][] = [
  ["/pdf/compress", "/compress-pdf"],
  ["/image/compress", "/compress-image"],
  ["/convert/jpg-to-png", "/convert-image"],
  ["/convert/jpg-to-webp", "/convert-image"],
  ["/convert/png-to-jpg", "/convert-image"],
  ["/convert/png-to-webp", "/convert-image"],
  ["/convert/webp-to-jpg", "/convert-image"],
  ["/convert/webp-to-png", "/convert-image"],
  ["/image/svg-to-png", "/convert-image"],
  ["/pdf/to-images", "/pdf-to-image"],
  ["/pdf/images-to-pdf", "/image-to-pdf"],
  ["/pdf/merge", "/merge-pdf"],
  ["/pdf/split", "/split-pdf"],
  ["/pdf/extract-pages", "/split-pdf"],
  ["/pdf/reorder", "/organize-pdf"],
  ["/pdf/rotate", "/organize-pdf"],
  ["/pdf/delete-pages", "/organize-pdf"],
  ["/pdf/editor", "/pdf-editor"],
  ["/pdf/ocr", "/pdf-editor"],
  ["/pdf", "/tools"],
  ["/image", "/tools"],
];

/** The names people type or search for, pointing at the one canonical page for each job (no duplicate pages). */
const ALIASES: [string, string][] = [
  ["/docx-to-pdf", "/word-to-pdf"],
  ["/doc-to-pdf", "/word-to-pdf"],
  ["/pdf-to-docx", "/pdf-to-word"],
  ["/pdf-to-jpg", "/pdf-to-image"],
  ["/pdf-to-png", "/pdf-to-image"],
  ["/jpg-to-pdf", "/image-to-pdf"],
  ["/png-to-pdf", "/image-to-pdf"],
  ["/images-to-pdf", "/image-to-pdf"],
  ["/image-converter", "/convert-image"],
  ["/jpg-to-png", "/convert-image"],
  ["/png-to-jpg", "/convert-image"],
  ["/webp-to-jpg", "/convert-image"],
  ["/webp-to-png", "/convert-image"],
  ["/jpg-to-webp", "/convert-image"],
  ["/png-to-webp", "/convert-image"],
  ["/svg-to-png", "/convert-image"],
  ["/edit-pdf", "/pdf-editor"],
  ["/rotate-pdf", "/organize-pdf"],
  ["/delete-pdf-pages", "/organize-pdf"],
];

const nextConfig: NextConfig = {
  async redirects() {
    return [...MOVED, ...ALIASES].map(([source, destination]) => ({ source, destination, permanent: true }));
  },
};

export default nextConfig;
