import type { ToolStatus, ProcessingMode } from "@/lib/tools/types";

export function StatusBadge({ status }: { status: ToolStatus }) {
  const config: Record<ToolStatus, { label: string; className: string }> = {
    available: {
      label: "Available",
      className: "bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]",
    },
    experimental: {
      label: "Experimental",
      className: "bg-[var(--brand-soft)] text-[var(--brand-strong)]",
    },
    "coming-soon": {
      label: "Coming soon",
      className: "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
    },
  };
  const { label, className } = config[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

export function ProcessingModeBadge({ mode }: { mode: ProcessingMode }) {
  const config: Record<ProcessingMode, { label: string; className: string }> = {
    local: {
      label: "Processed on your device",
      className: "bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]",
    },
    "server-assisted": {
      label: "Requires server processing",
      className: "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
    },
    unsupported: {
      label: "Not yet supported",
      className: "bg-[var(--surface-muted)] text-[var(--foreground-muted)]",
    },
  };
  const { label, className } = config[mode];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
      {mode === "local" && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5l-8-3Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {label}
    </span>
  );
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--foreground-muted)] ${className}`}
    >
      {children}
    </span>
  );
}
