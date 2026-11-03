import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Profession } from "./professions";

/* ─────────────────────────────────────────────────────────────
   LoopBoard, the whole acquisition machine drawn on a whiteboard.

   Two stacked layers over a whiteboard surface:
     · an SVG "ink" layer that draws every frame, box and arrow
       through a turbulence/displacement filter, so the strokes
       wobble like a marker instead of a vector tool;
     · an HTML text layer sitting exactly on top, so the words
       stay crisp and selectable and the boxes stay clickable.

   Geometry is authored on a strict 6 × 5 grid (see below) and
   scaled to fit, inline it fits the column width, expanded it
   fits the viewport. Node rects and edge point-lists are hand
   placed against that grid: move a box and you move the edges
   anchored to it. Routing is deliberate (buses run outside the
   frames, dead-end chips hang below their gate).
   ───────────────────────────────────────────────────────────── */

export type StageKey =
  | "find"
  | "qualify"
  | "enrich"
  | "reach"
  | "amplify"
  | "convert"
  | "compound";

/* ── The layout ────────────────────────────────────────────────
   Six columns, and rows that mean something rather than just
   stacking. The shape of the diagram is the argument:

     · TWO LANES IN. Outbound (top) and inbound (bottom) run as
       parallel rows through columns 1-2, then both arrows converge
       on one point: the ICP gate. Same filter, both lanes.
     · ONE FUNNEL. Columns 3-4 sit on a middle line between the two
       lanes, so the merge and the split are symmetrical.
     · TWO CHANNELS OUT. Email (top) and LinkedIn (bottom) split
       back apart in column 5, then converge again on one question
       in column 6: did they reply?
     · THEN IT FORKS. No reply drops to the paid row; a reply skips
       it. Both land on the same person, and the conversation runs
       back leftward along the convert row.

   Long-haul edges use dedicated channels (x = 1505 / 1528 right,
   x = 20 left) so nothing wanders across the middle. Move a box and
   you move the edges anchored to it. */
const BOARD_W = 1560;
const BOARD_H = 1120;
/* Inline the board is a readable preview; full screen is where it is
   meant to be read, so it may scroll sideways on small viewports. */
const MIN_SCALE = 0.6;

const C1 = 40, C2 = 285, C3 = 530, C4 = 775, C5 = 1020, C6 = 1265;
const NW = 200, NH = 126;
const E1 = C1 + NW, E2 = C2 + NW, E3 = C3 + NW,
      E4 = C4 + NW, E5 = C5 + NW, E6 = C6 + NW;
const X1 = C1 + NW / 2, X2 = C2 + NW / 2, X3 = C3 + NW / 2,
      X4 = C4 + NW / 2, X5 = C5 + NW / 2, X6 = C6 + NW / 2;

/* Rows. RA/RB are the two parallel lanes; RM is the line exactly
   between them, where they merge. */
const R0 = 46, H0 = 108;              // set up once
const RA = 190;                       // lane A, outbound
const RM = 276;                       // the merge line
const RB = 362;                       // lane B, inbound
const RC = 548;                       // no reply, paid
const RD = 730;                       // the conversation
const RE = 906;                       // after the meeting
const M0 = R0 + H0 / 2, MA = RA + NH / 2, MM = RM + NH / 2,
      MB = RB + NH / 2, MC = RC + NH / 2, MD = RD + NH / 2,
      ME = RE + NH / 2;
const DH = 78;                        // decision height
const DA = MM - DH / 2;               // decision on the merge line
const DD = MD - DH / 2;               // decision on the convert line
const CHIP_Y = 416, CHIP_H = 42;      // the two dead-end chips
const J12 = 507, J45 = 997, J56 = 1242;   // merge/split junction channels
const BUS_A = 1505, BUS_B = 1528, BUS_L = 20;
const RET = RE + NH + 50;             // the return line along the bottom

/* "drop" = a muted dead-end chip (rejected / parked), not clickable.
   "inbound" = the lead-magnet lane, which belongs to no single stage. */
type NodeKind = StageKey | "drop" | "inbound";

type Node = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  stage: NodeKind;
  step?: string;
  /* Decision nodes are drawn as flowchart hexagons, not boxes. */
  kind?: "decision";
  title: string;
  sub?: string;
};

