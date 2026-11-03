import { Suspense, lazy } from "react";
import { MessageSquare, Globe, Key, Search } from "lucide-react";
import { UnipileConnectionCard } from "./UnipileConnectionCard";
import { EmailToolConnections } from "./EmailToolConnections";
import { GHLConnectionCard } from "./GHLConnectionCard";
import { WordPressIntegrationCard } from "./WordPressIntegrationCard";
import { TwitterIntegrationCard } from "./TwitterIntegrationCard";
import { NotionConnectionCard } from "./NotionConnectionCard";
import { ApiKeysSettings } from "./ApiKeysSettings";
// Lazy: pulls in sitemap-routes.ts -> full blog post bodies + playbooks
// (~7.4 MB) just to list URLs for the Google indexing tool. That content has
// no business in the shared entry bundle every route downloads.
const GoogleIndexingSettings = lazy(() =>
  import("./GoogleIndexingSettings").then((m) => ({ default: m.GoogleIndexingSettings })),
);

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  sectionId?: string;
}

function IntegrationSection({ icon, title, description, children, sectionId }: SectionProps) {
  return (
    <div className="space-y-4" data-section={sectionId}>
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

export function IntegrationsTab() {
  return (
    <div className="space-y-10">
      <IntegrationSection
        sectionId="byok"
        icon={<Key className="w-4 h-4" />}
        title="API Keys (BYOK)"
        description="Bring your own keys for AI models, scraping, and enrichment"
      >
        <ApiKeysSettings />
      </IntegrationSection>

      <IntegrationSection
        icon={<MessageSquare className="w-4 h-4" />}
        title="Outreach & Messaging"
        description="Accounts and tools for multi-channel campaigns"
      >
        <UnipileConnectionCard />
        <EmailToolConnections />
      </IntegrationSection>

      <IntegrationSection
        icon={<Globe className="w-4 h-4" />}
        title="Publishing"
        description="Connect platforms to publish and distribute content"
      >
        <GHLConnectionCard />
        <WordPressIntegrationCard />
        <TwitterIntegrationCard />
        <NotionConnectionCard />
      </IntegrationSection>

      <IntegrationSection
        icon={<Search className="w-4 h-4" />}
        title="SEO"
        description="Search engine indexing and visibility tools"
      >
        <Suspense fallback={null}>
          <GoogleIndexingSettings />
        </Suspense>
      </IntegrationSection>
    </div>
  );
}
