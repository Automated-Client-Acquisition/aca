import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import { isNativeDestination, ruleFor } from "@/lib/scheduler";
import { AccountAvatar, PlatformGlyph } from "./PlatformGlyph";

/** Marks a destination published without GHL: native LinkedIn, or the org's own Zernio account. */
export function NativeBadge({ provider }: { provider?: unknown }) {
  const zernio = provider === "zernio";
  return (
    <span
      className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
      title={zernio ? "Published through your Zernio account, not GHL" : "Published by ACA directly, not through GHL"}
    >
      {zernio ? "Zernio" : "Native"}
    </span>
  );
}

const linkButton =
  "rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/**
 * Searchable account list grouped by platform, for popovers that pick where posts go
 * (the composer's "Post to" and the agent's "Plan for"). Inactive accounts can be
 * unselected but not selected.
 */
export function AccountPickerList({
  accounts,
  selected,
  onChange,
  title,
}: {
  accounts: ConnectedAccount[];
  selected: string[];
  onChange: (ids: string[]) => void;
  title: string;
}) {
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Take focus before the popover does, so it lands on the search (or nowhere visible)
  // instead of ringing the first button.
  useEffect(() => {
    (searchRef.current ?? rootRef.current)?.focus();
  }, []);
  const selectable = useMemo(() => accounts.filter((a) => a.isActive).map((a) => a.id), [accounts]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byLabel = new Map<string, ConnectedAccount[]>();
    for (const a of accounts) {
      const label = ruleFor(a.platform).label;
      if (q && !a.name.toLowerCase().includes(q) && !label.toLowerCase().includes(q) && !(a.username ?? "").toLowerCase().includes(q)) continue;
      byLabel.set(label, [...(byLabel.get(label) ?? []), a]);
    }
    return [...byLabel.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [accounts, query]);

  const on = new Set(selected);
  const allOn = selectable.length > 0 && selectable.every((id) => on.has(id));
  const toggle = (id: string) => onChange(on.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const setGroup = (list: ConnectedAccount[], value: boolean) => {
    const ids = new Set(list.map((a) => a.id));
    onChange(value ? [...new Set([...selected, ...list.filter((a) => a.isActive).map((a) => a.id)])] : selected.filter((id) => !ids.has(id)));
  };

  return (
    <div ref={rootRef} tabIndex={-1} className="flex max-h-[min(28rem,calc(var(--radix-popover-content-available-height,70vh)-8px))] flex-col outline-none focus-visible:ring-0">
      <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
        <span className="text-xs font-medium text-muted-foreground">
          {title} <span className="tabular-nums">· {selected.length} of {accounts.length}</span>
        </span>
        <button type="button" className={linkButton} onClick={() => onChange(allOn ? [] : selectable)}>
          {allOn ? "Clear" : "Select all"}
        </button>
      </div>
      {accounts.length > 6 && (
        <div className="mx-2 mb-1 flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 focus-within:border-ring">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts or channels"
            className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
            aria-label="Search accounts"
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
        {groups.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No account matches.</p>}
        {groups.map(([label, list]) => {
          const groupOn = list.every((a) => on.has(a.id));
          return (
            <div key={label} className="pt-1.5">
              <div className="flex items-center justify-between px-2 pb-0.5">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <PlatformGlyph platform={list[0].platform} className="h-3 w-3" /> {label}
                  <span className="font-normal normal-case tracking-normal tabular-nums">{list.length}</span>
                </span>
                {list.length > 1 && (
                  <button type="button" className={linkButton} onClick={() => setGroup(list, !groupOn)}>
                    {groupOn ? "None" : "All"}
                  </button>
                )}
              </div>
              {list.map((a) => {
                const checked = on.has(a.id);
                const disabled = !a.isActive && !checked;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={disabled}
                    onClick={() => toggle(a.id)}
                    title={a.isValid === false ? "Needs reconnecting" : a.name}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                      !checked && "opacity-60 hover:opacity-100",
                      disabled && "cursor-not-allowed opacity-40 hover:opacity-40",
                    )}
                  >
                    <AccountAvatar name={a.name} avatarUrl={a.avatarUrl} platform={a.platform} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{a.name}</span>
                      {a.username && a.username !== a.name && <span className="block truncate text-[11px] text-muted-foreground">{a.username}</span>}
                    </span>
                    {isNativeDestination(a) && <NativeBadge provider={a.metadata?.provider} />}
                    <span
                      className={cn(
                        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors",
                        checked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40",
                      )}
                    >
                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
