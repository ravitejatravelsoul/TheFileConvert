/** Long-form text page (privacy, terms): editorial title, a readable column, hairline-ruled sections. */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: React.ReactNode }[] }) {
  return (
    <div className="frame">
      <div className="container-x py-12 sm:py-20">
        <div className="mx-auto max-w-2xl">
          <h1 className="h1">{title}</h1>
          <p className="mt-4 text-sm text-[var(--ink-2)]">Last updated {updated}</p>
          <div className="mt-12 space-y-10">
            {sections.map((s) => (
              <section key={s.heading} className="border-t border-[var(--line)] pt-6">
                <h2 className="h3">{s.heading}</h2>
                <div className="mt-3 space-y-3 text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
