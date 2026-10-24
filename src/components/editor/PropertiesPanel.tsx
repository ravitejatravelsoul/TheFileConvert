"use client";

import { useState } from "react";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import type { ToolOptions } from "./toolOptions";
import { PRESET_COLORS, rgbToCss, rgbToHex, hexToRgb, optionsFromObject, objectPatchFromOptions } from "./toolOptions";
import { SUPPORTED_OCR_LANGUAGES } from "@/lib/processors/ocr";
import { addWatermark, addPageNumbers, addHeaderFooter, type WatermarkOptions, type PageNumberOptions, type HeaderFooterOptions } from "@/lib/processors/pdf";
import { exportEditorDocument } from "@/lib/editor/export";
import { IconTrash, IconWarning } from "@/components/icons";
import { NativeImageProperties, NativeTextProperties } from "./NativeProperties";
import type { EditorDocument } from "@/lib/editor/types";

const TOOL_HINT: Record<EditorWorkspaceApi["state"]["activeTool"], { title: string; hint: string }> = {
  select: { title: "Select", hint: "Double-click text on the page to edit it. Click a picture or something you added to move, resize or restyle it." },
  "edit-text": { title: "Edit text", hint: "Click any text on the page and type. Nothing is covered up: the PDF's own text is changed." },
  "add-text": { title: "Text", hint: "Click on the page where the text should go, then type." },
  highlight: { title: "Highlight", hint: "Drag across text to highlight it. The tool stays on until you choose another." },
  underline: { title: "Underline", hint: "Drag across text to underline it. The tool stays on until you choose another." },
  strikethrough: { title: "Strikethrough", hint: "Drag across text to strike it through." },
  draw: { title: "Draw", hint: "Draw freehand on the page. Each stroke appears as you draw." },
  "shape-rectangle": { title: "Rectangle", hint: "Drag on the page to draw a rectangle." },
  "shape-ellipse": { title: "Ellipse", hint: "Drag on the page to draw an ellipse." },
  "shape-line": { title: "Line", hint: "Drag on the page to draw a line." },
  "shape-arrow": { title: "Arrow", hint: "Drag on the page to draw an arrow." },
  whiteout: { title: "Whiteout", hint: "Drag over anything you want to cover with white." },
  crop: { title: "Crop", hint: "Drag on the page to choose the area to keep." },
};

