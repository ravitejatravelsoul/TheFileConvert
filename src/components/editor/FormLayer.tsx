"use client";

import type { EditorPage, FormFieldValue, FormWidget } from "@/lib/editor/types";
import type { PageTransform } from "@/lib/editor/pageTransform";
import { rectToCssStyle } from "@/lib/editor/coordinates";
import type { EditorWorkspaceApi } from "./useEditorWorkspace";

interface Props {
  api: EditorWorkspaceApi;
  page: EditorPage;
  transform: PageTransform;
  fields: FormFieldValue[];
  interactive: boolean;
}

/**
 * The form of the PDF, filled right on the page: a text box / check box / radio button / list sits over each field's widget. A
 * field that has not been touched is left as the file draws it; once its value differs, the box is opaque so the new value
 * replaces the old drawing on screen (and on export, where the field's own appearance is regenerated).
 */
export function FormLayer({ api, page, transform: t, fields, interactive }: Props) {
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
        const css = t.rectToCss(widget.rect);
        const changed = field.value !== field.initial;
        const disabled = !interactive || field.readOnly;
        const common = `absolute ${interactive ? "" : "pointer-events-none"}`;
        const tint = interactive && !field.readOnly ? "ring-1 ring-[var(--select)]/50 hover:ring-2 focus-within:ring-2 focus-within:ring-[var(--select)]" : "";
        const fontPx = Math.max(8, Math.min(css.height * 0.72, 16 * (t.scale / 1.33)));
        const aria = `Form field ${field.name}`;
        const opaque = changed ? "bg-white" : "bg-[var(--select)]/5";

        if (field.kind === "text") {
          const Tag = field.multiline ? "textarea" : "input";
          return (
            <Tag
              key={key}
              data-testid="form-field"
              data-field-name={field.name}
              aria-label={aria}
              disabled={disabled}
              maxLength={field.maxLength && field.maxLength > 0 ? field.maxLength : undefined}
              value={field.value}
              onChange={(e) => api.setFormFieldValue(field.name, e.target.value)}
              onBlur={() => api.breakCoalescing()}
              onPointerDown={(e) => e.stopPropagation()}
              className={`${common} ${tint} ${opaque} px-1 outline-none`}
              style={{ ...rectToCssStyle(css), fontSize: fontPx, lineHeight: field.multiline ? 1.2 : `${css.height}px`, resize: "none" }}
            />
          );
        }
        if (field.kind === "checkbox") {
          const on = field.value === "true";
          return (
            <button
              key={key}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={aria}
              data-testid="form-field"
              data-field-name={field.name}
              disabled={disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                api.setFormFieldValue(field.name, on ? "false" : "true");
                api.breakCoalescing();
              }}
              className={`${common} ${tint} ${opaque} flex items-center justify-center`}
              style={{ ...rectToCssStyle(css), fontSize: Math.min(css.width, css.height) * 0.9, lineHeight: 1 }}
            >
              {changed ? (on ? "✓" : "") : ""}
            </button>
          );
        }
        if (field.kind === "radio") {
          const mine = widget.onValue ?? "";
          const selected = field.value === mine;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${aria}: ${mine}`}
              data-testid="form-field"
              data-field-name={field.name}
              data-option={mine}
              disabled={disabled}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                api.setFormFieldValue(field.name, mine);
                api.breakCoalescing();
              }}
              className={`${common} ${tint} ${changed ? "bg-white" : "bg-[var(--select)]/5"} flex items-center justify-center rounded-full`}
              style={rectToCssStyle(css)}
            >
              {changed && selected ? <span className="block rounded-full bg-black" style={{ width: css.width * 0.45, height: css.height * 0.45 }} /> : null}
            </button>
          );
        }
        // dropdown
        return (
          <select
            key={key}
            data-testid="form-field"
            data-field-name={field.name}
            aria-label={aria}
            disabled={disabled}
            value={field.value}
            onChange={(e) => {
              api.setFormFieldValue(field.name, e.target.value);
              api.breakCoalescing();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`${common} ${tint} ${opaque} px-1`}
            style={{ ...rectToCssStyle(css), fontSize: fontPx }}
          >
            <option value="">{field.value ? "" : ""}</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      })}
    </>
  );
}