const NODES: Node[] = [
  /* ── Set up once, directly above the agent it becomes ──── */
  {
    id: "setup", x: C2, y: R0, w: NW, h: H0,
    stage: "find", step: "01",
    title: "Agent on your VPS",
    sub: "Hermes or Claude · secured · skills + agents installed · Telegram-connected",
  },

  /* ── Lane A: outbound ──────────────────────────────────── */
  {
    id: "sources", x: C1, y: RA, w: NW, h: NH,
    stage: "find", step: "02",
    title: "Public sources",
    sub: "Job posts · funding & news · maps · review sites · communities",
  },
  {
    id: "hermes", x: C2, y: RA, w: NW, h: NH,
    stage: "find", step: "02",
    title: "Hermes builds your list",
    sub: "Scrapes, matches, dedupes, and keeps running after the first build",
  },

  /* ── Lane B: inbound ───────────────────────────────────── */
  {
    id: "magnet", x: C1, y: RB, w: NW, h: NH,
    stage: "inbound", step: "08",
    title: "LinkedIn lead magnet",
    sub: "Useful enough that only the right person asks for it",
  },
  {
    id: "capture", x: C2, y: RB, w: NW, h: NH,
    stage: "inbound", step: "09",
    title: "Capture + instant delivery",
    sub: "Same ICP gates, then a conversation starter, not a thank-you page",
  },

  /* ── Both lanes merge here ─────────────────────────────── */
  {
    id: "icp", x: C3, y: RM, w: NW, h: NH,
    stage: "qualify", step: "03",
    title: "ICP verification",
    sub: "5 gates: hard rules → freshness → ICP score → exclusions → suppression",
  },
  {
    id: "enrich", x: C4, y: RM, w: NW, h: NH,
    stage: "enrich", step: "04",
    title: "Enrichment waterfall",
    sub: "Right person, verified route. Provider 1 → 2 → 3, verified independently",
  },
  { id: "drop-icp", x: C3, y: CHIP_Y, w: NW, h: CHIP_H, stage: "drop",
    title: "Rejected (reason logged)" },
  { id: "drop-enrich", x: C4, y: CHIP_Y, w: NW, h: CHIP_H, stage: "drop",
    title: "No verified route. Parked" },

  /* ── Then split back into two channels ─────────────────── */
  {
    id: "email", x: C5, y: RA, w: NW, h: NH,
    stage: "reach", step: "05",
    title: "Email sequencer",
    sub: "Secondary domains · warmed inboxes · 10 sequences testing offers",
  },
  {
    id: "linkedin", x: C5, y: RB, w: NW, h: NH,
    stage: "reach", step: "06",
    title: "LinkedIn campaign",
    sub: "Visit → connect → message, paced like a person",
  },

  /* ── And converge on one question ──────────────────────── */
  {
    id: "replied", x: C6, y: DA, w: NW, h: DH,
    stage: "convert", kind: "decision",
    title: "Replied?",
    sub: "no → the ads audience · yes → check intent",
  },

  /* ── No reply: the paid row ────────────────────────────── */
  {
    id: "audiences", x: C6, y: RC, w: NW, h: NH,
    stage: "amplify", step: "10",
    title: "Ads audiences",
    sub: "Hashed to match format first → LinkedIn · Meta · Google",
  },
  {
    id: "landing", x: C5, y: RC, w: NW, h: NH,
    stage: "amplify", step: "11",
    title: "Landing page",
    sub: "Simulator · calculator · booking form",
  },

  /* ── The conversation, right to left ───────────────────── */
  {
    id: "positive", x: C6, y: DD, w: NW, h: DH,
    stage: "convert", kind: "decision",
    title: "Positive intent?",
    sub: "not now / wrong person / OOO → back to the audience",
  },
  {
    id: "human", x: C5, y: RD, w: NW, h: NH,
    stage: "convert", step: "12",
    title: "A human takes over",
    sub: "Every reply stops the automation, everywhere, at once",
  },
  {
    id: "booked", x: C4, y: RD, w: NW, h: NH,
    stage: "convert", step: "13",
    title: "Meeting booked",
    sub: "Qualified, briefed, and passed back to the agent and the ad platforms",
  },
  {
    id: "pre", x: C3, y: RD, w: NW, h: NH,
    stage: "convert", step: "15",
    title: "Pre-meeting sequence",
    sub: "Confirm, prep, and no-show recovery if it slips",
  },
  {
    id: "meeting", x: C2, y: RD, w: NW, h: NH,
    stage: "convert",
    title: "The meeting",
    sub: "Fully briefed: signal, history, research",
  },
  {
    id: "proposal", x: C1, y: RD, w: NW, h: NH,
    stage: "reach", step: "16",
    title: "Summary + custom proposal",
    sub: "Sent same day, shaped to their case",
  },

  /* ── After the meeting, left to right ──────────────────── */
  {
    id: "post", x: C1, y: RE, w: NW, h: NH,
    stage: "reach", step: "17",
    title: "Post-meeting sequence",
    sub: "Runs until a yes or a clean no",
  },
  {
    id: "signed", x: C2, y: RE, w: NW, h: NH,
    stage: "compound", step: "18",
    title: "Signed",
    sub: "The best targeting data you will ever own",
  },
  {
    id: "seed", x: C3, y: RE, w: NW, h: NH,
    stage: "compound",
    title: "Seed audience + sharper ICP",
    sub: "Lookalikes everywhere; filters rewritten from who actually signed",
  },
];

