import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ArrowRight, Check, Loader2, Zap, FileDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import "@/styles/aca-home.css";
import { SUPPORT_EMAIL } from "@/config/site";

// Feature flag: when off, the success screen only shows the "email me the
// playbook" path. The "Set it up in ACA" provisioning flow stays in the code
// (and on the deployed edge functions) but no marketing surface points at it.
// Flip via VITE_ONBOARDING_ENABLED=true in the environment.
const ONBOARDING_ENABLED = import.meta.env.VITE_ONBOARDING_ENABLED === "true";

interface LeadFormData {
  // Step 1
  fullName: string;
  email: string;
  // Step 2
  website: string;
  linkedinUrl: string;
  // Step 3
  biggestNeed: string;
  // Step 4
  whatTried: string;
  // Step 5
  revenue: string;
  teamSize: string;
}

const initialData: LeadFormData = {
  fullName: "",
  email: "",
  website: "",
  linkedinUrl: "",
  biggestNeed: "",
  whatTried: "",
  revenue: "",
  teamSize: "",
};

interface PlaybookLeadGenProps {
  open: boolean;
  onClose: () => void;
  playbookSlug: string;
  playbookTitle: string;
  niche: string;
  outcome: string;
}

export function PlaybookLeadGen({
  open,
  onClose,
  playbookSlug,
  playbookTitle,
  niche,
  outcome,
}: PlaybookLeadGenProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [data, setData] = useState<LeadFormData>(initialData);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setSubmitted(false);
      setData(initialData);
    }
  }, [open]);

  if (!open) return null;

  const update = (k: keyof LeadFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setData((p) => ({ ...p, [k]: e.target.value }));

  const totalSteps = 3;
  const progressPct = Math.round(((submitted ? totalSteps : step - 1) / totalSteps) * 100);

  const canAdvance =
    (step === 1 && data.fullName.trim() && /\S+@\S+\.\S+/.test(data.email)) ||
    (step === 2 && data.website.trim() && data.linkedinUrl.trim()) ||
    (step === 3 && data.biggestNeed.trim().length > 10);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("submit-playbook-lead", {
        body: {
          ...data,
          playbookSlug,
          niche,
          outcome,
          source: "playbook_leadgen",
        },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      // Stash leadId for the provisioning step (saves a duplicate insert if they pick "Set up in ACA")
      if (result?.leadId) {
        sessionStorage.setItem("aca:onboard:leadId", result.leadId);
      }
      setSubmitted(true);
    } catch (e) {
      console.error("[playbook-leadgen] submit failed:", e);
      toast.error("Something went wrong. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProvisionWorkspace() {
    setSubmitting(true);
    try {
      const leadId = sessionStorage.getItem("aca:onboard:leadId") || undefined;

      const { data: result, error } = await supabase.functions.invoke(
        "provision-playbook-workspace",
        {
          body: {
            leadId,
            ...data,
            playbookSlug,
            niche,
            outcome,
          },
        }
      );

      if (error) {
        let msg = error.message || "Provisioning failed";
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch {
          // fall through with default msg
        }
        throw new Error(msg);
      }
      if (result?.error) throw new Error(result.error);

      sessionStorage.setItem(
        "aca:onboard:job",
        JSON.stringify({
          jobId: result.jobId,
          organizationId: result.organizationId,
          provisioningToken: result.provisioningToken,
          taskKeys: result.taskKeys,
          tasksDone: result.tasksDone,
          returningUser: !!result.returningUser,
          existingProviders: result.existingProviders || [],
        })
      );

      // Keep lead context too so the wizard can render personalized greetings
      sessionStorage.setItem(
        "aca:onboard:lead",
        JSON.stringify({ ...data, playbookSlug, playbookTitle, niche, outcome })
      );

      onClose();
      navigate(`/onboard/playbook/${playbookSlug}?jobId=${result.jobId}`);
    } catch (e) {
      console.error("[playbook-leadgen] provision failed:", e);
      const msg = e instanceof Error ? e.message : "Provisioning failed. Try again.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="lg-overlay" onClick={onClose}>
      <div className="lg-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="lg-close" onClick={onClose} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="lg-progress">
          <div className="lg-progress__bar" style={{ width: progressPct + "%" }} />
        </div>

        {!submitted ? (
          <div className="lg-body">
            <div className="lg-meta">
              <span className="kicker">Custom playbook for your business · not a template</span>
              <h2 className="lg-title">
                Built <em>for you specifically</em><span className="dot">.</span>
              </h2>
              <p className="lg-sub">
                30 seconds in, a working ACA workspace out. We read your website (homepage, services, about, blog) and your LinkedIn profile + recent posts, extract your offer, audience, voice, and stage, then build your ICP, prospect list, and outbound sequence around what we find. Different from every other person's submission.
              </p>
            </div>

            <div className="lg-step-meta">
              <span>{step === 1 ? "Start" : `${step} of ${totalSteps}`}</span>
              <span>·</span>
              <span>{step === totalSteps ? "Last one" : `~${(totalSteps - step + 1) * 12}s left`}</span>
            </div>

            {step === 1 && (
              <div className="lg-step">
                <h3 className="lg-step__h">Where should we send your custom playbook?</h3>
                <p className="lg-step__hint">This is where we'll set up your workspace and follow up — built specifically from the URLs you submit next.</p>
                <div className="lg-grid">
                  <div className="lg-field">
                    <label>Full name</label>
                    <input
                      type="text"
                      placeholder="Lena Kapoor"
                      value={data.fullName}
                      onChange={update("fullName")}
                      autoFocus
                    />
                  </div>
                  <div className="lg-field">
                    <label>Work email</label>
                    <input
                      type="email"
                      placeholder="lena@yourcompany.com"
                      value={data.email}
                      onChange={update("email")}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="lg-step">
                <h3 className="lg-step__h">The two URLs we customize the playbook from.</h3>
                <p className="lg-step__hint">ACA reads your homepage, services, about page, and recent blog posts; plus your LinkedIn profile and last 30 posts. It extracts your offer, ICP, voice, and stage. The playbook is configured around what it finds. We do not use these URLs for anything else.</p>
                <div className="lg-grid">
                  <div className="lg-field">
                    <label>Website</label>
                    <input
                      type="url"
                      placeholder="https://yourcompany.com"
                      value={data.website}
                      onChange={update("website")}
                      autoFocus
                    />
                  </div>
                  <div className="lg-field">
                    <label>LinkedIn URL</label>
                    <input
                      type="url"
                      placeholder="https://linkedin.com/in/lenakapoor"
                      value={data.linkedinUrl}
                      onChange={update("linkedinUrl")}
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="lg-step">
                <h3 className="lg-step__h">What do you actually need to fix?</h3>
                <p className="lg-step__hint">Be specific. The more exact your answer, the more useful the playbook will be.</p>
                <div className="lg-field">
                  <label>The biggest blocker right now</label>
                  <textarea
                    rows={5}
                    placeholder="e.g. We're spending 30 hrs/week on outbound and only booking 2 meetings. Need to 5x the demos without hiring."
                    value={data.biggestNeed}
                    onChange={update("biggestNeed")}
                    autoFocus
                  />
                </div>
              </div>
            )}

            <div className="lg-actions">
              {step > 1 && (
                <button type="button" className="lg-back" onClick={() => setStep((s) => s - 1)}>
                  ← Back
                </button>
              )}
              <button
                type="button"
                className="lg-next"
                disabled={!canAdvance || submitting}
                onClick={() => {
                  if (step < totalSteps) setStep((s) => s + 1);
                  else handleSubmit();
                }}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : step < totalSteps ? (
                  <>Continue <ArrowRight className="w-4 h-4" /></>
                ) : (
                  <>Generate my playbook <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>

            <p className="lg-foot">
              We never spam. Your data is used only to personalize this playbook and shape future ones.
            </p>
          </div>
        ) : (
          <div className="lg-body lg-body--success">
            <div className="lg-success__icon"><Check className="w-8 h-8" /></div>
            {ONBOARDING_ENABLED ? (
              <>
                <h2 className="lg-title">
                  Got it. Now <em>pick your path</em><span className="dot">.</span>
                </h2>
                <p className="lg-sub">
                  We have everything we need to personalize your playbook. Two ways forward, pick whichever fits.
                </p>
              </>
            ) : (
              <>
                <h2 className="lg-title">
                  Got it. We're <em>on it</em><span className="dot">.</span>
                </h2>
                <p className="lg-sub">
                  We have what we need to personalize your playbook. Cedric reviews every submission personally and will follow up at <strong>{data.email}</strong> with next steps. If you don't hear back within a day, email {SUPPORT_EMAIL} directly.
                </p>
              </>
            )}

            <div className="lg-paths">
              {ONBOARDING_ENABLED && (
                <div className="lg-path lg-path--primary">
                  <div className="lg-path__head">
                    <div className="lg-path__icon lg-path__icon--zap"><Zap className="w-5 h-5" /></div>
                    <div className="lg-path__lab">Recommended · 7 minutes</div>
                  </div>
                  <h3 className="lg-path__title">Set it up <em>in ACA for me</em>.</h3>
                  <p className="lg-path__sub">We provision a workspace, build your prospect list, write your sequence in your voice, draft your lead magnet, and load your strategy doc. You launch on day 1, not day 60.</p>
                  <ul className="lg-path__feats">
                    <li>ICP defined from your answers</li>
                    <li>Pre-built campaign + sequence</li>
                    <li>Strategy doc + lead magnet framework</li>
                    <li>AI agent trained on your site</li>
                    <li>Content blueprint for your niche</li>
                  </ul>
                  <button
                    type="button"
                    className="lg-path__cta lg-path__cta--primary"
                    disabled={submitting}
                    onClick={handleProvisionWorkspace}
                  >
                    {submitting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Setting up…</>
                    ) : (
                      <>Set up my workspace <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                  <span className="lg-path__note">Free 14-day trial · No card · Cancel anytime</span>
                </div>
              )}

              {ONBOARDING_ENABLED ? (
                <div className="lg-path">
                  <div className="lg-path__head">
                    <div className="lg-path__icon"><FileDown className="w-5 h-5" /></div>
                    <div className="lg-path__lab">Personalized · email</div>
                  </div>
                  <h3 className="lg-path__title">Have Cedric <em>send it over</em>.</h3>
                  <p className="lg-path__sub">Cedric reviews every submission personally and will follow up at <strong>{data.email}</strong> with your playbook. No account, no commitment - just slower than the automated setup.</p>
                  <button
                    type="button"
                    className="lg-path__cta lg-path__cta--primary"
                    onClick={onClose}
                  >
                    That works for me <ArrowRight className="w-4 h-4" />
                  </button>
                  <span className="lg-path__note">No account. No commitment.</span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 14, marginTop: 8, width: "100%", maxWidth: 420 }}>
                  <button
                    type="button"
                    className="lg-path__cta lg-path__cta--primary"
                    onClick={onClose}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Got it, close <ArrowRight className="w-4 h-4" />
                  </button>

                  {/* Conversion handoff: while the doc is being generated,
                      offer the next step into ACA so we capture readers ready
                      to commit instead of losing them at the success screen. */}
                  <div style={{ position: "relative", textAlign: "center", margin: "8px 0" }}>
                    <span style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      color: "var(--ink-muted, #8a8a87)",
                      background: "var(--bone, #FBFAF6)",
                      padding: "0 12px",
                      position: "relative",
                      zIndex: 1,
                    }}>or, while you wait</span>
                    <div style={{
                      position: "absolute",
                      top: "50%",
                      left: 0,
                      right: 0,
                      height: 1,
                      background: "rgba(21,20,15,0.08)",
                      zIndex: 0,
                    }} />
                  </div>

                  <a
                    href="/auth"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "12px 22px",
                      background: "var(--ink, #15140F)",
                      color: "#fff",
                      borderRadius: 999,
                      fontFamily: "var(--font-sans)",
                      fontSize: 14,
                      fontWeight: 600,
                      textDecoration: "none",
                      boxShadow: "0 8px 20px rgba(21,20,15,0.18)",
                      transition: "background 0.18s ease, transform 0.18s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--accent, #D4361A)";
                      e.currentTarget.style.transform = "translateY(-1px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--ink, #15140F)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    Start ACA Operator free
                    <ArrowRight className="w-4 h-4" />
                  </a>
                  <span className="lg-path__note" style={{ textAlign: "center" }}>
                    $67/month after the 14-day free trial · No card required
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
