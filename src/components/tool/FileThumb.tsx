"use client";

import { useEffect, useRef } from "react";

/** An <img> showing a Blob. The object URL is created and revoked with the element, never during render. */
export function BlobImage({ blob, alt, className = "" }: { blob: Blob; alt: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const url = URL.createObjectURL(blob);
    img.src = url;
    return () => {
      img.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={alt} draggable={false} className={className} />;
}

/** A preview of an image file on a hatched tile. */
export function ImageThumb({ file, alt, className = "" }: { file: Blob; alt: string; className?: string }) {
  return (
    <div className={`hatch flex items-center justify-center overflow-hidden bg-[var(--surface-2)] ${className}`}>
      <BlobImage blob={file} alt={alt} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
