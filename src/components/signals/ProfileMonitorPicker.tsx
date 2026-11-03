import { useState, useMemo } from "react";
import {
  Plus, Library, Linkedin, X, BadgeCheck, Search, Building2, Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useCreators, type Creator } from "@/hooks/useCreators";
import { toast } from "sonner";

// ============================================================================
// ProfileMonitorPicker — pasted-or-imported list of LinkedIn profile/company
// URLs, used by the LinkedIn Post Engagement signal in profile-monitor mode.
//
// UX principles applied:
// - Selected profiles are the always-visible primary surface (chips with
//   avatars). The two add-paths are SECONDARY actions ("+ Paste URLs",
//   "Import from Creators") so the user always sees what they've selected.
// - Validation is non-blocking — paste any text, we extract valid URLs,
//   silently dedupe, toast a summary ("Added 3, skipped 2 duplicates").
// - The Creators import surfaces avatar + follower count + tags, defaulting
//   to LinkedIn-only since this picker is LinkedIn-specific. User can
//   override the platform filter if they want to import a YouTuber whose
//   LinkedIn URL is on file.
// - Cost transparency at the bottom: profile count drives the per-refresh
//   estimate so the user knows what they're committing to.
// ============================================================================

interface ProfileMonitorPickerProps {
  /** Comma-separated array of LinkedIn URLs already in the sub. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Soft cap shown as a warning (not enforced). */
  recommendedMax?: number;
}

