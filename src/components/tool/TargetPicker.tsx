"use client";

import { useId } from "react";
import { formatTarget, parseTarget, type SizeUnit } from "@/lib/size";

export interface TargetChoice {
  preset: number | "custom";
  customValue: string;
  customUnit: SizeUnit;
}

export function resolveTarget(choice: TargetChoice): number | null {
  return choice.preset === "custom" ? parseTarget(choice.customValue, choice.customUnit) : choice.preset;
}

/**
 * "How small do you need it?" — quick targets plus a custom size. A radio group, so arrow keys move
 * between the options like any other set of choices.
 */
export function TargetPicker({
  presets,
  value,
  onChange,
  originalBytes,
}: {
  presets: number[];
  value: TargetChoice;
  onChange: (next: TargetChoice) => void;
  originalBytes: number;
}) {
  const labelId = useId();
  const customId = useId();
  const custom = value.preset === "custom";
  const customBytes = custom ? parseTarget(value.customValue, value.customUnit) : null;
  const customInvalid = custom && value.customValue.trim() !== "" && customBytes === null;

  return (
    <fieldset>
      <legend id={labelId} className="text-[1.35rem] font-semibold tracking-[-0.025em]">
        How small do you need it?
      </legend>
      <div role="radiogroup" aria-labelledby={labelId} className="mt-4 flex flex-wrap gap-2">
        {presets.map((bytes) => {
          const larger = bytes >= originalBytes;
          return (
            <button
              key={bytes}
              type="button"
              role="radio"
              aria-checked={value.preset === bytes}
              onClick={() => onChange({ ...value, preset: bytes })}
              className="chip tabular"
              title={larger ? "Your file is already smaller than this" : undefined}
            >
              {formatTarget(bytes)}
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={custom} onClick={() => onChange({ ...value, preset: "custom" })} className="chip">
          Custom
        </button>
      </div>

      {custom && (
        <div className="mt-4 flex max-w-sm items-stretch gap-2">
          <label htmlFor={customId} className="sr-only">
            Custom target size
          </label>
          <input
            id={customId}
            autoFocus
            inputMode="decimal"
            placeholder="e.g. 750"
            value={value.customValue}
            onChange={(e) => onChange({ ...value, customValue: e.target.value })}
            aria-invalid={customInvalid || undefined}
            className="field tabular flex-1"
          />
          <div role="radiogroup" aria-label="Unit" className="flex rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] p-1">
            {(["KB", "MB"] as const).map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={value.customUnit === u}
                onClick={() => onChange({ ...value, customUnit: u })}
                className="min-w-12 rounded-[7px] px-3 text-sm font-semibold text-[var(--ink-2)] aria-checked:bg-[var(--ink)] aria-checked:text-white"
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      )}
      {customInvalid && <p className="mt-2 text-sm text-[var(--danger)]">Enter a size of at least 1 KB, like 750 or 1.5.</p>}
    </fieldset>
  );
}
