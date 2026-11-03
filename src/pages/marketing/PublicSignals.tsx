import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { MarketingFooter, MarketingNav, PersonAvatar, SignalCard, SignalsCustomBuild, SignalsDailyCapture, SignalsStickyCapture } from "@/components/marketing";
import { useSEO } from "@/hooks/useSEO";
import { savePendingSignalSelection, type PickedSignal } from "@/lib/signalSelection";
import { companyHref, countryFlag, countryName, displayLocation, fetchSignalsPayload, freshness, maskedEmail, peopleForCompany, personHasLinkedin, redactName, type PublicSignal, type SignalPerson, type SignalsPayload, type SignalType } from "@/lib/signals";
import "@/styles/aca-home.css";
import "@/styles/public-signals.css";
import "@/styles/marketing-continuity.css";

type ViewMode = "cards" | "list";
type FeedMode = "companies" | "people";

/** One decision-maker row in the People view - a person + the company trigger
 *  that makes them worth reaching today. */
interface PersonRow {
  rowId: string;
  person: SignalPerson;
  signal: PublicSignal;
}

function personSlug(name: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "person";
}

const SIGNALS_DESCRIPTION =
  "Fresh funding, hiring, acquisition, and job-change signals ACA uses to time outbound campaigns for B2B service providers.";

const SIGNALS_POLL_MS = 60_000;
const SIGNALS_PAGE_SIZE = 50;
const EMPTY_COUNTS: Record<string, number> = {};

const TYPE_ORDER: SignalType[] = ["funding", "hiring", "hiring_demand", "acquisition", "job_change", "executive_hire", "growth"];

const TYPE_COPY: Record<string, string> = {
  all: "All signals",
  funding: "Funding",
  hiring: "GTM hiring",
  hiring_demand: "Hiring demand",
  acquisition: "Acquisitions",
  job_change: "Job changes",
  executive_hire: "Executive hires",
  growth: "Growth",
};

const typeClass: Record<string, string> = {
  funding: "sig-chip--funding",
  acquisition: "sig-chip--acquisition",
  hiring: "sig-chip--hiring",
  hiring_demand: "sig-chip--hiring",
  job_change: "sig-chip--job",
  executive_hire: "sig-chip--job",
  growth: "sig-chip--growth",
};

function formatDate(date: string) {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function formatGeneratedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Today";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(parsed);
}

