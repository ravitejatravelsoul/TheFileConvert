"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DropZone } from "./DropZone";
import { Button } from "@/components/ui/Button";
import { IconCheck, IconDownload, IconTrash, IconWarning } from "@/components/icons";
import { formatBytes, percentSmaller } from "@/lib/format";
import { validateFileForTool, isOverRecommendedSize } from "@/lib/security/validators";
import { triggerDownload, downloadAllAsZip, revokeAllObjectUrls } from "@/lib/download";
import { takePendingFiles } from "@/lib/file-handoff";
import type { ToolDefinition } from "@/lib/tools/types";

export interface FileWorkflowResult {
  name: string;
  blob: Blob;
  /** One honest line about what was actually done to this file, shown under its name. */
  note?: string;
  /** A short status pill next to the file name — e.g. "Target reached" vs "Closest safe result",
   * so a target-size tool's outcome is visible at a glance, not just in the note text. */
  badge?: { text: string; tone: "success" | "warning" };
}

type WorkflowStatus = "empty" | "ready" | "processing" | "done" | "error";

/** `report` is an optional second argument a handler can call with a short present-tense label
 * ("Trying high quality…") to replace the generic "Processing…" text while it runs. Purely cosmetic —
 * handlers that never call it behave exactly as before. */
export type FileWorkflowRun = (handler: (files: File[], report: (label: string) => void) => Promise<FileWorkflowResult[]>) => void;

interface RunContext {
  files: File[];
  status: WorkflowStatus;
  removeFile: (index: number) => void;
  reset: () => void;
  run: FileWorkflowRun;
}

interface FileWorkflowProps {
  tool: ToolDefinition;
  multiple?: boolean;
  zipDownloadName?: string;
  /** Shown under the size comparison when the output is not meaningfully smaller than the input. */
  noSavingsHint?: string;
  children: (ctx: RunContext) => React.ReactNode;
}

function acceptAttr(tool: ToolDefinition): string | undefined {
  if (tool.acceptedExtensions.includes("*")) return undefined;
  const exts = tool.acceptedExtensions.map((e) => `.${e}`);
  const mimes = tool.acceptedMimeTypes.filter((m) => m !== "*");
  return [...exts, ...mimes].join(",");
}

