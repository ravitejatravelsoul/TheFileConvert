/**
 * Editing recognized (OCR) words is an experimental, off-by-default feature: it can only paint over a scan, never edit it.
 * Recognizing a scan's text (search, copy, accessibility) is always available.
 */
export const OCR_EDITING_ENABLED = process.env.NEXT_PUBLIC_TFC_OCR_EDITING === "1";
