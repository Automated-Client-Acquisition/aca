import "@/styles/aca-home.css";

/* =============================================================
   STEP 1 · "Pick one painful problem"
   Offer one-pager — looks like a structured doc with fields
   ============================================================= */
export function OfferOnePagerMock() {
  return (
    <div className="pbm-card pbm-offer">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">Offer one-pager · Draft</div>
        </div>
        <span className="pbm-chip pbm-chip--live">Reviewed by ICP</span>
      </div>
      <div className="pbm-offer__body">
        <div className="pbm-offer__field">
          <span className="pbm-offer__lab">Buyer title</span>
          <span className="pbm-offer__val">VP of Talent at staffing agencies (50–500 employees)</span>
        </div>
        <div className="pbm-offer__field">
          <span className="pbm-offer__lab">Painful problem (their words)</span>
          <span className="pbm-offer__val pbm-offer__val--quote">"We're spending 12 hours per role on candidate qualification, 80% don't pass the screen, and our recruiters are burning out."</span>
        </div>
        <div className="pbm-offer__field">
          <span className="pbm-offer__lab">Outcome you'll deliver</span>
          <span className="pbm-offer__val">AI-powered candidate qualification — 12h → 30 min per role, 70% pass-rate</span>
        </div>
        <div className="pbm-offer__field">
          <span className="pbm-offer__lab">Price</span>
          <span className="pbm-offer__val pbm-offer__val--price">$2,500/mo · fixed retainer · no setup fee</span>
        </div>
      </div>
    </div>
  );
}

/* =============================================================
   STEP 2 · "Build a list of 500 right-fit buyers"
   ICP filter builder — left filters, right "500 matching" + sample rows
   ============================================================= */
export function ICPBuilderMock() {
  return (
    <div className="pbm-card pbm-icp">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">List builder · ICP match</div>
        </div>
        <span className="pbm-chip pbm-chip--live">512 matching</span>
      </div>
      <div className="pbm-icp__layout">
        <div className="pbm-icp__filters">
          <div className="pbm-icp__filter-lab">Industry</div>
          <span className="pbm-icp__pill">Staffing & Recruiting</span>
          <div className="pbm-icp__filter-lab">Company size</div>
          <span className="pbm-icp__pill">50–500 employees</span>
          <div className="pbm-icp__filter-lab">Role</div>
          <span className="pbm-icp__pill">VP Talent</span>
          <span className="pbm-icp__pill">Director of Recruiting</span>
          <div className="pbm-icp__filter-lab">Signals (last 30d)</div>
          <span className="pbm-icp__pill pbm-icp__pill--signal">Posted SDR/recruiter role</span>
          <span className="pbm-icp__pill pbm-icp__pill--signal">Hiring spike</span>
        </div>
        <div className="pbm-icp__results">
          <div className="pbm-icp__count"><em>512</em> right-fit buyers</div>
          <div className="pbm-icp__sample">
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--a">B</span><span className="pbm-name">Burnett Search</span></span>
              <span className="pbm-icp__sig">3 roles posted · 12d ago</span>
            </div>
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--b">G</span><span className="pbm-name">Greenway Talent</span></span>
              <span className="pbm-icp__sig">Hiring spike · +14 in 30d</span>
            </div>
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--c">M</span><span className="pbm-name">Meridian Recruiters</span></span>
              <span className="pbm-icp__sig">VP Talent posted role</span>
            </div>
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--d">P</span><span className="pbm-name">Patterson Group</span></span>
              <span className="pbm-icp__sig">5 open recruiter reqs</span>
            </div>
          </div>
          <button className="pbm-icp__cta">Export 512 · enrich + sequence</button>
        </div>
      </div>
    </div>
  );
}

/* =============================================================
   STEP 3 · "Send 50 personalized messages a day"
   Composer — a single draft message with personalization marks + voice match
   ============================================================= */
