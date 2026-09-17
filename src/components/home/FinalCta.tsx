import Link from "next/link";
import { IconUpload } from "@/components/icons";

export function FinalCta() {
  return (
    <section className="container-page pb-20 sm:pb-28">
      <div className="grain-fade relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] px-8 py-16 text-center sm:px-16">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
          Got a file? Get it done.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[var(--foreground-muted)]">
          No signup, no waiting, no catch — just drop your file and go.
        </p>
        <Link
          href="/tools"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[var(--button-bg)] px-7 py-3.5 text-base font-medium text-white shadow-[var(--shadow-soft)] transition-all hover:bg-[var(--button-bg-hover)] active:scale-[0.98]"
        >
          <IconUpload className="h-5 w-5" />
          Drop a file
        </Link>
      </div>
    </section>
  );
}
