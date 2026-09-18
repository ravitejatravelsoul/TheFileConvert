import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://thefileconvert.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TheFileConvert — Every File. Any Format. Free.",
    template: "%s | TheFileConvert",
  },
  description:
    "Convert, compress, and work with your files without creating an account. Free file tools that run privately in your browser — no signup, no subscriptions.",
  keywords: [
    "file converter",
    "pdf tools",
    "image compressor",
    "convert files online",
    "free file converter",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "TheFileConvert",
    title: "TheFileConvert — Every File. Any Format. Free.",
    description:
      "Convert, compress, and work with your files without creating an account. Free, private, no signup.",
  },
  twitter: {
    card: "summary_large_image",
    title: "TheFileConvert — Every File. Any Format. Free.",
    description:
      "Convert, compress, and work with your files without creating an account. Free, private, no signup.",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below intentionally sets data-theme on the raw DOM node before
      // React hydrates, to pick the right theme with no flash of the wrong one on first
      // paint — React's server-rendered markup never has this attribute, so hydration would
      // otherwise always flag it as a mismatch even though the mismatch is expected and
      // correct (this is the standard no-flash dark-mode pattern; see e.g. next-themes,
      // which does the same thing for the same reason).
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
