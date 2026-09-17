import type { Metadata } from "next";
import { CategoryPageContent } from "@/components/tools/CategoryPageContent";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Free Data & Developer Tools",
  description: "Format JSON and XML, convert CSV, hash text, and more — free developer utilities.",
  path: "/data",
});

export default function Page() {
  return <CategoryPageContent category="data" />;
}
