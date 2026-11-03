import { useState } from "react";
import { FAQS } from "./data";

export function FAQSection() {
  const [open, setOpen] = useState<number>(0);

  return (
    <section className="section section--tight">
      <div className="wrap">
        <header className="sect-head">
          <span className="kicker">Objection handling</span>
          <h2 className="h-section">
            The questions every<br />
            <em>serious buyer asks<span className="dot">.</span></em>
          </h2>
        </header>
        <div className="faq__list">
          {FAQS.map((it, i) => (
            <div
              key={i}
              className={"faq__item" + (open === i ? " faq__item--open" : "")}
              onClick={() => setOpen(open === i ? -1 : i)}
            >
              <div className="faq__q">
                {it.q}
                <span className="faq__q__icon">+</span>
              </div>
              <div className="faq__a">{it.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