type Frame = { x: number; y: number; w: number; h: number; label: string; stage: NodeKind };

const FRAMES: Frame[] = [
  { x: C2 - 16, y: R0 - 16, w: NW + 32, h: H0 + 32, label: "Set up once", stage: "find" },
  { x: C1 - 16, y: RA - 16, w: E2 - C1 + 32, h: NH + 32, label: "Outbound", stage: "find" },
  { x: C1 - 16, y: RB - 16, w: E2 - C1 + 32, h: NH + 32, label: "Inbound", stage: "inbound" },
  { x: C3 - 16, y: RM - 16, w: E4 - C3 + 32, h: CHIP_Y + CHIP_H - RM + 32, label: "Qualify + enrich", stage: "qualify" },
  { x: C5 - 16, y: RA - 16, w: E6 - C5 + 32, h: RB + NH - RA + 32, label: "Reach, then decide", stage: "reach" },
  { x: C5 - 16, y: RC - 16, w: E6 - C5 + 32, h: NH + 32, label: "No reply → paid", stage: "amplify" },
  { x: C1 - 16, y: RD - 16, w: E6 - C1 + 32, h: NH + 32, label: "Convert", stage: "convert" },
  { x: C1 - 16, y: RE - 16, w: E3 - C1 + 32, h: NH + 32, label: "After the meeting", stage: "compound" },
];

/* Two notes, in the open band the layout leaves in the middle. */
const STICKIES: { x: number; y: number; w: number; text: string; tilt: number }[] = [
  {
    x: C1 + 24, y: RC - 4, w: 330, tilt: -1.1,
    text: "Left of the gates, a record is cheap. Right of them, every send spends domain reputation, which you can't buy back quickly. That's why most of the list gets thrown away.",
  },
  {
    x: C3 - 26, y: RC - 8, w: 350, tilt: 0.9,
    text: "The conversation is the one step that never gets automated. Everything else on this board exists to put a real person in front of the right person, at the moment they have the problem.",
  },
];

type Edge = { pts: [number, number][]; stage: NodeKind; dashed?: boolean; thick?: boolean };

