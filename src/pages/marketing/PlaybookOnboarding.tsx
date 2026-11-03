import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Check,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Key,
  Sparkles,
  Target,
  FileText,
  Megaphone,
  Layers,
  Bot,
  Zap,
  X,
  Plus,
  RefreshCw,
  Heart,
  Flame,
  ShieldAlert,
  MessageCircle,
} from "lucide-react";
import { getPlaybook } from "@/data/playbooks";
import "@/styles/aca-home.css";
import "@/styles/marketing-specialized.css";
import { Logo } from "@/components/marketing/Logo";

type Lead = {
  fullName: string;
  email: string;
  website: string;
  linkedinUrl: string;
  biggestNeed: string;
  whatTried: string;
  revenue: string;
  teamSize: string;
  playbookSlug: string;
  playbookTitle: string;
  niche: string;
  outcome: string;
};

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "icp", label: "Your ICP" },
  { id: "build", label: "Building" },
  { id: "ai", label: "AI key" },
  { id: "apify", label: "Apify key" },
  { id: "ready", label: "Workspace ready" },
] as const;

type StepId = typeof STEPS[number]["id"];

const BUILD_TASKS: Array<{ key: string; lab: string; detail: string; icon: typeof Target }> = [
  { key: "icp",        lab: "Locking your ICP",         detail: "From your answers + your site",                       icon: Target },
  { key: "sequence",   lab: "Writing your sequence",     detail: "5 touches · in your voice · personalized per signal", icon: Megaphone },
  { key: "blueprint",  lab: "Designing your blueprint",  detail: "Daily LinkedIn cadence · 3 weekly themes",            icon: Layers },
  { key: "leadmagnet", lab: "Drafting your lead magnet", detail: "Framework + first-section preview",                   icon: FileText },
  { key: "agent",      lab: "Training your AI agent",    detail: "System prompt + tone matched to your ICP",            icon: Bot },
  { key: "strategy",   lab: "Generating strategy doc",   detail: "Your 60-day game plan",                               icon: Sparkles },
];

interface OnboardJob {
  jobId: string;
  organizationId: string;
  provisioningToken: string;
  taskKeys?: string[];
  tasksDone?: Record<string, string>;
  returningUser?: boolean;
  existingProviders?: string[];
}

