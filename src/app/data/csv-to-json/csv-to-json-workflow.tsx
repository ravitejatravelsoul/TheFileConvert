"use client";

import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { csvToJson } from "@/lib/processors/data";

export function CsvToJsonWorkflow() {
  return (
    <TextWorkflow
      inputLabel="CSV input"
      outputLabel="JSON output"
      inputPlaceholder={"name,email\nAda,ada@example.com"}
      acceptFileExtension=".csv,text/csv"
      actionLabel="Convert to JSON"
      onProcess={csvToJson}
      downloadName="data.json"
      downloadMime="application/json"
    />
  );
}
