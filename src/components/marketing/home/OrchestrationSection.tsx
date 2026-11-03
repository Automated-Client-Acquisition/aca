import { MODULES } from "./data";
import {
  LeadFinderMock,
  ComposerMock,
  InboxMock,
  EngagementCaptureMock,
  CalendarOverlapMock,
} from "./mocks";

const MOCK_MAP: Record<string, JSX.Element> = {
  "01": <LeadFinderMock />,
  "02": <ComposerMock />,
  "03": <EngagementCaptureMock />,
  "04": <InboxMock />,
  "05": <CalendarOverlapMock />,
};

export function OrchestrationSection() {
  return (
    <section id="mechanism" className="section section--mechanism">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">The mechanism</span>
          <h2 className="h-section">
            Find &amp; contact <em>high-intent leads with AI</em><span className="dot">.</span>
          </h2>
          <p className="lead">
            Five things ACA does for you. Together they're the whole system: find the buyers, reach them, run inbound, handle replies, book meetings. Your AI directs all of it.
          </p>
        </header>

        <div className="mech__modules">
          {MODULES.map((m, i) => {
            const flip = i % 2 === 1 && !m.wide;
            const cls = m.wide ? "mech__row mech__row--wide" : `mech__row ${flip ? "mech__row--flip" : ""}`;
            return (
              <div key={m.step} className={cls}>
                <div className="mech__copy">
                  <div className="mech__module-head">
                    <span className="mech__step">{m.step}</span>
                    <span className="mech__tag">{m.tag}</span>
                  </div>
                  <h3 className="mech__title">
                    {m.title} <em>{m.emphasis}</em>
                  </h3>

                  {m.paragraphs.map((p, pi) => {
                    const isSourceLine = /^\*\*Source\s/.test(p);
                    return (
                      <p key={pi} className={`mech__p ${isSourceLine ? "mech__p--source" : ""}`}>
                        {p.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
                          part.startsWith("**") && part.endsWith("**") ? (
                            <strong key={j}>{part.slice(2, -2)}</strong>
                          ) : (
                            part
                          )
                        )}
                      </p>
                    );
                  })}

                  <div className="mech__stats">
                    {m.stats.map((s) => (
                      <div key={s.label} className={`mech__stat ${s.accent ? "mech__stat--accent" : ""}`}>
                        <span className="mech__stat-value">{s.value}</span>
                        <span className="mech__stat-label">{s.label}</span>
                      </div>
                    ))}
                  </div>

                  {m.replaces && m.replaces.length > 0 && (
                    <div className="mech__replaces">
                      <span className="mech__replaces-label">What you stop paying for</span>
                      <div className="mech__replaces-list">
                        {m.replaces.map((r) => (
                          <span key={r.tool} className="mech__replaces-item">
                            <span className="mech__replaces-strike">{r.tool}</span>
                            <span className="mech__replaces-cost">{r.cost}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="mech__mock">{MOCK_MAP[m.step]}</div>
              </div>
            );
          })}
        </div>

        <div className="mech__closer">
          <p>
            These aren't five tools you wire together. They're <em>one system, one AI directing all of it</em>, sharing the same prospect context, the same voice training, the same calendar state.
          </p>
          <p className="mech__closer-final">
            <em>You bring the AI. We bring the plumbing.</em>
          </p>
        </div>
      </div>
    </section>
  );
}
