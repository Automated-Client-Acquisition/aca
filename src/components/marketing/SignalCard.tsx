import { Link } from "react-router-dom";
import { CompanyAvatar } from "./CompanyAvatar";
import { PersonAvatar } from "./PersonAvatar";
import {
  TYPE_CLASS,
  companyHref,
  formatSignalDate,
  freshness,
  peopleForCompany,
  redactName,
  type PublicSignal,
} from "@/lib/signals";

interface SignalCardProps {
  signal: PublicSignal;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  /** Persist the single-company selection before the campaign link navigates. */
  onAddToCampaign: (signal: PublicSignal) => void;
}

export function SignalCard({ signal, selected, onToggleSelect, onAddToCampaign }: SignalCardProps) {
  const href = companyHref(signal);
  const campaignHref = `/campaigns/new?source=public-signals&type=${signal.type}&count=1`;
  const people = peopleForCompany(signal);
  const signalCount = signal.signal_count || 1;
  const mentionCount = signal.mention_count || 1;
  const fresh = freshness(signal.collected_at, signal.date);

  return (
    <article className={`aca-card signal-card ${selected ? "is-selected" : ""}`}>
      <label className="signal-card__check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(signal.id)}
          aria-label={`Select ${signal.company}`}
        />
      </label>

      <Link to={href} className="signal-card__head">
        <CompanyAvatar signal={signal} size={44} />
        <span className="signal-card__id">
          <strong className="signal-card__name">{signal.company}</strong>
          <span className="signal-card__sub">
            {fresh.label ? (
              <span className={`signal-card__fresh ${fresh.fresh ? "is-fresh" : ""}`}>
                <i aria-hidden="true" />
                {fresh.label}
              </span>
            ) : (
              <span className="signal-card__date">{formatSignalDate(signal.date)}</span>
            )}
            {signal.amount ? <span className="sig-amount">{signal.amount}</span> : signal.location ? <span className="sig-location">{signal.location}</span> : null}
          </span>
        </span>
      </Link>

      <div className="signal-card__chips">
        <span className={`sig-chip ${TYPE_CLASS[signal.type] || ""}`}>{signal.type_label}</span>
        {signal.verified ? <span className="sig-verified-stamp" aria-label="Verified"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M1.5 6L4 8.5L9.5 2.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>Verified</span> : null}
        {signalCount > 1 ? (
          <span className="sig-count">{signalCount} signals</span>
        ) : mentionCount > 1 ? (
          <span className="sig-count">{mentionCount} sources</span>
        ) : null}
      </div>

      <p className="aca-card__excerpt signal-card__headline">{signal.summary || signal.title}</p>

      {signal.why_it_matters ? (
        <div className="signal-card__angle">
          <span className="signal-card__angle-label">Why reach out now</span>
          <p>{signal.why_it_matters}</p>
        </div>
      ) : null}

      <div className="signal-card__foot">
        {people.length ? (
          <span className="signal-card__people" title="Decision-makers - unlock free">
            <span className="signal-card__avatars">
              {people.slice(0, 3).map((p) => (
                <PersonAvatar key={p.name} person={p} size={24} />
              ))}
            </span>
            <span className="signal-card__people-label">
              {people.length === 1 ? redactName(people[0].name) : `${people.length} decision-makers`}
            </span>
          </span>
        ) : (
          <a className="signal-card__source" href={signal.source_url} target="_blank" rel="noreferrer">
            {signal.source}
          </a>
        )}
        <time dateTime={signal.date}>{formatSignalDate(signal.date)}</time>
      </div>

      <div className="signal-card__actions">
        <Link to={campaignHref} className="btn btn--primary signal-card__cta" onClick={() => onAddToCampaign(signal)}>
          Add to campaign
        </Link>
        <Link to={href} className="signal-card__ghost">
          View contacts →
        </Link>
      </div>
    </article>
  );
}
