import type { ToolDefinition } from "./types";

const IMAGE_EXT = ["jpg", "jpeg", "png", "webp"];
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];

export const imageTools: ToolDefinition[] = [
  {
    id: "image-compress",
    slug: "compress",
    href: "/image/compress",
    name: "Compress Image",
    description: "Shrink JPG, PNG, or WebP file size with an adjustable quality slider.",
    category: "image",
    acceptedExtensions: IMAGE_EXT,
    acceptedMimeTypes: IMAGE_MIME,
    outputExtensions: ["jpg", "png", "webp"],
    processingMode: "local",
    status: "available",
    supportsMultiple: true,
    maxRecommendedSizeMb: 60,
    keywords: ["compress image", "reduce image size", "image compressor"],
    workflow: "file",
    relatedToolIds: ["image-resize", "image-metadata-remove"],
  },
  {
    id: "image-resize",
    slug: "resize",
    href: "/image/resize",
    name: "Resize Image",
    description: "Change an image's pixel dimensions, with an option to lock the aspect ratio.",
    category: "image",
    acceptedExtensions: IMAGE_EXT,
    acceptedMimeTypes: IMAGE_MIME,
    outputExtensions: ["jpg", "png", "webp"],
    processingMode: "local",
    status: "available",
    supportsMultiple: true,
    maxRecommendedSizeMb: 60,
    keywords: ["resize image", "change image dimensions", "image resizer"],
    workflow: "file",
    relatedToolIds: ["image-crop", "image-compress"],
  },
  {
    id: "image-crop",
    slug: "crop",
    href: "/image/crop",
    name: "Crop Image",
    description: "Drag on the picture to choose the area to keep, and get exactly that region as a new image.",
    category: "image",
    acceptedExtensions: IMAGE_EXT,
    acceptedMimeTypes: IMAGE_MIME,
    outputExtensions: ["jpg", "png", "webp"],
    processingMode: "local",
    status: "available",
    supportsMultiple: false,
    maxRecommendedSizeMb: 60,
    keywords: ["crop image", "image cropper"],
    workflow: "file",
    relatedToolIds: ["image-resize", "image-rotate"],
  },
  {
    id: "image-rotate",
    slug: "rotate",
    href: "/image/rotate",
    name: "Rotate & Flip Image",
    description: "Rotate an image in 90-degree steps, or flip it horizontally or vertically.",
    category: "image",
    acceptedExtensions: IMAGE_EXT,
    acceptedMimeTypes: IMAGE_MIME,
    outputExtensions: ["jpg", "png", "webp"],
    processingMode: "local",
    status: "available",
    supportsMultiple: true,
    maxRecommendedSizeMb: 60,
    keywords: ["rotate image", "flip image", "image rotator"],
    workflow: "file",
    relatedToolIds: ["image-crop", "image-compress"],
  },
  {
    id: "image-metadata-remove",
    slug: "remove-metadata",
    href: "/image/remove-metadata",
    name: "Remove Image Metadata",
    description: "Strip EXIF and other embedded metadata (like GPS location) from a photo.",
    category: "image",
    acceptedExtensions: IMAGE_EXT,
    acceptedMimeTypes: IMAGE_MIME,
    outputExtensions: ["jpg", "png", "webp"],
    processingMode: "local",
    status: "available",
    supportsMultiple: true,
    maxRecommendedSizeMb: 60,
    keywords: ["remove exif", "strip photo metadata", "remove gps from photo"],
    workflow: "file",
    relatedToolIds: ["image-compress", "image-resize"],
  },
  {
    id: "svg-to-png",
    slug: "svg-to-png",
    href: "/image/svg-to-png",
    name: "SVG to PNG",
    description: "Rasterize an SVG vector graphic into a PNG image.",
    longDescription:
      "This runs entirely in your browser and handles common SVG markup well. Very complex SVGs using filters, external fonts, or embedded scripts may not render exactly as intended, so we mark this tool as experimental.",
    category: "image",
    acceptedExtensions: ["svg"],
    acceptedMimeTypes: ["image/svg+xml"],
    outputExtensions: ["png"],
    processingMode: "local",
    status: "experimental",
    supportsMultiple: false,
    maxRecommendedSizeMb: 15,
    keywords: ["svg to png", "convert svg", "vector to image"],
    workflow: "file",
    relatedToolIds: ["image-compress"],
  },
];

interface ImagePair {
  from: "jpg" | "png" | "webp";
  to: "jpg" | "png" | "webp";
}

const CONVERT_PAIRS: ImagePair[] = [
  { from: "jpg", to: "png" },
  { from: "png", to: "jpg" },
  { from: "jpg", to: "webp" },
  { from: "webp", to: "jpg" },
  { from: "png", to: "webp" },
  { from: "webp", to: "png" },
];

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXT_ALIASES: Record<string, string[]> = {
  jpg: ["jpg", "jpeg"],
};

export const imageConvertTools: ToolDefinition[] = CONVERT_PAIRS.map(({ from, to }) => {
  const fromExts = EXT_ALIASES[from] ?? [from];
  return {
    id: `${from}-to-${to}`,
    slug: `${from}-to-${to}`,
    href: `/convert/${from}-to-${to}`,
    name: `${from.toUpperCase()} to ${to.toUpperCase()}`,
    description: `Convert ${from.toUpperCase()} images to ${to.toUpperCase()} format, right in your browser.`,
    category: "image" as const,
    acceptedExtensions: fromExts,
    acceptedMimeTypes: [MIME_BY_EXT[from]],
    outputExtensions: [to],
    processingMode: "local" as const,
    status: "available" as const,
    supportsMultiple: true,
    maxRecommendedSizeMb: 60,
    keywords: [`${from} to ${to}`, `convert ${from} to ${to}`, `${from} ${to} converter`],
    workflow: "file" as const,
    relatedToolIds: ["image-compress", "image-resize"],
  };
});