export function ComposerMock() {
  return (
    <div className="pbm-card pbm-composer">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <span className="pbm-comp__badge pbm-comp__badge--li">in</span>
          <div className="pbm-card__name">DM to <b>Mara at Meridian Recruiters</b></div>
        </div>
        <span className="pbm-chip pbm-chip--live">Voice match · 92%</span>
      </div>
      <div className="pbm-comp__draft">
        Mara — saw you posted <mark className="pbm-comp__mark">3 senior recruiter roles in the last 30 days</mark>.
        We help staffing agencies cut candidate qualification from 12 hours to 30 minutes per role with an AI screening layer. <mark className="pbm-comp__mark">Burnett Search</mark> shipped it in 2 weeks, hit 70% pass-rate.
        <br /><br />
        Worth a 15-min call to compare notes?
        <span className="pbm-comp__sig">— signed as you · approved by autopilot</span>
      </div>
      <div className="pbm-comp__foot">
        <div className="pbm-comp__match">
          <span>Personalized from</span>
          <span className="pbm-comp__src">job posts (3)</span>
          <span className="pbm-comp__src">recent customer</span>
        </div>
        <div className="pbm-comp__btns">
          <button>Edit</button>
          <button>Hold</button>
          <button className="pbm-comp__btn-primary">Send →</button>
        </div>
      </div>
    </div>
  );
}

/* =============================================================
   STEP 4 · "Hold demo calls"
   Calendar — week view with booked slots
   ============================================================= */
export function CalendarMock() {
  return (
    <div className="pbm-card pbm-cal">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">Calendar · this week</div>
        </div>
        <span className="pbm-chip pbm-chip--live">7 demo calls booked</span>
      </div>
      <div className="pbm-cal__grid">
        <div className="pbm-cal__col">
          <div className="pbm-cal__day">Mon</div>
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>10:00</b> Burnett · demo</div>
          <div className="pbm-cal__slot" />
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>14:00</b> Greenway · demo</div>
        </div>
        <div className="pbm-cal__col">
          <div className="pbm-cal__day">Tue</div>
          <div className="pbm-cal__slot" />
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>11:30</b> Meridian · demo</div>
          <div className="pbm-cal__slot" />
        </div>
        <div className="pbm-cal__col">
          <div className="pbm-cal__day">Wed</div>
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>09:30</b> Patterson · demo</div>
          <div className="pbm-cal__slot" />
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>15:00</b> Atlas · close</div>
        </div>
        <div className="pbm-cal__col">
          <div className="pbm-cal__day">Thu</div>
          <div className="pbm-cal__slot" />
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>13:00</b> Halton · demo</div>
          <div className="pbm-cal__slot pbm-cal__slot--booked"><b>16:00</b> Strand · demo</div>
        </div>
        <div className="pbm-cal__col">
          <div className="pbm-cal__day">Fri</div>
          <div className="pbm-cal__slot" />
          <div className="pbm-cal__slot" />
          <div className="pbm-cal__slot pbm-cal__slot--queue">3 pending</div>
        </div>
      </div>
      <div className="pbm-card__foot">
        <span><b>7</b> demos this week · <b>3</b> pending replies</span>
        <span>via ACA Replier</span>
      </div>
    </div>
  );
}

/* =============================================================
   STEP 5 · "Land first 4 clients"
   MRR ticker — shows ramp from $0 → $10k MRR
   ============================================================= */
export function MRRTickerMock() {
  return (
    <div className="pbm-card pbm-mrr">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">MRR · last 60 days</div>
        </div>
        <span className="pbm-chip pbm-chip--live">+ $10,000 / month</span>
      </div>
      <div className="pbm-mrr__hero">
        <div className="pbm-mrr__num"><em>$10,000</em></div>
        <div className="pbm-mrr__lab">recurring · 4 retainers · day 47</div>
      </div>
      <div className="pbm-mrr__list">
        <div className="pbm-mrr__row">
          <span className="pbm-co"><span className="pbm-logo pbm-logo--a">B</span><span className="pbm-name">Burnett Search</span></span>
          <span className="pbm-mrr__amt">$2,500 / mo</span>
          <span className="pbm-stage pbm-stage--booked">Day 14 · paid</span>
        </div>
        <div className="pbm-mrr__row">
          <span className="pbm-co"><span className="pbm-logo pbm-logo--b">G</span><span className="pbm-name">Greenway Talent</span></span>
          <span className="pbm-mrr__amt">$2,500 / mo</span>
          <span className="pbm-stage pbm-stage--booked">Day 22 · paid</span>
        </div>
        <div className="pbm-mrr__row">
          <span className="pbm-co"><span className="pbm-logo pbm-logo--c">M</span><span className="pbm-name">Meridian Recruiters</span></span>
          <span className="pbm-mrr__amt">$2,500 / mo</span>
          <span className="pbm-stage pbm-stage--booked">Day 38 · paid</span>
        </div>
        <div className="pbm-mrr__row">
          <span className="pbm-co"><span className="pbm-logo pbm-logo--d">P</span><span className="pbm-name">Patterson Group</span></span>
          <span className="pbm-mrr__amt">$2,500 / mo</span>
          <span className="pbm-stage pbm-stage--booked">Day 47 · paid</span>
        </div>
      </div>
    </div>
  );
}

