/**
 * Mailbox Warmup Engine — pairing, ramp curve, and message generation.
 *
 * This is the piece ACA never had. `_shared/email-warmup.ts` (which this sits
 * alongside) only ever computed a *cold-send* daily_limit from calendar days; it
 * issues no sends. This module drives the real mailbox-to-mailbox mesh that
 * builds sending reputation.
 *
 * Two ramps exist and must not be confused:
 *   - `email-warmup.ts` / warmup_daily_rampup → how many COLD emails a mailbox may
 *     send per day as it matures. Governs `email_mailboxes.daily_limit`.
 *   - this module / MESH_RAMP_STEP → how many WARMUP emails a mailbox sends into
 *     the mesh per day. Governs nothing but warmup traffic.
 * They share only the `warmup_max_daily` ceiling.
 */

// ============================================================================
// Ramp curve
// ============================================================================

/** Warmup sends on day 0 (a mailbox's first day of verified warmup activity). */
export const MESH_RAMP_START = 2;

/**
 * Max mesh warmup sends per sending domain per day, once the domain has ramped.
 * Receivers judge reputation on the DOMAIN's aggregate volume (Microsoft throttles
 * on it, Gmail scores it), so per-mailbox quotas are not enough: twenty boxes each
 * inside their own quota can still put 100+ sends/day on one domain. Campaign mail
 * already has per-inbox caps; this bound is for warmup traffic only.
 */
export const DOMAIN_DAILY_MESH_CAP = 50;

/**
 * A new domain starts at 10 warmup sends/day and gains 2 per warmup day, reaching
 * the cap on day 20. Before this the cap was flat, so a domain connected with 100
 * mailboxes sent ~95 on its very first day (nearu.business, 2026-08-19): each
 * mailbox ramped from 1/day, but nothing ramped the domain.
 */
export const DOMAIN_MESH_RAMP_START = 10;
export const DOMAIN_MESH_RAMP_STEP = 2;

/**
 * `domainWarmupDay` is the highest warmup_day among the domain's mailboxes: that
 * mailbox's confirmed-delivered days are the domain's sending history, and a mailbox
 * added to an established domain should not drag it back to day 0.
 */
export function domainMeshCapFor(domainWarmupDay: number): number {
  return Math.min(
    DOMAIN_DAILY_MESH_CAP,
    DOMAIN_MESH_RAMP_START + Math.max(0, domainWarmupDay) * DOMAIN_MESH_RAMP_STEP,
  );
}

/**
 * UTC hours the mesh sends in. Each mailbox's sends for the day are placed at
 * random times inside this window (see meshSendsDueBy). Before this, every mailbox
 * got its full quota the moment the UTC day rolled over, so the whole estate's
 * warmup went out in the first minute after midnight (555 sends in hour 0,
 * none after, on 2026-09-28): the least human sending pattern there is.
 *
 * UTC rather than the org's timezone on purpose: the daily count it is compared
 * against (warmup_today_counts) resets at UTC midnight, and a local window that
 * straddles it would hand a mailbox its quota twice.
 */
export const MESH_WINDOW_START_UTC_HOUR = 13;
export const MESH_WINDOW_END_UTC_HOUR = 22;

/**
 * Daily receive budget for a Gmail seed inbox (tag 'warmup-seed'), released evenly
 * across the UTC day by pick_warmup_partners. Seeds are the mesh's only Gmail
 * receivers, so they take more than an ordinary mailbox's 3, but a personal inbox
 * taking 100+ strangers' mail a day (what they got before 2026-09-28) reads as spam
 * to Gmail and skews the placement they exist to measure.
 */
export const SEED_MAX_RECEIVES_PER_DAY = 20;

/**
 * Additional warmup sends permitted per verified warmup day.
 *
 * Deliberately NOT `warmup_daily_rampup` (default 5) — that column ramps the cold
 * daily_limit. At +2/day a mailbox reaches the default warmup_max_daily of 40 in
 * 20 days, which is the ~3-week ramp mailbox reputation actually needs. A +5/day
 * curve would hit 40 in 8 days and defeat the purpose.
 */
export const MESH_RAMP_STEP = 2;

/** Never send warmup to the same partner mailbox more often than this. */
export const PAIR_COOLDOWN_DAYS = 7;

