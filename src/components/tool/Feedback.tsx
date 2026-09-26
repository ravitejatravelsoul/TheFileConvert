import { IconCheck, IconInfo, IconWarning } from "@/components/icons";

type Tone = "info" | "success" | "warning" | "danger";

const TONES: Record<Tone, { box: string; icon: React.ReactNode }> = {
  info: { box: "bg-[var(--surface-2)] text-[var(--ink)]", icon: <IconInfo className="h-[18px] w-[18px]" /> },
  success: { box: "bg-[var(--success-soft)] text-[var(--success)]", icon: <IconCheck className="h-[18px] w-[18px]" /> },
  warning: { box: "bg-[var(--warning-soft)] text-[var(--warning)]", icon: <IconWarning className="h-[18px] w-[18px]" /> },
  danger: { box: "bg-[var(--danger-soft)] text-[var(--danger)]", icon: <IconWarning className="h-[18px] w-[18px]" /> },
};

export function Alert({ tone = "info", title, children, role }: { tone?: Tone; title?: string; children?: React.ReactNode; role?: "alert" | "status" | "note" }) {
  const t = TONES[tone];
  return (
    <div role={role ?? (tone === "danger" ? "alert" : undefined)} className={`flex gap-3 rounded-[var(--radius-md)] px-4 py-3.5 text-[0.9375rem] leading-relaxed ${t.box}`}>
      <span className="mt-[3px] shrink-0">{t.icon}</span>
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5 text-[var(--ink-2)]" : "text-[var(--ink)]"}>{children}</div>}
      </div>
    </div>
  );
}

/** Busy state for a running job. `fraction` null = indeterminate. */
export function Working({ label, detail, fraction = null }: { label: string; detail?: string; fraction?: number | null }) {
  return (
    <div role="status" aria-live="polite" className="card flex flex-col gap-4 p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="spinner" aria-hidden="true" />
        <p className="text-lg font-semibold tracking-[-0.02em]">{label}</p>
      </div>
      <div className="progress-track" aria-hidden="true">
        {fraction === null ? (
          <div className="progress-bar progress-indeterminate" />
        ) : (
          <div className="progress-bar" style={{ width: `${Math.max(4, Math.round(fraction * 100))}%` }} />
        )}
      </div>
      {detail && <p className="text-sm text-[var(--ink-2)]">{detail}</p>}
    </div>
  );
}

export interface Stat {
  label: string;
  value: string;
  /** Exact byte count shown under the rounded value, for anyone who needs to check it. */
  exact?: string;
  tone?: "default" | "success" | "warning";
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4" style={{ gap: 1 }}>
      {stats.map((s) => (
        <div key={s.label} className="bg-[var(--surface)] px-4 py-4 sm:px-5">
          <dt className="text-[0.8125rem] font-medium text-[var(--ink-2)]">{s.label}</dt>
          <dd
            className={`tabular mt-1 text-xl font-semibold tracking-[-0.02em] sm:text-[1.4rem] ${
              s.tone === "success" ? "text-[var(--success)]" : s.tone === "warning" ? "text-[var(--warning)]" : "text-[var(--ink)]"
            }`}
          >
            {s.value}
          </dd>
          {s.exact && (
            <dd className="tabular mt-0.5 text-xs text-[var(--ink-2)]" data-testid="exact-bytes">
              {s.exact}
            </dd>
          )}
        </div>
      ))}
    </dl>
  );
}
