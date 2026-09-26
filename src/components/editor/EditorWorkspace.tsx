"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Working } from "@/components/tool/Feedback";
import { IconClose, IconScan, IconWarning } from "@/components/icons";
import { triggerDownload } from "@/lib/download";
import { safeOutputName } from "@/lib/format";
import { viewportDimensions, computeFitZoom } from "@/lib/editor/coordinates";
import { viewportSpecForPage } from "@/lib/editor/types";
import { useEditorWorkspace } from "./useEditorWorkspace";
import { EditorTopBar, ToolDock, ZoomControl } from "./Toolbar";
import { ThumbnailRail } from "./ThumbnailRail";
import { PropertiesPanel } from "./PropertiesPanel";
import { PageSurface, type EditableRegionRequest } from "./PageSurface";
import { TextEditModal } from "./TextEditModal";
import { SignaturePad } from "./SignaturePad";
import { DEFAULT_TOOL_OPTIONS, PRESET_COLORS, type ToolOptions } from "./toolOptions";

/**
 * The full-screen editing workspace. Loaded on demand (see EditorLauncher) once a PDF has been
 * chosen, so none of the editor's code is downloaded by visitors who only read the page.
 */
export default function EditorWorkspace({ file, onExit }: { file: File; onExit: (error?: string) => void }) {
  const api = useEditorWorkspace();
  const { state } = api;

  const [baseToolOptions, setToolOptions] = useState<ToolOptions>(DEFAULT_TOOL_OPTIONS);
  // Highlighting in near-black is useless (a translucent gray smear), so until the user picks a
  // color themselves the Highlight tool defaults to yellow. Derived, not stored, so switching
  // back to another tool restores the normal default.
  const [colorChosen, setColorChosen] = useState(false);
  const toolOptions: ToolOptions =
    state.activeTool === "highlight" && !colorChosen ? { ...baseToolOptions, color: PRESET_COLORS[3].value } : baseToolOptions;
  const [textEditRequest, setTextEditRequest] = useState<EditableRegionRequest | null>(null);
  const [signaturePadOpen, setSignaturePadOpen] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState<{ kind: "image" | "signature"; dataUrl: string; naturalWidth: number; naturalHeight: number } | null>(null);
  const [insertAfterPageId, setInsertAfterPageId] = useState<string | null | undefined>(undefined);
  const [mobilePanel, setMobilePanel] = useState<"thumbnails" | "properties" | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  // Tracks *which* document's banner was dismissed (by its first page's id) rather than a
  // plain boolean, so a newly opened document naturally shows the banner again.
  const [detectionBannerDismissedForDocId, setDetectionBannerDismissedForDocId] = useState<string | null>(null);
  const fileName = file.name;

  const imageInputRef = useRef<HTMLInputElement>(null);
  const insertFileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Open the chosen file once; a file that can't be opened goes back to the launcher with the reason.
  const openedRef = useRef<File | null>(null);
  useEffect(() => {
    if (openedRef.current === file) return;
    openedRef.current = file;
    void api.openFile(file);
  }, [api, file]);
  useEffect(() => {
    if (state.stage === "error") onExit(state.error ?? "This PDF couldn't be opened.");
  }, [state.stage, state.error, onExit]);

  const activePage = state.doc.pages.find((p) => p.id === state.activePageId) ?? state.doc.pages[0] ?? null;

  // Load native text regions for the active page on demand.
  useEffect(() => {
    if (activePage) api.loadNativeRegionsForPage(activePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id]);

  // Searching has to cover the whole document, not just the pages that have been viewed.
  const hasSearchQuery = state.searchQuery.trim().length > 0;
  useEffect(() => {
    if (!hasSearchQuery) return;
    for (const p of state.doc.pages) api.loadNativeRegionsForPage(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSearchQuery, state.doc.pages.length]);

  // Jump to the page of the current search match so its highlight is visible.
  const currentMatchPageId = api.searchIndex[state.searchMatchIndex]?.pageId ?? null;
  useEffect(() => {
    if (currentMatchPageId && currentMatchPageId !== state.activePageId) api.setActivePageId(currentMatchPageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMatchPageId, state.searchMatchIndex, state.searchQuery, state.searchNavTick]);

  // On a phone or small tablet the page at 100% is far wider than the screen, so it opens fit to
  // width (the desktop layout keeps 100%). Only the first time a document is shown.
  const autoFitDoneRef = useRef(false);
  useEffect(() => {
    if (autoFitDoneRef.current || !activePage) return;
    autoFitDoneRef.current = true;
    if (window.matchMedia("(max-width: 1023px)").matches && state.zoomMode === "custom") api.setZoom(1, "fit-width");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id]);

  // Fit-width / fit-page zoom calculation.
  useEffect(() => {
    if (state.zoomMode === "custom" || !activePage) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const spec = viewportSpecForPage(activePage, 1);
    const dims = viewportDimensions(spec);
    const available = { width: container.clientWidth - 48, height: container.clientHeight - 48 };
    const zoom = computeFitZoom(state.zoomMode, available, dims);
    api.setZoom(zoom, state.zoomMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.zoomMode, activePage?.id]);

  // The workspace covers the whole screen; the page underneath must not scroll behind it.
  const open = state.stage === "ready";
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Keyboard shortcuts: undo/redo, Escape (leave the current tool), Delete (remove the
  // selection), Enter (edit the selected text). Ignored while typing in a field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const inCanvasTextEditor = target.dataset?.testid === "canvas-text-editor";
      const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
      const meta = e.ctrlKey || e.metaKey;
      // The on-page text box hands undo/redo to the app (a typing burst is a single step).
      if (inField && !(inCanvasTextEditor && meta)) return;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) api.redo();
        else api.undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        api.redo();
        return;
      }
      if (meta || e.altKey) return;
      // Dialogs (text-correction, signature pad) own the keyboard while open.
      if (textEditRequest || signaturePadOpen) return;

      if (e.key === "Escape") {
        if (mobilePanel) return; // the sheet's own handler closes it first
        // Leaving a drawing tool keeps whatever you just drew selected, and keeps a proposed crop
        // area too — it's discarded with "Discard area", not by a stray key.
        if (api.state.activeTool !== "select") api.setActiveTool("select", { keepSelection: true });
        else if (api.state.selectedObjectId) api.setSelectedObjectId(null);
        return;
      }
      const selectedId = api.state.selectedObjectId;
      const selected = selectedId ? api.state.doc.objects.find((o) => o.id === selectedId) : null;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        api.deleteObject(selected.id);
        return;
      }
      if (e.key === "Enter" && selected?.type === "added-text") {
        e.preventDefault();
        api.setEditingObjectId(selected.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, textEditRequest, signaturePadOpen, mobilePanel]);

  // Close a mobile sheet on Escape.
  useEffect(() => {
    if (!mobilePanel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobilePanel(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobilePanel]);

  // Warn before an accidental refresh/close only when there are edits to lose.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!api.canUndo) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [api.canUndo]);

  const handleExport = useCallback(async () => {
    const blob = await api.exportDocument();
    if (blob) triggerDownload(safeOutputName(fileName, "edited", "pdf"), blob);
  }, [api, fileName]);

  function handleImagePicked(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setPendingPlacement({ kind: "image", dataUrl, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
        api.setActiveTool("select");
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleSignatureConfirm(dataUrl: string, w: number, h: number) {
    setPendingPlacement({ kind: "signature", dataUrl, naturalWidth: w, naturalHeight: h });
    setSignaturePadOpen(false);
  }

  async function handleInsertFilePicked(file: File | undefined) {
    if (!file || insertAfterPageId === undefined) return;
    await api.insertFile(file, insertAfterPageId ?? undefined);
    setInsertAfterPageId(undefined);
  }

  // ------------------------------------------------------------------ opening
  if (state.stage !== "ready") {
    return (
      <div className="mx-auto max-w-3xl">
        <Working label="Opening your PDF…" />
      </div>
    );
  }

  // ------------------------------------------------------------------ workspace
  const currentDocId = state.doc.pages[0]?.id ?? null;
  const detectionBannerDismissed = detectionBannerDismissedForDocId === currentDocId;
  const scannedPageIds = state.doc.pages.filter((p) => state.pageClassifications[p.id] && state.pageClassifications[p.id] !== "native").map((p) => p.id);
  const unrecognized = scannedPageIds.filter((id) => !state.ocrResultsByPage[id]);
  const showScanBanner = unrecognized.length > 0 && !detectionBannerDismissed && !state.ocrProgress;

  const dockProps = {
    api,
    onRequestImage: () => imageInputRef.current?.click(),
    onRequestSign: () => setSignaturePadOpen(true),
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[var(--paper)]" data-testid="editor-workspace">
      <EditorTopBar api={api} fileName={fileName} onExport={handleExport} />

      {/* Desktop dock sits under the top bar. */}
      <div className="hidden shrink-0 justify-center border-b border-[var(--line)] bg-[var(--surface)] py-1.5 lg:flex">
        <ToolDock {...dockProps} pagesOpen={railOpen} onTogglePages={() => setRailOpen((o) => !o)} />
      </div>

      {/* Status strip: errors, OCR progress, scanned-page prompt, crop instructions. */}
      <div className="shrink-0" aria-live="polite">
        {(state.error || api.exportError) && (
          <Strip tone="danger" icon={<IconWarning className="h-4 w-4" />}>
            {api.exportError ?? state.error}
          </Strip>
        )}
        {state.ocrProgress && (
          <Strip tone="info" icon={<span className="spinner h-4 w-4" />}>
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className="shrink-0">
                {state.ocrProgress.label} — {Math.round(state.ocrProgress.fraction * 100)}%
              </span>
              <span className="progress-track hidden flex-1 sm:block">
                <span className="progress-bar block" style={{ width: `${Math.round(state.ocrProgress.fraction * 100)}%` }} />
              </span>
            </span>
            <button type="button" onClick={api.cancelOcr} className="btn btn-ghost btn-sm">
              Cancel
            </button>
          </Strip>
        )}
        {showScanBanner && (
          <Strip tone="accent" icon={<IconScan className="h-4 w-4" />}>
            <span className="flex-1">
              <strong className="font-semibold">Scanned text detected.</strong>{" "}
              <span className="hidden sm:inline">Recognize it on this device, then click any word to edit it.</span>
            </span>
            <button
              type="button"
              onClick={async () => {
                setDetectionBannerDismissedForDocId(currentDocId);
                await api.runOcr(unrecognized);
              }}
              className="btn btn-primary btn-sm"
            >
              Recognize text
            </button>
            <button type="button" onClick={() => setDetectionBannerDismissedForDocId(currentDocId)} aria-label="Dismiss" className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              <IconClose className="h-4 w-4" />
            </button>
          </Strip>
        )}
        {(state.cropDraft || state.activeTool === "crop") && (
          <Strip tone="info" role="status">
            {state.cropDraft ? (
              <>
                <span className="flex-1">
                  Crop area selected on page {state.doc.pages.findIndex((p) => p.id === state.cropDraft!.pageId) + 1}. Drag its corners to adjust, or draw a new one.
                </span>
                <button type="button" onClick={() => api.applyCrop(false)} className="btn btn-primary btn-sm">
                  Keep this area
                </button>
                {state.doc.pages.length > 1 && (
                  <button type="button" onClick={() => api.applyCrop(true)} className="btn btn-secondary btn-sm">
                    Keep on all pages
                  </button>
                )}
                <button type="button" onClick={() => api.setCropDraft(null)} className="btn btn-ghost btn-sm">
                  Discard area
                </button>
              </>
            ) : (
              <span>Drag on the page to choose the area to keep. Everything outside it is trimmed.</span>
            )}
          </Strip>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Pages: a column on desktop, a bottom sheet on phones. */}
        {railOpen && (
          <aside aria-label="Pages" className="hidden w-44 shrink-0 border-r border-[var(--line)] bg-[var(--surface)] lg:block">
            <ThumbnailRail
              api={api}
              doc={state.doc}
              onInsertFile={(afterPageId) => {
                setInsertAfterPageId(afterPageId);
                insertFileInputRef.current?.click();
              }}
            />
          </aside>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col">
          <div ref={scrollContainerRef} className="hatch flex min-h-0 flex-1 items-start overflow-auto bg-[var(--surface-2)] p-4 pb-24 sm:p-6 sm:pb-24">
            {/* mx-auto (not justify-center) centers a narrow page but lets a wide one scroll from its left edge. */}
            {activePage && (
              <PageSurface
                api={api}
                page={activePage}
                doc={state.doc}
                zoom={state.zoom}
                toolOptions={toolOptions}
                nativeRegions={state.nativeRegionsByPage[activePage.id]}
                ocrResult={state.ocrResultsByPage[activePage.id]}
                showOcrOverlay={state.showOcrOverlay}
                activeMatch={api.searchIndex[state.searchMatchIndex]?.pageId === activePage.id ? api.searchIndex[state.searchMatchIndex] : null}
                onRequestTextEdit={setTextEditRequest}
                pendingPlacement={pendingPlacement}
                onPlacementComplete={() => setPendingPlacement(null)}
              />
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center lg:justify-end lg:pr-5">
            <div className="pointer-events-auto">
              <ZoomControl api={api} />
            </div>
          </div>
        </div>

        <aside aria-label="Properties" className="hidden w-80 shrink-0 border-l border-[var(--line)] bg-[var(--surface)] lg:block">
          <PropertiesPanel
            api={api}
            doc={state.doc}
            toolOptions={toolOptions}
            onToolOptionsChange={(patch) => {
              if (patch.color) setColorChosen(true);
              setToolOptions((o) => ({ ...o, ...patch }));
            }}
          />
        </aside>
      </div>

      {/* Phone dock sits at the bottom, within thumb reach. */}
      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--surface)] py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden">
        <ToolDock {...dockProps} pagesOpen={mobilePanel === "thumbnails"} onTogglePages={() => setMobilePanel((p) => (p === "thumbnails" ? null : "thumbnails"))} onOpenProperties={() => setMobilePanel("properties")} />
      </div>

      {mobilePanel && (
        <Sheet title={mobilePanel === "thumbnails" ? "Pages" : "Properties"} onClose={() => setMobilePanel(null)}>
          {mobilePanel === "thumbnails" ? (
            <ThumbnailRail
              api={api}
              doc={state.doc}
              layout="grid"
              onInsertFile={(afterPageId) => {
                setInsertAfterPageId(afterPageId);
                insertFileInputRef.current?.click();
              }}
            />
          ) : (
            <PropertiesPanel
              api={api}
              doc={state.doc}
              toolOptions={toolOptions}
              onToolOptionsChange={(patch) => {
                if (patch.color) setColorChosen(true);
                setToolOptions((o) => ({ ...o, ...patch }));
              }}
            />
          )}
        </Sheet>
      )}

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Choose an image to place" onChange={(e) => handleImagePicked(e.target.files?.[0])} />
      <input ref={insertFileInputRef} type="file" accept=".pdf,application/pdf" className="sr-only" aria-label="Choose a PDF to insert" onChange={(e) => handleInsertFilePicked(e.target.files?.[0])} />

      {textEditRequest && <TextEditModal request={textEditRequest} api={api} onClose={() => setTextEditRequest(null)} />}
      {signaturePadOpen && <SignaturePad onConfirm={handleSignatureConfirm} onClose={() => setSignaturePadOpen(false)} />}
    </div>
  );
}

function Strip({ tone, icon, role, children }: { tone: "danger" | "info" | "accent"; icon?: React.ReactNode; role?: string; children: React.ReactNode }) {
  const toneClass = tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : tone === "accent" ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "bg-[var(--surface-2)] text-[var(--ink)]";
  return (
    <div role={role} className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] px-4 py-2 text-sm ${toneClass}`}>
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </div>
  );
}

/** Bottom sheet for phones, with a visible close button (there is no Escape key on a phone). */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[75] lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-[rgb(20_20_19/0.4)]" onClick={onClose} aria-hidden="true" />
      <div className="animate-sheet absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col rounded-t-[var(--radius-xl)] bg-[var(--surface)] shadow-[var(--shadow-3)]">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-4 py-2">
          <p className="font-semibold tracking-[-0.01em]">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close panel" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-2)]">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
