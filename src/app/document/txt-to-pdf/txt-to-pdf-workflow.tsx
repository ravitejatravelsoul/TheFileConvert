"use client";

import { TextToBlobWorkflow } from "@/components/tools/TextToBlobWorkflow";
import { replacedCharactersNote, textToPdf } from "@/lib/processors/text-documents";

export function TxtToPdfWorkflow() {
  return (
    <TextToBlobWorkflow
      inputPlaceholder="Paste or type plain text…"
      acceptFileExtension=".txt,text/plain"
      actionLabel="Convert to PDF"
      onProcess={async (input) => {
        const { blob, replacedCharacters } = await textToPdf(input, { fontSize: 12 });
        return { name: "document.pdf", blob, note: replacedCharactersNote(replacedCharacters) };
      }}
    />
  );
}
