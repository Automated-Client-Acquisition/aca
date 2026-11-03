import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Briefcase,
  Calendar,
  Check,
  CheckCircle2,
  FileText,
  GraduationCap,
  Layers,
  Linkedin,
  Loader2,
  Megaphone,
  MessageCircle,
  PhoneCall,
  Sparkles,
  Sparkle,
  Target,
  Users,
  X,
} from "lucide-react";
import "@/styles/aca-home.css";
import "@/styles/marketing-specialized.css";
import "@/styles/onboarding-account.css";
import { Logo } from "@/components/marketing/Logo";
import { loadAttribution } from "@/lib/attribution";
import { track } from "@/lib/tracking";
import Sandbox from "@/pages/marketing/Sandbox";
import { loadOnboardingPreview, saveOnboardingPreview, isOnboardingPreviewDraft, normalizePreviewWebsite, type OnboardingPreviewDraft } from "@/lib/onboarding-preview";
import { isOnboardingJob, readOnboardingSession, resolveOnboardingStep, type OnboardingStep } from "@/lib/onboarding-session";

// ─── Wizard config ─────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome", label: "Your preview" },
  { id: "about", label: "Create account" },
  { id: "build", label: "Build workspace" },
  { id: "ready", label: "Review drafts" },
] as const;
type StepId = OnboardingStep;
const QUESTION_STEPS: StepId[] = ["about"];

const GOALS: Array<{ id: string; label: string; desc: string; icon: typeof PhoneCall }> = [
  { id: "book_calls",    label: "Book sales calls",     desc: "Outbound that lands meetings on your calendar",     icon: PhoneCall },
  { id: "sell_course",   label: "Sell my course",       desc: "Lead magnet → nurture → buy. On autopilot.",         icon: GraduationCap },
  { id: "fill_pipeline", label: "Fill agency pipeline", desc: "Cold outreach across LinkedIn + email + DMs",        icon: Users },
  { id: "dfy_offer",     label: "Land DFY clients",     desc: "High-ticket inbound from your authority content",    icon: Sparkle },
];

// Live micro-copy that swaps as each build task runs. Bound to the
// current_task field on provisioning_jobs so the user sees what's actually
// happening, not a static spinner.
const TASK_HERO_COPY: Record<string, string> = {
  icp: "Drafting a buyer profile from your website…",
  product: "Summarizing what you sell…",
  knowledge: "Preparing your business context…",
  audit: "Reviewing your LinkedIn profile…",
  sequence: "Writing outreach drafts for you to review…",
  blueprint: "Planning content themes for your buyers…",
  campaign: "Creating a draft campaign. No messages are being sent…",
  content_plan: "Drafting your content calendar…",
  agent: "Preparing a reply assistant configuration…",
  strategy: "Writing your acquisition playbook…",
  leads: "Preparing starter prospects for review…",
};

const BUILD_TASKS: Array<{ key: string; lab: string; detail: string; icon: typeof Target }> = [
  { key: "icp",          lab: "Profiling your buyer",         detail: "The exact person you should be selling to",          icon: Target },
  { key: "product",      lab: "Pulling your offer",           detail: "From your homepage, in your words",                  icon: Briefcase },
  { key: "knowledge",    lab: "Loading your knowledge base",  detail: "So your replies sound like you, not a robot",        icon: FileText },
  { key: "audit",        lab: "Auditing your LinkedIn",       detail: "Score · new headline · new About section",           icon: Linkedin },
  { key: "sequence",     lab: "Writing your email sequence",  detail: "5 editable outreach drafts",                icon: MessageCircle },
  { key: "blueprint",    lab: "Designing your content cadence", detail: "Content themes to review and adapt",    icon: Layers },
  { key: "campaign",     lab: "Building your LinkedIn campaign", detail: "Connect → message → follow up → switch to email", icon: Megaphone },
  { key: "content_plan", lab: "Writing your 30-day content plan", detail: "Every post angle, ready to publish",             icon: Sparkles },
  { key: "agent",        lab: "Setting up your booking assistant", detail: "Draft configuration to review before enabling", icon: Bot },
  { key: "strategy",     lab: "Drafting your 60-day plan",    detail: "Day-by-day, so you never wonder what's next",        icon: Sparkles },
  { key: "leads",        lab: "Filling your first lead list", detail: "Starter prospects to review and qualify", icon: Target },
];

interface OnboardJob {
  jobId: string;
  organizationId: string;
  provisioningToken: string;
  tasksDone?: Record<string, string>;
  returningUser?: boolean;
}

interface ExistingAccount {
  firstName: string | null;
  orgName: string | null;
}

