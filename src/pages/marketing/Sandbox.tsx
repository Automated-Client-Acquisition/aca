import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Copy, Download, FileText, Globe, Linkedin, Loader2, Mail, RefreshCw, Sparkles, Target } from "lucide-react";
import { DEMOS, type SandboxDemo } from "@/data/sandbox/demos";
import { Logo } from "@/components/marketing/Logo";
import { supabase } from "@/integrations/supabase/client";
import { clearOnboardingPreview, isOnboardingPreviewDraft, loadOnboardingPreview, normalizePreviewWebsite, saveOnboardingPreview, type OnboardingPreviewDraft } from "@/lib/onboarding-preview";
import { toast } from "sonner";
import "@/styles/onboarding-preview.css";

type PreviewTab = "buyer" | "email" | "content";
const TABS = [{ id: "buyer", label: "Who to target", icon: Target }, { id: "email", label: "Your first email", icon: Mail }, { id: "content", label: "Your first post", icon: FileText }] as const;

interface LiveBuild {
  website: string;
  scrapedTitle: string;
  founderName: string;
  icp: SandboxDemo["icp"];
  product: SandboxDemo["product"];
  audit: SandboxDemo["audit"] | null;
  sequence: { name: string; steps: Array<{ subject?: string; body: string }> };
  blueprint: SandboxDemo["blueprint"];
  agentPreview: { name: string; toneTraits: string[] };
  strategyOpener: string;
}

function livePreview(build: LiveBuild, website: string, linkedinUrl: string): SandboxDemo {
  return {
    id: "yoursite", hero: "Your business", name: build.product?.name || build.scrapedTitle || new URL(website).hostname,
    website, linkedinUrl, founderName: build.founderName || "the founder", goal: "Start sales conversations", pains: [],
    icp: build.icp, product: build.product, knowledge: "",
    audit: build.audit || { overall: 0, headline_score: 0, about_score: 0, banner_score: 0, activity_score: 0, headline_rewrite: "", about_rewrite: "", summary: "", recommendations: [] },
    sequence: { name: build.sequence?.name || "First outreach draft", steps: (build.sequence?.steps || []).map((step, index) => ({ ...step, step: index + 1, channel: "email", delay_days: 0 })) },
    blueprint: build.blueprint || { name: "Content drafts", themes: [] },
    campaignSteps: [], contentPlanPreview: "", strategyPreview: "",
    agent: { name: build.agentPreview?.name || "Reply assistant", description: "", tone_traits: build.agentPreview?.toneTraits || [], escalation_triggers: [] },
  };
}

function draftText(draft: OnboardingPreviewDraft): string {
  const p = draft.preview;
  return [
    `ACA acquisition preview — ${p.name}`, draft.kind === "sample" ? "Fictional sample business. Examples are not customer results." : `Website: ${draft.website}`,
    "Review all facts and claims before sending or publishing.", "", "WHO TO TARGET", p.icp.name, p.icp.summary, `Industry: ${p.icp.industry}`, `Roles: ${p.icp.roles}`,
    "Buyer pains:", ...p.icp.pains.map((pain) => `- ${pain}`), "Desired outcomes:", ...p.icp.desires.map((desire) => `- ${desire}`), "", "OUTREACH DRAFTS",
    ...p.sequence.steps.map((step) => `${step.channel.toUpperCase()}${step.subject ? ` — ${step.subject}` : ""}\n${step.body}\n`), "CONTENT DRAFTS",
    ...p.blueprint.themes.map((theme) => `${theme.theme}\n${theme.example_post}\n`),
  ].join("\n");
}