/** Ceiling on warmup mail a single mailbox may RECEIVE per day. */
// Was 60. Warmup exists to keep a sending history, not to add volume: at the
// 3-5 cold emails/day these inboxes run, anything above a few warmup messages a
// day IS the traffic, and a runaway here is what got a tenant blocked outright.
export const MAX_WARMUP_RECEIVES_PER_DAY = 3;

/**
 * Share of a mailbox's daily_limit that warmup may consume.
 *
 * Warmup is a SLICE of the mailbox's infra allocation, never an addition to it.
 * It used to be neither: `warmup_max_daily` (5) and `daily_limit` (3-5) were two
 * independent budgets with nothing reconciling them, so a mailbox rated for 3
 * sends/day was cleared for 3 genuine + 5 warmup = 8, and warmup alone was
 * allocated 167% of the genuine allowance. Genuine mail is the point of the
 * estate; warmup is overhead that must fit inside it.
 */
export const WARMUP_SHARE_OF_DAILY_LIMIT = 0.2;

export interface WarmupMailbox {
  id: string;
  tags?: string[] | null;
  organization_id: string;
  email_address: string;
  display_name: string | null;
  provider: string | null;
  status: string;
  sending_domain_id: string | null;
  warmup_day: number;
  warmup_max_daily: number | null;
  warmup_reply_rate_target: number | null;
  warmup_daily_reply_target: number | null;
  warmup_weekdays_only: boolean | null;
  warmup_randomize: boolean | null;
  warmup_randomize_range: number | null;
  warmup_tag: string | null;
  metadata: Record<string, unknown> | null;
  /** The mailbox's total daily send allocation — genuine mail AND warmup share it. */
  daily_limit: number | null;
  /** Genuine sends already made today. Only trustworthy if daily_sent_reset_at is today. */
  daily_sent: number | null;
  daily_sent_reset_at: string | null;
  /** Last warmup send. Orders who gets a domain's shared budget first. */
  warmup_last_send_at?: string | null;
}

