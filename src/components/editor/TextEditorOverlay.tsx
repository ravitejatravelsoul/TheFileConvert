"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CSS_FAMILY, FONT_BOX, ensureEditorFonts, familyFor } from "@/lib/editor/editorFonts";
import type { BlockInfo, TextSegment } from "@/lib/editor/native";
import type { PageTransform } from "@/lib/editor/pageTransform";

interface Props {
  block: BlockInfo;
  transform: PageTransform;
  /** The page underneath has been redrawn without this text: show the box. */
  ready: boolean;
  /** Where the user pressed (client coordinates) so the caret lands there; "all" selects everything. */
  caretAt?: { x: number; y: number } | "all";
  onCommit: (text: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  onCancel: () => void;
}

const rgb = (c: TextSegment["color"]) => (c ? `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})` : "#000");

/**
 * The block's text as a real text box on the page. It is positioned and styled like the text it replaces (its own fonts'
 * metric-compatible web fonts, sizes, colours, alignment, wrapping width), and the page underneath has that text taken out,
 * so typing, the caret, selection, arrows and paste behave like any text editor — and what is on screen is what is written.
 */
export function TextEditorOverlay({ block, transform, ready, caretAt, onCommit, onCancel }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const doneRef = useRef(false);

  const S = block.size * transform.scale;
  const L = (block.leading || block.size * 1.2) * transform.scale;
  const dominant = block.segments.reduce((a, b) => (b.text.length > a.text.length ? b : a), block.segments[0]);
  const fam = familyFor(dominant);
  const fm = FONT_BOX[fam];
  const baselineOffset = (L - (fm.ascent + fm.descent) * S) / 2 + fm.ascent * S;
  const origin = transform.pdfToCss(block.left);
  const angle = transform.screenAngle(Math.cos(block.angle), Math.sin(block.angle));
  const width = (block.align === "left" ? block.maxWidth : block.width) * transform.scale;
  const barAt = transform.rectToCss(block.bbox);

  const text = useCallback(() => {
    const el = boxRef.current;
    if (!el) return "";
    return (el.contentEditable === "plaintext-only" ? el.textContent : el.innerText)?.replace(/ /g, " ") ?? "";
  }, []);

  // build the content once; React never touches the children afterwards, so nothing can reset what is being typed
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // the box is built and focused at once, so keys typed right after the double-click are never lost; the page's own fonts load
    // alongside and the browser re-flows the text when they arrive
    void ensureEditorFonts(block.segments);
    (() => {
      el.textContent = "";
      for (const seg of block.segments) {
        const span = document.createElement("span");
        span.textContent = seg.text;
        span.style.fontFamily = `"${CSS_FAMILY[familyFor(seg)]}", ${seg.fontClass === "serif" ? "serif" : seg.fontClass === "mono" ? "monospace" : "sans-serif"}`;
        span.style.fontWeight = seg.bold ? "700" : "400";
        span.style.fontStyle = seg.italic ? "italic" : "normal";
        span.style.fontSize = `${seg.size * transform.scale}px`;
        span.style.color = rgb(seg.color);
        el.appendChild(span);
      }
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      if (caretAt === "all") range.selectNodeContents(el);
      else {
        let placed = false;
        if (caretAt) {
          const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
          const pos = doc.caretPositionFromPoint?.(caretAt.x, caretAt.y);
          if (pos && el.contains(pos.offsetNode)) {
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
            placed = true;
          } else {
            const r = doc.caretRangeFromPoint?.(caretAt.x, caretAt.y);
            if (r && el.contains(r.startContainer)) {
              range.setStart(r.startContainer, r.startOffset);
              range.collapse(true);
              placed = true;
            }
          }
        }
        if (!placed) {
          range.selectNodeContents(el);
          range.collapse(false);
        }
      }
      sel.removeAllRanges();
      sel.addRange(range);
      setShown(true);
    })();
    // the content is built once for this block
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const commit = useCallback(async () => {
    if (doneRef.current || busy) return;
    setBusy(true);
    const res = await onCommit(text());
    setBusy(false);
    if (res.ok) doneRef.current = true;
    else setError(res.reason);
  }, [busy, onCommit, text]);

  const singleLine = block.lines.length === 1;

  return (
    <>
      <div
        ref={boxRef}
        data-testid="native-text-editor"
        role="textbox"
        aria-multiline={!singleLine}
        aria-label="Edit text on the page"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck
        className="absolute z-20 outline-none"
        style={{
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${origin.x}px, ${origin.y}px) rotate(${angle}rad) translateY(${-baselineOffset}px)`,
          width,
          minWidth: 12,
          lineHeight: `${L}px`,
          whiteSpace: "pre-wrap",
          textAlign: block.align,
          caretColor: "var(--select)",
          opacity: shown && ready ? 1 : 0,
          boxShadow: "0 0 0 1.5px var(--select)",
          borderRadius: 2,
          background: "transparent",
          touchAction: "manipulation",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={(e) => {
          // clicking elsewhere in the editor ends the edit; switching windows (or our own buttons) does not
          if (!document.hasFocus()) return;
          const next = e.relatedTarget as HTMLElement | null;
          if (next?.dataset?.editorAction) return;
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Enter" && !e.shiftKey && singleLine) {
            e.preventDefault();
            void commit();
          }
        }}
        onPaste={(e) => {
          // always plain text: the page's own styles are the only styles
          if (boxRef.current?.contentEditable === "plaintext-only") return;
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
      />
      <div className="absolute z-30 flex flex-wrap items-center gap-2" style={{ left: barAt.x, top: Math.max(4, barAt.y - 42), maxWidth: 360 }} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" data-editor-action="done" onClick={() => void commit()} disabled={busy} className="btn btn-primary btn-sm" aria-label="Apply this text edit">
          Done
        </button>
        <button type="button" data-editor-action="cancel" onClick={onCancel} className="btn btn-secondary btn-sm" aria-label="Cancel this text edit">
          Cancel
        </button>
        {error && (
          <span role="alert" data-testid="text-edit-error" className="rounded-[var(--radius-sm)] bg-[var(--danger-soft)] px-2 py-1 text-xs text-[var(--danger)]">
            {error}
          </span>
        )}
      </div>
    </>
  );
}