export function FileWorkflow({ tool, multiple, zipDownloadName, noSavingsHint, children }: FileWorkflowProps) {
  const allowMultiple = multiple ?? tool.supportsMultiple;
  const [files, setFiles] = useState<File[]>([]);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkflowStatus>("empty");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileWorkflowResult[]>([]);
  const runIdRef = useRef(0);

  useEffect(() => {
    return () => revokeAllObjectUrls();
  }, []);

  const addFiles = useCallback(
    async (incoming: File[]) => {
      setError(null);
      setFileWarning(null);
      const accepted: File[] = [];
      const rejections: string[] = [];

      for (const file of incoming) {
        const result = await validateFileForTool(file, tool);
        if (result.valid) {
          accepted.push(file);
          if (isOverRecommendedSize(file, tool)) {
            setFileWarning(
              `${file.name} is larger than we recommend for smooth in-browser processing — it may take a while.`
            );
          }
        } else {
          rejections.push(`${file.name}: ${result.error}`);
        }
      }

      if (rejections.length > 0) {
        setError(rejections.join(" "));
      }
      if (accepted.length > 0) {
        setFiles((prev) => (allowMultiple ? [...prev, ...accepted] : accepted.slice(0, 1)));
        setStatus("ready");
      }
    },
    [allowMultiple, tool]
  );

  // A file picked on the home page arrives here via a one-shot in-memory handoff.
  useEffect(() => {
    const handed = takePendingFiles();
    // Syncing with an external one-shot source on first mount; addFiles validates asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (handed.length > 0) void addFiles(handed);
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setStatus("empty");
      return next;
    });
  }, []);

  // Order matters for merge / images-to-PDF / ZIP: files are processed top to bottom, so the list
  // has to be reorderable, not just removable.
  const moveFile = useCallback((index: number, delta: -1 | 1) => {
    setFiles((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setResults([]);
    setError(null);
    setFileWarning(null);
    setStatus("empty");
  }, []);

  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  const run = useCallback(
    (handler: (files: File[], report: (label: string) => void) => Promise<FileWorkflowResult[]>) => {
      const runId = ++runIdRef.current;
      setStatus("processing");
      setError(null);
      setProgressLabel(null);
      const report = (label: string) => {
        if (runIdRef.current === runId) setProgressLabel(label);
      };
      handler(files, report)
        .then((out) => {
          if (runIdRef.current !== runId) return;
          setResults(out);
          setStatus("done");
        })
        .catch((e: unknown) => {
          if (runIdRef.current !== runId) return;
          const message =
            e instanceof Error ? e.message : "Something went wrong while processing this file.";
          setError(message);
          setStatus("error");
        });
    },
    [files]
  );

  if (status === "empty") {
    return (
      <div className="space-y-4">
        <DropZone
          accept={acceptAttr(tool)}
          multiple={allowMultiple}
          onFiles={addFiles}
          hint={`or click to choose ${allowMultiple ? "files" : "a file"} — ${tool.acceptedExtensions
            .filter((e) => e !== "*")
            .map((e) => e.toUpperCase())
            .join(", ") || "any file"}`}
        />
        {error && <ErrorBanner message={error} />}
      </div>
    );
  }

  if (status === "processing") {
    return (
      <div className="card-surface flex flex-col items-center gap-4 p-12 text-center animate-fade-in">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--brand)]" />
        <p className="font-medium text-[var(--foreground)]" aria-live="polite">
          {progressLabel ?? `Processing your file${files.length > 1 ? "s" : ""}…`}
        </p>
        <p className="text-sm text-[var(--foreground-muted)]">
          This is happening in your browser — nothing is uploaded anywhere.
        </p>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="card-surface flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]">
            <IconCheck className="h-6 w-6" />
          </div>
          <p className="text-lg font-semibold text-[var(--foreground)]">Done!</p>
          <p className="text-sm text-[var(--foreground-muted)]">
            {results.length === 1 ? "Your file is ready." : `${results.length} files are ready.`}
          </p>
        </div>

        {files.length === 1 && results.length === 1 && (
          <SizeComparison originalBytes={files[0].size} newBytes={results[0].blob.size} noSavingsHint={noSavingsHint} />
        )}

        <ul className="space-y-2">
          {results.map((r, i) => (
            <li
              key={`${r.name}-${i}`}
              className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--foreground)]">{r.name}</span>
                  {r.badge && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.badge.tone === "success"
                          ? "bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]"
                          : "bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                      }`}
                    >
                      {r.badge.text}
                    </span>
                  )}
                </div>
                {r.note && <span className="block text-xs text-[var(--foreground-muted)]">{r.note}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-[var(--foreground-muted)]">{formatBytes(r.blob.size)}</span>
                <button
                  onClick={() => triggerDownload(r.name, r.blob)}
                  aria-label={`Download ${r.name}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
                >
                  <IconDownload className="h-3.5 w-3.5" />
                  Download
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-3">
          {results.length === 1 ? (
            <Button onClick={() => triggerDownload(results[0].name, results[0].blob)}>
              <IconDownload className="h-4 w-4" />
              Download
            </Button>
          ) : (
            <Button
              onClick={() => downloadAllAsZip(zipDownloadName ?? "thefileconvert-files.zip", results)}
            >
              <IconDownload className="h-4 w-4" />
              Download all as ZIP
            </Button>
          )}
          <Button variant="secondary" onClick={reset}>
            Process another file
          </Button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error ?? "Something went wrong."} />
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <ul className="space-y-2">
        {files.map((file, i) => (
          <li
            key={`${file.name}-${i}`}
            className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">{file.name}</p>
              <p className="text-xs text-[var(--foreground-muted)]">{formatBytes(file.size)}</p>
            </div>
            {allowMultiple && files.length > 1 && (
              <div className="ml-3 flex shrink-0 items-center gap-1">
                <button
                  onClick={() => moveFile(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${file.name} up`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  onClick={() => moveFile(i, 1)}
                  disabled={i === files.length - 1}
                  aria-label={`Move ${file.name} down`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] disabled:opacity-30 disabled:hover:bg-transparent [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
                >
                  <span aria-hidden="true">↓</span>
                </button>
              </div>
            )}
            <button
              onClick={() => removeFile(i)}
              aria-label={`Remove ${file.name}`}
              className="ml-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--foreground-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-red-500 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
            >
              <IconTrash className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      {allowMultiple && (
        <DropZone
          compact
          accept={acceptAttr(tool)}
          multiple
          onFiles={addFiles}
          label="Add more files"
          hint="drag more in, or click to browse"
        />
      )}

      {fileWarning && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--brand-strong)]">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{fileWarning}</span>
        </div>
      )}
      {error && <ErrorBanner message={error} />}

      {
        // `run` closes over a ref used only inside its own async callbacks (never
        // during render) to ignore stale results if the user re-runs before a
        // previous operation finishes. eslint's static analysis can't see that,
        // since `run` is merely passed here, not invoked.
        // eslint-disable-next-line react-hooks/refs
        children({ files, status, removeFile, reset, run })
      }
    </div>
  );
}

