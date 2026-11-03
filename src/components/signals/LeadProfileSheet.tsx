import type { MouseEvent, ReactNode } from "react";
import { Building2, Check, Copy, ExternalLink, Globe, Linkedin, ListPlus, Mail, UserRound } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SignalTypeBadge, humanizeSignalType } from "@/components/signals/SignalTypeBadge";
import { firmographicColumns, type FirmographicFields } from "@/components/signals/signal-columns";
import { signalDateAnchor } from "@/lib/signals";

/**
 * One lead as the profile drawer needs it, normalized from whichever table the
 * click came from (the public signal library, or the org's own custom-signal
 * leads). Both tables already carry every field, so opening a profile costs no
 * extra round-trip — the drawer renders the row it was handed.
 */
export interface LeadProfile {
  /** Stable identity for the sheet; also the React key when re-opening. */
  key: string;
  name: string;
  title?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  emailStatus?: string | null;
  linkedinUrl?: string | null;
  company?: string | null;
  domain?: string | null;
  /** Custom leads carry a full URL; public-library leads only a bare domain. */
  websiteUrl?: string | null;
  signalType: string;
  /** The custom branch names its signals ("Series A raised"); the public one doesn't. */
  signalLabel?: string | null;
  signalDate?: string | null;
  sourceUrl?: string | null;
  /** Set for leads that are already CRM contacts — links to the full record. */
  contactId?: string | null;
  firmographics: FirmographicFields;
}

/**
 * True when a click landed on something that already does its own thing
 * (checkbox, LinkedIn icon, mailto link, source link). Row-level click handlers
 * use this so opening the profile never steals those clicks.
 */
export function isInteractiveClick(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest('a, button, input, label, [role="checkbox"]'));
}

const EMPTY = <span className="text-muted-foreground/50">&mdash;</span>;

/** Signal dates are date-only; anchor them the way the tables do (see relativeDate there). */
function signalDateParts(value?: string | null): { relative: string; absolute: string } | null {
  if (!value) return null;
  const anchor = signalDateAnchor(value) ?? new Date(value);
  if (Number.isNaN(anchor.getTime())) return null;
  try {
    return {
      relative: formatDistanceToNowStrict(anchor, { addSuffix: true, roundingMethod: "floor" }),
      absolute: format(anchor, "d MMM yyyy"),
    };
  } catch {
    return null;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-start gap-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border p-4">
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <dl className="divide-y">{children}</dl>
    </section>
  );
}

/**
 * An external URL as a value. Source URLs run to hundreds of characters
 * (LinkedIn post links carry their whole tracking tail), so the link truncates
 * inside its cell and the full URL lives in the tooltip — a bare `truncate` on
 * the anchor is not enough, since an inline-flex anchor sizes to its content
 * and pushes past the card.
 */
