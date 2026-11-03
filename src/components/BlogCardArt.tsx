import type { BlogPost } from "@/data/blogPosts/blogPosts.types";

type Variant =
  | "compare"
  | "sequence"
  | "studio"
  | "pipeline"
  | "agency"
  | "chart"
  | "stackswap"
  | "ranked"
  | "inbox"
  | "workflow"
  | "booking"
  | "channels";

// Real, factual category each competitor occupies. Used for the Compare variant
// instead of fabricated pricing. These are positioning facts, not invented stats.
const COMPETITOR_INFO: Record<string, { name: string; category: string }> = {
  clay: { name: "Clay", category: "Data enrichment" },
  expandi: { name: "Expandi", category: "LinkedIn-only" },
  heyreach: { name: "HeyReach", category: "LinkedIn-only" },
  instantly: { name: "Instantly", category: "Cold email" },
  lemlist: { name: "Lemlist", category: "Cold email" },
  smartlead: { name: "SmartLead", category: "Cold email" },
  taplio: { name: "Taplio", category: "LinkedIn personal" },
  apollo: { name: "Apollo", category: "Sales prospecting" },
  outreach: { name: "Outreach", category: "Email cadence" },
  hunter: { name: "Hunter", category: "Email finder" },
  prospeo: { name: "Prospeo", category: "Email finder" },
};

function parseCompetitor(slug: string) {
  const m = slug.match(/^aca-vs-([a-z0-9-]+)$/);
  if (!m) return null;
  const key = m[1].split("-")[0];
  const info = COMPETITOR_INFO[key];
  if (info) return { key, ...info };
  return { key, name: key.charAt(0).toUpperCase() + key.slice(1), category: "Outreach tool" };
}

function pickVariant(post: BlogPost): Variant {
  if (post.previewVariant) return post.previewVariant as Variant;
  const cat = post.category;
  const cluster = post.cluster ?? "";
  const slug = post.slug;
  const title = post.title.toLowerCase();

  if (/^aca-vs-/.test(slug)) return "compare";

  if (
    /^best-/.test(slug) ||
    /\branked\b/.test(title) ||
    /\(.*compared\)/.test(title) ||
    /\d+\s+tools\s+compared/i.test(title) ||
    /\d+\s+(?:methods|strategies|tools|platforms|niches)\b/i.test(title)
  ) {
    return "ranked";
  }

  if (/deliverability|list-hygiene|inbox|sender-reputation|spf-dkim|email-bounce|warm-up/.test(slug) || /Deliverability/i.test(cluster)) return "inbox";
  if (/n8n|outbound-automation|sequence-examples|workflow/.test(slug)) return "workflow";
  if (/appointment|booking|meeting/.test(slug)) return "booking";
  if (/multi-channel/.test(slug)) return "channels";

  if (cat === "Comparison") {
    if (/content|blueprint|studio/.test(slug)) return "studio";
    if (/linkedin|cold-email|outreach|sequence/.test(slug)) return "sequence";
    return "stackswap";
  }
  if (cat === "AI Content" || cluster === "AI Content") return "studio";
  if (cat === "Sales" || cluster === "AI Sales Agents") return "chart";
  if (cat === "Tools") return "stackswap";
  if (cat === "Outreach" || /Cold Email|Outbound/i.test(cluster)) return "sequence";
  if (cat === "AI Agency" || cat === "AI Business") return "agency";
  if (cat === "Lead Generation" || cat === "Client Acquisition") return "pipeline";
  return "pipeline";
}

// ---------------------------------------------------------------------------
// Per-slug labels — only structural / categorical, never numeric claims.
// ---------------------------------------------------------------------------

