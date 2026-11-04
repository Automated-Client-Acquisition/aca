export type StageKey = "booked" | "replied" | "sent" | "enriching";

export type HeroRow = {
  co: string;
  logo: string;
  logoCls: string;
  domain: string;
  role: string | null;
  trigger: string | null;
  score: number | null;
  stage: StageKey;
};

export const HERO_ROWS: HeroRow[] = [
  { co: "Hartwood", logo: "H", logoCls: "logo--a", domain: "hartwood.io", role: "Lena Kapoor · VP RevOps", trigger: '"our outbound is dead"', score: 92, stage: "booked" },
  { co: "Wendover", logo: "W", logoCls: "logo--b", domain: "wendover.co", role: "David Wu · Founder", trigger: "Hiring 3 SDRs", score: 88, stage: "replied" },
  { co: "Plenum", logo: "P", logoCls: "logo--c", domain: "plenum.co", role: "Mara Singh · Head of GTM", trigger: '"ditching Salesloft"', score: 84, stage: "sent" },
  { co: "Ardent Labs", logo: "A", logoCls: "logo--d", domain: "ardentlabs.ai", role: "Hugo Marin · CEO", trigger: "Series A · 3w ago", score: 79, stage: "sent" },
  { co: "Greypine", logo: "G", logoCls: "logo--e", domain: "greypine.io", role: "Priya Anand · Head of Growth", trigger: "Pricing page · 2nd visit", score: 76, stage: "enriching" },
  { co: "Briarstone", logo: "B", logoCls: "logo--f", domain: "briarstone.app", role: null, trigger: null, score: null, stage: "enriching" },
];

export const HERO_LATE_ROW: HeroRow = {
  co: "Stellan",
  logo: "S",
  logoCls: "logo--c",
  domain: "stellan.app",
  role: "Theo Reyes · COO",
  trigger: "live signal detected",
  score: 81,
  stage: "enriching",
};

export type ModuleStat = { value: string; label: string; accent?: boolean };

export type Module = {
  step: string;
  tag: string;
  title: string;
  emphasis: string;
  paragraphs: string[];
  stats: ModuleStat[];
  replaces?: { tool: string; cost: string }[];
  wide?: boolean;
};

