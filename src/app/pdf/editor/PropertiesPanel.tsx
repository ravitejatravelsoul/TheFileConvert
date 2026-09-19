"use client";

import { useState } from "react";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import type { ToolOptions } from "./toolOptions";
import { PRESET_COLORS, rgbToCss, rgbToHex, hexToRgb, optionsFromObject, objectPatchFromOptions } from "./toolOptions";
import { SUPPORTED_OCR_LANGUAGES } from "@/lib/processors/ocr";
import { addWatermark, addPageNumbers, addHeaderFooter, type WatermarkOptions, type PageNumberOptions, type HeaderFooterOptions } from "@/lib/processors/pdf";
import { exportEditorDocument } from "@/lib/editor/export";
import { IconTrash, IconWarning } from "@/components/icons";
import type { EditorDocument } from "@/lib/editor/types";

interface PropertiesPanelProps {
  api: EditorWorkspaceApi;
  doc: EditorDocument;
  toolOptions: ToolOptions;
  onToolOptionsChange: (patch: Partial<ToolOptions>) => void;
}

export function PropertiesPanel({ api, doc, toolOptions: defaultOptions, onToolOptionsChange: changeDefaults }: PropertiesPanelProps) {
  const { state } = api;
  const selectedObject = doc.objects.find((o) => o.id === state.selectedObjectId) ?? null;
  // With an object selected, the color/size/stroke/fill controls show and edit *that object*
  // (and still update the defaults for the next one drawn); with nothing selected they only
  // set the defaults.
  const toolOptions = selectedObject ? optionsFromObject(selectedObject, defaultOptions) : defaultOptions;
  const onToolOptionsChange = (patch: Partial<ToolOptions>) => {
    changeDefaults(patch);
    if (!selectedObject) return;
    const objectPatch = objectPatchFromOptions(selectedObject, patch);
    if (objectPatch) api.updateObject(selectedObject.id, objectPatch, { coalesceKey: `opt:${selectedObject.id}:${Object.keys(patch).join(",")}` });
  };
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

      {(state.activeTool === "whiteout" || selectedObject?.type === "whiteout") && (
        <div role="note" className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Whiteout only covers what&rsquo;s underneath — the original text or image is still inside the PDF file. It is not secure
            redaction; don&rsquo;t use it to hide sensitive information.
          </span>
        </div>
      )}

      {selectedObject && (
        <Section title="Selected object" defaultOpen>
          <ObjectProperties api={api} object={selectedObject} />
        </Section>
      )}

      {/* Always open: with an object selected these controls edit that object (color, size,
          stroke, fill), so collapsing them the moment something is selected would hide exactly
          what you'd reach for next. */}
      <Section title="Drawing options" defaultOpen>
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
            <FontSizeField value={toolOptions.fontSize} onCommit={(n) => onToolOptionsChange({ fontSize: n })} />
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

      <Section title="Recognize Text (OCR)">
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
            // One canonical progress/cancel control lives in the workspace header banner
            // (always visible regardless of whether this section is expanded) — this just
            // reflects that it's running, rather than duplicating a second progress bar and
            // Cancel button here.
            <p className="text-xs text-[var(--foreground-muted)]">{state.ocrProgress.label} — see progress above.</p>
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
            Show text regions
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
                ) : field.options && field.options.length > 0 && (field.kind === "radio" || field.kind === "dropdown") ? (
                  <select
                    id={`field-${field.name}`}
                    value={field.value}
                    onChange={(e) => api.setFormFieldValue(field.name, e.target.value)}
                    className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
                  >
                    <option value="">{field.kind === "radio" ? "(none selected)" : "(choose…)"}</option>
                    {field.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
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

      <Section title="Crop">
        <CropTools api={api} />
      </Section>

      <Section title="Watermark, page numbers & header/footer">
        <WholeDocumentTools api={api} />
      </Section>
    </div>
  );
}

/** A number box that lets the user type freely (clearing it, passing through "1" on the way to
 * "18") and only applies values that are actually valid — a controlled input that clamped or
 * reset on every keystroke would fight the user's typing. */
function FontSizeField({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={6}
      max={72}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(n) && n >= 6 && n <= 72) onCommit(n);
      }}
      onBlur={() => setDraft(null)}
      className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
    />
  );
}