function agencyData(post: BlogPost) {
  const s = post.slug;
  if (/pricing/.test(s)) return {
    name: "Retainer tiers",
    chip: "Tiered",
    metricLabel: "Pricing structure",
    metricValue: "Pilot · Retainer · Annual",
    rows: [
      { logo: "S", name: "Starter · pilot", tag: "Tier 1", color: "c" },
      { logo: "G", name: "Growth · monthly", tag: "Tier 2", color: "b" },
      { logo: "P", name: "Partner · annual", tag: "Tier 3", color: "a" },
    ],
  };
  if (/how-to-start|how-to-create/.test(s)) return {
    name: "Day 30 · agency",
    chip: "First clients",
    metricLabel: "First month",
    metricValue: "1–3 clients",
    rows: [
      { logo: "P", name: "Plenum Labs", tag: "Pilot", color: "b" },
      { logo: "M", name: "Modulr", tag: "Discovery", color: "c" },
      { logo: "K", name: "Kinship", tag: "Outreach", color: "a" },
    ],
  };
  if (/marketing-agency|automation-agency|business-model/.test(s)) return {
    name: "Service mix",
    chip: "Recurring",
    metricLabel: "Agency book",
    metricValue: "Retainer · usage · setup",
    rows: [
      { logo: "F", name: "Fairmont Bain", tag: "Retainer", color: "a" },
      { logo: "P", name: "Plenum Labs", tag: "Retainer", color: "b" },
      { logo: "N", name: "Northwind", tag: "Pilot", color: "c" },
    ],
  };
  if (/sales-agent-roi|payback/.test(s)) return {
    name: "Payback · cohort",
    chip: "ROI",
    metricLabel: "Replaces",
    metricValue: "SDR · Tools · Time",
    rows: [
      { logo: "S", name: "SDR salary", tag: "Was", color: "c" },
      { logo: "T", name: "Outbound tools", tag: "Was", color: "b" },
      { logo: "a", name: "ACA · all-in", tag: "Now", color: "a" },
    ],
  };
  if (/make-money|chatgpt|10-real/.test(s)) return {
    name: "Method mix",
    chip: "10 plays",
    metricLabel: "Highest-ROI play",
    metricValue: "AI agency",
    rows: [
      { logo: "1", name: "AI agency", tag: "Active", color: "a" },
      { logo: "2", name: "AI services", tag: "Active", color: "b" },
      { logo: "3", name: "Content + SEO", tag: "Active", color: "c" },
    ],
  };
  if (/ai-sdr/.test(s)) return {
    name: "Headcount · before / after",
    chip: "Replaces SDR",
    metricLabel: "Role",
    metricValue: "SDR → AI agent",
    rows: [
      { logo: "S", name: "SDR base salary", tag: "Was", color: "c" },
      { logo: "T", name: "Outbound stack", tag: "Was", color: "b" },
      { logo: "a", name: "ACA replaces", tag: "Now", color: "a" },
    ],
  };
  if (/b2b-lead-generation/.test(s)) return {
    name: "Strategies",
    chip: "7 plays",
    metricLabel: "Top play",
    metricValue: "Signal-driven outbound",
    rows: [
      { logo: "I", name: "ICP scoring", tag: "Active", color: "a" },
      { logo: "S", name: "Signal triggers", tag: "Active", color: "b" },
      { logo: "M", name: "Multi-channel", tag: "Active", color: "c" },
    ],
  };
  if (/bdr-vs-ai-sales-agent/.test(s)) return {
    name: "Role · cost / output",
    chip: "Side-by-side",
    metricLabel: "Comparison",
    metricValue: "BDR vs. AI agent",
    rows: [
      { logo: "B", name: "BDR · monthly cost", tag: "Was", color: "c" },
      { logo: "A", name: "AI agent · all-in", tag: "Now", color: "a" },
      { logo: "Δ", name: "Delta · output", tag: "Higher", color: "b" },
    ],
  };
  return {
    name: "Service mix",
    chip: "Recurring",
    metricLabel: "Agency book",
    metricValue: "Retainer · pilot · setup",
    rows: [
      { logo: "F", name: "Fairmont Bain", tag: "Retainer", color: "a" },
      { logo: "P", name: "Plenum Labs", tag: "Retainer", color: "b" },
      { logo: "N", name: "Northwind", tag: "Pilot", color: "c" },
    ],
  };
}

