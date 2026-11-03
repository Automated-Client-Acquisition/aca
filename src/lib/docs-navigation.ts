import {
  Rocket,
  Workflow,
  Sparkles,
  Users,
  Puzzle,
  Code,
  MessageSquare,
  Shield,
  Settings,
} from "lucide-react";
import type { ElementType } from "react";

export interface DocsNavItem {
  title: string;
  href: string;
  icon?: ElementType;
  items?: DocsNavItem[];
}

export const docsNavigation: DocsNavItem[] = [
  {
    title: "Getting Started",
    href: "/docs/getting-started",
    icon: Rocket,
    items: [
      { title: "Platform Overview", href: "/docs/getting-started" },
      { title: "Quick Start Guide", href: "/docs/getting-started/quick-start" },
    ],
  },
  {
    title: "Campaign Builder",
    href: "/docs/campaigns",
    icon: Workflow,
    items: [
      { title: "Overview", href: "/docs/campaigns" },
      { title: "Building Your First Sequence", href: "/docs/campaigns/first-sequence" },
      { title: "Node Types Reference", href: "/docs/campaigns/node-types" },
    ],
  },
  {
    title: "AI Content Studio",
    href: "/docs/content",
    icon: Sparkles,
    items: [
      { title: "Overview", href: "/docs/content" },
      { title: "Brand Voice Configuration", href: "/docs/content/brand-voices" },
    ],
  },
  {
    title: "Lead Management",
    href: "/docs/leads",
    icon: Users,
    items: [
      { title: "Overview", href: "/docs/leads" },
      { title: "Lead Import Guide", href: "/docs/leads/import" },
    ],
  },
  {
    title: "Integrations",
    href: "/docs/integrations",
    icon: Puzzle,
    items: [
      { title: "Overview", href: "/docs/integrations" },
      { title: "MCP Integration", href: "/docs/integrations/mcp" },
      { title: "Notion Integration", href: "/docs/integrations/notion" },
      { title: "Webhooks & n8n", href: "/docs/integrations/webhooks" },
    ],
  },
  {
    title: "API Reference",
    href: "/docs/api",
    icon: Code,
  },
  {
    title: "Unified Inbox",
    href: "/docs/inbox",
    icon: MessageSquare,
  },
  {
    title: "Account Management",
    href: "/docs/accounts",
    icon: Shield,
    items: [
      { title: "Overview", href: "/docs/accounts" },
      { title: "Connecting LinkedIn", href: "/docs/accounts/linkedin" },
    ],
  },
  {
    title: "Settings & Configuration",
    href: "/docs/settings",
    icon: Settings,
  },
];

/** Flatten navigation into an ordered list of all page links for prev/next navigation */
export function getFlatDocsPages(): { title: string; href: string }[] {
  const pages: { title: string; href: string }[] = [];
  for (const item of docsNavigation) {
    if (item.items) {
      for (const sub of item.items) {
        pages.push({ title: sub.title, href: sub.href });
      }
    } else {
      pages.push({ title: item.title, href: item.href });
    }
  }
  return pages;
}

/** Get prev and next pages relative to a given href */
export function getPrevNextPages(currentHref: string) {
  const pages = getFlatDocsPages();
  const idx = pages.findIndex((p) => p.href === currentHref);
  return {
    prev: idx > 0 ? pages[idx - 1] : undefined,
    next: idx < pages.length - 1 ? pages[idx + 1] : undefined,
  };
}
