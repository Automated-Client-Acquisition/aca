import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Fingerprint,
  ListPlus,
  MessageSquare,
  MessageCircle,
  Plus,
  Radio,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Webhook,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CampaignIntegrationGuide } from "@/components/campaign-builder/CampaignIntegrationGuide";
import { CampaignTriggerActivity } from "@/components/campaign-builder/CampaignTriggerActivity";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";
import { useProducts } from "@/hooks/useProducts";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import {
  ENTRY_CATALOG,
  ENTRY_TYPES,
  createEntryRule,
  entryRuleErrors,
  entryRuleSummary,
  normalizeEntryPost,
  previewEntryDecision,
  splitEntryValues,
  type CampaignEntryRule,
  type CampaignEntryType,
} from "@/lib/campaign-entry";
import { cn } from "@/lib/utils";

const ICONS = {
  connection_request: UserPlus,
  message_received: MessageSquare,
  post_comment: MessageCircle,
  keyword_match: Search,
  signal: Radio,
  list_member_added: ListPlus,
  integration_event: Webhook,
};
const CHANNELS = [
  "linkedin",
  "instagram",
  "whatsapp",
  "telegram",
];
const SIGNALS = [
  "funding",
  "acquisition",
  "hiring",
  "hiring_demand",
  "job_change",
  "executive_hire",
  "customer_win",
  "award",
  "growth",
];
const CHANNEL_NAMES: Record<string, string> = { linkedin: "LinkedIn", whatsapp: "WhatsApp", instagram: "Instagram", telegram: "Telegram", email: "Email", sms: "SMS" };
const formatValue = (value: string) =>
  CHANNEL_NAMES[value] || value.replace(/_/g, " ").replace(/^./, (part) => part.toUpperCase());

function ValuesField({
  id,
  label,
  values,
  onChange,
  placeholder,
  hint,
  normalize,
}: {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  hint: string;
  normalize?: (value: string) => string;
}) {
  // Keep punctuation, commas and trailing spaces while typing; commit the list
  // separately so normalization does not fight the user's cursor.
  const [draft, setDraft] = useState(values.join("\n"));
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={draft}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(
            splitEntryValues(event.target.value).map((value) =>
              normalize ? normalize(value) : value,
            ),
          );
        }}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

