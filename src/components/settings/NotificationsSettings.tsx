import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Pause, Play, Mail, BellRing } from "lucide-react";

interface DripPrefs {
  organization_id: string;
  paused: boolean;
  stream_education: boolean;
  stream_reveals: boolean;
  stream_content_drops: boolean;
  stream_daily_briefs: boolean;
  stream_checkins: boolean;
  stream_alerts: boolean;
  stream_winback: boolean;
  stream_reply_alerts: boolean;
  stream_digest: boolean;
  muted_stages: string[];
  voice_guidance: string | null;
  weekly_cap: number;
  stage_feedback: Record<string, string>;
}

const DEFAULTS: Omit<DripPrefs, "organization_id"> = {
  paused: false,
  stream_education: true,
  stream_reveals: true,
  stream_content_drops: true,
  stream_daily_briefs: true,
  stream_checkins: true,
  stream_alerts: true,
  stream_winback: true,
  stream_reply_alerts: true,
  stream_digest: true,
  muted_stages: [],
  voice_guidance: null,
  weekly_cap: 0,
  stage_feedback: {},
};

// User-facing labels for each stream.
const STREAMS: Array<{
  key: keyof DripPrefs & string;
  title: string;
  description: string;
}> = [
  { key: "stream_reveals", title: "Asset reveals", description: "First few days - emails that show you what we built (ICP, audit, sequence, blueprint, agent, strategy doc)." },
  { key: "stream_education", title: "Strategy plays", description: "Concrete plays you can run: comment-to-DM, lead magnet ideas, infrastructure setup, connection-request framework, 90-day compound." },
  { key: "stream_content_drops", title: "Content drops", description: "Paste-ready LinkedIn posts written for your buyer in your voice, on your blueprint themes." },
  { key: "stream_daily_briefs", title: "Daily briefs", description: "Today's 3 actions, tuned to your live workspace state. M-F during the first week post-conversion." },
  { key: "stream_checkins", title: "Check-ins & retrospectives", description: "Week 1 review, 2-week numbers, month 1 retrospective, settings reminders." },
  { key: "stream_alerts", title: "Behavior alerts", description: "Triggered when something needs your attention - low reply rate, stalled drafts, inbox volume cap, no login in 3 days." },
  { key: "stream_winback", title: "Win-back (if trial expires)", description: "Only fires if you let the trial end without converting. Founder feedback ask + comeback offers." },
];

// The operational streams used to sit at the bottom of the same list, behind
// seven rows of onboarding-drip content nobody scrolls past. They are the two
// people actually go looking for — reply alerts fire every 5 minutes — so they
// get their own card at the top of the page instead.
const ALERT_STREAMS: Array<{
  key: keyof DripPrefs & string;
  title: string;
  description: string;
}> = [
  { key: "stream_reply_alerts", title: "Reply alerts for this workspace", description: "The master switch. Off means nobody here gets them, whatever their personal setting below says." },
  { key: "stream_digest", title: "Weekly digest & dormancy nudges", description: "Weekly numbers for your workspace, plus a nudge if the account goes quiet." },
];

// src/integrations/supabase/types.ts is generated and predates both
// user_notification_preferences and organization_settings.hide_non_outreach_inbound,
// so the typed client rejects them. Regenerating that 22k-line file is its own
// change; until then this panel's reads and writes go through an untyped handle.
// Module scope on purpose: stable identity, so it is not a hook dependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