export const MODULES: Module[] = [
  {
    step: "01",
    tag: "Find your buyers",
    title: "Find high-intent leads.",
    emphasis: "Anywhere your AI can reach.",
    paragraphs: [
      "Four sources, one prospect context. The preloaded index is your starting point - not your ceiling.",
      "**Source 01** · the preloaded B2B index, filterable by 18 ICP dimensions.",
      "**Source 02** · your own data. CRM exports, lists, anything you bring.",
      "**Source 03** · custom systems we build for your niche. Podcast guests, GitHub stargazers, conference attendees - anything you can describe.",
      "**Source 04** · live buying signals across the open web. 14 types - pricing-page visits, hires, funding, tech-stack swaps.",
      "Every email verified. Every profile enriched. Every account scored by intent. The hot ones float to the top.",
    ],
    stats: [
      { value: "4", label: "source types combined", accent: true },
      { value: "18", label: "ICP filters" },
      { value: "14", label: "live signal types" },
    ],
    replaces: [
      { tool: "Apollo", cost: "$149/mo" },
      { tool: "Clay", cost: "$349/mo" },
      { tool: "Phantombuster + scrapers", cost: "~$200/mo" },
    ],
  },
  {
    step: "02",
    tag: "Contact them with AI",
    title: "Reach every lead.",
    emphasis: "In your voice. At deliverable scale.",
    paragraphs: [
      "Your AI drafts every message - LinkedIn DM, cold email, sequence follow-up - in your voice, trained on your last 50 sends and call transcripts. Reads like you wrote it, not a vendor template.",
      "Sent through warmed senders we provision for you: unlimited LinkedIn profiles, unlimited M365 mailboxes (yours or ours, $0.66/inbox at cost). SPF, DKIM, DMARC configured automatically. Throttled by reputation. Rotated across the pool.",
      "Your primary domain never sends a single outbound email. Inbox, not promotions.",
    ],
    stats: [
      { value: "∞", label: "senders + mailboxes", accent: true },
      { value: "$0.66", label: "per inbox at cost" },
      { value: "14d", label: "mailbox warmup" },
      { value: "150", label: "mailboxes / domain" },
    ],
    replaces: [
      { tool: "Smartlead", cost: "$94/mo" },
      { tool: "HeyReach", cost: "$99/mo" },
      { tool: "Domains + warmup", cost: "$220/mo" },
    ],
  },
  {
    step: "03",
    tag: "Run inbound on the same rope",
    title: "Daily posts. Comments captured.",
    emphasis: "Magnets sent automatically.",
    paragraphs: [
      "Almost hand-written posts shipped daily to every LinkedIn account you run - founders, team, ghostwriting clients. Drafted in your voice. Tuned to the same ICP the outbound module is hitting.",
      "When someone comments \"send\" or \"interested\" on a post, the AI agent reads the comment, DMs them the lead magnet in 30 seconds, qualifies in-thread, books the meeting. Same day. No Zapier. No manual sorting.",
      "Engagement watched too: likes, saves, profile views all become warm leads. The first DM references the actual post they engaged with.",
      "Every post sits on one calendar: LinkedIn, Instagram, Facebook, TikTok, YouTube, Google Business, Threads, Pinterest and X. The scheduling agent fills the empty slots at the times your audience is online, and each post's reach and engagement come back so the next week leans into what worked.",
    ],
    stats: [
      { value: "∞", label: "LinkedIn accounts", accent: true },
      { value: "~30s", label: "magnet delivery" },
      { value: "5", label: "engagement signals tracked" },
      { value: "0", label: "Zapier glue needed" },
    ],
    replaces: [
      { tool: "Buffer / Hootsuite", cost: "$99/mo" },
      { tool: "Phantombuster", cost: "$69/mo" },
      { tool: "Social media manager", cost: "$3-5K/mo" },
    ],
    wide: true,
  },
  {
    step: "04",
    tag: "Handle every reply",
    title: "One inbox.",
    emphasis: "Every channel.",
    paragraphs: [
      "LinkedIn DMs, cold email replies, comment threads - one unified inbox your AI watches. It reads the thread, classifies the reply, drafts a response in your voice.",
      "Easy ones: auto-replied. Ambiguous ones: escalated to your Slack within 12 minutes, with the full thread plus the original brief plus the signal history attached.",
      "No reply sits cold for two days.",
    ],
    stats: [
      { value: "4", label: "channels unified", accent: true },
      { value: "12 min", label: "escalation SLA" },
      { value: "60s", label: "auto-reply target" },
      { value: "∞", label: "concurrent threads" },
    ],
    replaces: [
      { tool: "Front", cost: "$59/mo" },
      { tool: "Manual triage time", cost: "~10h/wk" },
    ],
  },
  {
    step: "05",
    tag: "Book the meeting",
    title: "Books in-thread.",
    emphasis: "No Calendly link.",
    paragraphs: [
      "On a positive reply, the booking module finds real calendar overlap with the prospect, proposes three slots, asks two qualifying questions in-thread, and holds the slot for 23 minutes.",
      "The prospect picks a time without ever leaving the conversation. Calendar event lands with the research brief and signal context attached.",
    ],
    stats: [
      { value: "3", label: "slots proposed in-thread", accent: true },
      { value: "2", label: "qualifying Qs before hold" },
      { value: "23 min", label: "hold TTL" },
      { value: "0", label: "Calendly links sent" },
    ],
    replaces: [
      { tool: "Chili Piper", cost: "$150/mo" },
      { tool: "Calendly Pro", cost: "$15/mo" },
    ],
  },
];

export type CompareLine = { label: string; replaces: string; cost: number };

