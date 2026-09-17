import type { Metadata } from "next";
import { getToolById } from "@/lib/tools/registry";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { WordCounterWorkflow } from "./word-counter-workflow";
import { pageMetadata } from "@/lib/seo";

const tool = getToolById("word-counter")!;

export const metadata: Metadata = pageMetadata({
  title: "Word & Character Counter — Free Online Tool",
  description: tool.description,
  path: tool.href,
});

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      howItWorks={[
        "Type or paste your text into the box.",
        "Counts update live as you type.",
        "See words, characters, sentences, and reading time.",
        "Nothing you type is sent anywhere.",
      ]}
    >
      <WordCounterWorkflow />
    </ToolPageShell>
  );
}
