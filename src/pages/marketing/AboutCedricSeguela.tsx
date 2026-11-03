import { Link } from "react-router-dom";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Linkedin, Twitter, ArrowRight, ArrowLeft } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";
import { StructuredData } from "@/components/seo/StructuredData";
import "@/styles/marketing-continuity.css";

const SITE_URL = "https://www.automatedclientacquisition.com";

export default function AboutCedricSeguela() {
  const seoElement = useSEO({
    title: "Cedric Seguela - Founder, ACA",
    description:
      "Founder of ACA (Automated Client Acquisition). 10+ years building B2B SaaS, sales automation, and AI-powered client acquisition systems for agencies and founders.",
    canonical: `${SITE_URL}/about/cedric-seguela`,
    ogImage: `${SITE_URL}/og-image-v2.png`,
  });

  const url = `${SITE_URL}/about/cedric-seguela`;

  return (
    <div className="aca-marketing mkt-page mkt-profile min-h-screen">
      {seoElement}
      <StructuredData
        type="Person"
        name="Cedric Seguela"
        jobTitle="Founder, ACA (Automated Client Acquisition)"
        description="Founder of ACA. Builds AI-powered multi-channel client acquisition systems for agencies and B2B founders. 10+ years in B2B SaaS, sales automation, and content production at scale."
        url={url}
        sameAs={[
          "https://www.linkedin.com/in/cedricseguela/",
          "https://twitter.com/cedricseguela",
        ]}
      />
      <StructuredData
        type="BreadcrumbList"
        items={[
          { name: "Home", url: "/" },
          { name: "About", url: "/about" },
          { name: "Cedric Seguela", url: "/about/cedric-seguela" },
        ]}
      />

      <MarketingNav />

      <section className="container max-w-3xl py-16 md:py-20 space-y-10">
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/blog">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Blog
          </Link>
        </Button>

        <header className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Cedric Seguela</h1>
          <p className="text-xl text-muted-foreground">Founder, ACA (Automated Client Acquisition)</p>
          <div className="flex gap-3 pt-2">
            <Button asChild variant="outline" size="sm">
              <a href="https://www.linkedin.com/in/cedricseguela/" target="_blank" rel="noopener noreferrer">
                <Linkedin className="mr-2 h-4 w-4" />
                LinkedIn
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="https://twitter.com/cedricseguela" target="_blank" rel="noopener noreferrer">
                <Twitter className="mr-2 h-4 w-4" />
                Twitter
              </a>
            </Button>
          </div>
        </header>

        <div className="prose prose-lg dark:prose-invert max-w-none
          prose-headings:font-bold prose-headings:tracking-tight
          prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
          prose-p:leading-[1.8] prose-p:text-foreground/85
          prose-a:text-[hsl(var(--cta))] prose-a:no-underline hover:prose-a:underline">
          <p className="lead">
            I build B2B sales and client-acquisition software. ACA is the platform I wish existed when I was running an agency - multi-channel outreach, AI content production, and a unified inbox in one place, white-label for agencies that need it.
          </p>

          <h2>What I write about</h2>
          <p>
            Most of the writing on this blog comes from operating an AI agency in 2025-2026 - what works in cold email at scale, what breaks in LinkedIn automation, how to price agency services, and how AI agents are actually used in B2B (versus the noise on Twitter).
          </p>
          <p>
            I avoid invented stats and "in today's fast-paced landscape" filler. If a number is in a post, it's either from public data or from running real campaigns.
          </p>

          <h2>Background</h2>
          <p>
            10+ years in B2B SaaS and growth. Founded ACA after running a multi-channel outbound agency where I was paying $1,300/month per client to stitch 9 separate tools together. ACA consolidates that stack into one platform. Today it's used by agencies, founders, recruiters, and AI-agency builders across 5 continents.
          </p>

          <h2>How to reach me</h2>
          <p>
            The fastest way is the <a href="https://www.skool.com/aca-xtreme">Client Acquisition Commandos community on Skool</a> - I post daily, answer questions, and share what's working in client acquisition right now. LinkedIn DMs work too.
          </p>
        </div>

        <Card className="border-[hsl(var(--cta))]/20 bg-[hsl(var(--cta))]/5">
          <CardContent className="p-6 md:p-8 space-y-4">
            <h3 className="text-xl font-bold">Build your AI agency inside ACA</h3>
            <p className="text-muted-foreground">
              Join the Skool community + get the platform. The fastest way to ship client acquisition for agency clients in 2026.
            </p>
            <Button asChild size="lg" variant="cta">
              <a href="https://www.skool.com/aca-xtreme">
                Join Client Acquisition Commandos
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </section>

      <MarketingFooter />
    </div>
  );
}