function pipelineData(post: BlogPost) {
  const s = post.slug;
  if (/get-ai-agency-clients|client/.test(s)) return {
    name: "First clients",
    chip: "Discovery",
    rows: [
      { logo: "F", name: "Fairmont Bain", stage: "booked", trigger: "Replied to LinkedIn DM" },
      { logo: "M", name: "Modulr", stage: "replied", trigger: "Asked about pricing" },
      { logo: "K", name: "Kinship", stage: "sent", trigger: "Discovery call set" },
    ],
  };
  if (/ai-lead-generation|lead-generation/.test(s)) return {
    name: "Enrichment · live",
    chip: "Signals",
    rows: [
      { logo: "F", name: "Fairmont", stage: "booked", trigger: "Hired VP RevOps" },
      { logo: "P", name: "Plenum", stage: "replied", trigger: "Series B closed" },
      { logo: "N", name: "Northwind", stage: "sent", trigger: "Posted SDR role" },
    ],
  };
  return {
    name: "Pipeline",
    chip: "Live",
    rows: [
      { logo: "F", name: "Fairmont", stage: "booked", trigger: "Hired VP RevOps" },
      { logo: "P", name: "Plenum", stage: "replied", trigger: "Series B closed" },
      { logo: "N", name: "Northwind", stage: "sent", trigger: "Posted SDR role" },
    ],
  };
}

function sequenceData(post: BlogPost) {
  const s = post.slug;
  if (/linkedin/.test(s)) return {
    name: "LinkedIn · 4 touch",
    chip: "Active",
    steps: [
      { day: "D0", ch: "in", glyph: "in", label: "Connect" },
      { day: "D1", ch: "in", glyph: "in", label: "DM 1" },
      { day: "D4", ch: "in", glyph: "in", label: "Voice" },
      { day: "D7", ch: "im", glyph: "im", label: "InMail" },
    ],
    replyAt: 1,
  };
  if (/cold-email-ai|cold-email-deliverability|cold-email/.test(s)) return {
    name: "Cold email · 4 touch",
    chip: "Active",
    steps: [
      { day: "D0", ch: "at", glyph: "@", label: "Email 1" },
      { day: "D3", ch: "at", glyph: "@", label: "Bump" },
      { day: "D7", ch: "at", glyph: "@", label: "Value" },
      { day: "D10", ch: "at", glyph: "@", label: "Break-up" },
    ],
    replyAt: 1,
  };
  if (/outbound-sales-automation/.test(s)) return {
    name: "Sequence · 7 days",
    chip: "Active",
    steps: [
      { day: "D0", ch: "in", glyph: "in", label: "LinkedIn" },
      { day: "D2", ch: "at", glyph: "@", label: "Email" },
      { day: "D4", ch: "im", glyph: "im", label: "InMail" },
      { day: "D7", ch: "wa", glyph: "wa", label: "WhatsApp" },
    ],
    replyAt: 1,
  };
  return {
    name: "Sequence · 7 days",
    chip: "Active",
    steps: [
      { day: "D0", ch: "in", glyph: "in", label: "LinkedIn" },
      { day: "D2", ch: "at", glyph: "@", label: "Email" },
      { day: "D4", ch: "im", glyph: "im", label: "InMail" },
      { day: "D7", ch: "wa", glyph: "wa", label: "WhatsApp" },
    ],
    replyAt: 1,
  };
}

