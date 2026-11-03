// Pre-baked sandbox workspaces. Each demo is what the real /get-started
// pipeline would have produced for a visitor with this profile. Used to
// power /sandbox - visitors pick one, watch the build animate, see real
// content, then hit "I want this for my business" → /get-started.
//
// Content here is deterministic by design: no LLM cost per visitor, no
// flakiness, and lets us hand-tune the showcase examples to be exactly
// as sharp as the best output the real system produces on a good day.

export interface SandboxDemo {
  id: string;
  hero: string;        // chip on the picker card
  name: string;        // company name shown in the wizard
  website: string;     // homepage URL (display only)
  linkedinUrl: string;
  founderName: string;
  goal: string;
  pains: string[];

  // The 10 artifacts we'd generate
  icp: {
    name: string;
    summary: string;
    industry: string;
    roles: string;
    pains: string[];
    desires: string[];
    language: string;
  };
  product: {
    name: string;
    description: string;
    category: string;
    features: string[];
  };
  knowledge: string;   // markdown
  audit: {
    overall: number;
    headline_score: number;
    about_score: number;
    banner_score: number;
    activity_score: number;
    headline_rewrite: string;
    about_rewrite: string;
    summary: string;
    recommendations: string[];
  };
  sequence: {
    name: string;
    steps: Array<{ step: number; channel: "email" | "linkedin"; delay_days: number; subject?: string; body: string }>;
  };
  blueprint: {
    name: string;
    themes: Array<{ theme: string; frequency: string; hook_pattern: string; example_post: string }>;
  };
  campaignSteps: string[]; // visual steps for the campaign graph
  contentPlanPreview: string;
  agent: {
    name: string;
    description: string;
    tone_traits: string[];
    escalation_triggers: string[];
  };
  strategyPreview: string;
}

