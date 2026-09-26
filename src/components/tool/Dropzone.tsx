"use client";

import { useId, useRef, useState } from "react";
import { IconLock, IconUpload } from "@/components/icons";

interface DropzoneProps {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  /** "Drop your PDF here" */
  title: string;
  buttonLabel: string;
  hint?: string;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * The one way files enter a tool. The whole surface is a drop target and clicking anywhere opens
 * the picker; the visible button is the keyboard/screen-reader entry point.
 */
export function Dropzone({ accept, multiple, onFiles, title, buttonLabel, hint, compact, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hintId = useId();

  function take(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  return (
    <div
      onClick={(e) => {
        if (disabled || e.target === inputRef.current) return;
        if ((e.target as HTMLElement).closest("button")) return;
        inputRef.current?.click();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      data-dragging={dragging || undefined}
      className={`hatch group relative flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-xl)] border-[1.5px] border-dashed text-center transition-[background-color,border-color] duration-200 ${
        compact ? "gap-3 px-5 py-8" : "gap-4 px-6 py-10 sm:gap-5 sm:py-20"
      } ${dragging ? "border-[var(--ink)] bg-[var(--accent-soft)]" : "border-[var(--line-strong)] bg-[var(--surface)] hover:border-[var(--ink-3)]"}`}
    >
      {!compact && (
        <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[var(--ink)] text-white shadow-[var(--shadow-button)] transition-transform duration-300 group-hover:-translate-y-0.5">
          <IconUpload className="h-6 w-6" />
        </span>
      )}
      <div>
        <p className={`${compact ? "text-lg" : "text-[1.35rem] sm:text-2xl"} font-semibold tracking-[-0.025em] text-[var(--ink)]`}>
          {dragging ? "Drop to add" : title}
        </p>
        {!compact && <p className="mt-1.5 text-[0.9375rem] text-[var(--ink-2)]">or</p>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-describedby={hint ? hintId : undefined}
        className={`btn btn-primary ${compact ? "" : "btn-lg"}`}
      >
        {buttonLabel}
      </button>
      {hint && (
        <p id={hintId} className="flex items-center gap-1.5 text-[0.8125rem] text-[var(--ink-2)]">
          <IconLock className="h-3.5 w-3.5" />
          {hint}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        data-testid="file-input"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
