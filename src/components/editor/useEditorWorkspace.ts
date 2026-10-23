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
import { buildWorkingPage, boxTransform, editKey, type NativeEdit, type PageAnalysis } from "@/lib/editor/native";
import type { StyleOverride } from "@/lib/pdf-engine/edit-text";
import { browserFontLoader } from "@/lib/processors/word-to-pdf/fonts";
import { exportEditorDocument, EditorExportError } from "@/lib/editor/export";
import { generateUuidV4 } from "@/lib/id";
import { createOcrSession, type OcrPageResult, type OcrSession } from "@/lib/processors/ocr";
import type { EditorDocument, EditorObject, EditorPage, FormFieldValue, NativeImageEditObject, NativeTextEditObject } from "@/lib/editor/types";
import { isNativeEdit } from "@/lib/editor/types";
import { effectiveRotation } from "@/lib/editor/types";
import { applyCorrections } from "@/lib/editor/searchLayer";
import { validateFileForTool } from "@/lib/security/validators";
import { getTool } from "@/lib/tools/registry";

const tool = getTool("pdf-editor");

export type ToolId =
  | "select"
  | "edit-text"
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

/** What is selected among the page's own content: a block of text, or a picture. */
export type NativeSelection = { kind: "text"; pageId: string; blockId: string } | { kind: "image"; pageId: string; imageId: string };

/** The page as the editor shows it: the source page with the editor's edits to its own text and pictures applied. */
export interface WorkingState {
  /** The edits this state was built for. */
  sig: string;
  status: "loading" | "ready" | "error";
  analysis: PageAnalysis | null;
  /** A one-page PDF with the edits applied; null while there are none (the source page is shown as it is). */
  file: File | null;
  /** The same page with the block being edited blanked out, shown while its text is on the canvas as a live text box. */
  editingFile?: File | null;
  error?: string;
}

