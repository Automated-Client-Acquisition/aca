import { useState } from "react";
import { Link } from "react-router-dom";
import {
  useAdminNetworkAccess,
  useNetworkRequests,
  useReviewNetworkAccess,
  type NetworkAccess,
  type NetworkDecision,
} from "@/hooks/useNetworkAccess";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { formatDistanceToNow } from "date-fns";

/** Pending ACA Network applications, oldest first. Admin dashboard tab. */
export function NetworkRequestsQueue() {
  const { data: requests = [], isLoading } = useNetworkRequests();

  return (
    <Card>
      <CardHeader>
        <CardTitle>ACA Network requests</CardTitle>
        <CardDescription>
          Organizations asking to use our tenants, mailboxes and warmup network. Tenants are on our Pax8
          account, so approve only senders you would put your name to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No pending requests.</div>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Link to={`/admin/organizations/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                {r.network_requested_at && (
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(r.network_requested_at), { addSuffix: true })}
                  </span>
                )}
              </div>
              <ApplicationDetails access={r} />
              <ReviewActions orgId={r.id} status={r.network_status} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Network access for one organization. Admin organization detail page. */
export function NetworkAccessPanel({ orgId }: { orgId: string }) {
  const { data: access, isLoading } = useAdminNetworkAccess(orgId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          ACA Network
          {access && <Badge variant="outline">{access.network_status}</Badge>}
          {access?.network_only && <Badge variant="secondary">self-hosted</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !access ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : access.network_status === "none" ? (
          <p className="text-sm text-muted-foreground">Has not applied.</p>
        ) : (
          <>
            <ApplicationDetails access={access} />
            {access.network_review_note && (
              <p className="text-sm">
                <span className="text-muted-foreground">Review note: </span>
                {access.network_review_note}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Billing card: {access.network_billing_ready_at ? "saved" : "not added"}
            </p>
            <ReviewActions orgId={orgId} status={access.network_status} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ApplicationDetails({ access }: { access: NetworkAccess }) {
  const app = access.network_application;
  if (!app) return null;
  return (
    <dl className="grid gap-1 text-sm sm:grid-cols-[120px_1fr]">
      <dt className="text-muted-foreground">Company</dt>
      <dd>{app.company}</dd>
      <dt className="text-muted-foreground">Website</dt>
      <dd>
        <a href={app.website} target="_blank" rel="noreferrer noopener" className="underline">
          {app.website}
        </a>
      </dd>
      <dt className="text-muted-foreground">Self-hosted</dt>
      <dd>{app.self_hosted ? "Yes, network services only" : "No"}</dd>
      <dt className="text-muted-foreground">Use case</dt>
      <dd className="whitespace-pre-wrap">{app.use_case}</dd>
    </dl>
  );
}

const ACTIONS_BY_STATUS: Record<string, { decision: NetworkDecision; label: string; destructive?: boolean }[]> = {
  pending: [
    { decision: "approve", label: "Approve" },
    { decision: "reject", label: "Reject", destructive: true },
  ],
  approved: [{ decision: "suspend", label: "Suspend", destructive: true }],
  suspended: [{ decision: "reinstate", label: "Reinstate" }],
};

function ReviewActions({ orgId, status }: { orgId: string; status: string }) {
  const review = useReviewNetworkAccess();
  const [note, setNote] = useState("");
  const actions = ACTIONS_BY_STATUS[status] ?? [];
  if (actions.length === 0) return null;

  return (
    <div className="space-y-2">
      <Textarea
        rows={2}
        placeholder="Note (shown to the organization on reject or suspend)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        {actions.map((a) => (
          <Button
            key={a.decision}
            size="sm"
            variant={a.destructive ? "destructive" : "default"}
            disabled={review.isPending}
            onClick={() => review.mutate({ orgId, decision: a.decision, note: note.trim() || undefined })}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
