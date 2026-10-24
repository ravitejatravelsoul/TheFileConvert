export interface OcrLanguageOption {
  code: string;
  label: string;
}

/** Languages we actually ship trained data for and have verified with real fixtures.
 * Do not add a language here until it has been tested — see docs/OCR.md. Kept in its own tiny module
 * so a page can list them without loading the OCR code. */
export const SUPPORTED_OCR_LANGUAGES: OcrLanguageOption[] = [
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
];
