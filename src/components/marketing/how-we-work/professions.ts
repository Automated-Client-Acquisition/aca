/* ─────────────────────────────────────────────────────────────
   professions.ts, the /how-we-work playbook, per profession.

   Everything profession-specific on the page lives here. To add a
   trade, copy an entry and rewrite the strings, no component
   changes needed. The `slug` becomes the URL (/how-we-work/<slug>)
   so each one is its own indexable playbook page.

   Deliberately no performance numbers in here: every field is a
   description of method or of a signal we can actually observe,
   not a claim about results.
   ───────────────────────────────────────────────────────────── */

export type Profession = {
  slug: string;
  /* Nav + page furniture */
  label: string;        // "Marketing agencies"
  chip: string;         // short switcher label
  who: string;          // "agency owners"
  possessive: string;   // "your agency"
  /* Hero */
  headline: string;     // completes "How <headline> use AI agent infrastructure…"
  /* YouTube id for this playbook's walkthrough. Leave empty and the hero
     renders a placeholder slot instead of an embed. */
  videoId?: string;
  /* The volume claim in the headline. Cedric's number, confirmed 2026-08-04,
     change it here and it changes everywhere, per profession. */
  volume: string;
  lede: string;
  /* The four buying signals we watch for in this market */
  signals: { when: string; why: string }[];
  /* Board node copy */
  board: {
    sources: string;
    icp: string;
    email: string;
    landing: string;
    meeting: string;
    proposal: string;
    signed: string;
  };
  /* Section-level colour */
  offerTests: string;   // what gets A/B'd
  calculator: string;   // what the calculator computes
};

