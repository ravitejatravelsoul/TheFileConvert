"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { diffLines, type DiffLine } from "@/lib/processors/data";

export function TextDiffWorkflow() {
  const [original, setOriginal] = useState("");
  const [changed, setChanged] = useState("");
  const [diff, setDiff] = useState<DiffLine[] | null>(null);
  const originalId = useId();
  const changedId = useId();

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor={originalId} className="mb-2 block text-sm font-medium text-[var(--foreground)]">Original text</label>
          <textarea
            id={originalId}
            value={original}
            onChange={(e) => setOriginal(e.target.value)}
            rows={10}
            className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)]"
          />
        </div>
        <div>
          <label htmlFor={changedId} className="mb-2 block text-sm font-medium text-[var(--foreground)]">Changed text</label>
          <textarea
            id={changedId}
            value={changed}
            onChange={(e) => setChanged(e.target.value)}
            rows={10}
            className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)]"
          />
        </div>
      </div>

      <Button onClick={() => setDiff(diffLines(original, changed))}>Compare</Button>

      {diff && (
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] font-mono text-sm">
          {diff.map((line, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap px-4 py-1 ${
                line.type === "added"
                  ? "bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]"
                  : line.type === "removed"
                    ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                    : "bg-[var(--surface)] text-[var(--foreground-muted)]"
              }`}
            >
              {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
              {line.text || " "}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
