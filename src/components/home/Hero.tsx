import { HeroDropzone } from "@/components/home/HeroDropzone";
import { IconShield, IconBolt, IconGlobe } from "@/components/icons";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-14 pb-20 sm:pt-20 sm:pb-28">
      <div aria-hidden className="grain-fade pointer-events-none absolute inset-0" />
      <div className="container-page relative">
        <div className="mx-auto max-w-3xl text-center">
          <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-xs font-medium text-[var(--foreground-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-mint)]" />
            Free &middot; Private &middot; No signup
          </div>

          <h1 className="animate-fade-up stagger-1 mt-6 text-balance text-5xl font-semibold tracking-tight text-[var(--foreground)] sm:text-6xl lg:text-7xl">
            Every file.
            <br />
            <span className="text-[var(--brand)]">Any format.</span>
          </h1>

          <p className="animate-fade-up stagger-2 mx-auto mt-6 max-w-xl text-balance text-lg text-[var(--foreground-muted)] sm:text-xl">
            Convert, compress, and work with your files without creating an account.
          </p>

          <div className="animate-fade-up stagger-3 mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-[var(--foreground-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <IconShield className="h-4 w-4 text-[var(--accent-mint)]" /> Files stay on your device
            </span>
            <span className="inline-flex items-center gap-1.5">
              <IconBolt className="h-4 w-4 text-[var(--brand)]" /> Instant processing
            </span>
            <span className="inline-flex items-center gap-1.5">
              <IconGlobe className="h-4 w-4 text-[var(--foreground-muted)]" /> Works everywhere
            </span>
          </div>
        </div>

        <div className="animate-fade-up stagger-4 mx-auto mt-12 max-w-2xl">
          <HeroDropzone />
        </div>
      </div>
    </section>
  );
}
