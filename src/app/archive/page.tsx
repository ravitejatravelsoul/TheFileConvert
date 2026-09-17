import type { Metadata } from "next";
import { CategoryPageContent } from "@/components/tools/CategoryPageContent";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Free Archive Tools",
  description: "Create and extract ZIP archives for free, right in your browser.",
  path: "/archive",
});

export default function Page() {
  return <CategoryPageContent category="archive" />;
}