// LinkedIn URL extraction — accepts /in/<slug> or /company/<slug>, with or
// without protocol/locale prefix. Returns the canonical https://linkedin.com
// form so dedup is consistent.
function normalizeLinkedinUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // Allow bare slugs like "linkedin.com/in/alex" by prepending https://
  const withProto = t.startsWith("http") ? t : `https://${t}`;
  let url: URL;
  try { url = new URL(withProto); } catch { return null; }
  if (!/linkedin\.com$/i.test(url.host) && !/linkedin\.com$/i.test(url.host.replace(/^[a-z]{2}\./, ""))) {
    return null;
  }
  // Pull /in/<slug> or /company/<slug>
  const match = url.pathname.match(/^\/(in|company)\/([^/?#]+)/i);
  if (!match) return null;
  return `https://www.linkedin.com/${match[1].toLowerCase()}/${match[2]}`;
}

function extractName(url: string): string {
  // /in/alex-smith-123abc → "alex smith"  (drop trailing identifier hash)
  const slug = url.split("/").pop() ?? "";
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\s\d+\w*$/, "")
    .trim()
    || "LinkedIn profile";
}

function isCompanyUrl(url: string): boolean {
  return url.includes("/company/");
}

// ----------------------------------------------------------------------------
// Single profile chip — avatar + name + remove.
// ----------------------------------------------------------------------------
function ProfileChip({
  url,
  creator,
  onRemove,
}: {
  url: string;
  creator?: Creator;
  onRemove: () => void;
}) {
  const isCompany = isCompanyUrl(url);
  const displayName = creator?.display_name ?? extractName(url);
  const avatarSrc = creator?.avatar_url ?? null;

  return (
    <div className="group flex items-center gap-2 px-2 py-1 rounded-md border bg-background hover:border-primary/40 transition">
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
        {avatarSrc ? (
          <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
        ) : isCompany ? (
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Linkedin className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate max-w-[12rem]">{displayName}</p>
          {creator?.verified && <BadgeCheck className="h-3 w-3 text-blue-500 shrink-0" />}
        </div>
        <p className="text-[10px] text-muted-foreground truncate max-w-[14rem]" title={url}>
          {url.replace(/^https?:\/\/www\.linkedin\.com\//, "linkedin.com/")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition shrink-0"
        onClick={onRemove}
        aria-label={`Remove ${displayName}`}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Bulk paste dialog
// ----------------------------------------------------------------------------
function PasteUrlsDialog({
  open,
  onOpenChange,
  existingUrls,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingUrls: string[];
  onAdd: (urls: string[]) => void;
}) {
  const [text, setText] = useState("");

  // Real-time validation breakdown so the user sees what's valid before
  // they commit.
  const breakdown = useMemo(() => {
    const lines = text.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
    const seenInBatch = new Set<string>();
    const valid: string[] = [];
    const duplicate: string[] = [];
    const invalid: string[] = [];
    for (const line of lines) {
      const norm = normalizeLinkedinUrl(line);
      if (!norm) { invalid.push(line); continue; }
      if (existingUrls.includes(norm) || seenInBatch.has(norm)) {
        duplicate.push(line);
        continue;
      }
      seenInBatch.add(norm);
      valid.push(norm);
    }
    return { valid, duplicate, invalid };
  }, [text, existingUrls]);

  const handleAdd = () => {
    if (breakdown.valid.length === 0) {
      toast.error("No new LinkedIn URLs to add");
      return;
    }
    onAdd(breakdown.valid);
    const skipped = breakdown.duplicate.length + breakdown.invalid.length;
    toast.success(
      `Added ${breakdown.valid.length} ${breakdown.valid.length === 1 ? "profile" : "profiles"}` +
      (skipped > 0 ? ` · skipped ${skipped} (${breakdown.invalid.length} invalid, ${breakdown.duplicate.length} duplicate)` : "")
    );
    setText("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Paste LinkedIn URLs</DialogTitle>
          <DialogDescription>
            One URL per line. Profile (<code className="text-[11px] px-1 py-0.5 bg-muted rounded">linkedin.com/in/...</code>)
            or company (<code className="text-[11px] px-1 py-0.5 bg-muted rounded">linkedin.com/company/...</code>).
            We'll silently dedupe + drop invalid lines.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={8}
          placeholder={`https://linkedin.com/in/competitor-ceo
https://linkedin.com/in/competitor-cmo
https://linkedin.com/company/competitor-co`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="font-mono text-xs"
        />
        {text.trim() && (
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-emerald-600 font-medium">{breakdown.valid.length} ready to add</span>
              {breakdown.duplicate.length > 0 && (
                <span className="text-muted-foreground">{breakdown.duplicate.length} duplicate</span>
              )}
              {breakdown.invalid.length > 0 && (
                <span className="text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {breakdown.invalid.length} invalid
                </span>
              )}
            </div>
            {breakdown.invalid.length > 0 && breakdown.invalid.length <= 3 && (
              <p className="text-muted-foreground text-[11px]">
                Skipped: {breakdown.invalid.slice(0, 3).map((l) => `"${l.slice(0, 30)}"`).join(", ")}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={breakdown.valid.length === 0}>
            Add {breakdown.valid.length || ""} {breakdown.valid.length === 1 ? "profile" : "profiles"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Creators import dialog — search, filter, multi-select, add.
// ----------------------------------------------------------------------------
function ImportCreatorsDialog({
  open,
  onOpenChange,
  existingUrls,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existingUrls: string[];
  onAdd: (urls: string[]) => void;
}) {
  const { creators, isLoading } = useCreators();
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"linkedin" | "all">("linkedin");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Filter to creators that have a LinkedIn URL we can monitor. If the user
  // toggles to "All platforms", surface every creator (some YouTubers have
  // a LinkedIn URL stored in metadata even on a YouTube row).
  const filtered = useMemo(() => {
    let list = (creators ?? []) as Creator[];
    if (platformFilter === "linkedin") {
      list = list.filter((c) => c.platform === "linkedin" && !!c.channel_url);
    } else {
      list = list.filter((c) => !!c.channel_url);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) =>
        c.display_name?.toLowerCase().includes(q)
        || c.tags?.some((t) => t.toLowerCase().includes(q))
        || c.description?.toLowerCase().includes(q)
      );
    }
    // Already-monitored ones are still shown but with a flag — easier for
    // user to see what's already in the sub vs. genuinely new.
    return list;
  }, [creators, platformFilter, search]);

  const isAlreadyMonitored = (creator: Creator) => {
    const norm = normalizeLinkedinUrl(creator.channel_url ?? "");
    return norm ? existingUrls.includes(norm) : false;
  };

  const toggleSelect = (creator: Creator) => {
    if (isAlreadyMonitored(creator)) return;
    const next = new Set(selected);
    if (next.has(creator.id)) next.delete(creator.id);
    else next.add(creator.id);
    setSelected(next);
  };

  const handleAdd = () => {
    const selectedCreators = filtered.filter((c) => selected.has(c.id));
    const urls: string[] = [];
    for (const c of selectedCreators) {
      const norm = normalizeLinkedinUrl(c.channel_url ?? "");
      if (norm && !existingUrls.includes(norm)) urls.push(norm);
    }
    if (urls.length === 0) {
      toast.error("Nothing to import");
      return;
    }
    onAdd(urls);
    toast.success(`Added ${urls.length} ${urls.length === 1 ? "profile" : "profiles"} from Creators`);
    setSelected(new Set());
    setSearch("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import from Creators</DialogTitle>
          <DialogDescription>
            Pick LinkedIn creators you've already added in <strong>Assets &gt; Creators</strong>.
            We'll monitor their posts for new commenters and reactors.
          </DialogDescription>
        </DialogHeader>

        {/* Search + filter */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button
            variant={platformFilter === "linkedin" ? "default" : "outline"}
            size="sm"
            onClick={() => setPlatformFilter(platformFilter === "linkedin" ? "all" : "linkedin")}
          >
            {platformFilter === "linkedin" ? "LinkedIn only ✓" : "All platforms"}
          </Button>
        </div>

        {/* Creator list */}
        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center space-y-1">
              <Library className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">
                {creators && creators.length === 0
                  ? "No creators yet. Add some in Assets > Creators first."
                  : "No matches."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => {
                const monitored = isAlreadyMonitored(c);
                return (
                  <li
                    key={c.id}
                    className={`flex items-center gap-3 py-2.5 px-2 -mx-2 rounded transition ${
                      monitored
                        ? "opacity-60"
                        : "hover:bg-muted/40 cursor-pointer"
                    }`}
                    onClick={() => toggleSelect(c)}
                  >
                    <Checkbox
                      checked={monitored || selected.has(c.id)}
                      disabled={monitored}
                      onCheckedChange={() => toggleSelect(c)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Linkedin className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{c.display_name}</span>
                        {c.verified && <BadgeCheck className="h-3 w-3 text-blue-500 shrink-0" />}
                        {monitored && (
                          <Badge variant="outline" className="text-[9px] py-0 h-4">already monitored</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {c.platform && <Badge variant="secondary" className="text-[9px] py-0 h-4 capitalize">{c.platform}</Badge>}
                        {c.follower_count != null && (
                          <span>{c.follower_count.toLocaleString()} followers</span>
                        )}
                        {c.tags && c.tags.length > 0 && (
                          <span className="truncate">{c.tags.slice(0, 2).join(" · ")}</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <span className="text-xs text-muted-foreground mr-auto">
            {selected.size} selected
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAdd} disabled={selected.size === 0}>
            Import {selected.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------
export function ProfileMonitorPicker({ value, onChange, recommendedMax = 10 }: ProfileMonitorPickerProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { creators } = useCreators();

  // Index creators by their normalized LinkedIn URL so chips can show
  // avatars + names for imported ones.
  const creatorsByUrl = useMemo(() => {
    const map = new Map<string, Creator>();
    for (const c of (creators ?? []) as Creator[]) {
      const norm = normalizeLinkedinUrl(c.channel_url ?? "");
      if (norm) map.set(norm, c);
    }
    return map;
  }, [creators]);

  const addUrls = (urls: string[]) => {
    const next = [...value];
    for (const u of urls) {
      if (!next.includes(u)) next.push(u);
    }
    onChange(next);
  };

  const removeUrl = (url: string) => {
    onChange(value.filter((u) => u !== url));
  };

  const clearAll = () => {
    if (value.length === 0) return;
    if (window.confirm(`Remove all ${value.length} monitored profiles?`)) {
      onChange([]);
    }
  };

  const overLimit = value.length > recommendedMax;

  return (
    <div className="space-y-3">
      {/* Selected profiles — primary surface */}
      {value.length === 0 ? (
        <div className="border border-dashed rounded-md p-6 text-center space-y-1.5">
          <Linkedin className="h-6 w-6 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            No profiles yet. Add competitors or thought-leaders to monitor.
          </p>
          <p className="text-xs text-muted-foreground">
            Each refresh, we check their recent posts and surface every commenter / reactor.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-1.5">
            {value.map((url) => (
              <ProfileChip
                key={url}
                url={url}
                creator={creatorsByUrl.get(url)}
                onRemove={() => removeUrl(url)}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              {value.length} {value.length === 1 ? "profile" : "profiles"} monitored
              {overLimit && (
                <span className="text-amber-600 ml-2">
                  (over recommended max of {recommendedMax} — costs scale linearly)
                </span>
              )}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive transition flex items-center gap-1"
              onClick={clearAll}
            >
              <Trash2 className="h-3 w-3" />
              Clear all
            </button>
          </div>
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Paste URLs
        </Button>
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Library className="h-3.5 w-3.5 mr-1.5" />
          Import from Creators
        </Button>
      </div>

      <PasteUrlsDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        existingUrls={value}
        onAdd={addUrls}
      />
      <ImportCreatorsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        existingUrls={value}
        onAdd={addUrls}
      />
    </div>
  );
}
