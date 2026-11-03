/**
 * Test fixtures for the infographic harness: for each layout a normal spec, a minimal one
 * (counts at the floor, optional parts missing) and a hostile one (text at twice the
 * limits, an unbroken long word, every count at its maximum). Specs are written the way
 * the content stage receives them from a model, so they go through normalizeSpec.
 *
 * Copy is sample copy: the numbers are illustrative.
 */

import type { BrandColors, Identity } from './infographic-kit.js';

export interface Fixture {
  id: string;
  group: 'normal' | 'minimal' | 'hostile';
  spec: unknown;
}

export interface FixtureBrand {
  id: string;
  colors: BrandColors | null;
  identity: Identity;
}

// shape-only logos (no text, so they don't depend on fonts inside an SVG image)
const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const SQUARE_LOGO = svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#1E3A8A"/><circle cx="32" cy="32" r="18" fill="#FFFFFF"/><circle cx="32" cy="32" r="8" fill="#2B59F0"/></svg>');
const WIDE_LOGO = svgUri('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="48" viewBox="0 0 200 48"><rect x="0" y="8" width="32" height="32" rx="8" fill="#F5C518"/><rect x="44" y="14" width="140" height="8" rx="4" fill="#1F2937"/><rect x="44" y="28" width="96" height="8" rx="4" fill="#6B7280"/></svg>');

export const FIXTURE_BRANDS: FixtureBrand[] = [
  {
    id: 'cobalt',
    colors: { primary: '#2B59F0', background: '#F4F2ED', text: '#14161F' },
    identity: { name: 'Jordan Avery', handle: 'northbeam.io', logo: { dataUri: SQUARE_LOGO, aspect: 1 } },
  },
  {
    id: 'sun',
    colors: { primary: '#F5C518', secondary: '#1F2937', background: '#FFFFFF', text: '#111111' },
    identity: { name: 'Priya Raman', handle: '@priyabuilds', logo: { dataUri: WIDE_LOGO, aspect: 200 / 48 } },
  },
  {
    id: 'none',
    colors: null,
    identity: { name: 'Sam Okafor', handle: 'fernway.co' },
  },
];

const LONG = 'Supercalifragilisticexpialidocious-pricing-page-optimisation';
const twice = (s: string) => `${s} ${s}`;

// ============= PYRAMID =============

const PYRAMID_NORMAL = {
  layout: 'pyramid',
  kicker: 'For agency founders running outbound',
  headline: 'The 4 layers under every booked call',
  highlight: 'every booked call',
  sub: 'Build them from the bottom up. The copy is the last thing to fix, not the first.',
  takeaway: { label: 'The rule', text: 'Low replies? Check the layer under the one you want to blame.' },
  data: {
    top: { label: 'The result', name: 'Booked call', line: 'The only layer anyone sees' },
    layers: [
      { name: 'Message', line: 'Short, specific, about them', chips: ['Under 80 words', 'One ask'], metric: { value: '<80', label: 'words in step 1' } },
      { name: 'Offer', line: 'A reason to reply this week', chips: ['One outcome', 'Low-risk first step', 'Proof that fits'], metric: { value: '1 line', label: 'to explain it' } },
      { name: 'Targeting', line: 'The right 500 beat a random 5,000', chips: ['One ICP per campaign', 'A live buying signal', 'Verified emails'], metric: { value: '<3%', label: 'bounce rate' } },
      { name: 'Deliverability', line: 'Nothing above it counts if you land in spam', chips: ['SPF, DKIM, DMARC', '2-3 inboxes per domain', '14 days of warmup'], metric: { value: '95%+', label: 'inbox placement' } },
    ],
    callouts: {
      left: { title: 'Where most start', body: 'Rewriting the copy for the fifth time' },
      right: { title: 'Where it breaks', body: 'Usually layer 1 or 2, out of sight', layer: 2 },
    },
  },
};

