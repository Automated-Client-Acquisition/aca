import { useState } from "react";
import { PRICING_TIERS } from "./data";

export function PricingSection() {
  const [yearly, setYearly] = useState(true);
  const mainTiers = PRICING_TIERS.filter((t) => t.key !== "vip");
  const vipTier = PRICING_TIERS.find((t) => t.key === "vip");

  return (
    <section id="pricing" className="section">
      <div className="wrap">
        <header className="sect-head sect-head--center">
          <span className="kicker">Pricing</span>
          <h2 className="h-section">
            One plan. <em>Or done-for-you<span className="dot">.</span></em>
          </h2>
          <p className="lead">
            We don't charge per seat. We don't mark up tokens. We don't meter your sends. One Starter plan, unlimited on every dimension that matters - or have us run it for you.
          </p>
          <div className="pricing-toggle">
            <button className={!yearly ? "active" : ""} onClick={() => setYearly(false)}>Monthly</button>
            <button className={yearly ? "active" : ""} onClick={() => setYearly(true)}>
              Yearly<span className="save">save up to 39%</span>
            </button>
          </div>
        </header>

        <div className="pricing-grid pricing-grid--single">
          {mainTiers.map((tier) => {
            const tierCls = ["tier", tier.highlight ? "tier--featured" : ""].filter(Boolean).join(" ");
            const price = yearly ? tier.priceYearly : tier.priceMonthly;
            return (
              <div key={tier.key} className={tierCls}>
                <div>
                  <span className="tier__tag">{tier.tag}</span>
                  <h3 className="tier__name">{tier.name}</h3>
                </div>
                <div className="tier__price">
                  $<em>{price}</em>
                  <small>{yearly ? "/year" : "/month"}</small>
                  {tier.yearlySave && yearly && <span className="tier__save">{tier.yearlySave}</span>}
                </div>
                <p className="tier__sub">{tier.sub}</p>
                {tier.highlight && (
                  <div className="tier__included">
                    <span>∞ seats</span>
                    <span>∞ senders</span>
                    <span>∞ mailboxes</span>
                    <span>∞ sends</span>
                    <span>11-day refund</span>
                  </div>
                )}
                <ul className="tier__feats">
                  {tier.feats.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <a
                  href={tier.cta.href}
                  className={tier.highlight ? "btn btn--inverse" : "btn btn--ghost"}
                >
                  {tier.cta.label}
                </a>
                {tier.forWho && <p className="tier__for">For: {tier.forWho}</p>}
              </div>
            );
          })}
        </div>

        <p className="pricing__note">
          Cancel anytime, no questions asked. No card to start. Annual billing saves you nearly five months.
        </p>

        {vipTier && (
          <div className="vip-block">
            <div className="vip-block__inner">
              <div className="vip-block__head">
                <span className="kicker kicker--vip">VIP · done for you</span>
                <h3 className="vip-block__title">
                  Some founders don't want to run the orchestration layer themselves.<br />
                  <em>They want the meetings on the calendar<span className="dot">.</span></em>
                </h3>
              </div>
              <div className="vip-block__body">
                <div className="vip-block__copy">
                  <p>
                    A senior operator from our team takes over your account. They define the ICP with you on a kickoff call, build the sequences, train the voice profile against your transcripts, monitor the inbox, handle escalations, and run the weekly optimization. Your AI still does the heavy lifting - the orchestration layer, the inference, the booking - but the strategy and supervision sit on our side, not yours.
                  </p>
                  <p>
                    You get the same <strong>11-day meeting guarantee</strong>. You get a weekly report and a Slack channel with your operator. You get to spend your time on the meetings ACA books, not on managing the system that books them.
                  </p>
                </div>
                <div className="vip-block__price-card">
                  <span className="tier__tag">From</span>
                  <div className="vip-block__price">
                    $<em>1,500</em><small>/month</small>
                  </div>
                  <p className="vip-block__price-sub">
                    Final number depends on volume, ICP complexity, and how much custom work the motion needs.
                  </p>
                  <ul className="vip-block__feats">
                    <li>Senior operator runs your account</li>
                    <li>ICP defined on a kickoff call</li>
                    <li>Voice trained from your transcripts</li>
                    <li>Inbox monitored, escalations handled</li>
                    <li>Weekly optimization + Slack channel</li>
                    <li>Same 11-day guarantee</li>
                  </ul>
                  <a href="/support" className="btn btn--primary btn--lg">Talk to us about VIP →</a>
                </div>
              </div>
              <p className="vip-block__line">
                <em>Starter is for operators. VIP is for delegators. If you'd rather buy the outcome than build the system, this is the line.</em>
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
