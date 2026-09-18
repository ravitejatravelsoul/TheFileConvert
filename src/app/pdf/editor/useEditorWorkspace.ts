"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorHistory } from "@/lib/editor/history";
import {
  loadEditorDocument,
  insertFilePages,
  duplicatePage as duplicatePageOp,
  deletePage as deletePageOp,
  reorderPages as reorderPagesOp,
  rotatePage as rotatePageOp,
  insertBlankPage as insertBlankPageOp,
  setPageCropBox,
  setCropBoxForAllPages,
  likelyHasDigitalSignature,
  EditorDocumentError,
} from "@/lib/editor/document";
import type { Rect } from "@/lib/editor/coordinates";
import { extractNativeTextRegions, type NativeTextRegion } from "@/lib/editor/nativeText";
import { exportEditorDocument, EditorExportError } from "@/lib/editor/export";
import { generateUuidV4 } from "@/lib/processors/data";
import { classifyPdfPages, createOcrSession, type OcrPageResult, type OcrSession, type PageClassification } from "@/lib/processors/ocr";
import type { EditorDocument, EditorObject, EditorPage } from "@/lib/editor/types";
import { validateFileForTool } from "@/lib/security/validators";
import { getToolById } from "@/lib/tools/registry";

const tool = getToolById("pdf-editor")!;

export type ToolId =
  | "select"
  | "add-text"
  | "highlight"
  | "underline"
  | "strikethrough"
  | "draw"
  | "shape-rectangle"
  | "shape-ellipse"
  | "shape-line"
  | "shape-arrow"
  | "whiteout"
  | "crop";

export type ZoomMode = "custom" | "fit-width" | "fit-page";

export type EditableRegion =
  | { kind: "native"; region: NativeTextRegion }
  | { kind: "ocr"; pageIndex: number; word: { text: string; confidence: number; pdfBox: { x: number; y: number; width: number; height: number } }; index: number };

export interface SearchMatch {
  pageId: string;
  text: string;
  pdfBox: { x: number; y: number; width: number; height: number };
}

interface WorkspaceState {
  stage: "empty" | "loading" | "ready" | "error";
  error: string | null;
  doc: EditorDocument;
  activePageId: string | null;
  activeTool: ToolId;
  selectedObjectId: string | null;
  zoom: number;
  zoomMode: ZoomMode;
  showOcrOverlay: boolean;
  pageClassifications: Record<string, PageClassification["classification"]>;
  nativeRegionsByPage: Record<string, NativeTextRegion[]>;
  ocrResultsByPage: Record<string, OcrPageResult>;
  ocrLanguage: string;
  ocrBusyPageId: string | null;
  ocrProgress: { label: string; fraction: number } | null;
  signedWarning: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  /** A proposed-but-not-yet-applied crop rectangle (page's unrotated PDF space), drawn by
   * the crop tool. Separate from doc.objects/history since it isn't a document edit until
   * "Apply crop" commits it via setPageCropBox. */
  cropDraft: { pageId: string; rect: Rect } | null;
}

const EMPTY_DOC: EditorDocument = { sourceFiles: {}, pages: [], objects: [], formFields: [] };

