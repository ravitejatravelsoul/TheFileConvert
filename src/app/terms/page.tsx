import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/LegalPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Terms of use",
  description: "The terms for using TheFileConvert's free, in-browser file tools.",
  path: "/terms",
});

export default function Page() {
  return (
    <LegalPage
      title="Terms of use"
      updated="September 2026"
      sections={[
        {
          heading: "Using this site",
          body: (
            <p>
              TheFileConvert provides free file tools on an &ldquo;as is&rdquo; basis, with no account required. You&rsquo;re responsible for the files you
              process and for having the right to process them.
            </p>
          ),
        },
        {
          heading: "No warranty",
          body: (
            <p>
              We test every tool before it goes live and do our best to keep them working correctly. Even so, tools are provided without warranty of any
              kind. Keep a copy of any important file before you change it — your original is never modified, but the output is yours to check.
            </p>
          ),
        },
        {
          heading: "Signatures and whiteout",
          body: (
            <p>
              Signatures added in the PDF editor are visual signatures — an image placed on the page — not cryptographic digital signatures. Whiteout
              visually covers content; it is not secure redaction, and the covered content remains in the file.
            </p>
          ),
        },
        {
          heading: "Acceptable use",
          body: <p>Don&rsquo;t use this site to process content you don&rsquo;t have the right to use, or to disrupt or abuse the service.</p>,
        },
        {
          heading: "Limitation of liability",
          body: <p>To the fullest extent permitted by law, TheFileConvert is not liable for any loss or damage arising from the use of, or inability to use, this site or its tools.</p>,
        },
        {
          heading: "Changes",
          body: <p>We may update these terms as the site evolves. Changes will appear on this page with a new date.</p>,
        },
      ]}
    />
  );
}
