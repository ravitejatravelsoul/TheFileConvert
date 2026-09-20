import type { Metadata } from "next";
import { Hero } from "@/components/home/Hero";
import { PopularTools } from "@/components/home/PopularTools";
import { CategoriesShowcase } from "@/components/home/CategoriesShowcase";
import { HowItWorks } from "@/components/home/HowItWorks";
import { PrivacySection } from "@/components/home/PrivacySection";
import { WhySection } from "@/components/home/WhySection";
import { FaqSection } from "@/components/home/FaqSection";
import { FinalCta } from "@/components/home/FinalCta";

// The homepage needs its own canonical: without one, the same page served from any other host name
// (a *.vercel.app alias, www) has nothing pointing search engines at the real domain.
export const metadata: Metadata = { alternates: { canonical: "/" } };

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "TheFileConvert",
  url: "https://thefileconvert.com",
  applicationCategory: "UtilitiesApplication",
  operatingSystem: "Any (runs in web browser)",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  description:
    "Free file conversion and compression tools that run privately in your browser. No signup, no subscriptions.",
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Hero />
      <PopularTools />
      <CategoriesShowcase />
      <HowItWorks />
      <PrivacySection />
      <WhySection />
      <FaqSection />
      <FinalCta />
    </>
  );
}
