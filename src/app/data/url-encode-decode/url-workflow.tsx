"use client";

import { useState } from "react";
import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { SelectField } from "@/components/tools/fields";
import { urlEncode, urlDecode } from "@/lib/processors/data";

export function UrlWorkflow() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField
          value={mode}
          onChange={(v) => setMode(v as "encode" | "decode")}
          options={[
            { value: "encode", label: "URL encode" },
            { value: "decode", label: "URL decode" },
          ]}
        />
      </div>
      <TextWorkflow
        key={mode}
        inputLabel={mode === "encode" ? "Plain text" : "Encoded text"}
        outputLabel={mode === "encode" ? "Encoded output" : "Decoded output"}
        inputPlaceholder={mode === "encode" ? "hello world/?" : "hello%20world%2F%3F"}
        acceptFileExtension=".txt,text/plain"
        actionLabel={mode === "encode" ? "Encode" : "Decode"}
        onProcess={(input) => (mode === "encode" ? urlEncode(input) : urlDecode(input))}
        downloadName={mode === "encode" ? "encoded.txt" : "decoded.txt"}
        monospace
      />
    </div>
  );
}
