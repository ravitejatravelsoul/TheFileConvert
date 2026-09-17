import { IconUpload, IconSparkle, IconBolt, IconDownload } from "@/components/icons";

const STEPS = [
  { icon: IconUpload, title: "Upload", description: "Drop a file or choose one from your device." },
  { icon: IconSparkle, title: "Choose", description: "We detect the file type and show you what's possible." },
  { icon: IconBolt, title: "Process", description: "Your file is converted instantly, right in your browser." },
  { icon: IconDownload, title: "Download", description: "Grab your result. No waiting, no email required." },
];

export function HowItWorks() {
  return (
    <section className="container-page py-16 sm:py-20">
      <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">How it works</h2>
      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <div key={step.title} className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
              <step.icon className="h-5 w-5" />
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
              0{i + 1}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--foreground)]">{step.title}</p>
            <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">{step.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
