"use client";

import { useEffect, useState } from "react";
import { FileWorkflow, type FileWorkflowResult } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { inspectZip, extractZip, type ZipEntryInfo } from "@/lib/processors/archive";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("zip-extract")!;

function UnzipInspector({
  file,
  run,
}: {
  file: File;
  run: (handler: (files: File[]) => Promise<FileWorkflowResult[]>) => void;
}) {
  const [entries, setEntries] = useState<ZipEntryInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    inspectZip(file)
      .then((e) => !cancelled && setEntries(e))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't read this archive."));
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!entries) return <p className="text-sm text-[var(--foreground-muted)]">Reading archive contents…</p>;

  const fileEntries = entries.filter((e) => !e.isDirectory);

  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--foreground-muted)]">
        This archive contains {fileEntries.length} file{fileEntries.length === 1 ? "" : "s"}.
      </p>
      <ul className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        {fileEntries.map((entry) => (
          <li key={entry.name} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="truncate text-[var(--foreground)]">{entry.name}</span>
          </li>
        ))}
      </ul>
      <Button onClick={() => run(() => extractZip(file))}>Extract all files</Button>
    </div>
  );
}

export function UnzipWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple={false} zipDownloadName="extracted-files.zip">
      {({ files, run }) => (files[0] ? <UnzipInspector file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
