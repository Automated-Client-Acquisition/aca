import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ExternalLink,
  Instagram,
  Linkedin,
  MessageCircle,
  RefreshCw,
  Send,
  Search,
  Settings,
  Unplug,
  UserRound,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignSetupSection } from "@/components/campaign-builder/CampaignSetupSection";
import {
  useAccountsWithLimits,
  type AccountWithLimits,
} from "@/hooks/useAccountsWithLimits";
import type { CampaignBuilderReturn } from "@/hooks/useCampaignBuilder";
import type { SenderAccountsByChannel } from "@/hooks/useCampaigns";
import { cn } from "@/lib/utils";

const accountName = (account: AccountWithLimits) =>
  account.display_name?.trim() ||
  [account.first_name, account.last_name].filter(Boolean).join(" ") ||
  account.username ||
  "Unnamed sender";

type SenderChannel = "linkedin" | "instagram" | "whatsapp" | "telegram";

// Unipile messaging channels a campaign can send from. campaign-processor reads
// campaigns.sender_accounts[channel] for each of them.
const SENDER_CHANNELS: {
  channel: SenderChannel;
  label: string;
  description: string;
  icon: typeof Linkedin;
  limit: (account: AccountWithLimits) => string;
  totalLabel: string;
  total: (account: AccountWithLimits) => number;
}[] = [
  {
    channel: "linkedin",
    label: "LinkedIn",
    description:
      "Connected accounts can send invitations, messages and InMails.",
    icon: Linkedin,
    limit: (account) => `${account.limits.connection_requests} invitations/day`,
    totalLabel: "invitations per day",
    total: (account) => account.limits.connection_requests,
  },
  {
    channel: "instagram",
    label: "Instagram",
    description:
      "Connected accounts send the campaign's Instagram DMs, follows and likes.",
    icon: Instagram,
    limit: (account) => `${account.limits.messages} messages/day`,
    totalLabel: "messages per day",
    total: (account) => account.limits.messages,
  },
  {
    channel: "whatsapp",
    label: "WhatsApp",
    description: "Connected accounts send the campaign's WhatsApp messages.",
    icon: MessageCircle,
    limit: (account) => `${account.limits.messages} messages/day`,
    totalLabel: "messages per day",
    total: (account) => account.limits.messages,
  },
  {
    channel: "telegram",
    label: "Telegram",
    description: "Connected accounts send the campaign's Telegram messages.",
    icon: Send,
    limit: (account) => `${account.limits.messages} messages/day`,
    totalLabel: "messages per day",
    total: (account) => account.limits.messages,
  },
];

type ChannelConfig = (typeof SENDER_CHANNELS)[number];

