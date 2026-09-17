import type { Metadata } from "next";
import { CategoryPageContent } from "@/components/tools/CategoryPageContent";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Free PDF Tools",
  description: "Merge, split, compress, and edit PDF files for free — no signup, processed in your browser.",
  path: "/pdf",
});

export default function Page() {
  return <CategoryPageContent category="pdf" />;
}