export const PROFESSIONS: Profession[] = [
  {
    slug: "agencies",
    label: "Marketing & creative agencies",
    chip: "Agencies",
    who: "agency owners",
    possessive: "your agency",
    headline: "marketing agencies",
    volume: "100-400 qualified sales meetings",
    lede:
      "You already know how to get results for clients. The hard part is a predictable flow of the right ones, without the founder spending three days a week prospecting.",
    signals: [
      {
        when: "They just hired a marketing manager",
        why: "The budget exists, the team is being built, and somebody new needs a visible win in their first ninety days.",
      },
      {
        when: "They're spending on ads with a broken funnel",
        why: "A live spend you can audit and a specific, provable problem, the easiest first conversation there is.",
      },
      {
        when: "They raised, expanded, or launched a product",
        why: "New money and new markets mean new campaigns, usually before anyone internal has been hired to run them.",
      },
      {
        when: "A competitor started outranking them",
        why: "The most uncomfortable email a founder can get, and the one you can prove in a single screenshot.",
      },
    ],
    board: {
      sources: "Marketing job posts · ad libraries · funding news · review directories · competitor client lists",
      icp: "Size, in-house marketing headcount, live ad spend, sector, whether they already have an agency",
      email: "Free audit vs. teardown vs. benchmark, three offers tested on the same segment",
      landing: "They enter spend and cost per lead, and see what a fixed funnel is worth per month",
      meeting: "The audit call, they arrive having already seen their own numbers",
      proposal: "A scope built from the audit, not a generic retainer deck",
      signed: "A retainer, and the traits the next hundred prospects get scored against",
    },
    offerTests: "audit, teardown, and benchmark offers",
    calculator: "ad spend, cost per lead, and what a fixed funnel is worth per month",
  },
  {
    slug: "b2b-saas",
    label: "B2B SaaS",
    chip: "B2B SaaS",
    who: "founders and sales leaders",
    possessive: "your product",
    headline: "B2B SaaS teams",
    volume: "100-400 qualified sales meetings",
    lede:
      "Your product solves a specific, expensive problem. The job is finding the companies who have it this quarter, before a competitor gets the demo.",
    signals: [
      {
        when: "They posted a role your product makes unnecessary",
        why: "Hiring for a manual process is the cleanest buying signal in B2B. They've already agreed the problem is worth money.",
      },
      {
        when: "They just raised",
        why: "Budget unlocks and the pressure to show growth starts in the same week the round is announced.",
      },
      {
        when: "They're on a tool you displace",
        why: "The entire pitch is the switch, and you already know roughly what they're paying and what annoys them.",
      },
      {
        when: "They crossed a headcount threshold",
        why: "The point where the spreadsheet stops working is predictable, and it's when the category gets bought.",
      },
    ],
    board: {
      sources: "Job boards · funding feeds · tech-stack signals · review-site comparisons · competitor followings · community threads",
      icp: "Headcount, funding stage, current stack, region, and which department owns the budget",
      email: "Pilot vs. migration vs. benchmark, three angles, same segment, the market picks",
      landing: "They enter seats and hours lost, and see the payback period in their own numbers",
      meeting: "A working demo built around the workflow they told us was broken",
      proposal: "A scoped pilot with one success metric and a clean exit",
      signed: "A logo, and the traits every future list gets scored against",
    },
    offerTests: "pilot, migration, and benchmark offers",
    calculator: "seats, hours lost, and the payback period on switching",
  },
  {
    slug: "consultants",
    label: "Consultants & advisory firms",
    chip: "Consultants",
    who: "independent consultants and boutique firms",
    possessive: "your practice",
    headline: "consultants and advisory firms",
    volume: "100-400 qualified sales meetings",
    lede:
      "Referrals are wonderful and unpredictable. This is the other half: a system that finds the companies going through the exact thing you fix, while it's still happening.",
    signals: [
      {
        when: "A leadership change",
        why: "New executives rebuild, and rebuilding is when outside help gets hired, usually in the first two quarters.",
      },
      {
        when: "A funding round, merger, or acquisition",
        why: "Integration work always follows, and internal capacity almost never does.",
      },
      {
        when: "They announced a transformation programme",
        why: "A public commitment with a deadline attached is the most reliable trigger in professional services.",
      },
      {
        when: "They're hiring for the problem you solve",
        why: "They've already decided to spend. The only open question is whether it's a hire or you.",
      },
    ],
    board: {
      sources: "Executive-move announcements · funding and M&A feeds · company news · conference speaker lists · job posts",
      icp: "Revenue band, headcount, sector, and whether the decision maker is an owner or a committee",
      email: "Diagnostic vs. workshop vs. fixed-scope sprint, the entry point that converts fastest takes the volume",
      landing: "They enter team size and the cost of the delay, and see what the problem costs per month",
      meeting: "A diagnostic call, not a pitch, they leave with something either way",
      proposal: "A scoped engagement written from what they actually said, sent the same day",
      signed: "An engagement, and a much sharper definition of who to approach next",
    },
    offerTests: "diagnostic, workshop, and fixed-scope sprint offers",
    calculator: "team size, the cost of delay, and what the problem costs per month",
  },
  {
    slug: "recruiters",
    label: "Recruitment & staffing",
    chip: "Recruiters",
    who: "recruiters and staffing firms",
    possessive: "your desk",
    headline: "recruitment and staffing firms",
    volume: "100-400 qualified sales meetings",
    lede:
      "Every open role is a timed opportunity. The winner is whoever gets to the hiring manager while the vacancy still hurts.",
    signals: [
      {
        when: "A role has been open three weeks",
        why: "The internal process has already failed. That is the moment an outside shortlist stops being an interruption.",
      },
      {
        when: "They're hiring in volume",
        why: "One placement becomes a relationship. Volume hiring is where retained work actually comes from.",
      },
      {
        when: "They just raised",
        why: "Headcount plans get signed off within weeks of a round closing, usually before the roles are even posted.",
      },
      {
        when: "A competitor's team is churning",
        why: "Candidate supply and client demand, visible in the same signal.",
      },
    ],
    board: {
      sources: "Job boards · careers pages · funding announcements · professional networks · churn and layoff signals",
      icp: "Sector, headcount, hiring velocity, role seniority, and whether they have an in-house talent team",
      email: "Shortlist-first vs. retained search vs. contingency, tested per segment",
      landing: "They enter time-to-hire and salary band, and see what the vacancy costs while it stays open",
      meeting: "A role briefing where you already know their market",
      proposal: "Terms, timeline, and a shortlist approach specific to that role",
      signed: "A retained client, and every trait they share becomes a filter",
    },
    offerTests: "shortlist-first, retained, and contingency offers",
    calculator: "time-to-hire, salary band, and the cost of the vacancy staying open",
  },
  {
    slug: "accountants",
    label: "Accounting & bookkeeping firms",
    chip: "Accountants",
    who: "firm owners and partners",
    possessive: "your firm",
    headline: "accounting and bookkeeping firms",
    volume: "100-400 qualified sales meetings",
    lede:
      "Recurring clients are the whole business model. The trick is reaching them in the narrow window when switching is actually on the table.",
    signals: [
      {
        when: "They just incorporated or restructured",
        why: "A new entity needs an accountant, and the window between forming and choosing one is short.",
      },
      {
        when: "They're hiring a finance role",
        why: "The books have outgrown whoever is currently doing them, which is the conversation you want to be in.",
      },
      {
        when: "They raised or took on debt",
        why: "Reporting requirements just changed, and so did the amount of work their current setup can absorb.",
      },
      {
        when: "A filing deadline is approaching in their sector",
        why: "Timing is most of the pitch. The same message lands very differently six weeks before a deadline.",
      },
    ],
    board: {
      sources: "Company registries · funding and grant announcements · finance job posts · industry directories · local listings",
      icp: "Turnover band, entity type, sector, employee count, and whether they already have a firm",
      email: "Free review vs. fixed-fee switch vs. deadline rescue, three entry points, tested",
      landing: "They enter turnover and current fees, and see what switching costs or saves",
      meeting: "A review call with their own numbers already on screen",
      proposal: "Fixed-fee scope, a clear switching plan, and no jargon",
      signed: "A recurring client, the most predictable revenue there is",
    },
    offerTests: "free review, fixed-fee switch, and deadline-rescue offers",
    calculator: "turnover, current fees, and what switching costs or saves",
  },
  {
    slug: "it-msp",
    label: "IT services & MSPs",
    chip: "IT & MSPs",
    who: "MSP owners",
    possessive: "your MSP",
    headline: "IT services firms and MSPs",
    volume: "100-400 qualified sales meetings",
    lede:
      "Seats are won at specific moments, a new site, a bad incident, a contract coming up. Miss the window and you wait a year.",
    signals: [
      {
        when: "They posted an internal IT role",
        why: "They are deciding between hiring and outsourcing right now, and nobody has made the case for outsourcing yet.",
      },
      {
        when: "They opened a new site",
        why: "Infrastructure gets bought at exactly this moment, and rarely thought about again for years.",
      },
      {
        when: "A public security incident hit their sector",
        why: "The budget conversation just became easy, and their board is already asking the question for you.",
      },
      {
        when: "A contract renewal window is visible",
        why: "It is the only period in which switching provider is realistic. Outside it, the best pitch loses.",
      },
    ],
    board: {
      sources: "IT job posts · expansion and office-move news · sector security incidents · tech-stack signals · local directories",
      icp: "Seat count, number of sites, sector, compliance requirements, and current provider",
      email: "Security review vs. seat-based quote vs. co-managed pilot, tested per segment",
      landing: "They enter seat count and current spend, and see the per-seat comparison",
      meeting: "A review call where the risks are already listed",
      proposal: "Per-seat scope with a switching plan and a start date",
      signed: "A contract, and a template for who to target next",
    },
    offerTests: "security review, seat-based quote, and co-managed pilot offers",
    calculator: "seat count, current spend, and the per-seat comparison",
  },
];

