import { useParams, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MailboxHealthBadge } from "@/components/email/MailboxHealthBadge";
import { useEmailMailbox } from "@/hooks/useEmailMailboxes";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { EmailCampaignsShowcase } from "@/components/showcase/EmailCampaignsShowcase";
import {
  MailboxOverviewTab,
  MailboxGeneralTab,
  MailboxWarmupTab,
  MailboxManagementTab,
  MailboxCampaignsTab,
} from "@/components/email/mailbox-detail";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  BarChart3,
  Settings,
  Flame,
  Shield,
  Megaphone,
} from "lucide-react";

const PROVIDER_ICONS: Record<string, string> = {
  gmail: "G",
  outlook: "O",
  smtp: "S",
};

const PROVIDER_COLORS: Record<string, string> = {
  gmail: "bg-red-500/10 text-red-600 border-red-500/20",
  outlook: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  smtp: "bg-gray-500/10 text-gray-600 border-gray-500/20",
};

export default function EmailMailboxDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseEmail = hasFeature("email_campaigns");
  const { data: mailbox, isLoading } = useEmailMailbox(id);

  // Feature gating
  if (!canUseEmail && showUpgradePrompts) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="flex-1 p-8">
          <EmailCampaignsShowcase />
        </div>
      </AppLayout>
    );
  }

  if (!canUseEmail) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="flex-1 p-8 text-center py-12">
          <p className="text-muted-foreground">This feature is not available for your organization.</p>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <div className="max-w-[1200px] mx-auto space-y-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <Skeleton className="h-10 w-96" />
            <Skeleton className="h-80 w-full" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!mailbox) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <div className="max-w-[1200px] mx-auto text-center py-16">
            <h2 className="text-lg font-medium mb-2">Mailbox Not Found</h2>
            <p className="text-sm text-muted-foreground mb-4">
              The mailbox you're looking for doesn't exist or has been removed.
            </p>
            <Button
              variant="outline"
              onClick={() => navigate("/settings?tab=mailboxes")}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Mailboxes
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const provider = mailbox.provider || "smtp";

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1200px] mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="mt-1"
              onClick={() => navigate("/settings?tab=mailboxes")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className={cn(
                  "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center border text-sm font-bold",
                  PROVIDER_COLORS[provider] || PROVIDER_COLORS.smtp
                )}
              >
                {PROVIDER_ICONS[provider] || "S"}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold truncate">
                  {mailbox.email_address}
                </h1>
                {mailbox.display_name && (
                  <p className="text-sm text-muted-foreground truncate">
                    {mailbox.display_name}
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-3 flex-shrink-0">
                <MailboxHealthBadge
                  status={mailbox.status}
                  imapConnected={mailbox.imap_connected}
                  healthScore={mailbox.health_score}
                />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview" className="gap-1.5">
                <BarChart3 className="h-3.5 w-3.5" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="general" className="gap-1.5">
                <Settings className="h-3.5 w-3.5" />
                General
              </TabsTrigger>
              <TabsTrigger value="warmup" className="gap-1.5">
                <Flame className="h-3.5 w-3.5" />
                Warm Up
              </TabsTrigger>
              <TabsTrigger value="management" className="gap-1.5">
                <Shield className="h-3.5 w-3.5" />
                Management
              </TabsTrigger>
              <TabsTrigger value="campaigns" className="gap-1.5">
                <Megaphone className="h-3.5 w-3.5" />
                Campaigns
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <MailboxOverviewTab mailbox={mailbox} />
            </TabsContent>

            <TabsContent value="general" className="mt-6">
              <MailboxGeneralTab mailbox={mailbox} />
            </TabsContent>

            <TabsContent value="warmup" className="mt-6">
              <MailboxWarmupTab mailbox={mailbox} />
            </TabsContent>

            <TabsContent value="management" className="mt-6">
              <MailboxManagementTab mailbox={mailbox} />
            </TabsContent>

            <TabsContent value="campaigns" className="mt-6">
              <MailboxCampaignsTab mailboxId={mailbox.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </AppLayout>
  );
}
