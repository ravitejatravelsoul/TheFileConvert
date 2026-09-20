"use client";

import { useEffect, useState } from "react";
import { hasTransparency, type ImageOutputFormat } from "@/lib/processors/image";

/** What to output by default for a given input: keep its own kind, so a PNG isn't silently turned into a
 * JPG (which cannot hold transparency). `pngAs` lets size-focused tools prefer WebP for PNG photos. */
export function suggestFormat(file: File | undefined, pngAs: ImageOutputFormat = "png"): ImageOutputFormat {
  if (!file) return "jpeg";
  if (file.type === "image/png" || /\.png$/i.test(file.name)) return pngAs;
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) return "webp";
  return "jpeg";
}

/**
 * Output-format state for the image tools. Until the user picks something, it follows the first file
 * (PNG stays PNG, WebP stays WebP, JPG stays JPG). It also checks the selected files for transparency,
 * so a JPG output — which replaces transparent areas with white — is never chosen silently.
 */
export function useImageOutputFormat(files: File[], pngAs: ImageOutputFormat = "png") {
  const [chosen, setChosen] = useState<ImageOutputFormat | null>(null);
  const [transparentNames, setTransparentNames] = useState<string[]>([]);
  const format = chosen ?? suggestFormat(files[0], pngAs);

  const key = files.map((f) => `${f.name}:${f.size}`).join("|");
  useEffect(() => {
    let cancelled = false;
    Promise.all(files.map(async (f) => ((await hasTransparency(f)) ? f.name : null))).then((names) => {
      if (!cancelled) setTransparentNames(names.filter((n): n is string => n !== null));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { format, setFormat: (f: ImageOutputFormat) => setChosen(f), transparentNames };
}

/** Shown when the chosen output can't keep transparency but an input uses it. */
export function TransparencyNote({ format, transparentNames }: { format: ImageOutputFormat; transparentNames: string[] }) {
  if (format !== "jpeg" || transparentNames.length === 0) return null;
  const who = transparentNames.length === 1 ? transparentNames[0] : `${transparentNames.length} of these images`;
  return (
    <p role="note" className="rounded-[var(--radius-md)] bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--brand-strong)]">
      {who} {transparentNames.length === 1 ? "has" : "have"} transparent areas. JPG can&rsquo;t store transparency, so those areas will become white.
      Choose PNG or WebP to keep them transparent.
    </p>
  );
}
