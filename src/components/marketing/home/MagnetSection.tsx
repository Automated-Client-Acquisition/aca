import { LeadMagnetMock } from "./mocks";

const POINTS = [
  {
    n: "01",
    t: "10,000+ words. Per prospect.",
    body: "Only experts write 10K-word documents on a specific subject. The orchestration layer writes one for every account that matters - personalized to their stack, their numbers, their named pain.",
  },
  {
    n: "02",
    t: "Positions them as the authority.",
    body: "The cover page is theirs. The byline is theirs. The custom benchmarks reference their company by name. They open it because it's about them. They share it internally because it makes them look smart.",
  },
  {
    n: "03",
    t: "Distributed everywhere your AI sends.",
    body: "DM attachment on first-touch. Email follow-up. Comment-to-get auto-DM. The same document fits all three channels because it's a real document, not a teaser PDF.",
  },
  {
    n: "04",
    t: "The 70% lift you can't fake.",
    body: "Cold messages book at ~2% in 2026. Personalized expert reports book at ~17%. That's not a tactic - it's the only way the math works once everyone has GPT writing their cold opens.",
  },
];

export function MagnetSection() {
  return (
    <section id="magnet" className="section section--magnet">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">The secret sauce</span>
          <h2 className="h-section">
            10,000-word expert reports.<br />
            <em>Personalized for every prospect<span className="dot">.</span></em>
          </h2>
          <p className="lead">
            Cold messages don't book meetings in 2026. Personalized expert documents do. ACA's orchestration layer writes a 10K-word custom report for each account - positioning them or you as the authority on the exact topic they care about. <strong>70% more meetings booked</strong> than cold outreach.
          </p>
        </header>

        <div className="magnet-section__mock">
          <LeadMagnetMock />
        </div>

        <div className="magnet-section__points">
          {POINTS.map((p) => (
            <div key={p.n} className="magnet-section__point">
              <span className="magnet-section__point-n">{p.n}</span>
              <h3 className="magnet-section__point-t">{p.t}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>

        <p className="magnet-section__close">
          <em>Only experts write 10,000 words on a specific subject.</em> The orchestration layer makes everyone an expert - in their prospect's eyes, on their prospect's exact problem, in 4 minutes.
        </p>
      </div>
    </section>
  );
}