/* The un-slugged /how-we-work page. Same machine, generic vocabulary. */
export const GENERIC: Profession = {
  slug: "",
  label: "B2B businesses",
  chip: "Any B2B",
  who: "founders and sales leaders",
  possessive: "your business",
  headline: "B2B businesses",
  volume: "100-400 qualified sales meetings",
  lede:
    "You have heard \"AI agent\" a hundred times and nobody has told you what actually happens. So here is the whole thing, in order, and where a human takes over.",
  signals: [
    {
      when: "They're hiring for the problem you solve",
      why: "They have already agreed the problem is worth money. The only question left is who solves it.",
    },
    {
      when: "They just raised or expanded",
      why: "New budget and new pressure arrive in the same week, usually before anyone has been hired to spend it.",
    },
    {
      when: "They're publicly unhappy with a competitor",
      why: "The switch has already been considered. You are arriving mid-thought instead of cold.",
    },
    {
      when: "Something changed in their business this quarter",
      why: "A new site, a new leader, a new market, change is when budgets reopen and vendors get reconsidered.",
    },
  ],
  board: {
    sources: "LinkedIn activity · job boards · funding & news · maps · review sites · communities · events",
    icp: "5 gates: hard rules → signal freshness → ICP score → exclusions → suppression",
    email: "Secondary domains · warmed inboxes · offers & messages tested against each other",
    landing: "Simulator · calculator · booking form",
    meeting: "Fully briefed: signal, history, research",
    proposal: "Sent same day, shaped to their case",
    signed: "Lookalikes everywhere; filters rewritten from who actually signed",
  },
  offerTests: "several offers and openings",
  calculator: "their own deal size, volume, and constraints",
};

export function findProfession(slug?: string): Profession {
  if (!slug) return GENERIC;
  return PROFESSIONS.find((p) => p.slug === slug) ?? GENERIC;
}
