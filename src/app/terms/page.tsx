import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Terms of Use",
  description: "Basic terms for using TheFileConvert's free file tools.",
  path: "/terms",
});

export default function Page() {
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">Terms of Use</h1>
        <p className="mt-4 text-sm text-[var(--foreground-muted)]">Last updated: 2026</p>

        <div className="mt-8 space-y-8 text-[var(--foreground-muted)]">
          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Using this site</h2>
            <p className="mt-2">
              TheFileConvert provides free file conversion and utility tools on an &ldquo;as is&rdquo;
              basis, with no account required. You&apos;re responsible for the files you process and
              for having the rights to process them.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">No warranty</h2>
            <p className="mt-2">
              We do our best to keep every tool marked &ldquo;Available&rdquo; working correctly, and
              we test them before launch. That said, tools are provided without warranty of any
              kind, and you should keep a backup of any important file before converting it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Acceptable use</h2>
            <p className="mt-2">
              Don&apos;t use this site to process content you don&apos;t have the right to use, or to
              attempt to abuse, disrupt, or reverse-engineer the service in a way that harms other
              users.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Changes</h2>
            <p className="mt-2">
              We may update these terms as the site evolves. Material changes will be reflected on
              this page with an updated revision date.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Limitation of liability</h2>
            <p className="mt-2">
              To the fullest extent permitted by law, TheFileConvert is not liable for any loss or
              damage arising from the use of, or inability to use, this site or its tools.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
