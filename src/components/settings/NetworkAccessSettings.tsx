import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useNetworkAccess,
  useRequestNetworkAccess,
  useStartNetworkBillingSetup,
  type NetworkAccess,
} from "@/hooks/useNetworkAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CreditCard, Network, ShieldCheck, Clock, Ban, Terminal } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const MIN_USE_CASE_LENGTH = 20;

export function NetworkAccessSettings() {
  const { data: access, isLoading, refetch } = useNetworkAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  // Back from Stripe: the webhook marks the card a moment later.
  useEffect(() => {
    if (searchParams.get("billing") !== "saved") return;
    toast.success("Card saved. It can take a few seconds to show here.");
    const next = new URLSearchParams(searchParams);
    next.delete("billing");
    setSearchParams(next, { replace: true });
    const timer = window.setTimeout(() => refetch(), 4000);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams, refetch]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="h-5 w-5" />
          ACA Network
          {access && <StatusBadge status={access.network_status} />}
        </CardTitle>
        <CardDescription>
          Use ACA's sending infrastructure from your own ACA install or through the API: Microsoft 365
          tenants, mailboxes and the shared warmup network. Every application is reviewed by a person.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading || !access ? (
          <div className="text-center py-8 text-muted-foreground">Loading…</div>
        ) : access.network_status === "none" || access.network_status === "rejected" ? (
          <>
            {access.network_status === "rejected" && (
              <Alert>
                <AlertDescription>
                  Your last application was not approved
                  {access.network_review_note ? `: ${access.network_review_note}` : "."} You can apply
                  again with more detail.
                </AlertDescription>
              </Alert>
            )}
            <ApplicationForm previous={access} />
          </>
        ) : access.network_status === "suspended" ? (
          <Alert variant="destructive">
            <Ban className="h-4 w-4" />
            <AlertDescription>
              Network access is suspended
              {access.network_review_note ? `: ${access.network_review_note}` : "."} Contact support to
              discuss it.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {access.network_status === "pending" ? (
              <div className="flex items-start gap-3 p-4 rounded-lg border bg-muted/40">
                <Clock className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div className="text-sm">
                  <p className="font-medium">Application under review</p>
                  <p className="text-muted-foreground">
                    Sent{" "}
                    {access.network_requested_at
                      ? format(new Date(access.network_requested_at), "d MMM yyyy")
                      : ""}
                    . You can add your billing card while you wait.
                  </p>
                </div>
              </div>
            ) : (
              <ApprovedNext />
            )}
            <BillingCard access={access} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: NetworkAccess["network_status"] }) {
  if (status === "approved") {
    return (
      <Badge variant="outline" className="text-[10px]">
        <ShieldCheck className="h-3 w-3 mr-1" />
        Approved
      </Badge>
    );
  }
  if (status === "pending") return <Badge variant="secondary" className="text-[10px]">Under review</Badge>;
  if (status === "suspended") return <Badge variant="destructive" className="text-[10px]">Suspended</Badge>;
  return null;
}

function ApplicationForm({ previous }: { previous: NetworkAccess }) {
  const request = useRequestNetworkAccess();
  const [company, setCompany] = useState(previous.network_application?.company ?? "");
  const [website, setWebsite] = useState(previous.network_application?.website ?? "");
  const [useCase, setUseCase] = useState(previous.network_application?.use_case ?? "");
  const [selfHosted, setSelfHosted] = useState(previous.network_application?.self_hosted ?? false);

  const ready =
    company.trim().length > 0 && website.trim().length > 0 && useCase.trim().length >= MIN_USE_CASE_LENGTH;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="network-company">Company</Label>
          <Input
            id="network-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="network-website">Website</Label>
          <Input
            id="network-website"
            placeholder="https://"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={300}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="network-use-case">What will you send, and to whom?</Label>
        <Textarea
          id="network-use-case"
          rows={4}
          placeholder="e.g. Cold email to UK accountancy firms for our bookkeeping software, about 2,000 a day across 3 domains."
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          maxLength={2000}
        />
        <p className="text-xs text-muted-foreground mt-1">
          At least {MIN_USE_CASE_LENGTH} characters. Tell us the audience, the offer and the volume.
        </p>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox
          id="network-self-hosted"
          checked={selfHosted}
          onCheckedChange={(v) => setSelfHosted(v === true)}
        />
        <Label htmlFor="network-self-hosted" className="text-sm font-normal leading-snug">
          I run ACA on my own servers and only want network services, not the hosted $67 plan.
        </Label>
      </div>
      <Button
        variant="cta"
        disabled={!ready || request.isPending}
        onClick={() =>
          request.mutate({
            company: company.trim(),
            website: website.trim(),
            useCase: useCase.trim(),
            selfHosted,
          })
        }
      >
        {request.isPending ? "Sending…" : "Apply for network access"}
      </Button>
    </div>
  );
}

function ApprovedNext() {
  const navigate = useNavigate();
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-muted/40">
      <div className="flex items-start gap-3 text-sm">
        <Terminal className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div>
          <p className="font-medium">You're approved</p>
          <p className="text-muted-foreground">
            Create an API token with network access, then set it as <code>ACA_NETWORK_API_KEY</code> in
            your install.
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => navigate("/settings/tokens")}>
        Create token
      </Button>
    </div>
  );
}

function BillingCard({ access }: { access: NetworkAccess }) {
  const setup = useStartNetworkBillingSetup();
  return (
    <div className="flex items-start justify-between gap-4 p-4 rounded-lg border">
      <div className="flex items-start gap-3 text-sm">
        <CreditCard className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div>
          <p className="font-medium">Billing card</p>
          {access.network_billing_ready_at ? (
            <p className="text-muted-foreground">
              Saved on {format(new Date(access.network_billing_ready_at), "d MMM yyyy")}. Tenants and
              other network services are billed to it.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Needed before you order tenants. Nothing is charged when you add it.
            </p>
          )}
        </div>
      </div>
      <Button
        variant={access.network_billing_ready_at ? "outline" : "cta"}
        size="sm"
        disabled={setup.isPending}
        onClick={() => setup.mutate()}
      >
        {setup.isPending ? "Opening…" : access.network_billing_ready_at ? "Replace card" : "Add a card"}
      </Button>
    </div>
  );
}
