"use client";

import { useState } from "react";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import type { ToolOptions } from "./toolOptions";
import { PRESET_COLORS, rgbToCss } from "./toolOptions";
import { SUPPORTED_OCR_LANGUAGES } from "@/lib/processors/ocr";
import { addWatermark, addPageNumbers, type WatermarkOptions, type PageNumberOptions } from "@/lib/processors/pdf";
import { exportEditorDocument } from "@/lib/editor/export";
import { IconTrash, IconWarning } from "@/components/icons";
import type { EditorDocument } from "@/lib/editor/types";

interface PropertiesPanelProps {
  api: EditorWorkspaceApi;
  doc: EditorDocument;
  toolOptions: ToolOptions;
  onToolOptionsChange: (patch: Partial<ToolOptions>) => void;
}

export function PropertiesPanel({ api, doc, toolOptions, onToolOptionsChange }: PropertiesPanelProps) {
  const { state } = api;
  const selectedObject = doc.objects.find((o) => o.id === state.selectedObjectId) ?? null;
  const activePage = doc.pages.find((p) => p.id === state.activePageId) ?? null;
  const scannedPages = doc.pages.filter((p) => state.pageClassifications[p.id] && state.pageClassifications[p.id] !== "native");

  return (
    <div className="flex h-full w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      {state.signedWarning && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--brand-soft)] p-2.5 text-xs text-[var(--brand-strong)]">
          <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Editing this PDF may invalidate existing digital signatures.</span>
        </div>
      )}

      {selectedObject && (
        <Section title="Selected object" defaultOpen>
          <ObjectProperties api={api} object={selectedObject} />
        </Section>
      )}

      <Section title="Drawing options" defaultOpen={!selectedObject}>
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--foreground)]">Color</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  aria-label={c.label}
                  onClick={() => onToolOptionsChange({ color: c.value })}
                  className={`h-6 w-6 rounded-full border ${toolOptions.color === c.value ? "ring-2 ring-[var(--brand)]" : "border-[var(--border)]"}`}
                  style={{ backgroundColor: rgbToCss(c.value) }}
                />
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Stroke width</span>
            <input
              type="range"
              min={1}
              max={12}
              value={toolOptions.strokeWidth}
              onChange={(e) => onToolOptionsChange({ strokeWidth: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Font size</span>
            <input
              type="number"
              min={6}
              max={72}
              value={toolOptions.fontSize}
              onChange={(e) => onToolOptionsChange({ fontSize: Number(e.target.value) })}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={toolOptions.fillShape}
              onChange={(e) => onToolOptionsChange({ fillShape: e.target.checked })}
              className="accent-[var(--brand)]"
            />
            Fill shapes
          </label>
        </div>
      </Section>

      <Section title="OCR">
        <div className="space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Language</span>
            <select
              value={state.ocrLanguage}
              onChange={(e) => api.setOcrLanguage(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
            >
              {SUPPORTED_OCR_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          {activePage && state.pageClassifications[activePage.id] && state.pageClassifications[activePage.id] !== "native" && (
            <p className="rounded-[var(--radius-sm)] bg-[var(--brand-soft)] p-2 text-xs text-[var(--brand-strong)]">
              Scanned page detected. No editable text was found on this page.
            </p>
          )}

          {state.ocrProgress ? (
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--foreground-muted)]">{state.ocrProgress.label}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <div className="h-full bg-[var(--brand)]" style={{ width: `${Math.round(state.ocrProgress.fraction * 100)}%` }} />
              </div>
              <button type="button" onClick={api.cancelOcr} className="text-xs font-medium text-[var(--brand)] hover:underline">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={!activePage}
                onClick={() => activePage && api.runOcr([activePage.id])}
                className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
              >
                Recognize current page
              </button>
              <button
                type="button"
                disabled={scannedPages.length === 0}
                onClick={() => api.runOcr(scannedPages.map((p) => p.id))}
                className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
              >
                Recognize all scanned pages ({scannedPages.length})
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.showOcrOverlay}
              onChange={(e) => api.setShowOcrOverlay(e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Show recognized text overlay
          </label>

          {activePage && state.ocrResultsByPage[activePage.id] && (
            <LowConfidenceReview count={state.ocrResultsByPage[activePage.id].lowConfidenceWordCount} />
          )}
        </div>
      </Section>

      <Section title="Search">
        <SearchPanel api={api} />
      </Section>

      {doc.formFields.length > 0 && (
        <Section title={`Form fields (${doc.formFields.length})`}>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {doc.formFields.map((field) => (
              <div key={field.name}>
                <label className="mb-1 block text-xs text-[var(--foreground-muted)]" htmlFor={`field-${field.name}`}>
                  {field.name}
                </label>
                {field.kind === "checkbox" ? (
                  <input
                    id={`field-${field.name}`}
                    type="checkbox"
                    checked={field.value === "true"}
                    onChange={(e) => api.setFormFieldValue(field.name, e.target.checked ? "true" : "false")}
                    className="accent-[var(--brand)]"
                  />
                ) : (
                  <input
                    id={`field-${field.name}`}
                    type="text"
                    value={field.value}
                    onChange={(e) => api.setFormFieldValue(field.name, e.target.value)}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
                  />
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Watermark & page numbers">
        <WholeDocumentTools api={api} />
      </Section>
    </div>
  );
}

function Section({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-[var(--radius-sm)] border border-[var(--border)]">
      <summary className="cursor-pointer list-none px-2.5 py-2 text-xs font-semibold text-[var(--foreground)]">{title}</summary>
      <div className="border-t border-[var(--border)] p-2.5">{children}</div>
    </details>
  );
}

function ObjectProperties({ api, object }: { api: EditorWorkspaceApi; object: NonNullable<EditorWorkspaceApi["state"]["doc"]["objects"][number]> }) {
  return (
    <div className="space-y-2.5">
      {(object.type === "added-text" || object.type === "native-text-replacement" || object.type === "ocr-text-replacement") && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--foreground)]">Text</span>
          <textarea
            value={object.type === "added-text" ? object.text : object.newText}
            onChange={(e) =>
              api.updateObject(object.id, object.type === "added-text" ? { text: e.target.value } : { newText: e.target.value })
            }
            rows={2}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
          />
        </label>
      )}
      {"originalText" in object && (
        <p className="text-xs text-[var(--foreground-muted)]">
          Detected: <span className="italic">&ldquo;{object.originalText}&rdquo;</span>
          {"confidence" in object && ` (${Math.round(object.confidence)}% confidence)`}
        </p>
      )}
      <button
        type="button"
        onClick={() => api.deleteObject(object.id)}
        aria-label="Delete selected object"
        className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
      >
        <IconTrash className="h-3.5 w-3.5" />
        Delete
      </button>
    </div>
  );
}

function LowConfidenceReview({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="rounded-[var(--radius-sm)] bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
      {count} word{count === 1 ? "" : "s"} may need review — look for red-outlined regions when the overlay is on.
    </p>
  );
}

function SearchPanel({ api }: { api: EditorWorkspaceApi }) {
  const { state, searchIndex } = api;
  return (
    <div className="space-y-2">
      <input
        type="search"
        value={state.searchQuery}
        onChange={(e) => api.setSearchQuery(e.target.value)}
        placeholder="Search this document…"
        aria-label="Search document text"
        className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
      />
      {state.searchQuery && (
        <div className="flex items-center justify-between text-xs text-[var(--foreground-muted)]">
          <span>
            {searchIndex.length > 0 ? `${state.searchMatchIndex + 1} of ${searchIndex.length}` : "No matches"}
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={api.prevMatch} disabled={searchIndex.length === 0} className="rounded px-2 py-0.5 hover:bg-[var(--surface-muted)] disabled:opacity-40">
              Prev
            </button>
            <button type="button" onClick={api.nextMatch} disabled={searchIndex.length === 0} className="rounded px-2 py-0.5 hover:bg-[var(--surface-muted)] disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WholeDocumentTools({ api }: { api: EditorWorkspaceApi }) {
  const [watermarkText, setWatermarkText] = useState("");
  const [busy, setBusy] = useState<"watermark" | "numbers" | null>(null);

  /** Bakes every edit made so far into a real PDF, then re-opens that as a fresh editor
   * session — this is how whole-document operations (which reuse the standalone
   * processors, not movable objects) compose with everything already done in-session. */
  async function bakeThenReload(transform: (file: File) => Promise<Blob>) {
    const currentBlob = await exportEditorDocument(api.state.doc);
    const currentFile = new File([currentBlob], "document.pdf", { type: "application/pdf" });
    const transformed = await transform(currentFile);
    await api.openFile(new File([transformed], "document.pdf", { type: "application/pdf" }));
  }

  async function applyWatermark() {
    if (!watermarkText.trim()) return;
    setBusy("watermark");
    try {
      const options: WatermarkOptions = { text: watermarkText, opacity: 0.3, fontSize: 48, rotationDegrees: 45 };
      await bakeThenReload((file) => addWatermark(file, options));
      setWatermarkText("");
    } finally {
      setBusy(null);
    }
  }

  async function applyPageNumbers() {
    setBusy("numbers");
    try {
      const options: PageNumberOptions = { position: "bottom-center", startAt: 1, fontSize: 11 };
      await bakeThenReload((file) => addPageNumbers(file, options));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--foreground-muted)]">
        These apply to the whole document immediately (reusing the standalone Watermark and Page Numbers tools) rather than
        being movable objects.
      </p>
      <div className="space-y-1.5">
        <input
          type="text"
          value={watermarkText}
          onChange={(e) => setWatermarkText(e.target.value)}
          placeholder="Watermark text"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={busy !== null || !watermarkText.trim()}
          onClick={applyWatermark}
          className="w-full rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
        >
          {busy === "watermark" ? "Applying…" : "Add watermark"}
        </button>
      </div>
      <button
        type="button"
        disabled={busy !== null}
        onClick={applyPageNumbers}
        className="w-full rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
      >
        {busy === "numbers" ? "Applying…" : "Add page numbers"}
      </button>
    </div>
  );
}
