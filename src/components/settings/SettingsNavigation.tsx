import {
  User,
  Users,
  Building2,
  CreditCard,
  Plug,
  Calendar,
  Webhook,
  Bot,
  Sparkles,
  HardDrive,
  Tags,
  ListPlus,
  Search,
  Gauge,
  Palette,
  BellRing,
  Mail,
  Inbox,
  Send,
  Server,
  Terminal,
  MessagesSquare,
  MousePointerClick,
  MessageSquareText,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useSendingHealth, type SendingHealth } from "@/hooks/useSendingHealth";
import type { LucideIcon } from "lucide-react";
import type { FeatureName } from "@/types/admin";
import { SELF_HOSTED } from "@/config/site";

interface SettingsNavItem {
  value: string;
  label: string;
  icon: LucideIcon;
  /** Hidden for orgs without this feature (unless upgrade prompts are on),
   *  matching how these items behaved in the main sidebar. */
  feature?: FeatureName;
  /** Warning dot when this sending-health count is above zero. */
  healthKey?: keyof SendingHealth;
  /** Only exists on ACA Cloud; hidden on a self-hosted install. */
  hostedOnly?: boolean;
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

const allSettingsGroups: SettingsNavGroup[] = [
  {
    label: "ACCOUNT & WORKSPACE",
    items: [
      { value: "account", label: "Account", icon: User },
      { value: "team", label: "Team", icon: Users },
      { value: "organization", label: "Organization", icon: Building2 },
      { value: "branding", label: "Branding", icon: Palette },
      { value: "plans-usage", label: "Plans & Usage", icon: CreditCard, hostedOnly: true },
      { value: "billing", label: "Billing", icon: CreditCard, hostedOnly: true },
      { value: "notifications", label: "Notifications & alerts", icon: BellRing },
    ],
  },
  // Everything that sends on the org's behalf, in one place. These used to be
  // split between two main-sidebar groups and three Settings tabs.
  {
    label: "SENDING",
    items: [
      { value: "senders", label: "LinkedIn & social", icon: MessagesSquare, feature: "linkedin_campaigns", healthKey: "brokenSenders" },
      { value: "messaging", label: "SMS & WhatsApp", icon: MessageSquareText },
      { value: "mailboxes", label: "Mailboxes", icon: Mail, feature: "email_campaigns", healthKey: "disconnectedMailboxes" },
      { value: "email-infra", label: "Domains & servers", icon: Server },
      { value: "email", label: "Tracking & imports", icon: MousePointerClick },
      { value: "limits", label: "Channel limits", icon: Gauge },
    ],
  },
  {
    label: "INTEGRATIONS",
    items: [
      { value: "integrations", label: "Integrations", icon: Plug },
      { value: "calendar", label: "Calendar", icon: Calendar },
      { value: "webhooks", label: "Webhooks", icon: Webhook },
      { value: "mcp-keys", label: "MCP / Claude", icon: Bot },
      { value: "cli-tokens", label: "CLI Tokens", icon: Terminal },
      { value: "network", label: "ACA Network", icon: Network, hostedOnly: true },
    ],
  },
  {
    label: "AI & CONTENT",
    items: [
      { value: "ai-agents", label: "AI Agents", icon: Bot },
      { value: "models", label: "AI Models", icon: Sparkles },
      { value: "storage", label: "Storage", icon: HardDrive },
      { value: "idea-tags", label: "Idea Tags", icon: Tags },
      { value: "custom-fields", label: "Custom Fields", icon: ListPlus },
    ],
  },
  {
    label: "LEADS & INBOX",
    items: [
      { value: "lead-delivery", label: "Lead Delivery", icon: Send },
      { value: "inbox-team", label: "Inbox & Team", icon: Inbox },
      { value: "enrichment", label: "Enrichment", icon: Search },
    ],
  },
];

// Export for use in mobile dropdown
const settingsGroups: SettingsNavGroup[] = SELF_HOSTED
  ? allSettingsGroups.map((group) => ({ ...group, items: group.items.filter((item) => !item.hostedOnly) }))
  : allSettingsGroups;

export const allSettingsItems = settingsGroups.flatMap((group) =>
  group.items.map((item) => ({
    ...item,
    groupLabel: group.label,
  }))
);

interface SettingsNavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function SettingsNavigation({
  activeTab,
  onTabChange,
}: SettingsNavigationProps) {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const { data: health } = useSendingHealth();

  const isVisible = (item: SettingsNavItem) =>
    !item.feature || hasFeature(item.feature) || showUpgradePrompts;

  return (
    <ScrollArea className="h-[calc(100vh-220px)]">
      <nav className="space-y-6 pr-4">
        {settingsGroups.map((group) => (
          <div key={group.label}>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground tracking-wider">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.filter(isVisible).map((item) => (
                <button
                  key={item.value}
                  onClick={() => onTabChange(item.value)}
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm transition-colors",
                    activeTab === item.value
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                  {item.healthKey && !!health?.[item.healthKey] && (
                    <span
                      className="ml-auto h-2 w-2 rounded-full bg-amber-500"
                      aria-label="Needs attention"
                    />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </ScrollArea>
  );
}