export function Step3Senders({ builder }: { builder: CampaignBuilderReturn }) {
  const { state, updateFields, validation } = builder;
  const query = useAccountsWithLimits();
  const { data, isLoading } = query;

  // Canonical channel state wins, including an intentional empty array. Legacy
  // campaigns still resolve their saved LinkedIn IDs when they have no channel entry.
  const selectedFor = (channel: SenderChannel) =>
    channel === "linkedin"
      ? (state.senderAccounts.linkedin ?? state.senderAccountIds)
      : (state.senderAccounts[channel] ?? []);

  // LinkedIn always shows; other channels once an account is connected or saved.
  const channels = SENDER_CHANNELS.filter(
    ({ channel }) =>
      channel === "linkedin" ||
      (data?.byChannel[channel]?.length ?? 0) > 0 ||
      selectedFor(channel).length > 0,
  );
  const shown = new Set<string>(channels.map(({ channel }) => channel));
  const otherChannelCount = isLoading
    ? 0
    : Object.entries(state.senderAccounts)
        .filter(([channel]) => !shown.has(channel))
        .reduce((sum, [, ids]) => sum + (ids?.length ?? 0), 0);

  const setSelection = (channel: SenderChannel, ids: string[]) => {
    const uniqueIds = [...new Set(ids)];
    const senderAccounts: SenderAccountsByChannel = {
      ...state.senderAccounts,
      [channel]: uniqueIds,
    };
    updateFields(
      channel === "linkedin"
        ? { senderAccounts, senderAccountIds: uniqueIds }
        : { senderAccounts },
    );
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Sender accounts</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose who sends your outreach on each channel. Actions are shared
          across the accounts you select.
        </p>
      </div>
      {validation.steps.senders.errors.length > 0 && (
        <div
          className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3"
          role="alert"
        >
          {validation.steps.senders.errors.map((error) => (
            <p
              key={error}
              className="flex items-start gap-2 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          ))}
        </div>
      )}

      {channels.map((config) => (
        <ChannelSenders
          key={config.channel}
          config={config}
          query={query}
          selectedIds={selectedFor(config.channel)}
          onChange={(ids) => setSelection(config.channel, ids)}
        />
      ))}

      {otherChannelCount > 0 && (
        <p className="text-xs text-muted-foreground">
          This campaign also has {otherChannelCount} saved{" "}
          {otherChannelCount === 1 ? "sender" : "senders"} on other channels.
        </p>
      )}
    </div>
  );
}

function ChannelSenders({
  config,
  query,
  selectedIds,
  onChange,
}: {
  config: ChannelConfig;
  query: ReturnType<typeof useAccountsWithLimits>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data, isLoading, isError, isFetching, refetch } = query;
  const [search, setSearch] = useState("");
  const Icon = config.icon;
  const accounts = data?.byChannel[config.channel] ?? [];
  const available = accounts.filter((account) => account.status === "active");
  const visible = available.filter((account) =>
    `${accountName(account)} ${account.username || ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const unavailableIds = selectedIds.filter(
    (id) => !available.some((account) => account.id === id),
  );
  const selectedAvailable = available.filter((account) =>
    selectedIds.includes(account.id),
  );
  const selectAccount = (id: string, selected: boolean) =>
    onChange(
      selected
        ? [...selectedIds, id]
        : selectedIds.filter((value) => value !== id),
    );

  return (
    <CampaignSetupSection
      title={`${config.label} senders`}
      description={config.description}
      action={
        <Badge variant="outline" className="gap-1.5 py-1">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          {selectedIds.length} selected
        </Badge>
      }
    >
      {isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="flex-1 text-sm">
            Couldn’t load sender accounts. Your saved selection is retained.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isFetching && "animate-spin")}
            />
            Retry
          </Button>
        </div>
      )}
      {isLoading ? (
        <div
          className="space-y-3"
          role="status"
          aria-label="Loading sender accounts"
        >
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {available.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative min-w-[180px] flex-1 sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  aria-label="Search sender accounts"
                  placeholder="Search senders…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9 pr-9"
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1 h-8 w-8"
                    aria-label="Clear sender search"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    !visible.length ||
                    visible.every((account) => selectedIds.includes(account.id))
                  }
                  onClick={() =>
                    onChange([
                      ...selectedIds,
                      ...visible.map((account) => account.id),
                    ])
                  }
                >
                  {search ? "Select visible" : "Select all"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!selectedIds.length}
                  onClick={() => onChange([])}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {visible.map((account) => (
              <SenderRow
                key={account.id}
                account={account}
                config={config}
                selected={selectedIds.includes(account.id)}
                onChange={(selected) => selectAccount(account.id, selected)}
              />
            ))}
          </div>
          {available.length > 0 && !visible.length && (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No senders match “{search}”.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearch("")}
                className="mt-2"
              >
                Clear search
              </Button>
            </div>
          )}
          {!available.length && !isError && (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center">
              <Icon className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">
                Connect a {config.label} sender
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add an account to send outreach from this campaign.
              </p>
              <Button variant="cta" size="sm" asChild className="mt-4">
                <Link to="/settings?tab=senders">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Connect {config.label}
                </Link>
              </Button>
            </div>
          )}
        </>
      )}

      {!isLoading && unavailableIds.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <div>
            <h4 className="text-sm font-medium">
              Saved senders needing attention
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Reconnect these accounts or remove them from this campaign.
            </p>
          </div>
          {unavailableIds.map((id) => {
            const account = accounts.find((value) => value.id === id);
            return (
              <div
                key={id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
              >
                <Unplug className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {account
                      ? accountName(account)
                      : "Saved sender unavailable"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {account
                      ? `${account.status.charAt(0).toUpperCase()}${account.status.slice(1)} · Unable to send`
                      : isError
                        ? "Account details could not be loaded."
                        : "This account is no longer available."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${account ? accountName(account) : "unavailable sender"} from campaign`}
                  onClick={() => selectAccount(id, false)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings?tab=senders">
              Review sender connections
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      )}
      {selectedAvailable.length > 0 && (
        <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          Selected accounts allow up to{" "}
          <span className="font-medium text-foreground">
            {selectedAvailable
              .reduce((sum, account) => sum + config.total(account), 0)
              .toLocaleString()}{" "}
            {config.totalLabel}
          </span>{" "}
          in total. These account limits are shared with other campaigns.
        </p>
      )}
    </CampaignSetupSection>
  );
}

function SenderRow({
  account,
  config,
  selected,
  onChange,
}: {
  account: AccountWithLimits;
  config: ChannelConfig;
  selected: boolean;
  onChange: (selected: boolean) => void;
}) {
  const name = accountName(account);
  const inputId = `campaign-sender-${config.channel}-${account.id}`;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
        selected ? "border-foreground/25 bg-muted/50" : "hover:bg-muted/30",
      )}
    >
      <Checkbox
        id={inputId}
        checked={selected}
        onCheckedChange={(value) => onChange(value === true)}
        aria-describedby={`${inputId}-limits`}
        className="shrink-0 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
      />
      <label
        htmlFor={inputId}
        className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-3"
      >
        <Avatar className="h-9 w-9 shrink-0" aria-hidden="true">
          <AvatarImage
            src={account.avatar_url || undefined}
            alt=""
            referrerPolicy="no-referrer"
          />
          <AvatarFallback className="text-xs">
            {initials || <UserRound className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {account.username
              ? `@${account.username}`
              : `${config.label} account`}
          </span>
        </span>
        <span
          id={`${inputId}-limits`}
          className="text-xs text-muted-foreground"
        >
          {config.limit(account)}
        </span>
      </label>
      <Button variant="ghost" size="icon" asChild className="h-8 w-8 shrink-0">
        <Link
          to={`/settings?tab=senders&edit=${account.id}`}
          aria-label={`Sender settings for ${name}`}
        >
          <Settings className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}
