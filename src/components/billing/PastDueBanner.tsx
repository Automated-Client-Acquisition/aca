import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";

/**
 * Persistent NON-DISMISSIBLE red banner shown to organizations whose
 * Stripe subscription is in past_due state. Counts down a 7-day grace
 * period (matching Stripe's standard dunning cycle); the hard-block
 * happens in ProtectedRoute once past_due_since is >= 7 days old.
 *
 * Auto-hides for: agencies (white-label tier), super admins, client
 * sub-orgs, and orgs that aren't past_due.
 */
export function PastDueBanner() {
  const navigate = useNavigate();
  const { currentOrganization, isAgency, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(false);

  const org = currentOrganization as unknown as {
    id?: string;
    type?: string;
    subscription_status?: string;
    past_due_since?: string | null;
    stripe_customer_id?: string | null;
  } | null;

  if (
    !org ||
    isAgency ||
    isSuperAdmin ||
    org.type === "client" ||
    org.subscription_status !== "past_due"
  ) {
    return null;
  }

  const startedAt = org.past_due_since ? new Date(org.past_due_since) : null;
  const hoursElapsed = startedAt
    ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 3_600_000))
    : 0;
  const daysElapsed = Math.floor(hoursElapsed / 24);
  const daysLeft = Math.max(0, 7 - daysElapsed);

  const urgency = daysLeft === 0
    ? "Final notice. Your workspace locks in less than 24 hours."
    : daysLeft === 1
    ? "Last day. Your workspace locks tomorrow."
    : `${daysLeft} days left to fix this before your workspace locks.`;

  async function openPortal() {
    if (!org?.id) return;
    if (!org.stripe_customer_id) {
      // No customer on file (shouldn't happen for past_due, but just in case).
      navigate("/settings?tab=billing");
      return;
    }
    setLoading(true);
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
      setLoading(false);
    }
  }

  return (
    <div className="bg-red-600 border-b border-red-700 text-white px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p className="text-sm truncate">
            <span className="font-semibold">Payment failed.</span>{" "}
            <span className="text-red-100">{urgency} Update your card to keep your pipeline running.</span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="h-7 bg-white text-red-700 hover:bg-red-50"
            onClick={openPortal}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Update payment now
          </Button>
        </div>
      </div>
    </div>
  );
}