export function NotificationsSettings() {
  const { user, currentOrganization } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefs, setPrefs] = useState<DripPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Personal reply-alert opt-in, and the org's "only people we emailed" gate.
  // Both live outside drip_preferences: the first is per user, the second is a
  // column on organization_settings that until now had no UI at all.
  const [myReplyAlerts, setMyReplyAlerts] = useState(false);
  const [outreachOnly, setOutreachOnly] = useState(false);

  // Feedback-flow state - when an email's "This was off" link drops them here.
  const feedbackStage = searchParams.get("feedback");
  const wantsPause = searchParams.get("pause") === "1";

  const [feedbackNote, setFeedbackNote] = useState("");

  // Initial load.
  useEffect(() => {
    if (!currentOrganization?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [dripRes, mine, orgSettings, oldest] = await Promise.all([
          db.from("drip_preferences")
            .select("*")
            .eq("organization_id", currentOrganization.id)
            .maybeSingle(),
          user?.id
            ? db.from("user_notification_preferences")
              .select("reply_alerts")
              .eq("organization_id", currentOrganization.id)
              .eq("user_id", user.id)
              .maybeSingle()
            : Promise.resolve({ data: null }),
          db.from("organization_settings")
            .select("hide_non_outreach_inbound")
            .eq("organization_id", currentOrganization.id)
            .maybeSingle(),
          // No row of my own means I inherit the legacy default: the oldest
          // user in the org is the one who has been getting these. Show the
          // switch in the state the backend would actually act on.
          db.from("users")
            .select("id")
            .eq("organization_id", currentOrganization.id)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        const data = dripRes?.data as DripPrefs | null;
        if (data) {
          setPrefs({ ...DEFAULTS, ...data });
        } else {
          setPrefs({ organization_id: currentOrganization.id, ...DEFAULTS });
        }
        setMyReplyAlerts(
          mine?.data
            ? mine.data.reply_alerts !== false
            : !!user?.id && oldest?.data?.id === user.id,
        );
        setOutreachOnly(orgSettings?.data?.hide_non_outreach_inbound === true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentOrganization?.id, user?.id]);

  async function saveMyReplyAlerts(next: boolean) {
    if (!currentOrganization?.id || !user?.id) return;
    setSaving(true);
    setMyReplyAlerts(next);
    try {
      const { error } = await db
        .from("user_notification_preferences")
        .upsert({
          user_id: user.id,
          organization_id: currentOrganization.id,
          reply_alerts: next,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,organization_id" });
      if (error) throw error;
    } catch (e) {
      setMyReplyAlerts(!next);
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function saveOutreachOnly(next: boolean) {
    if (!currentOrganization?.id) return;
    setSaving(true);
    setOutreachOnly(next);
    try {
      const { error } = await db
        .from("organization_settings")
        .upsert({
          organization_id: currentOrganization.id,
          hide_non_outreach_inbound: next,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id" });
      if (error) throw error;
    } catch (e) {
      setOutreachOnly(!next);
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  // Apply ?pause=1 immediately on landing (so the kill-switch from email
  // works in one click).
  useEffect(() => {
    if (!prefs || !wantsPause || prefs.paused) return;
    void save({ paused: true });
    toast.success("All drip emails paused. Resume any time below.");
    const next = new URLSearchParams(searchParams);
    next.delete("pause");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, wantsPause]);

  async function save(patch: Partial<DripPrefs>) {
    if (!currentOrganization?.id || !prefs) return;
    const next: DripPrefs = { ...prefs, ...patch };
    setSaving(true);
    try {
      const { error } = await supabase
        .from("drip_preferences")
        .upsert({
          organization_id: currentOrganization.id,
          paused: next.paused,
          stream_education: next.stream_education,
          stream_reveals: next.stream_reveals,
          stream_content_drops: next.stream_content_drops,
          stream_daily_briefs: next.stream_daily_briefs,
          stream_checkins: next.stream_checkins,
          stream_alerts: next.stream_alerts,
          stream_winback: next.stream_winback,
          stream_reply_alerts: next.stream_reply_alerts,
          stream_digest: next.stream_digest,
          muted_stages: next.muted_stages,
          voice_guidance: next.voice_guidance,
          weekly_cap: next.weekly_cap,
          stage_feedback: next.stage_feedback,
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id" });
      if (error) throw error;
      setPrefs(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function submitFeedback() {
    if (!feedbackStage || !prefs) return;
    const note = feedbackNote.trim().slice(0, 500);
    if (!note) {
      toast.error("Tell us what was off in a sentence");
      return;
    }
    const nextFeedback = { ...(prefs.stage_feedback || {}), [feedbackStage]: note };
    await save({ stage_feedback: nextFeedback });
    toast.success("Got it. Next time this stage fires it'll know.");
    setFeedbackNote("");
    const next = new URLSearchParams(searchParams);
    next.delete("feedback");
    setSearchParams(next, { replace: true });
  }

  async function muteStage() {
    if (!feedbackStage || !prefs) return;
    const muted = Array.from(new Set([...prefs.muted_stages, feedbackStage]));
    await save({ muted_stages: muted });
    toast.success("This stage is muted. You won't get it again.");
    const next = new URLSearchParams(searchParams);
    next.delete("feedback");
    setSearchParams(next, { replace: true });
  }

  const mutedCount = useMemo(() => prefs?.muted_stages?.length || 0, [prefs?.muted_stages]);

  if (loading || !prefs) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Notifications &amp; alerts</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Inbox alerts first, then the emails we send you. Personalized content is generated fresh each time and uses your voice notes below.
        </p>
      </div>

      {/* Inline feedback panel - opened by "This was off" link in any email */}
      {feedbackStage && (
        <Card className="p-6 border-amber-500/40 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-1">
            <Mail className="h-4 w-4 text-amber-600" />
            <h3 className="font-semibold text-sm">Fix the last <code className="text-xs bg-white px-1 py-0.5 rounded border border-amber-300">{feedbackStage}</code> email</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            In one sentence - what was off? We'll inject this into the prompt the next time this stage runs, so it lands closer to what you actually want.
          </p>
          <Textarea
            value={feedbackNote}
            onChange={(e) => setFeedbackNote(e.target.value)}
            placeholder="e.g. 'too generic, didn't reference our enterprise positioning' or 'wrong industry - we sell to retail not fintech'"
            rows={3}
            className="mb-3"
          />
          <div className="flex gap-2">
            <Button onClick={submitFeedback} disabled={saving} variant="default" size="sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
              Save feedback
            </Button>
            <Button onClick={muteStage} disabled={saving} variant="outline" size="sm">
              Just mute this stage forever
            </Button>
            <Button
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("feedback");
                setSearchParams(next, { replace: true });
              }}
              variant="ghost" size="sm"
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Master pause */}
      <Card className="p-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {prefs.paused ? <Pause className="h-4 w-4 text-red-600" /> : <Play className="h-4 w-4 text-green-600" />}
            <h3 className="font-semibold text-sm">
              {prefs.paused ? "All emails paused" : "Drip is running"}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            One switch to silence everything. Granular control below.
          </p>
        </div>
        <Switch checked={!prefs.paused} onCheckedChange={(v) => save({ paused: !v })} disabled={saving} />
      </Card>

      {/* Inbox alerts - the operational stream people come here looking for */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Inbox alerts</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          When a prospect writes back. These are not part of the onboarding drip below.
        </p>

        <div className="space-y-4">
          <div className="flex items-start justify-between gap-6 py-3 border-b border-border/40">
            <div className="flex-1">
              <Label htmlFor="my_reply_alerts" className="font-medium text-sm">Email me when a prospect replies</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Just you. Each teammate sets this for themselves — batched, at most one email per 5 minutes.
              </p>
            </div>
            <Switch
              id="my_reply_alerts"
              checked={myReplyAlerts}
              onCheckedChange={saveMyReplyAlerts}
              disabled={saving || prefs.paused || !prefs.stream_reply_alerts}
            />
          </div>

          <div className="flex items-start justify-between gap-6 py-3 border-b border-border/40">
            <div className="flex-1">
              <Label htmlFor="outreach_only" className="font-medium text-sm">Only alert on people ACA emailed</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Silences inbound we can't tie to your outreach — the usual source is a third-party warmup network
                running on the same mailboxes. Leave this off if you send outbound through another tool, or you'll
                mute genuine replies too.
              </p>
            </div>
            <Switch
              id="outreach_only"
              checked={outreachOnly}
              onCheckedChange={saveOutreachOnly}
              disabled={saving || prefs.paused || !prefs.stream_reply_alerts}
            />
          </div>

          {ALERT_STREAMS.map((stream) => (
            <div key={stream.key} className="flex items-start justify-between gap-6 py-3 border-b border-border/40 last:border-0">
              <div className="flex-1">
                <Label htmlFor={stream.key} className="font-medium text-sm">{stream.title}</Label>
                <p className="text-xs text-muted-foreground mt-1">{stream.description}</p>
              </div>
              <Switch
                id={stream.key}
                checked={prefs[stream.key] as boolean}
                onCheckedChange={(v) => save({ [stream.key]: v } as Partial<DripPrefs>)}
                disabled={saving || prefs.paused}
              />
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Still too noisy? Keyword exclusions in the Inbox drop matching threads from both the inbox and these alerts.
        </p>
      </Card>

      {/* Per-stream toggles */}
      <Card className="p-6">
        <h3 className="font-semibold text-sm mb-1">Streams</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Turn off entire categories. Each shows examples of what falls into it.
        </p>
        <div className="space-y-4">
          {STREAMS.map((stream) => {
            const enabled = prefs[stream.key] as boolean;
            return (
              <div key={stream.key} className="flex items-start justify-between gap-6 py-3 border-b border-border/40 last:border-0">
                <div className="flex-1">
                  <Label htmlFor={stream.key} className="font-medium text-sm">{stream.title}</Label>
                  <p className="text-xs text-muted-foreground mt-1">{stream.description}</p>
                </div>
                <Switch
                  id={stream.key}
                  checked={enabled}
                  onCheckedChange={(v) => save({ [stream.key]: v } as Partial<DripPrefs>)}
                  disabled={saving || prefs.paused}
                />
              </div>
            );
          })}
        </div>
      </Card>

      {/* Voice guidance - steers all LLM-personalized emails */}
      <Card className="p-6">
        <h3 className="font-semibold text-sm mb-1">Your voice</h3>
        <p className="text-sm text-muted-foreground mb-3">
          This injects into every personalized email (lead magnet ideas, comment-to-DM examples, content drops, etc) so the LLM matches your style. Two sentences is enough.
        </p>
        <Textarea
          value={prefs.voice_guidance ?? ""}
          onChange={(e) => setPrefs({ ...prefs, voice_guidance: e.target.value })}
          onBlur={() => save({ voice_guidance: prefs.voice_guidance })}
          placeholder={"e.g. \"I write like Naval. Short sentences. No emojis. Don't compare us to other tools - we play in a different lane. Avoid US-centric examples; our buyers are EU.\""}
          rows={5}
        />
        <p className="text-xs text-muted-foreground mt-2">Saved when you click outside the box.</p>
      </Card>

      {/* Weekly cap */}
      <Card className="p-6">
        <h3 className="font-semibold text-sm mb-1">Weekly cap</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Maximum emails per 7 days from us. 0 = no cap (default - let the lifecycle play out).
        </p>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            min={0}
            max={10}
            value={prefs.weekly_cap}
            onChange={(e) => setPrefs({ ...prefs, weekly_cap: Number(e.target.value) || 0 })}
            onBlur={() => save({ weekly_cap: prefs.weekly_cap })}
            className="w-24"
          />
          <span className="text-sm text-muted-foreground">emails / week</span>
        </div>
      </Card>

      {/* Muted stages */}
      {mutedCount > 0 && (
        <Card className="p-6">
          <h3 className="font-semibold text-sm mb-1">Muted stages ({mutedCount})</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Specific emails you've muted from previous footers. Click to un-mute.
          </p>
          <div className="flex flex-wrap gap-2">
            {prefs.muted_stages.map((key) => (
              <button
                key={key}
                onClick={() => save({ muted_stages: prefs.muted_stages.filter((k) => k !== key) })}
                className="px-3 py-1 text-xs rounded-full bg-muted text-muted-foreground hover:bg-muted/70 transition-colors font-mono"
              >
                {key} ×
              </button>
            ))}
          </div>
        </Card>
      )}

      {saving && (
        <div className="fixed bottom-6 right-6 bg-foreground text-background px-4 py-2 rounded-full text-xs flex items-center gap-2 shadow-lg">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </div>
      )}
    </div>
  );
}
