import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlatformBadge, getPlatformConfig } from "@/components/autopilot/PlatformBadge";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import type { PublishDestination } from "@/types/autopilot";

/**
 * The accounts an autopilot posts to, as toggles. Every connected account is
 * listed; ones it already posts to that are no longer connected stay visible
 * so they can be removed.
 */
export function AccountChips({
  accounts,
  value,
  onChange,
  loading,
}: {
  accounts: ConnectedAccount[];
  value: PublishDestination[];
  onChange: (next: PublishDestination[]) => void;
  loading?: boolean;
}) {
  const selected = (id: string) => value.some((d) => d.account_id === id && d.enabled);
  const toggle = (acc: ConnectedAccount) => {
    if (selected(acc.id)) {
      onChange(value.filter((d) => d.account_id !== acc.id));
    } else if (value.some((d) => d.account_id === acc.id)) {
      onChange(value.map((d) => (d.account_id === acc.id ? { ...d, platform: acc.platform, enabled: true } : d)));
    } else {
      onChange([...value, { account_id: acc.id, platform: acc.platform, enabled: true }]);
    }
  };
  const [showAll, setShowAll] = useState(false);
  const missing = value.filter((d) => d.enabled && !accounts.some((a) => a.id === d.account_id));
  // Agencies connect dozens of accounts: the ones it already posts to first, a few
  // others, the rest on request. The order is fixed on load so chips don't move
  // under the pointer as they're toggled.
  const firstChosen = useRef<Set<string> | null>(null);
  if (firstChosen.current === null && !loading && accounts.length > 0) {
    firstChosen.current = new Set(value.filter((d) => d.enabled).map((d) => d.account_id));
  }
  const pinnedFirst = firstChosen.current ?? new Set<string>();
  const ordered = [
    ...accounts.filter((a) => pinnedFirst.has(a.id)),
    ...accounts.filter((a) => !pinnedFirst.has(a.id) && (a.isActive || selected(a.id))),
  ];
  const limit = pinnedFirst.size + (pinnedFirst.size ? 4 : 8);
  const listed = showAll ? ordered : ordered.filter((a, i) => i < limit || selected(a.id));
  const hidden = ordered.length - listed.length;

  if (loading) return <div className="h-12 animate-pulse rounded-lg bg-muted" />;

  if (ordered.length === 0 && missing.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No accounts connected yet.{" "}
        <Link to="/settings?tab=integrations" className="font-medium text-foreground underline underline-offset-2">
          Connect one in Settings
        </Link>
        , or keep drafts for now.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {listed.map((acc) => {
        const on = selected(acc.id);
        const broken = !acc.isValid;
        return (
          <button
            key={acc.id}
            type="button"
            aria-pressed={on}
            disabled={broken && !on}
            onClick={() => toggle(acc)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2.5 rounded-xl border py-1.5 pl-1.5 pr-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              on ? "border-foreground bg-background shadow-sm" : "bg-muted/40 hover:bg-muted",
              on && broken && "border-destructive",
            )}
          >
            <PlatformBadge platform={acc.platform} name={acc.name} avatarUrl={acc.avatarUrl} showLabel={false} size="md" className="h-8 w-8 justify-center px-0" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="max-w-[11rem] truncate text-sm font-medium">{acc.name || acc.username}</span>
              <span className={cn("text-[11px]", broken ? "text-destructive" : "text-muted-foreground")}>
                {getPlatformConfig(acc.platform).label}
                {broken ? " · reconnect in Settings" : ""}
              </span>
            </span>
            <span
              className={cn(
                "ml-1 flex h-5 w-5 items-center justify-center rounded-full border",
                on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40",
              )}
              aria-hidden
            >
              {on && <Check className="h-3 w-3" />}
            </span>
          </button>
        );
      })}
      {missing.map((d) => (
        <span key={d.account_id} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 py-1.5 pl-3 pr-1.5 text-sm">
          <span className="flex flex-col leading-tight">
            <span className="font-medium">Account not connected</span>
            <span className="text-[11px] text-muted-foreground">{getPlatformConfig(d.platform).label}</span>
          </span>
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x.account_id !== d.account_id))}
            aria-label="Remove this account"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </span>
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setShowAll(true)} className="inline-flex min-h-11 items-center rounded-xl border border-dashed px-3 text-sm font-medium hover:bg-muted">
          Show {hidden} more account{hidden === 1 ? "" : "s"}
        </button>
      )}
      <Link to="/settings?tab=integrations" className="inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        Connect another account
      </Link>
    </div>
  );
}
