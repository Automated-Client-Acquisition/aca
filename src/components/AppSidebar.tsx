import {
  Layers,
  CalendarClock,
  Package,
  Lightbulb,
  Telescope,
  Calendar,
  Settings,
  Sparkles,
  ChevronsUpDown,
  Check,
  Bookmark,
  Zap,
  Users,
  Building2,
  Shield,
  Lock,
  AlertTriangle,
  ExternalLink,
  GitBranch,
  BarChart3,
  Handshake,
  Inbox,
  MessageSquare,
  Magnet,
  Megaphone,
  Radar,
  Database,
  Network,
  Activity,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserOrganizations } from "@/hooks/useUserOrganizations";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";
import { useOrganizationQuota } from "@/hooks/useOrganizationQuota";
import { useUnreadConversationCount } from "@/hooks/crm/useConversations";
import { useSendingHealth } from "@/hooks/useSendingHealth";
import { Progress } from "@/components/ui/progress";
import type { FeatureName, PlanTier } from "@/types/admin";
import { PLAN_TIERS, formatLimit, isUnlimited } from "@/types/admin";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  feature?: FeatureName; // If set, this item requires the feature
  /** Extra path prefix that should also light this item up. NavLink highlights
   *  descendants of `href` only, so an item whose detail pages are SIBLINGS of
   *  its list page (Signals: list at /signals/dashboard, detail at
   *  /signals/:id) needs this to stay highlighted on the detail page. */
  activeMatch?: string | string[];
}

function matchesActive(item: NavItem, pathname: string): boolean {
  if (!item.activeMatch) return false;
  const prefixes = Array.isArray(item.activeMatch) ? item.activeMatch : [item.activeMatch];
  return prefixes.some((p) => pathname.startsWith(p));
}

// ============================================================
// CONTENT half — produce & publish content
// ============================================================

// Making content: the formats (blueprints), what they're about (ideas), where
// ideas come from (research), who's speaking to whom (Brand Kit, /assets), and
// what's been made. "Content" is runs, saved pieces and the publish queue
// behind one item (tabs on those pages). Autopilots rotate blueprints across
// accounts on a schedule, so they sit right after Blueprints.
const contentItems: NavItem[] = [
  { icon: Layers, label: "Blueprints", href: "/blueprints" },
  { icon: CalendarClock, label: "Autopilots", href: "/autopilots", feature: "autopilots" },
  { icon: Lightbulb, label: "Ideas", href: "/ideas" },
  { icon: Telescope, label: "Research", href: "/research" },
  { icon: Package, label: "Brand Kit", href: "/assets" },
  { icon: Calendar, label: "Content", href: "/jobs", activeMatch: ["/jobs", "/saved", "/publish-queue"] },
];

// ============================================================
// ACQUISITION half — find, contact & manage leads
// ============================================================

// Outreach — every proactive multi-channel automation lives here, regardless
// of channel. "Automations" (the @xyflow sequence builder) is channel-agnostic
// by design (LinkedIn, email, WhatsApp, Instagram, …); channel is a property of
// a step, not a top-level category. Email "Sequences" + inbound "Lead Magnets"
// sit alongside it as sibling automation types.
const outreachItems: NavItem[] = [
  { icon: Megaphone, label: "Automations", href: "/campaigns", feature: "linkedin_campaigns" },
  { icon: GitBranch, label: "Sequences", href: "/email/sequences", feature: "email_campaigns" },
  { icon: Magnet, label: "Lead Magnets", href: "/lead-magnets", feature: "lead_magnets" },
  { icon: BarChart3, label: "Email Analytics", href: "/email/analytics", feature: "email_campaigns" },
];

// Inbox + the canonical "who you're talking to" entities, plus Signals (who
// to talk to next).
const crmItems: NavItem[] = [
  { icon: MessageSquare, label: "Inbox", href: "/inbox", feature: "messaging" },
  { icon: Users, label: "People", href: "/people" },
  { icon: Handshake, label: "Deals", href: "/deals", activeMatch: "/deals" },
  // /signals is the PUBLIC marketing feed — the in-app list lives at
  // /signals/dashboard. Linking to /signals here dropped users out of the app.
  { icon: Activity, label: "Signals", href: "/signals/dashboard", activeMatch: "/signals/" },
];

// Senders (LinkedIn & social) and Mailboxes are setup, not daily work: they
// live in Settings > Sending. The Settings item below carries a warning dot
// when one of them needs reconnecting, so a broken sender isn't out of sight.

