import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { MarketingFooter, MarketingNav, CompanyAvatar, PersonAvatar } from "@/components/marketing";
import { useSEO } from "@/hooks/useSEO";
import { savePendingSignalSelection, type PickedSignal } from "@/lib/signalSelection";
import {
  TYPE_CLASS,
  SIGNALS_SKOOL_URL,
  companyIdFromSlug,
  fetchSignalCompany,
  fetchSignals,
  findCompanyBySlug,
  formatSignalDate,
  maskedEmail,
  peopleForCompany,
  redactName,
  sourceHost,
  type PublicSignal,
} from "@/lib/signals";
import "@/styles/aca-home.css";
import "@/styles/public-signals.css";
import "@/styles/marketing-continuity.css";

type LoadState = "loading" | "ready" | "missing";

export default function PublicSignalCompany() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [company, setCompany] = useState<PublicSignal | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    setState("loading");

    // Resolve from the database first - the same live source the /signals list
    // feed reads. The list builds these links from DB rows, so any company whose
    // signals landed after the last static-feed export exists in the DB but not
    // in /signals/signals.json. Reading the static file here 404'd every such
    // company ("Company not found"). Fall back to the static feed only if the
    // slug carries no hash-id or the RPC finds nothing.
    const companyId = companyIdFromSlug(slug);
    const resolve = async (): Promise<PublicSignal | null> => {
      if (companyId) {
        const fromDb = await fetchSignalCompany(companyId).catch(() => null);
        if (fromDb) return fromDb;
      }
      const payload = await fetchSignals(controller.signal);
      return findCompanyBySlug(payload.signals, slug) ?? null;
    };

    resolve()
      .then((match) => {
        if (!mounted) return;
        setCompany(match ?? null);
        setState(match ? "ready" : "missing");
      })
      .catch(() => {
        if (mounted) setState("missing");
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [slug]);

  const seo = useSEO({
    title: company ? `${company.company} - buying signals & history` : "Company signals",
    description: company
      ? `${company.company}: ${company.summary} Track the funding, hiring, and leadership signals ACA uses to time outbound.`
      : "B2B company buying signals and history tracked by ACA.",
    canonical: `/signals/c/${slug}`,
  });

  const timeline = useMemo(() => company?.timeline?.length ? company.timeline : company ? [company] : [], [company]);
  const people = useMemo(() => (company ? peopleForCompany(company) : []), [company]);

  const campaignHref = company
    ? `/campaigns/new?source=public-signals&type=${company.type}&count=1`
    : "/campaigns/new?source=public-signals";

  const handleAddToCampaign = () => {
    if (!company) return;
    const picked: PickedSignal = {
      id: company.id,
      type: company.type,
      type_label: company.type_label,
      company: company.company,
      person: company.person,
      location: company.location,
      summary: company.summary,
      date: company.date,
      source: company.source,
      source_url: company.source_url,
    };
    savePendingSignalSelection([picked], { type: company.type, query: "", verifiedOnly: false });
  };

  const jsonLd = useMemo(() => {
    if (!company) return null;
    return {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: company.company,
      url: company.domain ? `https://${company.domain}` : company.source_url,
      sameAs: [company.company_linkedin_url].filter(Boolean),
      subjectOf: timeline.map((event) => ({
        "@type": "NewsArticle",
        headline: `${company.company}: ${event.summary}`,
        datePublished: event.date,
        url: event.source_url,
      })),
    };
  }, [company, timeline]);

  return (
    <>
      {seo}
      {jsonLd ? (
        <Helmet>
          <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
        </Helmet>
      ) : null}
      <MarketingNav />
      <main className="aca-marketing mkt-page public-signals mkt-signal-company">
        <section className="signals-wrap company-page">
          <Link to="/signals" className="company-back">← All signals</Link>

          {state === "loading" ? (
            <div className="company-skeleton" aria-busy="true">
              <div className="company-skeleton__avatar" />
              <div className="company-skeleton__lines">
                <span /><span /><span />
              </div>
            </div>
          ) : null}

          {state === "missing" ? (
            <div className="signals-empty">
              <h1 className="h-section">Company not found</h1>
              <p>This company isn’t in the current signal feed. It may have rolled off as fresh signals came in.</p>
              <Link to="/signals" className="btn btn--primary btn--lg">Back to the live feed →</Link>
            </div>
          ) : null}

          {state === "ready" && company ? (
            <>
              <header className="company-hero">
                <CompanyAvatar signal={company} size={72} />
                <div className="company-hero__id">
                  <h1>{company.company}</h1>
                  <div className="company-hero__chips">
                    <span className={`sig-chip ${TYPE_CLASS[company.type] || ""}`}>{company.type_label}</span>
                    {company.verified ? <span className="sig-verified-stamp" aria-label="Verified"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M1.5 6L4 8.5L9.5 2.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>Verified</span> : null}
                    {company.amount ? <span className="company-amount">{company.amount}</span> : null}
                    {company.location ? <span className="company-loc">{company.location}</span> : null}
                  </div>
                  <div className="company-hero__links">
                    {company.company_linkedin_url ? (
                      <a href={company.company_linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a>
                    ) : null}
                    {company.domain ? (
                      <a href={`https://${company.domain}`} target="_blank" rel="noreferrer">{company.domain} ↗</a>
                    ) : null}
                  </div>
                </div>
                <div className="company-hero__cta">
                  <Link to={campaignHref} rel="nofollow" className="btn btn--primary btn--lg" onClick={handleAddToCampaign}>
                    Add to campaign →
                  </Link>
                  <p>ACA sources the contacts, writes around the trigger, and books the call.</p>
                </div>
              </header>

              <div className="company-grid">
                <section className="company-timeline" aria-label="Signal timeline">
                  <h2 className="company-section-title">Signal timeline</h2>
                  <ol>
                    {timeline.map((event) => (
                      <li key={event.id}>
                        <time dateTime={event.date}>{formatSignalDate(event.date)}</time>
                        <div className="company-timeline__body">
                          <span className={`sig-chip ${TYPE_CLASS[event.type] || ""}`}>{event.type_label}</span>
                          <p>{event.summary}</p>
                          <a href={event.source_url} target="_blank" rel="noreferrer">
                            {event.source} · {sourceHost(event.source_url)}
                          </a>
                          {(event.mention_count || 1) > 1 ? (
                            <small>{event.mention_count} sources corroborate this</small>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                <aside className="company-people" aria-label="Decision-makers">
                  <div className="company-people__head">
                    <h2 className="company-section-title">Decision-makers</h2>
                    <span className="company-people__lockpill">Locked</span>
                  </div>
                  {people.length ? (
                    <ul className="company-people__list is-gated">
                      {people.slice(0, 5).map((p) => (
                        <li key={p.name}>
                          <PersonAvatar person={p} size={38} />
                          <div className="company-people__id">
                            <strong>{redactName(p.name)}</strong>
                            <small>{p.title || "Decision-maker"}</small>
                            <span className="company-people__channels" aria-hidden="true">
                              <span className="company-people__chan"><i className="ico-mail" />{maskedEmail(p.name)}</span>
                              <span className="company-people__chan"><i className="ico-in" />LinkedIn</span>
                            </span>
                          </div>
                          <span className="company-people__locktag" aria-hidden="true">🔒</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="company-people__empty">
                      ACA surfaces the decision-makers at {company.company} - name, role, LinkedIn, and a verified work email - the moment you add it to a campaign.
                    </p>
                  )}
                  <p className="company-people__gate">
                    Every contact comes with a <strong>verified email</strong> and <strong>LinkedIn</strong>. Unlock the full list free and start the conversation today.
                  </p>
                  <Link to={campaignHref} rel="nofollow" className="btn btn--primary company-people__cta" onClick={handleAddToCampaign}>
                    Get in touch - free →
                  </Link>
                  <div className="company-skool-cta">
                    <span>Build this yourself</span>
                    <p>Learn how to build agents that monitor companies, find decision-makers, and turn signals into outreach.</p>
                    <a href={SIGNALS_SKOOL_URL} target="_blank" rel="noreferrer">Join the Skool group →</a>
                  </div>
                </aside>
              </div>
            </>
          ) : null}
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
