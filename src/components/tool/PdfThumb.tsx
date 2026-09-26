"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

const docs = new WeakMap<File, Promise<PDFDocumentProxy>>();

/** One pdf.js document per File, shared by every thumbnail and the page counter. pdf.js itself is
 * only downloaded the first time a PDF is actually shown. */
export function pdfDocFor(file: File): Promise<PDFDocumentProxy> {
  let doc = docs.get(file);
  if (!doc) {
    doc = import("@/lib/processors/pdfjs-utils").then((m) => m.loadPdfJsDocument(file));
    docs.set(file, doc);
    doc.catch(() => docs.delete(file));
  }
  return doc;
}

// A small render queue so a 200-page document doesn't start 200 renders at once.
const MAX_PARALLEL = 3;
let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

interface PdfThumbProps {
  file: File;
  /** 0-based */
  pageIndex: number;
  /** Extra clockwise rotation to show, on top of the page's own. */
  rotation?: number;
  /** Rendered width in CSS px (the bitmap is drawn at 2× for sharp screens). */
  width?: number;
  alt: string;
  className?: string;
}

export function PdfThumb({ file, pageIndex, rotation = 0, width = 180, alt, className = "" }: PdfThumbProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [aspect, setAspect] = useState(1 / Math.SQRT2);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const doc = await pdfDocFor(file);
        const page = await doc.getPage(pageIndex + 1);
        const base = page.getViewport({ scale: 1 });
        if (!cancelled) setAspect(base.width / base.height);
        const blob = await withSlot(async () => {
          const { renderPageToCanvas } = await import("@/lib/processors/pdfjs-utils");
          const canvas = await renderPageToCanvas(doc, pageIndex + 1, (width * 2) / base.width);
          return new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
        });
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, file, pageIndex, width]);

  const turned = ((rotation % 360) + 360) % 360;
  const sideways = turned === 90 || turned === 270;
  const shownAspect = sideways ? 1 / aspect : aspect;

  return (
    <div
      ref={hostRef}
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ aspectRatio: String(Math.max(0.5, Math.min(2, shownAspect))) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full bg-white shadow-[0_0_0_1px_var(--line),var(--shadow-1)] transition-transform duration-300"
          style={{
            transform: `rotate(${turned}deg)`,
            // A sideways page must fit the box by its height.
            // Before rotating, its width becomes the shown height and vice versa.
            ...(sideways ? { maxWidth: `${100 / shownAspect}%`, maxHeight: `${100 * shownAspect}%` } : null),
          }}
        />
      ) : (
        <div role="img" aria-label={failed ? `${alt} (preview unavailable)` : alt} className={`h-full w-full rounded-[4px] bg-[var(--surface-2)] ${failed ? "" : "animate-pulse"}`} />
      )}
    </div>
  );
}
