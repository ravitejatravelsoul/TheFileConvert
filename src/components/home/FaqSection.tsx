const FAQS = [
  {
    question: "Is TheFileConvert really free?",
    answer:
      "Yes. Every tool marked \"Available\" is free to use, with no signup, no watermarks, and no artificial limits on how many times you can use it.",
  },
  {
    question: "Do you store or see my files?",
    answer:
      "For tools marked \"Processed on your device,\" no — your file is handled entirely by your browser and never sent anywhere. Check any local tool's network tab to confirm.",
  },
  {
    question: "Do I need to create an account?",
    answer: "No. There's no login, no email requirement, and no account of any kind.",
  },
  {
    question: "Why do some tools say \"Coming soon\"?",
    answer:
      "A few conversions (like DOCX editing or video transcoding) need more processing power than a browser can reliably provide for free. Rather than fake it, we list them honestly until we can support them properly.",
  },
  {
    question: "What file size can I upload?",
    answer:
      "Most tools handle files well into the hundreds of megabytes, since everything runs in your browser's memory. Very large files depend on your device's available memory.",
  },
];

export function FaqSection() {
  return (
    <section className="container-page py-16 sm:py-20">
      <h2 className="text-2xl font-semibold tracking-tight text-[var(--foreground)] sm:text-3xl">
        Frequently asked questions
      </h2>
      <div className="mt-8 divide-y divide-[var(--border)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        {FAQS.map((faq) => (
          <details key={faq.question} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-[var(--foreground)]">
              {faq.question}
              <span className="ml-4 shrink-0 text-xl text-[var(--foreground-muted)] transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm text-[var(--foreground-muted)]">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