const PYRAMID_MINIMAL = {
  layout: 'pyramid',
  kicker: '',
  headline: 'Three layers of trust',
  highlight: 'trust',
  sub: '',
  takeaway: { label: 'Rule', text: 'Earn the bottom layer first.' },
  data: {
    top: { label: '', name: 'Referral', line: '' },
    layers: [
      { name: 'Results', line: 'Clients see the outcome', chips: [], metric: null },
      { name: 'Process', line: 'They see how you work', chips: [], metric: null },
      { name: 'Proof', line: 'They see who else trusts you', chips: [], metric: null },
    ],
    callouts: {},
  },
};

const PYRAMID_HOSTILE = {
  layout: 'pyramid',
  kicker: twice('For agency founders who run outbound themselves'),
  headline: twice('The five layers that sit under every single booked sales call'),
  highlight: 'every single booked sales call',
  sub: twice('Build them from the bottom up, because the copy is always the last thing you should fix and never the first.'),
  takeaway: { label: 'The golden rule here', text: twice('When replies drop, check the layer underneath the one you want to blame before you touch anything else.') },
  data: {
    top: { label: 'The outcome you want', name: 'A booked sales call', line: twice('The only layer anyone outside ever sees') },
    layers: [
      { name: 'The message itself', line: twice(`Short, specific and about them ${LONG}`), chips: ['Under eighty words always', 'Exactly one ask', 'No links at all'], metric: { value: '$1,250,000', label: 'words allowed in the first step' } },
      { name: 'The offer', line: twice('A concrete reason to reply this week'), chips: ['One clear outcome', 'A low-risk first step', 'Proof that actually fits'], metric: { value: '1 line', label: 'to explain the whole thing' } },
      { name: 'Targeting', line: twice('The right five hundred beat a random five thousand'), chips: ['One ICP per campaign', 'A live buying signal', 'Verified emails only'], metric: { value: '<3%', label: 'bounce rate ceiling' } },
      { name: 'List hygiene', line: twice('Clean lists keep every layer above honest'), chips: ['Dedupe weekly', 'Suppress past clients', 'Remove role inboxes'], metric: { value: '0 dupes', label: 'after every import' } },
      { name: 'Deliverability', line: twice('Nothing above it counts if you land in spam'), chips: ['SPF, DKIM, DMARC', '2-3 inboxes per domain', '14 days of warmup'], metric: { value: '95%+', label: 'inbox placement' } },
    ],
    callouts: {
      left: { title: 'Where most people start', body: twice('Rewriting the copy for the fifth time this month') },
      right: { title: 'Where it usually breaks', body: twice('Almost always layer one or two, out of sight'), layer: 1 },
    },
  },
};

// ============= THREE COLUMN =============

const THREE_NORMAL = {
  layout: 'three_column',
  kicker: 'For founders doing their own outbound',
  headline: 'Match the cold email to how warm the lead is',
  highlight: 'how warm the lead is',
  sub: 'Same offer, same list. A different opener, a different ask, and very different odds.',
  takeaway: { label: 'Match it', text: 'Most lists are 80% column one. Write for that, and save the direct ask for people who know you.' },
  data: {
    columns: [
      { title: 'Fits your ICP', sub: 'No signal yet', level: 1 },
      { title: 'Showed a signal', sub: 'Hiring, funding, a new tool', level: 2 },
      { title: 'Knows your name', sub: 'Liked, commented, visited', level: 3, tag: 'Most skip this' },
    ],
    highlight_column: 2,
    rows: [
      { label: "They're thinking", kind: 'text', cells: ['Who is this, and why me?', 'We have this problem right now', "I've seen this person before"] },
      { label: 'Open with', kind: 'text', cells: ['A sharp observation about their business', 'The signal, and what it usually means', 'The post or page they engaged with'] },
      { label: 'First line', kind: 'quote', cells: ['Noticed you sell to clinics, but your site only talks to hospitals.', "Saw you're hiring 3 SDRs. That usually means pipeline is behind plan.", "You liked my post on reply rates, so here's the part I cut."] },
      { label: 'The ask', kind: 'text', cells: ['Can I send a 2-minute teardown?', 'Worth 15 minutes this week?', 'Want the full template?'] },
      { label: 'Follow up', kind: 'text', cells: ['A free teardown, not a bump', 'A second signal, or a peer result', 'The thing they asked for, same day'] },
      { label: 'Expect', kind: 'stat', cells: [{ value: '1-2', label: 'replies per 100 sent' }, { value: '4-6', label: 'replies per 100 sent' }, { value: '10+', label: 'replies per 100 sent' }] },
      { label: 'The play', kind: 'action', cells: ['Earn attention', 'Be timely', 'Be direct'] },
    ],
  },
};