function TriggerLists({ rule, onChange }: {
  rule: CampaignEntryRule;
  onChange: (listIds: string[]) => void;
}) {
  const { leadLists, isLoading, error } = useLeadLists();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const selectedIds = rule.listIds ?? [];
  const available = leadLists.filter(list => list.status === "active" && !list.is_smart && list.source_type !== "smart");
  const visible = available.filter(list => list.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const unavailable = selectedIds.filter(id => !available.some(list => list.id === id));
  const toggle = (id: string, checked: boolean) => onChange(checked
    ? [...new Set([...selectedIds, id])]
    : selectedIds.filter(value => value !== id));

  return (
    <div className="space-y-3">
      <Label>Lists to watch</Label>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Runs when a new person is added to any selected list while this campaign
        is active. Existing members are not enrolled by this trigger.
      </p>
      {isLoading ? <Skeleton className="h-24" /> : error ? (
        <div role="alert" className="rounded-lg border p-3 text-xs">
          Lists could not be loaded.
          <Button variant="outline" size="sm" className="ml-2" onClick={() => void queryClient.invalidateQueries({ queryKey: ["lead-lists"] })}>
            Retry lists
          </Button>
        </div>
      ) : (
        <>
          {available.length > 8 && (
            <Input aria-label="Search trigger lists" placeholder="Search lists…" value={search} onChange={event => setSearch(event.target.value)} />
          )}
          <div role="group" aria-label="Lists to watch" className="max-h-64 divide-y overflow-y-auto rounded-lg border">
            {visible.map(list => (
              <label key={list.id} className="flex cursor-pointer items-center gap-3 px-3 py-3">
                <Checkbox checked={selectedIds.includes(list.id)} disabled={!selectedIds.includes(list.id) && selectedIds.length >= 100} onCheckedChange={checked => toggle(list.id, checked === true)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{list.name}</span>
                  <span className="text-xs text-muted-foreground">{list.lead_count.toLocaleString()} members</span>
                </span>
              </label>
            ))}
            {!visible.length && (
              <div className="p-4 text-sm text-muted-foreground">
                {available.length ? "No lists match your search." : "No active lists with stored members."}
              </div>
            )}
          </div>
          {unavailable.length > 0 && (
            <div role="alert" className="rounded-lg border border-amber-500/30 p-3 text-xs">
              {unavailable.length} selected list{unavailable.length === 1 ? " is" : "s are"} unavailable or cannot capture additions.
              <Button variant="outline" size="sm" className="ml-2" onClick={() => onChange(selectedIds.filter(id => !unavailable.includes(id)))}>
                Remove unavailable
              </Button>
            </div>
          )}
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Manual additions, imports and automated list additions use this trigger.
        Smart segments use audience enrollment because their membership is calculated dynamically.
      </p>
    </div>
  );
}

function TriggerPreview({ rule }: { rule: CampaignEntryRule }) {
  const [text, setText] = useState("");
  const [score, setScore] = useState("");
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => setResult(null), [rule]);
  return (
    <details className="rounded-xl border bg-muted/20 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Preview a decision
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          Try sample text and an ICP score. This previews keyword and
          qualification rules; account, suppression and enrollment checks run on
          real events. Nothing is sent or enrolled.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="space-y-2">
            <Label htmlFor="trigger-sample-text">Sample content</Label>
            <Input
              id="trigger-sample-text"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
              placeholder="e.g. Looking for an AI solution"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trigger-sample-score">ICP score</Label>
            <Input
              id="trigger-sample-score"
              type="number"
              min={0}
              max={100}
              value={score}
              onChange={(event) => {
                setScore(event.target.value);
                setResult(null);
              }}
              placeholder="Unknown"
            />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setResult(
              previewEntryDecision(
                rule,
                text,
                score === "" ? null : Number(score),
              ),
            )
          }
        >
          Preview decision
        </Button>
        {result && (
          <p
            role="status"
            className="rounded-lg border bg-background p-3 text-sm"
          >
            {result}
          </p>
        )}
      </div>
    </details>
  );
}

function TriggerForm({
  rule,
  onChange,
  campaignId,
  senderIds,
  onUseAsSenders,
  audienceListIds,
  autoEnrollNewMembers,
  onDisableOngoingEnrollment,
}: {
  rule: CampaignEntryRule;
  onChange: (rule: CampaignEntryRule) => void;
  campaignId?: string;
  senderIds: string[];
  onUseAsSenders: () => void;
  audienceListIds: string[];
  autoEnrollNewMembers: boolean;
  onDisableOngoingEnrollment: () => void;
}) {
  const products = useProducts();
  const accounts = useUnipileAccounts();
  const patch = (values: Partial<CampaignEntryRule>) =>
    onChange({ ...rule, ...values });
  const isInvite = rule.type === "connection_request";
  const native =
    ["connection_request", "message_received", "post_comment"].includes(
      rule.type,
    ) ||
    (rule.type === "keyword_match" && rule.keywordSource !== "integration");
  const needsPosts =
    rule.type === "post_comment" ||
    (rule.type === "keyword_match" && rule.keywordSource === "comments");
  const availableAccounts = (accounts.data?.accounts ?? []).filter(
    (account) => {
      const channel = account.provider.toLowerCase();
      return (
        CHANNELS.includes(channel) &&
        (isInvite || needsPosts
          ? channel === "linkedin"
          : rule.channel === "any" || rule.channel === channel)
      );
    },
  );
  const selectedMissing = rule.accountIds.filter(
    (id) => !availableAccounts.some((account) => account.id === id),
  );
  const notSenders = rule.accountIds.filter((id) => !senderIds.includes(id));
  const errors = entryRuleErrors(rule);
  if (rule.qualification.enabled && rule.qualification.productId && !products.isLoading && !products.error && !products.products?.some(product => product.id === rule.qualification.productId)) {
    errors.push("Choose an available product for ICP verification.");
  }
  const Icon = ICONS[rule.type] || Zap;
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-amber-500/5 text-amber-700 dark:text-amber-400">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold">
            {ENTRY_CATALOG[rule.type]?.title || "Unsupported trigger"}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {ENTRY_CATALOG[rule.type]?.source}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="trigger-name">Trigger name</Label>
        <Input
          id="trigger-name"
          value={rule.name}
          maxLength={120}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </div>
      <section className="space-y-4 border-t pt-5" aria-label="Event matching">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            1
          </span>
          <h4 className="text-sm font-semibold">When this happens</h4>
        </div>
        {rule.type === "list_member_added" && (
          <>
            <TriggerLists rule={rule} onChange={listIds => patch({ listIds })} />
            {rule.enabled && autoEnrollNewMembers && rule.listIds?.some(id => audienceListIds.includes(id)) && (
              <div role="alert" className="space-y-3 rounded-lg border border-amber-500/30 p-3 text-xs leading-relaxed">
                <p>A watched list is also an ongoing audience source. Its audience route can enroll people before this trigger checks their ICP fit or sends them to review.</p>
                <Button variant="outline" size="sm" className="h-auto whitespace-normal py-2 text-left" onClick={onDisableOngoingEnrollment}>Turn off ongoing audience enrollment</Button>
              </div>
            )}
          </>
        )}
        {rule.type === "keyword_match" && (
          <div className="space-y-2">
            <Label htmlFor="trigger-keyword-source">Where to look</Label>
            <Select
              value={rule.keywordSource}
              onValueChange={(value) =>
                patch({
                  keywordSource: value as CampaignEntryRule["keywordSource"],
                  channel: value === "comments" ? "linkedin" : rule.channel,
                  accountIds: value === "integration" || value === "comments" && rule.channel !== "linkedin" ? [] : rule.accountIds,
                })
              }
            >
              <SelectTrigger id="trigger-keyword-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="messages">Incoming messages</SelectItem>
                <SelectItem value="comments">
                  Comments on selected LinkedIn posts
                </SelectItem>
                <SelectItem value="integration">
                  Keyword monitor in n8n / GHL
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Broader social or web monitoring stays in your connected monitor.
              ACA qualifies the matched person.
            </p>
          </div>
        )}
        {native && !isInvite && !needsPosts && (
          <div className="space-y-2">
            <Label htmlFor="trigger-channel">Channel</Label>
            <Select
              value={rule.channel}
              onValueChange={(value) =>
                patch({ channel: value, accountIds: [] })
              }
            >
              <SelectTrigger id="trigger-channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any messaging channel</SelectItem>
                {CHANNELS.map((channel) => (
                  <SelectItem key={channel} value={channel}>
                    {formatValue(channel)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {native && (
          <div className="space-y-2">
            <Label>Receiving accounts</Label>
            <p className="text-xs text-muted-foreground">
              Choose the accounts this trigger watches. Invitations and comments
              are checked periodically; messages arrive through your connected
              inbox.
            </p>
            {accounts.isLoading ? (
              <Skeleton className="h-20" />
            ) : accounts.error ? (
              <div role="alert" className="rounded-lg border p-3 text-xs">
                Accounts could not be checked.{" "}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() => void accounts.refetch()}
                >
                  Retry accounts
                </Button>
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {availableAccounts.map((account) => (
                  <label
                    key={account.id}
                    className="flex cursor-pointer items-center gap-3 px-3 py-3"
                  >
                    <Checkbox
                      checked={rule.accountIds.includes(account.id)}
                      disabled={
                        account.status !== "active" &&
                        !rule.accountIds.includes(account.id)
                      }
                      onCheckedChange={(checked) =>
                        patch({
                          accountIds: checked
                            ? [...rule.accountIds, account.id]
                            : rule.accountIds.filter((id) => id !== account.id),
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {account.display_name ||
                          account.username ||
                          "Unnamed account"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatValue(account.provider.toLowerCase())}
                        {senderIds.includes(account.id)
                          ? " · Campaign sender"
                          : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        account.status === "active"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {account.status === "active"
                        ? "Connected"
                        : formatValue(account.status)}
                    </span>
                  </label>
                ))}
                {!availableAccounts.length && (
                  <div className="p-4 text-sm text-muted-foreground">
                    No accounts for this source.{" "}
                    <Link to="/settings?tab=senders" className="underline">
                      Connect an account
                    </Link>
                  </div>
                )}
              </div>
            )}
            {selectedMissing.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 p-3 text-xs">
                {selectedMissing.length} selected account
                {selectedMissing.length === 1 ? " is" : "s are"} unavailable.{" "}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  onClick={() =>
                    patch({
                      accountIds: rule.accountIds.filter(
                        (id) => !selectedMissing.includes(id),
                      ),
                    })
                  }
                >
                  Remove unavailable
                </Button>
              </div>
            )}
            {notSenders.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 p-3 text-xs">
                <span>Receiving accounts must also be campaign senders.</span>
                <Button variant="outline" size="sm" onClick={onUseAsSenders}>
                  Use as senders
                </Button>
              </div>
            )}
          </div>
        )}
        {needsPosts && (
          <ValuesField
            key={`${rule.id}-posts`}
            id="trigger-posts"
            label="LinkedIn posts"
            values={rule.postIds}
            onChange={(postIds) => patch({ postIds })}
            normalize={normalizeEntryPost}
            placeholder="Paste a LinkedIn post URL or activity ID"
            hint="One post per line, up to 20. Only new comments are captured; lead-magnet reply settings stay separate."
          />
        )}
        {["message_received", "post_comment", "keyword_match"].includes(
          rule.type,
        ) && (
          <ValuesField
            key={`${rule.id}-keywords`}
            id="trigger-keywords"
            label={
              rule.type === "keyword_match"
                ? "Keywords or phrases"
                : "Only if it contains (optional)"
            }
            values={rule.keywords}
            onChange={(keywords) => patch({ keywords })}
            placeholder={
              rule.type === "post_comment"
                ? "guide\ndemo"
                : "looking for\npricing\nAI automation"
            }
            hint="One phrase per line or separated by commas. Matches any phrase, ignoring case. Words match as whole words."
          />
        )}
        {rule.type === "signal" && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Starts when ACA’s signal engine adds a person to a lead list.
              Company-only signals wait until a contact is available. Existing
              audience lists can still enroll through their own rules.
            </p>
            <div className="flex flex-wrap gap-2">
              {SIGNALS.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={rule.signalTypes.includes(type)}
                  onClick={() =>
                    patch({
                      signalTypes: rule.signalTypes.includes(type)
                        ? rule.signalTypes.filter((value) => value !== type)
                        : [...rule.signalTypes, type],
                    })
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                    rule.signalTypes.includes(type)
                      ? "border-amber-500/40 bg-amber-500/5 text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {rule.signalTypes.includes(type) && (
                    <Check className="h-3 w-3" />
                  )}
                  {formatValue(type)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {rule.signalTypes.length
                ? `${rule.signalTypes.length} signal types selected`
                : "Any signal type, including custom types"}
            </p>
            <Link
              to="/signals/dashboard"
              className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
            >
              Manage signal sources
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        )}
        {rule.type === "integration_event" && (
          <div className="space-y-2">
            <Label htmlFor="trigger-event-name">Event name</Label>
            <Input
              id="trigger-event-name"
              value={rule.eventName}
              placeholder="e.g. lead.requested_demo"
              onChange={(event) => patch({ eventName: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Match the event name sent by your existing workflow. Forms, CRM
              stage changes and broader monitoring belong there.
            </p>
          </div>
        )}
      </section>
      <section
        aria-label="ICP qualification"
        className="space-y-4 border-t pt-5"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              2
            </span>
            <h4 className="text-sm font-semibold">
              Verify the person’s ICP fit
            </h4>
          </div>
          <Switch
            aria-label="Require ICP verification"
            checked={rule.qualification.enabled}
            disabled={isInvite}
            onCheckedChange={(enabled) =>
              patch({ qualification: { ...rule.qualification, enabled } })
            }
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {isInvite
            ? "Invitation decisions always require ICP verification. Missing information goes to review."
            : "Use ACA’s existing product qualification. Missing or failed analysis goes to review."}
        </p>
        {rule.qualification.enabled && (
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <div className="space-y-2">
              <Label htmlFor="trigger-product">Product / offer</Label>
              <Select
                value={rule.qualification.productId || "__none"}
                onValueChange={(productId) =>
                  patch({
                    qualification: {
                      ...rule.qualification,
                      productId: productId === "__none" ? "" : productId,
                    },
                  })
                }
              >
                <SelectTrigger id="trigger-product">
                  <SelectValue placeholder="Choose a product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Choose a product</SelectItem>
                  {(products.products ?? []).map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                  {rule.qualification.productId &&
                    !products.products?.some(
                      (product) => product.id === rule.qualification.productId,
                    ) && (
                      <SelectItem value={rule.qualification.productId}>
                        Unavailable product
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
              {products.error && (
                <p role="alert" className="text-xs text-destructive">
                  Products could not be loaded. Reopen this section to retry.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="trigger-threshold">Minimum score</Label>
              <Input
                id="trigger-threshold"
                type="number"
                min={0}
                max={100}
                value={
                  rule.qualification.minScore < 0
                    ? ""
                    : rule.qualification.minScore
                }
                onChange={(event) =>
                  patch({
                    qualification: {
                      ...rule.qualification,
                      minScore:
                        event.target.value === ""
                          ? -1
                          : Number(event.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
        )}
      </section>
      <section aria-label="Entry outcomes" className="space-y-4 border-t pt-5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            3
          </span>
          <h4 className="text-sm font-semibold">Decide what happens next</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="trigger-match">When qualified</Label>
            <Select
              value={rule.onMatch}
              onValueChange={(onMatch) =>
                patch({ onMatch: onMatch as CampaignEntryRule["onMatch"] })
              }
            >
              <SelectTrigger id="trigger-match">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {isInvite && (
                  <SelectItem value="accept_and_enroll">
                    Accept invitation & enroll
                  </SelectItem>
                )}
                {!isInvite && (
                  <SelectItem value="enroll">
                    Enroll in this campaign
                  </SelectItem>
                )}
                <SelectItem value="review">Send to review first</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="trigger-mismatch">When below threshold</Label>
            <Select
              value={rule.onMismatch}
              onValueChange={(onMismatch) =>
                patch({
                  onMismatch: onMismatch as CampaignEntryRule["onMismatch"],
                })
              }
            >
              <SelectTrigger id="trigger-mismatch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ignore">
                  {isInvite ? "Leave invitation pending" : "Do not enroll"}
                </SelectItem>
                {isInvite && (
                  <SelectItem value="decline">Decline invitation</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Missing ICP information → review. Suppressed contacts, exclusions,
            and people already in this campaign never enter again.
          </span>
        </div>
        {isInvite && rule.onMismatch === "decline" && (
          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400">
            This will decline requests automatically only after a verified score
            falls below your threshold.
          </p>
        )}
      </section>
      {errors.length > 0 && rule.enabled && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
        >
          <p className="text-xs font-semibold">
            Finish setting up this trigger
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      <TriggerPreview key={rule.id} rule={rule} />
      {(rule.type === "integration_event" ||
        (rule.type === "keyword_match" &&
          rule.keywordSource === "integration")) && (
        <CampaignIntegrationGuide key={`integration-${rule.id}`} rule={rule} campaignId={campaignId} />
      )}
    </div>
  );
}

export function StepTriggers({
  builder,
  campaignId,
  active,
}: {
  builder: CampaignBuilderReturn;
  campaignId?: string;
  active: boolean;
}) {
  const [tab, setTab] = useState<"rules" | "activity">("rules");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rules = builder.state.entryTriggers;
  const accounts = useUnipileAccounts();
  const products = useProducts();
  const selected = rules.find((rule) => rule.id === selectedId) ?? rules[0];
  const senderIds = [
    ...new Set([
      ...builder.state.senderAccountIds,
      ...Object.values(builder.state.senderAccounts).flat(),
    ]),
  ];
  const update = (rule: CampaignEntryRule) =>
    builder.updateField(
      "entryTriggers",
      rules.map((item) => (item.id === rule.id ? rule : item)),
    );
  const add = (type: CampaignEntryType) => {
    if (rules.length >= 20) return;
    const productId = products.products?.some(product => product.id === builder.state.icpProductId) ? builder.state.icpProductId : "";
    const rule = createEntryRule(type, productId);
    if (type === "connection_request" || type === "post_comment")
      rule.accountIds =
        builder.state.senderAccounts.linkedin ?? builder.state.senderAccountIds;
    builder.updateField("entryTriggers", [...rules, rule]);
    setSelectedId(rule.id);
    setPickerOpen(false);
    setTab("rules");
  };
  const useAsSenders = () => {
    if (!selected) return;
    const senderAccounts = { ...builder.state.senderAccounts };
    for (const accountId of selected.accountIds) {
      const account = accounts.data?.accounts.find(item => item.id === accountId && item.status === "active");
      if (!account) continue;
      const channel = account.provider.toLowerCase() as keyof typeof senderAccounts;
      if (!CHANNELS.includes(channel)) continue;
      senderAccounts[channel] = [...new Set([...(senderAccounts[channel] ?? []), accountId])];
    }
    builder.updateFields({ senderAccounts, senderAccountIds: senderAccounts.linkedin ?? builder.state.senderAccountIds });
  };
  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Zap className="h-3.5 w-3.5" />
            CAMPAIGN ENTRY
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Start with the right moment.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Choose what brings a person into this campaign. ACA verifies the
            fit, records the decision, and starts your existing sequence.
          </p>
        </div>
        <Button variant="cta" disabled={rules.length >= 20} onClick={() => setPickerOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add trigger
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Fingerprint className="h-4 w-4 text-muted-foreground" />
          Match an event
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="inline-flex items-center gap-1.5 font-medium">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Qualify the person
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Zap className="h-4 w-4 text-muted-foreground" />
          Start the sequence
        </span>
        <Badge variant="outline" className="ml-auto font-normal">
          {active ? "Runs while campaign is active" : "Waiting for launch"}
        </Badge>
      </div>
      <div className="flex gap-5 border-b">
        <button
          type="button"
          className={cn(
            "border-b-2 pb-3 text-sm font-medium",
            tab === "rules"
              ? "border-amber-500"
              : "border-transparent text-muted-foreground",
          )}
          aria-pressed={tab === "rules"}
          onClick={() => setTab("rules")}
        >
          Entry rules{" "}
          <span className="ml-1.5 text-xs text-muted-foreground">
            {rules.length}
          </span>
        </button>
        <button
          type="button"
          className={cn(
            "border-b-2 pb-3 text-sm font-medium",
            tab === "activity"
              ? "border-amber-500"
              : "border-transparent text-muted-foreground",
          )}
          aria-pressed={tab === "activity"}
          onClick={() => setTab("activity")}
        >
          Activity & review
        </button>
      </div>
      {tab === "activity" ? (
        <CampaignTriggerActivity
          campaignId={campaignId}
          rules={rules}
          active={active}
        />
      ) : !rules.length ? (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ENTRY_TYPES.map((type) => {
              const Icon = ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => add(type)}
                  className="group flex flex-col items-start rounded-xl border bg-card p-5 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
                    <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                  </span>
                  <span className="text-sm font-semibold">
                    {ENTRY_CATALOG[type].title}
                  </span>
                  <span className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {ENTRY_CATALOG[type].description}
                  </span>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium">
                    Set up
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Triggers are optional. Your attached lists and existing
            lead-processing routes keep their own enrollment behavior. n8n and
            GHL remain responsible for broader workflow automation.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-2 lg:hidden">
            <Label htmlFor="trigger-rule-selector">Entry rule</Label>
            <Select value={selected?.id} onValueChange={setSelectedId}>
              <SelectTrigger id="trigger-rule-selector"><SelectValue /></SelectTrigger>
              <SelectContent>
                {rules.map(rule => <SelectItem key={rule.id} value={rule.id}>{rule.name || "Untitled trigger"}{rule.enabled ? "" : " · Paused"}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <aside aria-label="Entry rules" className="hidden space-y-2 lg:sticky lg:top-4 lg:block lg:max-h-[calc(100dvh-280px)] lg:overflow-y-auto">
            {rules.map((rule) => {
              const Icon = ICONS[rule.type] || Zap;
              return (
                <button
                  key={rule.id}
                  type="button"
                  aria-pressed={selected?.id === rule.id}
                  onClick={() => setSelectedId(rule.id)}
                  className={cn(
                    "flex w-full gap-3 rounded-xl border p-3 text-left transition-colors",
                    selected?.id === rule.id
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "bg-card hover:bg-muted/40",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {rule.name || "Untitled trigger"}
                    </span>
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                      {rule.enabled
                        ? entryRuleErrors(rule).length
                          ? "Needs setup"
                          : entryRuleSummary(rule)
                        : "Paused"}
                    </span>
                  </span>
                </button>
              );
            })}
            <Button
              variant="outline"
              className="w-full"
              disabled={rules.length >= 20} onClick={() => setPickerOpen(true)}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              Add another trigger
            </Button>
          </aside>
          {selected && (
            <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                <label className="flex items-center gap-2 text-xs font-medium">
                  <Switch
                    checked={selected.enabled}
                    onCheckedChange={(enabled) =>
                      update({ ...selected, enabled })
                    }
                    aria-label={`Enable ${selected.name}`}
                  />
                  {selected.enabled ? "Enabled" : "Paused"}
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${selected.name}`}
                  onClick={() => {
                    builder.updateField(
                      "entryTriggers",
                      rules.filter((rule) => rule.id !== selected.id),
                    );
                    setSelectedId(null);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="p-5 sm:p-6">
                <TriggerForm
                  key={selected.id}
                  rule={selected}
                  campaignId={campaignId}
                  onChange={update}
                  senderIds={senderIds}
                  onUseAsSenders={useAsSenders}
                  audienceListIds={builder.state.leadListIds}
                  autoEnrollNewMembers={builder.state.autoEnrollNewMembers}
                  onDisableOngoingEnrollment={() => builder.updateField("autoEnrollNewMembers", false)}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>What should start this campaign?</DialogTitle>
            <DialogDescription>
              Every source uses the same qualification and admission checks.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {ENTRY_TYPES.map((type) => {
              const Icon = ICONS[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => add(type)}
                  className="flex items-start gap-3 rounded-xl border p-4 text-left hover:border-amber-500/40 hover:bg-muted/40"
                >
                  <Icon className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block text-sm font-semibold">
                      {ENTRY_CATALOG[type].title}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {ENTRY_CATALOG[type].description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
