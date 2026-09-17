"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectField } from "@/components/tools/fields";
import { IconCheck } from "@/components/icons";
import { hashText, hashFile, type HashAlgorithm } from "@/lib/processors/data";

const ALGORITHMS: HashAlgorithm[] = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];

export function HashGeneratorWorkflow() {
  const [source, setSource] = useState<"text" | "file">("text");
  const [algorithm, setAlgorithm] = useState<HashAlgorithm>("SHA-256");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setError(null);
    try {
      if (source === "text") {
        if (!text) {
          setError("Enter some text first.");
          return;
        }
        setHash(await hashText(text, algorithm));
      } else {
        if (!file) {
          setError("Choose a file first.");
          return;
        }
        setHash(await hashFile(file, algorithm));
      }
    } catch {
      setError("Something went wrong computing the hash.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4">
        <Field label="Source">
          <SelectField
            value={source}
            onChange={(v) => setSource(v as "text" | "file")}
            options={[
              { value: "text", label: "Text" },
              { value: "file", label: "File" },
            ]}
          />
        </Field>
        <Field label="Algorithm">
          <SelectField
            value={algorithm}
            onChange={(v) => setAlgorithm(v as HashAlgorithm)}
            options={ALGORITHMS.map((a) => ({ value: a, label: a }))}
          />
        </Field>
      </div>

      {source === "text" ? (
        <textarea
          aria-label="Text to hash"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to hash…"
          rows={6}
          className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--brand)]"
        />
      ) : (
        <input
          type="file"
          aria-label="Choose a file to hash"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-[var(--foreground-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--brand-soft)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-[var(--brand)]"
        />
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Button onClick={generate}>Generate hash</Button>

      {hash && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
          <code className="break-all text-sm text-[var(--foreground)]">{hash}</code>
          <button onClick={copy} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">
            {copied ? <IconCheck className="h-3.5 w-3.5" /> : null}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
