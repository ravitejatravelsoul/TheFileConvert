"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconDownload, IconWarning, IconCheck } from "@/components/icons";
import { triggerDownload } from "@/lib/download";

interface TextToBlobWorkflowProps {
  inputPlaceholder?: string;
  acceptFileExtension?: string;
  actionLabel: string;
  onProcess: (input: string) => Promise<{ name: string; blob: Blob; note?: string }>;
}

export function TextToBlobWorkflow({
  inputPlaceholder = "Paste your text here…",
  acceptFileExtension,
  actionLabel,
  onProcess,
}: TextToBlobWorkflowProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [result, setResult] = useState<{ name: string; blob: Blob; note?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFilePick = async (file: File | undefined) => {
    if (!file) return;
    setInput(await file.text());
  };

  const handleProcess = async () => {
    setError(null);
    if (!input.trim()) {
      setError("Paste or type some content first.");
      return;
    }
    setStatus("processing");
    try {
      const out = await onProcess(input);
      setResult(out);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("idle");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--foreground)]">Input</label>
          {acceptFileExtension !== undefined && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-medium text-[var(--brand)] hover:underline"
            >
              Upload a file instead
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptFileExtension}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => handleFilePick(e.target.files?.[0])}
        />
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // The old result no longer matches what's in the box; don't leave a stale Download button.
            if (result) {
              setResult(null);
              setStatus("idle");
            }
          }}
          placeholder={inputPlaceholder}
          rows={14}
          className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)]"
          spellCheck={false}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {status === "done" && result && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--accent-mint-soft)] px-4 py-3 text-sm text-[var(--accent-mint)]">
          <IconCheck className="h-4 w-4 shrink-0" />
          <span>{result.name} is ready.</span>
        </div>
      )}
      {status === "done" && result?.note && (
        <div role="note" className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--brand-strong)]">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.note}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleProcess} disabled={status === "processing"}>
          {status === "processing" ? "Converting…" : actionLabel}
        </Button>
        {result && (
          <Button variant="secondary" onClick={() => triggerDownload(result.name, result.blob)}>
            <IconDownload className="h-4 w-4" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
}