export const COMPARE_LINES: CompareLine[] = [
  { label: "HeyReach", replaces: "LinkedIn outreach", cost: 99 },
  { label: "Smartlead", replaces: "Cold email infra", cost: 94 },
  { label: "Apollo", replaces: "Lead database", cost: 149 },
  { label: "Clay", replaces: "Enrichment + AI columns", cost: 349 },
  { label: "Chili Piper", replaces: "Auto-booking", cost: 150 },
  { label: "Domains + warmup", replaces: "Deliverability", cost: 220 },
  { label: "Human SDR", replaces: "or 11x · Artisan · AiSDR (~$1.5-3K + token markup)", cost: 6000 },
];

export const COMPARE_TOTAL = 7061;

export type Tier = {
  key: "starter" | "vip";
  tag: string;
  name: string;
  priceMonthly: string;
  priceYearly: string;
  yearlySave?: string;
  sub: string;
  feats: string[];
  cta: { label: string; href: string };
  highlight?: boolean;
  goldBorder?: boolean;
  forWho?: string;
};

export const PRICING_TIERS: Tier[] = [
  {
    key: "starter",
    tag: "Most popular",
    name: "Starter",
    priceMonthly: "67",
    priceYearly: "490",
    yearlySave: "save $314",
    sub: "Everything ACA does. For B2B firms running a real GTM motion.",
    feats: [
      "All five orchestration modules",
      "Unlimited seats",
      "Unlimited LinkedIn senders",
      "Unlimited email mailboxes",
      "Unlimited sends, sequences, signals",
      "Preloaded B2B index",
      "Live signals across the open web",
      "Auto-reply, auto-booking",
      "BYOK across all MCP clients",
      "Priority support · 12-min SLA",
      "11-day meeting guarantee",
    ],
    cta: { label: "Start For Free →", href: "/get-started" },
    highlight: true,
    forWho: "Operators",
  },
  {
    key: "vip",
    tag: "Done for you",
    name: "VIP",
    priceMonthly: "1,500",
    priceYearly: "15,000",
    sub: "For founders who'd rather buy the outcome than build the system.",
    feats: [
      "Senior operator runs your account",
      "ICP defined on a kickoff call",
      "Voice profile trained from transcripts",
      "Inbox monitored, escalations handled",
      "Weekly optimization + report",
      "Slack channel with your operator",
      "Same 11-day meeting guarantee",
    ],
    cta: { label: "Talk to us about VIP →", href: "/contact" },
    goldBorder: true,
    forWho: "Delegators",
  },
];

export const FIT_LIST: string[] = [
  "You're running outbound yourself, or want to - and you're not ready to hire an SDR",
  "You sell B2B with a $1K+ ACV: agency, SaaS, productized, consulting, recruitment",
  "You sell into LinkedIn-active buyers: founders, ops, GTM, technical decision makers",
  "You already use Claude, ChatGPT, Cursor or similar AI tools every day",
  "You'd rather own your distribution stack than rent it from a vendor",
  "You think in workflows, not org charts",
];

export const NO_FIT_LIST: string[] = [
  "You sell to consumers, e-commerce, or D2C",
  "You don't have an offer yet - ACA scales what's working, it doesn't invent demand",
  "You want a generic outsourced agency that sends 10,000 templated emails a month",
  "You're allergic to teaching your AI your voice (Pro) or to a kickoff call (VIP)",
];

export type FAQ = { q: string; a: string };

