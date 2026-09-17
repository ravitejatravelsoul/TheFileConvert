import type { Metadata } from "next";
import Link from "next/link";
import { IconShield, IconBolt, IconCheck } from "@/components/icons";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "About",
  description: "Why TheFileConvert exists: simple, private, free file tools with no accounts and no subscriptions.",
  path: "/about",
});

export default function Page() {
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">About TheFileConvert</h1>
        <p className="mt-5 text-lg text-[var(--foreground-muted)]">
          TheFileConvert exists because everyday file tasks — merging a PDF, shrinking a photo,
          reformatting some data — shouldn&apos;t require an account, a subscription, or handing
          your files over to a stranger&apos;s server.
        </p>
        <p className="mt-4 text-[var(--foreground-muted)]">
          Most of the tools here run entirely in your browser, using the same JavaScript and
          Web APIs that power the rest of the modern web. There&apos;s no backend processing your
          documents, no database storing your uploads, and no reason to ask for your email address.
        </p>
        <p className="mt-4 text-[var(--foreground-muted)]">
          We&apos;d rather ship fewer tools that genuinely work than a long list of features that
          quietly fail. Every tool on this site is labeled honestly — available, experimental, or
          coming soon — so what you see is what actually works. You can check the full{" "}
          <Link href="/tools/status" className="font-medium text-[var(--brand)] hover:underline">
            tool status directory
          </Link>{" "}
          at any time.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="card-surface p-5">
            <IconShield className="h-5 w-5 text-[var(--accent-mint)]" />
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">Privacy first</p>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">Local tools never upload your files.</p>
          </div>
          <div className="card-surface p-5">
            <IconBolt className="h-5 w-5 text-[var(--brand)]" />
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">No friction</p>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">No accounts, no waiting rooms.</p>
          </div>
          <div className="card-surface p-5">
            <IconCheck className="h-5 w-5 text-[var(--brand)]" />
            <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">Honest labeling</p>
            <p className="mt-1 text-sm text-[var(--foreground-muted)]">We never advertise what isn&apos;t built.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
