import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CheckCircle2, Copy, FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PreviewContactPicker } from "@/components/email/PreviewContactPicker";
import type { CrmContact } from "@/hooks/crm/useContacts";
import { CAMPAIGN_EVENTS_PATH, useCampaignTriggerTest, type TriggerTestReceipt } from "@/hooks/useCampaignTriggerTest";
import type { CampaignEntryRule } from "@/lib/campaign-entry";

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

function TestReceipt({ receipt }: { receipt: TriggerTestReceipt }) {
  const event = receipt.received.event;
  return (
    <div className="space-y-4 rounded-xl border bg-background p-4" aria-label="Received test event">
      <div role="status" className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm font-semibold">Received by ACA</p>
        <Badge variant="outline">Test only</Badge>
        <span className="text-xs text-muted-foreground">
          {receipt.auth_method === "api_token" ? "From your workflow" : "From the app"}
          {" · "}{formatDistanceToNow(new Date(receipt.created_at), { addSuffix: true })}
        </span>
      </div>
      <dl className="grid gap-x-3 gap-y-2 text-xs sm:grid-cols-[100px_1fr]">
        {[
          ["Contact", receipt.contact.name || receipt.contact.id],
          ["Contact ID", receipt.contact.id],
          ["Event ID", event.id],
          ["Event name", event.name],
          ["Channel", event.channel],
          ["Content", event.text],
        ].filter(([, value]) => value != null).map(([label, value]) => (
          <div key={String(label)} className="contents">
            <dt className="text-muted-foreground">{String(label)}</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-3 border-t pt-3">
        {!receipt.results.length && <p className="text-sm">No saved triggers to match. Save a trigger, then test again.</p>}
        {receipt.results.map((result) => (
          <div key={result.triggerId} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{result.name}</span>
              <Badge variant="outline">{result.matched ? "Rule matched" : "No match"}</Badge>
              {result.icpScore != null && <Badge variant="outline">ICP {result.icpScore} / 100</Badge>}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{result.reason}</p>
          </div>
        ))}
      </div>
      {receipt.campaign_status !== "active" && <p className="text-xs text-muted-foreground">Campaign is {receipt.campaign_status}. Live events enter only while it is active.</p>}
      <details>
        <summary className="cursor-pointer text-xs font-medium underline underline-offset-4">Inspect received JSON</summary>
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{stringify(receipt.received)}</pre>
      </details>
    </div>
  );
}

export function CampaignIntegrationGuide({ rule, campaignId }: { rule: CampaignEntryRule; campaignId?: string }) {
  const endpoint = `${window.location.origin}${CAMPAIGN_EVENTS_PATH}`;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("workflow");
  const [contact, setContact] = useState<CrmContact | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const { receipts, test, capability } = useCampaignTriggerTest(campaignId, open && tab === "test");
  const livePayload = {
    campaignId: campaignId || "YOUR_CAMPAIGN_ID",
    event: {
      id: "unique-source-event-id",
      type: rule.type,
      contactId: "ACA_CONTACT_ID",
      channel: rule.channel === "any" ? "linkedin" : rule.channel,
      text: rule.keywords[0] || "Matched content from your workflow",
      ...(rule.accountIds[0] ? { accountId: rule.accountIds[0] } : {}),
      ...(rule.type === "integration_event" ? { name: rule.eventName || "your.event.name" } : {}),
    },
  };
  const [draft, setDraft] = useState(() => stringify({
    ...livePayload, action: "test", triggerId: rule.id,
    event: { ...livePayload.event, id: `test-${crypto.randomUUID()}` },
  }));
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Copy was unavailable. Select and copy the text.");
    }
  };
  const parseDraft = () => {
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(draft); } catch { throw new Error("Enter valid JSON before sending a test."); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("The payload must be a JSON object.");
    if (!payload.event || typeof payload.event !== "object" || Array.isArray(payload.event)) throw new Error("Add an event object to the payload.");
    return payload;
  };
  const chooseContact = (value: CrmContact | null) => {
    try {
      const payload = parseDraft();
      setDraft(stringify({ ...payload, event: { ...(payload.event as Record<string, unknown>), contactId: value?.id || "ACA_CONTACT_ID" } }));
      setContact(value);
      setValidationError(null);
      test.reset();
    } catch (error) { setValidationError((error as Error).message); }
  };
  const sendTest = async () => {
    setValidationError(null);
    setSelectedReceiptId(null);
    test.reset();
    try {
      const payload = parseDraft();
      const event = payload.event as Record<string, unknown>;
      if (typeof event.contactId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event.contactId)) throw new Error("Choose a test contact or enter a valid ACA contact ID in the payload.");
      await test.mutateAsync({ payload, triggerId: rule.id });
    } catch (error) { setValidationError(error instanceof Error ? error.message : "The test could not be sent. Try again."); }
  };
  const responseReceipt: TriggerTestReceipt | undefined = test.data ? {
    id: test.data.receiptId, received: test.data.received, results: test.data.results,
    campaign_status: test.data.campaignStatus, contact: test.data.contact,
    auth_method: "jwt", created_at: new Date(test.submittedAt).toISOString(),
  } : undefined;
  const history = [...(receipts.data || [])];
  if (responseReceipt && !history.some(item => item.id === responseReceipt.id)) history.push(responseReceipt);
  history.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const selectedReceipt = history.find(item => item.id === selectedReceiptId) || history[0];
  const error = validationError || (test.error instanceof Error ? test.error.message : null);

  return (
    <details className="rounded-xl border bg-muted/20 p-4" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">Connect your n8n or GHL workflow</summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">Keep event capture and CRM actions in your existing workflow. Send ACA a contact ID and a stable event ID; ACA handles qualification and campaign entry.</p>
        <div className="space-y-2">
          <Label htmlFor={`trigger-event-endpoint-${rule.id}`}>POST endpoint</Label>
          <div className="flex gap-2">
            <Input id={`trigger-event-endpoint-${rule.id}`} readOnly value={endpoint} className="min-w-0 font-mono text-xs" />
            <Button variant="outline" size="icon" className="shrink-0" aria-label="Copy trigger endpoint" onClick={() => void copy(endpoint)}><Copy className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">Use an ACA token in the <code>Authorization: Bearer</code> header. <Link className="underline underline-offset-2" to="/settings/tokens">Manage tokens</Link></p>
        </div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="workflow">Workflow payload</TabsTrigger>
            <TabsTrigger value="test"><FlaskConical className="mr-1.5 h-3.5 w-3.5" />Test connection</TabsTrigger>
          </TabsList>
          <TabsContent value="workflow" className="space-y-3 pt-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`trigger-event-payload-${rule.id}`}>Event payload</Label>
              <Button variant="ghost" size="sm" onClick={() => void copy(stringify(livePayload))}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</Button>
            </div>
            <Textarea id={`trigger-event-payload-${rule.id}`} readOnly value={stringify(livePayload)} rows={11} className="font-mono text-xs" />
            <p className="text-xs leading-relaxed text-muted-foreground">Use the same event ID on retries. The contact must already exist in ACA. Test the connection before sending live events.</p>
          </TabsContent>
          <TabsContent value="test" className="space-y-4 pt-2">
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">Send a test event</h4>
              <p className="text-xs leading-relaxed text-muted-foreground">Choose a contact and edit the payload, or copy it into n8n/GHL and run your workflow. ACA confirms what arrived below. Tests never enroll contacts or send messages.</p>
            </div>
            {!campaignId && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Save this campaign before testing the connection.</p>}
            <PreviewContactPicker contact={contact} onSelect={chooseContact} allowSample={false} disabled={test.isPending} />
            <div className="space-y-2">
              <Label htmlFor={`trigger-test-payload-${rule.id}`}>Test payload</Label>
              <Textarea id={`trigger-test-payload-${rule.id}`} value={draft} rows={12} disabled={test.isPending} className="font-mono text-xs" onChange={event => {
                setDraft(event.target.value); setContact(null); setValidationError(null); test.reset();
              }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="cta" size="sm" disabled={!campaignId || test.isPending || capability.data !== true} onClick={() => void sendTest()}>
                {test.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-1.5 h-4 w-4" />}
                {test.isPending ? "Sending test…" : "Send test event"}
              </Button>
              <Button variant="outline" size="sm" disabled={!campaignId || test.isPending || capability.data !== true} onClick={() => {
                try {
                  const payload = parseDraft();
                  if (payload.campaignId !== campaignId) throw new Error("The payload must use this campaign's ID.");
                  void copy(stringify({ ...payload, action: "test", triggerId: rule.id }));
                } catch (error) { setValidationError((error as Error).message); }
              }}><Copy className="mr-1.5 h-3.5 w-3.5" />Copy workflow test</Button>
            </div>
            {capability.isLoading && <p role="status" className="text-xs text-muted-foreground">Checking that the endpoint supports safe tests…</p>}
            {capability.error && <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm">
              <p>{capability.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => void capability.refetch()}>Retry connection check</Button>
            </div>}
            <p className="text-xs leading-relaxed text-muted-foreground">The in-app test uses your signed-in session. Workflows use your ACA token. Tests use saved trigger settings and existing ICP scores; live events run full qualification and enrollment checks.</p>
            {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {campaignId && <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Recent test events</p>
                <Button variant="outline" size="sm" disabled={receipts.isFetching} onClick={() => void receipts.refetch()}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${receipts.isFetching ? "animate-spin" : ""}`} />Refresh</Button>
              </div>
              {receipts.error && <p role="alert" className="text-xs text-destructive">Test history could not be loaded. Refresh to try again.</p>}
              {history.length > 1 && <div className="space-y-1">
                <Label htmlFor={`trigger-test-history-${rule.id}`}>Inspect a test event</Label>
                <select id={`trigger-test-history-${rule.id}`} value={selectedReceiptId || history[0].id} onChange={event => setSelectedReceiptId(event.target.value)} className="w-full min-w-0 rounded-md border bg-background p-2 text-xs">
                  {history.map((item, index) => <option key={item.id} value={item.id}>{index === 0 ? "Latest · " : ""}{String(item.received.event.id)} · {item.auth_method === "api_token" ? "Workflow" : "App"}</option>)}
                </select>
              </div>}
              {selectedReceipt ? <TestReceipt receipt={selectedReceipt} /> : <p role="status" className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">{receipts.isLoading ? "Loading test history…" : "Listening for test events. Run your workflow with action: \"test\". This panel checks for arrivals every 5 seconds while open."}</p>}
            </div>}
          </TabsContent>
        </Tabs>
        <Link to="/settings?tab=webhooks" className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4">Manage outgoing ACA events<ArrowUpRight className="h-3 w-3" /></Link>
      </div>
    </details>
  );
}
