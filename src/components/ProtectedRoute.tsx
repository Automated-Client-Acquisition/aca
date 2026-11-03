import { ReactNode, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArchivedOrganizationBlock } from "@/components/ArchivedOrganizationBlock";
import { SuspendedOrganizationBlock } from "@/components/SuspendedOrganizationBlock";
import { SELF_HOSTED } from "@/config/site";

type RequiredRole = "agency" | "super_admin";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRole?: RequiredRole;
}

export function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const { user, loading, isAgency, isSuperAdmin, currentOrganization, isImpersonating } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth", { replace: true });
    }
  }, [user, loading, navigate]);

  // Client organizations inherit their setup from the parent agency.
  const isClientOrg = currentOrganization?.type === 'client';

  // No onboarding gate: signed-in users land straight in the app and pick up
  // any remaining setup from the activation checklist.

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Check if current org is suspended (but allow super admins and impersonating users)
  // Only check once org context is loaded
  if (
    currentOrganization &&
    (currentOrganization as any)?.is_suspended &&
    !isSuperAdmin &&
    !isImpersonating
  ) {
    return <SuspendedOrganizationBlock />;
  }

  // Check if current org is archived (but allow super admins and impersonating users)
  // Only check once org context is loaded
  if (
    currentOrganization &&
    currentOrganization?.status === "archived" &&
    !isSuperAdmin &&
    !isImpersonating
  ) {
    return <ArchivedOrganizationBlock />;
  }

  // Subscription gating. Allow super admins, agencies (white-label tier),
  // and client sub-orgs through unconditionally.
  const orgWithSub = currentOrganization as {
    subscription_status?: string;
    trial_ends_at?: string | null;
    stripe_subscription_id?: string | null;
    past_due_since?: string | null;
  } | null;
  const subStatus = orgWithSub?.subscription_status;
  const trialEndsAt = orgWithSub?.trial_ends_at ? new Date(orgWithSub.trial_ends_at) : null;
  const trialExpired = !!trialEndsAt && trialEndsAt.getTime() < Date.now();
  const hasPaidSub = !!orgWithSub?.stripe_subscription_id;
  const pastDueSince = orgWithSub?.past_due_since ? new Date(orgWithSub.past_due_since) : null;
  const daysPastDue = pastDueSince
    ? Math.floor((Date.now() - pastDueSince.getTime()) / 86_400_000)
    : 0;
  const pastDueLocked = subStatus === "past_due" && daysPastDue >= 7;
  // A self-hosted install has no billing, so nothing here can lock it.
  const blockedFromBilling =
    !SELF_HOSTED && !isSuperAdmin && !isImpersonating && !isAgency && !isClientOrg &&
    location.pathname !== "/settings/billing" &&
    !location.pathname.startsWith("/settings");

  // Hard block: subscription was explicitly canceled.
  if (currentOrganization && subStatus === "canceled" && blockedFromBilling) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Card className="max-w-md">
          <CardContent className="py-12 text-center">
            <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="font-medium mb-1">Subscription canceled</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Restart your subscription to keep your pipeline running.
            </p>
            <Button onClick={() => navigate("/settings/billing")}>Manage billing</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Past_due ≥ 7 days → hard block. Stripe's standard dunning cycle has
  // run its retries by now; either they update the card or they're out.
  // Banner has been red and non-dismissible for 7 days; this is no surprise.
  if (currentOrganization && pastDueLocked && blockedFromBilling) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Card className="max-w-md">
          <CardContent className="py-12 text-center">
            <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-red-600" />
            <h3 className="font-medium mb-1">Workspace locked - payment failed for 7 days</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Your card has been declining since {pastDueSince!.toLocaleDateString()}. Update payment to unlock your workspace and resume sending.
            </p>
            <Button onClick={() => navigate("/settings/billing")} className="bg-red-600 hover:bg-red-700 text-white">
              Update payment now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Trial expired + no paid subscription on file → drop them on billing.
  if (currentOrganization && subStatus === "trialing" && trialExpired && !hasPaidSub && blockedFromBilling) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Card className="max-w-md">
          <CardContent className="py-12 text-center">
            <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="font-medium mb-1">Your 3-day trial just ended</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add a card to keep your pipeline running. $67/mo or $490/yr - cancel any time.
            </p>
            <Button onClick={() => navigate("/settings/billing")}>Keep my pipeline running</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check role-based access - only if org context is loaded
  if (requiredRole && currentOrganization) {
    const hasAccess =
      (requiredRole === "agency" && isAgency) ||
      (requiredRole === "super_admin" && isSuperAdmin);

    if (!hasAccess) {
      return (
        <div className="flex items-center justify-center h-screen bg-background">
          <Card className="max-w-md">
            <CardContent className="py-12 text-center">
              <ShieldAlert className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="font-medium mb-1">Access Denied</h3>
              <p className="text-sm text-muted-foreground mb-4">
                You don't have permission to access this page.
              </p>
              <Button onClick={() => navigate("/jobs")}>
                Go to Dashboard
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  return <>{children}</>;
}
