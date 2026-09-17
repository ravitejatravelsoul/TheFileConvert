import type { Metadata } from "next";
import { CategoryPageContent } from "@/components/tools/CategoryPageContent";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Audio & Video Tools (Roadmap)",
  description: "Audio and video conversion is on our roadmap — see what's planned and why it isn't live yet.",
  path: "/media",
});

export default function Page() {
  return <CategoryPageContent category="media" />;
}
