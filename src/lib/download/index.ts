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

export function revokeAllObjectUrls(): void {
  for (const url of activeObjectUrls) {
    URL.revokeObjectURL(url);
  }
  activeObjectUrls.clear();
}

export async function downloadAllAsZip(zipName: string, results: DownloadableResult[]): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const result of results) {
    zip.file(result.name, result.blob);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipName, blob);
}
