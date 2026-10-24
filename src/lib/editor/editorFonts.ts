/**
 * Web fonts for the live text box: the same bundled open fonts the engine writes with, so text typed on the page has the widths
 * it will have in the file (Liberation Sans = Arial, Liberation Serif = Times, Carlito = Calibri, Gelasio = Georgia, …).
 */
import { pickFamily, type FallbackFamily } from "@/lib/pdf-engine/fallback";

export const CSS_FAMILY: Record<FallbackFamily, string> = {
  sans: "TFC Sans",
  serif: "TFC Serif",
  mono: "TFC Mono",
  carlito: "TFC Carlito",
  gelasio: "TFC Gelasio",
  caladea: "TFC Caladea",
  dejavu: "TFC DejaVu",
};

/** Ascent and descent (em) of each family, to place the first baseline inside a line box. */
export const FONT_BOX: Record<FallbackFamily, { ascent: number; descent: number }> = {
  sans: { ascent: 0.905, descent: 0.212 },
  serif: { ascent: 0.891, descent: 0.216 },
  mono: { ascent: 0.833, descent: 0.3 },
  carlito: { ascent: 0.952, descent: 0.269 },
  gelasio: { ascent: 0.917, descent: 0.219 },
  caladea: { ascent: 0.9, descent: 0.25 },
  dejavu: { ascent: 0.928, descent: 0.236 },
};

export function familyFor(style: { fontClass: "sans" | "serif" | "mono"; family: string; bold: boolean; italic: boolean }, force?: FallbackFamily): FallbackFamily {
  return pickFamily({ fontClass: style.fontClass, family: style.family, bold: style.bold, italic: style.italic, forceFamily: force });
}

const loaded = new Map<string, Promise<void>>();

function loadFace(family: FallbackFamily, bold: boolean, italic: boolean): Promise<void> {
  const variant = bold ? (italic ? "bi" : "b") : italic ? "i" : "r";
  const key = `${family}-${variant}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      if (typeof document === "undefined" || !("fonts" in document)) return;
      const face = new FontFace(CSS_FAMILY[family], `url(/fonts/word/${key}.ttf)`, { weight: bold ? "700" : "400", style: italic ? "italic" : "normal" });
      try {
        document.fonts.add(await face.load());
      } catch {
        // the browser's own font stands in; widths are then approximate
      }
    })();
    loaded.set(key, p);
  }
  return p;
}

/** Loads the faces a block of text needs (its four styles of each family it uses). */
export async function ensureEditorFonts(styles: { fontClass: "sans" | "serif" | "mono"; family: string; bold: boolean; italic: boolean }[]): Promise<void> {
  const need = new Map<string, [FallbackFamily, boolean, boolean]>();
  for (const s of styles) {
    const f = familyFor(s);
    need.set(`${f}-${s.bold}-${s.italic}`, [f, s.bold, s.italic]);
  }
  await Promise.all([...need.values()].map(([f, b, i]) => loadFace(f, b, i)));
}
