export type ToolCategory =
  | "pdf"
  | "image"
  | "document"
  | "data"
  | "archive"
  | "media";

export type ProcessingMode = "local" | "server-assisted" | "unsupported";

export type ToolStatus = "available" | "experimental" | "coming-soon";

export interface ToolFaqItem {
  question: string;
  answer: string;
}

/**
 * Declarative description of a single tool. Route pages and homepage
 * discovery both read from this so the UI never has to hardcode facts
 * that would drift from what the processor actually supports.
 */
export interface ToolDefinition {
  id: string;
  slug: string;
  /** Route path, e.g. "/pdf/merge". Kept explicit since URL prefixes vary by tool family. */
  href: string;
  name: string;
  shortName?: string;
  description: string;
  longDescription?: string;
  category: ToolCategory;
  acceptedExtensions: string[];
  acceptedMimeTypes: string[];
  outputExtensions: string[];
  processingMode: ProcessingMode;
  status: ToolStatus;
  supportsMultiple: boolean;
  maxRecommendedSizeMb: number;
  keywords: string[];
  faq?: ToolFaqItem[];
  relatedToolIds?: string[];
  workflow: "file" | "text" | "generator";
}
