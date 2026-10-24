import Link from "next/link";

export default function NotFound() {
  return (
    <div className="frame">
      <div className="container-x flex min-h-[60vh] flex-col items-start justify-center py-20">
        <p className="eyebrow">404</p>
        <h1 className="h1 mt-3">
          <span className="muted-display">This page</span>
          <br />
          isn&rsquo;t here.
        </h1>
        <p className="lead mt-5 max-w-md">The link may be old, or the tool may have moved. Everything that&rsquo;s available is on the tools page.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/tools" className="btn btn-primary btn-lg">
            Browse all tools
          </Link>
          <Link href="/" className="btn btn-secondary btn-lg">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
