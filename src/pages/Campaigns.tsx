import { Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { CampaignsTable } from "@/components/campaigns/CampaignsTable";
import { useCampaigns } from "@/hooks/useCampaigns";
import { useAccountsWithLimits } from "@/hooks/useAccountsWithLimits";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { LinkedInCampaignsShowcase } from "@/components/showcase/LinkedInCampaignsShowcase";
import { SendingHealthAlert } from "@/components/SendingHealthAlert";

export default function Campaigns() {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseLinkedIn = hasFeature("linkedin_campaigns");
  const {
    data: campaigns,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useCampaigns();
  const { data: accountsData } = useAccountsWithLimits();
  const summaries = [
    {
      label: "All campaigns",
      value: campaigns?.length ?? 0,
      context: "Across all statuses",
    },
    {
      label: "Active",
      value:
        campaigns?.filter((campaign) => campaign.status === "active").length ??
        0,
      context: "Currently running",
    },
    {
      label: "Contacted",
      value:
        campaigns?.reduce(
          (sum, campaign) => sum + (campaign.contacted_leads ?? 0),
          0,
        ) ?? 0,
      context: "Lead reaches across campaigns",
    },
    {
      label: "Replies",
      value:
        campaigns?.reduce(
          (sum, campaign) => sum + (campaign.replied_count ?? 0),
          0,
        ) ?? 0,
      context: "Across all campaigns",
    },
  ];

  if (!canUseLinkedIn && showUpgradePrompts) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <LinkedInCampaignsShowcase />
        </div>
      </AppLayout>
    );
  }

  if (!canUseLinkedIn) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8 text-center py-12">
          <p className="text-muted-foreground">
            This feature is not available for your organization.
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1480px] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Automations
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your outreach campaigns
              </p>
            </div>
            <Button variant="cta" asChild>
              <Link to="/campaigns/new">
                <Plus className="h-4 w-4" />
                New automation
              </Link>
            </Button>
          </div>

          <SendingHealthAlert channel="social" />

          <div
            className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card sm:grid-cols-4"
            aria-label="Campaign overview"
          >
            {summaries.map((summary) => (
              <div
                key={summary.label}
                className="flex items-center justify-between gap-3 border-b px-4 py-3 odd:border-r sm:border-b-0 sm:border-r sm:last:border-r-0"
                title={summary.context}
              >
                <p className="text-xs font-medium text-muted-foreground">
                  {summary.label}
                </p>
                {isLoading ? (
                  <Skeleton className="h-6 w-12" />
                ) : (
                  <p className="text-xl font-semibold tracking-tight tabular-nums">
                    {isError ? "—" : summary.value.toLocaleString()}
                  </p>
                )}

              </div>
            ))}
          </div>

          <CampaignsTable
            campaigns={campaigns || []}
            isLoading={isLoading}
            isError={isError}
            isFetching={isFetching}
            onRetry={() => void refetch()}
            accounts={accountsData?.accounts || []}
          />
        </div>
      </div>
    </AppLayout>
  );
}