const THREE_MINIMAL = {
  layout: 'three_column',
  kicker: '',
  headline: 'Three ways to price a retainer',
  highlight: 'price',
  sub: '',
  takeaway: { label: 'Pick', text: 'Charge for the outcome you can control.' },
  data: {
    columns: [{ title: 'Hourly', sub: '' }, { title: 'Monthly', sub: '' }, { title: 'Outcome', sub: '' }],
    highlight_column: 2,
    rows: [
      { label: 'You sell', kind: 'text', cells: ['Time', 'Access', 'A result'] },
      { label: 'Client fears', kind: 'text', cells: ['Overruns', 'Idle months', 'Paying for luck'] },
      { label: 'Works when', kind: 'text', cells: ['Scope is unclear', 'Work is steady', 'You own the lever'] },
    ],
  },
};

const THREE_HOSTILE = {
  layout: 'three_column',
  kicker: twice('For founders doing every bit of their own outbound'),
  headline: twice('Match every cold email you send to how warm the lead really is'),
  highlight: 'how warm the lead really is',
  sub: twice('Same offer and same list, but a different opener, a different ask, and very different odds of a reply.'),
  takeaway: { label: 'Match it', text: twice('Most lists are 80% column one, so write for that and save the direct ask for the people who already know you.') },
  data: {
    columns: [
      { title: 'Fits your ideal customer profile', sub: twice('No signal of any kind yet'), level: 1, tag: 'The default for most lists' },
      { title: 'Showed a buying signal', sub: twice('Hiring, funding, a new tool'), level: 2 },
      { title: 'Already knows your name', sub: twice('Liked, commented, visited'), level: 3, tag: 'Most skip this' },
    ],
    highlight_column: 2,
    rows: [
      { label: "What they're thinking", kind: 'text', cells: [twice('Who is this person, and why are they writing to me?'), twice('We have exactly this problem right now'), twice(`I have seen this person before ${LONG}`)] },
      { label: 'Open with', kind: 'text', cells: [twice('A sharp observation about their business'), twice('The signal, and what it usually means'), twice('The post or page they engaged with')] },
      { label: 'First line', kind: 'quote', cells: [twice('Noticed you sell to clinics, but your site only talks to hospitals and that costs you demos.'), twice("Saw you're hiring 3 SDRs. That usually means pipeline is behind plan."), twice("You liked my post on reply rates, so here's the part I cut.")] },
      { label: 'The ask', kind: 'text', cells: [twice('Can I send a two-minute teardown?'), twice('Worth fifteen minutes this week?'), twice('Want the full template?')] },
      { label: 'Follow up', kind: 'text', cells: [twice('A free teardown, not a bump'), twice('A second signal, or a peer result'), twice('The thing they asked for, same day')] },
      { label: 'Expect', kind: 'stat', cells: [{ value: '$1,250,000', label: twice('replies per hundred emails sent') }, { value: '4-6', label: 'replies per 100 sent' }, { value: '10+', label: 'replies per 100 sent' }] },
      { label: 'The play', kind: 'action', cells: ['Earn their attention first', 'Be timely about it', 'Be direct and ask'] },
    ],
  },
};

// ============= REFERENCE SHEET =============

