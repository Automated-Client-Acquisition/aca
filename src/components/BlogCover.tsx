import "@/styles/aca-home.css";

type Variant = "standard" | "inverse" | "accent" | "chart";

interface BlogCoverProps {
  title: string;
  italicWord?: string;
  lead?: string;
  kicker?: string;
  date: string;
  readMin?: string | number;
  authorName?: string;
  authorInitials?: string;
  urlPath?: string;
  variant?: Variant;
  metricLabel?: string;
  metricValue?: string;
  size?: "full" | "card";
}

function autoEmphasis(title: string): { before: string; emph: string; after: string; period: boolean } {
  const star = title.match(/^(.*?)\*(.+?)\*(.*)$/);
  if (star) return { before: star[1], emph: star[2], after: star[3].replace(/[.!?]+$/, ""), period: /[.!?]$/.test(title.trim()) };
  const period = /[.!?]$/.test(title.trim());
  const cleaned = title.replace(/[.!?]+$/, "");
  const words = cleaned.split(/\s+/);
  if (words.length <= 2) return { before: "", emph: cleaned, after: "", period };
  const emph = words.slice(-2).join(" ");
  const before = words.slice(0, -2).join(" ") + " ";
  return { before, emph, after: "", period };
}

function PipelineTable({ inverse = false }: { inverse?: boolean }) {
  if (inverse) {
    return (
      <div className="pcard">
        <div className="pcard__bar">
          <div className="pcard__bar__left">
            <div className="pcard__icon">a<span className="dot">.</span></div>
            <div className="pcard__name">Replaced <span>· $0/mo</span></div>
          </div>
          <span className="chip chip--live">Live</span>
        </div>
        <table className="pcard__table">
          <thead>
            <tr><th>Tool</th><th>Was</th></tr>
          </thead>
          <tbody>
            <tr><td><div className="cell-co"><div className="logo logo--a">O</div><span className="cell-name">Outreach</span></div></td><td className="cell-strike">$1,800/mo</td></tr>
            <tr><td><div className="cell-co"><div className="logo logo--b">A</div><span className="cell-name">Apollo</span></div></td><td className="cell-strike">$600/mo</td></tr>
            <tr><td><div className="cell-co"><div className="logo logo--c">C</div><span className="cell-name">Clay</span></div></td><td className="cell-strike">$500/mo</td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="pcard">
      <div className="pcard__bar">
        <div className="pcard__bar__left">
          <div className="pcard__icon">a<span className="dot">.</span></div>
          <div className="pcard__name">Pipeline <span>· 247 accounts</span></div>
        </div>
        <span className="chip chip--live">Live</span>
      </div>
      <table className="pcard__table">
        <thead>
          <tr><th>Account</th><th>Stage</th><th>Trigger</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><div className="cell-co"><div className="logo logo--a">F</div><span className="cell-name">Fairmont</span></div></td>
            <td><span className="stage stage--booked">Booked</span></td>
            <td className="cell-trigger">Hired VP RevOps</td>
          </tr>
          <tr>
            <td><div className="cell-co"><div className="logo logo--b">P</div><span className="cell-name">Plenum</span></div></td>
            <td><span className="stage stage--replied">Replied</span></td>
            <td className="cell-trigger">Series B closed</td>
          </tr>
          <tr>
            <td><div className="cell-co"><div className="logo logo--c">N</div><span className="cell-name">Northwind</span></div></td>
            <td><span className="stage stage--sent">Sent</span></td>
            <td className="cell-trigger">Posted SDR role</td>
          </tr>
          <tr>
            <td><div className="cell-co"><div className="logo logo--d">A</div><span className="cell-name">Atria</span></div></td>
            <td><span className="stage stage--booked">Booked</span></td>
            <td className="cell-trigger">Replaced Outreach</td>
          </tr>
        </tbody>
      </table>
      <div className="pcard__foot">
        <span><b>4</b> of 247 shown</span>
        <span>updated · 2 min ago</span>
      </div>
    </div>
  );
}

function AutopilotTable() {
  return (
    <div className="pcard">
      <div className="pcard__bar">
        <div className="pcard__bar__left">
          <div className="pcard__icon">a<span className="dot">.</span></div>
          <div className="pcard__name">Autopilot · v1</div>
        </div>
        <span className="chip chip--live">New</span>
      </div>
      <table className="pcard__table">
        <thead>
          <tr><th>Stage</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td><div className="cell-co"><div className="logo logo--a">D</div><span className="cell-name">Discovery</span></div></td><td><span className="stage stage--booked">On</span></td></tr>
          <tr><td><div className="cell-co"><div className="logo logo--b">O</div><span className="cell-name">Outreach</span></div></td><td><span className="stage stage--booked">On</span></td></tr>
          <tr><td><div className="cell-co"><div className="logo logo--c">B</div><span className="cell-name">Booking</span></div></td><td><span className="stage stage--booked">On</span></td></tr>
        </tbody>
      </table>
    </div>
  );
}

function ChartBars() {
  const bars = [30, 50, 35, 60, 55, 70, 80, 90, 100];
  return (
    <div className="pcard pcard--chart">
      <div className="pcard__bar">
        <div className="pcard__bar__left">
          <div className="pcard__icon">a<span className="dot">.</span></div>
          <div className="pcard__name">Reply rate · by signal age</div>
        </div>
        <span className="chip chip--live">FIG. 01</span>
      </div>
      <div className="pcard__chart">
        {bars.map((h, i) => (
          <i key={i} style={{ height: h + "%", background: i >= 6 ? "#D4361A" : "#15140F" }} />
        ))}
      </div>
      <div className="pcard__foot">
        <span><b>0–24h</b> windows · last 30d</span>
        <span>n=4,182</span>
      </div>
    </div>
  );
}

function shortDateMeta(d: string, readMin?: string | number): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const formatted = m ? `${m[3]} ${months[parseInt(m[2], 10) - 1]} ${m[1]}` : d;
  return readMin ? `${formatted} · ${readMin}` : formatted;
}