function formatRelativeTime(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function csvValue(value: string | number | boolean | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function sourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function fallbackPayload(): SignalsPayload {
  return {
    meta: {
      generated_at: new Date().toISOString(),
      source_file: "",
      total_source_rows: 0,
      public_count: 0,
      verified_count: 0,
      date_range: { start: null, end: null },
      type_counts: {},
      top_sources: {},
      schema_version: "2026-06-08",
    },
    signals: [],
  };
}

export default function PublicSignals() {
  const seo = useSEO({
    title: "B2B Buying Signals Tracker",
    description: SIGNALS_DESCRIPTION,
    canonical: "/signals",
    keywords: [
      "B2B buying signals",
      "sales trigger events",
      "funding signals",
      "hiring intent data",
      "cold email agency for B2B",
      "done-for-you lead generation",
    ],
  });

  const [payload, setPayload] = useState<SignalsPayload>(fallbackPayload());
  const [activeType, setActiveType] = useState<string>("all");
  const [activeCountry, setActiveCountry] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [feedMode, setFeedMode] = useState<FeedMode>("companies");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [currentPage, setCurrentPage] = useState(1);
  const [lastCheckedAt, setLastCheckedAt] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    let loadedOnce = false;
    let loadInFlight = false;

    async function loadSignals() {
      if (loadInFlight) return;
      loadInFlight = true;
      if (mounted) setIsRefreshing(true);

      try {
        const data = await fetchSignalsPayload((firstPage) => {
          // The first visit can paint the newest rows immediately. Background
          // polls keep the complete current snapshot on screen until the next
          // complete snapshot is ready, avoiding a 200 → 400 → … refill cycle.
          if (mounted && !loadedOnce) setPayload(firstPage);
        });
        if (!mounted) return;
        setPayload(data);
      } catch {
        if (mounted && !loadedOnce) setPayload(fallbackPayload());
      } finally {
        loadInFlight = false;
        loadedOnce = true;
        if (mounted) {
          setLastCheckedAt(Date.now());
          setIsRefreshing(false);
        }
      }
    }

    void loadSignals();
    const pollTimer = window.setInterval(() => {
      void loadSignals();
    }, SIGNALS_POLL_MS);

    return () => {
      mounted = false;
      window.clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    const tickTimer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(tickTimer);
    };
  }, []);

  const typeCounts = useMemo(() => payload.meta.type_counts ?? EMPTY_COUNTS, [payload.meta.type_counts]);
  const availableTypes = useMemo(() => {
    return TYPE_ORDER.filter((type) => typeCounts[type]).map((type) => ({ type, count: typeCounts[type] }));
  }, [typeCounts]);

  // The feed can carry the same signal id more than once (duplicate grouping
  // upstream). De-dupe by the canonical event id so React keys, row checkboxes,
  // and selection counts stay consistent. Do not deduplicate by funding amount:
  // unrelated companies can raise the same amount on the same day.
  const uniqueSignals = useMemo(() => {
    const seenId = new Set<string>();
    return payload.signals.filter((signal) => {
      if (seenId.has(signal.id)) return false;
      seenId.add(signal.id);
      return true;
    });
  }, [payload.signals]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = uniqueSignals.filter((signal) => {
      if (activeType !== "all" && signal.type !== activeType) return false;
      if (activeCountry !== "all" && (signal.country || "__none") !== activeCountry) return false;
      if (onlyVerified && !signal.verified) return false;
      if (!q) return true;
      return [signal.company, signal.title, signal.summary, signal.source, signal.location, signal.person]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    // Most-recent-first: sort by when the signal was found (collected_at),
    // falling back to its published date. Newest at the top of the feed.
    const recency = (signal: PublicSignal) =>
      new Date(signal.collected_at || signal.date || 0).getTime() || 0;
    return matches.sort((a, b) => recency(b) - recency(a));
  }, [activeType, activeCountry, onlyVerified, uniqueSignals, query]);

  // Country options for the toolbar dropdown, derived from the loaded feed so it
  // only ever lists countries that actually have signals (with live counts).
  // Built from uniqueSignals (pre-country-filter) so switching country never
  // shrinks the list. Real countries sorted by count desc; "Unknown" pinned last.
  const availableCountries = useMemo(() => {
    const counts = new Map<string, number>();
    let unknown = 0;
    uniqueSignals.forEach((signal) => {
      const code = signal.country || "";
      if (!code) unknown += 1;
      else counts.set(code, (counts.get(code) || 0) + 1);
    });
    const named = [...counts.entries()]
      .map(([code, count]) => ({ value: code, label: `${countryFlag(code)} ${countryName(code)}`.trim(), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (unknown) named.push({ value: "__none", label: "Unknown", count: unknown });
    return named;
  }, [uniqueSignals]);

  // Pivot the same filtered set into one row per decision-maker. Companies with
  // no enriched people simply don't appear here - that gap is the contact gate
  // ACA fills, so the People view doubles as the product's core demo.
  const peopleRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: PersonRow[] = [];
    filtered.forEach((signal) => {
      peopleForCompany(signal).forEach((person) => {
        const rowId = `${signal.id}::${personSlug(person.name)}`;
        if (seen.has(rowId)) return;
        seen.add(rowId);
        rows.push({ rowId, person, signal });
      });
    });
    return rows;
  }, [filtered]);

  const peopleCompanyCount = useMemo(
    () => new Set(peopleRows.map((row) => row.signal.id)).size,
    [peopleRows],
  );

  const isPeopleMode = feedMode === "people";
  const listLength = isPeopleMode ? peopleRows.length : filtered.length;
  const countNoun = isPeopleMode ? "decision-makers" : "companies";

  const totalPages = Math.max(1, Math.ceil(listLength / SIGNALS_PAGE_SIZE));
  const pageStart = (currentPage - 1) * SIGNALS_PAGE_SIZE;
  const paginatedSignals = useMemo(() => {
    return filtered.slice(pageStart, pageStart + SIGNALS_PAGE_SIZE);
  }, [filtered, pageStart]);
  const paginatedPeople = useMemo(() => {
    return peopleRows.slice(pageStart, pageStart + SIGNALS_PAGE_SIZE);
  }, [peopleRows, pageStart]);
  const pageRowCount = isPeopleMode ? paginatedPeople.length : paginatedSignals.length;
  const pageEnd = Math.min(pageStart + pageRowCount, listLength);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeType, activeCountry, onlyVerified, query, viewMode, feedMode]);

  // If the selected country drops out of the feed (e.g. after a refresh), fall
  // back to "all" so the table never silently shows zero rows.
  useEffect(() => {
    if (activeCountry === "all") return;
    if (!availableCountries.some((c) => c.value === activeCountry)) setActiveCountry("all");
  }, [activeCountry, availableCountries]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  // The ids selection operates on for the active view: signal ids in Companies
  // mode, person row ids in People mode. Switching modes naturally clears the
  // selection because the other mode's ids aren't visible (see prune effect).
  const visibleIds = useMemo(
    () => (isPeopleMode ? peopleRows.map((row) => row.rowId) : filtered.map((signal) => signal.id)),
    [isPeopleMode, peopleRows, filtered],
  );

  // Rows the actions operate on: the explicit selection if any, else everything
  // visible. Keeps the "no selection = act on everything in view" default.
  const effectiveSignals = useMemo(() => {
    if (!selectedIds.size) return filtered;
    return filtered.filter((signal) => selectedIds.has(signal.id));
  }, [filtered, selectedIds]);

  const effectivePeople = useMemo(() => {
    if (!selectedIds.size) return peopleRows;
    return peopleRows.filter((row) => selectedIds.has(row.rowId));
  }, [peopleRows, selectedIds]);

  const effectiveCount = isPeopleMode ? effectivePeople.length : effectiveSignals.length;
  const hasSelection = selectedIds.size > 0;

  // Drop ids from the selection that no longer match the active view (filter,
  // search, or mode switch) so the count never claims more than is actionable.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const visible = new Set(visibleIds);
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [visibleIds]);

  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSignal = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size && visibleIds.every((id) => prev.has(id))) return new Set();
      return new Set(visibleIds);
    });
  }, [visibleIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Surface a floating action bar once the in-board action bar scrolls out of
  // view, so a selection made deep in the feed can be acted on without scrolling
  // back to the top.
  const actionbarRef = useRef<HTMLDivElement>(null);
  const [actionbarOnScreen, setActionbarOnScreen] = useState(true);
  useEffect(() => {
    const el = actionbarRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setActionbarOnScreen(entry.isIntersecting),
      { rootMargin: "-72px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const showSelectBar = hasSelection && !actionbarOnScreen;

  // While the floating bar is up, hide the daily-signals sticky capture so the
  // two fixed bars never stack at the bottom (coordinated via a body attribute).
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (showSelectBar) document.body.dataset.signalsSelecting = "true";
    else delete document.body.dataset.signalsSelecting;
    return () => {
      delete document.body.dataset.signalsSelecting;
    };
  }, [showSelectBar]);

  const campaignHref = useMemo(() => {
    const params = new URLSearchParams({
      source: "public-signals",
      type: activeType,
      count: String(effectiveCount),
      unit: isPeopleMode ? "people" : "companies",
    });
    const trimmedQuery = query.trim();
    if (trimmedQuery) params.set("q", trimmedQuery);
    if (onlyVerified) params.set("verified", "true");
    if (activeCountry !== "all") params.set("country", activeCountry);
    return `/campaigns/new?${params.toString()}`;
  }, [activeType, activeCountry, effectiveCount, isPeopleMode, onlyVerified, query]);

  // Persist the picked companies so they survive auth/onboarding and pre-load
  // the campaign builder. Synchronous, so the <Link> navigation proceeds after.
  const persistSignals = useCallback((list: PublicSignal[]) => {
    const picked: PickedSignal[] = list.map((signal) => ({
      id: signal.id,
      type: signal.type,
      type_label: signal.type_label,
      company: signal.company,
      person: signal.person,
      location: signal.location,
      summary: signal.summary,
      date: signal.date,
      source: signal.source,
      source_url: signal.source_url,
    }));
    savePendingSignalSelection(picked, {
      type: activeType,
      query: query.trim(),
      verifiedOnly: onlyVerified,
    });
  }, [activeType, query, onlyVerified]);

  // People view persists the same shape but keyed per contact, so the campaign
  // builder pre-loads the actual decision-makers (not just the accounts).
  const persistPeople = useCallback((rows: PersonRow[]) => {
    const picked: PickedSignal[] = rows.map(({ rowId, person, signal }) => ({
      id: rowId,
      type: signal.type,
      type_label: signal.type_label,
      company: signal.company,
      person: person.name,
      location: signal.location,
      summary: signal.summary,
      date: signal.date,
      source: signal.source,
      source_url: signal.source_url,
    }));
    savePendingSignalSelection(picked, {
      type: activeType,
      query: query.trim(),
      verifiedOnly: onlyVerified,
    });
  }, [activeType, query, onlyVerified]);

  const handleAddToCampaign = useCallback(
    () => (isPeopleMode ? persistPeople(effectivePeople) : persistSignals(effectiveSignals)),
    [isPeopleMode, persistPeople, effectivePeople, persistSignals, effectiveSignals],
  );
  const handleAddSingle = useCallback((signal: PublicSignal) => persistSignals([signal]), [persistSignals]);

  const downloadCsv = useCallback((headers: string[], rows: (string | number | boolean)[][], suffix: string) => {
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aca-public-signals-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  const exportFilteredSignals = useCallback(() => {
    if (isPeopleMode) {
      const headers = ["person", "title", "has_linkedin", "company", "type", "summary", "amount", "why_it_matters", "source_url", "collected_at"];
      const rows = effectivePeople.map(({ person, signal }) => [
        person.name,
        person.title || "",
        personHasLinkedin(person),
        signal.company,
        signal.type_label,
        signal.summary,
        signal.amount,
        signal.why_it_matters,
        signal.source_url,
        signal.collected_at,
      ]);
      downloadCsv(headers, rows, "people");
      return;
    }

    const headers = [
      "date",
      "type",
      "company",
      "title",
      "summary",
      "amount",
      "person",
      "location",
      "source",
      "source_url",
      "verified",
      "confidence",
      "quality_score",
      "why_it_matters",
      "collected_at",
    ];

    const rows = effectiveSignals.map((signal) => [
      signal.date,
      signal.type_label,
      signal.company,
      signal.title,
      signal.summary,
      signal.amount,
      signal.person,
      signal.location,
      signal.source,
      signal.source_url,
      signal.verified,
      signal.confidence,
      signal.quality_score,
      signal.why_it_matters,
      signal.collected_at,
    ]);

    downloadCsv(headers, rows, "companies");
  }, [isPeopleMode, effectivePeople, effectiveSignals, downloadCsv]);

  // Derived from the de-duplicated set (not raw payload / stale meta counts) so
  // the same-event funding dupes never inflate the totals on screen.
  const stats = useMemo(() => {
    const fundingTotal = uniqueSignals.reduce((sum, signal) => sum + (signal.amount_usd || 0), 0);
    const sourceCount = Object.keys(payload.meta.top_sources || {}).length;
    return {
      total: uniqueSignals.length,
      events: uniqueSignals.reduce((sum, signal) => sum + (signal.signal_count || 1), 0),
      multi: uniqueSignals.filter((signal) => (signal.signal_count || 1) > 1).length,
      verified: uniqueSignals.filter((signal) => signal.verified).length,
      fundingTotal,
      sourceCount,
    };
  }, [uniqueSignals, payload.meta.top_sources]);

  // Hero metrics for the freshest day of signals - scoped to the latest date the
  // feed was *found* (collected_at), which is "today" in production since the feed
  // regenerates daily. Tracks the found-date, so it rolls forward automatically.
  const todayStats = useMemo(() => {
    const dayOf = (s: PublicSignal) => (s.collected_at || s.date || "").slice(0, 10);
    const days = uniqueSignals.map(dayOf).filter(Boolean).sort();
    const latest = days[days.length - 1];
    const list = latest ? uniqueSignals.filter((s) => dayOf(s) === latest) : uniqueSignals;
    return {
      day: latest || "",
      companies: list.length,
      // Count of companies with a funding signal - a sum of scraped amounts can't
      // be an accurate "capital raised" figure (one mega-round dominates + names
      // are often misparsed), so we report the count we can stand behind.
      funded: list.filter((s) => s.type === "funding").length,
      hiring: list.filter((s) => s.type === "hiring" || s.type === "hiring_demand").length,
      verified: list.filter((s) => s.verified).length,
    };
  }, [uniqueSignals]);

  const liveSources = useMemo(() => {
    return Object.entries(payload.meta.top_sources || {})
      .slice(0, 4)
      .map(([source, count]) => ({ source, count }));
  }, [payload.meta.top_sources]);

  const elapsedSinceCheck = Math.max(0, now - lastCheckedAt);
  const nextPollIn = SIGNALS_POLL_MS - (elapsedSinceCheck % SIGNALS_POLL_MS);
  const latestSignals = payload.signals.slice(0, 6);

  const jsonLd = useMemo(() => {
    const datasetUrl = "https://www.automatedclientacquisition.com/signals";
    const itemList = filtered.slice(0, 25).map((signal, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: signal.source_url,
      item: {
        "@type": "NewsArticle",
        headline: `${signal.company}: ${signal.summary}`,
        datePublished: signal.date,
        dateModified: signal.collected_at || signal.date,
        author: { "@type": "Organization", name: signal.source },
        publisher: { "@type": "Organization", name: "Automated Client Acquisition", url: "https://www.automatedclientacquisition.com" },
        about: signal.company,
        isAccessibleForFree: true,
        mainEntityOfPage: signal.source_url,
      },
    }));

    return [
      {
        "@context": "https://schema.org",
        "@type": "Dataset",
        name: "ACA B2B Buying Signals Tracker",
        description:
          "A daily feed of B2B funding, hiring, acquisition, and job-change signals used for timed outbound campaigns.",
        url: datasetUrl,
        creator: { "@type": "Organization", name: "Automated Client Acquisition", url: "https://www.automatedclientacquisition.com" },
        license: "https://www.automatedclientacquisition.com/terms",
        dateModified: payload.meta.generated_at,
        temporalCoverage: payload.meta.date_range?.start && payload.meta.date_range?.end
          ? `${payload.meta.date_range.start}/${payload.meta.date_range.end}`
          : undefined,
        variableMeasured: Object.keys(typeCounts).map((type) => TYPE_COPY[type] || type),
        distribution: {
          "@type": "DataDownload",
          encodingFormat: "application/json",
          contentUrl: "https://www.automatedclientacquisition.com/signals/signals.json",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Recent B2B buying signals",
        itemListElement: itemList,
      },
      {
        "@context": "https://schema.org",
        "@type": "Service",
        name: "Automated Client Acquisition",
        serviceType: "Done-for-you outbound and appointment setting",
        provider: { "@type": "Organization", name: "Automated Client Acquisition", url: "https://www.automatedclientacquisition.com" },
        areaServed: "Worldwide",
        audience: { "@type": "Audience", audienceType: "B2B service providers, boutique agencies, consultancies, wealth managers" },
        description:
          "ACA runs lead sourcing, enrichment, verification, cold email copy, reply management, and appointment setting for B2B service providers.",
      },
    ];
  }, [filtered, payload.meta, typeCounts]);

  return (
    <>
      {/* SVG filter for rubber-stamp ink-roughen effect */}
      <svg className="sig-stamp-defs" aria-hidden="true" focusable="false">
        <defs>
          <filter id="stamp-roughen" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.8" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      {seo}
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <MarketingNav />
      <main className="aca-marketing mkt-page public-signals mkt-signals">
        <section className="hero">
          <div className="wrap">
            <div className="hero__top">
              <span className="kicker"><span className="live-dot" />Free · updated every morning</span>
              <h1 className="h-hero">
                Warm leads with reasons to buy <em>today<span className="dot">.</span></em>
              </h1>
              <p className="lead">
                Funding, hiring, acquisitions, and leadership changes - emailed to you the morning they break,
                so you reach out while the window is open instead of after it closes.
              </p>
              <SignalsDailyCapture variant="hero" inputId="signals-hero-email" liveCount={todayStats.companies} />
              <div className="signals-actions signals-actions--secondary">
                <a href="#signal-feed" className="btn btn--ghost">Or browse the live feed ↓</a>
                <button className="btn btn--ghost signals-export-button" onClick={exportFilteredSignals} type="button">
                  Export CSV
                </button>
              </div>
              <p className="aca-meta signals-livenote">
                {isRefreshing ? "Pulling fresh data" : "Live pull active"} · updated {formatRelativeTime(lastCheckedAt, now)}
              </p>
              <div className="signals-metrics" aria-label="Signals found today">
                <div className="signals-metric">
                  <span className="num">{todayStats.companies.toLocaleString()}</span>
                  <span className="lab">Companies today</span>
                </div>
                <div className="signals-metric">
                  <span className="num">{todayStats.funded.toLocaleString()}</span>
                  <span className="lab">Funded today</span>
                </div>
                <div className="signals-metric">
                  <span className="num">{todayStats.hiring.toLocaleString()}</span>
                  <span className="lab">Hiring today</span>
                </div>
                <div className="signals-metric">
                  <span className="num">{todayStats.verified.toLocaleString()}</span>
                  <span className="lab">Verified today</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section--tight signals-how">
          <div className="wrap">
            <header className="sect-head sect-head--center">
              <span className="kicker">How it works</span>
              <h2 className="h-section">A signal is only useful if it ends in a <em>person you can reach</em>.</h2>
              <p className="lead">
                Every row is a company with a reason to buy. ACA turns it into the actual decision-makers to contact - and the outreach that lands the meeting.
              </p>
            </header>
            <div className="aca-card-grid signals-how__grid">
              <div className="aca-card signals-how__card">
                <span className="signals-how__num">01</span>
                <h3 className="aca-card__title">We catch the <em>trigger</em></h3>
                <p className="aca-card__excerpt">
                  A company raises, hires, acquires, or changes leadership. We track it the day it breaks - across funding wires, news, and LinkedIn.
                </p>
              </div>
              <div className="aca-card signals-how__card">
                <span className="signals-how__num">02</span>
                <h3 className="aca-card__title">We find the <em>people</em></h3>
                <p className="aca-card__excerpt">
                  ACA pulls the real decision-makers at that account - name, role, LinkedIn profile, and a verified work email - not just the company name.
                </p>
              </div>
              <div className="aca-card signals-how__card">
                <span className="signals-how__num">03</span>
                <h3 className="aca-card__title">We write &amp; <em>reach out</em></h3>
                <p className="aca-card__excerpt">
                  A message built around the trigger, sent from warmed inboxes, with every reply managed until a call is on the calendar.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section--tight" id="signal-feed" style={{ paddingTop: 0 }}>
          <div className="wrap signals-board">
            <div className="signals-board__intro">
              <span className="kicker">Structured signal feed</span>
              <h2 className="h-section">Browse fresh B2B <em>trigger events</em>.</h2>
              <p className="lead signals-board__sub">
                {isPeopleMode
                  ? "The actual decision-makers behind today's signals - name, role, and why now. Tick the people you want, then export or push them into an ACA campaign."
                  : "Funding, hiring, acquisition, and leadership signals - fresh today. Tick the companies you want, then export or push them into an ACA campaign."}
              </p>
            </div>

            <div className="signals-feedmode" role="group" aria-label="View signals by">
              <span className="signals-feedmode__label">View by</span>
              <div className="signals-feedmode__toggle">
                <button
                  className={!isPeopleMode ? "is-active" : ""}
                  onClick={() => setFeedMode("companies")}
                  type="button"
                  aria-pressed={!isPeopleMode}
                >
                  Companies <span>{stats.total.toLocaleString()}</span>
                </button>
                <button
                  className={isPeopleMode ? "is-active" : ""}
                  onClick={() => setFeedMode("people")}
                  type="button"
                  aria-pressed={isPeopleMode}
                >
                  People <span>{peopleRows.length.toLocaleString()}</span>
                </button>
              </div>
              {isPeopleMode ? (
                <span className="signals-feedmode__hint">
                  {peopleRows.length.toLocaleString()} decision-makers · {peopleCompanyCount.toLocaleString()} companies
                </span>
              ) : null}
            </div>

            <div className="signals-toolbar">
              <div className="signals-search">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search company, role, source..."
                  aria-label="Search signals"
                />
              </div>
              {availableCountries.length > 1 ? (
                <label className="signals-toolbar__country">
                  <span className="signals-toolbar__country-label">Country</span>
                  <select
                    value={activeCountry}
                    onChange={(event) => setActiveCountry(event.target.value)}
                    aria-label="Filter by country"
                  >
                    <option value="all">All countries</option>
                    {availableCountries.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label} ({c.count})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="signals-toolbar__verified">
                <input checked={onlyVerified} onChange={(event) => setOnlyVerified(event.target.checked)} type="checkbox" />
                Verified only
              </label>
              {!isPeopleMode ? (
                <div className="signals-view-toggle" role="group" aria-label="View mode">
                  <button className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")} type="button" aria-pressed={viewMode === "list"}>
                    List
                  </button>
                  <button className={viewMode === "cards" ? "is-active" : ""} onClick={() => setViewMode("cards")} type="button" aria-pressed={viewMode === "cards"}>
                    Cards
                  </button>
                </div>
              ) : null}
            </div>

            <div className="signals-filters" aria-label="Filter by signal type">
              <button className={activeType === "all" ? "is-active" : ""} onClick={() => setActiveType("all")} type="button">
                All <span>{stats.total}</span>
              </button>
              {availableTypes.map(({ type, count }) => (
                <button className={activeType === type ? "is-active" : ""} onClick={() => setActiveType(type)} type="button" key={type}>
                  {TYPE_COPY[type] || type} <span>{count}</span>
                </button>
              ))}
            </div>

            <div className="signals-actionbar" ref={actionbarRef}>
              <span className="signals-actionbar__count">
                {hasSelection ? (
                  <><b>{selectedIds.size.toLocaleString()}</b> selected</>
                ) : (
                  <>
                    <b>{effectiveCount.toLocaleString()}</b> {countNoun}
                    {listLength ? (
                      <small>
                        · Showing {pageStart + 1}-{pageEnd} of {listLength.toLocaleString()}
                      </small>
                    ) : null}
                  </>
                )}
              </span>
              <div className="signals-actionbar__btns">
                {hasSelection ? (
                  <button type="button" className="signals-actionbar__clear" onClick={clearSelection}>Clear</button>
                ) : null}
                <button className="btn btn--ghost" onClick={exportFilteredSignals} type="button" disabled={!effectiveCount}>
                  Export {effectiveCount.toLocaleString()} CSV
                </button>
                <Link to={campaignHref} rel="nofollow" className="btn btn--primary" onClick={handleAddToCampaign}>
                  Add {effectiveCount.toLocaleString()} to campaign
                </Link>
              </div>
            </div>

          {isPeopleMode ? (
          <div className="signals-people-table" role="table" aria-label="Decision-makers behind recent signals">
            <div className="signals-prow signals-prow--head" role="row">
              <span className="signals-select-cell">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  aria-label={allVisibleSelected ? "Deselect all people" : "Select all people"}
                />
              </span>
              <span>Decision-maker</span>
              <span>Why reach out</span>
              <span>Signal</span>
            </div>
            {paginatedPeople.map(({ rowId, person, signal }) => {
              const fresh = freshness(signal.collected_at, signal.date);
              return (
                <article
                  className={`signals-prow ${selectedIds.has(rowId) ? "is-selected" : ""}`}
                  role="row"
                  key={rowId}
                >
                  <span className="signals-select-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(rowId)}
                      onChange={() => toggleSignal(rowId)}
                      aria-label={`Select ${redactName(person.name)}`}
                    />
                  </span>
                  <div className="signals-prow__person">
                    <PersonAvatar person={person} size={42} />
                    <div className="signals-prow__id">
                      <span className="signals-prow__name">
                        <strong>{redactName(person.name)}</strong>
                        {personHasLinkedin(person) ? <span className="signals-prow__li">in</span> : null}
                      </span>
                      {person.title ? <span className="signals-prow__title">{person.title}</span> : null}
                      <span className="signals-prow__email">{maskedEmail(person.name)}</span>
                    </div>
                  </div>
                  <div className="signals-prow__why">
                    <Link to={companyHref(signal)} className="signals-prow__company"><strong>{signal.company}</strong></Link>
                    <p>{signal.why_it_matters}</p>
                    <Link to={companyHref(signal)} className="signals-prow__unlock">Unlock contact →</Link>
                  </div>
                  <div className="signals-prow__meta">
                    <span className={`sig-chip ${typeClass[signal.type] || ""}`}>{signal.type_label}</span>
                    {signal.amount ? <small>{signal.amount}</small> : null}
                    <span className={`signals-prow__found ${fresh.fresh ? "is-fresh" : ""}`}>
                      {fresh.label || formatDate(signal.date)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          ) : viewMode === "cards" ? (
            <div className="signals-card-grid">
              {paginatedSignals.map((signal) => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  selected={selectedIds.has(signal.id)}
                  onToggleSelect={toggleSignal}
                  onAddToCampaign={handleAddSingle}
                />
              ))}
            </div>
          ) : (
          <div className="signals-table" role="table" aria-label="Recent B2B buying signals">
            <div className="signals-table__row signals-table__row--head" role="row">
              <span className="signals-select-cell">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  aria-label={allVisibleSelected ? "Deselect all signals" : "Select all signals"}
                />
              </span>
              <span>Found</span>
              <span>Signal</span>
              <span>Company</span>
              <span>People</span>
              <span>Evidence</span>
              <span>Why reach out</span>
            </div>
            {paginatedSignals.map((signal, index) => {
              const fresh = freshness(signal.collected_at, signal.date);
              const people = peopleForCompany(signal);
              return (
              <article
                className={`signals-table__row ${index < 3 ? "signals-table__row--fresh" : ""} ${selectedIds.has(signal.id) ? "is-selected" : ""}`}
                role="row"
                key={signal.id}
              >
                <span className="signals-select-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(signal.id)}
                    onChange={() => toggleSignal(signal.id)}
                    aria-label={`Select ${signal.company}`}
                  />
                </span>
                <div className="signals-when">
                  <span className={`signals-when__rel ${fresh.fresh ? "is-fresh" : ""}`}>
                    <i aria-hidden="true" />
                    {fresh.label || formatDate(signal.date)}
                  </span>
                  <time dateTime={signal.date}>{formatDate(signal.date)}</time>
                </div>
                <div>
                  <span className={`sig-chip ${typeClass[signal.type] || ""}`}>{signal.type_label}</span>
                  {signal.verified ? <span className="sig-verified-stamp" aria-label="Verified"><svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true"><path d="M1.5 6L4 8.5L9.5 2.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>Verified</span> : null}
                  {(signal.signal_count || 1) > 1 ? (
                    <span className="sig-count">{signal.signal_count} signals</span>
                  ) : (signal.mention_count || 1) > 1 ? (
                    <span className="sig-count">{signal.mention_count} sources</span>
                  ) : null}
                </div>
                <div className="signals-company">
                  <Link to={companyHref(signal)}><strong>{signal.company}</strong></Link>
                  <span className="sig-meta-row">
                    {signal.amount ? <span className="sig-amount">{signal.amount}</span> : null}
                    {signal.location ? <span className="sig-location">{displayLocation(signal.location)}</span> : null}
                  </span>
                </div>
                <div className="signals-row-people">
                  {people.length ? (
                    <Link to={companyHref(signal)} className="signals-people" title="Decision-makers - unlock free">
                      <span className="signals-people__avatars">
                        {people.slice(0, 3).map((person, idx) => (
                          <PersonAvatar key={`${person.name}-${idx}`} person={person} size={24} />
                        ))}
                      </span>
                      <span className="signals-people__copy">
                        <span className="signals-people__eyebrow">Decision-maker</span>
                        <span className="signals-people__label">
                          {people.length === 1 ? redactName(people[0].name) : `${people.length} people`}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <Link to={companyHref(signal)} className="signals-people signals-people--empty">
                      <span className="signals-people__label">Find contacts</span>
                    </Link>
                  )}
                </div>
                <div className="signals-evidence">
                  <p>{signal.summary}</p>
                  <a href={signal.source_url} target="_blank" rel="noreferrer">Source</a>
                  {(signal.timeline?.length || 0) > 1 ? (
                    <details className="signals-inline-timeline">
                      <summary>View company timeline ({signal.timeline?.length} signals)</summary>
                      <ol>
                        {signal.timeline?.slice(0, 6).map((event) => (
                          <li key={event.id}>
                            <time dateTime={event.date}>{formatDate(event.date)}</time>
                            <span>{event.type_label}</span>
                            <p>{event.summary}</p>
                            {(event.mention_count || 1) > 1 ? (
                              <small>{event.mention_count} sources</small>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </div>
                <p className="signals-angle">{signal.why_it_matters}</p>
              </article>
              );
            })}
          </div>
          )}

            {listLength > SIGNALS_PAGE_SIZE ? (
              <div className="signals-pagination" aria-label="Signals pagination">
                <button type="button" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                  First
                </button>
                <button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
                  Previous
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>
                  Next
                </button>
                <button type="button" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                  Last
                </button>
              </div>
            ) : null}

            {!listLength ? (
              <div className="signals-empty">
                {isPeopleMode
                  ? "No decision-makers surfaced for this filter yet. Switch back to Companies, or let ACA enrich the contacts behind these signals."
                  : "No signals match that filter. Clear the search or switch signal type."}
              </div>
            ) : null}
          </div>
        </section>

        <SignalsDailyCapture variant="band" liveCount={todayStats.companies} />

        <SignalsCustomBuild />

        <section className="section--ink cta">
          <div className="wrap">
            <span className="kicker kicker--inv">Want this operationalized?</span>
            <h2 className="h-section">ACA turns filtered signals into <em>booked sales calls</em>.</h2>
            <p className="cta__sub">
              {effectiveCount.toLocaleString()} {hasSelection ? "selected" : "ready"} - ACA sources the contacts, writes around the trigger, sends from warmed inboxes, and books the call.
            </p>
            <div className="cta__btns">
              <Link to={campaignHref} rel="nofollow" className="btn btn--inverse btn--lg" onClick={handleAddToCampaign}>Add to campaign →</Link>
              <button className="btn btn--ghost btn--lg" onClick={exportFilteredSignals} type="button" style={{ background: "transparent", borderColor: "rgba(255,255,255,0.3)", color: "#fff" }}>
                Export CSV
              </button>
            </div>
          </div>
        </section>

        {showSelectBar ? (
          <div className="signals-selectbar" role="region" aria-label="Selected signals actions">
            <span className="signals-selectbar__count">
              <b>{selectedIds.size.toLocaleString()}</b> {countNoun} selected
            </span>
            <button type="button" className="signals-selectbar__clear" onClick={clearSelection}>
              Clear
            </button>
            <button type="button" className="signals-selectbar__export" onClick={exportFilteredSignals}>
              Export CSV
            </button>
            <Link to={campaignHref} rel="nofollow" className="signals-selectbar__add" onClick={handleAddToCampaign}>
              Add {effectiveCount.toLocaleString()} to campaign →
            </Link>
          </div>
        ) : null}

        <SignalsStickyCapture />
      </main>

      <MarketingFooter />
    </>
  );
}