export default function PlaybookOnboarding() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const playbook = slug ? getPlaybook(slug) : undefined;

  const [step, setStep] = useState<StepId>("welcome");
  const [lead, setLead] = useState<Lead | null>(null);
  const [job, setJob] = useState<OnboardJob | null>(null);
  const [keySubmitting, setKeySubmitting] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);

  // ICP state - supports 1 or 2 ICPs for two-sided B2B businesses.
  // The 9 single-field setters below stay; we mirror them into icps[activeIcpIdx]
  // via effect so JSX stays simple.
  type IcpDraft = {
    name: string; summary: string; industry: string; roles: string; size: string;
    pains: string[]; desires: string[]; objections: string[]; language: string;
    label: string; role: "primary_buyer" | "secondary_buyer"; audience_type: "b2b_clients" | "b2b_professionals";
  };
  const blankIcp = (role: IcpDraft["role"] = "primary_buyer", label = "Primary buyer"): IcpDraft => ({
    name: "", summary: "", industry: "", roles: "", size: "50-500 employees",
    pains: [], desires: [], objections: [], language: "",
    label, role, audience_type: "b2b_clients",
  });
  const [icps, setIcps] = useState<IcpDraft[]>([blankIcp()]);
  const [activeIcpIdx, setActiveIcpIdx] = useState(0);
  const [fitWarning, setFitWarning] = useState<{ level: "soft" | "strong"; reason: string } | null>(null);

  const [icpName, setIcpName] = useState("");
  const [icpSummary, setIcpSummary] = useState("");
  const [icpIndustry, setIcpIndustry] = useState("");
  const [icpRoles, setIcpRoles] = useState("");
  const [icpSize, setIcpSize] = useState("50-500 employees");
  const [icpPains, setIcpPains] = useState<string[]>([]);
  const [icpDesires, setIcpDesires] = useState<string[]>([]);
  const [icpObjections, setIcpObjections] = useState<string[]>([]);
  const [icpLanguage, setIcpLanguage] = useState("");
  const [icpSignals, setIcpSignals] = useState<string[]>([]);
  const [icpRegenerating, setIcpRegenerating] = useState(false);
  const [icpSaving, setIcpSaving] = useState(false);

  // Mirror the 9 form fields into icps[activeIcpIdx] so multi-ICP state stays in sync.
  useEffect(() => {
    setIcps((cur) => {
      const next = [...cur];
      if (!next[activeIcpIdx]) return cur;
      next[activeIcpIdx] = {
        ...next[activeIcpIdx],
        name: icpName, summary: icpSummary, industry: icpIndustry, roles: icpRoles, size: icpSize,
        pains: icpPains, desires: icpDesires, objections: icpObjections, language: icpLanguage,
      };
      return next;
    });
  }, [icpName, icpSummary, icpIndustry, icpRoles, icpSize, icpPains, icpDesires, icpObjections, icpLanguage, activeIcpIdx]);

  function loadIcpIntoForm(d: IcpDraft) {
    setIcpName(d.name); setIcpSummary(d.summary); setIcpIndustry(d.industry); setIcpRoles(d.roles); setIcpSize(d.size);
    setIcpPains(d.pains); setIcpDesires(d.desires); setIcpObjections(d.objections); setIcpLanguage(d.language);
  }

  function switchToIcp(idx: number) {
    if (idx === activeIcpIdx || !icps[idx]) return;
    setActiveIcpIdx(idx);
    loadIcpIntoForm(icps[idx]);
  }

  function addSecondIcp() {
    if (icps.length >= 2) return;
    const second = blankIcp("secondary_buyer", "Secondary buyer");
    setIcps([icps[0], second]);
    setActiveIcpIdx(1);
    loadIcpIntoForm(second);
  }

  function removeSecondIcp() {
    if (icps.length < 2) return;
    setIcps([icps[0]]);
    setActiveIcpIdx(0);
    loadIcpIntoForm(icps[0]);
  }

  // AI
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [skippedAi, setSkippedAi] = useState(false);

  // Apify
  const [apifyKey, setApifyKey] = useState("");
  const [skippedApify, setSkippedApify] = useState(false);

  // Build animation
  const [tasksDone, setTasksDone] = useState<number>(0);
  const [tasksFailed, setTasksFailed] = useState<number>(-1);
  const buildTimerRef = useRef<number | null>(null);

  // Hydrate lead + job from sessionStorage on mount
  useEffect(() => {
    try {
      const leadRaw = sessionStorage.getItem("aca:onboard:lead");
      if (leadRaw) {
        const parsed = JSON.parse(leadRaw) as Lead;
        setLead(parsed);
        applyGeneratedICP(parsed); // instant fallback while AI runs
        // Kick off real AI generation (uses our OpenRouter key)
        fetchAndApplyICP(parsed);
      }
    } catch {
      // Saved lead data is optional; continue without unreadable session data.
    }

    try {
      const jobRaw = sessionStorage.getItem("aca:onboard:job");
      if (jobRaw) {
        const parsedJob = JSON.parse(jobRaw) as OnboardJob;
        // Sanity check: URL ?jobId must match (prevents stale sessions on copy-paste links)
        const urlJobId = searchParams.get("jobId");
        if (!urlJobId || urlJobId === parsedJob.jobId) {
          setJob(parsedJob);
        }
      }
    } catch {
      // An unreadable saved job should leave the onboarding form in its initial state.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyGeneratedICP(parsed: Lead) {
    const n = parsed.niche?.toLowerCase() || "";
    if (n.includes("recruit")) {
      setIcpName("Mid-market staffing & recruiting agencies");
      setIcpSummary("US/UK staffing agencies (50-500 employees) drowning in unscreened candidates and losing time on roles that don't close.");
      setIcpIndustry("Staffing & Recruiting");
      setIcpRoles("VP of Talent, Director of Recruiting, Head of Talent Acquisition");
      setIcpSize("50-500 employees");
      setIcpPains([
        "12-15 hours per role wasted on candidate qualification",
        "Recruiters burn out before quarter-end, churn is brutal",
        "ATS data is messy - same candidates re-screened across roles",
        "Hard to prove ROI to clients vs. candidate-flooded competitors",
        "Founder is the only one who can close - and there's only one founder",
      ]);
      setIcpDesires([
        "Cut time-per-role from 12 hours to under 1 hour",
        "Place 30%+ more candidates with the same headcount",
        "Win retained search clients (not just contingent placements)",
        "Build a team that doesn't burn out at month 3",
        "Compete on speed-to-shortlist, not who's cheaper",
      ]);
      setIcpObjections([
        "We already have an ATS - what's different?",
        "Our recruiters won't trust AI-screened candidates",
        "I tried Bullhorn AI/HireEZ; they didn't ship outcomes",
        "Our candidates don't fit a template - every search is different",
        "Compliance - can the AI handle GDPR/EEOC?",
      ]);
      setIcpLanguage("Direct, results-led, slightly impatient. They speak in placements/month and time-to-fill, not 'engagements'. Use specific numbers: 12 hours, 70% pass rate, 30 days. Avoid recruiting buzzwords (talent acquisition synergy, candidate journey, engagement layer).");
      setIcpSignals(["Posted recruiter role", "Hiring spike (+10 in 30d)", "Posted about your problem"]);
    } else if (n.includes("ai agency")) {
      setIcpName("Mid-market staffing agencies - for AI agency owners");
      setIcpSummary("Same buyer (staffing/recruiting agencies, 50-500 employees) but framed for AI agencies selling outcomes. Painful problem: candidate qualification at scale.");
      setIcpIndustry("Staffing & Recruiting");
      setIcpRoles("VP of Talent, Director of Recruiting");
      setIcpSize("50-500 employees");
      setIcpPains([
        "12 hours per role on candidate screening",
        "70%+ candidates fail the screen anyway",
        "Recruiter burnout = constant rehiring",
        "Can't move fast enough to win retained clients",
      ]);
      setIcpDesires([
        "AI candidate qualification → 12h to 30 min per role",
        "Hit 70% pass-rate on shortlists",
        "Scale to 2x clients without 2x recruiters",
      ]);
      setIcpObjections([
        "We already have an ATS",
        "Build vs. buy - can't we just hire a dev?",
        "What if AI screens out our best candidates?",
      ]);
      setIcpLanguage("Outcomes-first. Pitch in time saved + placement rate. Reference real agency names you've worked with. No 'AI-powered' or 'leverage'.");
      setIcpSignals(["Posted recruiter role", "Hiring spike (+10 in 30d)", "VP Talent posted role"]);
    } else if (n.includes("indie") || n.includes("vibe")) {
      setIcpName("Indie SaaS founders · pre-PMF to early growth");
      setIcpSummary("Solo founders shipping B2B SaaS with $1k-$10k MRR. Built the product. Can't get distribution.");
      setIcpIndustry("B2B SaaS · solo / 2-person teams");
      setIcpRoles("Founder, Co-founder, Indie hacker");
      setIcpSize("< 10 employees");
      setIcpPains([
        "Built it. Nobody's coming.",
        "Posting on Twitter/LinkedIn but 200 followers can't buy",
        "Cold email feels sleazy + I don't have time to do it manually",
        "MRR plateau - first 30 customers came from network, next 100 are strangers",
        "Burnt out on 'launch on Product Hunt' advice that doesn't work past day 1",
      ]);
      setIcpDesires([
        "First 100 paying customers without paid ads",
        "Distribution machine that runs while I ship product",
        "$5k-$10k MRR baseline I can rely on",
        "Pipeline that doesn't depend on going viral",
      ]);
      setIcpObjections([
        "Cold outreach feels off-brand for an indie SaaS",
        "I'm a solo founder - I can't manage another tool",
        "BYOK sounds expensive - what's the real monthly cost?",
        "What if my market is too small for outbound?",
      ]);
      setIcpLanguage("Builder-to-builder. Specific products mentioned by name. Reference indie metrics ($k MRR, churn %, LTV). Skip enterprise buzzwords. They respect 'I built this' more than 'I scaled this'.");
      setIcpSignals(["Posted about cold email", "Switched from competitor", "Posted about your problem"]);
    } else {
      setIcpName("Series A-B B2B SaaS · GTM-ready");
      setIcpSummary("B2B SaaS companies that just raised, hiring sales but pipeline isn't keeping up.");
      setIcpIndustry("B2B SaaS, Series A-B");
      setIcpRoles("VP Sales, Head of GTM, RevOps, Founder");
      setIcpSize("50-500 employees");
      setIcpPains([
        "Just hired 3 SDRs, ramping is painful",
        "Pipeline coverage is below 3x quota",
        "Outbound tools sprawl - Apollo + Outreach + Clay + Smartlead",
        "Reps spend 60% of time on busywork",
      ]);
      setIcpDesires([
        "Predictable pipeline that survives campaign-end",
        "120% of team quota at 30% less hours",
        "One stack instead of five",
      ]);
      setIcpObjections([
        "We just bought Outreach last quarter",
        "Replacing the stack is a quarter-long migration",
        "We need SOC-2 - can ACA support enterprise compliance?",
      ]);
      setIcpLanguage("Operator language: pipeline coverage, win rate, ramp time, attainment. They want proof points, not promises. Reference investors and other Series A/B logos.");
      setIcpSignals(["Posted SDR role", "Recently raised funding", "Posted about your problem"]);
    }
  }

  async function fetchAndApplyICP(parsed: Lead) {
    setIcpRegenerating(true);
    try {
      const leadId = sessionStorage.getItem("aca:onboard:leadId") || undefined;
      const { data, error } = await supabase.functions.invoke("generate-icp", {
        body: {
          leadId,
          fullName: parsed.fullName,
          website: parsed.website,
          linkedinUrl: parsed.linkedinUrl,
          niche: parsed.niche,
          outcome: parsed.outcome,
          biggestNeed: parsed.biggestNeed,
          whatTried: parsed.whatTried,
        },
      });
      if (error) throw error;
      // New response shape: { icps: [...], fit_warning }. Tolerate legacy { icp: {...} }.
      const apiIcps: IcpDraft[] = Array.isArray(data?.icps)
        ? data.icps
        : data?.icp
          ? [data.icp]
          : [];
      if (apiIcps.length === 0) return;
      const normalized = apiIcps.slice(0, 2).map((raw: Record<string, unknown>, i: number): IcpDraft => ({
        name: String(raw.name || ""),
        summary: String(raw.summary || ""),
        industry: String(raw.industry || ""),
        roles: String(raw.roles || ""),
        size: String(raw.size || "50-500 employees"),
        pains: Array.isArray(raw.pains) ? (raw.pains as string[]) : [],
        desires: Array.isArray(raw.desires) ? (raw.desires as string[]) : [],
        objections: Array.isArray(raw.objections) ? (raw.objections as string[]) : [],
        language: String(raw.language || ""),
        label: String(raw.label || (i === 0 ? "Primary buyer" : "Secondary buyer")),
        role: (raw.role === "secondary_buyer" ? "secondary_buyer" : "primary_buyer") as IcpDraft["role"],
        audience_type: (raw.audience_type === "b2b_professionals" ? "b2b_professionals" : "b2b_clients") as IcpDraft["audience_type"],
      }));
      setIcps(normalized);
      setActiveIcpIdx(0);
      loadIcpIntoForm(normalized[0]);
      setFitWarning(data?.fit_warning || null);
      if (data?.capped) {
        toast.message("You've hit the regeneration limit - showing your last AI-built ICP.");
      }
    } catch (e) {
      console.warn("[onboard] AI ICP generation failed, keeping fallback:", e);
    } finally {
      setIcpRegenerating(false);
    }
  }

  function regenerateICP() {
    if (!lead) return;
    fetchAndApplyICP(lead);
  }

  async function saveIcpsAndAdvance() {
    if (!job?.provisioningToken) {
      goNext();
      return;
    }
    setIcpSaving(true);
    try {
      // Build payload from current icps array, ensuring the active draft's edits
      // are flushed in (the mirror useEffect already does this, but be explicit).
      const drafts = icps.map((d, i) => i === activeIcpIdx ? {
        ...d,
        name: icpName, summary: icpSummary, industry: icpIndustry, roles: icpRoles, size: icpSize,
        pains: icpPains, desires: icpDesires, objections: icpObjections, language: icpLanguage,
      } : d);
      const { error } = await supabase.functions.invoke("save-onboarding-icps", {
        body: { provisioningToken: job.provisioningToken, icps: drafts, fitWarning },
      });
      if (error) throw error;
    } catch (e) {
      console.warn("[onboard] save-onboarding-icps failed (advancing anyway):", e);
      toast.message("Saved your ICP locally - server save retry failed but we'll keep going.");
    } finally {
      setIcpSaving(false);
      goNext();
    }
  }

  async function saveProviderKey(provider: "openrouter" | "apify", apiKey: string): Promise<boolean> {
    if (!job?.provisioningToken) {
      setKeyError("Workspace context lost. Please restart from /playbooks.");
      return false;
    }
    setKeySubmitting(true);
    setKeyError(null);
    try {
      const { data, error } = await supabase.functions.invoke("save-onboarding-api-key", {
        body: {
          provisioningToken: job.provisioningToken,
          provider,
          apiKey,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.valid) throw new Error("Key did not validate");
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save key";
      setKeyError(msg);
      toast.error(msg);
      return false;
    } finally {
      setKeySubmitting(false);
    }
  }

  async function handleMagicLink(): Promise<void> {
    if (!job?.provisioningToken) {
      navigate("/auth");
      return;
    }
    setMagicLinkLoading(true);
    try {
      // Hand the auth callback the current origin so we land back in this
      // app (works for localhost dev + prod). No explicit redirectTo here -
      // the edge function picks the actual deep link (the prospect list it
      // just built) rather than a hardcoded generic page.
      const origin = window.location.origin;
      const { data, error } = await supabase.functions.invoke(
        "request-workspace-magic-link",
        {
          body: { provisioningToken: job.provisioningToken, origin },
        }
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.url) throw new Error("No magic link returned");
      // Clear the session so a refresh on the wizard doesn't re-fire this
      sessionStorage.removeItem("aca:onboard:job");
      sessionStorage.removeItem("aca:onboard:lead");
      sessionStorage.removeItem("aca:onboard:leadId");
      window.location.href = data.url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not sign you in";
      toast.error(msg);
      setMagicLinkLoading(false);
    }
  }

  function addItem(setter: (v: (x: string[]) => string[]) => void) {
    setter((cur) => [...cur, ""]);
  }
  function updItem(setter: (v: (x: string[]) => string[]) => void, idx: number, val: string) {
    setter((cur) => cur.map((x, i) => (i === idx ? val : x)));
  }
  function rmItem(setter: (v: (x: string[]) => string[]) => void, idx: number) {
    setter((cur) => cur.filter((_, i) => i !== idx));
  }

  // Build step: kick off real LLM artifact generation server-side, then poll
  // provisioning_jobs.tasks_done every 2s and tick BUILD_TASKS based on what's
  // actually done. Total ~25-40s of real work.
  useEffect(() => {
    if (step !== "build" || !job?.provisioningToken) return;
    let cancelled = false;
    let kicked = false;

    const advance = () => {
      const next =
        job?.existingProviders?.includes("openrouter")
          ? job?.existingProviders?.includes("apify")
            ? "ready"
            : "apify"
          : "ai";
      setStep(next as StepId);
    };

    const poll = async () => {
      try {
        // Fire generation once at the start (don't await - it runs ~30s).
        if (!kicked) {
          kicked = true;
          supabase.functions
            .invoke("generate-playbook-artifacts", {
              body: { provisioningToken: job.provisioningToken },
            })
            .catch((e) => console.warn("[onboard] generate-playbook-artifacts kick failed:", e));
        }

        const { data, error } = await supabase.functions.invoke("get-provisioning-status", {
          body: { provisioningToken: job.provisioningToken },
        });
        if (cancelled) return;
        if (error || !data?.tasks_done) {
          // Fall back to a slow tick if status fetch fails - never freeze the UI.
          buildTimerRef.current = window.setTimeout(poll, 3000);
          return;
        }
        const td = data.tasks_done as Record<string, string>;
        const completed = BUILD_TASKS.filter((t) => td[t.key] === "done" || td[t.key] === "skipped").length;
        const failed = BUILD_TASKS.findIndex((t) => td[t.key] === "failed");
        setTasksDone(completed);
        setTasksFailed(failed);

        if (completed >= BUILD_TASKS.length) {
          buildTimerRef.current = window.setTimeout(advance, 1200);
          return;
        }
        buildTimerRef.current = window.setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled) return;
        console.warn("[onboard] poll error:", e);
        buildTimerRef.current = window.setTimeout(poll, 3000);
      }
    };

    setTasksDone(0);
    setTasksFailed(-1);
    poll();

    return () => {
      cancelled = true;
      if (buildTimerRef.current) window.clearTimeout(buildTimerRef.current);
    };
  }, [step, job?.provisioningToken, job?.existingProviders]);

  if (!playbook) {
    return (
      <div className="ob-shell">
        <div className="ob-card" style={{ textAlign: "center" }}>
          <h1 className="ob-h1">Playbook not found.</h1>
          <Link to="/playbooks" className="ob-cta">All playbooks</Link>
        </div>
      </div>
    );
  }

  const currentStepIdx = STEPS.findIndex((s) => s.id === step);
  const progressPct = Math.round((currentStepIdx / (STEPS.length - 1)) * 100);

  const hasOpenrouter = !!job?.existingProviders?.includes("openrouter");
  const hasApify = !!job?.existingProviders?.includes("apify");

  const nextStepFrom = (id: StepId): StepId | undefined => {
    let idx = STEPS.findIndex((s) => s.id === id) + 1;
    while (idx < STEPS.length) {
      const candidate = STEPS[idx].id;
      if (candidate === "ai" && hasOpenrouter) { idx += 1; continue; }
      if (candidate === "apify" && hasApify) { idx += 1; continue; }
      return candidate;
    }
    return undefined;
  };

  const goNext = () => {
    const next = nextStepFrom(step);
    if (next) setStep(next);
  };
  const goBack = () => {
    const prev = STEPS[currentStepIdx - 1]?.id;
    if (prev && prev !== "build") setStep(prev);
  };

  return (
    <div className="ob-shell">
      <header className="ob-topbar">
        <Link to="/playbooks" className="ob-brand">
          <Logo size={26} className="ob-logo" />
        </Link>
        <div className="ob-stepper">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={
                "ob-step-pill" +
                (i < currentStepIdx ? " is-done" : "") +
                (i === currentStepIdx ? " is-current" : "")
              }
            >
              <span className="ob-step-pill__dot">{i < currentStepIdx ? <Check className="w-3 h-3" /> : i + 1}</span>
              <span className="ob-step-pill__lab">{s.label}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ob-quit"
          onClick={() => {
            if (confirm("Leave onboarding? Your progress so far is saved.")) navigate("/");
          }}
          aria-label="Quit"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="ob-progress">
        <div className="ob-progress__bar" style={{ width: progressPct + "%" }} />
      </div>

      <main className="ob-main">
        {step === "welcome" && (
          <section className="ob-card">
            <span className="kicker"><span className="live-dot" />{job?.returningUser ? `Welcome back, ${lead?.fullName?.split(" ")[0] || "you"}` : `Personalized for ${lead?.fullName || "you"}`}</span>
            <h1 className="ob-h1">
              {job?.returningUser ? <>Adding to your <em>workspace</em><span className="dot">.</span></> : <>Building your <em>workspace</em><span className="dot">.</span></>}
            </h1>
            <p className="ob-lead">
              {job?.returningUser
                ? "We're dropping this playbook straight into your existing workspace - ICP, sequence, lead magnet, agent profile, and a fresh 60-day strategy doc. Tagged so they sit alongside your current work, not on top of it."
                : "In the next 7 minutes we'll define your ICP, build your prospect list, write your sequence in your voice, draft your lead magnet, set up your AI agent, and load your 60-day strategy doc. You'll close this tab with a workspace that's ready to launch - not a blank page."}
            </p>
            <div className="ob-summary">
              <div className="ob-summary__row">
                <span className="ob-summary__lab">Playbook</span>
                <span className="ob-summary__val">{playbook.headline}</span>
              </div>
              <div className="ob-summary__row">
                <span className="ob-summary__lab">For</span>
                <span className="ob-summary__val">{playbook.niche}</span>
              </div>
              <div className="ob-summary__row">
                <span className="ob-summary__lab">Outcome</span>
                <span className="ob-summary__val ob-summary__val--accent">{playbook.outcome}</span>
              </div>
              {lead && (
                <div className="ob-summary__row">
                  <span className="ob-summary__lab">Stage</span>
                  <span className="ob-summary__val">{lead.revenue} · {lead.teamSize}</span>
                </div>
              )}
            </div>
            <div className="ob-actions">
              <button type="button" className="ob-cta" onClick={goNext}>
                Let's go <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}

        {step === "icp" && (
          <section className="ob-card ob-card--icp">
            <div className="ob-icp__top">
              <span className="kicker"><Sparkles className="w-3 h-3" />Step 1 of 5 · AI-generated ICP</span>
              <button
                type="button"
                className="ob-icp__regen"
                onClick={regenerateICP}
                disabled={icpRegenerating}
              >
                {icpRegenerating ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Regenerating…</>
                ) : (
                  <><RefreshCw className="w-3 h-3" /> Regenerate</>
                )}
              </button>
            </div>
            <h1 className="ob-h1">
              Your <em>ideal buyer</em>, profiled<span className="dot">.</span>
            </h1>
            <p className="ob-lead">
              Built from your playbook, your answers, and signal data on real buyers fitting your niche. Edit anything that's off - every dimension feeds the prospect list, the sequence voice, and the agent's reasoning.
            </p>

            {fitWarning && (
              <div className={`ob-fit-warn ob-fit-warn--${fitWarning.level}`} style={{
                background: fitWarning.level === "strong" ? "rgba(212,54,26,0.08)" : "rgba(212,170,26,0.10)",
                border: `1px solid ${fitWarning.level === "strong" ? "rgba(212,54,26,0.35)" : "rgba(212,170,26,0.35)"}`,
                borderRadius: 12, padding: "12px 14px", margin: "0 0 16px 0", fontSize: 13, lineHeight: 1.45,
              }}>
                <strong>Heads up.</strong> {fitWarning.reason} ACA's outbound motion works best when you're selling to companies or to professionals at work. If your real buyers are individuals shopping for themselves, this might not be your tool - but only you know that for sure. The ICP below is the best B2B angle we can imagine for you.
              </div>
            )}

            {(icps.length === 2 || icps.length === 1) && (
              <div className="ob-icp__tabs" style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 14px 0" }}>
                {icps.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => switchToIcp(i)}
                    className={`ob-icp__tab ${i === activeIcpIdx ? "is-active" : ""}`}
                    style={{
                      padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                      border: i === activeIcpIdx ? "1px solid var(--accent)" : "1px solid rgba(0,0,0,0.12)",
                      background: i === activeIcpIdx ? "var(--accent)" : "transparent",
                      color: i === activeIcpIdx ? "white" : "inherit", cursor: "pointer",
                    }}
                  >
                    {d.label || (i === 0 ? "Primary buyer" : "Secondary buyer")}
                  </button>
                ))}
                {icps.length === 1 ? (
                  <button type="button" onClick={addSecondIcp} className="ob-icp__add-tab"
                    style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500,
                      border: "1px dashed rgba(0,0,0,0.25)", background: "transparent", cursor: "pointer", opacity: 0.7 }}>
                    + Add a second buyer type
                  </button>
                ) : (
                  <button type="button" onClick={removeSecondIcp} className="ob-icp__rm-tab"
                    style={{ marginLeft: "auto", padding: "6px 10px", borderRadius: 999, fontSize: 11,
                      border: "1px solid rgba(0,0,0,0.1)", background: "transparent", cursor: "pointer", opacity: 0.6 }}>
                    Remove second
                  </button>
                )}
              </div>
            )}

            <div className="ob-icp">
              <div className="ob-icp__head">
                <div className="ob-icp__field-name">
                  <input
                    className="ob-icp__name-input"
                    value={icpName}
                    onChange={(e) => setIcpName(e.target.value)}
                    placeholder="ICP name"
                  />
                </div>
                <div className="ob-icp__field-summary">
                  <textarea
                    className="ob-icp__summary-input"
                    value={icpSummary}
                    onChange={(e) => setIcpSummary(e.target.value)}
                    rows={2}
                    placeholder="One-line summary of who they are and what's broken"
                  />
                </div>
              </div>

              <div className="ob-icp__filters">
                <div className="ob-icp__filter">
                  <label>Industry · vertical</label>
                  <input value={icpIndustry} onChange={(e) => setIcpIndustry(e.target.value)} />
                </div>
                <div className="ob-icp__filter">
                  <label>Buyer roles · titles</label>
                  <input value={icpRoles} onChange={(e) => setIcpRoles(e.target.value)} />
                </div>
                <div className="ob-icp__filter">
                  <label>Company size</label>
                  <div className="ob-pills">
                    {["< 50 employees", "50-500 employees", "500-5k employees", "5k+ employees"].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={"ob-pill" + (icpSize === opt ? " is-active" : "")}
                        onClick={() => setIcpSize(opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ob-icp__profile">
                <div className="ob-icp__col">
                  <div className="ob-icp__col-head ob-icp__col-head--pain">
                    <Flame className="w-4 h-4" />
                    <span>Pain points</span>
                    <span className="ob-icp__col-count">{icpPains.length}</span>
                  </div>
                  <ul className="ob-icp__list">
                    {icpPains.map((p, i) => (
                      <li key={i} className="ob-icp__row">
                        <span className="ob-icp__bullet ob-icp__bullet--pain" />
                        <input
                          value={p}
                          onChange={(e) => updItem(setIcpPains, i, e.target.value)}
                          placeholder="What's broken in their life"
                        />
                        <button type="button" className="ob-icp__rm" onClick={() => rmItem(setIcpPains, i)}><X className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="ob-icp__add" onClick={() => addItem(setIcpPains)}>
                    <Plus className="w-3 h-3" /> Add pain point
                  </button>
                </div>

                <div className="ob-icp__col">
                  <div className="ob-icp__col-head ob-icp__col-head--desire">
                    <Heart className="w-4 h-4" />
                    <span>Desires</span>
                    <span className="ob-icp__col-count">{icpDesires.length}</span>
                  </div>
                  <ul className="ob-icp__list">
                    {icpDesires.map((d, i) => (
                      <li key={i} className="ob-icp__row">
                        <span className="ob-icp__bullet ob-icp__bullet--desire" />
                        <input
                          value={d}
                          onChange={(e) => updItem(setIcpDesires, i, e.target.value)}
                          placeholder="The outcome they actually want"
                        />
                        <button type="button" className="ob-icp__rm" onClick={() => rmItem(setIcpDesires, i)}><X className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="ob-icp__add" onClick={() => addItem(setIcpDesires)}>
                    <Plus className="w-3 h-3" /> Add desire
                  </button>
                </div>

                <div className="ob-icp__col">
                  <div className="ob-icp__col-head ob-icp__col-head--obj">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Objections</span>
                    <span className="ob-icp__col-count">{icpObjections.length}</span>
                  </div>
                  <ul className="ob-icp__list">
                    {icpObjections.map((o, i) => (
                      <li key={i} className="ob-icp__row">
                        <span className="ob-icp__bullet ob-icp__bullet--obj" />
                        <input
                          value={o}
                          onChange={(e) => updItem(setIcpObjections, i, e.target.value)}
                          placeholder="What they'll push back with"
                        />
                        <button type="button" className="ob-icp__rm" onClick={() => rmItem(setIcpObjections, i)}><X className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="ob-icp__add" onClick={() => addItem(setIcpObjections)}>
                    <Plus className="w-3 h-3" /> Add objection
                  </button>
                </div>
              </div>

              <div className="ob-icp__voice">
                <div className="ob-icp__col-head ob-icp__col-head--voice">
                  <MessageCircle className="w-4 h-4" />
                  <span>Language style</span>
                </div>
                <textarea
                  rows={3}
                  value={icpLanguage}
                  onChange={(e) => setIcpLanguage(e.target.value)}
                  placeholder="How they talk · words they use · words they hate"
                />
                <p className="ob-icp__hint">The Writer agent uses this to draft messages that sound like one of them, not a sales rep.</p>
              </div>

              <p className="ob-icp__deploy-note">
                <strong>Buying signals</strong>, prospect-list filters, and channel rules are part of <em>campaign deployment</em> - you'll configure them in the workspace, where you can iterate without re-onboarding.
              </p>
            </div>

            <div className="ob-actions">
              <button type="button" className="ob-back" onClick={goBack}>
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button type="button" className="ob-cta" onClick={saveIcpsAndAdvance} disabled={icpSaving}>
                {icpSaving ? (<><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>) : (<>Save ICP · build my workspace <Zap className="w-4 h-4" /></>)}
              </button>
            </div>
          </section>
        )}

        {step === "build" && (
          <section className="ob-card ob-card--build">
            <span className="kicker"><Loader2 className="w-3 h-3 animate-spin" />Step 2 of 5 · Building · on us</span>
            <h1 className="ob-h1">
              Building your <em>workspace</em><span className="dot">.</span>
            </h1>
            <p className="ob-lead">
              We're spinning up your workspace - ICP, list, sequence, the lot. Stay on this tab. Should take ~10 seconds.
            </p>
            <div className="ob-on-us">
              <div className="ob-on-us__badge">ON THE HOUSE</div>
              <div className="ob-on-us__body">
                This first build is our treat - so you see it work before you pay anyone a cent. <strong>You'll add your own key right after.</strong>
              </div>
            </div>
            <ol className="ob-build">
              {BUILD_TASKS.map((t, i) => {
                const done = i < tasksDone;
                const active = i === tasksDone;
                return (
                  <li key={i} className={"ob-build__row" + (done ? " is-done" : active ? " is-active" : " is-pending")}>
                    <div className="ob-build__icon">
                      {done ? <Check className="w-4 h-4" /> : active ? <Loader2 className="w-4 h-4 animate-spin" /> : <t.icon className="w-4 h-4" />}
                    </div>
                    <div className="ob-build__body">
                      <div className="ob-build__lab">{t.lab}</div>
                      <div className="ob-build__detail">{t.detail}</div>
                    </div>
                    <div className="ob-build__status">
                      {done ? "Done" : active ? "Working…" : "Queued"}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {step === "ai" && (
          <section className="ob-card ob-card--ai">
            <span className="kicker"><Key className="w-3 h-3" />Step 3 of 5 · Add your OpenRouter key</span>
            <h1 className="ob-h1">
              First build's <em>on us</em>. Now it's yours<span className="dot">.</span>
            </h1>
            <p className="ob-lead">
              You just saw it work. Drop your key in to keep the lights on - your account, your bill, any model on the market. We never see the invoice.
            </p>

            <div className="ob-keybox">
              <div className="ob-keybox__head">
                <Key className="w-4 h-4" />
                <span>OpenRouter API key</span>
                <span className="ob-keybox__req">Required</span>
              </div>
              <input
                className="ob-keybox__input"
                type="password"
                placeholder="sk-or-v1-..."
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <div className="ob-keybox__row">
                <span className="ob-keybox__hint">
                  {openrouterKey.startsWith("sk-or-")
                    ? <><Check className="w-3 h-3" style={{ color: "var(--live, #1F8A5B)" }} /> Format looks right · encrypted on submit</>
                    : "Encrypted at rest · never logged · rotate or revoke from settings anytime"}
                </span>
                <a className="ob-keybox__get" href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">
                  Get a key at openrouter.ai →
                </a>
              </div>
            </div>

            <div className="ob-key-grid">
              <div className="ob-key-card">
                <div className="ob-key-card__num">$0</div>
                <div className="ob-key-card__lab">ACA markup on tokens</div>
                <p>Whatever OpenRouter charges, that's what you pay. We don't touch the bill.</p>
              </div>
              <div className="ob-key-card">
                <div className="ob-key-card__num">~$8 - $25</div>
                <div className="ob-key-card__lab">Typical monthly token spend</div>
                <p>For solo founders running 30-50 messages/day with personalization. Scales with volume.</p>
              </div>
              <div className="ob-key-card">
                <div className="ob-key-card__num">∞</div>
                <div className="ob-key-card__lab">Models you can switch between</div>
                <p>Claude, GPT, Gemini, Llama, DeepSeek, anything. Switch in settings without re-onboarding.</p>
              </div>
            </div>

            <div className="ob-actions">
              <button
                type="button"
                className="ob-skip"
                disabled={keySubmitting}
                onClick={() => { setSkippedAi(true); setKeyError(null); goNext(); }}
              >
                Skip · I'll add it later
              </button>
              <button
                type="button"
                className="ob-cta"
                disabled={!openrouterKey.startsWith("sk-or-") || openrouterKey.length < 20 || keySubmitting}
                onClick={async () => {
                  const ok = await saveProviderKey("openrouter", openrouterKey);
                  if (ok) { setSkippedAi(false); goNext(); }
                }}
              >
                {keySubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Save key <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>

            {keyError && <p className="ob-key-error">{keyError}</p>}

            <p className="ob-key-foot">
              No key yet? <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">Create one in 60 seconds</a>. OpenRouter accepts any model account you already have (Anthropic, OpenAI, Google, etc.).
            </p>
          </section>
        )}

        {step === "apify" && (
          <section className="ob-card ob-card--apify">
            <span className="kicker ob-kicker--free">
              <span className="live-dot" />Step 4 of 5 · Add your Apify key · free to start
            </span>
            <h1 className="ob-h1">
              The <em>scrapers</em> need a key too<span className="dot">.</span>
            </h1>
            <p className="ob-lead">
              One more - Apify is what makes the scrapers run. <strong>Free tier handles most setups</strong>, you only pay if you scale past ~$5/mo. Same deal: your account, your bill, we don't touch it.
            </p>

            <div className="ob-keybox ob-keybox--free">
              <div className="ob-keybox__head">
                <Layers className="w-4 h-4" />
                <span>Apify API token</span>
                <span className="ob-keybox__req ob-keybox__req--free">Required · free tier</span>
              </div>
              <input
                className="ob-keybox__input"
                type="password"
                placeholder="apify_api_..."
                value={apifyKey}
                onChange={(e) => setApifyKey(e.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
              />
              <div className="ob-keybox__row">
                <span className="ob-keybox__hint">
                  {apifyKey.length >= 20
                    ? <><Check className="w-3 h-3" style={{ color: "var(--live, #1F8A5B)" }} /> Token added · encrypted on submit</>
                    : "Encrypted at rest · never logged · rotate or revoke from settings anytime"}
                </span>
                <a className="ob-keybox__get ob-keybox__get--free" href="https://www.apify.com?fpr=8xj4n" target="_blank" rel="noopener noreferrer">
                  Sign up free at apify.com →
                </a>
              </div>
            </div>

            <div className="ob-key-grid">
              <div className="ob-key-card">
                <div className="ob-key-card__num" style={{ color: "var(--live, #1F8A5B)" }}>$5</div>
                <div className="ob-key-card__lab">Free tier credit · monthly</div>
                <p>Apify gives every account $5 of compute every month. Most solo operators run their entire pipeline within that.</p>
              </div>
              <div className="ob-key-card">
                <div className="ob-key-card__num">$0</div>
                <div className="ob-key-card__lab">ACA markup on usage</div>
                <p>Whatever Apify charges past the free tier, that's what you pay. We never touch the bill.</p>
              </div>
              <div className="ob-key-card">
                <div className="ob-key-card__num">~10s</div>
                <div className="ob-key-card__lab">Token from signup</div>
                <p>Click sign up, copy your token from Settings → Integrations. We pre-loaded the affiliate link so you start with bonus credits.</p>
              </div>
            </div>

            <div className="ob-actions">
              <button
                type="button"
                className="ob-skip"
                disabled={keySubmitting}
                onClick={() => { setSkippedApify(true); setKeyError(null); goNext(); }}
              >
                Skip · I'll add it later
              </button>
              <button
                type="button"
                className="ob-cta"
                disabled={apifyKey.length < 20 || keySubmitting}
                onClick={async () => {
                  const ok = await saveProviderKey("apify", apifyKey);
                  if (ok) { setSkippedApify(false); goNext(); }
                }}
              >
                {keySubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <>Save token · finish setup <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>

            {keyError && <p className="ob-key-error">{keyError}</p>}

            <p className="ob-key-foot">
              No Apify account yet? <a href="https://www.apify.com?fpr=8xj4n" target="_blank" rel="noopener noreferrer">Create one in 30 seconds with our affiliate link</a> - same free tier, plus extra credits.
            </p>
          </section>
        )}

        {step === "ready" && lead && (
          <section className="ob-card ob-card--ready">
            <div className="ob-ready__hero">
              <div className="ob-ready__icon"><Check className="w-7 h-7" /></div>
              <span className="kicker"><span className="live-dot" />{job?.returningUser ? "Playbook added" : "Workspace ready"} · {playbook.niche}</span>
              <h1 className="ob-h1">
                {job?.returningUser ? <>It's <em>queued up</em><span className="dot">.</span></> : <>You're <em>set up</em><span className="dot">.</span></>}
              </h1>
              <p className="ob-lead">
                {job?.returningUser
                  ? `${lead.fullName?.split(" ")[0] || "OK"} - this playbook is sitting in your workspace, tagged and ready to review. Click any artifact to open it.`
                  : `${lead.fullName?.split(" ")[0] || "OK"} - your ACA workspace is provisioned. Here's what we built. Click any artifact to open it.`}
              </p>
            </div>

            {(skippedAi || skippedApify) && (
              <div className="ob-pending">
                <div className="ob-pending__icon"><Key className="w-4 h-4" /></div>
                <div className="ob-pending__body">
                  <strong>One thing to finish later:</strong>{" "}
                  Your workspace can show, draft, and stage everything - but it can't <em>send</em> yet.
                  {skippedAi && skippedApify && " Drop in your OpenRouter key and Apify token from settings when you're ready."}
                  {skippedAi && !skippedApify && " Drop in your OpenRouter key from settings when you're ready."}
                  {!skippedAi && skippedApify && " Drop in your Apify token from settings when you're ready."}
                </div>
                <button type="button" className="ob-pending__cta" onClick={() => navigate("/settings?tab=integrations")}>
                  Add now
                </button>
              </div>
            )}

            <div className="ob-artifacts">
              <button type="button" className="ob-art" onClick={() => navigate("/leads")}>
                <div className="ob-art__head">
                  <Target className="w-4 h-4" />
                  <span>ICP · {icpIndustry}</span>
                  <span className="ob-art__chip">512 buyers</span>
                </div>
                <div className="ob-art__body">
                  <strong>{icpRoles || "VP of Talent · Director of Recruiting"}</strong>
                  <p>{icpSize} · pool refreshing daily</p>
                </div>
                <span className="ob-art__cta">Open list →</span>
              </button>

              <button type="button" className="ob-art" onClick={() => navigate("/sequences")}>
                <div className="ob-art__head">
                  <Megaphone className="w-4 h-4" />
                  <span>Sequence · 5 touches</span>
                  <span className="ob-art__chip">Draft</span>
                </div>
                <div className="ob-art__body">
                  <strong>LI connect → DM → email → 2nd LI → break-up</strong>
                  <p>Voice trained on {lead.website || "your site"}. Ready to launch.</p>
                </div>
                <span className="ob-art__cta">Open campaign →</span>
              </button>

              <button type="button" className="ob-art" onClick={() => navigate("/lead-magnets")}>
                <div className="ob-art__head">
                  <FileText className="w-4 h-4" />
                  <span>Lead magnet · framework</span>
                  <span className="ob-art__chip">1 page</span>
                </div>
                <div className="ob-art__body">
                  <strong>"AI Candidate Qualification Calculator"</strong>
                  <p>Conversion target: {lead.niche?.toLowerCase().includes("agency") ? "agency owners" : "your buyer"}. Hosted, ready to share.</p>
                </div>
                <span className="ob-art__cta">Open lead magnet →</span>
              </button>

              <button type="button" className="ob-art" onClick={() => navigate("/blueprints")}>
                <div className="ob-art__head">
                  <Layers className="w-4 h-4" />
                  <span>Content blueprint</span>
                  <span className="ob-art__chip">Daily LI</span>
                </div>
                <div className="ob-art__body">
                  <strong>1 LinkedIn post / day · 3 themes</strong>
                  <p>Niche: {playbook.niche}. Voice: yours. Auto-publishes when you approve.</p>
                </div>
                <span className="ob-art__cta">Open blueprint →</span>
              </button>

              <button type="button" className="ob-art" onClick={() => navigate("/people")}>
                <div className="ob-art__head">
                  <Bot className="w-4 h-4" />
                  <span>AI agent · trained</span>
                  <span className="ob-art__chip">Ready</span>
                </div>
                <div className="ob-art__body">
                  <strong>Your voice · {openrouterKey ? "OpenRouter (BYO key)" : "ACA default model"}</strong>
                  <p>Trained on your site copy. Drafts replies, qualifies prospects, escalates to you.</p>
                </div>
                <span className="ob-art__cta">Open agent →</span>
              </button>

              <button type="button" className="ob-art" onClick={() => navigate("/jobs")}>
                <div className="ob-art__head">
                  <Sparkles className="w-4 h-4" />
                  <span>Strategy doc · 60-day plan</span>
                  <span className="ob-art__chip">Tuned to {lead.revenue || "your stage"}</span>
                </div>
                <div className="ob-art__body">
                  <strong>{playbook.outcome}</strong>
                  <p>Day 1 → 60 plan, weekly checkpoints, what to ship each week.</p>
                </div>
                <span className="ob-art__cta">Open strategy →</span>
              </button>
            </div>

            <div className="ob-ready__cta">
              <button
                type="button"
                className="ob-cta ob-cta--big"
                disabled={magicLinkLoading}
                onClick={handleMagicLink}
              >
                {magicLinkLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Signing you in…</>
                ) : (
                  <>Take me to my workspace <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
              <button
                type="button"
                className="ob-skip"
                disabled={magicLinkLoading}
                onClick={handleMagicLink}
              >
                {magicLinkLoading ? "Hold on…" : "Take the 90-second tour first"}
              </button>
            </div>

            <div className="ob-ready__foot">
              <span>Free 14-day trial. No card. Cancel anytime from settings.</span>
              <span>· You can also <Link to="/auth">log in</Link> if you have an account.</span>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