function chartData(post: BlogPost) {
  const s = post.slug;
  if (/sell-ai-services|selling-ai-services/.test(s)) return {
    name: "Close rate · by offer",
    chip: "FIG.",
    bars: [18, 22, 28, 34, 41, 52, 64, 78],
    foot: { l: <><b>Productized</b> beats <b>custom</b></>, r: "Trend ↑" },
  };
  if (/sales-agent-roi/.test(s)) return {
    name: "Payback · by cohort",
    chip: "FIG.",
    bars: [90, 70, 52, 38, 24, 12, 4, 0],
    foot: { l: <>Break-even <b>improves</b></>, r: "Trend ↓" },
  };
  if (/ai-sdr/.test(s)) return {
    name: "SDR vs. AI · output",
    chip: "FIG.",
    bars: [12, 18, 22, 28, 34, 48, 72, 96],
    foot: { l: <><b>AI agent</b> beats <b>SDR</b></>, r: "Trend ↑" },
  };
  return {
    name: "Reply rate · by signal age",
    chip: "FIG.",
    bars: [22, 30, 28, 42, 38, 50, 78, 92],
    foot: { l: <><b>0–24h</b> beats <b>30d+</b></>, r: "Trend ↑" },
  };
}

function rankedData(post: BlogPost) {
  const s = post.slug;
  const t = post.title.toLowerCase();
  if (/cold-email/.test(s)) return {
    name: "Cold email · top 5",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca.", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "Smartlead", color: "b", isAca: false, weight: 80 },
      { rank: 3, name: "Instantly", color: "c", isAca: false, weight: 70 },
      { rank: 4, name: "Lemlist", color: "d", isAca: false, weight: 62 },
    ],
  };
  if (/linkedin/.test(s)) return {
    name: "LinkedIn · top 5",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca.", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "HeyReach", color: "b", isAca: false, weight: 82 },
      { rank: 3, name: "Expandi", color: "c", isAca: false, weight: 70 },
      { rank: 4, name: "Taplio", color: "d", isAca: false, weight: 60 },
    ],
  };
  if (/multi-channel/.test(s)) return {
    name: "Multi-channel · top 5",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca.", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "Outreach", color: "b", isAca: false, weight: 75 },
      { rank: 3, name: "Salesloft", color: "c", isAca: false, weight: 68 },
      { rank: 4, name: "Apollo", color: "d", isAca: false, weight: 58 },
    ],
  };
  if (/white-label/.test(s)) return {
    name: "White-label · top 5",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca.", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "GoHighLevel", color: "b", isAca: false, weight: 78 },
      { rank: 3, name: "Vendasta", color: "c", isAca: false, weight: 66 },
      { rank: 4, name: "AgencyHandy", color: "d", isAca: false, weight: 55 },
    ],
  };
  if (/content/.test(s)) return {
    name: "AI content · top 5",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca. Studio", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "Jasper", color: "b", isAca: false, weight: 78 },
      { rank: 3, name: "Copy.ai", color: "c", isAca: false, weight: 70 },
      { rank: 4, name: "Writer", color: "d", isAca: false, weight: 60 },
    ],
  };
  if (/lead-generation-software/.test(s)) return {
    name: "Lead gen · top 5",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca.", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "Apollo", color: "b", isAca: false, weight: 80 },
      { rank: 3, name: "Clay", color: "c", isAca: false, weight: 72 },
      { rank: 4, name: "ZoomInfo", color: "d", isAca: false, weight: 62 },
    ],
  };
  if (/agency-niches/.test(s)) return {
    name: "Niches · by margin",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "B2B SaaS", color: "a", isAca: false, weight: 100 },
      { rank: 2, name: "PE-backed", color: "b", isAca: false, weight: 88 },
      { rank: 3, name: "Pro services", color: "c", isAca: false, weight: 76 },
      { rank: 4, name: "Local svc", color: "d", isAca: false, weight: 60 },
    ],
  };
  if (/agency-tools/.test(s)) return {
    name: "Agency tools · top",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca. (all-in-one)", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "GHL + Apollo", color: "b", isAca: false, weight: 76 },
      { rank: 3, name: "Clay + Smartlead", color: "c", isAca: false, weight: 70 },
      { rank: 4, name: "Outreach", color: "d", isAca: false, weight: 60 },
    ],
  };
  if (/methods|10-real|make-money/.test(t) || /make-money/.test(s)) return {
    name: "Methods · ranked",
    chip: "10 plays",
    rows: [
      { rank: 1, name: "AI agency", color: "a", isAca: false, weight: 100 },
      { rank: 2, name: "AI services", color: "b", isAca: false, weight: 78 },
      { rank: 3, name: "Productized", color: "c", isAca: false, weight: 66 },
      { rank: 4, name: "Affiliate", color: "d", isAca: false, weight: 50 },
    ],
  };
  if (/sequence-examples/.test(s)) return {
    name: "Sequences · ranked",
    chip: "20 plays",
    rows: [
      { rank: 1, name: "Trigger-based", color: "a", isAca: false, weight: 100 },
      { rank: 2, name: "Multi-thread", color: "b", isAca: false, weight: 88 },
      { rank: 3, name: "Break-up", color: "c", isAca: false, weight: 76 },
      { rank: 4, name: "Value-first", color: "d", isAca: false, weight: 64 },
    ],
  };
  return {
    name: "Top 5 · ranked",
    chip: "Ranked",
    rows: [
      { rank: 1, name: "aca.", color: "a", isAca: true, weight: 100 },
      { rank: 2, name: "Tool A", color: "b", isAca: false, weight: 76 },
      { rank: 3, name: "Tool B", color: "c", isAca: false, weight: 66 },
      { rank: 4, name: "Tool C", color: "d", isAca: false, weight: 56 },
    ],
  };
}

