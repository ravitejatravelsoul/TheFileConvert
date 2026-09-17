"use client";

import { useState } from "react";
import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { SelectField } from "@/components/tools/fields";
import { formatXml } from "@/lib/processors/data";

export function XmlFormatterWorkflow() {
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
        inputLabel="XML input"
        outputLabel="Formatted XML"
        inputPlaceholder="<root><item>value</item></root>"
        acceptFileExtension=".xml,application/xml,text/xml"
        actionLabel={mode === "pretty" ? "Format XML" : "Minify XML"}
        onProcess={(input) => formatXml(input, mode)}
        downloadName="formatted.xml"
        downloadMime="application/xml"
      />
    </div>
  );
}
