import { IconShield, IconCheck } from "@/components/icons";

const POINTS = [
  "Most tools process your file entirely on your device using your browser's built-in engine.",
  "Nothing is uploaded, logged, or stored on a server for local tools.",
  "We never track filenames or read your file contents for analytics.",
  "Any tool that would ever need a server is clearly labeled — never silently assumed.",
];

export function PrivacySection() {
  return (
    <section className="bg-[var(--surface)] py-16 sm:py-20">
      <div className="container-page grid gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-mint-soft)] text-[var(--accent-mint)]">
            <IconShield className="h-6 w-6" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
            Your files are yours.
          </h2>
          <p className="mt-3 max-w-md text-[var(--foreground-muted)]">
            Privacy isn&apos;t a feature we bolted on — it&apos;s the architecture. Local tools run
            using your browser&apos;s own JavaScript and WebAssembly, so your files never have to
            leave your device to get the job done.
          </p>
          <ul className="mt-6 space-y-3">
            {POINTS.map((point) => (
              <li key={point} className="flex gap-3 text-sm text-[var(--foreground-muted)]">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-mint)]" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <div className="card-surface relative overflow-hidden p-8">
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-[var(--accent-mint)]" />
            <span className="text-sm font-medium text-[var(--foreground)]">Your device</span>
          </div>
          <div className="my-3 ml-4 h-8 w-px bg-[var(--border)]" />
          <div className="flex items-center gap-3 rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <span className="h-2 w-2 rounded-full bg-[var(--foreground-muted)]" />
            <span className="text-sm font-medium text-[var(--foreground-muted)]">Our server — never contacted for local tools</span>
          </div>
          <p className="mt-6 text-xs text-[var(--foreground-muted)]">
            This is a real architectural diagram, not marketing copy — check any local tool&apos;s
            network tab and you&apos;ll see no file upload request.
          </p>
        </div>
      </div>
    </section>
  );
}