const SHEET_NORMAL = {
  layout: 'reference_sheet',
  kicker: 'Save this before your next campaign',
  headline: 'The cold email cheat sheet',
  highlight: 'cheat sheet',
  sub: 'Every number and rule we check before a sequence goes live.',
  takeaway: { label: 'The rule', text: 'Change one thing per test, and give it 200 sends before you judge it.' },
  data: {
    cards: [
      { kind: 'checklist', title: 'Setup', meta: 'before day 1', items: ['SPF, DKIM and DMARC', '2-3 inboxes per domain', '14+ days of warmup', 'Custom tracking domain', 'Placement test first'] },
      { kind: 'table', title: 'Daily limits', meta: 'per inbox', rows: [['Warm inbox', '30 sends'], ['New inbox, week 1', '10 sends'], ['Follow-ups', 'count too'], ['1,000 sends a day', '11+ domains']] },
      { kind: 'chart', title: 'When to send', meta: 'their time zone', bars: [{ label: 'MON', value: 55 }, { label: 'TUE', value: 92, hot: true }, { label: 'WED', value: 100, hot: true }, { label: 'THU', value: 86, hot: true }, { label: 'FRI', value: 40 }], caption: 'Tue to Thu, 7 to 10am', note: 'Never Monday 9am or Friday 4pm.' },
      { kind: 'steps', title: 'The 4-step sequence', meta: 'stops on reply', steps: [{ tag: 'DAY 0', title: 'Opener', body: 'One observation, one ask', chip: '<80 words' }, { tag: 'DAY 3', title: 'Bump', body: 'One line, same thread', chip: '<20 words' }, { tag: 'DAY 7', title: 'New angle', body: 'Proof or a short case', chip: '<60 words' }, { tag: 'DAY 14', title: 'Breakup', body: 'Close the loop politely', chip: '<40 words' }] },
      { kind: 'stats', title: 'Targets', emphasis: true, stats: [{ value: '3%+', label: 'reply rate' }, { value: '<3%', label: 'bounce rate' }, { value: '<0.1%', label: 'spam complaints' }] },
      { kind: 'examples', title: 'Subject lines', meta: 'lowercase, 2-4 words', lines: [{ text: 'clinics vs hospitals', note: 'Names their problem' }, { text: 'hiring 3 SDRs', note: 'Names their signal' }, { text: 'idea for {company}', note: 'Promises something' }, { text: '{first_name}, quick one', note: 'Reads like a colleague' }] },
      { kind: 'avoid', title: 'Never in step 1', items: ['Links, images or attachments', 'More than one ask', 'A pitch in the first sentence', 'Open tracking on a new domain', 'A calendar link before a reply'] },
      { kind: 'formula', title: 'The first line', meta: 'one sentence each', parts: ['What you noticed', 'What it costs them', 'One small ask'], example: "You sell to clinics, but your site talks to hospitals. That's demos lost. Want a 2-minute teardown?" },
      { kind: 'checklist', title: 'Every Monday', meta: '10 minutes', items: ['Reply rate by step', 'Bounces by list source', 'Inbox placement test'] },
    ],
  },
};

const SHEET_MINIMAL = {
  layout: 'reference_sheet',
  kicker: '',
  headline: 'Before you hit send',
  highlight: 'hit send',
  sub: '',
  takeaway: { label: 'Rule', text: 'Read it out loud once.' },
  data: {
    cards: [
      { kind: 'checklist', title: 'Check', items: ['Their name is right', 'One ask'] },
      { kind: 'avoid', title: 'Cut', items: ['Jargon', 'Links'] },
      { kind: 'stats', title: 'Aim for', stats: [{ value: '<80', label: 'words' }, { value: '1', label: 'question' }] },
      { kind: 'table', title: 'Timing', rows: [['Send', 'Tue 8am'], ['Bump', 'Fri']] },
    ],
  },
};

