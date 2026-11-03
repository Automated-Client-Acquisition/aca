export type BlogPageType =
  | "Pillar"
  | "Spoke"
  | "Comparison"
  | "Alternatives"
  | "UseCase"
  | "Glossary"
  | "Editorial"
  | "Programmatic";

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishDate: string;
  modifiedDate?: string;
  category: string;
  cluster?: string;
  pageType?: BlogPageType;
  author: string;
  authorRole: string;
  wordCount?: number;
  readTime: string;
  keywords: string[];
  featured: boolean;
  coverImage?: string;
  previewVariant?:
    | "compare"
    | "sequence"
    | "studio"
    | "pipeline"
    | "agency"
    | "chart"
    | "stackswap"
    | "ranked"
    | "inbox"
    | "workflow"
    | "booking"
    | "channels";
  content: string;
  tableOfContents: Array<{ id: string; title: string; level: 2 | 3 }>;
  relatedSlugs: string[];
  ctaText?: string;
  ctaHref?: string;
}
