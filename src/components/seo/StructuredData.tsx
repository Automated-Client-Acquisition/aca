import { Helmet } from "react-helmet-async";
import { PUBLIC_SITE_URL } from "@/config/site";

const SITE_URL = PUBLIC_SITE_URL;
const ORG_NAME = "ACA - Automated Client Acquisition";
const ORG_SAME_AS = ["https://twitter.com/ACAXtreme"];

const AUTHOR_PAGE = `${SITE_URL}/about/cedric-seguela`;
const AUTHOR_NAME = "Cedric Seguela";
const AUTHOR_SAME_AS = [
  "https://www.linkedin.com/in/cedricseguela/",
  "https://twitter.com/cedricseguela",
];

interface FAQItem {
  question: string;
  answer: string;
}

interface HowToStep {
  name: string;
  text: string;
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface ItemListEntry {
  name: string;
  url: string;
  description?: string;
}

type StructuredDataProps =
  | { type: "Organization" }
  | {
      type: "SoftwareApplication";
      name: string;
      description: string;
      price?: string;
    }
  | { type: "FAQPage"; faqs: FAQItem[] }
  | { type: "HowTo"; name: string; description: string; steps: HowToStep[] }
  | {
      type: "Article";
      headline: string;
      description: string;
      datePublished: string;
      dateModified?: string;
      author?: string;
      authorUrl?: string;
      authorSameAs?: string[];
      image?: string;
      url: string;
      wordCount?: number;
      articleSection?: string;
      keywords?: string[];
      speakable?: boolean;
    }
  | { type: "BreadcrumbList"; items: BreadcrumbItem[] }
  | { type: "Person"; name: string; jobTitle: string; description: string; image?: string; sameAs?: string[]; url: string }
  | { type: "ItemList"; name: string; description?: string; items: ItemListEntry[] };

function buildOrganization() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ORG_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
    sameAs: ORG_SAME_AS,
    description:
      "AI-powered client acquisition platform for agencies. Multi-channel outreach, AI content generation, white-label ready.",
  };
}

function buildSoftwareApplication(name: string, description: string, price = "0") {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price,
      priceCurrency: "USD",
    },
    provider: {
      "@type": "Organization",
      name: ORG_NAME,
      url: SITE_URL,
    },
  };
}

function buildFAQPage(faqs: FAQItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

function buildHowTo(name: string, description: string, steps: HowToStep[]) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    description,
    step: steps.map((step, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: step.name,
      text: step.text,
    })),
  };
}

function buildArticle(props: {
  headline: string;
  description: string;
  datePublished: string;
  dateModified?: string;
  author?: string;
  authorUrl?: string;
  authorSameAs?: string[];
  image?: string;
  url: string;
  wordCount?: number;
  articleSection?: string;
  keywords?: string[];
  speakable?: boolean;
}) {
  const author = {
    "@type": "Person",
    name: props.author ?? AUTHOR_NAME,
    url: props.authorUrl ?? AUTHOR_PAGE,
    sameAs: props.authorSameAs ?? AUTHOR_SAME_AS,
  };

  const image = props.image
    ? {
        "@type": "ImageObject",
        url: props.image.startsWith("http") ? props.image : `${SITE_URL}${props.image}`,
        width: 1200,
        height: 800,
      }
    : `${SITE_URL}/og-image-v2.png`;

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: props.headline,
    description: props.description,
    datePublished: props.datePublished,
    dateModified: props.dateModified ?? props.datePublished,
    author,
    publisher: {
      "@type": "Organization",
      name: ORG_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/logo.svg`,
      },
    },
    image,
    url: props.url,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": props.url,
    },
    inLanguage: "en-US",
  };

  if (props.wordCount) schema.wordCount = props.wordCount;
  if (props.articleSection) schema.articleSection = props.articleSection;
  if (props.keywords && props.keywords.length > 0) schema.keywords = props.keywords.join(", ");

  if (props.speakable !== false) {
    // Speakable Schema: tells Google Assistant + voice AI which selectors to read aloud.
    // Targets the lead paragraph and H2 headings (the LLM-extractable summary surface).
    schema.speakable = {
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", "p.lead", ".direct-answer", ".tldr"],
    };
  }

  return schema;
}

function buildBreadcrumbList(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

function buildPerson(props: { name: string; jobTitle: string; description: string; image?: string; sameAs?: string[]; url: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: props.name,
    jobTitle: props.jobTitle,
    description: props.description,
    url: props.url.startsWith("http") ? props.url : `${SITE_URL}${props.url}`,
    image: props.image ? (props.image.startsWith("http") ? props.image : `${SITE_URL}${props.image}`) : undefined,
    sameAs: props.sameAs,
    worksFor: {
      "@type": "Organization",
      name: ORG_NAME,
      url: SITE_URL,
    },
  };
}

function buildItemList(props: { name: string; description?: string; items: ItemListEntry[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: props.name,
    description: props.description,
    numberOfItems: props.items.length,
    itemListElement: props.items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: item.url.startsWith("http") ? item.url : `${SITE_URL}${item.url}`,
      ...(item.description ? { description: item.description } : {}),
    })),
  };
}

export function StructuredData(props: StructuredDataProps) {
  let schema: object;

  switch (props.type) {
    case "Organization":
      schema = buildOrganization();
      break;
    case "SoftwareApplication":
      schema = buildSoftwareApplication(props.name, props.description, props.price);
      break;
    case "FAQPage":
      schema = buildFAQPage(props.faqs);
      break;
    case "HowTo":
      schema = buildHowTo(props.name, props.description, props.steps);
      break;
    case "Article":
      schema = buildArticle(props);
      break;
    case "BreadcrumbList":
      schema = buildBreadcrumbList(props.items);
      break;
    case "Person":
      schema = buildPerson(props);
      break;
    case "ItemList":
      schema = buildItemList(props);
      break;
  }

  return (
    <Helmet>
      <script type="application/ld+json">{JSON.stringify(schema)}</script>
    </Helmet>
  );
}
