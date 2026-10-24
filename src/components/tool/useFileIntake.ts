"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { takePendingFiles } from "@/lib/file-handoff";
import { validateFileForTool, type ToolInputRules } from "@/lib/security/validators";

/**
 * Validates incoming files against a tool's rules and reports the rejects in plain words. Also
 * picks up files handed over from the homepage or another tool's "Continue with" step, once.
 */
export function useFileIntake(tool: ToolInputRules, onAccepted: (files: File[]) => void) {
  const [rejections, setRejections] = useState<string[]>([]);
  const onAcceptedRef = useRef(onAccepted);
  useEffect(() => {
    onAcceptedRef.current = onAccepted;
  });

  const intake = useCallback(
    async (files: File[]) => {
      const accepted: File[] = [];
      const errors: string[] = [];
      for (const file of files) {
        const result = await validateFileForTool(file, tool);
        if (result.valid) accepted.push(file);
        else if (result.error) errors.push(result.error);
      }
      setRejections(errors);
      if (accepted.length) onAcceptedRef.current(accepted);
    },
    [tool]
  );

  useEffect(() => {
    const handed = takePendingFiles();
    // Validation is asynchronous anyway; start it after this effect rather than inside it.
    if (handed.length) void Promise.resolve().then(() => intake(handed));
  }, [intake]);

  return { intake, rejections, clearRejections: () => setRejections([]) };
}