const SHEET_HOSTILE = {
  layout: 'reference_sheet',
  kicker: twice('Save this before your very next campaign goes live'),
  headline: twice('The complete cold email cheat sheet for agency founders'),
  highlight: 'complete cold email cheat sheet',
  sub: twice('Every single number and rule we check before any sequence goes live, in one place.'),
  takeaway: { label: 'The golden rule', text: twice('Change exactly one thing per test, and give it two hundred sends before you judge the result.') },
  data: {
    cards: [
      { kind: 'checklist', title: 'Domain and inbox setup', meta: 'before day one of sending', items: [twice('SPF, DKIM and DMARC on every single domain'), twice('Two to three inboxes per domain'), twice('Fourteen or more days of warmup'), twice(`Custom tracking domain ${LONG}`), twice('Placement test before launch'), twice('A real signature with a phone number')] },
      { kind: 'table', title: 'Daily sending limits', meta: 'per inbox, per day', rows: [[twice('Warm inbox after warmup'), 'thirty sends daily max'], [twice('New inbox in week one'), '10 sends'], [twice('Follow-ups in the sequence'), 'count too'], ['1,000 sends a day', '11+ domains'], ['Bounce rate', 'under 3%'], ['Spam complaints', 'under 0.1%']] },
      { kind: 'chart', title: 'Best time to send', meta: 'in their time zone', bars: [{ label: 'MON', value: 55 }, { label: 'TUE', value: 92, hot: true }, { label: 'WED', value: 100, hot: true }, { label: 'THU', value: 86, hot: true }, { label: 'FRI', value: 40 }, { label: 'SAT', value: 8 }, { label: 'SUN', value: 12 }], caption: twice('Tuesday to Thursday, seven to ten in the morning'), note: twice('Never on Monday morning or Friday afternoon, ever.') },
      { kind: 'steps', title: 'The five-step sequence', meta: 'stops on any reply', steps: [{ tag: 'DAY 0', title: 'The opener email', body: twice('One observation and exactly one ask'), chip: 'under eighty words' }, { tag: 'DAY 3', title: 'Bump', body: twice('One line in the same thread'), chip: '<20 words' }, { tag: 'DAY 7', title: 'A new angle', body: twice('Proof or a short case study'), chip: '<60 words' }, { tag: 'DAY 10', title: 'Value', body: twice('Send something useful for free') }, { tag: 'DAY 14', title: 'Breakup', body: twice('Close the loop politely'), chip: '<40 words' }] },
      { kind: 'stats', title: 'Weekly targets', emphasis: true, stats: [{ value: '3%+', label: twice('reply rate') }, { value: '<3%', label: 'bounce rate' }, { value: '<0.1%', label: 'spam complaints' }, { value: '$1,250,000', label: 'pipeline' }] },
      { kind: 'examples', title: 'Subject lines that work', meta: 'lowercase, two to four words', lines: [{ text: 'clinics vs hospitals vs everyone else', note: twice('Names their problem') }, { text: 'hiring 3 SDRs', note: 'Names their signal' }, { text: 'idea for {company}', note: 'Promises something' }, { text: '{first_name}, quick one', note: 'Reads like a colleague' }, { text: LONG, note: 'Too long on purpose' }] },
      { kind: 'avoid', title: 'Never in the first step', items: [twice('Links, images or attachments'), 'More than one ask', twice('A pitch in the first sentence'), 'Open tracking on a new domain', 'A calendar link before a reply', twice('Your logo in the signature')] },
      { kind: 'formula', title: 'The first line formula', meta: 'one sentence each part', parts: ['What you noticed about them', 'What it costs them today', 'One small ask', 'A reason it is easy'], example: twice("You sell to clinics, but your site talks to hospitals. That's demos lost every week. Want a 2-minute teardown?") },
      { kind: 'checklist', title: 'Every Monday morning', meta: 'ten minutes, no more', items: [twice('Reply rate by step'), 'Bounces by list source', 'Inbox placement test', 'Pause any inbox under 2%'] },
    ],
  },
};

export const FIXTURES: Fixture[] = [
  { id: 'pyramid-normal', group: 'normal', spec: PYRAMID_NORMAL },
  { id: 'three-column-normal', group: 'normal', spec: THREE_NORMAL },
  { id: 'sheet-normal', group: 'normal', spec: SHEET_NORMAL },
  { id: 'pyramid-minimal', group: 'minimal', spec: PYRAMID_MINIMAL },
  { id: 'three-column-minimal', group: 'minimal', spec: THREE_MINIMAL },
  { id: 'sheet-minimal', group: 'minimal', spec: SHEET_MINIMAL },
  { id: 'pyramid-hostile', group: 'hostile', spec: PYRAMID_HOSTILE },
  { id: 'three-column-hostile', group: 'hostile', spec: THREE_HOSTILE },
  { id: 'sheet-hostile', group: 'hostile', spec: SHEET_HOSTILE },
];
