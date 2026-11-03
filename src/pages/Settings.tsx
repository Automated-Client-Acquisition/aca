import { EmailSettings } from "@/components/settings/EmailSettings";
import { McpApiKeysSettings } from "@/components/settings/McpApiKeysSettings";
import { CliApiTokensSettings } from "@/components/settings/CliApiTokensSettings";
import { NetworkAccessSettings } from "@/components/settings/NetworkAccessSettings";
import { StorageSettings } from "@/components/settings/StorageSettings";
import { ModelSettings } from "@/components/settings/ModelSettings";
import { AIAgentsSettings } from "@/components/settings/AIAgentsSettings";
import { CalendarTab } from "@/components/settings/CalendarTab";
import { TeamSettings } from "@/components/settings/TeamSettings";
import { AccountSettings } from "@/components/settings/AccountSettings";
import { OrganizationSettings } from "@/components/settings/OrganizationSettings";
import { BrandingSettings } from "@/components/settings/BrandingSettings";
import { IdeaTagsSettings } from "@/components/settings/IdeaTagsSettings";
import { CustomFieldsSettings } from "@/components/settings/CustomFieldsSettings";
import PlansAndUsageSettings from "@/components/settings/PlansAndUsageSettings";
import { WebhookSettings } from "@/components/settings/WebhookSettings";
import { EnrichmentSettings } from "@/components/settings/EnrichmentSettings";
import { LimitReportsDashboard } from "@/components/crm/LimitReportsDashboard";
import { IntegrationsTab } from "@/components/settings/IntegrationsTab";
import { InboxTeamSettings } from "@/components/settings/InboxTeamSettings";
import { LeadDeliverySettings } from "@/components/settings/LeadDeliverySettings";
import { EmailInfrastructureSettings } from "@/components/email/infrastructure/EmailInfrastructureSettings";
import { SendersSettings } from "@/components/settings/SendersSettings";
import { MessagingSettings } from "@/components/settings/MessagingSettings";
import { MailboxesSettings } from "@/components/settings/MailboxesSettings";
import { NotificationsSettings } from "@/components/settings/NotificationsSettings";
import { BillingSettings } from "@/components/settings/BillingSettings";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { SettingsHeader } from "@/components/SettingsHeader";
import {
  SettingsNavigation,
  allSettingsItems,
} from "@/components/settings/SettingsNavigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

const validTabs = [
  "plans-usage",
  "mcp-keys",
  "cli-tokens",
  "network",
  "storage",
  "models",
  "integrations",
  "calendar",
  "webhooks",
  "limits",
  "enrichment",
  "senders",
  "messaging",
  "mailboxes",
  "email",
  "email-infra",
  "lead-delivery",
  "inbox-team",
  "team",
  "organization",
  "branding",
  "account",
  "idea-tags",
  "custom-fields",
  "ai-agents",
  "notifications",
  "billing",
];

export default function Settings() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = pathname === "/settings/tokens" ? "cli-tokens" : searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(
    tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "account"
  );

  useEffect(() => {
    const tab = tabFromUrl;
    // Backward compat: redirect api-keys to integrations
    if (tab === "api-keys") {
      setSearchParams({ tab: "integrations" }, { replace: true });
      return;
    }
    if (tab && validTabs.includes(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [tabFromUrl, activeTab, setSearchParams]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    navigate(tab === "cli-tokens" ? "/settings/tokens" : `/settings?tab=${tab}`);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "account":
        return <AccountSettings />;
      case "team":
        return <TeamSettings />;
      case "organization":
        return <OrganizationSettings />;
      case "branding":
        return <BrandingSettings />;
      case "plans-usage":
        return <PlansAndUsageSettings />;
      case "integrations":
        return <IntegrationsTab />;
      case "calendar":
        return <CalendarTab />;
      case "webhooks":
        return <WebhookSettings />;
      case "mcp-keys":
        return <McpApiKeysSettings />;
      case "cli-tokens":
        return <CliApiTokensSettings />;
      case "network":
        return <NetworkAccessSettings />;
      case "ai-agents":
        return <AIAgentsSettings />;
      case "models":
        return <ModelSettings />;
      case "storage":
        return <StorageSettings />;
      case "idea-tags":
        return <IdeaTagsSettings />;
      case "custom-fields":
        return <CustomFieldsSettings />;
      case "senders":
        return <SendersSettings />;
      case "messaging":
        return <MessagingSettings />;
      case "mailboxes":
        return <MailboxesSettings />;
      case "email":
        return <EmailSettings />;
      case "email-infra":
        return <EmailInfrastructureSettings />;
      case "lead-delivery":
        return <LeadDeliverySettings />;
      case "inbox-team":
        return <InboxTeamSettings />;
      case "enrichment":
        return <EnrichmentSettings />;
      case "limits":
        return <LimitReportsDashboard />;
      case "notifications":
        return <NotificationsSettings />;
      case "billing":
        return <BillingSettings />;
      default:
        return <AccountSettings />;
    }
  };

  // Get current item label for mobile dropdown
  const currentItem = allSettingsItems.find((item) => item.value === activeTab);

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1600px] mx-auto">
          <SettingsHeader />

          {/* Mobile dropdown - visible on small screens */}
          <div className="md:hidden mb-6">
            <Select value={activeTab} onValueChange={handleTabChange}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {currentItem
                    ? `${currentItem.groupLabel} / ${currentItem.label}`
                    : "Select setting"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {allSettingsItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.groupLabel} / {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop layout - sidebar + content */}
          <div className="flex gap-8">
            {/* Left sidebar - hidden on mobile */}
            <aside className="hidden md:block w-60 shrink-0">
              <SettingsNavigation
                activeTab={activeTab}
                onTabChange={handleTabChange}
              />
            </aside>

            {/* Content area */}
            <main className="flex-1 min-w-0 space-y-4">{renderContent()}</main>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
