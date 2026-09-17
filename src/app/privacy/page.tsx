import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy Policy",
  description: "How TheFileConvert handles your files and data — matched exactly to how the site actually works.",
  path: "/privacy",
});

export default function Page() {
  return (
    <div className="container-page py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">Privacy Policy</h1>
        <p className="mt-4 text-sm text-[var(--foreground-muted)]">Last updated: 2026</p>

        <div className="mt-8 space-y-8 text-[var(--foreground-muted)]">
          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Local processing</h2>
            <p className="mt-2">
              Every tool labeled &ldquo;Processed on your device&rdquo; runs entirely in your web
              browser using JavaScript and standard browser APIs (such as Canvas, Web Crypto, and
              WebAssembly libraries loaded into your browser). Your files are never uploaded, never
              transmitted to our servers, and never seen by us. You can verify this yourself by
              opening your browser&apos;s network tab while using any local tool — you won&apos;t
              see a file upload request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">OCR (PDF text recognition)</h2>
            <p className="mt-2">
              The OCR PDF tool recognizes text using Tesseract.js, an open-source engine
              that runs as WebAssembly in your browser. The first time you use it, your
              browser downloads the recognition engine and a language model (a few
              megabytes) — these are static files served from thefileconvert.com itself,
              not a third party. Your PDF, the images rendered from it, and the text OCR
              recognizes are never uploaded; only those static engine/model files are
              fetched over the network.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Server-assisted tools</h2>
            <p className="mt-2">
              Some tools listed as &ldquo;Coming soon&rdquo; on our{" "}
              <a href="/tools/status" className="font-medium text-[var(--brand)] hover:underline">
                tool status directory
              </a>{" "}
              would require server-side processing to work reliably. These are not currently live.
              If and when we launch a server-assisted tool, this policy will be updated first, and
              the tool page will clearly disclose that your file is uploaded for processing.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">What we don&apos;t collect</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>We do not collect or store the files you process with local tools.</li>
              <li>We do not read, log, or analyze the contents of your files.</li>
              <li>We do not require an account, email address, or any personal information to use this site.</li>
              <li>We do not sell or share user data, because we do not collect any to begin with.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Analytics</h2>
            <p className="mt-2">
              If lightweight, privacy-respecting analytics are enabled in the future, they will be
              limited to anonymous, aggregate events like &ldquo;tool opened&rdquo; or
              &ldquo;conversion succeeded&rdquo; — never filenames, file contents, or anything that
              could identify you or your documents.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Cookies</h2>
            <p className="mt-2">
              TheFileConvert does not use tracking or advertising cookies. Your theme preference
              (light or dark) is stored locally in your browser&apos;s local storage and never
              leaves your device.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Third parties</h2>
            <p className="mt-2">
              This site is self-contained and does not embed third-party trackers, advertising
              networks, or file-processing APIs. Fonts are self-hosted rather than loaded from an
              external font provider.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Contact</h2>
            <p className="mt-2">
              Questions about this policy can be sent to the contact details listed on our GitHub
              repository or support channel, once published.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
