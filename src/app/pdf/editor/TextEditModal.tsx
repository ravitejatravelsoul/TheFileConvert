"use client";

import { useState } from "react";
import type { EditableRegionRequest } from "./PageSurface";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import { Button } from "@/components/ui/Button";
import { COLOR_BLACK } from "@/lib/editor/types";

interface TextEditModalProps {
  request: EditableRegionRequest;
  api: EditorWorkspaceApi;
  onClose: () => void;
}

export function TextEditModal({ request, api, onClose }: TextEditModalProps) {
  const [value, setValue] = useState(request.text);

  function save() {
    if (value === request.text) {
      onClose();
      return;
    }
    const box = request.pdfBox;
    if (request.kind === "native") {
      api.addObject({
        id: api.newObjectId(),
        type: "native-text-replacement",
        pageId: request.pageId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        originalText: request.text,
        newText: value,
        fontSize: Math.max(6, box.height * 0.8),
        color: COLOR_BLACK,
      });
    } else {
      api.addObject({
        id: api.newObjectId(),
        type: "ocr-text-replacement",
        pageId: request.pageId,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        originalText: request.text,
        newText: value,
        confidence: request.confidence ?? 0,
      });
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lifted)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="text-edit-heading"
      >
        <h2 id="text-edit-heading" className="text-base font-semibold text-[var(--foreground)]">
          Edit text
        </h2>
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          Detected: <span className="italic">&ldquo;{request.text}&rdquo;</span>
          {request.kind === "ocr" && request.confidence !== undefined && ` (${Math.round(request.confidence)}% confidence)`}
        </p>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Replacement</span>
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onClose();
            }}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
          />
        </label>
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          Best for short text corrections. Complex formatting, embedded fonts, and paragraph reflow may not be preserved
          exactly.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save correction</Button>
        </div>
      </div>
    </div>
  );
}
