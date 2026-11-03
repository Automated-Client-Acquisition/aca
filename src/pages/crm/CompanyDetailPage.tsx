import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { format, formatDistanceToNow } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { LinkedDealsCard } from "@/components/deals/LinkedDealsCard";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Building2, Globe, Linkedin, Sparkles, Mail, Activity,
  Users, Loader2, ExternalLink, MapPin, Briefcase, Calendar, User as UserIcon,
  TrendingUp, Send, Hash, Plus,
} from "lucide-react";
import {
  useCrmCompany,
  useCompanyContacts,
  useCompanySignalHistory,
  useUpdateCrmCompany,
  useEnrichCrmCompany,
  ACCOUNT_STAGE_OPTIONS,
  type CrmAccountStage,
  type CrmCompany,
} from "@/hooks/useCrmCompanies";

function fmtRel(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return "—"; }
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "—";
}

function getStageColor(status: CrmAccountStage): string {
  return ACCOUNT_STAGE_OPTIONS.find((o) => o.value === status)?.color ?? "";
}

// ============================================================================
// Hero — dense, single-block company identity. Logo + name + lifecycle
// pill (clickable, opens lifecycle change popover) + meta line + quick action
// links. Replaces the previous 3-section hero that took half the viewport.
// ============================================================================
function CompanyHero({
  company,
  onUpdateStage,
}: {
  company: CrmCompany;
  onUpdateStage: (v: CrmAccountStage) => void;
}) {
  const metaItems: Array<{ icon: React.ComponentType<{ className?: string }>; text: string }> = [];
  if (company.industry) metaItems.push({ icon: Briefcase, text: company.industry });
  if (company.country) {
    const loc = [company.city, company.country].filter(Boolean).join(", ");
    metaItems.push({ icon: MapPin, text: loc });
  }
  if (company.employee_count) metaItems.push({ icon: Users, text: `${company.employee_count.toLocaleString()} employees` });

  return (
    <div className="flex items-start gap-4 pb-4 border-b">
      <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden">
        {company.logo_url ? (
          <img src={company.logo_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Building2 className="h-7 w-7 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Name + lifecycle */}
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold truncate">{company.name}</h1>
          <Select value={company.account_stage} onValueChange={(v) => onUpdateStage(v as CrmAccountStage)}>
            <SelectTrigger className={`w-auto h-7 px-2 text-xs gap-1 border ${getStageColor(company.account_stage)}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_STAGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Meta line */}
        {metaItems.length > 0 && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            {metaItems.map(({ icon: Icon, text }, i) => (
              <span key={i} className="flex items-center gap-1">
                <Icon className="h-3 w-3" />
                {text}
              </span>
            ))}
          </div>
        )}

        {/* Quick links + last activity */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {company.website_url && (
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" asChild>
              <a href={company.website_url} target="_blank" rel="noreferrer">
                <Globe className="h-3 w-3 mr-1.5" /> Website
              </a>
            </Button>
          )}
          {company.linkedin_url && (
            <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" asChild>
              <a href={company.linkedin_url} target="_blank" rel="noreferrer">
                <Linkedin className="h-3 w-3 mr-1.5" /> LinkedIn
              </a>
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            Last activity {fmtRel(company.last_signal_at ?? company.last_contact_at ?? company.updated_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Right sidebar — company facts (always visible) + enrichment trigger
// (small inline) + notes. Sticky on desktop.
// ============================================================================
function CompanySidebar({
  company,
  onEnrich,
  enriching,
  onUpdate,
}: {
  company: CrmCompany;
  onEnrich: () => void;
  enriching: boolean;
  onUpdate: (patch: Partial<CrmCompany>) => void;
}) {
  const [notesDraft, setNotesDraft] = useState<string | null>(null);

  const detailRows: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }> = [
    {
      icon: Globe,
      label: "Domain",
      value: company.domain ?? <span className="text-muted-foreground italic">—</span>,
    },
    {
      icon: Briefcase,
      label: "Industry",
      value: company.industry ?? <span className="text-muted-foreground italic">—</span>,
    },
    {
      icon: Users,
      label: "Headcount",
      value: company.employee_count?.toLocaleString() ?? <span className="text-muted-foreground italic">—</span>,
    },
    {
      icon: MapPin,
      label: "HQ",
      value: [company.city, company.country].filter(Boolean).join(", ") || <span className="text-muted-foreground italic">—</span>,
    },
    {
      icon: Calendar,
      label: "First seen",
      value: company.first_seen_at ? format(new Date(company.first_seen_at), "MMM d, yyyy") : <span className="text-muted-foreground italic">—</span>,
    },
  ];

  return (
    <div className="space-y-4 lg:sticky lg:top-4">
      {/* About */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {detailRows.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-2 text-sm">
              <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0 flex justify-between gap-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-sm font-medium truncate text-right">{value}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Enrichment — small panel, no longer the loudest element */}
      <Card className={company.enrichment_data ? "" : "border-dashed"}>
        <CardContent className="py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className={`h-3.5 w-3.5 ${company.enrichment_data ? "text-amber-600" : "text-muted-foreground"}`} />
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex-1">Enrichment</span>
            {company.enrichment_data && (
              <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-500/30 text-amber-700">
                Synced
              </Badge>
            )}
          </div>
          {company.enrichment_data ? (
            <>
              <p className="text-xs text-muted-foreground">
                Updated {fmtRel(company.enrichment_updated_at)} via {company.enrichment_source ?? "SignalBase"}
              </p>
              <Button variant="outline" size="sm" className="w-full h-7 text-xs" disabled={enriching} onClick={onEnrich}>
                {enriching ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <Sparkles className="h-3 w-3 mr-1.5" />}
                Refresh
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Pull funding, hiring, key people from SignalBase. ~$0.01–0.05 per company.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="cta" size="sm" className="w-full h-7 text-xs" disabled={enriching}>
                    {enriching ? (
                      <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Enriching…</>
                    ) : (
                      <><Sparkles className="h-3 w-3 mr-1.5" /> Enrich now</>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Enrich {company.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This calls the SignalBase Apify actor and consumes Apify credits (typically
                      $0.01-0.05). You can re-enrich anytime to refresh.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onEnrich}>Enrich now</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </CardContent>
      </Card>

      {/* Tags */}
      <Card>
        <CardContent className="py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex-1">Tags</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {(company.tags ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground italic">No tags yet</span>
            ) : (
              (company.tags ?? []).map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px] py-0 h-5">{t}</Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Internal notes…"
            value={notesDraft ?? company.notes ?? ""}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={() => {
              if (notesDraft !== null && notesDraft !== (company.notes ?? "")) {
                onUpdate({ notes: notesDraft });
                setNotesDraft(null);
              }
            }}
            className="min-h-[100px] text-sm"
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Contact row — avatar w/ initials, name + title + verified email indicator,
// inline action buttons.
// ============================================================================
interface ContactRowProps {
  contact: {
    id: string;
    display_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    primary_linkedin_url?: string | null;
    job_title?: string | null;
    discovery_score?: number | null;
  };
}

function ContactRow({ contact }: ContactRowProps) {
  const name = contact.display_name ?? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ?? "Unnamed";

  return (
    <div className="flex items-center gap-3 py-3 px-3 hover:bg-muted/30 rounded-md transition group">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 text-xs font-semibold text-primary">
        {initials(name)}
      </div>

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link to={`/people/${contact.id}`} className="font-medium text-sm truncate hover:underline">
            {name}
          </Link>
          {contact.discovery_score !== null && contact.discovery_score !== undefined && (
            <Badge variant="outline" className="text-[9px] py-0 h-4">ICP {contact.discovery_score}</Badge>
          )}
        </div>
        {contact.job_title && (
          <p className="text-xs text-muted-foreground truncate" title={contact.job_title}>
            {contact.job_title}
          </p>
        )}
        {contact.primary_email && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
            <Mail className="h-3 w-3" />
            <span className="truncate">{contact.primary_email}</span>
            <span className="text-emerald-600">✓</span>
          </div>
        )}
      </div>

      {/* Quick actions — show on hover for cleaner list */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition">
        {contact.primary_email && (
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a href={`mailto:${contact.primary_email}`} aria-label="Email">
              <Send className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        {contact.primary_linkedin_url && (
          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
            <a href={contact.primary_linkedin_url} target="_blank" rel="noreferrer" aria-label="LinkedIn">
              <Linkedin className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
          <Link to={`/people/${contact.id}`} aria-label="Open contact"><ExternalLink className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================
export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const company = useCrmCompany(id);
  const contacts = useCompanyContacts(id);
  const signals = useCompanySignalHistory(id);
  const updateCompany = useUpdateCrmCompany();
  const enrich = useEnrichCrmCompany();

  if (company.isLoading) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="container mx-auto py-6 max-w-6xl space-y-4">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-24 w-full" />
          <div className="grid lg:grid-cols-3 gap-4">
            <Skeleton className="h-96 lg:col-span-2" />
            <Skeleton className="h-96" />
          </div>
        </div>
      </AppLayout>
    );
  }

  const c = company.data;
  if (!c) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="container mx-auto py-6 max-w-2xl">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/crm/companies"><ArrowLeft className="h-4 w-4 mr-2" /> All companies</Link>
          </Button>
          <p className="text-sm text-muted-foreground mt-4">Company not found.</p>
        </div>
      </AppLayout>
    );
  }

  // Enrichment payload (when present)
  const enrichmentData = (c.enrichment_data ?? {}) as {
    funding_history?: Array<{ round?: string; amount?: number | string; date?: string; investors?: string[] }>;
    headcount_history?: Array<{ date?: string; count?: number }>;
    key_people?: Array<{ name?: string; title?: string; linkedin?: string }>;
    open_positions?: Array<{ title?: string; location?: string; date_posted?: string; url?: string }>;
  };
  const fundingHistory = Array.isArray(enrichmentData.funding_history) ? enrichmentData.funding_history : [];
  const keyPeople = Array.isArray(enrichmentData.key_people) ? enrichmentData.key_people : [];
  const openPositions = Array.isArray(enrichmentData.open_positions) ? enrichmentData.open_positions : [];

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="container mx-auto py-6 max-w-6xl space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/crm/companies"><ArrowLeft className="h-4 w-4 mr-2" /> All companies</Link>
        </Button>

        <CompanyHero
          company={c}
          onUpdateStage={(v) => updateCompany.mutate({ id: c.id, patch: { account_stage: v } })}
        />

        <div className="grid lg:grid-cols-3 gap-6">
          {/* MAIN COLUMN — contacts + activity timeline */}
          <div className="lg:col-span-2 space-y-6">
            <LinkedDealsCard company={{ id: c.id, name: c.name, domain: c.domain }} />

            {/* Contacts */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Contacts
                    <Badge variant="outline" className="ml-1 text-xs">
                      {(contacts.data ?? []).length}
                    </Badge>
                  </CardTitle>
                  <Button variant="outline" size="sm" disabled>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Find more
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-3">
                {contacts.isLoading ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}
                  </div>
                ) : (contacts.data ?? []).length === 0 ? (
                  <div className="py-8 text-center space-y-2">
                    <Users className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No contacts at this company yet.</p>
                    <p className="text-xs text-muted-foreground">
                      Run a signal that targets this company, or import contacts manually.
                    </p>
                  </div>
                ) : (
                  <div className="-mx-3 divide-y">
                    {(contacts.data ?? []).map((p) => <ContactRow key={p.id} contact={p} />)}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Activity timeline */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Timeline
                  <Badge variant="outline" className="ml-1 text-xs">
                    {(signals.data ?? []).length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {signals.isLoading ? (
                  <Skeleton className="h-24" />
                ) : (signals.data ?? []).length === 0 ? (
                  <div className="py-6 text-center space-y-2">
                    <Activity className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                    <p className="text-sm text-muted-foreground">No signals fired for this company yet.</p>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                      When a Signal subscription matches this company (funding, hiring, leadership change),
                      every event lands here as a timeline entry.
                    </p>
                    <Button variant="outline" size="sm" className="mt-2" asChild>
                      <Link to="/signals/dashboard">
                        <TrendingUp className="h-3.5 w-3.5 mr-1.5" /> Manage Signals
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(signals.data ?? []).slice(0, 20).map((s) => (
                      <div key={s.id} className="flex gap-3 text-sm">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                          <Activity className="h-3.5 w-3.5 text-emerald-600" />
                        </div>
                        <div className="flex-1 min-w-0 pb-3 border-b last:border-b-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="secondary" className="text-[10px] py-0 h-4 capitalize">
                              {(s.signal_type ?? "").replace(/_/g, " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground">{fmtRel(s.created_at)}</span>
                          </div>
                          {s.signal_detail && (
                            <p className="text-sm mt-0.5 leading-snug">{s.signal_detail}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Enrichment-derived sections — only when present */}
            {fundingHistory.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Sparkles className="h-4 w-4 text-amber-600" />
                    Funding history
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {fundingHistory.map((f, i) => (
                      <div key={i} className="flex items-center justify-between border rounded-md px-3 py-2.5 hover:bg-muted/30 transition">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="text-xs">{f.round ?? "—"}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {f.date ? format(new Date(f.date), "MMM yyyy") : ""}
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-base">${typeof f.amount === "number" ? f.amount.toLocaleString() : f.amount}</div>
                          {Array.isArray(f.investors) && f.investors.length > 0 && (
                            <div className="text-xs text-muted-foreground">{f.investors.slice(0, 3).join(", ")}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {keyPeople.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <UserIcon className="h-4 w-4 text-muted-foreground" />
                    Key people (SignalBase)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {keyPeople.map((p, i) => (
                      <div key={i} className="border rounded-md px-3 py-2 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-semibold text-muted-foreground">
                          {initials(p.name ?? "")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{p.title}</p>
                        </div>
                        {p.linkedin && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <a href={p.linkedin} target="_blank" rel="noreferrer"><Linkedin className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {openPositions.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    Open positions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {openPositions.slice(0, 10).map((j, i) => (
                      <div key={i} className="flex items-center justify-between py-2.5 text-sm">
                        <div>
                          <span className="font-medium">{j.title}</span>
                          {j.location && <span className="text-muted-foreground ml-2">· {j.location}</span>}
                        </div>
                        {j.url && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                            <a href={j.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* SIDEBAR */}
          <CompanySidebar
            company={c}
            onEnrich={() => enrich.mutate(c.id)}
            enriching={enrich.isPending}
            onUpdate={(patch) => updateCompany.mutate({ id: c.id, patch })}
          />
        </div>
      </div>
    </AppLayout>
  );
}
