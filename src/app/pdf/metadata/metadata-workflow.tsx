"use client";

import { useEffect, useState } from "react";
import { FileWorkflow } from "@/components/tools/FileWorkflow";
import { Button } from "@/components/ui/Button";
import { getPdfMetadata, removePdfMetadata, type PdfBasicMetadata } from "@/lib/processors/pdf";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-metadata")!;

const FIELD_LABELS: Record<keyof PdfBasicMetadata, string> = {
  title: "Title",
  author: "Author",
  subject: "Subject",
  keywords: "Keywords",
  creator: "Creator",
  producer: "Producer",
  pageCount: "Page count",
};

function MetadataViewer({ file, run }: { file: File; run: (h: (files: File[]) => Promise<{ name: string; blob: Blob }[]>) => void }) {
  const [meta, setMeta] = useState<PdfBasicMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPdfMetadata(file)
      .then((m) => !cancelled && setMeta(m))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't read this PDF."));
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!meta) return <p className="text-sm text-[var(--foreground-muted)]">Reading metadata…</p>;

  return (
    <div className="space-y-4 pt-2">
      <dl className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        {(Object.keys(FIELD_LABELS) as (keyof PdfBasicMetadata)[]).map((key) => (
          <div key={key} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <dt className="text-[var(--foreground-muted)]">{FIELD_LABELS[key]}</dt>
            <dd className="font-medium text-[var(--foreground)]">{String(meta[key] || "—")}</dd>
          </div>
        ))}
      </dl>
      <Button onClick={() => run(async (f) => [{ name: "metadata-removed.pdf", blob: await removePdfMetadata(f[0]) }])}>
        Remove metadata
      </Button>
    </div>
  );
}

export function MetadataWorkflow() {
  return (
    <FileWorkflow tool={tool} multiple={false}>
      {({ files, run }) => (files[0] ? <MetadataViewer file={files[0]} run={run} /> : null)}
    </FileWorkflow>
  );
}