const EDGES: Edge[] = [
  /* set it up once, and it becomes the thing in the row below */
  { pts: [[X2, R0 + H0], [X2, RA]], stage: "find" },

  /* lane A, outbound */
  { pts: [[E1, MA], [C2, MA]], stage: "find" },
  /* lane B, inbound */
  { pts: [[E1, MB], [C2, MB]], stage: "inbound" },

  /* BOTH LANES MERGE on one point: the same gate */
  { pts: [[E2, MA], [J12, MA], [J12, MM], [C3, MM]], stage: "find" },
  { pts: [[E2, MB], [J12, MB], [J12, MM], [C3, MM]], stage: "inbound" },

  /* the funnel */
  { pts: [[E3, MM], [C4, MM]], stage: "qualify" },
  { pts: [[X3, RM + NH], [X3, CHIP_Y]], stage: "drop", dashed: true },
  { pts: [[X4, RM + NH], [X4, CHIP_Y]], stage: "drop", dashed: true },

  /* then split back apart into the two channels */
  { pts: [[E4, MM], [J45, MM], [J45, MA], [C5, MA]], stage: "enrich" },
  { pts: [[E4, MM], [J45, MM], [J45, MB], [C5, MB]], stage: "enrich" },

  /* and converge again on one question */
  { pts: [[E5, MA], [J56, MA], [J56, MM], [C6, MM]], stage: "reach" },
  { pts: [[E5, MB], [J56, MB], [J56, MM], [C6, MM]], stage: "reach" },

  /* NO REPLY, the common case: down into the audience, then the page */
  { pts: [[X6, DA + DH], [X6, RC]], stage: "convert" },
  { pts: [[C6, MC], [E5, MC]], stage: "amplify" },

  /* REPLIED: skip the paid row entirely and check intent */
  { pts: [[E6, MM], [BUS_A, MM], [BUS_A, MD], [E6, MD]], stage: "convert" },

  /* booked off the page, or positive on the phone: the same person */
  { pts: [[X5, RC + NH], [X5, RD]], stage: "amplify" },
  { pts: [[C6, MD], [E5, MD]], stage: "convert" },

  /* the conversation runs back leftward */
  { pts: [[C5, MD], [E4, MD]], stage: "convert" },
  { pts: [[C4, MD], [E3, MD]], stage: "convert" },
  { pts: [[C3, MD], [E2, MD]], stage: "convert" },
  { pts: [[C2, MD], [E1, MD]], stage: "convert" },

  /* down a row, then left to right again */
  { pts: [[X1, RD + NH], [X1, RE]], stage: "reach" },
  { pts: [[E1, ME], [C2, ME]], stage: "reach" },
  { pts: [[E2, ME], [C3, ME]], stage: "compound" },


  /* customers seed the lookalike audiences */
  { pts: [[E3, ME], [BUS_B, ME], [BUS_B, MC], [E6, MC]], stage: "compound", dashed: true },

  /* and the loop closes: what signed rewrites what we look for */
  {
    pts: [[X3, RE + NH], [X3, RET], [BUS_L, RET], [BUS_L, MA], [C1, MA]],
    stage: "compound",
    dashed: true,
    thick: true,
  },
];



/* Marker inks. Literal hex rather than CSS vars so the SVG filter and
   the fill-opacity washes behave identically everywhere. */
const INK: Record<NodeKind, string> = {
  find: "#1F5FA8",
  qualify: "#0E8074",
  enrich: "#3F8B25",
  reach: "#C06A10",
  amplify: "#7040B8",
  convert: "#D8341B",
  compound: "#A6862F",
  inbound: "#B03B72",
  drop: "#9A9485",
};

/* What a box says when you open it. Keyed by node id, the board
   stays skimmable, the detail is one click away, and in full screen
   this is the only way to read it (the page panel is behind the
   overlay). */