/** Today in UTC as YYYY-MM-DD, matching how resetDailyCounters stamps the column. */
function utcToday(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Genuine sends this mailbox has already made today.
 *
 * `daily_sent` is zeroed by a separate resetDailyCounters job, not by a trigger, so
 * between midnight and that job's next run the column still holds YESTERDAY's total.
 * Reading it blindly would let a stale count zero out warmup's headroom every morning.
 */
function genuineSentToday(mb: Pick<WarmupMailbox, 'daily_sent' | 'daily_sent_reset_at'>): number {
  if (mb.daily_sent_reset_at !== utcToday()) return 0;
  return mb.daily_sent ?? 0;
}

/**
 * The most warmup mail this mailbox may send today, before the ramp is applied.
 *
 * Two independent guards, because they fail differently. The share keeps warmup a
 * minority of the allocation even on an idle day; the headroom check makes genuine
 * mail win outright on a busy one. Neither alone is enough: share-only would still
 * stack on top of a mailbox that already spent its allocation, and headroom-only
 * would hand warmup the entire allocation whenever campaigns happened not to run.
 */
export function warmupCeilingFor(mb: Pick<WarmupMailbox, 'daily_limit' | 'daily_sent' | 'daily_sent_reset_at' | 'warmup_max_daily'>): number {
  const allocation = mb.daily_limit ?? 30;
  const share = Math.max(1, Math.floor(allocation * WARMUP_SHARE_OF_DAILY_LIMIT));
  const headroom = Math.max(0, allocation - genuineSentToday(mb));
  return Math.min(mb.warmup_max_daily ?? 40, share, headroom);
}

/**
 * How many warmup emails this mailbox should send today.
 *
 * `warmup_day` is the count of distinct days with a CONFIRMED-DELIVERED warmup
 * send (see the trg_warmup_send_rollup trigger). So the ramp only advances when
 * warmup is genuinely working — if delivery verification breaks, the quota stops
 * climbing instead of silently pretending progress, which is the exact failure
 * mode this whole engine exists to end.
 */
/** Absolute ceiling on warmup sends per mailbox per day, whatever the ramp or daily_limit say. */
export const WARMUP_HARD_MAX_SENDS_PER_DAY = 3;
export const SEED_REPLY_RATE_PCT = 70;
export const SEED_MAX_REPLIES_PER_DAY = 15;
export function isWarmupSeed(mb: Pick<WarmupMailbox, 'tags'>): boolean {
  return (mb.tags ?? []).includes('warmup-seed');
}

/** A seed answers 10-90 minutes after delivery, never instantly. Stable per message. */
export function seedReplyDelayMs(sendId: string): number {
  return (10 + hash01(`${sendId}:reply-delay`) * 80) * 60_000;
}

/** Absolute ceiling on warmup replies per mailbox per day. */
export const WARMUP_HARD_MAX_REPLIES_PER_DAY = 2;

export function meshQuotaForDay(mb: WarmupMailbox): number {
  const ceiling = warmupCeilingFor(mb);
  let quota = Math.min(MESH_RAMP_START + mb.warmup_day * MESH_RAMP_STEP, ceiling);

  if (mb.warmup_randomize && (mb.warmup_randomize_range ?? 0) > 0) {
    const range = mb.warmup_randomize_range ?? 3;
    // Seeded per mailbox per day, not Math.random(): the tick runs every 5 minutes,
    // and a quota re-rolled each run drifts toward its top value and moves the
    // mailbox's send times around (meshSendsDueBy places slots by quota).
    quota += Math.floor(hash01(`${mb.id}:${utcToday()}:quota`) * (range * 2 + 1)) - range;
  }

  // Floors at 0, NOT at 1. The old `Math.max(1, ...)` meant a mailbox that had
  // already spent its entire allocation on genuine mail still sent warmup on top,
  // which is the whole behaviour this ceiling exists to prevent.
  return Math.max(0, Math.min(quota, ceiling, WARMUP_HARD_MAX_SENDS_PER_DAY));
}

/**
 * How many of today's `quota` sends this mailbox should have made by `now`.
 *
 * The window is cut into `quota` equal slices and each send is placed at a random
 * point in its own slice, so sends are spread out and never bunch together. The
 * points are hashed from mailbox + date + slot, so every 5-minute tick agrees on
 * them without storing a schedule. Compare against sent_today: the difference is
 * what the mailbox may send this tick. Past the window everything is due, so a send
 * that failed during the day still gets retried before midnight.
 */
export function meshSendsDueBy(mailboxId: string, quota: number, now: Date = new Date()): number {
  if (quota <= 0) return 0;
  const day = now.toISOString().split('T')[0];
  const dayStart = Date.parse(`${day}T00:00:00Z`);
  const start = dayStart + MESH_WINDOW_START_UTC_HOUR * 3_600_000;
  const end = dayStart + MESH_WINDOW_END_UTC_HOUR * 3_600_000;
  const t = now.getTime();
  if (t < start) return 0;
  if (t >= end) return quota;

  const slice = (end - start) / quota;
  let due = 0;
  for (let i = 0; i < quota; i++) {
    if (start + (i + hash01(`${mailboxId}:${day}:${i}`)) * slice <= t) due++;
  }
  return due;
}

/** Deterministic value in [0, 1) from a string (FNV-1a, 32-bit). */
function hash01(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4_294_967_296;
}

/**
 * How many of today's delivered warmup emails should receive a reply.
 *
 * Stochastically rounded, and that matters. Plain rounding silently disables
 * replies for the entire early ramp: at the default 20% rate a mailbox receiving
 * 1–2 emails/day yields round(0.2) = 0, so no reply is ever sent — verified in the
 * first pilot, which produced 0 replies from 6 delivered messages. Early warmup is
 * exactly when two-way engagement carries the most reputation weight.
 *
 * Taking the fractional part as a probability makes the long-run rate converge on
 * the configured target while still producing occasional replies at low volume.
 */
export function replyQuotaForDay(mb: WarmupMailbox, deliveredToday: number): number {
  // Gmail seeds are the mesh's only read on Gmail placement, and Gmail weights
  // replies far above opens, so they answer most of what they receive instead of
  // the 20% / 2-a-day that suits ordinary mailboxes.
  if (isWarmupSeed(mb)) {
    const expected = (deliveredToday * SEED_REPLY_RATE_PCT) / 100;
    const whole = Math.floor(expected);
    const quota = whole + (Math.random() < expected - whole ? 1 : 0);
    return Math.max(0, Math.min(quota, SEED_MAX_REPLIES_PER_DAY));
  }
  const ratePct = mb.warmup_reply_rate_target ?? 20;
  const cap = mb.warmup_daily_reply_target ?? 8;

  const expected = (deliveredToday * ratePct) / 100;
  const whole = Math.floor(expected);
  const quota = whole + (Math.random() < expected - whole ? 1 : 0);

  return Math.max(0, Math.min(quota, cap, WARMUP_HARD_MAX_REPLIES_PER_DAY));
}

/**
 * Read one column of warmup_today_counts for the given mailboxes.
 *
 * Lives here because BOTH ticks gate on these numbers and both must read them with
 * identical truncation semantics — the send tick caps daily sends, the receive tick
 * caps daily replies, and a quiet under-read on either side over-sends.
 *
 * Chunked strictly below PostgREST's db-max-rows = 1000 cap, which applies to
 * set-returning RPCs and not only to table selects. Called unscoped, this RPC
 * returns one row per mailbox that sent OR received today — 2,506 rows on
 * 2026-08-10 — so 1,506 mailboxes came back absent, were read as having sent 0,
 * and were handed their full quota again on every 5-minute tick. That produced
 * 63,682 sends in one day against a configured cap of 5 per mailbox.
 *
 * A full chunk is asserted rather than trusted: a truncated response is byte-for-byte
 * indistinguishable from a genuinely full one. Throwing stalls the mesh for a single
 * tick; trusting it over-sends for a day.
 */
export async function warmupCountsFor(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  ids: string[],
  column: 'sent_today' | 'received_today' | 'replies_today' | 'delivered_in',
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase.rpc('warmup_today_counts', { p_mailbox_ids: slice });
    if (error) throw new Error(`warmup_today_counts failed: ${error.message}`);
    const rows = (data || []) as Array<Record<string, string | number>>;
    if (rows.length >= 1000) {
      throw new Error(
        `warmup_today_counts returned ${rows.length} rows for a ${slice.length}-mailbox chunk — ` +
        'at or over the PostgREST row cap, so the quota read cannot be trusted',
      );
    }
    for (const r of rows) out.set(r.mailbox_id as string, Number(r[column] ?? 0));
  }
  return out;
}