export function BlogCover({
  title,
  italicWord,
  lead,
  kicker = "Field notes",
  date,
  readMin,
  authorName = "ACA",
  authorInitials = "A",
  urlPath = "aca.so/blog",
  variant = "standard",
  metricLabel,
  metricValue,
  size = "full",
}: BlogCoverProps) {
  const emp = italicWord
    ? (() => {
        const idx = title.toLowerCase().indexOf(italicWord.toLowerCase());
        if (idx < 0) return autoEmphasis(title);
        return {
          before: title.slice(0, idx),
          emph: title.slice(idx, idx + italicWord.length),
          after: title.slice(idx + italicWord.length).replace(/[.!?]+$/, ""),
          period: /[.!?]$/.test(title.trim()),
        };
      })()
    : autoEmphasis(title);

  const Art =
    variant === "chart" ? <ChartBars /> :
    variant === "accent" ? <AutopilotTable /> :
    variant === "inverse" ? <PipelineTable inverse /> :
    <PipelineTable />;

  return (
    <article className={`bcover bcover--${variant} bcover--${size}`} aria-label="Blog cover">
      <div className="bcover__brand">aca<span className="dot">.</span></div>

      <div className="bcover__copy">
        <span className="kicker"><span className="live-dot" />{kicker}</span>
        <h2 className="bcover__title">
          {emp.before}
          <em>{emp.emph}</em>
          {emp.after}
          <span className="period">.</span>
        </h2>
        {lead && <p className="bcover__lead">{lead}</p>}
        <div className="bcover__byline">
          <div className="bcover__byline__av">{authorInitials.slice(0, 2).toUpperCase()}</div>
          <div className="bcover__byline__text">
            <div className="bcover__byline__name">{authorName}</div>
            <div className="bcover__byline__meta">{shortDateMeta(date, readMin)}</div>
          </div>
        </div>
      </div>

      <div className="bcover__art">
        {metricValue && (
          <div className="floatcard">
            <div className="floatcard__l">{metricLabel || "This week"}</div>
            <div className="floatcard__n"><em>{metricValue}</em></div>
          </div>
        )}
        {Art}
      </div>

      <div className="bcover__url">{urlPath}</div>
    </article>
  );
}