/* =============================================================
   STEP 6 / DARK CTA · Personalized Notion playbook
   ============================================================= */
export function NotionPlaybookMock() {
  return (
    <div className="pbm-notion">
      <div className="pbm-notion__bar">
        <div className="pbm-notion__icon">N</div>
        <span className="pbm-notion__name">Your personalized playbook · AI agency · $10k MRR</span>
      </div>
      <div className="pbm-notion__body">
        <div className="pbm-notion__title"><em>From zero to $10k MRR</em> — your 60-day plan.</div>
        <div className="pbm-notion__meta">For: AI agency · Solo · No existing pipeline</div>
        <div className="pbm-notion__h">Day 1–3 · Pick one painful problem</div>
        <div className="pbm-notion__line"><span className="pbm-notion__check pbm-notion__check--done" /> Industry: <b>Staffing agencies (US, 50-500)</b></div>
        <div className="pbm-notion__line"><span className="pbm-notion__check pbm-notion__check--done" /> Outcome: <b>AI candidate qualification</b></div>
        <div className="pbm-notion__line"><span className="pbm-notion__check" /> Buyer title: <b>VP of Talent / Director of Recruiting</b></div>
        <div className="pbm-notion__h">Day 4–7 · Build the 500-name list</div>
        <div className="pbm-notion__line"><span className="pbm-notion__check" /> Open ICP filter in ACA</div>
        <div className="pbm-notion__line"><span className="pbm-notion__check" /> Layer signals: hiring + tech stack</div>
      </div>
    </div>
  );
}

/* =============================================================
   Industry-AGNOSTIC mocks for the master playbook.
   These never reference a specific niche; placeholder language only.
   ============================================================= */

/* Saved Filter / ICP Builder — for chapter 3 */
export function SavedFilterMock() {
  return (
    <div className="pbm-card pbm-icp">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">Leads → Saved Filters → New filter</div>
        </div>
        <span className="pbm-chip pbm-chip--live">487 matching · live signal</span>
      </div>
      <div className="pbm-icp__layout">
        <div className="pbm-icp__filters">
          <div className="pbm-icp__filter-lab">Industry</div>
          <span className="pbm-icp__pill">[Your industry]</span>
          <div className="pbm-icp__filter-lab">Company size</div>
          <span className="pbm-icp__pill">50–500 employees</span>
          <div className="pbm-icp__filter-lab">Role</div>
          <span className="pbm-icp__pill">[Your buyer title]</span>
          <div className="pbm-icp__filter-lab">Buyer signals (last 60d)</div>
          <span className="pbm-icp__pill pbm-icp__pill--signal">New role (90d or less)</span>
          <span className="pbm-icp__pill pbm-icp__pill--signal">Hiring for the role you replace</span>
          <span className="pbm-icp__pill pbm-icp__pill--signal">Posted on your problem</span>
        </div>
        <div className="pbm-icp__results">
          <div className="pbm-icp__count"><em>487</em> right-fit prospects</div>
          <div className="pbm-icp__sample">
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--a">L</span><span className="pbm-name">Lena Kapoor · VP RevOps</span></span>
              <span className="pbm-icp__sig">Started role 41 days ago</span>
            </div>
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--b">D</span><span className="pbm-name">David Wu · Founder</span></span>
              <span className="pbm-icp__sig">Hiring 3 SDRs · 12d ago</span>
            </div>
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--c">M</span><span className="pbm-name">Mara Singh · Head of GTM</span></span>
              <span className="pbm-icp__sig">Posted on your problem · 4d</span>
            </div>
            <div className="pbm-icp__row">
              <span className="pbm-co"><span className="pbm-logo pbm-logo--d">H</span><span className="pbm-name">Hugo Marin · CEO</span></span>
              <span className="pbm-icp__sig">Recent funding · Series A</span>
            </div>
          </div>
          <button className="pbm-icp__cta">Save filter · Researcher takes over →</button>
        </div>
      </div>
    </div>
  );
}

