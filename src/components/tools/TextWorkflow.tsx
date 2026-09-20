"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { IconDownload, IconWarning, IconCheck } from "@/components/icons";
import { triggerDownload } from "@/lib/download";

interface TextWorkflowProps {
  inputLabel?: string;
  outputLabel?: string;
  inputPlaceholder?: string;
  acceptFileExtension?: string;
  actionLabel: string;
  onProcess: (input: string) => string | Promise<string>;
  downloadName?: string;
  downloadMime?: string;
  monospace?: boolean;
}

export function TextWorkflow({
  inputLabel = "Input",
  outputLabel = "Output",
  inputPlaceholder = "Paste your text here…",
  acceptFileExtension,
  actionLabel,
  onProcess,
  downloadName = "output.txt",
  downloadMime = "text/plain",
  monospace = true,
}: TextWorkflowProps) {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcess = async () => {
    setError(null);
    if (!input.trim()) {
      setError("Paste or type some content first.");
      return;
    }
    try {
      const result = await onProcess(input);
      setOutput(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setOutput("");
    }
  };

  const handleFilePick = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setInput(text);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't copy to clipboard — your browser may be blocking it.");
    }
  };

  const monoClass = monospace ? "font-mono" : "";
  const inputId = useId();
  const outputId = useId();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor={inputId} className="text-sm font-medium text-[var(--foreground)]">{inputLabel}</label>
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
            id={inputId}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={inputPlaceholder}
            rows={14}
            className={`w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)] ${monoClass}`}
            spellCheck={false}
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor={outputId} className="text-sm font-medium text-[var(--foreground)]">{outputLabel}</label>
            {output && (
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline"
              >
                {copied ? <IconCheck className="h-3.5 w-3.5" /> : null}
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <textarea
            id={outputId}
            value={output}
            readOnly
            placeholder="Your result will appear here."
            rows={14}
            className={`w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--foreground)] outline-none ${monoClass}`}
            spellCheck={false}
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleProcess}>{actionLabel}</Button>
        {output && (
          <Button
            variant="secondary"
            onClick={() => triggerDownload(downloadName, new Blob([output], { type: downloadMime }))}
          >
            <IconDownload className="h-4 w-4" />
            Download
          </Button>
        )}
      </div>
    </div>
  );
}