export function useEditorWorkspace() {
  const historyRef = useRef(new EditorHistory<EditorDocument>(EMPTY_DOC));
  const ocrSessionRef = useRef<OcrSession | null>(null);
  const ocrCancelRef = useRef(false);

  const [state, setState] = useState<WorkspaceState>({
    stage: "empty",
    error: null,
    doc: EMPTY_DOC,
    activePageId: null,
    activeTool: "select",
    selectedObjectId: null,
    zoom: 1,
    zoomMode: "custom",
    showOcrOverlay: true,
    pageClassifications: {},
    nativeRegionsByPage: {},
    ocrResultsByPage: {},
    ocrLanguage: "eng",
    ocrBusyPageId: null,
    ocrProgress: null,
    signedWarning: false,
    searchQuery: "",
    searchMatchIndex: 0,
    cropDraft: null,
  });

  useEffect(() => {
    return () => {
      ocrSessionRef.current?.terminate();
    };
  }, []);

  const pushDoc = useCallback((next: EditorDocument) => {
    historyRef.current.push(next);
    setState((s) => ({ ...s, doc: next, selectedObjectId: null }));
  }, []);

  const undo = useCallback(() => {
    const next = historyRef.current.undo();
    setState((s) => ({ ...s, doc: next, selectedObjectId: null }));
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.redo();
    setState((s) => ({ ...s, doc: next, selectedObjectId: null }));
  }, []);

  const openFile = useCallback(async (file: File) => {
    setState((s) => ({ ...s, stage: "loading", error: null }));
    const validation = await validateFileForTool(file, tool);
    if (!validation.valid) {
      setState((s) => ({ ...s, stage: "error", error: validation.error ?? "This file isn't supported." }));
      return;
    }
    try {
      const doc = await loadEditorDocument(file);
      const classifications = await classifyPdfPages(file);
      const byId: Record<string, PageClassification["classification"]> = {};
      classifications.forEach((c, i) => {
        const page = doc.pages[i];
        if (page) byId[page.id] = c.classification;
      });
      const signed = await likelyHasDigitalSignature(file).catch(() => false);

      historyRef.current = new EditorHistory<EditorDocument>(doc);
      setState((s) => ({
        ...s,
        stage: "ready",
        doc,
        activePageId: doc.pages[0]?.id ?? null,
        pageClassifications: byId,
        nativeRegionsByPage: {},
        ocrResultsByPage: {},
        signedWarning: signed,
        selectedObjectId: null,
        activeTool: "select",
        cropDraft: null,
      }));
    } catch (e) {
      const message = e instanceof EditorDocumentError ? e.message : "We couldn't read this PDF.";
      setState((s) => ({ ...s, stage: "error", error: message }));
    }
  }, []);

  const reset = useCallback(() => {
    ocrSessionRef.current?.terminate();
    ocrSessionRef.current = null;
    historyRef.current = new EditorHistory<EditorDocument>(EMPTY_DOC);
    setState({
      stage: "empty",
      error: null,
      doc: EMPTY_DOC,
      activePageId: null,
      activeTool: "select",
      selectedObjectId: null,
      zoom: 1,
      zoomMode: "custom",
      showOcrOverlay: true,
      pageClassifications: {},
      nativeRegionsByPage: {},
      ocrResultsByPage: {},
      ocrLanguage: "eng",
      ocrBusyPageId: null,
      ocrProgress: null,
      signedWarning: false,
      searchQuery: "",
      searchMatchIndex: 0,
      cropDraft: null,
    });
  }, []);

  // -------------------------------------------------------------- selection / tools

  const setActivePageId = useCallback((pageId: string) => {
    setState((s) => ({ ...s, activePageId: pageId, selectedObjectId: null }));
  }, []);

  const setActiveTool = useCallback((toolId: ToolId) => {
    setState((s) => ({ ...s, activeTool: toolId, selectedObjectId: null }));
  }, []);

  const setSelectedObjectId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedObjectId: id }));
  }, []);

  const setZoom = useCallback((zoom: number, mode: ZoomMode = "custom") => {
    setState((s) => ({ ...s, zoom, zoomMode: mode }));
  }, []);

  // -------------------------------------------------------------- native text

  const loadNativeRegionsForPage = useCallback(
    async (page: EditorPage) => {
      if (state.nativeRegionsByPage[page.id]) return;
      const file = state.doc.sourceFiles[page.sourceFileId];
      if (!file) return;
      try {
        const regions = await extractNativeTextRegions(file, page.sourcePageIndex + 1);
        setState((s) => ({ ...s, nativeRegionsByPage: { ...s.nativeRegionsByPage, [page.id]: regions } }));
      } catch {
        setState((s) => ({ ...s, nativeRegionsByPage: { ...s.nativeRegionsByPage, [page.id]: [] } }));
      }
    },
    [state.doc.sourceFiles, state.nativeRegionsByPage]
  );

  // -------------------------------------------------------------- OCR

  const runOcr = useCallback(
    async (pageIds: string[]) => {
      const targets = state.doc.pages.filter((p) => pageIds.includes(p.id));
      if (targets.length === 0) return;

      let session = ocrSessionRef.current;
      if (!session) {
        try {
          session = await createOcrSession(state.ocrLanguage);
          ocrSessionRef.current = session;
        } catch (e) {
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : "The OCR engine couldn't load." }));
          return;
        }
      }

      ocrCancelRef.current = false;
      for (const page of targets) {
        if (ocrCancelRef.current) break;
        const file = state.doc.sourceFiles[page.sourceFileId];
        if (!file) continue;
        setState((s) => ({ ...s, ocrBusyPageId: page.id, ocrProgress: { label: "Preparing page…", fraction: 0 } }));
        try {
          const result = await session.recognizePage(file, page.sourcePageIndex + 1, {
            scale: 2,
            onProgress: (fraction) =>
              setState((s) => ({ ...s, ocrProgress: { label: "Recognizing text…", fraction } })),
          });
          setState((s) => ({ ...s, ocrResultsByPage: { ...s.ocrResultsByPage, [page.id]: result } }));
        } catch (e) {
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Recognition failed." }));
        }
      }
      setState((s) => ({ ...s, ocrBusyPageId: null, ocrProgress: null }));
    },
    [state.doc.pages, state.doc.sourceFiles, state.ocrLanguage]
  );

  const cancelOcr = useCallback(() => {
    ocrCancelRef.current = true;
  }, []);

  const setOcrLanguage = useCallback((lang: string) => {
    ocrSessionRef.current?.terminate();
    ocrSessionRef.current = null;
    setState((s) => ({ ...s, ocrLanguage: lang }));
  }, []);

  const setShowOcrOverlay = useCallback((show: boolean) => {
    setState((s) => ({ ...s, showOcrOverlay: show }));
  }, []);

  // -------------------------------------------------------------- objects

  const addObject = useCallback(
    (object: EditorObject) => {
      pushDoc({ ...state.doc, objects: [...state.doc.objects, object] });
      setState((s) => ({ ...s, selectedObjectId: object.id }));
    },
    [pushDoc, state.doc]
  );

  /** Like addObject, but also switches the active tool back to "select" in the same state
   * update — a plain addObject() followed by a separate setActiveTool("select") call would
   * clobber the just-set selectedObjectId, since setActiveTool always clears it (so that
   * switching tools while an object is selected deselects it). Placement tools (add-text,
   * whiteout, shapes, annotations) that hand off to "select" immediately after creating an
   * object should use this instead. */
  const addObjectAndSelect = useCallback(
    (object: EditorObject) => {
      pushDoc({ ...state.doc, objects: [...state.doc.objects, object] });
      setState((s) => ({ ...s, activeTool: "select", selectedObjectId: object.id }));
    },
    [pushDoc, state.doc]
  );

  const updateObject = useCallback(
    (id: string, patch: Partial<EditorObject>) => {
      const next = {
        ...state.doc,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        objects: state.doc.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as any) : o)),
      };
      pushDoc(next);
    },
    [pushDoc, state.doc]
  );

  /** Like updateObject, but doesn't push a new history entry — for continuous drag/resize
   * previews, where every pointermove would otherwise flood undo history. */
  const previewObject = useCallback((id: string, patch: Partial<EditorObject>) => {
    setState((s) => ({
      ...s,
      doc: {
        ...s.doc,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        objects: s.doc.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as any) : o)),
      },
    }));
  }, []);

  const commitPreview = useCallback(() => {
    historyRef.current.push(state.doc);
  }, [state.doc]);

  const deleteObject = useCallback(
    (id: string) => {
      pushDoc({ ...state.doc, objects: state.doc.objects.filter((o) => o.id !== id) });
    },
    [pushDoc, state.doc]
  );

  // -------------------------------------------------------------- pages

  const insertFile = useCallback(
    async (file: File, afterPageId?: string) => {
      const next = await insertFilePages(state.doc, file, afterPageId);
      pushDoc(next);
    },
    [pushDoc, state.doc]
  );

  const insertBlankPage = useCallback(
    async (afterPageId?: string) => {
      const next = await insertBlankPageOp(state.doc, afterPageId);
      pushDoc(next);
    },
    [pushDoc, state.doc]
  );

  const duplicatePage = useCallback(
    (pageId: string) => pushDoc(duplicatePageOp(state.doc, pageId)),
    [pushDoc, state.doc]
  );

  const deletePage = useCallback(
    (pageId: string) => {
      try {
        const next = deletePageOp(state.doc, pageId);
        pushDoc(next);
        setState((s) => ({ ...s, activePageId: s.activePageId === pageId ? next.pages[0]?.id ?? null : s.activePageId }));
      } catch (e) {
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : "Couldn't delete that page." }));
      }
    },
    [pushDoc, state.doc]
  );

  const reorderPageList = useCallback(
    (orderedIds: string[]) => pushDoc(reorderPagesOp(state.doc, orderedIds)),
    [pushDoc, state.doc]
  );

  const rotatePage = useCallback(
    (pageId: string, delta: 90 | -90) => pushDoc(rotatePageOp(state.doc, pageId, delta)),
    [pushDoc, state.doc]
  );

  // -------------------------------------------------------------- crop

  const setCropDraft = useCallback((draft: { pageId: string; rect: Rect } | null) => {
    setState((s) => ({ ...s, cropDraft: draft }));
  }, []);

  const applyCrop = useCallback(
    (applyToAllPages: boolean) => {
      const draft = state.cropDraft;
      if (!draft) return;
      const box: [number, number, number, number] = [
        draft.rect.x,
        draft.rect.y,
        draft.rect.x + draft.rect.width,
        draft.rect.y + draft.rect.height,
      ];
      const next = applyToAllPages
        ? setCropBoxForAllPages(state.doc, box)
        : setPageCropBox(state.doc, draft.pageId, box);
      pushDoc(next);
      setState((s) => ({ ...s, cropDraft: null, activeTool: "select" }));
    },
    [pushDoc, state.doc, state.cropDraft]
  );

  const clearCrop = useCallback(
    (pageId: string) => {
      pushDoc(setPageCropBox(state.doc, pageId, null));
    },
    [pushDoc, state.doc]
  );

  // -------------------------------------------------------------- form fields

  const setFormFieldValue = useCallback(
    (name: string, value: string) => {
      pushDoc({
        ...state.doc,
        formFields: state.doc.formFields.map((f) => (f.name === name ? { ...f, value } : f)),
      });
    },
    [pushDoc, state.doc]
  );

  // -------------------------------------------------------------- export

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportDocument = useCallback(async (): Promise<Blob | null> => {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportEditorDocument(state.doc);
      return blob;
    } catch (e) {
      setExportError(e instanceof EditorExportError ? e.message : "We couldn't export this PDF.");
      return null;
    } finally {
      setExporting(false);
    }
  }, [state.doc]);

  // -------------------------------------------------------------- search

  const searchIndex = useMemo(() => {
    const matches: SearchMatch[] = [];
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return matches;
    for (const page of state.doc.pages) {
      for (const region of state.nativeRegionsByPage[page.id] ?? []) {
        if (region.text.toLowerCase().includes(q)) {
          matches.push({ pageId: page.id, text: region.text, pdfBox: region.pdfBox });
        }
      }
      const ocr = state.ocrResultsByPage[page.id];
      if (ocr) {
        for (const line of ocr.lines) {
          if (line.text.toLowerCase().includes(q)) {
            matches.push({ pageId: page.id, text: line.text, pdfBox: line.pdfBox });
          }
        }
      }
    }
    return matches;
  }, [state.searchQuery, state.doc.pages, state.nativeRegionsByPage, state.ocrResultsByPage]);

  const setSearchQuery = useCallback((query: string) => {
    setState((s) => ({ ...s, searchQuery: query, searchMatchIndex: 0 }));
  }, []);

  const nextMatch = useCallback(() => {
    setState((s) => ({ ...s, searchMatchIndex: searchIndex.length ? (s.searchMatchIndex + 1) % searchIndex.length : 0 }));
  }, [searchIndex.length]);

  const prevMatch = useCallback(() => {
    setState((s) => ({
      ...s,
      searchMatchIndex: searchIndex.length ? (s.searchMatchIndex - 1 + searchIndex.length) % searchIndex.length : 0,
    }));
  }, [searchIndex.length]);

  return {
    state,
    canUndo: historyRef.current.canUndo,
    canRedo: historyRef.current.canRedo,
    openFile,
    reset,
    undo,
    redo,
    setActivePageId,
    setActiveTool,
    setSelectedObjectId,
    setZoom,
    loadNativeRegionsForPage,
    runOcr,
    cancelOcr,
    setOcrLanguage,
    setShowOcrOverlay,
    addObject,
    addObjectAndSelect,
    updateObject,
    previewObject,
    commitPreview,
    deleteObject,
    insertFile,
    insertBlankPage,
    duplicatePage,
    deletePage,
    reorderPageList,
    rotatePage,
    setCropDraft,
    applyCrop,
    clearCrop,
    setFormFieldValue,
    exportDocument,
    exporting,
    exportError,
    searchIndex,
    setSearchQuery,
    nextMatch,
    prevMatch,
    newObjectId: generateUuidV4,
  };
}

export type EditorWorkspaceApi = ReturnType<typeof useEditorWorkspace>;
