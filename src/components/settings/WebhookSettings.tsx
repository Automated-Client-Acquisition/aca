import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useWebhookSettings,
  useCreateWebhookSettings,
  useUpdateWebhookSettings,
  useToggleWebhookActive,
  useGenerateWebhookSecret,
  useWebhookLogs,
  useRetryWebhook,
  useWebhookStats,
  useWebhookSubscriptions,
  useLeadListNames,
  useDeleteWebhookSubscription,
  destinationStatus,
  ALL_WEBHOOK_EVENTS,
  getEventTypeLabel,
  getEventTypeDescription,
  type WebhookEventType,
  type DestinationHealth,
} from "@/hooks/crm";
import {
  Webhook,
  Save,
  Eye,
  EyeOff,
  Copy,
  Key,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  RotateCw,
  Trash2,
  Plug,
  Plus,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { API_URL } from "@/config/site";

const ACA_HOOK_ENDPOINT = `${API_URL}/v1/hooks/n8n`;

/**
 * Events grouped by what they are about.
 *
 * Thirteen checkboxes in one column is a list you scan rather than read. The
 * groups match how somebody thinks about the question they are answering —
 * "tell me when a person changes" is a different intent from "tell me when a
 * message arrives".
 */
const EVENT_GROUPS: Array<{ title: string; hint: string; events: WebhookEventType[] }> = [
  {
    title: "Contacts",
    hint: "Someone is created or changes",
    events: ["contact_created", "contact_updated", "stage_changed", "score_changed"],
  },
  {
    title: "Tags",
    hint: "A label is put on or taken off a contact",
    events: ["tag_added", "tag_removed"],
  },
  {
    title: "Lead lists",
    hint: "A contact joins or leaves a list",
    events: ["list_member_added", "list_member_removed"],
  },
  {
    title: "Conversations",
    hint: "Messages, replies and human handover",
    events: ["message_received", "message_sent", "handoff_requested"],
  },
  {
    title: "Campaign entry",
    hint: "Qualification decisions and signal intake",
    events: ["campaign_entry_decided", "signal_lead_added"],
  },
  {
    title: "Sequences",
    hint: "A lead finishes or replies to a sequence",
    events: ["sequence_completed", "lead_replied"],
  },
];

/** Events that fire in bulk, and deserve a warning before someone ticks them. */
const HIGH_VOLUME: Partial<Record<WebhookEventType, string>> = {
  contact_updated: "Fires on every change, so an import or enrichment run sends a burst",
  list_member_added: "Fires once per contact, so building a big list sends a burst",
  list_member_removed: "Fires once per contact",
};

function StatusPill({ health }: { health?: DestinationHealth }) {
  const status = destinationStatus(health);
  const map = {
    delivering: { label: "Delivering", className: "text-green-600", Icon: CheckCircle },
    failing: { label: "Some failures", className: "text-amber-600", Icon: AlertTriangle },
    broken: { label: "Not reachable", className: "text-red-600", Icon: XCircle },
    waiting: { label: "Waiting to send", className: "text-blue-600", Icon: Clock },
    idle: { label: "Nothing sent yet", className: "text-muted-foreground", Icon: Clock },
  } as const;
  const { label, className, Icon } = map[status];

  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${className}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export function WebhookSettings() {
  const { data: settings, isLoading } = useWebhookSettings();
  const { data: logs, isLoading: logsLoading } = useWebhookLogs({ limit: 20 });
  const { data: stats } = useWebhookStats();
  const { data: subscriptions } = useWebhookSubscriptions();
  const deleteSubscription = useDeleteWebhookSubscription();
  // Resolved once for the whole table: a filter stores IDs, and an ID tells
  // nobody which list they picked in n8n.
  const { data: listNames } = useLeadListNames(
    (subscriptions ?? []).flatMap((s) => s.filters?.list_ids ?? []),
  );

  const createMutation = useCreateWebhookSettings();
  const updateMutation = useUpdateWebhookSettings();
  const toggleActiveMutation = useToggleWebhookActive();
  const generateSecretMutation = useGenerateWebhookSecret();
  const retryMutation = useRetryWebhook();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("Authorization");
  const [authHeaderValue, setAuthHeaderValue] = useState("");
  const [enabledEvents, setEnabledEvents] = useState<WebhookEventType[]>([]);
  const [maxRetries, setMaxRetries] = useState(3);
  const [showSecret, setShowSecret] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (settings) {
      setWebhookUrl(settings.default_webhook_url || "");
      setAuthHeaderName(settings.auth_header_name || "Authorization");
      setAuthHeaderValue(settings.auth_header_value || "");
      setEnabledEvents(settings.enabled_events || []);
      setMaxRetries(settings.max_retries ?? 3);
      setHasChanges(false);
    }
  }, [settings]);

  const healthFor = (url: string) => stats?.destinations?.find((d) => d.url === url);
  const customHealth = settings?.default_webhook_url
    ? healthFor(settings.default_webhook_url)
    : undefined;

  // Destinations that have been tried repeatedly and never once worked. This is
  // the page's most important job: a red number told you something was wrong
  // without telling you what, where, or what to do about it.
  //
  // Only warn about somewhere events can still be sent. Health is a rolling
  // 24-hour window, so a URL you removed keeps its failures for another day —
  // and an alarm you have already acted on, about a destination that is no
  // longer wired up, teaches you to ignore the banner. Wait for both queries
  // before deciding, or the first render nags about everything.
  const configuredUrls = new Set(
    [settings?.default_webhook_url, ...(subscriptions ?? []).map((s) => s.target_url)].filter(
      Boolean,
    ) as string[],
  );
  const brokenDestinations =
    isLoading || subscriptions === undefined
      ? []
      : (stats?.destinations ?? []).filter(
          (d) => destinationStatus(d) === "broken" && configuredUrls.has(d.url),
        );

  const handleSave = async () => {
    const input = {
      default_webhook_url: webhookUrl || null,
      auth_header_name: authHeaderName,
      auth_header_value: authHeaderValue || null,
      enabled_events: enabledEvents,
      max_retries: maxRetries,
    };

    try {
      if (settings) {
        await updateMutation.mutateAsync({ settingsId: settings.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      setHasChanges(false);
    } catch {
      // Error toast is handled by mutation onError callbacks
    }
  };

  const handleEventToggle = (event: WebhookEventType) => {
    setEnabledEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
    setHasChanges(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const connectedCount = subscriptions?.filter((s) => s.is_active).length ?? 0;
  const hasCustomEndpoint = !!settings?.default_webhook_url;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Webhooks</h3>
        <p className="text-sm text-muted-foreground">
          Send ACA events to other tools the moment they happen, so an automation can react
          without polling.
        </p>
      </div>

      {/* Something is broken — say which, why, and what to do */}
      {brokenDestinations.map((dest) => (
        <Alert key={dest.url} variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>A destination is not reachable</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              <span className="font-mono text-xs break-all">{dest.url}</span> has failed{" "}
              {dest.failed} of {dest.success + dest.failed} deliveries in the last 24 hours,
              with no successful delivery in that window.
            </p>
            {dest.lastError && (
              <p className="text-xs opacity-90">Last error: {dest.lastError}</p>
            )}
            <p className="text-xs">
              {/* Decide from the subscription list rather than by comparing against
                  settings, which may not have loaded yet — pointing someone at the
                  wrong card is worse than saying nothing. */}
              {subscriptions?.some((s) => s.target_url === dest.url)
                ? "Disconnect it under Connected apps, or fix the endpoint so it answers with a 2xx."
                : "Clear the Endpoint URL under Custom endpoint below. Events queued for an unreachable URL are retried three times each, so this keeps growing until you do."}
            </p>
            {dest.lastError?.includes("dns error") && (
              <p className="text-xs">
                That hostname does not resolve at all, so it was most likely a placeholder rather
                than a real endpoint.
              </p>
            )}
          </AlertDescription>
        </Alert>
      ))}

      {/* Nothing configured at all */}
      {connectedCount === 0 && !hasCustomEndpoint && (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-center space-y-3">
            <Plug className="h-8 w-8 mx-auto text-muted-foreground" />
            <div>
              <p className="font-medium">No destinations yet</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Connect the ACA node in n8n and it registers itself here automatically. Or add a
                custom endpoint below if you are calling something else.
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://www.npmjs.com/package/n8n-nodes-aca"
                target="_blank"
                rel="noreferrer"
              >
                <Plus className="h-4 w-4 mr-1" />
                Get the n8n node
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connected apps — the automatic path */}
      {subscriptions && subscriptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="h-4 w-4" />
              Connected apps
            </CardTitle>
            <CardDescription>
              Registered automatically by an app using your API token — the n8n node adds one per
              active workflow. Each chooses its own events, so nothing here depends on the
              settings further down.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destination</TableHead>
                  <TableHead>Listening for</TableHead>
                  <TableHead className="w-[150px]">Status</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((subscription) => (
                  <TableRow key={subscription.id}>
                    <TableCell className="max-w-[260px]">
                      <div className="font-mono text-xs truncate">{subscription.target_url}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        added by {subscription.source}
                        {subscription.target_url.includes("/webhook-test/") && (
                          <span className="ml-1 text-amber-600">
                            · test URL, only live while the workflow is listening
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {subscription.events.map((event) => (
                          <Badge key={event} variant="secondary" className="text-xs">
                            {getEventTypeLabel(event)}
                          </Badge>
                        ))}
                      </div>
                      {/* Only the list_member_* events are narrowed, so saying
                          nothing here would read as "every event, every list". */}
                      {(subscription.filters?.list_ids?.length ?? 0) > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Lead list events limited to{" "}
                          {subscription.filters!.list_ids!.map((id) => listNames?.[id] ?? id).join(", ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {subscription.is_active ? (
                        <StatusPill health={healthFor(subscription.target_url)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Paused</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Disconnect"
                        onClick={() => deleteSubscription.mutate(subscription.id)}
                        disabled={deleteSubscription.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-3">
              Disconnecting stops delivery immediately. An app that is still running will register
              itself again next time it starts — turn it off there to remove it for good.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Custom endpoint — the manual path */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Custom endpoint</CardTitle>
              <CardDescription>
                One URL for this whole organisation, for anything that cannot register itself.
                Leave it empty if you only use connected apps.
              </CardDescription>
            </div>
            {settings && hasCustomEndpoint && (
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="webhook-active" className="text-sm">
                  Enabled
                </Label>
                <Switch
                  id="webhook-active"
                  checked={settings.is_active}
                  onCheckedChange={(checked) =>
                    toggleActiveMutation.mutate({ settingsId: settings.id, isActive: checked })
                  }
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              placeholder="https://example.com/hooks/aca"
              value={webhookUrl}
              onChange={(e) => {
                setWebhookUrl(e.target.value);
                setHasChanges(true);
              }}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Must answer with a 2xx. Anything else is retried {maxRetries} times.
              </p>
              {hasCustomEndpoint && <StatusPill health={customHealth} />}
            </div>
          </div>

          {hasCustomEndpoint && (
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Which events to send</Label>
                <p className="text-xs text-muted-foreground">
                  These apply to the custom endpoint only. Connected apps choose their own.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {EVENT_GROUPS.map((group) => (
                  <div key={group.title} className="space-y-2">
                    <div>
                      <p className="text-sm font-medium">{group.title}</p>
                      <p className="text-xs text-muted-foreground">{group.hint}</p>
                    </div>
                    {group.events
                      .filter((event) => ALL_WEBHOOK_EVENTS.includes(event))
                      .map((event) => (
                        <div key={event} className="flex items-start gap-2">
                          <Checkbox
                            id={event}
                            checked={enabledEvents.includes(event)}
                            onCheckedChange={() => handleEventToggle(event)}
                            className="mt-0.5"
                          />
                          <div className="grid gap-0.5 leading-tight">
                            <label htmlFor={event} className="text-sm cursor-pointer">
                              {getEventTypeLabel(event)}
                            </label>
                            <span className="text-xs text-muted-foreground">
                              {getEventTypeDescription(event)}
                            </span>
                            {HIGH_VOLUME[event] && (
                              <span className="text-xs text-amber-600">{HIGH_VOLUME[event]}</span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasChanges && (
            <div className="flex justify-end">
              <Button
                variant="cta"
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                <Save className="h-4 w-4 mr-1" />
                Save changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The advanced half, out of the way until wanted */}
      <Accordion type="single" collapsible>
        <AccordionItem value="verify">
          <AccordionTrigger className="text-sm">
            Verifying that a delivery really came from ACA
          </AccordionTrigger>
          <AccordionContent className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Every delivery is signed with <code>X-Webhook-Signature</code>, an HMAC-SHA256 of the
              exact request body. Check it against the raw bytes before parsing them, and you know
              nobody else sent it. Connected apps handle this themselves — the n8n node verifies
              every delivery and rejects anything that does not match.
            </p>

            <div className="space-y-2">
              <Label className="text-sm">Signing secret for the custom endpoint</Label>
              <div className="flex items-center gap-2">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={settings?.webhook_secret || ""}
                  readOnly
                  placeholder="No secret yet"
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={() => setShowSecret(!showSecret)}>
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                {settings?.webhook_secret && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(settings.webhook_secret!)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                )}
                {settings && (
                  <Button
                    variant="outline"
                    onClick={() => generateSecretMutation.mutate(settings.id)}
                    disabled={generateSecretMutation.isPending}
                  >
                    <Key className="h-4 w-4 mr-1" />
                    {settings.webhook_secret ? "Rotate" : "Generate"}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Rotating invalidates the old secret immediately. Connected apps are unaffected —
                each has its own.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm">Custom header (optional)</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Header name"
                  value={authHeaderName}
                  onChange={(e) => {
                    setAuthHeaderName(e.target.value);
                    setHasChanges(true);
                  }}
                />
                <Input
                  type="password"
                  placeholder="Header value"
                  value={authHeaderValue}
                  onChange={(e) => {
                    setAuthHeaderValue(e.target.value);
                    setHasChanges(true);
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sent with every delivery to the custom endpoint, for endpoints that expect their
                own auth header.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="respond">
          <AccordionTrigger className="text-sm">
            Sending something back into ACA
          </AccordionTrigger>
          <AccordionContent className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Webhooks go one way. To act on an event — tag the contact, add a note, move a stage,
              reply — post back to this endpoint with an API token from Settings → CLI Tokens. The
              organisation comes from the token, so there is no ID to paste.
            </p>
            <div className="flex items-center gap-2">
              <Input value={ACA_HOOK_ENDPOINT} readOnly className="font-mono text-sm" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copyToClipboard(ACA_HOOK_ENDPOINT)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Using the n8n node? Its <strong>Event Action</strong> resource does this for you.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Recent deliveries */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent deliveries</CardTitle>
          <CardDescription>
            {stats
              ? `${stats.total} in the last 24 hours — ${stats.success} delivered, ${stats.failed} failed, ${stats.pending + stats.retrying} still queued`
              : "The last 20 attempts"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : !logs || logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nothing sent yet. Deliveries appear here as events happen.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm">
                      {getEventTypeLabel(log.event_type as WebhookEventType)}
                    </TableCell>
                    <TableCell className="font-mono text-xs max-w-[180px] truncate">
                      {log.webhook_url}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {log.status === "success" && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          Delivered
                        </span>
                      )}
                      {log.status === "failed" && (
                        <span
                          className="flex items-center gap-1 text-xs text-red-600"
                          title={log.error_message || undefined}
                        >
                          <XCircle className="h-3 w-3" />
                          {log.response_status ? `HTTP ${log.response_status}` : "Unreachable"}
                        </span>
                      )}
                      {log.status === "pending" && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          Queued
                        </span>
                      )}
                      {log.status === "retrying" && (
                        <span className="flex items-center gap-1 text-xs text-blue-600">
                          <RotateCw className="h-3 w-3" />
                          Retry {log.attempt_count} of {log.max_attempts}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.status === "failed" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Try again"
                          onClick={() => retryMutation.mutate(log.id)}
                          disabled={retryMutation.isPending}
                        >
                          <RotateCw className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Webhook className="h-3.5 w-3.5" />
        Delivery is at-least-once: a delivery may arrive twice, so use the{" "}
        <code>X-Webhook-ID</code> header to recognise a repeat.
      </p>
    </div>
  );
}