const OBJECT_LABEL: Record<string, string> = {
  "added-text": "Text",
  "native-text-edit": "Edited text",
  "native-image-edit": "Edited picture",
  "ocr-text-replacement": "Corrected scan text",
  highlight: "Highlight",
  underline: "Underline",
  strikethrough: "Strikethrough",
  drawing: "Drawing",
  shape: "Shape",
  whiteout: "Whiteout",
  image: "Image",
  signature: "Signature",
  annotation: "Markup",
};

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
  const nativeSel = state.selectedNative;
  const nativeAnalysis = nativeSel ? state.workingByPage[nativeSel.pageId]?.analysis : null;
  const nativeBlock = nativeSel?.kind === "text" ? (nativeAnalysis?.blocks.find((b) => b.id === nativeSel.blockId) ?? null) : null;
  const nativeImage = nativeSel?.kind === "image" ? (nativeAnalysis?.images.find((i) => i.id === nativeSel.imageId) ?? null) : null;

  const tool = state.activeTool;
  const isShape = tool.startsWith("shape-");
  const objectKind = selectedObject?.type;
  const showColor = Boolean(selectedObject) || ["add-text", "highlight", "underline", "strikethrough", "draw"].includes(tool) || isShape;
  const showStroke = (selectedObject && ["drawing", "shape"].includes(objectKind ?? "")) || ["draw", "underline", "strikethrough"].includes(tool) || isShape;
  const showFontSize = objectKind === "added-text" || tool === "add-text";
  const showFill = objectKind === "shape" || isShape;
  const showOptions = showColor || showStroke || showFontSize || showFill;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.06em] text-[var(--ink-2)]">{selectedObject || nativeBlock || nativeImage ? "Selected" : "Tool"}</p>
        <p className="mt-1 text-base font-semibold tracking-[-0.01em]">{selectedObject ? (OBJECT_LABEL[selectedObject.type] ?? "Object") : nativeBlock ? "Text on the page" : nativeImage ? "Picture on the page" : TOOL_HINT[tool].title}</p>
        {!selectedObject && !nativeBlock && !nativeImage && <p className="mt-1 leading-relaxed text-[var(--ink-2)]">{TOOL_HINT[tool].hint}</p>}
      </div>

      {state.signedWarning && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Editing this PDF may invalidate its existing digital signatures.</span>
        </div>
      )}

      {(tool === "whiteout" || selectedObject?.type === "whiteout") && (
        <div role="note" className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-[var(--warning-soft)] p-3 text-[var(--warning)]">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Whiteout visually covers content. It is not secure redaction &mdash; the original text or image is still inside the PDF, so don&rsquo;t use it
            to hide sensitive information.
          </span>
        </div>
      )}

      {nativeSel && nativeBlock && (
        <Section title="Text" defaultOpen>
          <NativeTextProperties key={nativeBlock.id} api={api} pageId={nativeSel.pageId} block={nativeBlock} />
        </Section>
      )}
      {nativeSel && nativeImage && (
        <Section title="Picture" defaultOpen>
          <NativeImageProperties key={nativeImage.id} api={api} pageId={nativeSel.pageId} image={nativeImage} />
        </Section>
      )}

      {selectedObject && (
        <Section title="Selected object" defaultOpen>
          <ObjectProperties api={api} object={selectedObject} />
        </Section>
      )}

      {showOptions && (
        <Section title="Style" defaultOpen>
          <div className="space-y-4">
            {showColor && (
              <div>
                <p className="mb-2 text-xs font-medium text-[var(--ink-2)]">Color</p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      aria-label={c.label}
                      aria-pressed={toolOptions.color === c.value}
                      onClick={() => onToolOptionsChange({ color: c.value })}
                      className={`h-8 w-8 rounded-full border border-black/10 transition-shadow [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10 ${toolOptions.color === c.value ? "ring-2 ring-[var(--ink)] ring-offset-2" : ""}`}
                      style={{ backgroundColor: rgbToCss(c.value) }}
                    />
                  ))}
                </div>
              </div>
            )}
            {showStroke && (
              <label className="block">
                <span className="mb-1 flex justify-between text-xs font-medium text-[var(--ink-2)]">
                  Stroke width <span className="tabular text-[var(--ink)]">{toolOptions.strokeWidth}</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={toolOptions.strokeWidth}
                  onChange={(e) => onToolOptionsChange({ strokeWidth: Number(e.target.value) })}
                  className="w-full accent-[var(--ink)]"
                />
              </label>
            )}
            {showFontSize && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--ink-2)]">Font size</span>
                <FontSizeField value={toolOptions.fontSize} onCommit={(n) => onToolOptionsChange({ fontSize: n })} />
              </label>
            )}
            {showFill && (
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={toolOptions.fillShape} onChange={(e) => onToolOptionsChange({ fillShape: e.target.checked })} className="h-4 w-4 accent-[var(--ink)]" />
                Fill shapes
              </label>
            )}
          </div>
        </Section>
      )}

      <p className="mt-2 border-t border-[var(--line)] pt-4 text-xs font-medium uppercase tracking-[0.06em] text-[var(--ink-2)]">Document</p>

      <Section title="Recognize text (OCR, for search & copy)">
        <div className="space-y-2.5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ink)]">Language</span>
            <select
              value={state.ocrLanguage}
              onChange={(e) => api.setOcrLanguage(e.target.value)}
              className="w-full field text-sm"
            >
              {SUPPORTED_OCR_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <p className="text-xs text-[var(--ink-2)]">Makes a scan searchable and copyable on this device. It does not make the scan editable as text.</p>
          {activePage && state.workingByPage[activePage.id]?.analysis?.scanned && (
            <p className="rounded-[var(--radius-sm)] bg-[var(--accent-soft)] p-2 text-xs text-[var(--ink)]" data-testid="scanned-page-note">
              Scanned page &mdash; its text is part of the picture. Add text, whiteout, highlight, draw, sign or crop instead.
            </p>
          )}

          {state.ocrProgress ? (
            // One canonical progress/cancel control lives in the workspace header banner
            // (always visible regardless of whether this section is expanded) — this just
            // reflects that it's running, rather than duplicating a second progress bar and
            // Cancel button here.
            <p className="text-xs text-[var(--ink-2)]">{state.ocrProgress.label} — see progress above.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={!activePage}
                onClick={() => activePage && api.runOcr([activePage.id])}
                className="btn btn-secondary btn-sm w-full"
              >
                Recognize current page
              </button>
              <button type="button" onClick={() => void api.recognizeScanned()} className="btn btn-secondary btn-sm w-full">
                Recognize all scanned pages
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.showOcrOverlay}
              onChange={(e) => api.setShowOcrOverlay(e.target.checked)}
              className="h-4 w-4 accent-[var(--ink)]"
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
                <label className="mb-1 block text-xs text-[var(--ink-2)]" htmlFor={`field-${field.name}`}>
                  {field.name}
                </label>
                {field.kind === "checkbox" ? (
                  <input
                    id={`field-${field.name}`}
                    type="checkbox"
                    checked={field.value === "true"}
                    onChange={(e) => api.setFormFieldValue(field.name, e.target.checked ? "true" : "false")}
                    className="h-4 w-4 accent-[var(--ink)]"
                  />
                ) : field.options && field.options.length > 0 && (field.kind === "radio" || field.kind === "dropdown") ? (
                  <select
                    id={`field-${field.name}`}
                    value={field.value}
                    onChange={(e) => api.setFormFieldValue(field.name, e.target.value)}
                    className="w-full field text-sm"
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
                    className="w-full field text-sm"
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
      className="w-full field text-sm"
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
      <p className="text-xs text-[var(--ink-2)]">
        Select the Crop tool, then drag a box on the page to choose what to keep.
      </p>
      {draft ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--ink)]">Crop area selected on page {state.doc.pages.findIndex((p) => p.id === draft.pageId) + 1}.</p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
            Apply to every page (same coordinates)
          </label>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => api.applyCrop(applyToAll)}
              className="btn btn-primary btn-sm flex-1"
            >
              Apply crop
            </button>
            <button
              type="button"
              onClick={() => api.setCropDraft(null)}
              className="btn btn-ghost btn-sm"
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
            className="btn btn-secondary btn-sm w-full"
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
    <details open={defaultOpen} className="group rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--ring-highlight),var(--shadow-1)] transition-shadow open:shadow-[var(--ring-highlight),var(--shadow-2)]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[var(--radius-md)] px-3.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--band)] [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--band)] text-[10px] text-[var(--ink-2)] ring-1 ring-[var(--line)] transition-transform duration-300 group-open:rotate-180">
          &#9662;
        </span>
      </summary>
      <div className="border-t border-[var(--line)] p-3">{children}</div>
    </details>
  );
}

