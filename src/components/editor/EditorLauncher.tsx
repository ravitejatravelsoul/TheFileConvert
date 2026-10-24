"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { Dropzone } from "@/components/tool/Dropzone";
import { Alert, Working } from "@/components/tool/Feedback";
import { useFileIntake } from "@/components/tool/useFileIntake";
import { getTool } from "@/lib/tools/registry";

const tool = getTool("pdf-editor");

// The editor (pdf.js, pdf-lib, OCR, canvas tools) is only downloaded once there is a PDF to edit.
const EditorWorkspace = dynamic(() => import("./EditorWorkspace"), {
  ssr: false,
  loading: () => (
    <div className="mx-auto max-w-3xl">
      <Working label="Loading the editor…" />
    </div>
  ),
});

export function EditorLauncher() {
  const [file, setFile] = useState<File | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const { intake, rejections } = useFileIntake(tool, (files) => {
    setOpenError(null);
    setFile(files[0]);
  });
  const onExit = useCallback((error?: string) => {
    setFile(null);
    setOpenError(error ?? null);
  }, []);

  if (file) return <EditorWorkspace file={file} onExit={onExit} />;

  return (
    <div className="space-y-4">
      <Dropzone accept={tool.accept} onFiles={intake} title="Drop the PDF you want to edit" buttonLabel="Choose PDF" hint="Opens right here — nothing is uploaded" />
      {openError && <Alert tone="danger">{openError}</Alert>}
      {rejections.map((r) => (
        <Alert key={r} tone="danger">
          {r}
        </Alert>
      ))}
    </div>
  );
}
