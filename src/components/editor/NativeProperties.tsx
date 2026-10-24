"use client";

import { useRef, useState } from "react";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";
import type { BlockInfo, ImageInfo } from "@/lib/editor/native";
import type { FallbackFamily } from "@/lib/pdf-engine/fallback";
import { familyFor } from "@/lib/editor/editorFonts";
import { PRESET_COLORS, rgbToCss } from "./toolOptions";
import { IconTrash } from "@/components/icons";

const FAMILIES: { id: FallbackFamily; label: string }[] = [
  { id: "sans", label: "Sans (Arial-like)" },
  { id: "serif", label: "Serif (Times-like)" },
  { id: "mono", label: "Monospace (Courier-like)" },
  { id: "carlito", label: "Calibri-like" },
  { id: "gelasio", label: "Georgia-like" },
  { id: "caladea", label: "Cambria-like" },
  { id: "dejavu", label: "DejaVu Sans" },
];

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: true } | { ok: false; reason: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn().catch((e: unknown) => ({ ok: false as const, reason: e instanceof Error ? e.message : "That didn't work." }));
    setBusy(false);
    if (!res.ok) setError(res.reason);
  };
  return { busy, error, run };
}

/** Style of the selected block of the page's own text: the change is written into the PDF like any other edit (and can be undone). */
export function NativeTextProperties({ api, pageId, block }: { api: EditorWorkspaceApi; pageId: string; block: BlockInfo }) {
  const { busy, error, run } = useBusy();
  const dominant = block.segments.reduce((a, b) => (b.text.length > a.text.length ? b : a), block.segments[0]);
  const family = familyFor(dominant);
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

  const apply = (style: Parameters<EditorWorkspaceApi["applyTextStyle"]>[2], align?: "left" | "center" | "right") => run(() => api.applyTextStyle(pageId, block.id, style, align));

  return (
    <div className="space-y-3" data-testid="native-text-properties">
      {!block.editable && <p className="rounded-[var(--radius-sm)] bg-[var(--warning-soft)] p-2 text-xs text-[var(--warning)]">{block.reason ?? "This text can't be edited."}</p>}
      <p className="line-clamp-3 text-xs text-[var(--ink-2)]">&ldquo;{block.text}&rdquo;</p>
      <button type="button" disabled={!block.editable || busy} onClick={() => api.beginTextEdit(pageId, block.id)} className="btn btn-primary btn-sm w-full">
        Edit text
      </button>
      {block.editable && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ink-2)]">Font</span>
            <select value={family} disabled={busy} onChange={(e) => apply({ family: e.target.value as FallbackFamily })} className="field w-full text-sm" aria-label="Font">
              {FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ink-2)]">Size (pt)</span>
            <input
              type="number"
              min={4}
              max={200}
              step={0.5}
              aria-label="Font size"
              disabled={busy}
              value={sizeDraft ?? String(Math.round(block.size * 10) / 10)}
              onChange={(e) => setSizeDraft(e.target.value)}
              onBlur={() => {
                const n = Number(sizeDraft);
                setSizeDraft(null);
                if (sizeDraft !== null && Number.isFinite(n) && n >= 4 && n <= 200 && Math.abs(n - block.size) > 0.05) void apply({ size: n });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="field w-full text-sm"
            />
          </label>
          <div className="flex gap-2" role="group" aria-label="Text style">
            <button type="button" aria-pressed={dominant.bold} disabled={busy} onClick={() => apply({ bold: !dominant.bold })} className={`min-h-10 flex-1 rounded-full font-bold ${dominant.bold ? "bg-[var(--ink)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`} aria-label="Bold">
              B
            </button>
            <button type="button" aria-pressed={dominant.italic} disabled={busy} onClick={() => apply({ italic: !dominant.italic })} className={`min-h-10 flex-1 rounded-full italic ${dominant.italic ? "bg-[var(--ink)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`} aria-label="Italic">
              I
            </button>
          </div>
          <div className="flex gap-1" role="group" aria-label="Text alignment">
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={block.align === a} aria-label={`Align ${a}`} disabled={busy} onClick={() => apply({}, a)} className={`min-h-10 flex-1 rounded-full capitalize ${block.align === a ? "bg-[var(--ink)] text-white" : "bg-[var(--surface-2)] text-[var(--ink-2)]"}`}>
                {a}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-[var(--ink-2)]">Color</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button key={c.label} type="button" aria-label={`Text color ${c.label}`} disabled={busy} onClick={() => apply({ color: c.value })} className="h-8 w-8 rounded-full border border-black/10 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10" style={{ backgroundColor: rgbToCss(c.value) }} />
              ))}
            </div>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

/** The selected picture of the page: size, turn, replace, delete. */
export function NativeImageProperties({ api, pageId, image }: { api: EditorWorkspaceApi; pageId: string; image: ImageInfo }) {
  const { busy, error, run } = useBusy();
  const fileRef = useRef<HTMLInputElement>(null);

  const replaceWith = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => void run(() => api.replaceNativeImage(pageId, image.id, reader.result as string));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3" data-testid="native-image-properties">
      <p className="text-xs text-[var(--ink-2)]">
        {Math.round(image.bbox.width)} &times; {Math.round(image.bbox.height)} pt &middot; {image.pixelWidth} &times; {image.pixelHeight} px
      </p>
      {image.shared && <p className="rounded-[var(--radius-sm)] bg-[var(--warning-soft)] p-2 text-xs text-[var(--warning)]">This picture is part of a shared page element; changes may be refused.</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(() => api.transformImage(pageId, image.id, image.bbox, 90))} className="btn btn-secondary btn-sm flex-1" aria-label="Rotate picture left">
          Rotate left
        </button>
        <button type="button" disabled={busy} onClick={() => run(() => api.transformImage(pageId, image.id, image.bbox, -90))} className="btn btn-secondary btn-sm flex-1" aria-label="Rotate picture right">
          Rotate right
        </button>
      </div>
      <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="btn btn-secondary btn-sm w-full">
        Replace picture…
      </button>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Choose the replacement picture" onChange={(e) => replaceWith(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => run(() => api.deleteNativeImage(pageId, image.id))} className="btn btn-sm w-full bg-[var(--danger-soft)] text-[var(--danger)]" aria-label="Delete picture">
        <IconTrash className="h-4 w-4" /> Delete picture
      </button>
      <p className="text-xs text-[var(--ink-2)]">Drag to move, drag a corner to resize (Shift frees the proportions), or use the round handle to turn it.</p>
      {error && (
        <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--danger-soft)] p-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