/** Mon–Fri check in the given timezone (mirrors email-warmup.ts::isValidSendDay). */
export function isWarmupSendDay(weekdaysOnly: boolean, timezone = 'UTC'): boolean {
  if (!weekdaysOnly) return true;
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .formatToParts(new Date());
  const day = weekdayMap[parts.find((p) => p.type === 'weekday')?.value || 'Mon'] ?? 1;
  return day >= 1 && day <= 5;
}

// ============================================================================
// Partner selection
// ============================================================================
//
// Partner selection itself lives in Postgres — see pick_warmup_partners() in
// migration 20260803140000. It is NOT done here on purpose: doing it client-side
// requires pulling the whole mailbox pool into the edge function, and an
// unbounded PostgREST select silently returns only the first 1000 rows. During
// the first live pilot that invisibly hid 1,358 of 2,358 mailboxes from the mesh
// and produced sends from only the 3 of 6 pilot mailboxes that happened to fall
// inside the window, with no error raised.
//
// The preference order the RPC implements (cross-org, then cross-domain, then
// least-loaded recipient, then random tie-break) is documented alongside it.
// The two constants below are passed to that RPC as parameters.

// ============================================================================
// Message generation
// ============================================================================

/**
 * Warmup traffic has to look like ordinary business correspondence. Spam filters
 * score on content, so a fleet exchanging one identical string would train the
 * exact reputation we are trying to build — downward.
 *
 * NOTE: never put a `Re:`-prefixed subject in here. These are FIRST messages in a
 * thread, and a cold message posing as a reply is a well-known spam heuristic —
 * it would actively cost us reputation, which is the opposite of the point.
 * Genuine replies get their prefix from buildWarmupReply().
 */