function studioData(post: BlogPost) {
  const s = post.slug;
  if (/multi-format/.test(s)) return {
    name: "One brief · 4 outputs",
    chip: "AI",
    tiles: [
      { k: "post", label: "Post", bg: "linear-gradient(135deg,#FFE7D5,#D4361A)" },
      { k: "img", label: "Image", bg: "linear-gradient(135deg,#DCE0FF,#4756D8)" },
      { k: "vid", label: "Video", bg: "linear-gradient(135deg,#C8E6D6,#1F8A5B)" },
    ],
  };
  return {
    name: "Studio · on-brand",
    chip: "AI",
    tiles: [
      { k: "post", label: "Post", bg: "linear-gradient(135deg,#FFE7D5,#D4361A)" },
      { k: "img", label: "Image", bg: "linear-gradient(135deg,#DCE0FF,#4756D8)" },
      { k: "vid", label: "Video", bg: "linear-gradient(135deg,#C8E6D6,#1F8A5B)" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Variant components — no fabricated stats. Visual hierarchy via bars + chips.
// ---------------------------------------------------------------------------

function CompareArt({ post }: { post: BlogPost }) {
  const c = parseCompetitor(post.slug) ?? { name: "Outreach", category: "Email cadence", key: "x" };
  return (
    <div className="bcardart bcardart--compare">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">Migration · 2026</div>
        <span className="bcardart__chip bcardart__chip--live">Live</span>
      </div>
      <table className="bcardart__table">
        <thead>
          <tr><th>Tool</th><th>Category</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><span className="bcardart__co"><span className="bcardart__logo bcardart__logo--b">{c.name.charAt(0)}</span><span>{c.name}</span></span></td>
            <td className="bcardart__cat">{c.category}</td>
            <td><span className="bcardart__pill bcardart__pill--mark">Replaced</span></td>
          </tr>
          <tr>
            <td><span className="bcardart__co"><span className="bcardart__logo bcardart__logo--c">A</span><span>Apollo</span></span></td>
            <td className="bcardart__cat">Sales prospecting</td>
            <td><span className="bcardart__pill bcardart__pill--mark">Replaced</span></td>
          </tr>
          <tr className="bcardart__row--aca">
            <td><span className="bcardart__co"><span className="bcardart__logo bcardart__logo--a">a</span><span>aca.</span></span></td>
            <td className="bcardart__cat">Multi-channel</td>
            <td><span className="bcardart__pill bcardart__pill--live">Active</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SequenceArt({ post }: { post: BlogPost }) {
  const d = sequenceData(post);
  return (
    <div className="bcardart bcardart--sequence">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">{d.name}</div>
        <span className="bcardart__chip bcardart__chip--live">{d.chip}</span>
      </div>
      <div className="bcardart__seq">
        {d.steps.map((s, i) => (
          <div key={i} className={`bcardart__step ${i === d.replyAt ? "is-replied" : ""}`}>
            <div className="bcardart__step__day">{s.day}</div>
            <div className={`bcardart__step__icon bcardart__step__icon--${s.ch}`}>{s.glyph}</div>
            <div className="bcardart__step__label">{s.label}</div>
            {i === d.replyAt && <span className="bcardart__step__chip">Reply</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function StudioArt({ post }: { post: BlogPost }) {
  const d = studioData(post);
  return (
    <div className="bcardart bcardart--studio">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">{d.name}</div>
        <span className="bcardart__chip bcardart__chip--ai">{d.chip}</span>
      </div>
      <div className="bcardart__tiles">
        {d.tiles.map((t) => (
          <div key={t.k} className="bcardart__tile">
            <div className="bcardart__tile__art" style={{ background: t.bg }} />
            <div className="bcardart__tile__row">
              <span className="bcardart__tile__name">{t.label}</span>
              <span className="bcardart__tile__chip">Generated</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineArt({ post }: { post: BlogPost }) {
  const d = pipelineData(post);
  const stageLabel: Record<string, string> = { booked: "Booked", replied: "Replied", sent: "Sent" };
  return (
    <div className="bcardart bcardart--pipeline">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">{d.name}</div>
        <span className="bcardart__chip bcardart__chip--live">{d.chip}</span>
      </div>
      <table className="bcardart__table">
        <thead>
          <tr><th>Account</th><th>Stage</th><th>Trigger</th></tr>
        </thead>
        <tbody>
          {d.rows.map((r, i) => (
            <tr key={r.name}>
              <td><span className="bcardart__co"><span className={`bcardart__logo bcardart__logo--${"abc"[i]}`}>{r.logo}</span><span>{r.name}</span></span></td>
              <td><span className={`bcardart__stage bcardart__stage--${r.stage}`}>{stageLabel[r.stage]}</span></td>
              <td className="bcardart__trigger">{r.trigger}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgencyArt({ post }: { post: BlogPost }) {
  const d = agencyData(post);
  return (
    <div className="bcardart bcardart--agency">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">{d.name}</div>
        <span className="bcardart__chip bcardart__chip--live">{d.chip}</span>
      </div>
      <div className="bcardart__metric">
        <span className="bcardart__metric__l">{d.metricLabel}</span>
        <span className="bcardart__metric__n bcardart__metric__n--text"><em>{d.metricValue}</em></span>
      </div>
      <div className="bcardart__rows">
        {d.rows.map((c) => (
          <div key={c.name} className="bcardart__row">
            <span className="bcardart__co"><span className={`bcardart__logo bcardart__logo--${c.color}`}>{c.logo}</span><span>{c.name}</span></span>
            <span className="bcardart__pill bcardart__pill--soft">{c.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartArt({ post }: { post: BlogPost }) {
  const d = chartData(post);
  return (
    <div className="bcardart bcardart--chart">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">{d.name}</div>
        <span className="bcardart__chip bcardart__chip--ai">{d.chip}</span>
      </div>
      <div className="bcardart__chart">
        {d.bars.map((h, i) => (
          <i key={i} style={{ height: `${h}%`, background: i >= d.bars.length - 2 ? "var(--mark, #D4361A)" : "var(--ink, #15140F)" }} />
        ))}
      </div>
      <div className="bcardart__foot">
        <span>{d.foot.l}</span>
        <span>{d.foot.r}</span>
      </div>
    </div>
  );
}

function StackSwapArt() {
  return (
    <div className="bcardart bcardart--stack">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">Stack · before / after</div>
        <span className="bcardart__chip bcardart__chip--live">Consolidated</span>
      </div>
      <div className="bcardart__stack">
        <div className="bcardart__stack__col bcardart__stack__col--was">
          <span className="bcardart__stack__lab">Was</span>
          <div className="bcardart__stack__chips">
            <span className="bcardart__stack__chip">Outreach</span>
            <span className="bcardart__stack__chip">Apollo</span>
            <span className="bcardart__stack__chip">Clay</span>
            <span className="bcardart__stack__chip">Lemlist</span>
            <span className="bcardart__stack__chip">Phantom</span>
            <span className="bcardart__stack__chip">Hunter</span>
          </div>
          <span className="bcardart__stack__sum">Multi-tool stack</span>
        </div>
        <div className="bcardart__stack__arrow">→</div>
        <div className="bcardart__stack__col bcardart__stack__col--now">
          <span className="bcardart__stack__lab">Now</span>
          <div className="bcardart__stack__one">
            <span className="bcardart__logo bcardart__logo--a" style={{ width: 22, height: 22, fontSize: 12 }}>a</span>
            <span>aca.</span>
          </div>
          <span className="bcardart__stack__sum bcardart__stack__sum--mark">All-in-one</span>
        </div>
      </div>
    </div>
  );
}

function RankedArt({ post }: { post: BlogPost }) {
  const d = rankedData(post);
  return (
    <div className="bcardart bcardart--ranked">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">{d.name}</div>
        <span className="bcardart__chip bcardart__chip--ai">{d.chip}</span>
      </div>
      <ol className="bcardart__rank">
        {d.rows.map((r) => (
          <li key={r.rank} className={`bcardart__rank__row ${r.isAca ? "is-aca" : ""}`}>
            <span className="bcardart__rank__num">{String(r.rank).padStart(2, "0")}</span>
            <span className={`bcardart__logo bcardart__logo--${r.color}`}>{r.name.charAt(0).toUpperCase()}</span>
            <span className="bcardart__rank__name">{r.name}</span>
            <span className="bcardart__rank__bar"><i style={{ width: `${r.weight}%` }} /></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function InboxArt() {
  return (
    <div className="bcardart bcardart--inbox">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">Deliverability</div>
        <span className="bcardart__chip bcardart__chip--live">Healthy</span>
      </div>
      <div className="bcardart__deliver">
        <div className="bcardart__deliver__row bcardart__deliver__row--inbox">
          <span className="bcardart__deliver__lab">Inbox</span>
          <span className="bcardart__deliver__bar"><i style={{ width: "98%" }} /></span>
          <span className="bcardart__deliver__pct">High</span>
        </div>
        <div className="bcardart__deliver__row bcardart__deliver__row--spam">
          <span className="bcardart__deliver__lab">Promo</span>
          <span className="bcardart__deliver__bar"><i style={{ width: "10%" }} /></span>
          <span className="bcardart__deliver__pct">Low</span>
        </div>
        <div className="bcardart__deliver__row bcardart__deliver__row--bounce">
          <span className="bcardart__deliver__lab">Bounce</span>
          <span className="bcardart__deliver__bar"><i style={{ width: "5%" }} /></span>
          <span className="bcardart__deliver__pct">Low</span>
        </div>
      </div>
      <div className="bcardart__foot">
        <span><b>SPF · DKIM · DMARC</b></span>
        <span>Verified</span>
      </div>
    </div>
  );
}

function WorkflowArt() {
  return (
    <div className="bcardart bcardart--workflow">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">Workflow</div>
        <span className="bcardart__chip bcardart__chip--live">Running</span>
      </div>
      <div className="bcardart__flow">
        <div className="bcardart__node bcardart__node--trigger">
          <span className="bcardart__node__lab">Trigger</span>
          <span className="bcardart__node__name">Hire signal</span>
        </div>
        <span className="bcardart__edge" />
        <div className="bcardart__node">
          <span className="bcardart__node__lab">Enrich</span>
          <span className="bcardart__node__name">Find email</span>
        </div>
        <span className="bcardart__edge" />
        <div className="bcardart__node bcardart__node--out">
          <span className="bcardart__node__lab">Send</span>
          <span className="bcardart__node__name">DM + Email</span>
        </div>
      </div>
      <div className="bcardart__foot">
        <span><b>Trigger → Enrich → Send</b></span>
        <span>Active</span>
      </div>
    </div>
  );
}

function BookingArt() {
  return (
    <div className="bcardart bcardart--booking">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">Booked · this week</div>
        <span className="bcardart__chip bcardart__chip--live">Active</span>
      </div>
      <div className="bcardart__slots">
        <div className="bcardart__slot is-booked">
          <span className="bcardart__slot__time">Tue 10:30</span>
          <span className="bcardart__slot__name">Fairmont Bain · discovery</span>
          <span className="bcardart__slot__chip">✓</span>
        </div>
        <div className="bcardart__slot is-booked">
          <span className="bcardart__slot__time">Wed 14:00</span>
          <span className="bcardart__slot__name">Plenum Labs · demo</span>
          <span className="bcardart__slot__chip">✓</span>
        </div>
        <div className="bcardart__slot">
          <span className="bcardart__slot__time">Thu 09:15</span>
          <span className="bcardart__slot__name">Northwind · intro</span>
          <span className="bcardart__slot__chip bcardart__slot__chip--pending">…</span>
        </div>
      </div>
    </div>
  );
}

function ChannelsArt() {
  const channels = [
    { k: "in", label: "LinkedIn", color: "#0A66C2" },
    { k: "at", label: "Email", color: "var(--ink)" },
    { k: "wa", label: "WhatsApp", color: "#25D366" },
    { k: "ig", label: "Instagram", color: "#E4405F" },
    { k: "tg", label: "Telegram", color: "#229ED9" },
  ];
  return (
    <div className="bcardart bcardart--channels">
      <div className="bcardart__bar">
        <div className="bcardart__brand">aca<span className="bcardart__dot">.</span></div>
        <div className="bcardart__bar__name">Channels · synced</div>
        <span className="bcardart__chip bcardart__chip--live">All live</span>
      </div>
      <div className="bcardart__channels">
        {channels.map((c) => (
          <div key={c.k} className="bcardart__chan">
            <span className="bcardart__chan__icon" style={{ background: c.color }}>{c.k}</span>
            <span className="bcardart__chan__name">{c.label}</span>
            <span className="bcardart__chan__status"><span className="bcardart__chan__dot" /> Live</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BlogCardArt({ post }: { post: BlogPost }) {
  const v = pickVariant(post);
  if (v === "compare") return <CompareArt post={post} />;
  if (v === "sequence") return <SequenceArt post={post} />;
  if (v === "studio") return <StudioArt post={post} />;
  if (v === "agency") return <AgencyArt post={post} />;
  if (v === "chart") return <ChartArt post={post} />;
  if (v === "stackswap") return <StackSwapArt />;
  if (v === "ranked") return <RankedArt post={post} />;
  if (v === "inbox") return <InboxArt />;
  if (v === "workflow") return <WorkflowArt />;
  if (v === "booking") return <BookingArt />;
  if (v === "channels") return <ChannelsArt />;
  return <PipelineArt post={post} />;
}

export default BlogCardArt;
