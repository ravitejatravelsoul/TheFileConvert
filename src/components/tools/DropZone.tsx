"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { IconUpload } from "@/components/icons";

interface DropZoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  label?: string;
  hint?: string;
  compact?: boolean;
}

export function DropZone({
  accept,
  multiple = false,
  onFiles,
  label = "Drop your files here",
  hint = "or click to choose files",
  compact = false,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      onFiles(Array.from(fileList));
    },
    [onFiles]
  );

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) setIsDragging(false);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-lg)] border-2 border-dashed text-center transition-all duration-200 ${
        compact ? "p-8" : "p-14"
      } ${
        isDragging
          ? "border-[var(--brand)] bg-[var(--brand-soft)] scale-[1.01]"
          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]/40"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div
        className={`flex items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)] transition-transform duration-200 group-hover:scale-110 ${
          compact ? "h-12 w-12" : "h-16 w-16"
        } ${isDragging ? "scale-110" : ""}`}
      >
        <IconUpload className={compact ? "h-6 w-6" : "h-7 w-7"} />
      </div>
      <p className={`mt-4 font-semibold text-[var(--foreground)] ${compact ? "text-base" : "text-xl"}`}>
        {label}
      </p>
      <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">{hint}</p>
    </div>
  );
}