const SUBJECTS = [
  'Quick question about next week', 'Following up on our chat', 'Notes from this morning',
  'Sending this over as promised', 'Draft ready for review', 'Availability {day}?',
  'Short update', 'One thing I forgot to mention', 'Recap + next steps',
  'Checking in before {day}', 'Revised numbers below', 'Thoughts on the proposal',
  'Scheduling the handover', 'Quick favour', 'Update on the account',
  'Are we still on for {day}?', 'Re-sending the agenda', 'Can you confirm the time?',
  'Venue for {day}', 'Slight change of plan', 'Invoice question', 'Pushing our call to {day}',
  'Before the {day} meeting', 'Two small things', 'Agenda for {day}', 'Follow-up from yesterday',
  'Contract wording', 'Quick sanity check', 'Next steps on our side', 'Anything you need from me?',
  'Catching up', 'Timeline for the rollout', 'Photos from the site visit', 'Summary of our call',
  'Question on the quote', 'Final details', 'Heads up on {day}', 'Parking and access',
  'Budget check-in', 'Intro to the team',
];

const OPENERS = [
  'Hope your week is going well.', 'Thanks for getting back to me so quickly.',
  'Just picking this back up after the weekend.', 'Sorry for the slow reply on this one.',
  'Good speaking earlier.', 'Hope you had a good break.', 'Quick one from my side.',
  'Hope all is well with you.', 'Thanks again for your time yesterday.',
  'Apologies for the late note.', 'Following on from our conversation.',
  'Hi again.', 'Hope the week has started well.', 'Trust you are well.',
  'Wanted to get this to you before I forget.', 'Just a short note.',
];

const BODY_SENTENCES = [
  'I went through the notes and everything looks in order on our side.',
  'We are on track for the dates we discussed.',
  'Nothing is blocking at the moment, so no action is needed from you right now.',
  'I made a couple of small edits to the summary, mostly wording and nothing structural.',
  'Let me know what times suit you later this week and I will send an invite across.',
  'The updated figures came in this morning and they line up with the earlier estimate.',
  'I have asked the team to pull the remaining details together.',
  'Everything is signed off on our end.',
  'We are still waiting on the final confirmation before we move ahead.',
  'I can do {day} afternoon if that works for you.',
  'Would {time} on {day} suit you, or is another slot better?',
  'I have attached nothing yet, but the document is nearly finished.',
  'The supplier confirmed delivery for {day}.',
  'I spoke with the others and they are happy with the plan.',
  'If it is easier we can handle this over a quick call instead.',
  'The numbers moved by about {pct} percent compared with last month.',
  'I will be out of the office on {day}, so let us aim for before then.',
  'Could you double check the dates on your side?',
  'It would help to have your thoughts before {day}.',
  'The draft is in a good place, I only need your sign-off.',
  'Two of the items on the list are already done.',
  'I will chase the remaining ones tomorrow morning.',
  'There was a small delay on the paperwork but it is sorted now.',
  'We should have a clearer picture by {day}.',
  'I have kept the same structure as last time so it is easy to compare.',
  'Happy to adjust anything that does not look right.',
  'I have looped in the person who handles scheduling.',
  'The room is booked from {time}, with the usual setup.',
  'I think we are close, just one open question left.',
  'Thanks for flagging that, I had missed it.',
  'It all seems straightforward from here.',
  'I will confirm once I hear back from the office.',
];

const CLOSERS = [
  'Thanks,', 'Best,', 'Cheers,', 'Speak soon,', 'Kind regards,', 'All the best,',
  'Regards,', 'Many thanks,', 'Talk soon,', 'Warm regards,', 'Thank you,', 'Take care,',
];

const REPLY_LEADS = [
  'Thanks for this.', 'Perfect.', 'Got it, thanks.', 'Appreciate the update.',
  'Great, thanks.', 'Thanks for the quick note.', 'Understood.', 'That is helpful.',
  'Brilliant.', 'Thanks for sending.', 'Makes sense.', 'Good to know.',
];

