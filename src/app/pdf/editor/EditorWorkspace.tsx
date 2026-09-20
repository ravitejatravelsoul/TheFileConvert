"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DropZone } from "@/components/tools/DropZone";
import { ProcessingModeBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IconWarning, IconPdf } from "@/components/icons";
import { triggerDownload } from "@/lib/download";
import { getToolById } from "@/lib/tools/registry";
import { viewportDimensions, computeFitZoom } from "@/lib/editor/coordinates";
import { viewportSpecForPage } from "@/lib/editor/types";
import { useEditorWorkspace } from "./useEditorWorkspace";
import { Toolbar } from "./Toolbar";
import { ThumbnailRail } from "./ThumbnailRail";
import { PropertiesPanel } from "./PropertiesPanel";
import { PageSurface, type EditableRegionRequest } from "./PageSurface";
import { TextEditModal } from "./TextEditModal";
import { SignaturePad } from "./SignaturePad";
import { DEFAULT_TOOL_OPTIONS, PRESET_COLORS, type ToolOptions } from "./toolOptions";

const tool = getToolById("pdf-editor")!;

export function EditorWorkspace() {
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Tracks *which* document's banner was dismissed (by its first page's id) rather than a
  // plain boolean, so a newly opened document naturally shows the banner again just by
  // comparing ids during render — no reset-on-change effect needed.
  const [detectionBannerDismissedForDocId, setDetectionBannerDismissedForDocId] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const insertFileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);

  const activePage = state.doc.pages.find((p) => p.id === state.activePageId) ?? state.doc.pages[0] ?? null;

  // Load native text regions for the active page on demand.
  useEffect(() => {
    if (activePage) api.loadNativeRegionsForPage(activePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.id]);

  // Searching has to cover the whole document, not just the pages that happen to have been
  // viewed: load every page's text as soon as there's a query.
  const hasSearchQuery = state.searchQuery.trim().length > 0;
  useEffect(() => {
    if (!hasSearchQuery) return;
    for (const p of state.doc.pages) api.loadNativeRegionsForPage(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSearchQuery, state.doc.pages.length]);

  // Jump to the page of the current search match (on a new query, or Next/Prev) so its
  // highlight is actually visible. Keyed on the match, not the active page, so browsing to
  // another page afterwards isn't fought.
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

  // Keyboard shortcuts: undo/redo, Escape (leave the current tool), Delete (remove the
  // selection), Enter (edit the selected text). Ignored while typing in a field, where those
  // keys belong to the field.
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
        if (mobilePanel) return; // the drawer's own handler closes it first
        // Leaving a drawing tool keeps whatever you just drew selected (like PowerPoint), and
        // keeps a proposed crop area too — it's discarded with "Discard area", not by a stray key.
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

  // Close a mobile drawer panel on Escape.
  useEffect(() => {
    if (!mobilePanel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobilePanel(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobilePanel]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Warn before an accidental refresh/close/navigation only when there are actual edits to
  // lose (canUndo is a reliable proxy: it's only true once at least one change was made).
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!api.canUndo) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [api.canUndo]);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await editorRootRef.current?.requestFullscreen();
    }
  }

  const handleFile = useCallback(
    async (files: File[]) => {
      const picked = files[0];
      if (picked) await api.openFile(picked);
    },
    [api]
  );

  async function handleExport() {
    const blob = await api.exportDocument();
    if (blob) triggerDownload("edited.pdf", blob);
  }

  function requestImageTool() {
    imageInputRef.current?.click();
  }

  async function handleImagePicked(file: File | undefined) {
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

  // ------------------------------------------------------------------ empty
  if (state.stage === "empty") {
    return (
      <div className="mx-auto max-w-xl space-y-5 text-center">
        <h2 className="text-2xl font-semibold text-[var(--foreground)]">Edit a PDF</h2>
        <DropZone accept=".pdf,application/pdf" onFiles={handleFile} label="Drop your PDF here" hint="or click to choose a PDF" />
        <p className="text-sm text-[var(--foreground-muted)]">
          Edit text, OCR scanned pages, sign, annotate and organize your PDF — directly in your browser.
        </p>
        <div className="flex justify-center">
          <ProcessingModeBadge mode={tool.processingMode} />
        </div>
      </div>
    );
  }

  if (state.stage === "loading") {
    return (
      <div className="card-surface flex flex-col items-center gap-4 p-12 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--brand)]" />
        <p className="font-medium text-[var(--foreground)]">Opening your PDF…</p>
      </div>
    );
  }

  if (state.stage === "error") {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{state.error}</span>
        </div>
        <Button variant="secondary" onClick={api.reset}>
          Try again
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------------------ ready
  // A full application workspace, not a normal tool-page card: this covers the whole
  // viewport (fixed, escaping the marketing header/footer/container behind it) rather than
  // being constrained to the site's usual content column and margins.
  const activeFile = activePage ? state.doc.sourceFiles[activePage.sourceFileId] : undefined;
  const currentDocId = state.doc.pages[0]?.id ?? null;
  const detectionBannerDismissed = detectionBannerDismissedForDocId === currentDocId;

  const classifications = state.doc.pages.map((p) => state.pageClassifications[p.id]).filter(Boolean);
  const scannedPageIds = state.doc.pages.filter((p) => state.pageClassifications[p.id] && state.pageClassifications[p.id] !== "native").map((p) => p.id);
  const allNative = classifications.length > 0 && classifications.every((c) => c === "native");
  const anyScanned = scannedPageIds.length > 0;
  const detection = allNative
    ? { message: "Editable text detected.", cta: null }
    : anyScanned && classifications.length === scannedPageIds.length
      ? { message: "Scanned page detected — run OCR to edit its text.", cta: "Recognize Text" }
      : anyScanned
        ? { message: "Some pages are scanned. OCR is available for those pages.", cta: "Recognize Text" }
        : null;

  return (
    // z-[70]: must clear the site's own sticky header (z-50) — otherwise this full-page
    // takeover would render *under* it near the top of the viewport, and the header would
    // silently intercept clicks meant for the editor's own header/toolbar there.
    <div ref={editorRootRef} className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[var(--background)]">
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
        <Link
          href="/"
          aria-label="Back to TheFileConvert"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          <IconPdf className="h-4 w-4 text-[var(--brand)]" />
          <span className="hidden text-xs font-semibold sm:inline">TheFileConvert</span>
        </Link>
        <span aria-hidden="true" className="h-4 w-px bg-[var(--border)]" />
        <span className="min-w-0 truncate text-xs font-medium text-[var(--foreground)]">{activeFile?.name ?? "PDF Editor"}</span>
      </div>

      <Toolbar
        api={api}
        onRequestImage={requestImageTool}
        onRequestSign={() => setSignaturePadOpen(true)}
        onExport={handleExport}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />

      {state.error && (
        <div className="flex items-start gap-2 border-b border-[var(--border)] bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      )}
      {api.exportError && (
        <div className="flex items-start gap-2 border-b border-[var(--border)] bg-red-50 px-4 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <IconWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{api.exportError}</span>
        </div>
      )}

      {(state.cropDraft || state.activeTool === "crop") && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-2 text-xs text-[var(--brand-strong)]">
          {state.cropDraft ? (
            <>
              <span>
                Crop area selected on page {state.doc.pages.findIndex((p) => p.id === state.cropDraft!.pageId) + 1}. Drag its corners to adjust, or
                draw a new one.
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => api.applyCrop(false)}
                  className="rounded-full bg-[var(--brand)] px-3 py-1 font-medium text-white hover:bg-[var(--brand-strong)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4"
                >
                  Keep this area
                </button>
                {state.doc.pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => api.applyCrop(true)}
                    className="rounded-full bg-white/70 px-3 py-1 font-medium hover:bg-white"
                  >
                    Keep on all pages
                  </button>
                )}
                <button type="button" onClick={() => api.setCropDraft(null)} className="rounded-full px-2 py-1 font-medium hover:bg-black/5">
                  Discard area
                </button>
              </div>
            </>
          ) : (
            <span>Drag on the page to choose the area to keep. Everything outside it is trimmed from the page.</span>
          )}
        </div>
      )}

      {state.ocrProgress ? (
        // Runs whether OCR was triggered from this banner or from the properties panel —
        // visible progress at the top of the workspace either way, not just inside a
        // section the user may not have expanded (section stays usable, not frozen).
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-2 text-xs text-[var(--brand-strong)]">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0">
              {state.ocrProgress.label} — {Math.round(state.ocrProgress.fraction * 100)}%
            </span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/60">
              <span className="block h-full bg-[var(--brand)]" style={{ width: `${Math.round(state.ocrProgress.fraction * 100)}%` }} />
            </span>
          </div>
          <button type="button" onClick={api.cancelOcr} className="shrink-0 rounded-full px-2 py-1 font-medium hover:bg-black/5">
            Cancel
          </button>
        </div>
      ) : (
        detection &&
        !detectionBannerDismissed && (
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--brand-soft)] px-4 py-2 text-xs text-[var(--brand-strong)]">
            <span>{detection.message}</span>
            <div className="flex shrink-0 items-center gap-2">
              {detection.cta && (
                <button
                  type="button"
                  onClick={async () => {
                    setDetectionBannerDismissedForDocId(currentDocId);
                    await api.runOcr(scannedPageIds);
                  }}
                  className="rounded-full bg-[var(--brand)] px-3 py-1 font-medium text-white hover:bg-[var(--brand-strong)] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-4"
                >
                  {detection.cta}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDetectionBannerDismissedForDocId(currentDocId)}
                aria-label="Dismiss"
                className="rounded-full px-1.5 py-1 text-[var(--brand-strong)] hover:bg-black/5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              >
                ✕
              </button>
            </div>
          </div>
        )
      )}

      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePanel("thumbnails")}
          className="min-h-11 rounded-full bg-[var(--surface-muted)] px-4 py-1 text-xs font-medium text-[var(--foreground)]"
        >
          Pages ({state.doc.pages.length})
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel("properties")}
          className="min-h-11 rounded-full bg-[var(--surface-muted)] px-4 py-1 text-xs font-medium text-[var(--foreground)]"
        >
          Properties
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={`${mobilePanel === "thumbnails" ? "flex" : "hidden"} fixed inset-0 z-[60] lg:static lg:z-auto lg:flex`}>
          {mobilePanel === "thumbnails" && (
            <div className="absolute inset-0 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} aria-hidden="true" />
          )}
          <div className="relative flex h-full flex-col bg-[var(--surface)] lg:block lg:h-auto lg:bg-transparent">
            <DrawerClose onClose={() => setMobilePanel(null)} />
            <div className="min-h-0 flex-1 lg:flex-none">
            <ThumbnailRail
              api={api}
              doc={state.doc}
              onInsertFile={(afterPageId) => {
                setInsertAfterPageId(afterPageId);
                insertFileInputRef.current?.click();
              }}
            />
            </div>
          </div>
        </div>

        <div ref={scrollContainerRef} className="flex min-w-0 flex-1 items-start overflow-auto bg-[var(--surface-muted)] p-6">
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

        <div className={`${mobilePanel === "properties" ? "flex" : "hidden"} fixed inset-0 z-[60] justify-end lg:static lg:z-auto lg:flex`}>
          {mobilePanel === "properties" && (
            <div className="absolute inset-0 bg-black/40 lg:hidden" onClick={() => setMobilePanel(null)} aria-hidden="true" />
          )}
          <div className="relative flex h-full flex-col bg-[var(--surface)] lg:block lg:h-auto lg:bg-transparent">
            <DrawerClose onClose={() => setMobilePanel(null)} />
            <div className="min-h-0 flex-1 overflow-y-auto lg:flex-none lg:overflow-visible">
            <PropertiesPanel
              api={api}
              doc={state.doc}
              toolOptions={toolOptions}
              onToolOptionsChange={(patch) => {
                if (patch.color) setColorChosen(true);
                setToolOptions((o) => ({ ...o, ...patch }));
              }}
            />
            </div>
          </div>
        </div>
      </div>

      <input ref={imageInputRef} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => handleImagePicked(e.target.files?.[0])} />
      <input ref={insertFileInputRef} type="file" accept=".pdf,application/pdf" className="sr-only" onChange={(e) => handleInsertFilePicked(e.target.files?.[0])} />

      {textEditRequest && <TextEditModal request={textEditRequest} api={api} onClose={() => setTextEditRequest(null)} />}
      {signaturePadOpen && <SignaturePad onConfirm={handleSignatureConfirm} onClose={() => setSignaturePadOpen(false)} />}
    </div>
  );
}

/** A visible way to dismiss a mobile drawer (tapping the dimmed area also works, but isn't
 * discoverable and there is no Escape key on a phone). Hidden on desktop, where the panels are
 * permanent columns. */
function DrawerClose({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex shrink-0 justify-end border-b border-[var(--border)] p-1 lg:hidden">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close panel"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--surface-muted)] text-lg text-[var(--foreground)]"
      >
        ✕
      </button>
    </div>
  );
}
