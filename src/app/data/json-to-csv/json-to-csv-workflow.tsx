"use client";

import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { jsonToCsv } from "@/lib/processors/data";

export function JsonToCsvWorkflow() {
  return (
    <TextWorkflow
      inputLabel="JSON input"
      outputLabel="CSV output"
      inputPlaceholder='[{"name":"Ada","email":"ada@example.com"}]'
      acceptFileExtension=".json,application/json"
      actionLabel="Convert to CSV"
      onProcess={jsonToCsv}
      downloadName="data.csv"
      downloadMime="text/csv"
    />
  );
}