const REPLY_SENTENCES = [
  'Looks good to me, nothing further from my side.',
  'That works, I will keep an eye out for the final version.',
  'Agreed on the approach, let us go ahead.',
  '{day} works better for me if that is still open.',
  'I will follow up if anything changes on our end.',
  'Thanks for turning this around so quickly.',
  'I will pass it on to the team today.',
  'Could we say {time} instead?',
  'No concerns here, happy to proceed.',
  'Let me check my diary and come back to you.',
  'That fits with what I had in mind.',
  'I will get back to you once I have spoken to the others.',
  'All fine at this end.',
  'Just one small question, but it can wait until {day}.',
  'Please go ahead and send the invite.',
  'I will have a proper look this afternoon.',
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'tomorrow', 'next week'];
const TIMES = ['9:30', '10am', '11:15', '1pm', '2:30', '3pm', '4:45'];

function fillSlots(text: string): string {
  return text
    .replace(/\{day\}/g, () => pick(DAYS))
    .replace(/\{time\}/g, () => pick(TIMES))
    .replace(/\{pct\}/g, () => String(2 + Math.floor(Math.random() * 14)));
}

/** n distinct items from arr, in random order. */
function pickMany<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface WarmupMessage {
  subject: string;
  html: string;
  text: string;
}

/**
 * The warmup tag is what keeps this traffic out of every customer's inbox:
 * `detectWarmup()` scans the body for it and both pollers then skip CRM creation
 * entirely (email-imap-poller/index.ts:446, workers/imap-poller/src/index.ts:792).
 *
 * The marker is the message's own `wm_` correlation ref (see newWarmupRef), printed
 * as a visible "Ref:" line. It varies on every send, so unlike the old constant
 * 'smartlead-warmup' string (a known third-party warmup fingerprint, hidden in a
 * display:none div) there is nothing fixed for a spam filter to learn. detectWarmup()
 * matches /wm_[0-9a-f]{24}/ and still honours the legacy tag for mail already sent.
 */
function tagFooter(warmupRef: string): { html: string; text: string } {
  return {
    html: `<p style="font-size:11px;color:#8a8a8a">Ref: ${warmupRef}</p>`,
    text: `\n\nRef: ${warmupRef}\n`,
  };
}

export function buildWarmupMessage(
  senderName: string,
  warmupRef: string,
): WarmupMessage {
  const footer = tagFooter(warmupRef);
  // Roughly one in four messages skips the greeting line, and the body is one to
  // three sentences, so length and shape vary as well as wording.
  const opener = Math.random() < 0.75 ? pick(OPENERS) : null;
  const sentences = pickMany(BODY_SENTENCES, 1 + Math.floor(Math.random() * 3)).map(fillSlots);
  const paragraphs = Math.random() < 0.5 || sentences.length < 2
    ? [sentences.join(' ')]
    : [sentences[0], sentences.slice(1).join(' ')];
  const closer = pick(CLOSERS);
  const parts = [...(opener ? [opener] : []), ...paragraphs];

  return {
    subject: fillSlots(pick(SUBJECTS)),
    text: `${parts.join('\n\n')}\n\n${closer}\n${senderName}${footer.text}`,
    html:
      `<div>${parts.map((p) => `<p>${p}</p>`).join('')}<p>${closer}<br>${senderName}</p></div>${footer.html}`,
  };
}

export function buildWarmupReply(
  senderName: string,
  warmupRef: string,
  originalSubject: string,
): WarmupMessage {
  const footer = tagFooter(warmupRef);
  const lead = pick(REPLY_LEADS);
  const rest = pickMany(REPLY_SENTENCES, 1 + Math.floor(Math.random() * 2)).map(fillSlots);
  const body = `${lead} ${rest.join(' ')}`;
  const closer = pick(CLOSERS);

  return {
    subject: originalSubject.toLowerCase().startsWith('re:')
      ? originalSubject
      : `Re: ${originalSubject}`,
    text: `${body}\n\n${closer}\n${senderName}${footer.text}`,
    html: `<div><p>${body}</p><p>${closer}<br>${senderName}</p></div>${footer.html}`,
  };
}

/**
 * Correlation token, emitted as the custom `x-aca-warmup-id` header.
 *
 * Graph sendMail returns 202 Accepted with no Message-Id, so the receive tick
 * cannot match a send to its received copy by Message-Id. It matches on
 * (sender address + exact subject + receive-time window) and confirms with this
 * token when the header survives transport.
 */
export function newWarmupRef(): string {
  return `wm_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export const WARMUP_HEADER = 'x-aca-warmup-id';