function SizeComparison({ originalBytes, newBytes, noSavingsHint }: { originalBytes: number; newBytes: number; noSavingsHint?: string }) {
  const saved = percentSmaller(originalBytes, newBytes);
  // A meaningful claim needs a real, visible reduction — anything smaller than that is
  // noise (or the file quietly growing slightly), and showing "1% smaller" or nothing at
  // all when it grew would both be misleading. Say so honestly instead.
  const meaningfulReduction = newBytes < originalBytes && saved >= 2;
  const grewPercent = originalBytes > 0 ? Math.round(((newBytes - originalBytes) / originalBytes) * 100) : 0;
  const grew = newBytes > originalBytes && grewPercent >= 2;

  return (
    <div className="space-y-2">
    <div className="grid grid-cols-3 gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
      <div>
        <p className="text-xs text-[var(--foreground-muted)]">Original</p>
        <p className="mt-1 font-semibold text-[var(--foreground)]">{formatBytes(originalBytes)}</p>
      </div>
      <div>
        <p className="text-xs text-[var(--foreground-muted)]">New size</p>
        <p className="mt-1 font-semibold text-[var(--foreground)]">{formatBytes(newBytes)}</p>
      </div>
      <div>
        <p className="text-xs text-[var(--foreground-muted)]">Result</p>
        {meaningfulReduction ? (
          <p className="mt-1 font-semibold text-[var(--accent-mint)]">{saved >= 99 ? "99%+" : saved}% smaller</p>
        ) : grew ? (
          <p className="mt-1 font-semibold text-[var(--foreground)]">{grewPercent}% larger — keep your original</p>
        ) : (
          <p className="mt-1 font-semibold text-[var(--foreground-muted)]">No significant change</p>
        )}
      </div>
    </div>
    <p className="px-1 text-center text-xs text-[var(--foreground-muted)]" data-testid="exact-bytes">
      Exact: {originalBytes.toLocaleString("en-US")} bytes → {newBytes.toLocaleString("en-US")} bytes (
      {newBytes <= originalBytes ? `${(originalBytes - newBytes).toLocaleString("en-US")} fewer` : `${(newBytes - originalBytes).toLocaleString("en-US")} more`})
    </p>
    {!meaningfulReduction && noSavingsHint && <p className="px-1 text-sm text-[var(--foreground-muted)]">{noSavingsHint}</p>}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
      <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
