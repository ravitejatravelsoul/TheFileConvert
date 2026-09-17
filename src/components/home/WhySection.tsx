import { IconCheck, IconBolt, IconShield, IconGlobe } from "@/components/icons";

const REASONS = [
  { icon: IconCheck, title: "Free", description: "No subscriptions, no paywalls, no premium tier hiding the tools you need." },
  { icon: IconShield, title: "Private", description: "Your files stay on your device for every tool marked local processing." },
  { icon: IconBolt, title: "Fast", description: "No upload queue — most conversions finish in under a second." },
  { icon: IconGlobe, title: "Works everywhere", description: "Any modern browser, any device — nothing to install." },
];

export function WhySection() {
  return (
    <section className="container-page py-16 sm:py-20">
      <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
        Why TheFileConvert
      </h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {REASONS.map((reason) => (
          <div key={reason.title} className="card-surface p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
              <reason.icon className="h-5 w-5" />
            </div>
            <p className="mt-4 font-semibold text-[var(--foreground)]">{reason.title}</p>
            <p className="mt-1.5 text-sm text-[var(--foreground-muted)]">{reason.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
