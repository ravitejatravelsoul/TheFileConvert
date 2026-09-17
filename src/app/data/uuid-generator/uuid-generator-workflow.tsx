"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, NumberField } from "@/components/tools/fields";
import { IconCheck, IconDownload } from "@/components/icons";
import { generateUuidV4 } from "@/lib/processors/data";
import { triggerDownload } from "@/lib/download";

export function UuidGeneratorWorkflow() {
  const [count, setCount] = useState(5);
  const [uuids, setUuids] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const generate = () => {
    setUuids(Array.from({ length: Math.max(1, Math.min(count, 500)) }, () => generateUuidV4()));
  };

  // Generating a UUID is inherently non-deterministic, so it must happen only on the
  // client after hydration — doing it during the initial render would produce a
  // different value on the server than on the client and break hydration.
  useEffect(() => {
    // One-time client-only seed (not a sync loop): a UUID is inherently random, so it
    // can only be generated after hydration, never during the initial render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUuids([generateUuidV4()]);
  }, []);

  const copy = async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1400);
    } catch {
      // Clipboard API may be blocked; the value is still selectable text.
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="How many?">
          <NumberField value={count} onChange={setCount} min={1} max={500} />
        </Field>
        <Button onClick={generate}>Generate</Button>
        {uuids.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => triggerDownload("uuids.txt", new Blob([uuids.join("\n")], { type: "text/plain" }))}
          >
            <IconDownload className="h-4 w-4" />
            Download all
          </Button>
        )}
      </div>
      <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
        {uuids.map((uuid, i) => (
          <li key={`${uuid}-${i}`} className="flex items-center justify-between px-4 py-2.5">
            <code className="text-sm text-[var(--foreground)]">{uuid}</code>
            <button
              onClick={() => copy(uuid, i)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline"
            >
              {copiedIndex === i ? <IconCheck className="h-3.5 w-3.5" /> : null}
              {copiedIndex === i ? "Copied" : "Copy"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