export type NativeResult = { ok: true; analysis?: PageAnalysis } | { ok: false; reason: string };

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
  /** The text object currently being edited directly on the canvas (a caret is inside it),
   * or null. Separate from selection: an object can be selected without being edited. */
  editingObjectId: string | null;
  /** When entering edit mode should select all existing text (a freshly-placed box's placeholder). */
  editSelectAll: boolean;
  zoom: number;
  zoomMode: ZoomMode;
  showOcrOverlay: boolean;
  workingByPage: Record<string, WorkingState>;
  selectedNative: NativeSelection | null;
  /** The block whose text is being edited on the canvas. */
  editingText: { pageId: string; blockId: string } | null;
  ocrResultsByPage: Record<string, OcrPageResult>;
  ocrLanguage: string;
  ocrBusyPageId: string | null;
  ocrProgress: { label: string; fraction: number } | null;
  signedWarning: boolean;
  searchQuery: string;
  searchMatchIndex: number;
  /** Bumped on every Next/Prev press so the view jumps to the match even when the index
   * didn't change (a single match, or one you've since scrolled away from). */
  searchNavTick: number;
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
    editingObjectId: null,
    editSelectAll: false,
    zoom: 1,
    zoomMode: "custom",
    // Off by default: recognized words already get a subtle hover-only highlight (see
    // PageSurface.tsx's word buttons) without needing every word permanently boxed —
    // confidence-colored region boxes are opt-in via "Show text regions" (spec section 25).
    showOcrOverlay: false,
    workingByPage: {},
    selectedNative: null,
    editingText: null,
    ocrResultsByPage: {},
    ocrLanguage: "eng",
    ocrBusyPageId: null,
    ocrProgress: null,
    signedWarning: false,
    searchQuery: "",
    searchMatchIndex: 0,
    searchNavTick: 0,
    cropDraft: null,
  });

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    return () => {
      ocrSessionRef.current?.terminate();
    };
  }, []);

  /** Pushes a new document state to history. Selection is cleared by default (most edits —
   * page operations, deletes — invalidate whatever was selected); pass keepSelection for an
   * in-place edit of the selected object (typing, recoloring), which must not deselect it or
   * the controls being used vanish mid-edit. `coalesceKey` merges a burst of edits to the same
   * thing into one undo step (see EditorHistory.push). */
  const pushDoc = useCallback((next: EditorDocument, opts?: { keepSelection?: boolean; coalesceKey?: string }) => {
    historyRef.current.push(next, opts?.coalesceKey);
    setState((s) => ({
      ...s,
      doc: next,
      selectedObjectId: opts?.keepSelection ? s.selectedObjectId : null,
      editingObjectId: opts?.keepSelection ? s.editingObjectId : null,
      selectedNative: opts?.keepSelection ? s.selectedNative : null,
      editingText: null,
    }));
  }, []);

  const undo = useCallback(() => {
    const next = historyRef.current.undo();
    setState((s) => ({ ...s, doc: next, selectedObjectId: null, editingObjectId: null, selectedNative: null, editingText: null }));
  }, []);

  const redo = useCallback(() => {
    const next = historyRef.current.redo();
    setState((s) => ({ ...s, doc: next, selectedObjectId: null, editingObjectId: null, selectedNative: null, editingText: null }));
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
      const signed = await likelyHasDigitalSignature(file).catch(() => false);

      historyRef.current = new EditorHistory<EditorDocument>(doc);
      setState((s) => ({
        ...s,
        stage: "ready",
        doc,
        activePageId: doc.pages[0]?.id ?? null,
        workingByPage: {},
        selectedNative: null,
        editingText: null,
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
      editingObjectId: null,
      editSelectAll: false,
      zoom: 1,
      zoomMode: "custom",
      showOcrOverlay: false,
      workingByPage: {},
      selectedNative: null,
      editingText: null,
      ocrResultsByPage: {},
      ocrLanguage: "eng",
      ocrBusyPageId: null,
      ocrProgress: null,
      signedWarning: false,
      searchQuery: "",
      searchMatchIndex: 0,
      searchNavTick: 0,
      cropDraft: null,
    });
  }, []);

  // -------------------------------------------------------------- selection / tools

  const setActivePageId = useCallback((pageId: string) => {
    setState((s) => ({ ...s, activePageId: pageId, selectedObjectId: null, selectedNative: null, editingText: null }));
  }, []);

  const setActiveTool = useCallback((toolId: ToolId, opts?: { keepSelection?: boolean }) => {
    setState((s) => ({
      ...s,
      activeTool: toolId,
      selectedObjectId: opts?.keepSelection ? s.selectedObjectId : null,
      editingObjectId: null,
      selectedNative: opts?.keepSelection ? s.selectedNative : null,
      editingText: toolId === "select" || toolId === "edit-text" ? s.editingText : null,
    }));
  }, []);

  const setSelectedObjectId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedObjectId: id, selectedNative: id ? null : s.selectedNative, editingObjectId: id && s.editingObjectId === id ? id : null }));
  }, []);

  const setEditingObjectId = useCallback((id: string | null) => {
    if (id === null) historyRef.current.breakCoalescing();
    setState((s) => ({ ...s, editingObjectId: id, editSelectAll: false, selectedObjectId: id ?? s.selectedObjectId }));
  }, []);

  const setZoom = useCallback((zoom: number, mode: ZoomMode = "custom") => {
    setState((s) => ({ ...s, zoom, zoomMode: mode }));
  }, []);

  // -------------------------------------------------------------- the page's own text and pictures

  /** The edits the editor has made to a page's own content, in the order they were made. */
  const nativeEditsOf = (doc: EditorDocument, pageId: string): NativeEdit[] => doc.objects.filter((o) => o.pageId === pageId && isNativeEdit(o)).map((o) => (o as NativeTextEditObject | NativeImageEditObject).edit);
  /** The form fields on a page whose picture has to be redrawn: filled in, or whose appearance can't be trusted. */
  const formsOf = (doc: EditorDocument, page: EditorPage): FormFieldValue[] =>
    doc.formFields.filter((f) => (f.value !== f.initial || f.regen) && f.widgets.some((w) => w.sourceFileId === page.sourceFileId && w.pageIndex === page.sourcePageIndex));
  const sigOf = (edits: NativeEdit[], forms: FormFieldValue[] = []) => `${edits.map(editKey).join("|")}#${forms.map((f) => `${f.name}=${f.value}`).join("|")}`;

  const workingSeq = useRef<Record<string, number>>({});
  const bytesToFile = (bytes: Uint8Array) => new File([bytes as BlobPart], "page.pdf", { type: "application/pdf" });

  /** Builds (or rebuilds) a page's working copy and its analysis when its edits have changed. Cheap when nothing changed. */
  const ensureWorking = useCallback(
    async (page: EditorPage): Promise<PageAnalysis | null> => {
      const doc = historyRef.current.current;
      const edits = nativeEditsOf(doc, page.id);
      const forms = formsOf(doc, page);
      const sig = sigOf(edits, forms);
      const current = stateRef.current.workingByPage[page.id];
      if (current && current.sig === sig && current.status === "ready") return current.analysis;
      const key = `${page.id}|${sig}`;
      const running = inflight.current.get(key);
      if (running) return running; // the same build is already under way: wait for it instead of starting another
      const sourceFile = doc.sourceFiles[page.sourceFileId];
      if (!sourceFile) return null;
      const job = buildNow(page, doc, edits, forms, sig, sourceFile);
      inflight.current.set(key, job);
      try {
        return await job;
      } finally {
        inflight.current.delete(key);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const inflight = useRef(new Map<string, Promise<PageAnalysis | null>>());
  const buildNow = useCallback(
    async (page: EditorPage, doc: EditorDocument, edits: NativeEdit[], forms: FormFieldValue[], sig: string, sourceFile: File): Promise<PageAnalysis | null> => {
      const seq = (workingSeq.current[page.id] = (workingSeq.current[page.id] ?? 0) + 1);
      setState((s) => ({ ...s, workingByPage: { ...s.workingByPage, [page.id]: { ...(s.workingByPage[page.id] ?? { analysis: null, file: null }), sig, status: "loading" } } }));
      const res = await buildWorkingPage(sourceFile, page.sourceFileId, page.sourcePageIndex, edits, browserFontLoader, forms).catch((e: unknown) => ({ ok: false as const, index: -1, reason: e instanceof Error ? e.message : "The page couldn't be read." }));
      if (workingSeq.current[page.id] !== seq) return null;
      setState((s) => ({
        ...s,
        workingByPage: {
          ...s.workingByPage,
          [page.id]: res.ok ? { sig, status: "ready", analysis: res.page.analysis, file: edits.length || res.page.formsApplied ? bytesToFile(res.page.bytes) : null } : { analysis: s.workingByPage[page.id]?.analysis ?? null, file: null, sig, status: "error", error: res.reason },
        },
      }));
      return res.ok ? res.page.analysis : null;
    },
    []
  );

  /** The signature of what a page's picture should show now; the page is drawn current when its working copy has this signature. */
  const currentWorkingSig = useCallback((page: EditorPage) => sigOf(nativeEditsOf(stateRef.current.doc, page.id), formsOf(stateRef.current.doc, page)), []);

  const selectNative = useCallback((sel: NativeSelection | null) => {
    setState((s) => ({ ...s, selectedNative: sel, selectedObjectId: sel ? null : s.selectedObjectId, editingObjectId: null }));
  }, []);

  /** Puts the text of a block on the canvas as a live text box: the page is shown with that block's own text taken out. */
  const beginTextEdit = useCallback(
    async (pageId: string, blockId: string) => {
      const doc = historyRef.current.current;
      const page = doc.pages.find((p) => p.id === pageId);
      const file = page && doc.sourceFiles[page.sourceFileId];
      if (!page || !file) return;
      setState((s) => ({ ...s, editingText: { pageId, blockId }, selectedNative: { kind: "text", pageId, blockId }, selectedObjectId: null, editingObjectId: null }));
      const edits = nativeEditsOf(doc, pageId);
      const res = await buildWorkingPage(file, page.sourceFileId, page.sourcePageIndex, [...edits, { kind: "text", block: blockId, newText: "" }], browserFontLoader, formsOf(doc, page));
      if (!res.ok) return;
      setState((s) => {
        if (s.editingText?.blockId !== blockId || s.editingText.pageId !== pageId) return s;
        return { ...s, workingByPage: { ...s.workingByPage, [pageId]: { ...(s.workingByPage[pageId] ?? { sig: "", status: "ready", analysis: null, file: null }), editingFile: bytesToFile(res.page.bytes) } } };
      });
    },
    []
  );

  const cancelTextEdit = useCallback(() => {
    setState((s) => {
      if (!s.editingText) return s;
      const w = s.workingByPage[s.editingText.pageId];
      return { ...s, editingText: null, workingByPage: w ? { ...s.workingByPage, [s.editingText.pageId]: { ...w, editingFile: null } } : s.workingByPage };
    });
  }, []);

  /** Applies a native edit (checked first: the engine either writes it exactly or says why not) and records it in history. */
  const commitNativeEdit = useCallback(
    async (pageId: string, edit: NativeEdit, label: string, bbox: { x: number; y: number; width: number; height: number }): Promise<NativeResult> => {
      const doc = historyRef.current.current;
      const page = doc.pages.find((p) => p.id === pageId);
      const file = page && doc.sourceFiles[page.sourceFileId];
      if (!page || !file) return { ok: false, reason: "That page isn't available." };
      const edits = nativeEditsOf(doc, pageId);
      const res = await buildWorkingPage(file, page.sourceFileId, page.sourcePageIndex, [...edits, edit], browserFontLoader, formsOf(doc, page)).catch((e: unknown) => ({ ok: false as const, index: -1, reason: e instanceof Error ? e.message : "The edit couldn't be applied." }));
      if (!res.ok) return { ok: false, reason: res.reason };
      const object: NativeTextEditObject | NativeImageEditObject =
        edit.kind === "text"
          ? { id: generateUuidV4(), type: "native-text-edit", pageId, ...bbox, originalText: label, edit }
          : { id: generateUuidV4(), type: "native-image-edit", pageId, ...bbox, edit };
      const next = { ...doc, objects: [...doc.objects, object] };
      const sig = sigOf([...edits, edit], formsOf(doc, page));
      workingSeq.current[pageId] = (workingSeq.current[pageId] ?? 0) + 1; // any build still running is out of date
      historyRef.current.push(next);
      setState((s) => ({
        ...s,
        doc: next,
        editingText: null,
        workingByPage: { ...s.workingByPage, [pageId]: { sig, status: "ready", analysis: res.page.analysis, file: bytesToFile(res.page.bytes), editingFile: null } },
      }));
      return { ok: true, analysis: res.page.analysis };
    },
    []
  );

  const commitTextEdit = useCallback(
    async (pageId: string, blockId: string, newText: string, opts?: { style?: StyleOverride; align?: "left" | "center" | "right" }): Promise<NativeResult> => {
      const block = stateRef.current.workingByPage[pageId]?.analysis?.blocks.find((b) => b.id === blockId);
      if (!block) return { ok: false, reason: "That text is no longer on the page." };
      if (newText === block.text && !opts?.style) {
        cancelTextEdit();
        return { ok: true };
      }
      return commitNativeEdit(pageId, { kind: "text", block: blockId, newText, style: opts?.style, align: opts?.align }, block.text, block.bbox);
    },
    [commitNativeEdit, cancelTextEdit]
  );

  const applyTextStyle = useCallback(
    async (pageId: string, blockId: string, style: StyleOverride, align?: "left" | "center" | "right"): Promise<NativeResult> => {
      const block = stateRef.current.workingByPage[pageId]?.analysis?.blocks.find((b) => b.id === blockId);
      if (!block) return { ok: false, reason: "That text is no longer on the page." };
      return commitNativeEdit(pageId, { kind: "text", block: blockId, newText: block.text, style, align }, block.text, block.bbox);
    },
    [commitNativeEdit]
  );

  /** Moves/resizes/rotates a picture on the page: `box` is where it should be (as it appears), `degrees` the turn about its centre. */
  const transformImage = useCallback(
    async (pageId: string, imageId: string, box: { x: number; y: number; width: number; height: number }, degrees = 0): Promise<NativeResult> => {
      const im = stateRef.current.workingByPage[pageId]?.analysis?.images.find((x) => x.id === imageId);
      if (!im) return { ok: false, reason: "That picture is no longer on the page." };
      const res = await commitNativeEdit(pageId, { kind: "image", id: imageId, action: { type: "transform", matrix: boxTransform(im.bbox, box, degrees) } }, "", box);
      if (res.ok && res.analysis) {
        // the picture keeps its place in the document but gets a new id: keep it selected, so the next drag or resize needs no click
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const dist = (b: { x: number; y: number; width: number; height: number }) => Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy);
        const next = [...res.analysis.images].sort((a, b) => dist(a.bbox) - dist(b.bbox))[0];
        if (next) setState((s) => (s.selectedNative?.kind === "image" && s.selectedNative.pageId === pageId ? { ...s, selectedNative: { kind: "image", pageId, imageId: next.id } } : s));
      }
      return res;
    },
    [commitNativeEdit]
  );

  const deleteNativeImage = useCallback(
    async (pageId: string, imageId: string): Promise<NativeResult> => {
      const im = stateRef.current.workingByPage[pageId]?.analysis?.images.find((x) => x.id === imageId);
      if (!im) return { ok: false, reason: "That picture is no longer on the page." };
      const res = await commitNativeEdit(pageId, { kind: "image", id: imageId, action: { type: "delete" } }, "", im.bbox);
      if (res.ok) setState((s) => ({ ...s, selectedNative: null }));
      return res;
    },
    [commitNativeEdit]
  );

  const replaceNativeImage = useCallback(
    async (pageId: string, imageId: string, dataUrl: string): Promise<NativeResult> => {
      const im = stateRef.current.workingByPage[pageId]?.analysis?.images.find((x) => x.id === imageId);
      if (!im) return { ok: false, reason: "That picture is no longer on the page." };
      const res = await commitNativeEdit(pageId, { kind: "image", id: imageId, action: { type: "replace", dataUrl } }, "", im.bbox);
      if (res.ok) setState((s) => ({ ...s, selectedNative: null }));
      return res;
    },
    [commitNativeEdit]
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
            // Read the page the way it is shown: a scan stored sideways with /Rotate 90 is upright
            // on screen but sideways in the file (the old fixed 0 read it sideways — ~9% accuracy).
            // Word boxes are mapped back to PDF space whichever way it was rendered.
            rotate: effectiveRotation(page),
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

  /** Recognizes the text of every scanned page that has none yet (a page is scanned when its own analysis says so). */
  const recognizeScanned = useCallback(async () => {
    const ids: string[] = [];
    for (const p of historyRef.current.current.pages) {
      const analysis = await ensureWorking(p);
      if (analysis?.scanned && !stateRef.current.ocrResultsByPage[p.id]) ids.push(p.id);
    }
    if (ids.length) await runOcr(ids);
  }, [ensureWorking, runOcr]);

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

  /** Adds an object and (by default) selects it, leaving the active tool alone — so a
   * persistent drawing tool stays armed for the next stroke. Pass select:false to add without
   * disturbing the current selection (repeated highlights/underlines). */
  const addObject = useCallback(
    (object: EditorObject, opts?: { select?: boolean }) => {
      pushDoc({ ...state.doc, objects: [...state.doc.objects, object] });
      if (opts?.select !== false) setState((s) => ({ ...s, selectedObjectId: object.id }));
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
    (object: EditorObject, opts?: { startEditing?: boolean; selectAllOnEdit?: boolean }) => {
      pushDoc({ ...state.doc, objects: [...state.doc.objects, object] });
      setState((s) => ({
        ...s,
        activeTool: "select",
        selectedObjectId: object.id,
        editingObjectId: opts?.startEditing ? object.id : null,
        editSelectAll: Boolean(opts?.startEditing && opts?.selectAllOnEdit),
      }));
    },
    [pushDoc, state.doc]
  );

  /** Edits an object in place. The object stays selected (and stays in text-edit mode if it
   * was) — deselecting it on every change would unmount the very control being typed into,
   * which is what made the properties-panel text box accept only one character at a time. */
  const updateObject = useCallback(
    (id: string, patch: Partial<EditorObject>, opts?: { coalesceKey?: string }) => {
      const next = {
        ...state.doc,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        objects: state.doc.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as any) : o)),
      };
      pushDoc(next, { keepSelection: true, coalesceKey: opts?.coalesceKey });
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
      pushDoc(
        {
          ...state.doc,
          formFields: state.doc.formFields.map((f) => (f.name === name ? { ...f, value } : f)),
        },
        { keepSelection: true, coalesceKey: `form:${name}` }
      );
    },
    [pushDoc, state.doc]
  );

  const breakCoalescing = useCallback(() => historyRef.current.breakCoalescing(), []);

  // -------------------------------------------------------------- export

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportDocument = useCallback(async (): Promise<Blob | null> => {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportEditorDocument(state.doc, { ocrResultsByPage: state.ocrResultsByPage });
      return blob;
    } catch (e) {
      setExportError(e instanceof EditorExportError || (e instanceof Error && e.name === "OutputIntegrityError") ? e.message : "We couldn't export this PDF.");
      return null;
    } finally {
      setExporting(false);
    }
  }, [state.doc, state.ocrResultsByPage]);

  // -------------------------------------------------------------- search

  const searchIndex = useMemo(() => {
    const matches: SearchMatch[] = [];
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return matches;
    for (const page of state.doc.pages) {
      const pageObjects = state.doc.objects.filter((o) => o.pageId === page.id);
      // Search what the page says *now*: the working page already has the editor's corrections in it.
      for (const block of state.workingByPage[page.id]?.analysis?.blocks ?? []) {
        for (const line of block.lines) if (line.text.toLowerCase().includes(q)) matches.push({ pageId: page.id, text: line.text, pdfBox: line.bbox });
      }
      const ocr = state.ocrResultsByPage[page.id];
      if (ocr) {
        for (const line of ocr.lines) {
          const text = applyCorrections(line.text, line.pdfBox, pageObjects.filter((o): o is Extract<typeof o, { type: "ocr-text-replacement" }> => o.type === "ocr-text-replacement")).text;
          if (text.toLowerCase().includes(q)) matches.push({ pageId: page.id, text, pdfBox: line.pdfBox });
        }
      }
      for (const o of pageObjects) {
        if (o.type === "added-text" && o.text.toLowerCase().includes(q)) {
          matches.push({ pageId: page.id, text: o.text, pdfBox: { x: o.x, y: o.y, width: o.width, height: o.height } });
        }
      }
    }
    return matches;
  }, [state.searchQuery, state.doc.pages, state.doc.objects, state.workingByPage, state.ocrResultsByPage]);

  const setSearchQuery = useCallback((query: string) => {
    setState((s) => ({ ...s, searchQuery: query, searchMatchIndex: 0 }));
  }, []);

  const nextMatch = useCallback(() => {
    setState((s) => ({
      ...s,
      searchMatchIndex: searchIndex.length ? (s.searchMatchIndex + 1) % searchIndex.length : 0,
      searchNavTick: s.searchNavTick + 1,
    }));
  }, [searchIndex.length]);

  const prevMatch = useCallback(() => {
    setState((s) => ({
      ...s,
      searchMatchIndex: searchIndex.length ? (s.searchMatchIndex - 1 + searchIndex.length) % searchIndex.length : 0,
      searchNavTick: s.searchNavTick + 1,
    }));
  }, [searchIndex.length]);

  const showMessage = useCallback((message: string | null) => setState((s) => ({ ...s, error: message })), []);

  return {
    state,
    showMessage,
    canUndo: historyRef.current.canUndo,
    canRedo: historyRef.current.canRedo,
    openFile,
    reset,
    undo,
    redo,
    setActivePageId,
    setActiveTool,
    setSelectedObjectId,
    setEditingObjectId,
    setZoom,
    ensureWorking,
    currentWorkingSig,
    selectNative,
    beginTextEdit,
    cancelTextEdit,
    commitTextEdit,
    applyTextStyle,
    transformImage,
    deleteNativeImage,
    replaceNativeImage,
    runOcr,
    recognizeScanned,
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
    breakCoalescing,
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
