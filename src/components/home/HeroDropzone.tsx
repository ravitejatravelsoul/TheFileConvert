"use client";

import { useState } from "react";
import Link from "next/link";
import { DropZone } from "@/components/tools/DropZone";
import { getExtension, formatBytes } from "@/lib/format";
import { getToolsAcceptingExtension } from "@/lib/tools/registry";
import { setPendingFiles } from "@/lib/file-handoff";
import { CategoryIcon } from "@/components/tools/CategoryIcon";
import { IconChevronRight, IconTrash } from "@/components/icons";
import type { ToolDefinition } from "@/lib/tools/types";

const INITIAL_SUGGESTIONS = 6;

/** Most specific first: a tool built for exactly this file type (JPG to PNG for a JPG) outranks a general
 * one that also happens to accept it, and tools that take any file come last. Ties keep registry order. */
function rankTools(tools: ToolDefinition[]): ToolDefinition[] {
  const specificity = (t: ToolDefinition) => (t.acceptedExtensions.includes("*") ? 1000 : t.acceptedExtensions.length);
  return tools.map((t, i) => ({ t, i })).sort((a, b) => specificity(a.t) - specificity(b.t) || a.i - b.i).map((x) => x.t);
}

export function HeroDropzone() {
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<ToolDefinition[]>([]);
  const [showAll, setShowAll] = useState(false);

  const handleFiles = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    setFile(picked);
    const ext = getExtension(picked.name);
    setMatches(rankTools(getToolsAcceptingExtension(ext)));
    setShowAll(false);
  };

  if (!file) {
    return (
      <DropZone
        onFiles={handleFiles}
        multiple
        label="Drop your files here"
        hint="or click to choose files — PDF, JPG, PNG, WebP, ZIP, JSON, CSV, and more"
      />
    );
  }

  return (
    <div className="card-surface animate-scale-in p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-[var(--foreground)]">{file.name}</p>
          <p className="text-sm text-[var(--foreground-muted)]">{formatBytes(file.size)}</p>
        </div>
        <button
          onClick={() => {
            setFile(null);
            setMatches([]);
          }}
          aria-label="Remove file"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-red-500"
        >
          <IconTrash className="h-4 w-4" />
        </button>
      </div>

      {matches.length > 0 ? (
        <>
          <p className="mt-6 text-sm font-medium text-[var(--foreground-muted)]">Available actions</p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {(showAll ? matches : matches.slice(0, INITIAL_SUGGESTIONS)).map((tool) => (
              <Link
                key={tool.id}
                href={tool.href}
                onClick={() => setPendingFiles(file ? [file] : [])}
                className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition-all hover:border-[var(--brand)] hover:shadow-[var(--shadow-soft)]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
                  <CategoryIcon category={tool.category} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--foreground)]">
                  {tool.name}
                </span>
                <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
          {matches.length > INITIAL_SUGGESTIONS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-sm font-medium text-[var(--brand)] hover:underline"
            >
              {showAll ? "Show fewer" : `Show all ${matches.length} tools for this file`}
            </button>
          )}
        </>
      ) : (
        <p className="mt-6 text-sm text-[var(--foreground-muted)]">
          We don&apos;t have a tool for this file type yet.{" "}
          <Link href="/tools" className="font-medium text-[var(--brand)] hover:underline">
            Browse all tools
          </Link>
          .
        </p>
      )}
    </div>
  );
}
