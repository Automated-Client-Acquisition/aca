import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Calendar, Loader2, X } from "lucide-react";

/**
 * Persistent banner shown to organizations currently in their 3-day free trial.
 *
 * Hidden when:
 *  - org is on a paid subscription (stripe_subscription_id present)
 *  - subscription_status isn't "trialing"
 *  - org is an agency, client sub-org, or super-admin context
 *  - user dismisses for the session
 *
 * Click "Add card" → opens Stripe Checkout via create-trial-checkout.
 * Yearly is the default selection to nudge LTV.
 */
export function TrialBanner() {
  const navigate = useNavigate();
  const { currentOrganization, isAgency, isSuperAdmin } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);

  const org = currentOrganization as unknown as {
    id?: string;
    type?: string;
    subscription_status?: string;
    trial_ends_at?: string | null;
    stripe_subscription_id?: string | null;
  } | null;

  if (
    dismissed ||
    !org ||
    isAgency ||
    isSuperAdmin ||
    org.type === "client" ||
    org.subscription_status !== "trialing" ||
    org.stripe_subscription_id
  ) {
    return null;
  }

  const endsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const msLeft = endsAt ? endsAt.getTime() - Date.now() : 0;
  const hoursLeft = Math.max(0, Math.round(msLeft / 3_600_000));
  const daysLeft = Math.max(0, Math.ceil(hoursLeft / 24));

  let urgency: string;
  if (hoursLeft <= 0) urgency = "Trial ended · add a card to keep your pipeline running";
  else if (hoursLeft <= 24) urgency = `Trial ends in ${hoursLeft}h · keep your pipeline running`;
  else if (daysLeft === 1) urgency = "1 day left on your free trial";
  else urgency = `${daysLeft} days left on your free trial`;

  async function startCheckout(plan: "monthly" | "yearly") {
    setLoading(true);
    try {
      // Ask the edge function for a checkout URL using the org's existing
      // provisioning context (no token needed once authenticated; the
      // function trusts the auth'd user's organization membership).
      const { data, error } = await supabase.functions.invoke("create-trial-checkout", {
        body: {
          organizationId: org!.id,
          plan,
          successUrl: `${window.location.origin}/settings/billing?activated=1`,
          cancelUrl: window.location.href,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      if (!data?.url) throw new Error("No checkout URL returned");
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start checkout");
      setLoading(false);
    }
  }

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Calendar className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm text-foreground truncate">
            <span className="font-semibold">{urgency}.</span>{" "}
            <span className="text-muted-foreground">
              Add a card now and never lose a beat - $67/mo or save 39% on yearly ($490).
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 hidden md:inline-flex"
            disabled={loading}
            onClick={() => startCheckout("monthly")}
          >
            Monthly
          </Button>
          <Button
            size="sm"
            className="h-7 bg-amber-600 hover:bg-amber-700 text-white"
            disabled={loading}
            onClick={() => startCheckout("yearly")}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : null}
            Add card · save 39%
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-muted-foreground hidden md:inline-flex"
            disabled={loading}
            onClick={() => navigate("/settings/billing")}
          >
            Details
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
