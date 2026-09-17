"use client";

import { useState } from "react";
import Link from "next/link";
import { DropZone } from "@/components/tools/DropZone";
import { getExtension, formatBytes } from "@/lib/format";
import { getToolsAcceptingExtension } from "@/lib/tools/registry";
import { CategoryIcon } from "@/components/tools/CategoryIcon";
import { IconChevronRight, IconTrash } from "@/components/icons";
import type { ToolDefinition } from "@/lib/tools/types";

function rankTools(tools: ToolDefinition[]): ToolDefinition[] {
  return [...tools].sort((a, b) => {
    const aWild = a.acceptedExtensions.includes("*") ? 1 : 0;
    const bWild = b.acceptedExtensions.includes("*") ? 1 : 0;
    return aWild - bWild;
  });
}

export function HeroDropzone() {
  const [file, setFile] = useState<File | null>(null);
  const [matches, setMatches] = useState<ToolDefinition[]>([]);

  const handleFiles = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    setFile(picked);
    const ext = getExtension(picked.name);
    setMatches(rankTools(getToolsAcceptingExtension(ext)).slice(0, 6));
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
            {matches.map((tool) => (
              <Link
                key={tool.id}
                href={tool.href}
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