const DETAIL: Record<string, string> = {
  sources:
    "Hermes doesn't start from a bought database. It watches the places where companies show, in public, that they have the problem you solve, and it keeps watching after the first build, so the list grows every week instead of ageing.",
  setup:
    "Set up once, then it runs. A VPS of your own, hardened before anything else goes on it, then the toolkit installed and wired together: source watchers, enrichment connectors, scoring agents, sequencer bridges. Hermes drives it, and so can Claude or any MCP-native client. Connected to Telegram so you can just talk to it.",
  hermes:
    "Hermes runs on a VPS of your own, always on, locked down, with its skills, dependencies and agents installed, and connected to Telegram so you can just talk to it. Everything it finds is matched and deduplicated into one record per company, carrying the reason it was picked up.",
  icp:
    "Five gates in order, cheapest first: hard rules, then signal freshness, then a scored read of the company, then exclusions, then suppression. A record has to pass all five, and every rejection is logged with its reason, so the funnel is auditable rather than mysterious.",
  enrich:
    "Providers run in sequence, each covering the others' blind spots and each only charged when it actually returns something. Then every address is verified independently. A failure restarts the search rather than being quietly sent to.",
  magnet:
    "The inbound lane. Something genuinely useful, given away on LinkedIn, and designed so that the wrong person doesn't bother asking for it in the first place.",
  capture:
    "It captures the request and delivers instantly, then scores them against the same ICP gates the outbound list gets. Raising a hand doesn't make someone a fit. Strong fits reach a person the same day, because hand-raisers decay in hours.",
  email:
    "The volume channel, and the one that fails if the infrastructure isn't built first. Separate warmed domains, paced per mailbox, with a hard suppression check before every single send.",
  linkedin:
    "The credibility channel. Slower and lower volume, but far higher acceptance, and it makes the email read as a follow-up instead of a cold hit.",
  audiences:
    "Every contact it enriches also becomes an ad audience. Addresses get turned into a fingerprint first, so the platform only ever receives a fingerprint it can match, never a readable contact file.",
  landing:
    "Every ad on every platform points here. Not a brochure, a simulator and a calculator that runs their numbers, with the booking form on the same page at the moment the maths lands.",
  replied:
    "Most people never reply. That's not a dead end, it's the whole reason the paid layer exists. No reply means the record drops into the ads audience and keeps seeing you until it is ready. A reply skips all of that and goes straight to an intent check.",
  positive:
    "Interested goes to a person, immediately, with the full thread and the reason they were picked. Out of office, wrong person, or not right now goes back into the audience rather than into a bin, because \"not now\" is a timing problem and the ads keep running.",
  human:
    "The hard line. A reply stops every sequence that person is in, everywhere, at once, and a person picks it up with the full context already assembled: why they were picked, what was sent, what they said.",
  booked:
    "Not a lead and not an MQL. A time on a calendar with someone who has a budget, a problem, and a reason to talk about it this month.",
  pre: "The gap between booking and the call is where most meetings quietly die, so it gets its own sequence: confirmation, context so they arrive prepared, relevant proof, and recovery if it slips.",
  meeting:
    "Your person walks in knowing why this company was picked, what was sent, and what they replied. One goal: leave with a defined next step.",
  proposal:
    "Sent while the conversation is still warm, a written recap in their own words, and a proposal built around what they actually said rather than a generic template.",
  post: "Deals stall for ordinary reasons. Follow-up runs on its own, paced rather than nagging, with objection-specific material, until there is a yes or a clean no.",
  signed:
    "A signed client is the highest-quality targeting data you will ever own: a real example of who actually buys, instead of who you guessed would.",
  seed: "Customers seed lookalikes across every platform, and the traits they share rewrite the ICP filters. The next round targets better than this one because it was built from outcomes rather than assumptions.",
};

const STAGE_NAME: Record<StageKey, string> = {
  find: "Find",
  qualify: "Qualify",
  enrich: "Enrich",
  reach: "Reach",
  amplify: "Amplify",
  convert: "Convert",
  compound: "Compound",
};

/* A colour key, not a sequence: the numbers on the boxes are the
   playbook steps, these are what each colour means. */
const LEGEND: { stage: StageKey; label: string }[] = [
  { stage: "find", label: "Find" },
  { stage: "qualify", label: "Qualify" },
  { stage: "enrich", label: "Enrich" },
  { stage: "reach", label: "Reach" },
  { stage: "amplify", label: "Paid" },
  { stage: "convert", label: "Convert" },
  { stage: "compound", label: "Compound" },
];

/* ── Wide-screen spread ────────────────────────────────────────
   The board is authored at 1200 × 1030 (≈1.17:1). A full screen is
   closer to 2:1, so fitting it by height leaves most of the width
   empty. Rather than keep a second hand-tuned layout, we stretch
   the GAPS between the five columns and leave the columns alone.

   makeSpread(g) is piecewise linear with slope 1 inside every
   column, so a box's width (gx(x+w) − gx(x)) is unchanged, and a
   steep slope across the gaps, so elbows and buses sitting between
   columns stay proportionally placed in the widened gap.

   The gap itself is derived from the viewport's aspect (see `gap`
   below) so the board fills the screen WITHOUT costing scale: a
   fixed gap would fill a 2:1 monitor nicely and shrink the type on
   a 16:10 laptop. */
const MAX_GAP = 260;
const identityX = (x: number) => x;

function makeSpread(g: number): (x: number) => number {
  if (g <= 0) return identityX;
  const pts: [number, number][] = [
    [0, 0],
    [C1, C1], [E1, E1],                          // column 1
    [C2, C2 + g], [E2, E2 + g],                  // column 2
    [C3, C3 + 2 * g], [E3, E3 + 2 * g],          // column 3
    [C4, C4 + 3 * g], [E4, E4 + 3 * g],          // column 4
    [C5, C5 + 4 * g], [E5, E5 + 4 * g],          // column 5
    [C6, C6 + 5 * g], [E6, E6 + 5 * g],          // column 6
    [BOARD_W, BOARD_W + 5 * g],
  ];
  return (x: number) => {
    if (x <= 0) return x;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
    const [lx, ly] = pts[pts.length - 1];
    return ly + (x - lx);
  };
}

