import type { Metadata } from "next";
import { CategoryPageContent } from "@/components/tools/CategoryPageContent";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Free Image Tools",
  description: "Compress, resize, crop, and convert images for free — no signup, processed in your browser.",
  path: "/image",
});

export default function Page() {
  return <CategoryPageContent category="image" />;
}
