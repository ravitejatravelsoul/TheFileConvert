import type { Metadata } from "next";
import { LegalPage } from "@/components/layout/LegalPage";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description: "How TheFileConvert handles your files: everything is processed in your browser and nothing is uploaded.",
  path: "/privacy",
});

export default function Page() {
  return (
    <LegalPage
      title="Privacy"
      updated="September 2026"
      sections={[
        {
          heading: "Your files stay on your device",
          body: (
            <>
              <p>
                Every TheFileConvert tool — compression, conversion, merging, splitting, page organizing, the PDF editor and its OCR — runs inside your web
                browser. Your files are read and processed on your own device. They are never uploaded, never sent to our servers and never seen by us.
              </p>
              <p>
                You can check this yourself: open your browser&rsquo;s developer tools, switch to the Network tab and process a file. You&rsquo;ll see the page
                load its own code, but no request that carries your file.
              </p>
            </>
          ),
        },
        {
          heading: "Text recognition (OCR)",
          body: (
            <p>
              The PDF editor recognizes scanned text with Tesseract, an open-source engine that runs as WebAssembly in your browser. The first time you use
              it, your browser downloads the engine and a language model from thefileconvert.com itself. Only those static files travel over the network —
              your PDF, the page images made from it and the recognized text stay on your device.
            </p>
          ),
        },
        {
          heading: "What we don't collect",
          body: (
            <ul className="list-disc space-y-1.5 pl-5">
              <li>We don&rsquo;t collect, store, read or log the files you process.</li>
              <li>There are no accounts, so we never ask for an email address or any personal details.</li>
              <li>We don&rsquo;t sell or share user data — we don&rsquo;t hold any to begin with.</li>
            </ul>
          ),
        },
        {
          heading: "Cookies, storage and third parties",
          body: (
            <p>
              TheFileConvert sets no cookies and writes nothing to your browser&rsquo;s storage. Like any website, your browser may keep its usual cache of
              the site&rsquo;s own code and the OCR model so they load faster next time. The site embeds no third-party trackers, ad networks or
              file-processing services, and its fonts are served from our own domain.
            </p>
          ),
        },
        {
          heading: "Hosting",
          body: (
            <p>
              The site is served by a hosting provider that, like any web server, receives standard request information (such as IP address and browser
              type) when pages load. That information is about page requests — it never includes the files you work on.
            </p>
          ),
        },
        {
          heading: "Changes",
          body: <p>If anything here changes — for example a tool that would need a server — this page will be updated before that tool goes live, and the tool itself will say so clearly.</p>,
        },
      ]}
    />
  );
}
