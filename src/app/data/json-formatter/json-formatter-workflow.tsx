"use client";

import { useState } from "react";
import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { SelectField } from "@/components/tools/fields";
import { formatJson } from "@/lib/processors/data";

export function JsonFormatterWorkflow() {
  const [mode, setMode] = useState<"pretty" | "minify">("pretty");

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          value={mode}
          onChange={(v) => setMode(v as "pretty" | "minify")}
          options={[
            { value: "pretty", label: "Pretty-print" },
            { value: "minify", label: "Minify" },
          ]}
        />
      </div>
      <TextWorkflow
        inputLabel="JSON input"
        outputLabel="Formatted JSON"
        inputPlaceholder='{"hello": "world"}'
        acceptFileExtension=".json,application/json"
        actionLabel={mode === "pretty" ? "Format JSON" : "Minify JSON"}
        onProcess={(input) => formatJson(input, mode)}
        downloadName="formatted.json"
        downloadMime="application/json"
      />
    </div>
  );
}