function CropTools({ api }: { api: EditorWorkspaceApi }) {
  const { state } = api;
  const activePage = state.doc.pages.find((p) => p.id === state.activePageId) ?? null;
  const draft = state.cropDraft;
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-[var(--foreground-muted)]">
        Select the Crop tool, then drag a box on the page to choose what to keep.
      </p>
      {draft ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--foreground)]">Crop area selected on page {state.doc.pages.findIndex((p) => p.id === draft.pageId) + 1}.</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} className="accent-[var(--brand)]" />
            Apply to every page (same coordinates)
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => api.applyCrop(applyToAll)}
              className="flex-1 rounded-full bg-[var(--button-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--button-bg-hover)]"
            >
              Apply crop
            </button>
            <button
              type="button"
              onClick={() => api.setCropDraft(null)}
              className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-red-50 hover:text-red-600"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        activePage?.cropBox && (
          <button
            type="button"
            onClick={() => api.clearCrop(activePage.id)}
            className="w-full rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium text-[var(--foreground-muted)] hover:bg-red-50 hover:text-red-600"
          >
            Remove crop on this page
          </button>
        )
      )}
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
            onChange={(e) => {
              if (object.type === "added-text") {
                api.updateObject(object.id, { text: e.target.value }, { coalesceKey: `text:${object.id}` });
              } else if (object.type === "ocr-text-replacement") {
                // Editing the text here would otherwise leave a stale raster patch (still
                // showing the old replacement word) — clear it so this falls back to simple
                // text rendering that actually reflects the new value.
                api.updateObject(object.id, { newText: e.target.value, patchDataUrl: undefined });
              } else {
                api.updateObject(object.id, { newText: e.target.value });
              }
            }}
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
      {object.type === "added-text" && (
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={object.bold}
              onChange={(e) => api.updateObject(object.id, { bold: e.target.checked })}
              className="accent-[var(--brand)]"
            />
            Bold
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="Text alignment">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={object.align === a}
                aria-label={`Align ${a}`}
                onClick={() => api.updateObject(object.id, { align: a })}
                className={`rounded-full px-2 py-0.5 capitalize ${object.align === a ? "bg-[var(--brand)] text-white" : "bg-[var(--surface-muted)] text-[var(--foreground-muted)]"}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
      {object.type === "ocr-text-replacement" && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--border)] p-2">
          <p className="text-xs font-medium text-[var(--foreground)]">
            Style {object.patchDataUrl ? `(auto-matched: ${object.fontCandidateId?.replace(/-/g, " ") ?? "auto"})` : "(manual)"}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--foreground-muted)]">Text</span>
              <input
                type="color"
                value={rgbToHex(object.textColor)}
                onChange={(e) => api.updateObject(object.id, { textColor: hexToRgb(e.target.value), patchDataUrl: undefined })}
                className="h-6 w-6 cursor-pointer rounded border border-[var(--border)]"
                aria-label="Replacement text color"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--foreground-muted)]">Background</span>
              <input
                type="color"
                value={rgbToHex(object.backgroundColor)}
                onChange={(e) => api.updateObject(object.id, { backgroundColor: hexToRgb(e.target.value), patchDataUrl: undefined })}
                disabled={object.overlayOnly}
                className="h-6 w-6 cursor-pointer rounded border border-[var(--border)] disabled:opacity-40"
                aria-label="Replacement background color"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--foreground-muted)]">Font size (blank = automatic)</span>
            <input
              type="number"
              min={4}
              max={72}
              value={object.fontSize ?? ""}
              placeholder="Auto"
              onChange={(e) =>
                api.updateObject(object.id, { fontSize: e.target.value ? Number(e.target.value) : undefined, patchDataUrl: undefined })
              }
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--foreground-muted)]">
            <input
              type="checkbox"
              checked={object.overlayOnly}
              onChange={(e) => api.updateObject(object.id, { overlayOnly: e.target.checked, patchDataUrl: undefined })}
              className="accent-[var(--brand)]"
            />
            Place as overlay instead of covering the background
          </label>
          {object.patchDataUrl && (
            <p className="text-[10px] text-[var(--foreground-muted)]">
              Any manual change here switches this word to simple text rendering instead of the auto-matched scan style.
            </p>
          )}
        </div>
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
  const [watermarkOpacity, setWatermarkOpacity] = useState(30); // percent
  const [watermarkRotation, setWatermarkRotation] = useState(45);
  const [pageNumberPosition, setPageNumberPosition] = useState<PageNumberOptions["position"]>("bottom-center");
  const [pageNumberStart, setPageNumberStart] = useState(1);
  const [headerFooterText, setHeaderFooterText] = useState("");
  const [headerFooterPosition, setHeaderFooterPosition] = useState<HeaderFooterOptions["position"]>("footer");
  const [headerFooterAlign, setHeaderFooterAlign] = useState<HeaderFooterOptions["align"]>("center");
  const [busy, setBusy] = useState<"watermark" | "numbers" | "header-footer" | null>(null);

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
      const options: WatermarkOptions = { text: watermarkText, opacity: watermarkOpacity / 100, fontSize: 48, rotationDegrees: watermarkRotation };
      await bakeThenReload((file) => addWatermark(file, options));
      setWatermarkText("");
    } finally {
      setBusy(null);
    }
  }

  async function applyPageNumbers() {
    setBusy("numbers");
    try {
      const options: PageNumberOptions = { position: pageNumberPosition, startAt: Math.max(0, Math.floor(pageNumberStart) || 1), fontSize: 11 };
      await bakeThenReload((file) => addPageNumbers(file, options));
    } finally {
      setBusy(null);
    }
  }

  async function applyHeaderFooter() {
    if (!headerFooterText.trim()) return;
    setBusy("header-footer");
    try {
      const options: HeaderFooterOptions = {
        text: headerFooterText,
        position: headerFooterPosition,
        align: headerFooterAlign,
        fontSize: 10,
      };
      await bakeThenReload((file) => addHeaderFooter(file, options));
      setHeaderFooterText("");
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
        <div className="flex items-center gap-2 text-xs">
          <label className="flex flex-1 items-center gap-1.5">
            <span className="text-[var(--foreground-muted)]">Opacity</span>
            <input
              type="range"
              min={5}
              max={100}
              value={watermarkOpacity}
              onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
              aria-label="Watermark opacity"
              className="w-full accent-[var(--brand)]"
            />
            <span className="w-8 text-right tabular-nums">{watermarkOpacity}%</span>
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--foreground-muted)]">Angle</span>
          <select
            value={watermarkRotation}
            onChange={(e) => setWatermarkRotation(Number(e.target.value))}
            aria-label="Watermark angle"
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
          >
            <option value={0}>Horizontal</option>
            <option value={45}>Diagonal (up)</option>
            <option value={-45}>Diagonal (down)</option>
            <option value={90}>Vertical</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy !== null || !watermarkText.trim()}
          onClick={applyWatermark}
          className="w-full rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
        >
          {busy === "watermark" ? "Applying…" : "Add watermark"}
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <select
          value={pageNumberPosition}
          onChange={(e) => setPageNumberPosition(e.target.value as PageNumberOptions["position"])}
          aria-label="Page number position"
          className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
        >
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
          <option value="top-center">Top center</option>
        </select>
        <label className="flex items-center gap-1">
          <span className="text-[var(--foreground-muted)]">Start at</span>
          <input
            type="number"
            min={0}
            value={pageNumberStart}
            onChange={(e) => setPageNumberStart(Number(e.target.value))}
            aria-label="First page number"
            className="w-14 rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 py-1 text-xs"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy !== null}
        onClick={applyPageNumbers}
        className="w-full rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
      >
        {busy === "numbers" ? "Applying…" : "Add page numbers"}
      </button>

      <div className="space-y-1.5 border-t border-[var(--border)] pt-3">
        <input
          type="text"
          value={headerFooterText}
          onChange={(e) => setHeaderFooterText(e.target.value)}
          placeholder="Header/footer text (use {page} for page number)"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-sm"
        />
        <div className="flex gap-1.5">
          <select
            value={headerFooterPosition}
            onChange={(e) => setHeaderFooterPosition(e.target.value as HeaderFooterOptions["position"])}
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
          >
            <option value="header">Header (top)</option>
            <option value="footer">Footer (bottom)</option>
          </select>
          <select
            value={headerFooterAlign}
            onChange={(e) => setHeaderFooterAlign(e.target.value as HeaderFooterOptions["align"])}
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-xs"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <button
          type="button"
          disabled={busy !== null || !headerFooterText.trim()}
          onClick={applyHeaderFooter}
          className="w-full rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)] disabled:opacity-40"
        >
          {busy === "header-footer" ? "Applying…" : "Add header/footer"}
        </button>
      </div>
    </div>
  );
}
