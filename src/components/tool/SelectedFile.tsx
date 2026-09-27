import { IconImage, IconPdf } from "@/components/icons";
import { formatSize } from "@/lib/size";
import { isOverRecommendedSize, type ToolInputRules } from "@/lib/security/validators";

/** The file a single-file tool is working on, with a way to swap it. */
export function SelectedFile({ file, meta, onChange, disabled, rules }: { file: File; meta?: string; onChange?: () => void; disabled?: boolean; rules?: ToolInputRules }) {
  const large = rules ? isOverRecommendedSize(file, rules) : false;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  return (
    <div className="card flex items-center gap-4 p-4 sm:p-5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--surface-2)] text-[var(--ink)]">
        {isPdf ? <IconPdf className="h-6 w-6" /> : <IconImage className="h-6 w-6" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold tracking-[-0.01em]" title={file.name}>
          {file.name}
        </p>
        <p className="tabular mt-0.5 text-sm text-[var(--ink-2)]" data-testid="original-size">
          {formatSize(file.size)}
          {meta ? ` · ${meta}` : ""}
        </p>
        {large && <p className="mt-1 text-sm text-[var(--warning)]">Large file — this may take a minute on this device.</p>}
      </div>
      {onChange && (
        <button type="button" onClick={onChange} disabled={disabled} className="btn btn-ghost btn-sm shrink-0">
          Change file
        </button>
      )}
    </div>
  );
}