/* Orthogonal polyline → SVG path with rounded corners. */
function roundedPath(pts: [number, number][], r = 12): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    // Shrink the corner radius when a segment is too short to carry it.
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const rr = Math.min(r, inLen / 2, outLen / 2);
    const t1x = cx - Math.sign(cx - px) * rr;
    const t1y = cy - Math.sign(cy - py) * rr;
    const t2x = cx + Math.sign(nx - cx) * rr;
    const t2y = cy + Math.sign(ny - cy) * rr;
    d += ` L ${t1x} ${t1y} Q ${cx} ${cy} ${t2x} ${t2y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

export function LoopBoard({
  active,
  onPick,
  profession,
}: {
  active: StageKey;
  onPick: (s: StageKey) => void;
  profession: Profession;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: BOARD_W, h: BOARD_H });
  const [full, setFull] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /* User zoom, multiplied onto whatever scale fits the container. */
  const [zoom, setZoom] = useState(1);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [full]);

  /* Full screen only. Widen the board until its aspect matches the
     space available, so it fills the screen at the same scale the
     compact layout would have managed, capped, because past MAX_GAP
     the arrows get long enough to stop reading as one machine.
     Rounded to 10 so a resize drag doesn't rebuild geometry per pixel. */
  const availW = box.w - 24;
  const availH = box.h - 12;
  const gap =
    full && availW / Math.max(availH, 1) > 1.3
      ? Math.round(
          Math.min(MAX_GAP, Math.max(0, ((BOARD_H * availW) / availH - BOARD_W) / 5)) / 10
        ) * 10
      : 0;
  const boardW = BOARD_W + 5 * gap;

  /* Inline: fit the column width, with a readability floor.
     Expanded: fit the whole board inside the viewport, but never
     below the floor, so on a phone it stays legible and pans. */
  const fitScale = full
    ? Math.max(MIN_SCALE, Math.min(availW / boardW, availH / BOARD_H))
    : Math.min(1, Math.max(box.w / boardW, MIN_SCALE));
  const scale = Math.min(3, Math.max(0.25, fitScale * zoom));
  const atFit = Math.abs(zoom - 1) < 0.001;

  /* Geometry, remapped through the spread when it applies. Widths fall
     out of the mapping itself; frames are anchored 12px off their
     content so their padding survives the stretch. */
  const geo = useMemo(() => {
    const gx = makeSpread(gap);
    return {
      nodes: NODES.map((n) => ({ ...n, x: gx(n.x), w: gx(n.x + n.w) - gx(n.x) })),
      frames: FRAMES.map((f) => {
        const l = gx(f.x + 12) - 12;
        const r = gx(f.x + f.w - 12) + 12;
        return { ...f, x: l, w: r - l };
      }),
      edges: EDGES.map((e) => ({
        ...e,
        pts: e.pts.map(([x, y]) => [gx(x), y] as [number, number]),
      })),
      stickies: STICKIES.map((s) => ({ ...s, x: gx(s.x) })),
      loopNoteX: gx(C1 + 150),
    };
  }, [gap]);

  /* Escape closes the open card first, then the expanded board. */
  useEffect(() => {
    if (!full && !openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openId) setOpenId(null);
      else setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, openId]);

  /* Full screen always opens fitted, not at whatever the inline zoom was. */
  useEffect(() => { setZoom(1); }, [full]);

  /* The page behind the expanded board stays put. */
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [full]);

  const openCard = openId ? NODES.find((n) => n.id === openId) ?? null : null;

  const nodeCopy = useCallback(
    (n: Node) => {
      const o = profession.board;
      const sub =
        n.id === "sources" ? o.sources
        : n.id === "icp" ? o.icp
        : n.id === "email" ? o.email
        : n.id === "landing" ? o.landing
        : n.id === "meeting" ? o.meeting
        : n.id === "proposal" ? o.proposal
        : n.id === "seed" ? o.signed
        : n.sub;
      return sub;
    },
    [profession]
  );

  return (
    <div className={"hw-wb" + (full ? " hw-wb--full" : "")}>
      {/* marker rail / controls */}
      <div className="hw-wb__head">
        <span className="hw-wb__title">The board</span>
        <div className="hw-wb__keys">
          {LEGEND.map((l) => (
            <button
              key={l.stage}
              type="button"
              className={"hw-key" + (active === l.stage ? " hw-key--on" : "")}
              style={{ ["--c" as string]: INK[l.stage] }}
              onClick={() => onPick(l.stage)}
            >
              <i />
              {l.label}
            </button>
          ))}
          <button
            type="button"
            className="hw-key"
            style={{ ["--c" as string]: INK.inbound }}
            onClick={() => setOpenId("magnet")}
          >
            <i />
            Inbound
          </button>
        </div>
        <button
          type="button"
          className="hw-wb__expand"
          onClick={() => setFull((f) => !f)}
          aria-label={full ? "Close full screen" : "Expand board to full screen"}
        >
          {full ? "✕ Close" : "⤢ Full screen"}
        </button>
      </div>

      <div className="hw-board" ref={wrapRef}>
        {/* The sizer carries the POST-scale dimensions. Without it the
            scaled canvas still reserves its full 1200px of layout width
            and the container scrolls past the end of the board. */}
        <div
          className="hw-board__sizer"
          style={{ width: boardW * scale, height: BOARD_H * scale }}
        >
          <div
            className="hw-board__canvas"
            style={{ width: boardW, height: BOARD_H, transform: `scale(${scale})` }}
          >
            {/* ── ink layer: everything that looks drawn ───────── */}
            <svg
              className="hw-ink"
              width={boardW}
              height={BOARD_H}
              viewBox={`0 0 ${boardW} ${BOARD_H}`}
              aria-hidden="true"
            >
              <defs>
                {/* the wobble that turns vectors into marker strokes */}
                <filter id="hw-rough" x="-3%" y="-3%" width="106%" height="106%">
                  <feTurbulence
                    type="fractalNoise"
                    baseFrequency="0.022"
                    numOctaves="3"
                    seed="7"
                    result="noise"
                  />
                  <feDisplacementMap
                    in="SourceGraphic"
                    in2="noise"
                    scale="3.2"
                    xChannelSelector="R"
                    yChannelSelector="G"
                  />
                </filter>
                {(Object.keys(INK) as NodeKind[]).map((s) => (
                  <marker
                    key={s}
                    id={`hw-nib-${s}`}
                    markerWidth="10"
                    markerHeight="10"
                    refX="7"
                    refY="3.4"
                    orient="auto"
                  >
                    <path d="M0,0 L7.5,3.4 L0,6.8 z" fill={INK[s]} />
                  </marker>
                ))}
              </defs>

              <g filter="url(#hw-rough)">
                {/* lane frames */}
                {geo.frames.map((f) => (
                  <rect
                    key={f.label}
                    x={f.x} y={f.y} width={f.w} height={f.h}
                    fill={INK[f.stage]}
                    fillOpacity={0.035}
                    stroke={INK[f.stage]}
                    strokeOpacity={0.5}
                    strokeWidth={1.6}
                    strokeDasharray="10 8"
                    strokeLinecap="round"
                  />
                ))}

                {/* boxes, and hexagons for the decisions */}
                {geo.nodes.map((n) => {
                  const drop = n.stage === "drop";
                  const on = !drop && n.stage !== "inbound" && active === n.stage;
                  const common = {
                    fill: on ? INK[n.stage] : "#FFFFFF",
                    fillOpacity: on ? 0.14 : drop ? 0 : 0.7,
                    stroke: INK[n.stage],
                    strokeOpacity: drop ? 0.55 : 1,
                    strokeWidth: drop ? 1.4 : on ? 3.2 : 2.4,
                    strokeDasharray: drop ? "7 6" : undefined,
                    strokeLinecap: "round" as const,
                    strokeLinejoin: "round" as const,
                  };
                  if (n.kind === "decision") {
                    const { x, y, w, h } = n;
                    const c = 18; // corner chamfer, so it reads as a decision
                    return (
                      <path
                        key={n.id}
                        d={`M ${x + c} ${y} L ${x + w - c} ${y} L ${x + w} ${y + h / 2} L ${x + w - c} ${y + h} L ${x + c} ${y + h} L ${x} ${y + h / 2} Z`}
                        {...common}
                      />
                    );
                  }
                  return (
                    <rect
                      key={n.id}
                      x={n.x} y={n.y} width={n.w} height={n.h}
                      rx={3}
                      {...common}
                    />
                  );
                })}

                {/* arrows */}
                {geo.edges.map((e, i) => (
                  <path
                    key={i}
                    d={roundedPath(e.pts)}
                    fill="none"
                    stroke={INK[e.stage]}
                    strokeWidth={e.thick ? 2.8 : e.dashed ? 1.8 : 2.4}
                    strokeDasharray={e.dashed ? (e.thick ? "10 7" : "7 6") : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={`url(#hw-nib-${e.stage})`}
                    opacity={e.stage === "drop" ? 0.65 : 0.92}
                  />
                ))}
              </g>
            </svg>

            {/* ── text layer: crisp, clickable ─────────────────── */}
            {geo.frames.map((f) => (
              <span
                key={f.label}
                className="hw-lanetag"
                style={{ left: f.x + 14, top: f.y - 11, ["--c" as string]: INK[f.stage] }}
              >
                {f.label}
              </span>
            ))}

            {geo.stickies.map((s, i) => (
              <div
                key={i}
                className="hw-sticky"
                style={{ left: s.x, top: s.y, width: s.w, transform: `rotate(${s.tilt}deg)` }}
              >
                {s.text}
              </div>
            ))}

            <span className="hw-loopnote" style={{ left: geo.loopNoteX, top: RET - 12 }}>
              the loop closes, signed clients rebuild the list
            </span>

            {geo.nodes.map((n) => {
              const isDrop = n.stage === "drop";
              const isInbound = n.stage === "inbound";
              const on = !isDrop && !isInbound && active === n.stage;
              const Tag = isDrop ? "div" : "button";
              return (
                <Tag
                  key={n.id}
                  {...(isDrop
                    ? {}
                    : { type: "button" as const, onClick: () => setOpenId(n.id) })}
                  className={
                    "hw-box" +
                    (isDrop ? " hw-box--drop" : "") +
                    (n.kind === "decision" ? " hw-box--dec" : "") +
                    (on ? " hw-box--on" : "")
                  }
                  style={{
                    left: n.x, top: n.y, width: n.w, height: n.h,
                    ["--c" as string]: INK[n.stage],
                  }}
                >
                  {n.step && <span className="hw-box__step">{n.step}</span>}
                  <span className="hw-box__title">{n.title}</span>
                  {nodeCopy(n) && <span className="hw-box__sub">{nodeCopy(n)}</span>}
                </Tag>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── the enlarged card ───────────────────────────────────
          A sibling of the scroll container, not a child of it: the
          board pans sideways on small screens, and an overlay inside
          it would pan with the content. Outside the scaled canvas
          too, so its type is full size whatever the board is zoomed
          to. */}
      {openCard && (
          <div
            className="hw-zoom"
            role="dialog"
            aria-modal="true"
            aria-label={openCard.title}
            onClick={() => setOpenId(null)}
          >
            <article
              className="hw-zoom__card"
              style={{ ["--c" as string]: INK[openCard.stage] }}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="hw-zoom__top">
                <span className="hw-zoom__tag">
                  {openCard.step ? `Stage ${openCard.step} · ` : ""}
                  {openCard.stage === "inbound"
                    ? "Inbound lane"
                    : STAGE_NAME[openCard.stage as StageKey]}
                </span>
                <button
                  type="button"
                  className="hw-zoom__x"
                  onClick={() => setOpenId(null)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </header>
              <h3 className="hw-zoom__h">{openCard.title}</h3>
              {nodeCopy(openCard) && (
                <p className="hw-zoom__sub">{nodeCopy(openCard)}</p>
              )}
              {DETAIL[openCard.id] && (
                <p className="hw-zoom__body">{DETAIL[openCard.id]}</p>
              )}
            </article>
          </div>
        )}

      <div className="hw-wb__tray">
        {full ? (
          <span className="hw-wb__hint">Esc to close</span>
        ) : (
          <>
            <span className="hw-wb__hint">Click any box to open it</span>
            <span className="hw-wb__hint hw-wb__hint--sm">
              Drag sideways, or open full screen
            </span>
          </>
        )}
        <div className="hw-zoombar">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="hw-zoombar__pct"
            onClick={() => setZoom(1)}
            title="Reset to fit"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, z * 1.25))}
            aria-label="Zoom in"
          >
            +
          </button>
          {!atFit && (
            <button type="button" className="hw-zoombar__fit" onClick={() => setZoom(1)}>
              Fit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
