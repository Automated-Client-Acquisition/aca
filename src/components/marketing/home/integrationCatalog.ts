export type IntegrationCategory =
  | "outreach"
  | "ai"
  | "data"
  | "publishing"
  | "email"
  | "storage";

export const integrationCategories = [
  {
    id: "outreach",
    label: "Outreach",
    description: "Reach buyers through email and social accounts.",
  },
  {
    id: "ai",
    label: "AI & content",
    description: "Create with your preferred models and providers.",
  },
  {
    id: "data",
    label: "Lead data",
    description: "Find, enrich and research your next buyers.",
  },
  {
    id: "publishing",
    label: "Publishing & CRM",
    description: "Bring content and contacts into your workspace.",
  },
  {
    id: "email",
    label: "Email & domains",
    description: "Connect your sending tools and infrastructure.",
  },
  {
    id: "storage",
    label: "Storage",
    description: "Keep your media in your own cloud storage.",
  },
] as const;

// Available connection options, not endorsements or per-organization health claims.
// Sources: settings/IntegrationsTab, AddApiKeyDialog, SendersSettings,
// EmailToolConnections, DnsProvidersSettings and StorageSettings.
export const integrationCatalog = [
  {
    name: "LinkedIn",
    category: "outreach",
    purpose: "Connections & messaging",
    featured: true,
  },
  {
    name: "Gmail",
    category: "outreach",
    purpose: "Email accounts",
    featured: true,
  },
  { name: "Outlook", category: "outreach", purpose: "Email accounts" },
  {
    name: "WhatsApp",
    category: "outreach",
    purpose: "Business conversations",
    featured: true,
  },
  {
    name: "Instagram",
    category: "outreach",
    purpose: "Direct messages",
    featured: true,
  },
  { name: "Telegram", category: "outreach", purpose: "Messaging accounts" },
  { name: "Messenger", category: "outreach", purpose: "Messaging accounts" },
  { name: "X", category: "outreach", purpose: "Messaging & publishing" },
  { name: "Unipile", category: "outreach", purpose: "Connected account API" },
  {
    name: "OpenRouter",
    category: "ai",
    purpose: "AI model gateway",
    featured: true,
  },
  {
    name: "OpenAI",
    category: "ai",
    purpose: "AI & image generation",
    featured: true,
  },
  { name: "Ollama", category: "ai", purpose: "Cloud or your own models" },
  { name: "Alibaba Cloud", category: "ai", purpose: "Qwen model access" },
  {
    name: "Replicate",
    category: "ai",
    purpose: "Images & video",
    featured: true,
  },
  {
    name: "ElevenLabs",
    category: "ai",
    purpose: "Voice generation",
    featured: true,
  },
  { name: "HeyGen", category: "ai", purpose: "AI avatar videos" },
  { name: "Pexels", category: "ai", purpose: "Stock video footage" },
  {
    name: "Apollo",
    category: "data",
    purpose: "Email & phone enrichment",
    featured: true,
  },
  {
    name: "Prospeo",
    category: "data",
    purpose: "Email finding & verification",
    featured: true,
  },
  { name: "Hunter", category: "data", purpose: "Work email finding" },
  { name: "QuickEnrich", category: "data", purpose: "Contact & company data" },
  {
    name: "MoltSets",
    category: "data",
    purpose: "LinkedIn identity resolution",
  },
  {
    name: "Apify",
    category: "data",
    purpose: "Web research & scraping",
    featured: true,
  },
  { name: "YouTube", category: "data", purpose: "Content & metadata" },
  {
    name: "GoHighLevel",
    category: "publishing",
    purpose: "CRM & social publishing",
    featured: true,
  },
  {
    name: "LeadConnector",
    category: "publishing",
    purpose: "Social publishing API",
  },
  {
    name: "WordPress",
    category: "publishing",
    purpose: "Blog publishing",
    featured: true,
  },
  {
    name: "Notion",
    category: "publishing",
    purpose: "Personalized pages",
    featured: true,
  },
  {
    name: "Google Indexing",
    category: "publishing",
    purpose: "Search indexing requests",
  },
  {
    name: "Smartlead",
    category: "email",
    purpose: "External email sequences",
    featured: true,
  },
  {
    name: "Instantly",
    category: "email",
    purpose: "External email campaigns",
    featured: true,
  },
  {
    name: "Success.ai",
    category: "email",
    purpose: "External email campaigns",
  },
  {
    name: "Microsoft 365",
    category: "email",
    purpose: "Tenants & sending mailboxes",
    featured: true,
  },
  {
    name: "ZapMail",
    category: "email",
    purpose: "Mailbox provisioning",
    featured: true,
  },
  {
    name: "Mailtester Ninja",
    category: "email",
    purpose: "Email verification",
  },
  { name: "Porkbun", category: "email", purpose: "Domains & DNS" },
  { name: "Cloudflare", category: "email", purpose: "Domain DNS management" },
  { name: "Amazon S3", category: "storage", purpose: "Media storage" },
  { name: "Cloudflare R2", category: "storage", purpose: "Media storage" },
  { name: "Backblaze B2", category: "storage", purpose: "Media storage" },
] as const satisfies readonly {
  name: string;
  category: IntegrationCategory;
  purpose: string;
  featured?: boolean;
}[];

export type IntegrationBrandName = (typeof integrationCatalog)[number]["name"];
