"use client";

import { useMemo, useState } from "react";
import { countWords } from "@/lib/processors/data";

const STAT_LABELS: { key: keyof ReturnType<typeof countWords>; label: string }[] = [
  { key: "words", label: "Words" },
  { key: "characters", label: "Characters" },
  { key: "charactersNoSpaces", label: "Characters (no spaces)" },
  { key: "sentences", label: "Sentences" },
  { key: "paragraphs", label: "Paragraphs" },
  { key: "readingTimeMinutes", label: "Reading time (min)" },
];

export function WordCounterWorkflow() {
  const [text, setText] = useState("");
  const stats = useMemo(() => countWords(text), [text]);

  return (
    <div className="space-y-4">
      <textarea
        aria-label="Text to count"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing or paste your text…"
        rows={12}
        className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)]"
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STAT_LABELS.map(({ key, label }) => (
          <div key={key} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
            <p className="text-2xl font-semibold text-[var(--foreground)]">{stats[key]}</p>
            <p className="mt-1 text-xs text-[var(--foreground-muted)]">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