export const FAQS: FAQ[] = [
  {
    q: "How is deliverability handled - am I going to get my main domain blacklisted?",
    a: "No. We provision separate sending domains specifically for outbound, with up to 150 mailboxes per domain on a Microsoft tenant (yours or ours). SPF, DKIM, and DMARC are configured automatically. Every mailbox warms up before it sends, and the orchestration layer throttles send rates by reputation, not by static rules. Your primary domain never sends a single outbound email through ACA. If you have an existing infrastructure, we can plug into that instead.",
  },
  {
    q: 'What does "bring your own keys" actually mean in practice?',
    a: "You go to your Anthropic console (or OpenAI, or Google AI Studio), generate an API key, and paste it into ACA. Every inference call ACA's orchestration layer triggers - research synthesis, message drafting, reply analysis - runs against your key, billed to your account, at the provider's list price. We see the request, we see the result, we don't see the tokens or the cost. You own the relationship with the model provider. We're infrastructure, not a reseller.",
  },
  {
    q: 'Can the AI actually write in my voice, or does it sound like every other "AI SDR" out there?',
    a: "The voice quality is downstream of three things: the model you pick, the training material you give it, and the prompts. We give you the latter two. You upload your last 50 sent messages and ideally a few call transcripts. The orchestration layer extracts your phrasing, sentence rhythm, and rhetorical moves into a voice profile, and your AI references it on every draft. If you pick a frontier model (Claude Opus, GPT-4 class), the output is genuinely indistinguishable from your own writing within about a week of light corrections. If you pick a cheaper model, it's worse. That's your call, not ours.",
  },
  {
    q: "How is this different from buying HeyReach + Smartlead + Apollo + Clay + Chili Piper and wiring them up myself?",
    a: "Three differences. First, those tools don't share context - your Apollo enrichment doesn't know what Smartlead sent, Chili Piper doesn't know what HeyReach detected. Every prospect lives in five disconnected databases. ACA's orchestration layer holds one context per prospect across every module. Second, none of those tools are MCP-native, so your AI can't call them directly - you have to glue them with Make or Zapier and pay another markup on top. Third, the tools alone cost $861/month before you factor in the SDR running them. ACA is $67/month all in. The price gap isn't a discount - it's the result of building one infrastructure layer instead of buying six fragmented products that each carry their own margin.",
  },
  {
    q: "What about my data and my prospects' data?",
    a: "Prospect data lives in your workspace, on infrastructure we host on your behalf. We never sell, share, or train models on your data. Inference runs on your model provider, not ours, so the model vendor's data policy is the one that governs the conversation - not ours. If you're enterprise and need a DPA, SOC 2 documentation, or specific data residency, contact us directly and we'll handle it.",
  },
  {
    q: "What if I sign up and it doesn't work for my niche?",
    a: "You email us within 11 days. We refund every dollar. No survey, no defense, no \"let me show you the dashboard.\" That's the guarantee, and it's the guarantee specifically because we'd rather lose a non-fit customer fast than spend three months arguing with them on Intercom. If your niche is genuinely outside what ACA serves well, we want to know in week two, not month six.",
  },
  {
    q: 'I\'m not "AI-native." Can I still use this?',
    a: "Probably not yet, and we'd rather tell you that now than after you've paid. ACA assumes you already use an AI tool - Claude, ChatGPT, Cursor, similar - for at least an hour a day, and you're comfortable writing prompts and supervising agentic workflows. If you're not there yet, the right move is to get there first (it's a six-week investment, max), then come back. We'll still be here.",
  },
];

export type TimelineNode = { date: string; title: string; emphasis?: string; body: string; here?: boolean };

export const TIMELINE: TimelineNode[] = [
  {
    date: "2024",
    title: "Frontier reasoning",
    body: "Models can plan a sales conversation, not just generate text.",
  },
  {
    date: "2025 · Q1",
    title: "MCP becomes standard",
    body: "Any AI client calls any tool reliably, no bespoke integration.",
  },
  {
    date: "2025 · Q3",
    title: "Inference cost cratered",
    body: "Pennies per real prospect synthesis.",
  },
  {
    date: "2026 · today",
    title: "ACA ships",
    emphasis: "the plumbing.",
    body: "The infrastructure layer underneath.",
    here: true,
  },
];

export const ELEVEN_DAYS: { day: number; label: string; status: string; pinned?: boolean }[] = [
  { day: 1, label: "You sign up", status: "kickoff" },
  { day: 2, label: "ICP locked", status: "config" },
  { day: 3, label: "Senders warmed", status: "config" },
  { day: 4, label: "Research running", status: "running" },
  { day: 5, label: "First-touch sent", status: "running" },
  { day: 6, label: "Outbound at volume", status: "running" },
  { day: 7, label: "First reply", status: "running" },
  { day: 8, label: "Qualifying in-thread", status: "warm" },
  { day: 9, label: "Calendar overlap", status: "warm" },
  { day: 10, label: "Slot held", status: "warm" },
  { day: 11, label: "Meeting · Lena · 14:00", status: "booked", pinned: true },
];