function ObjectProperties({ api, object }: { api: EditorWorkspaceApi; object: NonNullable<EditorWorkspaceApi["state"]["doc"]["objects"][number]> }) {
  return (
    <div className="space-y-2.5">
      {(object.type === "added-text" || object.type === "ocr-text-replacement") && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink)]">Text</span>
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
              }
            }}
            rows={2}
            className="w-full field text-sm"
          />
        </label>
      )}
      {"originalText" in object && (
        <p className="text-xs text-[var(--ink-2)]">
          Detected: <span className="italic">&ldquo;{object.originalText}&rdquo;</span>
          {"confidence" in object && ` (${Math.round(object.confidence)}% confidence)`}
        </p>
      )}
      {object.type === "added-text" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink)]">Font</span>
          <select value={object.family ?? "sans"} onChange={(e) => api.updateObject(object.id, { family: e.target.value as "sans" | "serif" | "mono" })} className="field w-full text-sm" aria-label="Font family">
            <option value="sans">Sans (Helvetica)</option>
            <option value="serif">Serif (Times)</option>
            <option value="mono">Monospace (Courier)</option>
          </select>
        </label>
      )}
      {object.type === "added-text" && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={object.bold}
              onChange={(e) => api.updateObject(object.id, { bold: e.target.checked })}
              className="h-4 w-4 accent-[var(--ink)]"
            />
            Bold
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={Boolean(object.italic)} onChange={(e) => api.updateObject(object.id, { italic: e.target.checked })} className="h-4 w-4 accent-[var(--ink)]" />
            Italic
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={Boolean(object.underline)} onChange={(e) => api.updateObject(object.id, { underline: e.target.checked })} className="h-4 w-4 accent-[var(--ink)]" />
            Underline
          </label>
          <div className="flex items-center gap-1" role="group" aria-label="Text alignment">
            {(["left", "center", "right"] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={object.align === a}
                aria-label={`Align ${a}`}
                onClick={() => api.updateObject(object.id, { align: a })}
                className={`min-h-9 rounded-full px-3 capitalize ${object.align === a ? "bg-[var(--ink)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
      {object.type === "ocr-text-replacement" && (
        <div className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--line)] p-2">
          <p className="text-xs font-medium text-[var(--ink)]">
            Style {object.patchDataUrl ? `(auto-matched: ${object.fontCandidateId?.replace(/-/g, " ") ?? "auto"})` : "(manual)"}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--ink-2)]">Text</span>
              <input
                type="color"
                value={rgbToHex(object.textColor)}
                onChange={(e) => api.updateObject(object.id, { textColor: hexToRgb(e.target.value), patchDataUrl: undefined })}
                className="h-6 w-6 cursor-pointer rounded border border-[var(--line)]"
                aria-label="Replacement text color"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[var(--ink-2)]">Background</span>
              <input
                type="color"
                value={rgbToHex(object.backgroundColor)}
                onChange={(e) => api.updateObject(object.id, { backgroundColor: hexToRgb(e.target.value), patchDataUrl: undefined })}
                disabled={object.overlayOnly}
                className="h-6 w-6 cursor-pointer rounded border border-[var(--line)] disabled:opacity-40"
                aria-label="Replacement background color"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-[var(--ink-2)]">Font size (blank = automatic)</span>
            <input
              type="number"
              min={4}
              max={72}
              value={object.fontSize ?? ""}
              placeholder="Auto"
              onChange={(e) =>
                api.updateObject(object.id, { fontSize: e.target.value ? Number(e.target.value) : undefined, patchDataUrl: undefined })
              }
              className="w-full field text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-2)]">
            <input
              type="checkbox"
              checked={object.overlayOnly}
              onChange={(e) => api.updateObject(object.id, { overlayOnly: e.target.checked, patchDataUrl: undefined })}
              className="h-4 w-4 accent-[var(--ink)]"
            />
            Place as overlay instead of covering the background
          </label>
          {object.patchDataUrl && (
            <p className="text-[10px] text-[var(--ink-2)]">
              Any manual change here switches this word to simple text rendering instead of the auto-matched scan style.
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => api.deleteObject(object.id)}
        aria-label="Delete selected object"
        className="btn btn-sm bg-[var(--danger-soft)] text-[var(--danger)]"
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
    <p className="rounded-[var(--radius-sm)] bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">
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
        className="w-full field text-sm"
      />
      {state.searchQuery && (
        <div className="flex items-center justify-between text-xs text-[var(--ink-2)]">
          <span>
            {searchIndex.length > 0 ? `${state.searchMatchIndex + 1} of ${searchIndex.length}` : "No matches"}
          </span>
          <div className="flex gap-1">
            <button type="button" onClick={api.prevMatch} disabled={searchIndex.length === 0} className="btn btn-ghost btn-sm disabled:opacity-40">
              Prev
            </button>
            <button type="button" onClick={api.nextMatch} disabled={searchIndex.length === 0} className="btn btn-ghost btn-sm disabled:opacity-40">
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
    // Recognised text goes along as an invisible layer, so the baked file stays searchable.
    const currentBlob = await exportEditorDocument(api.state.doc, { ocrResultsByPage: api.state.ocrResultsByPage });
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
      <p className="text-xs text-[var(--ink-2)]">
        These apply to the whole document immediately (reusing the standalone Watermark and Page Numbers tools) rather than
        being movable objects.
      </p>
      <div className="space-y-1.5">
        <input
          type="text"
          value={watermarkText}
          onChange={(e) => setWatermarkText(e.target.value)}
          placeholder="Watermark text"
          className="w-full field text-sm"
        />
        <div className="flex items-center gap-2 text-xs">
          <label className="flex flex-1 items-center gap-1.5">
            <span className="text-[var(--ink-2)]">Opacity</span>
            <input
              type="range"
              min={5}
              max={100}
              value={watermarkOpacity}
              onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
              aria-label="Watermark opacity"
              className="w-full accent-[var(--ink)]"
            />
            <span className="w-8 text-right tabular-nums">{watermarkOpacity}%</span>
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-[var(--ink-2)]">Angle</span>
          <select
            value={watermarkRotation}
            onChange={(e) => setWatermarkRotation(Number(e.target.value))}
            aria-label="Watermark angle"
            className="flex-1 field text-sm"
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
          className="btn btn-secondary btn-sm w-full"
        >
          {busy === "watermark" ? "Applying…" : "Add watermark"}
        </button>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <select
          value={pageNumberPosition}
          onChange={(e) => setPageNumberPosition(e.target.value as PageNumberOptions["position"])}
          aria-label="Page number position"
          className="flex-1 field text-sm"
        >
          <option value="bottom-center">Bottom center</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
          <option value="top-center">Top center</option>
        </select>
        <label className="flex items-center gap-1">
          <span className="text-[var(--ink-2)]">Start at</span>
          <input
            type="number"
            min={0}
            value={pageNumberStart}
            onChange={(e) => setPageNumberStart(Number(e.target.value))}
            aria-label="First page number"
            className="field w-20 text-sm"
          />
        </label>
      </div>
      <button
        type="button"
        disabled={busy !== null}
        onClick={applyPageNumbers}
        className="btn btn-secondary btn-sm w-full"
      >
        {busy === "numbers" ? "Applying…" : "Add page numbers"}
      </button>

      <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
        <input
          type="text"
          value={headerFooterText}
          onChange={(e) => setHeaderFooterText(e.target.value)}
          placeholder="Header/footer text (use {page} for page number)"
          className="w-full field text-sm"
        />
        <div className="flex gap-1.5">
          <select
            value={headerFooterPosition}
            onChange={(e) => setHeaderFooterPosition(e.target.value as HeaderFooterOptions["position"])}
            className="flex-1 field text-sm"
          >
            <option value="header">Header (top)</option>
            <option value="footer">Footer (bottom)</option>
          </select>
          <select
            value={headerFooterAlign}
            onChange={(e) => setHeaderFooterAlign(e.target.value as HeaderFooterOptions["align"])}
            className="flex-1 field text-sm"
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
          className="btn btn-secondary btn-sm w-full"
        >
          {busy === "header-footer" ? "Applying…" : "Add header/footer"}
        </button>
      </div>
    </div>
  );
}
