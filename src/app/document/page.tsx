import type { Metadata } from "next";
import { CategoryPageContent } from "@/components/tools/CategoryPageContent";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Free Document Tools",
  description: "Convert plain text and Markdown into polished documents — free, no signup.",
  path: "/document",
});

export default function Page() {
  return <CategoryPageContent category="document" />;
}
