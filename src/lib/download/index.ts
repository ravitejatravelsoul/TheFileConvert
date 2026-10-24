export interface DownloadableResult {
  name: string;
  blob: Blob;
}

const activeObjectUrls = new Set<string>();

export function triggerDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  activeObjectUrls.add(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a beat to start the download before revoking.
  window.setTimeout(() => revokeObjectUrl(url), 4000);
}

export function revokeObjectUrl(url: string): void {
  if (activeObjectUrls.has(url)) {
    URL.revokeObjectURL(url);
    activeObjectUrls.delete(url);
  }
}


/** Makes names unique ("page.png", "page (2).png") so no entry silently overwrites another in a ZIP. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
  });
}

export async function downloadAllAsZip(zipName: string, results: DownloadableResult[]): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const names = uniqueNames(results.map((r) => r.name));
  results.forEach((result, i) => zip.file(names[i], result.blob));
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipName, blob);
}
