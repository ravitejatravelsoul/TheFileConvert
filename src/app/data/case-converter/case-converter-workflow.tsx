"use client";

import { useState } from "react";
import { TextWorkflow } from "@/components/tools/TextWorkflow";
import { SelectField } from "@/components/tools/fields";
import { convertTextCase, type TextCase } from "@/lib/processors/data";

const OPTIONS: { value: TextCase; label: string }[] = [
  { value: "upper", label: "UPPERCASE" },
  { value: "lower", label: "lowercase" },
  { value: "title", label: "Title Case" },
  { value: "sentence", label: "Sentence case" },
  { value: "camel", label: "camelCase" },
  { value: "kebab", label: "kebab-case" },
  { value: "snake", label: "snake_case" },
];

export function CaseConverterWorkflow() {
  const [textCase, setTextCase] = useState<TextCase>("upper");

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <SelectField value={textCase} onChange={(v) => setTextCase(v as TextCase)} options={OPTIONS} />
      </div>
      <TextWorkflow
        inputLabel="Input text"
        outputLabel="Converted text"
        inputPlaceholder="Convert This Text"
        acceptFileExtension=".txt,text/plain"
        actionLabel="Convert case"
        onProcess={(input) => convertTextCase(input, textCase)}
        downloadName="converted.txt"
        monospace={false}
      />
    </div>
  );
}