function LinkValue({ href, label }: { href: string; label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={href}
        className="min-w-0 flex-1 truncate hover:underline"
      >
        {label ?? href.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
    </div>
  );
}

export function LeadProfileSheet({
  lead,
  onOpenChange,
  lists,
  onAddToList,
  addPending,
}: {
  lead: LeadProfile | null;
  onOpenChange: (open: boolean) => void;
  /** Optional "Add to list" action — omitted where the caller has none. */
  lists?: Array<{ id: string; name: string }>;
  onAddToList?: (listId: string) => void;
  addPending?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copyEmail = async () => {
    if (!lead?.email) return;
    try {
      await navigator.clipboard.writeText(lead.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Unable to copy the email address");
    }
  };

  const date = signalDateParts(lead?.signalDate);
  // Firmographics render from the same descriptors the tables use, so a value
  // never formats one way in a column and another way here. The profile shows
  // all of them, including the ones the tables hide by default.
  const firmographics = firmographicColumns<FirmographicFields>();
  const website = lead?.websiteUrl || (lead?.domain ? `https://${lead.domain}` : null);

  return (
    <Sheet open={Boolean(lead)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {lead && (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-start gap-3">
                {lead.photoUrl ? (
                  <img
                    src={lead.photoUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-semibold text-primary">
                    {lead.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{lead.name}</SheetTitle>
                  <SheetDescription className="text-sm">
                    {lead.title || "Decision maker"}
                    {lead.company ? ` · ${lead.company}` : ""}
                  </SheetDescription>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-3">
                {lead.linkedinUrl && (
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <a href={lead.linkedinUrl} target="_blank" rel="noreferrer">
                      <Linkedin className="mr-1.5 h-3.5 w-3.5" /> LinkedIn
                    </a>
                  </Button>
                )}
                {lead.email && (
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <a href={`mailto:${lead.email}`}>
                      <Mail className="mr-1.5 h-3.5 w-3.5" /> Email
                    </a>
                  </Button>
                )}
                {website && (
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <a href={website} target="_blank" rel="noreferrer">
                      <Globe className="mr-1.5 h-3.5 w-3.5" /> Website
                    </a>
                  </Button>
                )}
                {lead.contactId && (
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <a href={`/people/${lead.contactId}`}>
                      <UserRound className="mr-1.5 h-3.5 w-3.5" /> Full CRM profile
                    </a>
                  </Button>
                )}
                {lists && onAddToList && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="cta" className="h-8" disabled={addPending}>
                        <ListPlus className="mr-1.5 h-3.5 w-3.5" /> Add to list
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                      <DropdownMenuLabel>Add this lead to…</DropdownMenuLabel>
                      {lists.length ? (
                        lists.map((list) => (
                          <DropdownMenuItem key={list.id} onClick={() => onAddToList(list.id)}>
                            {list.name}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <DropdownMenuItem disabled>No active lists available</DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </SheetHeader>

            {/* Bottom padding so the last card clears the drawer's edge
                instead of ending flush against it. */}
            <div className="mt-5 space-y-4 pb-8">
              <Section title="Contact">
                <Row label="Email">
                  {lead.email ? (
                    <div className="flex items-center gap-2">
                      <a href={`mailto:${lead.email}`} className="min-w-0 truncate hover:underline" title={lead.email}>
                        {lead.email}
                      </a>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={copyEmail}
                        aria-label="Copy email address"
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                      {lead.emailStatus && (
                        <Badge variant="secondary" className="shrink-0 font-normal">
                          {humanizeSignalType(lead.emailStatus)}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No verified email yet</span>
                  )}
                </Row>
                <Row label="LinkedIn">
                  {lead.linkedinUrl ? <LinkValue href={lead.linkedinUrl} /> : EMPTY}
                </Row>
                <Row label="Title">{lead.title || EMPTY}</Row>
              </Section>

              <Section title="Company">
                <Row label="Name">
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {lead.company || EMPTY}
                  </span>
                </Row>
                <Row label="Domain">
                  {lead.domain ? (
                    <a href={`https://${lead.domain}`} target="_blank" rel="noreferrer" className="hover:underline">
                      {lead.domain}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Domain pending</span>
                  )}
                </Row>
                {firmographics.map((column) => (
                  <Row key={column.id} label={column.label}>
                    {column.cell(lead.firmographics)}
                  </Row>
                ))}
              </Section>

              <Section title="Why now">
                <Row label="Signal">
                  <div className="flex flex-wrap items-center gap-2">
                    <SignalTypeBadge type={lead.signalType} />
                    {lead.signalLabel && (
                      <span className="text-muted-foreground">{humanizeSignalType(lead.signalLabel)}</span>
                    )}
                  </div>
                </Row>
                <Row label="Date">
                  {date ? (
                    <span>
                      {date.relative} <span className="text-muted-foreground">· {date.absolute}</span>
                    </span>
                  ) : (
                    EMPTY
                  )}
                </Row>
                <Row label="Source">
                  {lead.sourceUrl ? <LinkValue href={lead.sourceUrl} /> : EMPTY}
                </Row>
              </Section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
