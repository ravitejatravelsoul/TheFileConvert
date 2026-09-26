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

const nextConfig: NextConfig = {
  async redirects() {
    return MOVED.map(([source, destination]) => ({ source, destination, permanent: true }));
  },
};

export default nextConfig;
