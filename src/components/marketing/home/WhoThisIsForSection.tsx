import { FIT_LIST, NO_FIT_LIST } from "./data";

export function WhoThisIsForSection() {
  return (
    <section id="fit" className="section section--tight">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">Be honest about whether this fits</span>
          <h2 className="h-section">
            Who this is for.<br />
            <em>And who it isn't<span className="dot">.</span></em>
          </h2>
          <p className="lead">
            The product is good. It's not magic. If you don't have a working offer, ACA will help you find out faster - but that's not what most people pay for.
          </p>
        </header>

        <div className="fit-grid">
          <div className="fit-col fit-col--yes">
            <h3 className="fit-col__t">This is built for you if</h3>
            <ul className="fit-list">
              {FIT_LIST.map((line) => (
                <li key={line}><span className="fit-mark fit-mark--yes" aria-hidden>✓</span>{line}</li>
              ))}
            </ul>
          </div>
          <div className="fit-col fit-col--no">
            <h3 className="fit-col__t">This is not for you if</h3>
            <ul className="fit-list fit-list--no">
              {NO_FIT_LIST.map((line) => (
                <li key={line}><span className="fit-mark fit-mark--no" aria-hidden>−</span>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
