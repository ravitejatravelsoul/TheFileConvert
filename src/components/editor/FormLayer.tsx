"use client";

import { useEffect, useState } from "react";
import type { EditorPage, FormFieldValue, FormWidget } from "@/lib/editor/types";
import type { PageTransform } from "@/lib/editor/pageTransform";
import { CSS_FAMILY, ensureEditorFonts } from "@/lib/editor/editorFonts";
import { formMeasure } from "@/lib/editor/formApply";
import { layoutFormText, type FormFamily } from "@/lib/editor/formLayout";
import type { FallbackFamily } from "@/lib/pdf-engine/fallback";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";

interface Props {
  api: EditorWorkspaceApi;
  page: EditorPage;
  transform: PageTransform;
  fields: FormFieldValue[];
  interactive: boolean;
  /** The page picture on screen is the current one (its fields are drawn from their current values). */
  drawn: boolean;
}

const FAMILY_CSS: Record<FormFamily, FallbackFamily> = { sans: "sans", serif: "serif", mono: "mono" };
const css = (c: { r: number; g: number; b: number }) => `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`;

/**
 * The form of the PDF, filled right on the page.
 *
 * A field has one visible representation at a time:
 *  - untouched: the file's own appearance, drawn in the page picture; the box over it is invisible (only a hover ring);
 *  - being edited (or its picture not yet redrawn): the box is opaque and replaces the appearance exactly — same rectangle, same
 *    font, size, colour, alignment, padding and baseline as the appearance written on export (`layoutFormText`);
 *  - edited and drawn: the page picture shows the appearance written from the new value, and the box is invisible again.
 */
export function FormLayer({ api, page, transform: t, fields, interactive, drawn }: Props) {
  const [measure, setMeasure] = useState<((family: FormFamily, text: string, size: number) => number) | null>(null);
  useEffect(() => {
    let alive = true;
    void formMeasure().then((m) => alive && setMeasure(() => m));
    void ensureEditorFonts((["sans", "serif", "mono"] as const).map((fontClass) => ({ fontClass, family: "", bold: false, italic: false })));
    return () => {
      alive = false;
    };
  }, []);

  const items: { field: FormFieldValue; widget: FormWidget; key: string }[] = [];
  fields.forEach((field) =>
    field.widgets.forEach((widget, i) => {
      if (widget.sourceFileId === page.sourceFileId && widget.pageIndex === page.sourcePageIndex) items.push({ field, widget, key: `${field.name}#${i}` });
    })
  );
  if (!items.length) return null;

  return (
    <>
      {items.map(({ field, widget, key }) => {
        const pending = (field.value !== field.initial || Boolean(field.regen)) && !drawn;
        const disabled = !interactive || field.readOnly || Boolean(field.unsupported);
        if (field.kind === "text" || field.kind === "dropdown") return <TextLike key={key} api={api} field={field} widget={widget} transform={t} measure={measure} pending={pending} disabled={disabled} interactive={interactive} />;
        return <Toggle key={key} api={api} field={field} widget={widget} transform={t} pending={pending} disabled={disabled} interactive={interactive} />;
      })}
    </>
  );
}

/** Position and orientation of a widget on screen: the widget's own (unrotated) box, centred and turned with the page. */
function frameOf(widget: FormWidget, t: PageTransform) {
  const box = t.rectToCss(widget.rect);
  const w = widget.rect.width * t.scale;
  const h = widget.rect.height * t.scale;
  const angle = t.screenAngle(1, 0);
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, w, h, angle };
}

