"use client";

import { useState } from "react";
import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { SelectField } from "@/components/tools/fields";
import { base64Encode, base64Decode } from "@/lib/processors/data";

export function Base64Workflow() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          value={mode}
          onChange={(v) => setMode(v as "encode" | "decode")}
          options={[
            { value: "encode", label: "Encode to Base64" },
            { value: "decode", label: "Decode from Base64" },
          ]}
        />
      </div>
      <TextWorkflow
        key={mode}
        inputLabel={mode === "encode" ? "Plain text" : "Base64 text"}
        outputLabel={mode === "encode" ? "Base64 output" : "Decoded text"}
        inputPlaceholder={mode === "encode" ? "Hello, world!" : "SGVsbG8sIHdvcmxkIQ=="}
        acceptFileExtension=".txt,text/plain"
        actionLabel={mode === "encode" ? "Encode" : "Decode"}
        onProcess={(input) => (mode === "encode" ? base64Encode(input) : base64Decode(input))}
        downloadName={mode === "encode" ? "encoded.txt" : "decoded.txt"}
        monospace
      />
    </div>
  );
}