/* Visual Campaign Builder · 6-touch lead-magnet sequence (10 days) — for chapter 7 */
export function CampaignBuilderMock() {
  const nodes = [
    { day: "Day 0", channel: "LinkedIn", action: "Connection request", note: "tease the playbook" },
    { day: "Day 1", channel: "LinkedIn", action: "Lead-magnet DM", note: "offer the doc, no call" },
    { day: "Day 3", channel: "Email", action: "Same offer, new angle", note: "if no LinkedIn reply" },
    { day: "Day 5", channel: "LinkedIn", action: "Soft reminder DM", note: "new specific reason" },
    { day: "Day 7", channel: "Email", action: "One-section email", note: "narrower hook" },
    { day: "Day 10", channel: "Email", action: "Break-up email", note: "doc still available" },
  ];
  return (
    <div className="pbm-card pbm-camp">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">Campaigns → New Campaign → Visual Builder</div>
        </div>
        <span className="pbm-chip pbm-chip--live">Auto-rotation · Restriction-safe</span>
      </div>
      <div className="pbm-camp__flow">
        {nodes.map((n, i) => (
          <div className="pbm-camp__step" key={i}>
            <div className="pbm-camp__node" data-channel={n.channel.toLowerCase()}>
              <div className="pbm-camp__day">{n.day}</div>
              <div className="pbm-camp__chan">
                <span className={`pbm-camp__chan-badge pbm-camp__chan-badge--${n.channel.toLowerCase()}`}>
                  {n.channel === "LinkedIn" ? "in" : "@"}
                </span>
                {n.channel}
              </div>
              <div className="pbm-camp__action">{n.action}</div>
              <div className="pbm-camp__note">{n.note}</div>
            </div>
            {i < nodes.length - 1 && <div className="pbm-camp__connector" aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="pbm-card__foot">
        <span><b>Writer</b> drafts · <b>Sender</b> delivers · <b>Generator</b> fires on yes</span>
        <span>Voice match · 92%</span>
      </div>
    </div>
  );
}

/* Unibox + 5 AI Agents — for chapter 7 */
export function UniboxMock() {
  const replies = [
    { from: "Lena Kapoor", co: "VP RevOps · Hartwood", body: "Send me more info, interested but timing is tight Q2.", status: "AI handled", sub: "value summary + 30d retouch sent", tone: "ai" },
    { from: "David Wu", co: "Founder · Wendover", body: "Yes, send a slot. Tuesday afternoons work best.", status: "Booked-meeting auto-flag", sub: "Tuesday 2:00pm · dossier attached", tone: "booked" },
    { from: "Mara Singh", co: "Head of GTM · Plenum", body: "Got budget approved last week, but procurement wants a security review first. Possible?", status: "Escalated to you", sub: "12-min wait · multi-stakeholder", tone: "esc" },
    { from: "Hugo Marin", co: "CEO · Ardent Labs", body: "Wrong person, talk to our COO Sarah, copying her.", status: "AI handled", sub: "warm intro requested · parked", tone: "ai" },
  ];
  return (
    <div className="pbm-card pbm-unibox">
      <div className="pbm-card__bar">
        <div className="pbm-card__bar-l">
          <div className="pbm-card__icon">a<span style={{ opacity: 0.7 }}>.</span></div>
          <div className="pbm-card__name">Unibox · AI Replier handles 80%</div>
        </div>
        <span className="pbm-chip pbm-chip--live">12 escalated · 47 resolved · today</span>
      </div>
      <div className="pbm-unibox__list">
        {replies.map((r, i) => (
          <div className={`pbm-unibox__row pbm-unibox__row--${r.tone}`} key={i}>
            <div className="pbm-unibox__head">
              <div className="pbm-unibox__from">
                <span className="pbm-unibox__name">{r.from}</span>
                <span className="pbm-unibox__co">{r.co}</span>
              </div>
              <span className={`pbm-unibox__status pbm-unibox__status--${r.tone}`}>{r.status}</span>
            </div>
            <div className="pbm-unibox__body">"{r.body}"</div>
            <div className="pbm-unibox__sub">{r.sub}</div>
          </div>
        ))}
      </div>
      <div className="pbm-card__foot">
        <span>Researcher · Writer · Sender · Generator · Replier · Scheduler</span>
        <span>6 agents · one queue</span>
      </div>
    </div>
  );
}