// Sidebar quota display component
function SidebarQuotaDisplay({ expanded }: { expanded: boolean }) {
  const { data: quota, isLoading } = useOrganizationQuota();
  const { currentOrganization } = useAuth();

  if (isLoading || !quota) return null;

  // Trial users came in via /get-started for outreach - the daily generation
  // quota + 'Upgrade to Pro' nag are content-side legacy UI and only confuse
  // them. The TrialBanner already handles their conversion moment.
  const subStatus = (currentOrganization as { subscription_status?: string } | null)?.subscription_status;
  if (subStatus === "trialing") return null;

  const planConfig = PLAN_TIERS[quota.planTier as PlanTier] ?? PLAN_TIERS.free;
  const dailyUnlimited = isUnlimited(quota.limits.daily_generations);
  const monthlyUnlimited = isUnlimited(quota.limits.monthly_generations);
  const dailyPercentage = dailyUnlimited
    ? 0
    : Math.min((quota.usage.daily.generations / quota.limits.daily_generations) * 100, 100);
  const isAtLimit = quota.isAtDailyLimit || quota.isAtMonthlyLimit;
  const isNearLimit = quota.isNearDailyLimit || quota.isNearMonthlyLimit;
  const isFreeUser = quota.planTier === "free";
  const isUnlimitedUser = dailyUnlimited && monthlyUnlimited;

  // Don't show anything for unlimited users (enterprise)
  if (isUnlimitedUser) {
    return null;
  }

  // Compact view when collapsed
  if (!expanded) {
    return (
      <div className="px-2 py-2">
        <div
          className={cn(
            "w-full h-2 rounded-full",
            isAtLimit
              ? "bg-red-500"
              : isNearLimit
              ? "bg-[hsl(var(--status-warning))]"
              : "bg-muted"
          )}
        >
          <div
            className={cn(
              "h-full rounded-full transition-all",
              isAtLimit
                ? "bg-red-600"
                : isNearLimit
                ? "bg-[hsl(var(--status-warning))]"
                : "bg-primary"
            )}
            style={{ width: `${dailyPercentage}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      {/* Usage progress */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Today's usage</span>
          <span className={cn("font-medium", isAtLimit && "text-red-500")}>
            {quota.usage.daily.generations}/{quota.limits.daily_generations}
          </span>
        </div>
        <Progress
          value={dailyPercentage}
          className={cn(
            "h-1.5",
            isAtLimit && "[&>div]:bg-red-500",
            isNearLimit && !isAtLimit && "[&>div]:bg-[hsl(var(--status-warning))]"
          )}
        />
      </div>

      {/* Warning message */}
      {isAtLimit && (
        <div className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertTriangle className="w-3 h-3" />
          <span>Limit reached</span>
        </div>
      )}

      {/* Plan badge - single $67/mo tier, no upgrade upsell. */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn("text-[10px]", planConfig.color)}>
          {planConfig.label}
        </Badge>
        {!monthlyUnlimited && (
          <span className="text-[10px] text-muted-foreground">
            {quota.usage.monthly.generations}/{quota.limits.monthly_generations} this month
          </span>
        )}
      </div>
    </div>
  );
}

// Renders one labelled sidebar group. Skips itself entirely when none of its
// items are visible (avoids empty labelled groups now that channels with
// different feature flags share a group). Handles the Inbox unread badge.
function NavGroup({
  label,
  items,
  isItemHidden,
  isItemLocked,
  open,
  unreadCount,
}: {
  label: string;
  items: NavItem[];
  isItemHidden: (item: NavItem) => boolean;
  isItemLocked: (item: NavItem) => boolean;
  open: boolean;
  unreadCount?: number;
}) {
  const { pathname } = useLocation();
  const visible = items.filter((item) => !isItemHidden(item));
  if (visible.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visible.map((item) => {
            const locked = isItemLocked(item);
            const showUnread =
              item.label === "Inbox" && !locked && !!unreadCount && unreadCount > 0;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild tooltip={locked ? `${item.label} (Pro)` : item.label}>
                  {locked ? (
                    <a
                      href={UPGRADE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-md"
                    >
                      <Lock className="w-4 h-4 text-cta" />
                      <span>{item.label}</span>
                      {open && (
                        <Badge variant="outline" className="ml-auto text-[10px] py-0 px-1 border-cta/30 text-cta bg-cta/10">
                          Pro
                        </Badge>
                      )}
                    </a>
                  ) : (
                    <NavLink
                      to={item.href}
                      className={cn(
                        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        matchesActive(item, pathname) &&
                          "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
                      )}
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <item.icon className="w-5 h-5" />
                      <span>{item.label}</span>
                      {showUnread && open && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                      {showUnread && !open && (
                        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-muted-foreground/50" />
                      )}
                    </NavLink>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { open } = useSidebar();
  const {
    currentOrganization,
    isAgency,
    isSuperAdmin,
    switchOrganization,
    userRole,
  } = useAuth();
  const { data: userOrganizations } = useUserOrganizations();
  const queryClient = useQueryClient();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const { data: unreadCount } = useUnreadConversationCount(
    ['open', 'snoozed'],
    { excludeSent: true },
  );
  const { data: sendingHealth } = useSendingHealth();
  const sendingNeedsAttention =
    (hasFeature("linkedin_campaigns") && (sendingHealth?.brokenSenders ?? 0) > 0) ||
    (hasFeature("email_campaigns") && (sendingHealth?.disconnectedMailboxes ?? 0) > 0);

  // Check if a nav item should show locked state
  const isItemLocked = (item: NavItem) => {
    if (!item.feature) return false;
    return !hasFeature(item.feature) && showUpgradePrompts;
  };

  // Check if item should be hidden (client without access, no upgrade prompt)
  const isItemHidden = (item: NavItem) => {
    if (!item.feature) return false;
    return !hasFeature(item.feature) && !showUpgradePrompts;
  };

  // Get initials helper
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  // Get color based on ID
  const getColor = (id: string) => {
    const colors = [
      "bg-gradient-aca",
      "bg-gradient-to-br from-blue-500 to-cyan-500",
      "bg-gradient-to-br from-pink-500 to-rose-500",
      "bg-gradient-cta",
      "bg-gradient-to-br from-green-500 to-emerald-500",
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const handleOrgSwitch = async (orgId: string) => {
    const result = await switchOrganization(orgId);
    if (!result.error) {
      // Invalidate all queries to refetch data for the new org
      await queryClient.invalidateQueries();
    }
  };

  return (
    <Sidebar collapsible="offcanvas">
      {/* Header - Tenant Switcher */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  {/* Find current org from userOrganizations to get logo_url */}
                  {(() => {
                    const currentOrgData = userOrganizations?.find(o => o.id === currentOrganization?.id);
                    const logoUrl = currentOrgData?.logo_url;
                    return logoUrl ? (
                      <img
                        key={`logo-${logoUrl}`}
                        src={logoUrl}
                        alt={currentOrganization?.name || ""}
                        className="w-8 h-8 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div
                        key={`initials-${currentOrganization?.id}`}
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0",
                          currentOrganization ? getColor(currentOrganization.id) : "bg-gray-500"
                        )}
                      >
                        {currentOrganization ? getInitials(currentOrganization.name) : "??"}
                      </div>
                    );
                  })()}
                  <div className="flex flex-col gap-0.5 leading-none">
                    <span className="font-semibold">{currentOrganization?.name || "Select Organization"}</span>
                    <span className="text-xs text-muted-foreground">
                      {isAgency ? "Agency" : "Workspace"}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] bg-popover"
                align="start"
              >
                {(userOrganizations || []).map((org) => (
                  <DropdownMenuItem
                    key={`${org.id}-${org.logo_url || 'no-logo'}`}
                    onClick={() => handleOrgSwitch(org.id)}
                    className="gap-3"
                  >
                    {org.logo_url ? (
                      <img
                        src={org.logo_url}
                        alt={org.name}
                        className="w-8 h-8 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm",
                          org.color
                        )}
                      >
                        {org.initials}
                      </div>
                    )}
                    <span className="flex-1">{org.name}</span>
                    {currentOrganization?.id === org.id && <Check className="w-4 h-4" />}
                  </DropdownMenuItem>
                ))}
                {(!userOrganizations || userOrganizations.length === 0) && (
                  <DropdownMenuItem disabled className="text-muted-foreground">
                    No organizations
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Content */}
      <SidebarContent>
        {/* Generate Button */}
        <div className="px-3 py-2">
          <Button
            variant="cta"
            className="w-full font-medium shadow-lg"
            asChild
          >
            <NavLink to="/create">
              <Sparkles className="w-4 h-4" />
              {open && <span className="ml-2">Create</span>}
              {open && <span className="ml-auto text-xs opacity-70">⌘K</span>}
            </NavLink>
          </Button>
        </div>

        {/* Usage & Upgrade CTA */}
        <SidebarQuotaDisplay expanded={open} />

        {/* ===== CONTENT half — produce & publish ===== */}
        <NavGroup label="CREATE" items={contentItems} isItemHidden={isItemHidden} isItemLocked={isItemLocked} open={open} />

        {/* Divider between the two product halves */}
        <SidebarSeparator className="my-1" />

        {/* ===== ACQUISITION half — find, contact & manage leads ===== */}
        <NavGroup label="OUTREACH" items={outreachItems} isItemHidden={isItemHidden} isItemLocked={isItemLocked} open={open} />
        <NavGroup label="INBOX & CRM" items={crmItems} isItemHidden={isItemHidden} isItemLocked={isItemLocked} open={open} unreadCount={unreadCount} />

        {/* Agency Section - Only show for agencies or orgs with agency type */}
        {(isAgency || currentOrganization?.type === "agency") && (
          <SidebarGroup>
            <SidebarGroupLabel>AGENCY</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Clients">
                    <NavLink
                      to="/clients"
                      className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <Building2 className="w-5 h-5" />
                      <span>Clients</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Admin Section - Only for super admins */}
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>ADMIN</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Admin Dashboard">
                    <NavLink
                      to="/admin"
                      className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    >
                      <Shield className="w-5 h-5 text-red-500" />
                      <span>Admin Dashboard</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={sendingNeedsAttention ? "Settings: a sender or mailbox needs reconnecting" : "Settings"}
            >
              <NavLink
                to="/settings"
                className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              >
                <Settings className="w-5 h-5" />
                <span>Settings</span>
                {sendingNeedsAttention && (
                  <span
                    className={cn(
                      "rounded-full bg-amber-500",
                      open ? "ml-auto h-2 w-2" : "absolute right-1.5 top-1.5 h-2 w-2",
                    )}
                    aria-label="A sender or mailbox needs reconnecting"
                  />
                )}
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