/** Trial terms as the server reports them - never assumed on the client. */
interface CheckoutTerms {
  trialDays: number;
  /** True when a real charge is taken today rather than a $0 card capture. */
  paidTrial: boolean;
  monthlyPrice: number;
}

// Mirrors the server check in provision-playbook-workspace. The old
// [^\s@]+@[^\s@]+\.[^\s@]+ accepted a pasted URL fragment like
// "dean@example.co.uk/", which sailed past the wizard and then failed at
// account creation with an unhelpful error - a real prospect burned five
// attempts on it and never got in.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const isValidEmail = (v: string) => {
  const e = v.trim();
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
};

const ob_labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};
const ob_labelText: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.2,
};
const ob_inputStyle: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.15)",
  background: "rgba(255,255,255,0.7)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function GetStarted() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [restored] = useState(() => {
    const candidate = readOnboardingSession<OnboardJob>("aca:getstarted:job");
    const lead = readOnboardingSession<Record<string, unknown>>("aca:getstarted:lead") || {};
    const passedPreview: unknown = location.state?.preview;
    const preview = isOnboardingPreviewDraft(passedPreview) ? passedPreview : loadOnboardingPreview();
    let savedStep: string | null = null;
    try { savedStep = sessionStorage.getItem("aca:getstarted:step"); } catch { /* Optional storage. */ }
    return { job: isOnboardingJob(candidate) ? candidate : null, lead, preview, savedStep };
  });
  const [previewDraft, setPreviewDraft] = useState(restored.preview);
  const initialStep = resolveOnboardingStep({
    urlStep: searchParams.get("step"), savedStep: restored.savedStep,
    hasJob: !!restored.job, hasPreview: !!restored.preview,
    handoff: searchParams.get("preview") === "1",
  });
  const leadString = (key: string) => typeof restored.lead[key] === "string" ? restored.lead[key] as string : "";

  const [step, _setStep] = useState<StepId>(initialStep);
  const setStep = (s: StepId) => {
    _setStep(s);
    try { sessionStorage.setItem("aca:getstarted:step", s); } catch { /* ignore */ }
  };

  // Lead state
  const [fullName, setFullName] = useState(leadString("fullName"));
  const [email, setEmail] = useState(leadString("email"));
  const [website, setWebsite] = useState(restored.preview?.kind === "live" ? restored.preview.website : leadString("website"));
  const [linkedinUrl, setLinkedinUrl] = useState(restored.preview?.kind === "live" ? restored.preview.linkedinUrl : leadString("linkedinUrl"));
  const [goal, setGoal] = useState(leadString("goal") || "book_calls");
  const [painChips] = useState<string[]>(Array.isArray(restored.lead.painChips) ? restored.lead.painChips.filter((v): v is string => typeof v === "string") : []);
  const [painText] = useState(leadString("painText"));

  // Build state
  const [job, setJob] = useState<OnboardJob | null>(restored.job);
  const [existing, setExisting] = useState<ExistingAccount | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [signInLoading, setSignInLoading] = useState(false);
  // Live build feedback
  const [currentTask, setCurrentTask] = useState<string>("");
  const [icpPreview, setIcpPreview] = useState<{ name: string; summary: string } | null>(null);
  const [auditPreview, setAuditPreview] = useState<{ overall: number | null; headline: string | null } | null>(null);
  const [leadsPreview, setLeadsPreview] = useState<{ count: number; companies: string[] } | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  // Served by get-provisioning-status. Defaults match the free card-required
  // trial, which is what Stripe does when no trial-fee price is configured.
  const [checkoutTerms, setCheckoutTerms] = useState<CheckoutTerms>({
    trialDays: 3, paidTrial: false, monthlyPrice: 67,
  });
  // Read once on mount: whether this visitor arrived from an ad. Decides
  // whether the ready screen asks for a card or hands over a trial.
  const [paidVisitor] = useState<boolean>(() => loadAttribution()?.paid === true);
  const [submitting, setSubmitting] = useState(false);
  const [tasksDone, setTasksDone] = useState(0);
  const [progressRetry, setProgressRetry] = useState(0);
  const [taskResults, setTaskResults] = useState<Record<string, string>>({});
  const [buildIssue, setBuildIssue] = useState("");
  const [magicLinkLoading, setMagicLinkLoading] = useState(false);
  const buildTimerRef = useRef<number | null>(null);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (stageHeadingRef.current) {
        stageHeadingRef.current.focus({ preventScroll: true });
        window.scrollTo({ top: 0 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => { track("wizard_viewed"); }, []);

  function continueFromPreview(draft: OnboardingPreviewDraft) {
    saveOnboardingPreview(draft);
    setPreviewDraft(draft);
    if (draft.kind === "live") {
      setWebsite(draft.website);
      setLinkedinUrl(draft.linkedinUrl);
    }
    track("onboarding_preview_completed", { kind: draft.kind });
    setStep("about");
  }

  // Back from Stripe. On success sign them straight in - someone who has just
  // paid should not be asked to log in as their next experience. On cancel,
  // say nothing dramatic and leave the checkout button where it was.
  const checkoutResult = searchParams.get("checkout");
  useEffect(() => {
    if (!checkoutResult) return;
    if (checkoutResult === "canceled") {
      toast("No charge made - your workspace is still here when you're ready.");
      return;
    }
    if (checkoutResult === "success" && job?.provisioningToken) {
      // The conversion that matters. Stripe is the source of truth for money,
      // but the ad platforms need a client-side signal to optimise delivery,
      // and this is the only moment we get one.
      track("trial_started", { value: checkoutTerms.monthlyPrice, currency: "USD" });
      toast.success("You're in. Taking you to your workspace…");
      handleMagicLink("/campaigns");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutResult, job?.provisioningToken]);

  // Whenever any lead field changes, persist so refresh doesn't lose them.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "aca:getstarted:lead",
        JSON.stringify({ fullName, email, website, linkedinUrl, goal, painChips, painText }),
      );
    } catch { /* ignore */ }
  }, [fullName, email, website, linkedinUrl, goal, painChips, painText]);

  const currentStepIdx = STEPS.findIndex((s) => s.id === step);
  const questionIdx = QUESTION_STEPS.indexOf(step);
  const progressPct = Math.round((currentStepIdx / (STEPS.length - 1)) * 100);

  // Debounced check: does this email already have a workspace?
  useEffect(() => {
    if (step !== "about" || !email || !isValidEmail(email)) {
      setExisting(null);
      return;
    }
    let cancelled = false;
    setCheckingEmail(true);
    const t = window.setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke("check-email-exists", {
          body: { email },
        });
        if (cancelled) return;
        if (data?.exists) {
          setExisting({
            firstName: (data.firstName as string | null) || null,
            orgName: (data.orgName as string | null) || null,
          });
        } else {
          setExisting(null);
        }
      } catch {
        if (!cancelled) setExisting(null);
      } finally {
        if (!cancelled) setCheckingEmail(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      setCheckingEmail(false);
    };
  }, [email, step]);

  // "Sign in instead" - sends a passwordless magic link to the existing
  // account and routes them straight into the workspace, no provisioning.
  async function sendSignInLink() {
    if (!email) return;
    setSignInLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/campaigns?returning=1`,
        },
      });
      if (error) throw error;
      toast.success(`Check ${email} for your sign-in link`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send sign-in link");
    } finally {
      setSignInLoading(false);
    }
  }

  function canAdvance(): boolean {
    return !!fullName.trim() && isValidEmail(email) && !!normalizePreviewWebsite(website) && !!previewDraft;
  }

  async function startProvisioning() {
    if (submitting || !canAdvance()) return;
    setSubmitting(true);
    try {
      const goalObj = GOALS.find((g) => g.id === goal);
      const niche = goalObj?.label || "B2B services";
      const allPains = [...painChips, ...(painText ? [painText.trim()] : [])];

      const { data, error } = await supabase.functions.invoke("provision-playbook-workspace", {
        body: {
          fullName: fullName.trim(),
          email: email.trim(),
          website: normalizePreviewWebsite(website),
          linkedinUrl: linkedinUrl || undefined,
          biggestNeed: allPains.join(" | "),
          painPoints: allPains,
          goal: goalObj?.label || goal,
          niche,
          outcome: goalObj?.label || "growth",
          source: "get_started",
          // First-touch click ids / UTMs, stamped on landing. Without these
          // every paid signup is indistinguishable from organic once the
          // query string is gone.
          attribution: loadAttribution() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      const j: OnboardJob = {
        jobId: data.jobId,
        organizationId: data.organizationId,
        provisioningToken: data.provisioningToken,
        tasksDone: data.tasksDone,
        returningUser: !!data.returningUser,
      };
      setJob(j);
      try { sessionStorage.setItem("aca:getstarted:job", JSON.stringify(j)); } catch { /* Continue with in-memory job. */ }
      // A workspace now exists. For organic traffic this IS the conversion;
      // for paid traffic it is the step before the card.
      track("lead_captured");
      track("signup_started", { paid_traffic: paidVisitor });
      setStep("build");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start your workspace";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // Poll build progress, kick off LLM generation once
  useEffect(() => {
    if ((step !== "build" && step !== "ready") || !job?.provisioningToken) return;
    let cancelled = false;
    let lastKickAt = 0;
    let failures = 0;
    let lastMovement = Date.now();
    let previousProgress = "";
    setBuildIssue("");

    const kick = async () => {
      lastKickAt = Date.now();
      try {
        await supabase.functions.invoke("generate-playbook-artifacts", {
          body: { provisioningToken: job.provisioningToken },
        });
      } catch (e) {
        console.warn("[getstarted] kick error:", e);
      }
    };


    const poll = async () => {
      if (cancelled) return;
      try {
        // Kick FIRST, before any read. The visitor is anonymous here, so a
        // read that fails must never be able to swallow the kick - that was
        // the bug that stranded every real signup at "account done, 0 assets".
        if (lastKickAt === 0 && step === "build") kick();

        // Token-gated status endpoint, NOT a direct table read: RLS on
        // provisioning_jobs only admits super admins, so selecting it with the
        // anon client returns null forever for an actual prospect.
        const { data, error } = await supabase.functions.invoke("get-provisioning-status", {
          body: { provisioningToken: job.provisioningToken },
        });
        if (cancelled) return;
        if (error || !data?.tasks_done) {
          failures += 1;
          const status = (error as { context?: { status?: number } } | null)?.context?.status;
          if (status === 401 || status === 404 || failures >= 10) {
            setBuildIssue(status === 401
              ? "This setup link has expired. Sign in to your workspace to continue."
              : "We couldn't retrieve your workspace progress. You can retry or sign in to review the drafts already created.");
            return;
          }
          // Status is unreadable - retry the kick occasionally in case the
          // first one dropped, but never fast enough to race a live run.
          if (step === "build" && Date.now() - lastKickAt > 30000) kick();
          buildTimerRef.current = window.setTimeout(poll, 3000);
          return;
        }
        failures = 0;
        const td = (data.tasks_done as Record<string, string>) || {};
        setTaskResults(td);
        const progressSignature = JSON.stringify(td) + data.current_task;
        if (progressSignature !== previousProgress) {
          previousProgress = progressSignature;
          lastMovement = Date.now();
        } else if (step === "build" && Date.now() - lastMovement > 120_000) {
          setBuildIssue("Setup is taking longer than expected. Retry progress or sign in to review the drafts already created.");
          return;
        }
        // Count against the SAME set the build screen renders. The audit row is
        // hidden when no LinkedIn URL was given but still comes back "skipped",
        // which read as "11 of 10 done".
        const countable = BUILD_TASKS.filter((t) => t.key !== "audit" || !!linkedinUrl);
        const completed = countable.filter((t) => td[t.key] === "done" || td[t.key] === "skipped").length;
        setTasksDone(completed);
        if (data.current_task) setCurrentTask(String(data.current_task));

        // Live teasers ride along on the status response. They used to be read
        // straight from library_icps / linkedin_audits with the anon client,
        // which RLS refuses for a not-yet-signed-in visitor - so they never
        // once rendered for a real user.
        const preview = (data.preview || {}) as {
          icp?: { name: string; summary: string };
          audit?: { overall: number | null; headline: string | null };
          leads?: { count: number; companies: string[] };
        };
        if (preview.icp) setIcpPreview(preview.icp);
        if (preview.audit) setAuditPreview(preview.audit);
        if (preview.leads) setLeadsPreview(preview.leads);
        // Trial terms are the server's to state, not ours to guess.
        if (data.checkout) setCheckoutTerms(data.checkout as CheckoutTerms);

        // Re-kick a job still sitting at "queued": the generator fast-returns
        // 202 and runs async, so no movement means the kick itself dropped
        // (cold start / 502).
        if (step === "build" && data.current_task === "queued" && completed === 0 && Date.now() - lastKickAt > 20000) {
          kick();
        }

        if (data.status === "failed") {
          setBuildIssue("Workspace setup couldn't finish. You can retry progress or sign in to review what was created.");
          return;
        }
        if (data.status === "done" || completed >= countable.length) {
          if (step === "ready") return;
          // Every artifact built and the reveal is about to show. The gap
          // between this and signup_started is where generation failures hide.
          track("signup_completed");
          buildTimerRef.current = window.setTimeout(() => setStep("ready"), 1200);
          return;
        }
        if (step === "ready") setStep("build");
        buildTimerRef.current = window.setTimeout(poll, 2000);
      } catch (e) {
        if (cancelled) return;
        console.warn("[getstarted] poll error:", e);
        if (++failures >= 10) {
          setBuildIssue("Connection interrupted. Retry or sign in to review the drafts already created.");
          return;
        }
        buildTimerRef.current = window.setTimeout(poll, 3000);
      }
    };

    setTasksDone(0);
    poll();

    return () => {
      cancelled = true;
      if (buildTimerRef.current) window.clearTimeout(buildTimerRef.current);
    };
  }, [step, job?.provisioningToken, job?.jobId, linkedinUrl, progressRetry]);

  // Paid traffic pays before entering. Stripe bounces them back here with
  // ?checkout=success, at which point the job is still in sessionStorage and
  // we can sign them straight in - no second login step after paying.
  async function startCheckout() {
    if (!job?.provisioningToken) {
      navigate("/auth");
      return;
    }
    setCheckoutLoading(true);
    try {
      const origin = window.location.origin;
      const { data, error } = await supabase.functions.invoke("create-trial-checkout", {
        body: {
          provisioningToken: job.provisioningToken,
          plan: "monthly",
          successUrl: `${origin}/get-started?step=ready&checkout=success`,
          cancelUrl: `${origin}/get-started?step=ready&checkout=canceled`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      if (!data?.url) throw new Error("No checkout URL returned");
      // Fire before the redirect - once we hand off to Stripe this page is gone.
      track("checkout_started", { value: checkoutTerms.monthlyPrice, currency: "USD" });
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open checkout");
      setCheckoutLoading(false);
    }
  }

  // dest lets the ready screen sign them in and drop them directly on the one
  // action that unblocks sending, instead of signing in and leaving them to
  // find it. Default is /campaigns - they came here to book meetings, and the
  // content job list is the wrong first screen for that promise.
  async function handleMagicLink(dest = "/campaigns?onboarded=1") {
    if (!job?.provisioningToken) {
      navigate("/auth");
      return;
    }
    setMagicLinkLoading(true);
    try {
      const redirectTo = `${window.location.origin}${dest}`;
      const { data, error } = await supabase.functions.invoke("request-workspace-magic-link", {
        body: { provisioningToken: job.provisioningToken, redirectTo },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error as string);
      if (!data?.url) throw new Error("No magic link returned");
      try {
        sessionStorage.removeItem("aca:getstarted:job");
        sessionStorage.removeItem("aca:getstarted:step");
        sessionStorage.removeItem("aca:getstarted:lead");
      } catch { /* A blocked storage policy must not prevent sign-in. */ }
      window.location.href = data.url as string;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign you in");
      setMagicLinkLoading(false);
    }
  }

  function goNext() { if (step === "about") startProvisioning(); }
  function goBack() {
    if (step !== "about") return;
    setStep("welcome");
    navigate("/get-started", { replace: true, state: null });
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  if (step === "welcome" || (!job && !previewDraft)) {
    return <Sandbox initialDraft={previewDraft} onContinue={continueFromPreview} />;
  }

  return (
    <div className="ob-shell ob-value-account">
      <header className="ob-topbar">
        <Link to="/" className="ob-brand">
          <Logo size={26} className="ob-logo" />
        </Link>
        {/* Desktop: visual stepper pills */}
        <div className="ob-stepper ob-stepper--desktop">
          {STEPS.filter((s) => s.id !== "ready").map((s, i) => {
            // Build and review share the final workspace stage.
            const qi = i;
            const done = i < currentStepIdx;
            return (
              <div
                key={s.id}
                className={
                  "ob-step-pill" +
                  (qi < 0 ? " ob-step-pill--plain" : "") +
                  (done ? " is-done" : "") +
                  (i === Math.min(currentStepIdx, 2) ? " is-current" : "")
                }
              >
                {(qi >= 0 || done) && (
                  <span className="ob-step-pill__dot">
                    {done ? <Check className="w-3 h-3" /> : qi + 1}
                  </span>
                )}
                <span className="ob-step-pill__lab">{s.label}</span>
              </div>
            );
          })}
        </div>
        {/* Keep the current stage readable on small screens. */}
        <div className={"ob-stepper-mobile" + (questionIdx >= 0 ? " has-count" : "")}>
          {questionIdx >= 0 && (
            <>
              <span className="ob-stepper-mobile__count">Step 2 of 3</span>
              <span className="ob-stepper-mobile__sep">·</span>
            </>
          )}
          <span className="ob-stepper-mobile__lab">{STEPS[currentStepIdx].label}</span>
        </div>
        <button
          type="button"
          className="ob-quit"
          onClick={() => {
            navigate("/");
          }}
          title="Quit (progress is saved)"
          aria-label="Quit (progress is saved)"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="ob-progress">
        <div className="ob-progress__bar" style={{ width: progressPct + "%" }} />
      </div>

      <main className="ob-main">
        {step === "about" && (
          <section
            className="ob-card"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && canAdvance()) {
                e.preventDefault();
                goNext();
              }
            }}
          >
            <span className="kicker">Your preview is ready · Create account</span>
            <h1 ref={stageHeadingRef} tabIndex={-1} className="ob-h1">Turn your drafts into <em>a workspace</em><span className="dot">.</span></h1>
            <p className="ob-lead">
              Create an account to generate your editable buyer profile, outreach sequence and content plan.
              {" "}{previewDraft?.kind === "live" ? "Your website is carried over." : "Use your own website to tailor the workspace."} Workspace drafts may differ from your preview; nothing sends until you configure and launch it.
            </p>
            {previewDraft && <div className="vp-account-summary">
              <CheckCircle2 size={20} aria-hidden="true" />
              <div><strong>{previewDraft.kind === "live" ? previewDraft.preview.product.name : "Sample plan explored"}</strong>
                <span>{previewDraft.kind === "live" ? "Buyer profile · first email · content draft" : "Add your own website below to tailor your workspace."}</span></div>
              <button className="ob-back" type="button" onClick={goBack}>Review preview</button>
            </div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "8px 0 20px" }}>
              <label style={ob_labelStyle}>
                <span style={ob_labelText}>Your full name</span>
                <input style={ob_inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="Your name" />
              </label>
              <label style={ob_labelStyle}>
                <span style={ob_labelText}>
                  Work email
                  {checkingEmail && (
                    <em style={{ opacity: 0.5, fontWeight: 400, marginLeft: 8 }}>checking…</em>
                  )}
                </span>
                <input type="email" autoComplete="email" style={ob_inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourcompany.com" />
                <span style={{ fontSize: 11.5, opacity: 0.55, marginTop: 2 }}>
                  For workspace access and setup updates.
                </span>
              </label>
              {existing && (
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 12,
                    border: "1.5px solid var(--accent)",
                    background: "linear-gradient(180deg, #FFF8F4 0%, #FFFEFB 70%)",
                    boxShadow: "0 0 0 3px rgba(212,54,26,0.08)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                    <strong>
                      {existing.firstName ? `Welcome back, ${existing.firstName}.` : "You already have an account."}
                    </strong>{" "}
                    {existing.orgName
                      ? `We found your "${existing.orgName}" workspace already set up.`
                      : "We found your workspace already set up."}{" "}
                    Sign in to jump straight back in - or keep going and we'll add a fresh playbook on top of what you've already got.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    <button
                      type="button"
                      onClick={sendSignInLink}
                      disabled={signInLoading}
                      style={{
                        padding: "9px 16px",
                        background: "var(--accent)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: signInLoading ? "wait" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {signInLoading ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending link…</>
                      ) : (
                        <>Sign in to my workspace <ArrowRight className="w-3.5 h-3.5" /></>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExisting(null)}
                      style={{
                        padding: "9px 14px",
                        background: "transparent",
                        color: "var(--ink)",
                        border: "1px solid rgba(0,0,0,0.18)",
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Add a fresh playbook instead
                    </button>
                  </div>
                </div>
              )}
              <label style={ob_labelStyle}>
                <span style={ob_labelText}>Your website</span>
                <input style={ob_inputStyle} value={website} onChange={(e) => setWebsite(e.target.value)} autoComplete="url" placeholder="yourcompany.com" />
              </label>
              <details className="vp-optional"><summary>Personalize your plan (optional)</summary>
              <label style={ob_labelStyle}><span style={ob_labelText}>Your main goal</span><select style={ob_inputStyle} value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
              <label style={ob_labelStyle}>
                <span style={ob_labelText}>LinkedIn URL <em style={{ opacity: 0.6, fontWeight: 400 }}>(optional · unlocks profile audit)</em></span>
                <input style={ob_inputStyle} value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/yourname" />
              </label>
              </details>
            </div>
            <div className="ob-actions ob-actions--split">
              <button type="button" className="ob-back" onClick={goBack}><ArrowLeft className="w-4 h-4" /> Back to my preview</button>
              <button type="button" className="ob-cta" onClick={goNext} disabled={!canAdvance() || submitting}>
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating workspace…</> : <>Create my workspace <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
            <p className="vp-account-terms">{paidVisitor ? "Your drafts are free to preview. Trial price and card requirements are shown before checkout." : "3 days free · No card required · Then $67/month"}<br />Bring your own API keys. Provider subscriptions and usage cost extra.</p>
          </section>
        )}

        {step === "build" && (() => {
          // Hide the audit row entirely when the user didn't give a LinkedIn URL.
          const visibleTasks = BUILD_TASKS.filter((t) => !(t.key === "audit" && !linkedinUrl));
          const heroLine = (currentTask && TASK_HERO_COPY[currentTask]) || "Studying your business…";
          return (
          <section className="ob-card ob-card--build">
            {buildIssue && <div className="vp-error" role="alert"><p>{buildIssue}</p><div className="ob-actions"><button className="ob-cta" type="button" onClick={() => setProgressRetry((value) => value + 1)}>Retry progress</button><button className="ob-back" type="button" onClick={sendSignInLink} disabled={signInLoading}>Email me a sign-in link</button></div></div>}
            <span className="kicker"><Loader2 className="w-3 h-3 animate-spin" /> Engineering your strategy · {tasksDone} of {visibleTasks.length} done</span>
            <h1 ref={stageHeadingRef} tabIndex={-1} className="ob-h1">
              {job?.returningUser
                ? <>Engineering a <em>fresh go-to-market system</em> for your business<span className="dot">.</span></>
                : <>Engineering a <em>complete go-to-market system</em> for your business<span className="dot">.</span></>}
            </h1>
            {/* Live narration line - swaps as current_task updates */}
            <p className="ob-build-hero">
              <span className="ob-build-hero__dot" aria-hidden="true" />
              <span key={currentTask} className="ob-build-hero__text">{heroLine}</span>
            </p>
            <p className="ob-lead" style={{ marginTop: 4 }}>
              We're generating editable drafts from your website. You can review them inside before connecting accounts or launching a campaign.
              {job?.returningUser ? " Your existing work stays intact." : ""}
            </p>
            <ul className="ob-tasks" style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {visibleTasks.map((t, i) => {
                const done = taskResults[t.key] === "done";
                const skipped = taskResults[t.key] === "skipped";
                const failed = taskResults[t.key] === "failed";
                const running = !done && !skipped && !failed && currentTask === t.key;
                const Icon = t.icon;
                return (
                  <li
                    key={t.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      borderRadius: 10,
                      border: "1px solid rgba(0,0,0,0.08)",
                      opacity: done || running || failed ? 1 : 0.45,
                      background: done ? "rgba(0,160,80,0.06)" : running ? "rgba(212,170,26,0.06)" : "transparent",
                      transition: "background 0.3s ease, opacity 0.3s ease",
                    }}
                  >
                    <span style={{ width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {done ? <CheckCircle2 className="w-5 h-5" style={{ color: "rgb(0,160,80)" }} /> :
                       running ? <Loader2 className="w-5 h-5 animate-spin" /> :
                       failed ? <X className="w-5 h-5" style={{ color: "rgb(212,54,26)" }} /> :
                       <Icon className="w-5 h-5" />}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>{t.lab}{skipped ? " · Skipped" : failed ? " · Needs attention" : done ? " · Ready" : ""}</strong>
                      <span style={{ fontSize: 12, opacity: 0.7 }}>{t.detail}</span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Live preview: as soon as the ICP lands, show it. */}
            {icpPreview && (
              <div className="ob-preview ob-preview--icp">
                <div className="ob-preview__tag">First look · your buyer</div>
                <div className="ob-preview__title">{icpPreview.name}</div>
                <div className="ob-preview__body">{icpPreview.summary}</div>
              </div>
            )}

            {/* Live preview: LinkedIn audit teaser */}
            {auditPreview && (auditPreview.overall != null || auditPreview.headline) && (
              <div className="ob-preview ob-preview--audit">
                <div className="ob-preview__tag">LinkedIn audit ready</div>
                {auditPreview.overall != null && (
                  <div className="ob-preview__title">Your profile scored {auditPreview.overall}/10</div>
                )}
                {auditPreview.headline && (
                  <div className="ob-preview__body">
                    <span style={{ opacity: 0.6 }}>New headline:</span> "{auditPreview.headline}"
                  </div>
                )}
              </div>
            )}

            {/* Live preview: the starter lead list - the only artifact that is
                a prospect rather than a plan, so it gets its own callout. */}
            {leadsPreview && leadsPreview.count > 0 && (
              <div className="ob-preview ob-preview--leads">
                <div className="ob-preview__tag">Prospects loaded</div>
                <div className="ob-preview__title">
                  {leadsPreview.count} decision-makers, ready to contact
                </div>
                {leadsPreview.companies.length > 0 && (
                  <div className="ob-preview__body">
                    At {leadsPreview.companies.slice(0, 3).join(", ")}
                    {leadsPreview.count > 3 ? " and more" : ""} - already in your list.
                  </div>
                )}
              </div>
            )}
          </section>
          );
        })()}

        {step === "ready" && (
          <section className="ob-card ob-card--ready-anim">
            <span className="kicker ob-ready-kicker"><CheckCircle2 className="w-3 h-3" /> You're in</span>
            <div className="ob-ready-burst" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span /><span />
            </div>
            <h1 ref={stageHeadingRef} tabIndex={-1} className="ob-h1">
              {job?.returningUser
                ? <>Your workspace just got <em>refreshed</em><span className="dot">.</span></>
                : <>Your workspace drafts are <em>ready to review</em><span className="dot">.</span></>}
            </h1>
            <p className="ob-lead">
              Review your buyer profile, messages and content before you launch. Connect a channel when you're ready; nothing has been sent.
            </p>
            {buildIssue && <div className="vp-error" role="alert"><p>{buildIssue}</p><button className="ob-back" type="button" onClick={sendSignInLink} disabled={signInLoading}>Email me a sign-in link</button></div>}
            <ul className="ob-checklist vp-ready-results">
              {BUILD_TASKS.filter((task) => taskResults[task.key] === "done").map((task) => <li key={task.key}><CheckCircle2 size={16} aria-hidden="true" />{task.lab.replace(/^(Profiling|Pulling|Loading|Auditing|Writing|Designing|Building|Setting up|Drafting|Filling)/, "Review:")}</li>)}
            </ul>
            {Object.values(taskResults).some((status) => status === "failed") && <p className="vp-error" role="status">Some drafts could not be generated. Review the completed drafts and finish the remaining setup inside.</p>}
            {/* Review comes before channel connections and launch. */}
            {paidVisitor ? (
              // Paid traffic buys here. Everything above this line is the
              // pitch, and it is a pitch made of their own ICP, their own
              // prospects and their own sequence - so the ask lands against
              // something they can already see rather than a promise.
              <>
                <div className="ob-actions ob-actions--split-cta">
                  <button
                    type="button"
                    className="ob-cta"
                    onClick={startCheckout}
                    disabled={checkoutLoading}
                  >
                    {checkoutLoading
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening checkout…</>
                      : checkoutTerms.paidTrial
                        ? <>Start my {checkoutTerms.trialDays}-day trial - $1 <ArrowRight className="w-4 h-4" /></>
                        : <>Start my {checkoutTerms.trialDays}-day trial <ArrowRight className="w-4 h-4" /></>}
                  </button>
                  <span className="ob-actions__note">
                    {checkoutTerms.paidTrial
                      ? `$1 today, then $${checkoutTerms.monthlyPrice}/mo. Cancel any time.`
                      : `Card required. Free for ${checkoutTerms.trialDays} days, then $${checkoutTerms.monthlyPrice}/mo. Cancel any time.`}
                  </span>
                </div>
                <p className="ob-checkout-note">
                  Your workspace is created. Open it to review available drafts and finish setup after checkout.
                </p>
              </>
            ) : (
              <div className="ob-actions ob-actions--split-cta">
                <button
                  type="button"
                  className="ob-cta"
                  onClick={() => handleMagicLink("/campaigns")}
                  disabled={magicLinkLoading}
                >
                  {magicLinkLoading
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing you in…</>
                    : <>Open my workspace <ArrowRight className="w-4 h-4" /></>}
                </button>
                <button
                  type="button"
                  className="ob-back"
                  onClick={() => handleMagicLink("/accounts?connect=linkedin")}
                  disabled={magicLinkLoading}
                >
                  Connect a sending channel <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* DFY card - clearly secondary to the primary "Take me inside" CTA above */}
            <div
              style={{
                marginTop: 36,
                padding: "16px 18px",
                borderRadius: 10,
                border: "1px dashed rgba(0,0,0,0.18)",
                background: "rgba(0,0,0,0.015)",
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <Calendar className="w-5 h-5" style={{ color: "var(--accent)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  Want a 15-min audit with Cedric before you ship?
                </div>
                <div style={{ fontSize: 12.5, opacity: 0.7 }}>
                  He'll tell you which of the 5 emails to send first and which to scrap. No pitch. $0.
                </div>
              </div>
              <a
                href={(import.meta as unknown as { env: { VITE_DFY_BOOKING_URL?: string } }).env.VITE_DFY_BOOKING_URL || "https://app.leadconnectorhq.com/widget/booking/aca-onboarding-review"}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: "7px 14px",
                  borderRadius: 999,
                  background: "transparent",
                  color: "var(--ink)",
                  border: "1px solid rgba(0,0,0,0.25)",
                  fontWeight: 500,
                  textDecoration: "none",
                  fontSize: 12.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                Reserve my audit slot →
              </a>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
