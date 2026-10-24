"use client";

import { useRouter } from "next/navigation";
import { ToolIcon } from "@/components/brand/ToolIcon";
import { setPendingFiles } from "@/lib/file-handoff";
import { getTool, type ToolId } from "@/lib/tools/registry";

/** "Continue with …" — hands the result straight to another tool, so nothing is downloaded and re-picked. */
export function ContinueWith({ files, tools }: { files: File[]; tools: ToolId[] }) {
  const router = useRouter();
  if (!files.length || !tools.length) return null;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <p className="text-sm font-medium text-[var(--ink-2)]">Continue with</p>
      <div className="flex flex-wrap gap-2">
        {tools.map((id) => {
          const tool = getTool(id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPendingFiles(files);
                router.push(tool.href);
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--surface)] py-1 pl-1 pr-4 text-sm font-semibold tracking-[-0.01em] transition-colors hover:border-[var(--ink)]"
            >
              <ToolIcon id={id} category={tool.category} size="sm" />
              {tool.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
