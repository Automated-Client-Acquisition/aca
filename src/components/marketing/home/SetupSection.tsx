const DELIVERABLES = [
  "Read your homepage",
  "Profile your ideal buyer by name",
  "Write five cold emails in your voice",
  "Design your LinkedIn campaign",
  "Wire your sending infrastructure with BYO M365, auto-warmup, and multi-inbox rotation",
  "Audit your profile and hand you a new headline",
  "Draft a thirty-day content plan with three daily themes",
  "Build a comment-to-DM lead magnet",
  "Brief a booking assistant",
  "Hand you a sixty-day playbook",
];

function Column({ items, offset }: { items: string[]; offset: number }) {
  return (
    <ol className="setup__col">
      {items.map((item, i) => (
        <li key={offset + i} className="setup__item">
          <span className="setup__num">{String(offset + i + 1).padStart(2, "0")}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function SetupSection() {
  return (
    <section id="setup" className="section--setup">
      <div className="wrap">
        <div className="setup__wrap">
          <div className="setup__card">
            <Column items={DELIVERABLES.slice(0, 5)} offset={0} />
            <div className="setup__divider" aria-hidden="true" />
            <Column items={DELIVERABLES.slice(5)} offset={5} />
          </div>
          <p className="setup__punch">
            <em>It will do all of this in minutes, then get out of your way.</em>
          </p>
        </div>
      </div>
    </section>
  );
}
