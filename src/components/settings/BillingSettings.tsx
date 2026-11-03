import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  CreditCard, ExternalLink, Loader2, CheckCircle2, AlertTriangle, Calendar,
} from "lucide-react";
import { BILLING_EMAIL } from "@/config/site";

/**
 * Billing tab in /settings. Shows the org's live subscription state and
 * the actions available given that state:
 *
 *   - trialing + no card     -> "Add card now" → create-trial-checkout
 *   - trialing + has card    -> "Manage in Stripe" → portal session
 *   - active                 -> "Manage in Stripe" + plan + next bill
 *   - past_due               -> warning + "Update payment method"
 *   - canceled / null        -> "Start your free trial" → create-trial-checkout
 */
export function BillingSettings() {
  const { currentOrganization } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<"monthly" | "yearly" | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);

  const org = currentOrganization as unknown as {
    id?: string;
    name?: string;
    subscription_status?: string | null;
    trial_ends_at?: string | null;
    plan_tier?: string | null;
    stripe_subscription_id?: string | null;
    stripe_customer_id?: string | null;
  } | null;

  const status = org?.subscription_status ?? null;
  const planTier = org?.plan_tier ?? null;
  const trialEndsAt = org?.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const trialExpired = trialEndsAt ? trialEndsAt.getTime() < Date.now() : false;
  const hoursLeftInTrial = trialEndsAt
    ? Math.max(0, Math.round((trialEndsAt.getTime() - Date.now()) / 3_600_000))
    : 0;
  const daysLeftInTrial = Math.ceil(hoursLeftInTrial / 24);
  const hasStripeSub = !!org?.stripe_subscription_id;
  const hasStripeCustomer = !!org?.stripe_customer_id;

  async function startTrialCheckout(plan: "monthly" | "yearly") {
    if (!org?.id) return;
    setLoadingPlan(plan);
    try {
      const { data, error } = await supabase.functions.invoke("create-trial-checkout", {
        body: {
          organizationId: org.id,
          plan,
          successUrl: `${window.location.origin}/settings?tab=billing&activated=1`,
          cancelUrl: `${window.location.origin}/settings?tab=billing`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      if (!data?.url) throw new Error("No checkout URL returned");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open checkout");
      setLoadingPlan(null);
    }
  }

  async function openStripePortal() {
    if (!org?.id) return;
    if (!hasStripeCustomer) {
      toast.error("No Stripe customer on file yet - add a card to activate billing.");
      return;
    }
    setLoadingPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-billing-portal", {
        body: {
          organizationId: org.id,
          returnUrl: `${window.location.origin}/settings?tab=billing`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      if (!data?.url) throw new Error("No portal URL returned");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open the billing portal");
      setLoadingPortal(false);
    }
  }

  // ── Render branches ────────────────────────────────────────────────────────

  const StatusBadge = () => {
    if (status === "active") {
      return <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Active</Badge>;
    }
    if (status === "trialing") {
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200"><Calendar className="w-3 h-3 mr-1" />Trial · {hoursLeftInTrial <= 0 ? "expired" : hoursLeftInTrial <= 24 ? `${hoursLeftInTrial}h left` : `${daysLeftInTrial}d left`}</Badge>;
    }
    if (status === "past_due") {
      return <Badge className="bg-red-100 text-red-800 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />Past due</Badge>;
    }
    if (status === "canceled") {
      return <Badge className="bg-gray-100 text-gray-800 border-gray-200">Canceled</Badge>;
    }
    return <Badge variant="outline">Not started</Badge>;
  };

  const planLabel = planTier === "operator_yearly" ? "Operator · Yearly · $490"
                  : planTier === "operator_monthly" ? "Operator · Monthly · $67"
                  : planTier === "white_label_yearly" ? "White-label · Yearly · $2,490"
                  : planTier === "white_label_monthly" ? "White-label · Monthly · $297"
                  : null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Billing</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Your subscription, payment method, and invoices.
        </p>
      </div>

      {/* Current state card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Current plan</CardTitle>
            <StatusBadge />
          </div>
          <CardDescription>{org?.name ?? "Your workspace"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Plan</div>
              <div className="font-medium">{planLabel ?? "No paid plan yet"}</div>
            </div>
            {trialEndsAt && (
              <div>
                <div className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                  {trialExpired ? "Trial ended" : "Trial ends"}
                </div>
                <div className="font-medium">
                  {trialEndsAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </div>
            )}
          </div>

          {/* Trialing without a card on file - the most common state */}
          {status === "trialing" && !hasStripeSub && (
            <div className="border border-amber-500/30 bg-amber-50/40 rounded-lg p-4 space-y-3">
              <div className="text-sm">
                <div className="font-semibold mb-1">
                  {hoursLeftInTrial <= 24 ? "Your trial ends today" : `${daysLeftInTrial} days left on your free trial`}
                </div>
                <p className="text-muted-foreground">
                  Add a card to keep your pipeline running once the trial ends. Cancel any time before then and you pay nothing.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => startTrialCheckout("yearly")}
                  disabled={loadingPlan !== null}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {loadingPlan === "yearly" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Yearly · $490 (save 39%)
                </Button>
                <Button
                  onClick={() => startTrialCheckout("monthly")}
                  disabled={loadingPlan !== null}
                  variant="outline"
                >
                  {loadingPlan === "monthly" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Monthly · $67
                </Button>
              </div>
            </div>
          )}

          {/* Already on a paid sub - Stripe portal */}
          {hasStripeSub && (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="text-sm">
                <div className="font-semibold mb-1">Manage your subscription</div>
                <p className="text-muted-foreground">
                  Update your card, change plan, view invoices, or cancel. All managed through Stripe's secure portal.
                </p>
              </div>
              <Button onClick={openStripePortal} disabled={loadingPortal}>
                {loadingPortal ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
                Open Stripe portal
              </Button>
            </div>
          )}

          {/* Canceled subscription - restart flow */}
          {status === "canceled" && (
            <div className="border border-red-500/30 bg-red-50/40 rounded-lg p-4 space-y-3">
              <div className="text-sm">
                <div className="font-semibold mb-1">Subscription canceled</div>
                <p className="text-muted-foreground">
                  Restart your subscription to bring your pipeline back online.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => startTrialCheckout("yearly")} disabled={loadingPlan !== null}>
                  {loadingPlan === "yearly" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Restart yearly · $490
                </Button>
                <Button onClick={() => startTrialCheckout("monthly")} disabled={loadingPlan !== null} variant="outline">
                  {loadingPlan === "monthly" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Restart monthly · $67
                </Button>
              </div>
            </div>
          )}

          {/* Past-due - bring it back */}
          {status === "past_due" && (
            <div className="border border-red-500/30 bg-red-50/40 rounded-lg p-4 space-y-3">
              <div className="text-sm">
                <div className="font-semibold mb-1 text-red-700">Payment failed</div>
                <p className="text-muted-foreground">
                  Your most recent payment didn't go through. Update your card to keep your workspace active.
                </p>
              </div>
              <Button onClick={openStripePortal} disabled={loadingPortal} className="bg-red-600 hover:bg-red-700 text-white">
                {loadingPortal ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CreditCard className="w-4 h-4 mr-2" />}
                Update payment method
              </Button>
            </div>
          )}

          {/* No subscription state at all */}
          {!status && (
            <div className="border border-border rounded-lg p-4 space-y-3">
              <div className="text-sm">
                <div className="font-semibold mb-1">Start your free trial</div>
                <p className="text-muted-foreground">
                  3 days free. No card required to start. Pick a plan when you're ready to keep it running.
                </p>
              </div>
              <Button onClick={() => (window.location.href = "/get-started")}>
                Start free trial
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Questions about an invoice? Email <a href={`mailto:${BILLING_EMAIL}`} className="underline">{BILLING_EMAIL}</a>.
      </p>
    </div>
  );
}