function TextLike({ api, field, widget, transform: t, measure, pending, disabled, interactive }: { api: EditorWorkspaceApi; field: FormFieldValue; widget: FormWidget; transform: PageTransform; measure: ((f: FormFamily, text: string, size: number) => number) | null; pending: boolean; disabled: boolean; interactive: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const value = draft ?? field.value;
  const st = widget.style;
  const family: FormFamily = st?.family ?? "sans";
  const bw = st?.borderWidth ?? 1;
  const f = frameOf(widget, t);
  const wPt = widget.rect.width;
  const hPt = widget.rect.height;
  const multiline = field.kind === "text" && Boolean(field.multiline);
  const lay = layoutFormText({
    width: wPt,
    height: hPt,
    value,
    multiline,
    fontSize: st?.fontSize ?? 0,
    family,
    align: st?.align ?? 0,
    borderWidth: bw,
    measure: measure ? (text, size) => measure(family, text, size) : (text, size) => text.length * size * 0.5,
  });
  const S = t.scale;
  const opaque = editing || pending;
  const bg = st?.background ? css(st.background) : "#fff";
  const shown = opaque;
  const common: React.CSSProperties = {
    position: "absolute",
    left: f.cx,
    top: f.cy,
    width: f.w,
    height: f.h,
    transform: `translate(-50%, -50%) rotate(${f.angle}rad)`,
    boxSizing: "border-box",
    margin: 0,
    border: shown && bw > 0 ? `${bw * S}px solid ${st?.borderColor ? css(st.borderColor) : "transparent"}` : `${bw * S}px solid transparent`,
    background: shown ? bg : "transparent",
    color: shown ? css(st?.color ?? { r: 0, g: 0, b: 0 }) : "transparent",
    caretColor: css(st?.color ?? { r: 0, g: 0, b: 0 }),
    fontFamily: `"${CSS_FAMILY[FAMILY_CSS[family]]}", ${family === "serif" ? "serif" : family === "mono" ? "monospace" : "sans-serif"}`,
    fontSize: lay.fontSize * S,
    lineHeight: multiline ? `${lay.lineHeight * S}px` : `${f.h - 2 * bw * S}px`,
    textAlign: st?.align === 1 ? "center" : st?.align === 2 ? "right" : "left",
    padding: multiline ? `${(lay.padding - bw) * S}px` : `0 ${(lay.padding - bw) * S}px`,
    outline: "none",
    resize: "none",
    overflow: "hidden",
    whiteSpace: multiline ? "pre-wrap" : "pre",
    pointerEvents: interactive ? "auto" : "none",
  };
  const ring = interactive && !disabled ? "hover:ring-1 hover:ring-[var(--select)]/60 focus:ring-2 focus:ring-[var(--select)]" : "";
  const commit = () => {
    if (draft !== null && draft !== field.value) api.setFormFieldValue(field.name, draft);
    api.breakCoalescing();
    setDraft(null);
  };
  const common2 = {
    "data-testid": "form-field",
    "data-field-name": field.name,
    "data-state": editing ? "editing" : pending ? "pending" : "idle",
    "aria-label": `Form field ${field.name}${field.unsupported ? ` (${field.unsupported}: can't be edited here)` : ""}`,
    title: field.unsupported ? `This ${field.unsupported} can't be edited here.` : undefined,
    disabled,
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    className: ring,
    style: common,
  };

  if (field.kind === "dropdown") {
    return (
      <select
        {...common2}
        value={field.value}
        onChange={(e) => {
          api.setFormFieldValue(field.name, e.target.value);
          api.breakCoalescing();
        }}
        style={{ ...common, appearance: opaque ? "auto" : "none", paddingRight: 0 }}
      >
        <option value="">{""}</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (multiline) {
    return (
      <textarea
        {...common2}
        value={value}
        maxLength={field.maxLength && field.maxLength > 0 ? field.maxLength : undefined}
        onFocus={() => setDraft(field.value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    );
  }
  return (
    <input
      {...common2}
      type="text"
      value={value}
      maxLength={field.maxLength && field.maxLength > 0 ? field.maxLength : undefined}
      onFocus={() => setDraft(field.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function Toggle({ api, field, widget, transform: t, pending, disabled, interactive }: { api: EditorWorkspaceApi; field: FormFieldValue; widget: FormWidget; transform: PageTransform; pending: boolean; disabled: boolean; interactive: boolean }) {
  const f = frameOf(widget, t);
  const radio = field.kind === "radio";
  const mine = widget.onValue ?? "";
  const on = radio ? field.value === mine : field.value === "true";
  const ring = interactive && !disabled ? "hover:ring-1 hover:ring-[var(--select)]/60 focus-visible:ring-2 focus-visible:ring-[var(--select)]" : "";
  return (
    <button
      type="button"
      role={radio ? "radio" : "checkbox"}
      aria-checked={on}
      aria-label={radio ? `Form field ${field.name}: ${mine}` : `Form field ${field.name}`}
      data-testid="form-field"
      data-field-name={field.name}
      data-option={radio ? mine : undefined}
      data-state={pending ? "pending" : "idle"}
      disabled={disabled}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        api.setFormFieldValue(field.name, radio ? mine : on ? "false" : "true");
        api.breakCoalescing();
      }}
      className={`${ring} flex items-center justify-center`}
      style={{
        position: "absolute",
        left: f.cx,
        top: f.cy,
        width: f.w,
        height: f.h,
        transform: `translate(-50%, -50%) rotate(${f.angle}rad)`,
        background: pending ? "#fff" : "transparent",
        border: 0,
        padding: 0,
        borderRadius: radio ? "50%" : 0,
        pointerEvents: interactive ? "auto" : "none",
        fontSize: Math.min(f.w, f.h) * 0.9,
        lineHeight: 1,
      }}
    >
      {pending && on ? (radio ? <span className="block rounded-full bg-black" style={{ width: f.w * 0.45, height: f.h * 0.45 }} /> : "✓") : null}
    </button>
  );
}