export const DEMOS: SandboxDemo[] = [
  // ── Demo 1: B2B SaaS founder selling to finance buyers ─────────────────────
  {
    id: "saas",
    hero: "B2B SaaS founder",
    name: "Vaultwise",
    website: "https://vaultwise.io",
    linkedinUrl: "https://linkedin.com/in/sample-saas-founder",
    founderName: "Ana",
    goal: "Book more sales calls",
    pains: ["Nobody replies to my outreach", "I don't really know who my buyer is", "Doing it manually eats my whole week"],
    icp: {
      name: "Élise · the scaling SaaS CFO",
      summary: "Élise runs finance for a 50-person B2B SaaS doing €8M ARR at 120% YoY growth. She's drowning in payment reconciliation across Stripe, legacy bank rails, and a patchwork of usage-billing tools. She has 2 board meetings a month and an auditor breathing down her neck.",
      industry: "B2B SaaS · Series A/B",
      roles: "CFO, VP Finance, Head of Finance, Director of Finance Operations",
      pains: [
        "I spend 40 hours a month reconciling payments across three systems and our accounting software still shows discrepancies",
        "We can't launch usage-based pricing because our current setup can't handle metered billing or proration",
        "Our US expansion is stalled because we don't support local payment methods and the fees are eating our margins",
        "Revenue recognition is a nightmare - I need an auditor-friendly paper trail and right now it's all manual",
        "We want to offer corporate cards to our sellers but building in-house would take 18 months we don't have",
      ],
      desires: [
        "Cut month-end close from 8 days to 3",
        "Launch new pricing models without engineering bottlenecks",
        "Pass the next audit without a 60-page exception list",
        "Stop firefighting reconciliation and actually contribute to strategy",
      ],
      language: "Specific, numbers-driven, skeptical of vendor pitches. Says 'recon', 'AR aging', 'rev rec', 'pass-through fees'. Avoids 'leverage', 'unlock', anything that sounds like a deck.",
    },
    product: {
      name: "Vaultwise",
      description: "We replace your tangled stack of payment + billing + reconciliation tools with one ledger that books revenue correctly the first time. Built for SaaS finance teams between Series A and Series C who need their close to take days instead of weeks.",
      category: "Fintech infrastructure",
      features: [
        "Multi-rail reconciliation (Stripe + bank + invoicing) with auto-match",
        "Usage-based + tiered + hybrid billing without engineering",
        "Real-time revenue recognition compliant with ASC 606",
        "Multi-currency + multi-entity from day one",
        "Auditor-ready export - no more month-end PDF nightmares",
      ],
    },
    knowledge: `## Offer summary

Vaultwise is a unified ledger for B2B SaaS finance teams. We sit between Stripe, your bank, and your accounting tool - and we book every transaction correctly the first time. For a €5-15M ARR SaaS company that currently spends 30-40 hours/month reconciling, we cut that to under 2 hours.

Pricing: $1,500/mo for Series A, custom for Series B+. 30-day money back, no setup fee. Onboarding takes 5 business days from contract to first close run.

## Voice & tone

Ana writes for finance buyers, not for marketing. Every claim has a number. Every comparison has a real competitor named. She avoids the SaaS bro vocabulary ("leverage", "transform", "unlock") - instead uses operator language ("close days", "FX spread", "match rate"). She'll publicly disagree with bad takes from competitors. Her LinkedIn is 90% specific case-study reductions, 10% strong opinions about fintech.

## Social proof

Closed 12 SaaS customers from $300K ARR (Pleo) to $40M ARR (Sastrify). Most-cited public win: cut Sastrify's close from 11 days to 3. Featured in TechCrunch piece on European fintech infrastructure (March 2026). No public customer logo wall yet - case studies are 1-pagers shared in DMs to qualified prospects.`,
    audit: {
      overall: 4,
      headline_score: 3,
      about_score: 5,
      banner_score: 2,
      activity_score: 4,
      headline_rewrite: "Helping €5-15M ARR SaaS CFOs close their books in 3 days, not 11 · Multi-rail recon + usage billing in one ledger",
      about_rewrite: "Most CFOs at scaling SaaS companies don't have a finance tool problem - they have a *reconciliation* problem. You're sitting between Stripe (which says you collected €8M), your bank (which says you received €7.84M after FX + fees), and your accounting tool (which thinks you booked something else entirely). Multiply that by 3 currencies and 2 entities and your close just turned into a 60-hour archaeological dig.\n\nThat's what Vaultwise solves. We unify multi-rail recon, usage billing, and revenue recognition into one ledger that books correctly the first time. Series A SaaS companies cut their close from 8 days to 3. Series B companies launch usage-based pricing in 2 weeks instead of 6 months.\n\nIf your month-end is a nightmare, message me. Worst case you get a free 30-min audit of your finance stack. Best case: we cut a week off your next close.",
      summary: "Strong professional foundation but invisible to her ICP. Headline says 'CEO of Vaultwise' - meaningless to a CFO scrolling LinkedIn. About is generic. No banner image. Activity is once-a-month, which kills LinkedIn algorithm. Fix the headline to lead with the buyer's outcome, swap the About to a 'most CFOs don't have an X problem, they have a Y problem' hook, ship 3 specific posts this week.",
      recommendations: [
        "Rewrite headline to lead with buyer outcome (provided above)",
        "Replace About with the reframe-driven version (provided above)",
        "Add a banner image with one specific claim: 'Cut SaaS close from 11d → 3d'",
        "Post 3x/week minimum - your buyer's algorithm forgets you in 10 days",
        "Pin one post: a case-study reduction with a real customer name and number",
      ],
    },
    sequence: {
      name: "Élise · 5-touch sequence (SaaS CFO)",
      steps: [
        { step: 1, channel: "email", delay_days: 0, subject: "€8M → US expansion math",
          body: "Élise,\n\nSaw you're scaling toward US expansion at €8M ARR. The math hits a wall fast when Stripe fees stack with FX spreads and you're still reconciling three systems by hand.\n\nI work with SaaS finance teams who've cut reconciliation from 40+ hours to under 2 hours monthly, and launched in new markets without adding vendor contracts or engineering sprints.\n\nWorth a 20-minute call to show how a €6M company added usage-based pricing in 8 days?\n\nAna" },
        { step: 2, channel: "linkedin", delay_days: 2,
          body: "Élise - sent you a note on €8M / US expansion math earlier. Connecting in case you'd rather chat here." },
        { step: 3, channel: "email", delay_days: 4, subject: "Sastrify cut close from 11d → 3d",
          body: "Quick context on the email last week:\n\nSastrify was running 8 days for monthly close. Same multi-rail pain (Stripe + bank + Xero). We replaced the 3 reconciliation steps with one ledger. Month 1: 4 days. Month 3: 3 days. CFO got 60 hours/month back.\n\nNo decks. If you want, I'll send the 1-page write-up.\n\nAna" },
        { step: 4, channel: "linkedin", delay_days: 6,
          body: "Followed up on the Sastrify case study by email - happy to share it here too if easier. No pitch, just the numbers." },
        { step: 5, channel: "email", delay_days: 9, subject: "Closing the loop",
          body: "Last note - if recon isn't your top fire right now, totally get it. If it ever becomes one, the door's open.\n\nIf you'd rather I stop, just say 'stop' and you're off the list permanently.\n\nAna" },
      ],
    },
    blueprint: {
      name: "Vaultwise · daily LinkedIn cadence",
      themes: [
        {
          theme: "Reconciliation math that sticks",
          frequency: "Mon, Thu",
          hook_pattern: "Start with the exact number of hours wasted, then flip to what's possible.",
          example_post: "Most finance teams at €5-15M ARR spend 35-50 hours monthly reconciling Stripe, bank feeds, and invoicing tools. One CFO I spoke with last week was at 42 hours. Her team exported CSVs three times a week just to spot payment mismatches.\n\nShe switched to unified payment infrastructure. Month one: 2 hours to reconcile. Not because she hired more people. Because the system stopped lying to her.\n\nThe math is brutal: at €150/hour fully loaded, that's €6,000 a month she got back. Her CFO used it to hire a controller instead.\n\nIf reconciliation is eating your month-end close, let's talk about what your team could actually do with those hours back.",
        },
        {
          theme: "Pricing model velocity",
          frequency: "Tue, Fri",
          hook_pattern: "Compare 6-month engineering build vs. configured-in-an-afternoon.",
          example_post: "A Series B CEO told me last week: 'We've been trying to launch usage-based pricing for 7 months.'\n\nSeven. Months.\n\nReason: their billing system can't handle metered billing or proration without an engineering sprint. So the proposal sat in the backlog. So the CEO can't run the pricing experiment. So they're leaving margin on the table every month.\n\nWith the right billing infrastructure, usage-based pricing is a configuration. Hybrid pricing is a configuration. Tiered with overage is a configuration. The engineering sprint vanishes.\n\nIf your roadmap is being held hostage by your pricing infrastructure, that's a tooling problem, not a strategy problem.",
        },
        {
          theme: "Audit-ready or audit-disaster",
          frequency: "Wed",
          hook_pattern: "Show the difference between two CFOs' audit experiences.",
          example_post: "Two SaaS CFOs, both at €10M ARR, both with year-end audits last week.\n\nCFO A: 60-page exception list. Six weeks of back-and-forth. Three deferred revenue restatements. Auditor billed +40% over estimate.\n\nCFO B: 4-page exception list. Two weeks. Zero restatements. Auditor billed under estimate.\n\nThe difference wasn't headcount. CFO A had two more people on her team.\n\nThe difference was that CFO B's system booked revenue correctly the first time. Every transaction was tagged at the moment it happened. Rev rec wasn't a year-end project - it was a side effect.\n\nWhich one are you on track to be this December?",
        },
      ],
    },
    campaignSteps: [
      "Start",
      "Connect request (Élise - saw your scale-up trajectory…)",
      "Wait 2 days",
      "Message after acceptance (Quick reason I reached out…)",
      "Wait 3 days",
      "Follow-up message (One specific framework…)",
      "Switch to email",
      "End",
    ],
    contentPlanPreview: `# 30-day content plan

## Themes
1. **Reconciliation math that sticks** - quantify the exact hours/€ saved
2. **Pricing model velocity** - engineering sprints vs. configurable
3. **Audit-ready or audit-disaster** - proof points from real audits

## Calendar (week 1 shown)
| Day | Theme | Post angle |
|---|---|---|
| Mon | A | A CFO's 42-hour reconciliation week - and what she did about it |
| Tue | B | 7 months trying to launch usage-based pricing (and the 1-day fix) |
| Wed | C | Two €10M ARR CFOs, two audit experiences |
| Thu | A | The €6,000/month controller they hired with reconciliation savings |
| Fri | B | The pricing experiment your roadmap is hiding from you |`,
    agent: {
      name: "Ana's Reply Agent",
      description: "Qualifies inbound replies and drafts responses that sound like Ana - specific, skeptical, grounded in real numbers.",
      tone_traits: [
        "Specific and numbers-driven (real ARR, hours, margin points)",
        "Skeptical and case-study-focused (trusts proof over promises)",
        "Anti-fluff (hates vague sales language)",
        "Opinionated (will publicly disagree with bad takes)",
      ],
      escalation_triggers: [
        "Prospect names a specific competitor head-to-head",
        "Prospect mentions a board meeting deadline",
        "Reply contains pricing/contract negotiation",
        "Reply mentions an audit happening in <60 days",
      ],
    },
    strategyPreview: `# 60-day plan: book sales calls

## The bet
You're betting that French and European finance leaders at €5-15M ARR B2B SaaS companies are actively searching for payment infrastructure solutions but ignoring cold outreach because it's generic. Success at day 60 means 12+ qualified calls booked with CFOs or Finance VPs who admit they're spending 30+ hours monthly on reconciliation or have stalled pricing experiments.

## Days 1-14: Foundation
- Verify Élise ICP across 100 LinkedIn profiles - confirm 70%+ match
- Ship 6 LinkedIn posts (2 per theme) - measure profile views from ICP titles
- Load first batch of 50 prospects · half-and-half tier-1 (€8-15M ARR) and tier-2 (€3-8M)

## Days 15-30: First contact
- Enroll 50 prospects in the 5-touch sequence · target 6%+ reply rate
- Run 5 comment-to-DM threads per week · log conversations
...`,
  },

  // ── Demo 2: Marketing agency owner ─────────────────────────────────────────
  {
    id: "agency",
    hero: "Marketing agency owner",
    name: "Wavelength Studio",
    website: "https://wavelengthstudio.com",
    linkedinUrl: "https://linkedin.com/in/sample-agency",
    founderName: "Marcus",
    goal: "Fill agency pipeline",
    pains: ["My revenue has been flat for months", "Prospects ghost after the first call", "I'm winging it - no real system"],
    icp: {
      name: "Sarah · the over-it SMB founder",
      summary: "Sarah runs a 12-person ecom brand doing $4M ARR. She's burned by 3 agencies in 24 months who promised 'full-funnel growth' and delivered Asana boards and Slack pings. She refuses to take a single agency call without a real teardown of her current setup. Wants a partner, not a vendor.",
      industry: "DTC ecommerce, $1-10M ARR",
      roles: "Founder/CEO, Head of Growth, CMO, VP Marketing (founder-led)",
      pains: [
        "I've paid 3 agencies in 2 years and only one moved a real number",
        "Every agency call starts with their case studies - I want them to lead with what's broken in MY setup",
        "Junior account managers + senior pitches = the bait and switch I'm sick of",
        "I need someone who'll actually argue with me, not just say 'great idea Sarah'",
        "I don't have time to manage another vendor",
      ],
      desires: [
        "An agency that does 1 thing brilliantly instead of 5 things mediocre",
        "Direct line to the senior person, not an account manager handoff",
        "Real numbers in week 1 - not 'strategy phase' for 60 days",
        "Someone who has an actual opinion about my business",
      ],
      language: "Direct, impatient, allergic to agency-speak. Says 'CAC', 'AOV', 'POAS', 'pull a list'. Hates 'strategy session', 'discovery call', 'leverage', 'unlock'.",
    },
    product: {
      name: "Wavelength Studio",
      description: "We're the agency that leads with a teardown, not a deck. We do one thing: rebuild paid social funnels for $1-10M DTC brands who've been burned by full-service agencies. Senior-only - no account managers. 90-day engagements with real lift, or we refund the last month.",
      category: "Paid social / DTC growth",
      features: [
        "Teardown-first onboarding (we audit your current funnel before you sign)",
        "Senior-only delivery (Marcus does the work)",
        "Single-channel focus: Meta + TikTok funnels for DTC",
        "Weekly Loom recap - no status meetings",
        "Real KPI guarantee: lift in CAC or refund last month",
      ],
    },
    knowledge: `## Offer summary

Wavelength Studio is a one-person senior agency rebuilding paid social funnels for $1-10M DTC brands. We're explicitly NOT full-service. We don't do email, we don't do SEO, we don't do influencer. We do Meta + TikTok funnels and we do them brilliantly. $8K/month flat, 90-day minimum.

## Voice & tone

Marcus writes like a punch in the face. Short sentences. Strong opinions. Public teardowns of bad ads. He'll roast a competitor's case study in a LinkedIn post. He never uses words like "strategic", "leverage", "unlock", "ecosystem", or anything that sounds like a deck. Everything is "your CAC is busted because…", not "let's optimize your customer acquisition costs."

## Social proof

7 active clients between $1M-$10M ARR. Most-cited win: took a skincare brand from $40 CAC to $19 CAC in 8 weeks (named in DMs only, not publicly). Has 14k LinkedIn followers from publishing teardowns of bad DTC ads weekly. Featured on the "Marketing Operators" podcast in April 2026.`,
    audit: {
      overall: 5,
      headline_score: 7,
      about_score: 4,
      banner_score: 3,
      activity_score: 8,
      headline_rewrite: "I rebuild paid social funnels for $1-10M DTC brands who've been burned by full-service agencies · No account managers, no decks, no strategy phase",
      about_rewrite: "Most DTC brands hire a 'full-service' agency, get assigned an account manager, and watch their CAC creep up for 90 days while everyone strategizes.\n\nThat's not what we do.\n\nI'm Marcus. I run Wavelength. I personally rebuild your paid social funnel - Meta + TikTok, one channel at a time, no juniors, no decks, no Asana boards. Every Friday you get a 5-minute Loom showing exactly what I changed and what moved.\n\nReal recent work: skincare brand $40 → $19 CAC in 8 weeks. SaaS subscription DTC: $112 CPA → $58 in 6 weeks. None of this is magic. It's just the right person doing the work.\n\nIf your current agency feels like a black box, send me your ad account screenshot. I'll do a free 5-minute teardown Loom. No pitch unless you ask for one.",
      summary: "Headline + activity are strong - you're already in the algorithm. But the About reads like a CEO bio when it should be a punch in the face. Banner is missing. Fix the About, add a banner with one specific number, and you'll convert profile views to teardown requests at 3x your current rate.",
      recommendations: [
        "Rewrite About with the teardown-offer framing (provided above)",
        "Add a banner: '$40 → $19 CAC in 8 weeks · DTC paid social only'",
        "Pin the strongest teardown post (the one that got 800+ likes)",
        "Add featured section with the Marketing Operators podcast episode",
        "Reply to your top 10 commenters this week - most don't realize you're available",
      ],
    },
    sequence: {
      name: "Sarah · 5-touch sequence (DTC founder)",
      steps: [
        { step: 1, channel: "email", delay_days: 0, subject: "your Meta CPM looks off - 3-min teardown?",
          body: "Sarah,\n\nLooked at the live ad library for [BRAND]. Your video creative is solid, but the broad audience targeting is doing what broad targeting does at $4M ARR - burning your budget on people who'll never convert.\n\nI rebuild paid social funnels for DTC brands at your stage. Senior-only, no account managers.\n\nIf you want, I'll record a 5-minute Loom teardown of your top 3 active ads. No pitch unless you ask. Just press reply with 'yes'.\n\nMarcus" },
        { step: 2, channel: "linkedin", delay_days: 2,
          body: "Sarah - sent you a note about your Meta funnel. Connecting in case email's busted." },
        { step: 3, channel: "email", delay_days: 4, subject: "the $40 → $19 CAC story",
          body: "Quick follow-up. A brand similar to yours (DTC skincare, $3.5M ARR, founder-led) ran into the same audience targeting issue you're running into.\n\n8 weeks later they were at $19 CAC. Not because of secret creative. Just because the funnel was actually segmented for once.\n\nIf the teardown is a yes, just hit reply. Else no worries.\n\nMarcus" },
        { step: 4, channel: "linkedin", delay_days: 6,
          body: "Followed up on the $40 → $19 CAC case study by email. Pretty close to your setup. Send me your ad account read-only access and I'll send the teardown Loom Monday." },
        { step: 5, channel: "email", delay_days: 9, subject: "last one",
          body: "Last note - totally get if paid social isn't your top fire. If it ever becomes one, the teardown offer stands.\n\nReply 'stop' if you want off the list permanently. Otherwise I'll quiet down.\n\nMarcus" },
      ],
    },
    blueprint: {
      name: "Wavelength · daily LinkedIn cadence",
      themes: [
        {
          theme: "Public ad teardowns",
          frequency: "Mon, Wed",
          hook_pattern: "Screenshot of a real running ad + one brutal observation.",
          example_post: "This DTC skincare brand is currently paying $42 to acquire someone who'll spend $34 with them.\n\nThe ad is fine. Creative's polished. The problem is the audience: 'people interested in skincare' - which on Meta in 2026 is basically everyone with a face.\n\nFix: split into 3 audiences (current customers' lookalikes, competitor handlers, ingredient-curious researchers). Same creative, three placements. Within 4 weeks the brand's CAC was at $19.\n\nIf your Meta CAC is creeping up, it's almost never the creative. It's the targeting layer. I'll do a 3-minute teardown of any DTC ad account if you DM me read-only access.",
        },
        {
          theme: "Agency horror stories (anonymous)",
          frequency: "Tue, Fri",
          hook_pattern: "Open with what the founder paid + what they got.",
          example_post: "A founder paid $96k to an agency last year. Got 47 Asana tasks, 12 Slack channels, 3 strategy decks, and the same CAC she had when she started.\n\nWhat went wrong: she hired the agency that pitched her best, not the one with senior people doing the work. By month 3 her account was being run by a 24-year-old who'd been at the agency for 6 weeks.\n\nThe fix isn't a different agency. It's a different test. Ask any agency you're considering: 'What's your typical account manager's title and how long have they been at your company?' If the answer is anything other than 'Director or above, with >2 years here' - walk.",
        },
        {
          theme: "Strong opinions about DTC growth",
          frequency: "Thu",
          hook_pattern: "Take a contrarian stance, defend it with one specific case.",
          example_post: "Hot take that's going to upset some of you: most DTC brands at $3-10M ARR should pause email marketing for 90 days.\n\nNot kill it. Pause it.\n\nReason: your email is doing 18-25% of revenue. You think it's 'working.' But it's almost entirely promotional discounting to customers who would have repurchased anyway. You're cannibalizing your margin to chase a vanity metric.\n\nReal test: pause flows + campaigns for 60 days. Measure repeat purchase rate independently. 9 times out of 10 it doesn't move. Now you know what's actually driving repeat - and you can stop discounting.\n\nFight me in the comments.",
        },
      ],
    },
    campaignSteps: [
      "Start",
      "Connect request (Sarah - saw [BRAND]'s ad library…)",
      "Wait 2 days",
      "DM after acceptance (Quick teardown offer)",
      "Wait 3 days",
      "Follow-up DM (One specific case study)",
      "Switch to email",
      "End",
    ],
    contentPlanPreview: `# 30-day content plan

## Themes
1. **Public ad teardowns** - screenshot + brutal observation + fix
2. **Agency horror stories** - what founders paid, what they got
3. **Strong opinions about DTC** - contrarian, defended with case studies

## Calendar (week 1 shown)
| Day | Theme | Post angle |
|---|---|---|
| Mon | A | A skincare brand's broken Meta funnel - and the $23 CAC fix |
| Tue | B | $96k paid · 47 Asana tasks delivered |
| Wed | A | Why 'broad audience' targeting died in 2024 |
| Thu | C | DTC email is overrated for brands under $10M |
| Fri | B | The bait-and-switch every $5M DTC founder has seen |`,
    agent: {
      name: "Marcus's Reply Agent",
      description: "Punches first. Drafts replies that match Marcus's voice - short, opinionated, never agency-speak. Escalates to him on pricing, scope, and any 'can you also do X' creep.",
      tone_traits: [
        "Short sentences. Almost rude.",
        "Strong opinions, defended with a real number",
        "Never says 'leverage', 'unlock', 'strategy session'",
        "Will publicly disagree with the prospect if they're wrong",
      ],
      escalation_triggers: [
        "Prospect asks for scope beyond Meta/TikTok",
        "Pricing negotiation",
        "Prospect names a competitor agency for comparison",
        "Refund request or NPS-style feedback",
      ],
    },
    strategyPreview: `# 60-day plan: fill agency pipeline

## The bet
DTC founders at $1-10M ARR are exhausted by full-service agencies and primed for a senior-only, single-channel alternative. Success at day 60 = 8+ qualified calls with founders who explicitly mention being burned before.

## Days 1-14: Foundation
- Ship 4 public ad teardowns on LinkedIn - measure DM volume
- Validate Sarah ICP across 80 prospects · confirm fit
- Set up the free teardown Loom workflow (Notion → record → send)
...`,
  },

  // ── Demo 3: Online course creator ──────────────────────────────────────────
  {
    id: "course",
    hero: "Course creator",
    name: "The Founder Letters",
    website: "https://thefounderletters.com",
    linkedinUrl: "https://linkedin.com/in/sample-creator",
    founderName: "Priya",
    goal: "Sell my course",
    pains: ["My content gets no engagement", "I'm winging it - no real system", "I never have time to do outreach properly"],
    icp: {
      name: "Jake · the burned-out solo founder",
      summary: "Jake runs a 3-person bootstrapped SaaS at $400K ARR. He's the founder, the head of sales, the head of customer success, and the head of don't-think-about-marketing. He reads founder newsletters religiously but has never bought a 'how to write better emails' course because he can't tell which ones are real.",
      industry: "Bootstrapped SaaS, $200K-$2M ARR, founder-led",
      roles: "Founder, Solo founder, CEO at <10 person SaaS",
      pains: [
        "I read 30 founder newsletters but my own writing is invisible",
        "I've started a 'company blog' 4 times and abandoned it each time",
        "Every 'write better emails' course looks the same and I can't tell if any are real",
        "I don't have 3 hours/week to write - I have 30 minutes if I'm lucky",
        "I want to be in the conversation in my niche, not yelling from the sidelines",
      ],
      desires: [
        "A writing system that works in 30 min/week, not 3 hours",
        "Permission to publish unpolished, useful, honest essays",
        "Become 'the person founders in my space follow' without faking thought leadership",
        "Build a list that actually opens - not a vanity 10k subscribers",
      ],
      language: "Self-deprecating, allergic to 'thought leader' language, hates gurus. Says 'ship it', 'in public', 'audience of one'. Avoids 'leverage', 'authority', 'monetize', 'scale your influence'.",
    },
    product: {
      name: "The Founder Letters",
      description: "A 6-week writing course for founders who can't write. We don't teach 'authority building' or 'thought leadership' - we teach the actual habit of shipping a useful 500-word essay in 30 minutes a week. $400 one-time. 1,200 students. 60% complete the full 6 weeks (vs. 4% industry average).",
      category: "Online course · founder writing",
      features: [
        "6 weekly modules + 6 live writing-sprint sessions",
        "Real-time peer editing in a small cohort (max 30 people per cohort)",
        "30-min-per-week pacing guarantee - money back if it takes longer",
        "Private community of 1,200 alumni founders, actively writing",
        "Lifetime access to all updates",
      ],
    },
    knowledge: `## Offer summary

The Founder Letters is a 6-week writing course teaching bootstrapped founders how to ship 500-word essays in 30 minutes a week. $400 one-time. We don't promise audience growth, distribution hacks, or 'authority'. We promise the habit of writing, with peer-edited drafts and weekly accountability.

## Voice & tone

Priya writes for tired founders, not aspiring creators. She makes fun of guru-speak. Her tweets often start with 'unpopular opinion' or 'gentle reminder'. She publicly mocks the 'write a viral thread to grow your audience' content economy. She'll happily say "I don't know" in her writing. Her course landing page has zero stock photos.

## Social proof

1,200 paying alumni in 3 years. Highest-profile alum: the founder of [redacted small fintech], who now writes a 10k-subscriber newsletter. Featured in The Profile and the Mental Health in Startups newsletter. 60% completion rate is the standout proof point.`,
    audit: {
      overall: 6,
      headline_score: 5,
      about_score: 7,
      banner_score: 4,
      activity_score: 7,
      headline_rewrite: "I teach bootstrapped founders how to ship a useful 500-word essay in 30 minutes a week · 1,200 alumni, 60% completion rate",
      about_rewrite: "I run a small writing course for founders who can't write.\n\nNot a course on 'thought leadership.' Not a course on 'building an audience.' A course on actually opening Notion at 7am, writing 500 useful words, and hitting publish before your inbox eats your day.\n\n1,200 founders have taken it. 60% finish the full 6 weeks (vs. industry average 4%). Most-cited reason: it's the only writing course where the homework is 30 minutes a week - small enough to actually do, big enough to compound.\n\nIf you've started a 'company blog' 4 times and abandoned it 4 times, the problem isn't your discipline. It's the assumption that writing requires a 3-hour deep work block. It doesn't.\n\nDM me 'next cohort' for the dates. Max 30 students per cohort, runs monthly.",
      summary: "Voice is consistent - strong differentiator. Headline reads like a generic creator headline though, undersells the 30-min hook. About is solid. The biggest miss is the banner (no proof point shown visually) and the call to action (your DMs are open but nobody knows to DM you).",
      recommendations: [
        "Rewrite headline to lead with the 30-min/week hook (provided)",
        "Add banner: '1,200 alumni · 60% completion rate · 30 min/week'",
        "Pin the strongest essay you've ever written - not your most viral",
        "Reply to comments within 4 hours · your readers want a relationship not a broadcast",
        "Stop using LinkedIn document carousels - they look like the gurus you mock",
      ],
    },
    sequence: {
      name: "Jake · 5-touch sequence (bootstrapped founder)",
      steps: [
        { step: 1, channel: "email", delay_days: 0, subject: "founder writing course (30 min/week)",
          body: "Jake,\n\nI noticed you've shipped 4 'company blog' attempts in the last 18 months - 2 on Substack, 2 on your domain. Each one stalled around post #6.\n\nThe problem isn't you. It's that every writing course assumes you have 3 hours a week. You don't.\n\nI run a 6-week course teaching founders to ship 500 useful words in 30 minutes a week. Not a thought-leadership thing. Just the habit. 1,200 alumni, 60% complete it (industry average is 4%).\n\nNext cohort starts in 3 weeks. $400 one-time. Reply 'send the curriculum' if you want me to send the full breakdown.\n\nPriya" },
        { step: 2, channel: "linkedin", delay_days: 2,
          body: "Jake - sent a note about the writing course. Connecting in case email got buried." },
        { step: 3, channel: "email", delay_days: 4, subject: "60% completion · why it matters",
          body: "Quick follow up.\n\nThe number that matters in any course isn't enrollments. It's completions. Industry average for online courses is 4%. Mine is 60%.\n\nReason: the homework is 30 min/week. Not 3 hours. The peer editing is real. The cohort is capped at 30.\n\nIf you've started and abandoned a blog more than twice, this might be the leverage point.\n\nReply 'curriculum' for the breakdown.\n\nPriya" },
        { step: 4, channel: "linkedin", delay_days: 6,
          body: "Followed up on the 60% completion stat. If 'send curriculum' is easier here, just reply. No pitch beyond that." },
        { step: 5, channel: "email", delay_days: 9, subject: "if not now",
          body: "Last note - if writing isn't where you want to put 30 min/week right now, totally get it.\n\nIf it ever becomes a priority, the curriculum's at thefounderletters.com - no email gate.\n\nReply 'stop' to come off the list.\n\nPriya" },
      ],
    },
    blueprint: {
      name: "Founder Letters · daily LinkedIn cadence",
      themes: [
        {
          theme: "Gentle reminders for tired founders",
          frequency: "Mon, Wed, Fri",
          hook_pattern: "Open with 'gentle reminder' or 'unpopular opinion' - never a hook formula.",
          example_post: "Gentle reminder: you don't need to write a viral thread.\n\nYou need to write one essay this week. 500 words. Useful to one person. Honest about something you've actually learned in the last month.\n\nYou don't need an audience to start. The audience is a byproduct of being in public for long enough to be useful.\n\nIf you've been 'planning to start a blog' for more than 6 months, the obstacle isn't strategy. It's permission. Consider this permission.",
        },
        {
          theme: "Quiet mockery of guru content",
          frequency: "Tue",
          hook_pattern: "Quote a real bad tweet, then explain why it's bad.",
          example_post: "Saw a 'creator coach' yesterday selling a $2,000 course on 'how to build a 6-figure newsletter.'\n\nHis newsletter has 1,400 subscribers.\n\nThis is the genre. Someone selling you a map of a place they've never been.\n\nThe actual prerequisites to writing well: 1) read 5 newsletters in your space for 6 months, 2) write 10 essays nobody will read, 3) keep going.\n\nThere's no $2,000 hack for #3.",
        },
        {
          theme: "Tiny essays in public",
          frequency: "Thu",
          hook_pattern: "Just a 200-word essay. No hook. No CTA. Just a thought.",
          example_post: "The first year I tried to be a 'creator' I wrote 47 essays, sent 8 newsletters, and got 12 subscribers.\n\nThe second year I wrote 12 essays. No newsletter. Just published on LinkedIn and my personal site.\n\n2,400 subscribers found me anyway.\n\nThe difference wasn't volume or strategy. The difference was that in year 1 I was writing for an imagined audience. In year 2 I was writing for myself, and one specific person who would either find it or not.\n\nWrite for the second person. Skip the imagined audience.",
        },
      ],
    },
    campaignSteps: [
      "Start",
      "Connect (Jake - saw your last 4 blog attempts)",
      "Wait 2 days",
      "DM after accept (Quick reason I reached out)",
      "Wait 3 days",
      "Follow-up DM (60% completion stat)",
      "Switch to email",
      "End",
    ],
    contentPlanPreview: `# 30-day content plan

## Themes
1. **Gentle reminders for tired founders** - permission to ship small
2. **Quiet mockery of guru content** - the genre, named
3. **Tiny essays in public** - modeling the behavior

## Calendar (week 1 shown)
| Day | Theme | Post angle |
|---|---|---|
| Mon | A | Permission to ship one bad essay this week |
| Tue | B | The 'how to build a 6-fig newsletter' guy has 1,400 subscribers |
| Wed | A | Writing isn't a deep work problem - it's a permission problem |
| Thu | C | Year 1: 47 essays, 12 subscribers. Year 2: 12 essays, 2,400. |
| Fri | A | Your 30-min weekly writing habit, scripted |`,
    agent: {
      name: "Priya's Reply Agent",
      description: "Replies the way Priya does - self-deprecating, honest, never sells aggressively. Escalates anything emotional or any 'I'm stuck' message because those deserve a real human reply.",
      tone_traits: [
        "Self-deprecating, never gurus",
        "Honest, will say 'I don't know'",
        "Mocks corporate-speak gently",
        "Short, present, in the conversation not above it",
      ],
      escalation_triggers: [
        "Prospect mentions burnout, mental health, or 'I'm struggling'",
        "Refund or credit request",
        "Question about a specific essay Priya wrote - handle personally",
        "Comparison to a named competitor course",
      ],
    },
    strategyPreview: `# 60-day plan: sell course seats

## The bet
Bootstrapped founders are saturated with 'authority building' courses and primed for a course that promises the opposite - small, honest, sustainable. Success at day 60 = 25+ paid enrollments for the next cohort.

## Days 1-14: Foundation
- Validate the Jake ICP - 100 LinkedIn profiles, 70%+ should match
- Ship 6 LinkedIn posts (2 per theme), measure DM volume
- Update the landing page with the 60% completion proof point
...`,
  },
];

export const findDemo = (id: string): SandboxDemo | undefined =>
  DEMOS.find((d) => d.id === id);