export default function Sandbox({ onContinue, initialDraft }: { onContinue?: (draft: OnboardingPreviewDraft) => void; initialDraft?: OnboardingPreviewDraft | null } = {}) {
  const navigate = useNavigate();
  // The homepage hero hands its website field over in router state, so the visitor
  // lands straight in a running build instead of retyping it.
  const location = useLocation();
  const [handedWebsite] = useState(() => {
    const handed: unknown = location.state?.website;
    return typeof handed === "string" ? handed : "";
  });
  const [draft, setDraft] = useState<OnboardingPreviewDraft | null>(() => isOnboardingPreviewDraft(initialDraft) ? initialDraft : loadOnboardingPreview());
  const [website, setWebsite] = useState(() => handedWebsite || draft?.website || "");
  const [linkedinUrl, setLinkedinUrl] = useState(() => draft?.linkedinUrl || "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<PreviewTab>("buyer");
  const [contentIndex, setContentIndex] = useState(0);
  const [emailIndex, setEmailIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  function reveal(next: OnboardingPreviewDraft) {
    setDraft(next);
    setTab("buyer");
    setContentIndex(0);
    setEmailIndex(0);
    saveOnboardingPreview(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function chooseSample(preview: SandboxDemo) {
    setError("");
    reveal({ version: 1, kind: "sample", website: "", linkedinUrl: "", preview, savedAt: Date.now() });
  }

  function buildPreview(event: React.FormEvent) {
    event.preventDefault();
    void runBuild(website);
  }

  async function runBuild(websiteInput: string) {
    if (running) return;
    const normalized = normalizePreviewWebsite(websiteInput);
    if (!normalized) { setError("Enter a public business website, like yourcompany.com. Use an http or https address without a login or port."); return; }
    let linked = "";
    if (linkedinUrl.trim()) {
      try {
        const url = new URL(/^https?:\/\//i.test(linkedinUrl.trim()) ? linkedinUrl.trim() : `https://${linkedinUrl.trim()}`);
        if (!["http:", "https:"].includes(url.protocol) || !/^(www\.)?linkedin\.com$/i.test(url.hostname) || !/^\/in\/[a-z\d_-]+\/?$/i.test(url.pathname) || url.username || url.password || url.port) throw new Error("invalid");
        linked = `https://www.linkedin.com${url.pathname}`;
      } catch { setError("Use a LinkedIn profile URL like linkedin.com/in/yourname, or leave this optional field empty."); return; }
    }
    setRunning(true);
    setError("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("sandbox-build", { timeout: 90_000, body: { website: normalized.replace(/^https?:\/\//i, ""), linkedinUrl: linked || undefined } });
      if (requestError) {
        // The function's JSON explains rate limits and unreadable sites more clearly than a generic non-2xx error.
        let message = requestError.message;
        if ("context" in requestError && requestError.context instanceof Response) {
          try { const response = await requestError.context.clone().json(); if (typeof response?.error === "string") message = response.error; } catch { /* Fall back to the client error message. */ }
        }
        throw new Error(message);
      }
      if (data?.error) throw new Error(String(data.error));
      const next: OnboardingPreviewDraft = { version: 1, kind: "live", website: normalized, linkedinUrl: linked, preview: livePreview(data as LiveBuild, normalized, linked), savedAt: Date.now() };
      if (!isOnboardingPreviewDraft(next)) throw new Error("The preview was incomplete. Try a page that clearly describes your offer, or open a sample below.");
      reveal(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't build your preview. Try again, or open a sample below.");
    } finally { setRunning(false); }
  }

  const handoffStarted = useRef(false);
  useEffect(() => {
    if (!handedWebsite || handoffStarted.current) return;
    handoffStarted.current = true;
    // Drop the handoff from history so a reload or Back doesn't start another build.
    const { website: _handed, ...rest } = (location.state ?? {}) as Record<string, unknown>;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: Object.keys(rest).length ? rest : null });
    // Already built for this site (e.g. a reload): show it rather than spend another build.
    if (draft?.kind === "live" && draft.website === normalizePreviewWebsite(handedWebsite)) return;
    setDraft(null);
    void runBuild(handedWebsite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startOver() {
    clearOnboardingPreview();
    setDraft(null);
    setError("");
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); toast.success(`${label} copied`); } catch { toast.error("Copy didn't work. You can select and copy the draft text below."); }
  }

  function download() {
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([draftText(draft)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `aca-${draft.kind === "sample" ? "sample" : "acquisition"}-plan.txt`;
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Your plan downloaded");
  }

  function continueToAccount() {
    if (!draft) return;
    saveOnboardingPreview(draft);
    if (onContinue) onContinue(draft);
    else navigate("/get-started?preview=1", { state: { preview: draft } });
  }

  const preview = draft?.preview;
  const email = preview?.sequence.steps[emailIndex];
  const theme = preview?.blueprint.themes[contentIndex];

  return (
    <div className="aca-preview">
      <header className="aca-preview__nav">
        <Link to="/" aria-label="ACA home"><Logo size={32} /></Link>
        <span className="aca-preview__nav-note"><span />Try it before you sign up</span>
        <Link to="/" className="aca-preview__back"><ArrowLeft size={15} /><span>Back to site</span></Link>
      </header>
      <main className="aca-preview__main">
        {!draft ? (
          <>
            <section className="aca-preview__intro">
              <div>
                <span className="aca-preview__eyebrow"><Sparkles size={14} />Your first plan. Free. No account.</span>
                <h1 ref={headingRef} tabIndex={-1}>See who to target.<br /><em>Get the words to start.</em></h1>
                <p>Turn your website into a buyer profile, a first outreach email, and LinkedIn post drafts. Read them, copy them, keep them. Then decide if ACA is for you.</p>
                <div className="aca-preview__promise"><span><Check size={15} />No signup</span><span><Check size={15} />No credit card</span><span><Check size={15} />Copy & download free</span></div>
              </div>
              <div className="aca-preview__fox-scene" aria-hidden="true">
                <span className="aca-preview__fox-note">A useful first step.<br />Before the commitment.</span>
                <svg viewBox="182 279 721 947" role="presentation"><image href="/media/mascot/fox-wave-cut.png" width="1024" height="1536" /></svg>
                <span className="aca-preview__mini-card"><Target size={18} />The right buyer <Check size={16} /></span>
                <span className="aca-preview__mini-card aca-preview__mini-card--email"><Mail size={18} />The first conversation <Check size={16} /></span>
              </div>
            </section>
            <section className="aca-preview__start-grid">
              <form className="aca-preview__website-card" onSubmit={buildPreview} aria-busy={running}>
                <span className="aca-preview__card-kicker">FOR YOUR BUSINESS</span>
                <h2>Start with your website.</h2>
                <p>We’ll read your offer and draft a way to reach its buyers.</p>
                <label htmlFor="preview-website">Business website</label>
                <div className="aca-preview__input-wrap"><Globe size={18} /><input id="preview-website" type="text" inputMode="url" autoComplete="url" placeholder="yourcompany.com" value={website} onChange={(event) => setWebsite(event.target.value)} disabled={running} aria-invalid={!!error} aria-describedby={error ? "preview-error" : "preview-privacy"} required /></div>
                <details className="aca-preview__optional"><summary>Add your LinkedIn profile <span>optional</span></summary><label htmlFor="preview-linkedin">LinkedIn profile URL</label><input id="preview-linkedin" type="text" inputMode="url" placeholder="linkedin.com/in/yourname" value={linkedinUrl} onChange={(event) => setLinkedinUrl(event.target.value)} disabled={running} /></details>
                {error && <div className="aca-preview__error" id="preview-error" role="alert"><strong>Your preview isn’t ready yet.</strong><p>{error}</p><span>Your website is still here. Try again or open a sample.</span></div>}
                <button className="aca-preview__button" type="submit" disabled={running}>{running ? <><Loader2 className="aca-preview__spin" size={18} />Reading your site & writing drafts…</> : <>{error ? "Try my website again" : "Build my free preview"}<ArrowRight size={18} /></>}</button>
                {running && <div className="aca-preview__loading" role="status"><p>This can take a minute. Your buyer profile and drafts appear as soon as they’re ready.</p><span>No account, campaigns, or mailboxes are being created.</span></div>}
                <p className="aca-preview__privacy" id="preview-privacy">Live previews are cached on our server for 24 hours. Website and IP logs are used to limit requests. Your draft is also kept in this browser tab until it closes or for up to 24 hours.</p>
              </form>
              <div className="aca-preview__sample-card">
                <span className="aca-preview__card-kicker">JUST LOOKING?</span>
                <h2>Open a sample. Instantly.</h2>
                <p>See the exact kind of output you’ll get, using a fictional business.</p>
                <div className="aca-preview__samples">{DEMOS.map((demo, index) => <button type="button" key={demo.id} onClick={() => chooseSample(demo)} disabled={running}><span className="aca-preview__sample-number">0{index + 1}</span><span><strong>{demo.hero}</strong><small>{demo.id === "saas" ? "Reach the finance buyer" : demo.id === "agency" ? "Start conversations with brands" : "Find buyers for your course"}</small></span><ArrowRight size={18} /></button>)}</div>
                <span className="aca-preview__sample-footnote">Nothing to fill in. Nothing to wait for.</span>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="aca-preview__result-intro">
              <div><span className="aca-preview__eyebrow"><Check size={14} />{draft.kind === "sample" ? "Fictional sample · not customer results" : "Your website → your first acquisition drafts"}</span><h1 ref={headingRef} tabIndex={-1}>{draft.kind === "sample" ? "Here’s what you could start with." : "Your first conversations start here."}</h1><p>{draft.kind === "sample" ? `Explore the plan for ${preview.name}. Your own business details come later.` : `A starting point for ${preview.name}. Check the buyer fit, then adapt the drafts to your voice.`}</p></div>
              <button type="button" className="aca-preview__text-button" onClick={startOver}><RefreshCw size={15} />{draft.kind === "sample" ? "Try my own website" : "Edit website or try another"}</button>
            </section>
            <section className="aca-preview__workspace">
              <div className="aca-preview__workspace-bar"><span><span className="aca-preview__status-dot" />{preview.name}</span><span>PREVIEW · NOTHING IS LIVE</span></div>
              <div className="aca-preview__tabs" role="tablist" aria-label="Your acquisition preview">{TABS.map(({ id, label, icon: Icon }, index) => <button key={id} ref={(node) => { tabsRef.current[index] = node; }} type="button" role="tab" id={`preview-tab-${id}`} aria-selected={tab === id} aria-controls="preview-panel" tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => { let next = index; if (event.key === "ArrowRight") next = (index + 1) % TABS.length; else if (event.key === "ArrowLeft") next = (index + TABS.length - 1) % TABS.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = TABS.length - 1; else return; event.preventDefault(); setTab(TABS[next].id); tabsRef.current[next]?.focus(); }}><Icon size={17} /><span>{label}</span></button>)}</div>
              <div className="aca-preview__panel" id="preview-panel" role="tabpanel" aria-labelledby={`preview-tab-${tab}`} tabIndex={0}>
                {tab === "buyer" && <div className="aca-preview__buyer"><div><span className="aca-preview__card-kicker">YOUR BUYER HYPOTHESIS</span><h2>{preview.icp.name}</h2><p>{preview.icp.summary}</p><dl><div><dt>Where to look</dt><dd>{preview.icp.industry}</dd></div><div><dt>Roles to search</dt><dd>{preview.icp.roles}</dd></div></dl><span className="aca-preview__draft-note">Validate this profile with real prospects before launching outreach.</span></div><div className="aca-preview__buyer-needs"><h3>What they want to fix</h3><ul>{preview.icp.pains.slice(0, 3).map((pain, index) => <li key={index}><span>0{index + 1}</span>{pain}</li>)}</ul><h3>What they want instead</h3><ul className="aca-preview__outcomes">{preview.icp.desires.slice(0, 3).map((desire, index) => <li key={index}><Check size={15} />{desire}</li>)}</ul></div></div>}
                {tab === "email" && <div className="aca-preview__draft-layout"><div className="aca-preview__draft-context"><span className="aca-preview__card-kicker">START THE CONVERSATION</span><h2>An email you can work from.</h2><p>Match the opening to a real signal. Check every claim. Add your own proof before sending.</p>{preview.sequence.steps.length > 1 && <label htmlFor="preview-email-step">Message<select id="preview-email-step" value={emailIndex} onChange={(event) => setEmailIndex(Number(event.target.value))}>{preview.sequence.steps.map((step, index) => <option key={index} value={index}>Draft {index + 1} · {step.channel === "linkedin" ? "LinkedIn" : "Email"}</option>)}</select></label>}<button type="button" className="aca-preview__secondary" disabled={!email} onClick={() => copy(`${email?.subject ? `Subject: ${email.subject}\n\n` : ""}${email?.body || ""}`, "Email draft")}><Copy size={15} />Copy draft</button></div><article className="aca-preview__email"><div><Mail size={16} /><span>{email?.channel === "linkedin" ? "LinkedIn message draft" : "Email draft"}</span><span>UNSENT</span></div>{email ? <><h3>{email.subject || "Opening message"}</h3><p>{email.body}</p></> : <p>No email draft was returned. You can still download your buyer profile and content drafts.</p>}</article></div>}
                {tab === "content" && <div className="aca-preview__draft-layout"><div className="aca-preview__draft-context"><span className="aca-preview__card-kicker">GIVE BUYERS A REASON TO NOTICE</span><h2>A post worth adapting.</h2><p>Pick a theme your buyer cares about. Replace example stories and numbers with facts you can support.</p>{preview.blueprint.themes.length > 0 && <label htmlFor="preview-content-theme">Content theme<select id="preview-content-theme" value={contentIndex} onChange={(event) => setContentIndex(Number(event.target.value))}>{preview.blueprint.themes.map((item, index) => <option key={index} value={index}>{item.theme}</option>)}</select></label>}<button type="button" className="aca-preview__secondary" disabled={!theme} onClick={() => copy(theme?.example_post || "", "Post draft")}><Copy size={15} />Copy post</button></div><article className="aca-preview__post"><div><span className="aca-preview__post-avatar">{preview.name[0]}</span><span><strong>{preview.name}</strong><small>LinkedIn post draft · unpublished</small></span><Linkedin size={18} /></div><p>{theme?.example_post || "No post draft was returned. Your buyer profile is still available to download."}</p></article></div>}
              </div>
              <div className="aca-preview__workspace-foot"><span><FileText size={14} />These are drafts. Review facts, personalization, and claims before use.</span><button type="button" className="aca-preview__text-button" onClick={download}><Download size={15} />Download the whole plan</button></div>
            </section>
            <section className="aca-preview__continue"><div><span className="aca-preview__card-kicker">LIKE THE STARTING POINT?</span><h2>Keep the plan.<br /><em>Put it to work in ACA.</em></h2><p>Create your account next. Build your workspace around your business, connect your tools, then review your campaign before launching.</p></div><div><p className="aca-preview__price"><strong>$67</strong><span>/month<br />One platform. Your whole team.</span></p><p className="aca-preview__included">Unlimited seats, leads, campaigns & content.<br />Bring your own API keys. Provider usage and subscriptions are billed separately.</p><button type="button" className="aca-preview__button" onClick={continueToAccount}>Save my plan & create account<ArrowRight size={18} /></button><span className="aca-preview__account-note">Free preview stays yours, even if you don’t sign up.</span></div></section>
          </>
        )}
        <footer className="aca-preview__footer"><span>ACA · Automated Client Acquisition</span><Link to="/privacy">Privacy policy</Link></footer>
      </main>
    </div>
  );
}
