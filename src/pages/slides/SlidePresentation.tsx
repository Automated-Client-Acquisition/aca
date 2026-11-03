import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import "./slides.css";
import type {
  Slide,
  SlideDeck,
  CommandOption,
  CtaPath,
  ProblemRow,
  TableColumn,
  TableRow,
  TreeItem,
} from "./slideTypes";

/**
 * Slide presentation engine.
 *
 * Route: /slides/:slug
 * Content: /content/slides/<slug>.json (loaded eagerly via Vite glob)
 *
 * Full-screen, keyboard-navigated deck. Built once, reused for every video —
 * new presentations are just new JSON files dropped in /content/slides.
 */

// Eagerly import every deck under /content/slides as raw JSON, keyed by slug.
const deckModules = import.meta.glob<SlideDeck>("../../../content/slides/*.json", {
  eager: true,
  import: "default",
});

const decksBySlug: Record<string, SlideDeck> = {};
for (const path in deckModules) {
  const deck = deckModules[path];
  const fileSlug = path.split("/").pop()!.replace(/\.json$/, "");
  decksBySlug[deck?.slug ?? fileSlug] = deck;
}

/* -------------------------------------------------------------------------- */
/*  Text helpers                                                              */
/* -------------------------------------------------------------------------- */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Render text that may contain \n line breaks and accent phrases.
// Accent phrases are wrapped in <em> (rendered italic/accent via CSS).
function renderRich(text?: string, accentWords?: string[]): ReactNode {
  if (!text) return null;
  const lines = text.split("\n");
  return lines.map((line, li) => (
    <Fragment key={li}>
      {highlightLine(line, accentWords)}
      {li < lines.length - 1 && <br />}
    </Fragment>
  ));
}

function highlightLine(line: string, accentWords?: string[]): ReactNode {
  if (!accentWords || accentWords.length === 0) return line;
  // Longest phrases first so overlapping matches resolve correctly.
  const ordered = [...accentWords].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${ordered.map(escapeRegExp).join("|")})`, "g");
  const parts = line.split(re);
  return parts.map((part, i) =>
    accentWords.includes(part) ? <em key={i}>{part}</em> : <Fragment key={i}>{part}</Fragment>
  );
}

// Tokenize a command line, colouring URLs (.url) and flags (.flag), dimming
// comments (.comment), and (in terminal mode) prefixing a `$` prompt.
function renderCommand(command?: string, terminal?: boolean): ReactNode {
  if (!command) return null;
  const lines = command.split("\n");
  return lines.map((line, li) => {
    const isComment = line.trimStart().startsWith("#");
    const showPrompt = terminal && !isComment && line.trim() !== "";
    return (
      <div className="aca-codeblock__line" key={li}>
        {showPrompt && <span className="aca-prompt">$ </span>}
        {tokenizeCommandLine(line)}
      </div>
    );
  });
}

function tokenizeCommandLine(line: string): ReactNode {
  // Whole-line comment.
  if (line.trimStart().startsWith("#")) {
    return <span className="comment">{line}</span>;
  }
  // Peel a trailing `  # comment` (keep it dimmed) from the runnable part.
  let main = line;
  let comment = "";
  const m = line.match(/(\s+#\s.*)$/);
  if (m) {
    comment = m[1];
    main = line.slice(0, line.length - comment.length);
  }
  const tokens = main.split(/(\s+)/).map((tok, i) => {
    if (/^--?[A-Za-z]/.test(tok)) {
      return (
        <span className="flag" key={i}>
          {tok}
        </span>
      );
    }
    if (/(https?:\/\/|github\.com|[a-z0-9-]+\.(com|io|org|net|dev)\/)/i.test(tok)) {
      return (
        <span className="url" key={i}>
          {tok}
        </span>
      );
    }
    return <Fragment key={i}>{tok}</Fragment>;
  });
  return (
    <>
      {tokens}
      {comment && <span className="comment">{comment}</span>}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Per-type slide renderers                                                  */
/* -------------------------------------------------------------------------- */

// Render command lines as a terminal session: a $ prompt on each command line,
// comment lines (#...) dimmed and prompt-less.
function renderTerminal(command?: string): ReactNode {
  if (!command) return null;
  return command.split("\n").map((line, li) => {
    const isComment = line.trim().startsWith("#");
    return (
      <div className={`aca-terminal__line${isComment ? " comment" : ""}`} key={li}>
        {!isComment && <span className="aca-terminal__prompt">$</span>}
        {tokenizeCommandLine(line)}
      </div>
    );
  });
}

function CodeBlock({
  label,
  command,
  terminal,
  chat,
}: {
  label?: string;
  command?: string;
  terminal?: boolean;
  chat?: boolean;
}) {
  // A message the user sends the agent → Telegram-style chat bubble.
  if (chat) {
    // Strip one pair of wrapping quotes — the bubble itself signals it's a message.
    const msg = (command ?? "").replace(/^["“]([\s\S]*)["”]$/, "$1");
    return (
      <div>
        {label && <div className="aca-cmd-label">{label}</div>}
        <div className="aca-chat">
          <div className="aca-chat__bar">
            <span className="aca-chat__avatar">H</span>
            <span className="aca-chat__name">Hermes</span>
            <span className="aca-chat__status">online</span>
          </div>
          <div className="aca-chat__body">
            <div className="aca-chat__msg">
              {msg.split("\n").map((line, i) => (
                <Fragment key={i}>
                  {line}
                  {i < msg.split("\n").length - 1 && <br />}
                </Fragment>
              ))}
              <span className="aca-chat__time">9:41 ✓✓</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  // A real shell command → terminal-window mockup (title bar + traffic lights).
  if (terminal) {
    return (
      <div className="aca-terminal">
        <div className="aca-terminal__bar">
          <span className="aca-terminal__dot aca-terminal__dot--r" />
          <span className="aca-terminal__dot aca-terminal__dot--y" />
          <span className="aca-terminal__dot aca-terminal__dot--g" />
          <span className="aca-terminal__title">{label ?? "bash"}</span>
        </div>
        <div className="aca-terminal__body">{renderTerminal(command)}</div>
      </div>
    );
  }
  // Plain code block (default).
  return (
    <div>
      {label && <div className="aca-cmd-label">{label}</div>}
      <div className="aca-codeblock">{renderCommand(command)}</div>
    </div>
  );
}

function TitleSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide t-title">
      {s.pill && <span className="aca-pill">{s.pill}</span>}
      <h1 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h1>
      {s.sub && <p className="aca-sub">{s.sub}</p>}
    </div>
  );
}

function WarningSlide({ s }: { s: Slide }) {
  const body = Array.isArray(s.body) ? s.body : s.body ? [s.body] : [];
  return (
    <div className="aca-slides__slide t-warning">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      <div className="t-warning__body">
        {body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {s.cta_line && <div className="t-warning__cta">{s.cta_line}</div>}
    </div>
  );
}

function ProblemSlide({ s }: { s: Slide }) {
  const rows: ProblemRow[] = s.rows ?? [];
  const stat = s.right_stat;
  return (
    <div className="aca-slides__slide t-problem">
      <div className="t-two-col">
        <div>
          {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
          <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
          <table className={`aca-price-table${s.paid ? " aca-price-table--paid" : ""}`}>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <span className="aca-price-tool">
                      {r.logo && <img className="aca-price-logo" src={r.logo} alt="" />}
                      {r.tool}
                    </span>
                  </td>
                  <td>{r.cost}</td>
                </tr>
              ))}
              {(s.total_label || s.total_value) && (
                <tr className="total">
                  <td>{s.total_label}</td>
                  <td>{s.total_value}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {stat && (
          <div className="aca-bigstat">
            <div className="aca-bigstat__value">
              {stat.value}
              {stat.accent_part && <em>{stat.accent_part}</em>}
            </div>
            <div className="aca-bigstat__label">{stat.label}</div>
            {stat.sub && <div className="aca-bigstat__sub">{stat.sub}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function CommandSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide t-command">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      <CodeBlock label={s.cmd_label} command={s.command} terminal={s.terminal} chat={s.chat} />
      {typeof s.body === "string" && <p className="aca-body">{s.body}</p>}
    </div>
  );
}

function UpdateSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide t-update">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      <CodeBlock label={s.cmd_label} command={s.command} terminal={s.terminal} chat={s.chat} />
      {typeof s.body === "string" && <p className="aca-body">{s.body}</p>}
    </div>
  );
}

function FiletreeSlide({ s }: { s: Slide }) {
  const tree: TreeItem[] = (s.tree ?? []).map((t) =>
    typeof t === "string" ? { text: t, class: "file" as const } : t
  );
  return (
    <div className="aca-slides__slide t-filetree">
      <div className="t-two-col">
        <div>
          {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
          <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
          {typeof s.body === "string" && <p className="aca-body">{s.body}</p>}
        </div>
        <div className="aca-tree">
          {tree.map((item, i) => (
            <div className={`aca-tree__line ${item.class}`} key={i}>
              {item.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Figure({ s, feature }: { s: Slide; feature?: boolean }) {
  return (
    <figure className={`aca-figure ${feature ? "aca-figure--feature" : ""}`}>
      <img className="aca-figure__img" src={s.image} alt={s.alt ?? ""} loading="eager" />
      {s.caption && <figcaption className="aca-figure__cap">{s.caption}</figcaption>}
    </figure>
  );
}

function InsightSlide({ s }: { s: Slide }) {
  const body = (
    <>
      {s.step && <div className="aca-step">{s.step}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      {typeof s.body === "string" && <div className="aca-insight-body">{s.body}</div>}
      {s.command && (
        <div className="aca-insight-cmd">
          <CodeBlock command={s.command} terminal={s.terminal} chat={s.chat} />
        </div>
      )}
    </>
  );
  // With an image, lay text + screenshot side by side; otherwise single column.
  if (s.image) {
    return (
      <div className="aca-slides__slide t-insight t-insight--media">
        <div className="t-two-col">
          <div>{body}</div>
          <Figure s={s} />
        </div>
      </div>
    );
  }
  return <div className="aca-slides__slide t-insight">{body}</div>;
}

function ImageSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide aca-slides__slide--center t-image">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      {s.headline && <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>}
      <Figure s={s} feature />
    </div>
  );
}

function QuoteSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide aca-slides__slide--center t-quote">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <blockquote className="aca-quote">{renderRich(s.quote, s.accent_words)}</blockquote>
      {s.attribution && <div className="aca-quote__by">{s.attribution}</div>}
    </div>
  );
}

function TwoCommandsSlide({ s }: { s: Slide }) {
  const options: CommandOption[] = s.options ?? [];
  return (
    <div className="aca-slides__slide t-two-commands">
      {s.step && <div className="aca-step">{s.step}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      {typeof s.body === "string" && <div className="aca-insight-body">{s.body}</div>}
      <div className="aca-two-cmds">
        {options.map((opt, i) => (
          <div className="aca-cmd-option" key={i}>
            <div className={`aca-cmd-option__label ${opt.label_color}`}>{opt.label}</div>
            {opt.terminal ? (
              <CodeBlock command={opt.command} terminal />
            ) : (
              <div className="aca-codeblock">{renderCommand(opt.command)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function VersusSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide t-versus">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      <div className="aca-versus">
        <div className="aca-versus__side aca-versus__side--before">
          <div className="aca-versus__tag">{s.before_label ?? "Before"}</div>
          <CodeBlock terminal command={s.before} label={s.cmd_label ?? "bash — the old way"} />
        </div>
        <div className="aca-versus__divider">
          <span>vs</span>
        </div>
        <div className="aca-versus__side aca-versus__side--after">
          <div className="aca-versus__tag aca-versus__tag--accent">{s.after_label ?? "After"}</div>
          <CodeBlock chat command={s.after} />
        </div>
      </div>
      {s.note && <div className="aca-table__note">{s.note}</div>}
    </div>
  );
}

function VideoSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide aca-slides__slide--center t-video">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      {s.headline && <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>}
      <figure className="aca-video">
        {s.embed ? (
          <div className="aca-video__frame">
            <iframe
              src={s.embed}
              loading="lazy"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title={s.alt ?? "demo"}
            />
          </div>
        ) : (
          <video
            className="aca-video__el"
            src={s.video}
            poster={s.poster}
            autoPlay
            muted
            loop
            playsInline
          />
        )}
        {s.caption && <figcaption className="aca-figure__cap">{s.caption}</figcaption>}
      </figure>
    </div>
  );
}

function DiagramSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide aca-slides__slide--center t-diagram">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      {s.headline && <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>}
      {s.svg && (
        <div className="aca-diagram" dangerouslySetInnerHTML={{ __html: s.svg }} />
      )}
      {s.sub && <p className="aca-sub">{s.sub}</p>}
    </div>
  );
}

function TableSlide({ s }: { s: Slide }) {
  const columns: TableColumn[] = s.columns ?? [];
  const rows = (s.rows as unknown as TableRow[]) ?? [];
  return (
    <div className="aca-slides__slide t-table">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <table className="aca-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isWinner = ri === s.winner_index;
            return (
              <tr key={ri} className={isWinner ? "winner" : undefined}>
                {columns.map((c, ci) => (
                  <td key={c.key}>
                    {row[c.key]}
                    {isWinner && ci === 0 && <span className="aca-badge">Best value</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.note && <div className="aca-table__note">{s.note}</div>}
    </div>
  );
}

function StatSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide aca-slides__slide--center t-stat">
      {s.pill && <span className="aca-pill">{s.pill}</span>}
      <div className="aca-stat__value">
        {s.value}
        {s.accent_part && <em>{s.accent_part}</em>}
      </div>
      {s.label && <div className="aca-stat__label">{s.label}</div>}
      {s.sub && <p className="aca-sub">{s.sub}</p>}
    </div>
  );
}

function FullCircleSlide({ s }: { s: Slide }) {
  return (
    <div className="aca-slides__slide aca-slides__slide--center t-fullcircle">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      {s.sub && <p className="aca-sub">{s.sub}</p>}
    </div>
  );
}

function CtaSlide({ s }: { s: Slide }) {
  const paths: CtaPath[] = s.paths ?? [];
  return (
    <div className="aca-slides__slide t-cta">
      {s.eyebrow && <div className="aca-eyebrow">{s.eyebrow}</div>}
      <h2 className="aca-headline">{renderRich(s.headline, s.accent_words)}</h2>
      <div className="aca-paths">
        {paths.map((p, i) => (
          <div className={`aca-path ${p.primary ? "aca-path--primary" : ""}`} key={i}>
            <div className="aca-path__title">{p.title}</div>
            <div className="aca-path__body">{p.body}</div>
          </div>
        ))}
      </div>
      {s.footer && <div className="aca-cta__footer">{s.footer}</div>}
    </div>
  );
}

function SlideRenderer({ slide }: { slide: Slide }) {
  switch (slide.type) {
    case "title":
      return <TitleSlide s={slide} />;
    case "warning":
      return <WarningSlide s={slide} />;
    case "problem":
      return <ProblemSlide s={slide} />;
    case "command":
      return <CommandSlide s={slide} />;
    case "filetree":
      return <FiletreeSlide s={slide} />;
    case "insight":
      return <InsightSlide s={slide} />;
    case "table":
      return <TableSlide s={slide} />;
    case "two-commands":
      return <TwoCommandsSlide s={slide} />;
    case "stat":
      return <StatSlide s={slide} />;
    case "update":
      return <UpdateSlide s={slide} />;
    case "fullcircle":
      return <FullCircleSlide s={slide} />;
    case "image":
      return <ImageSlide s={slide} />;
    case "quote":
      return <QuoteSlide s={slide} />;
    case "versus":
      return <VersusSlide s={slide} />;
    case "diagram":
      return <DiagramSlide s={slide} />;
    case "video":
      return <VideoSlide s={slide} />;
    case "cta":
      return <CtaSlide s={slide} />;
    default:
      return (
        <div className="aca-slides__slide">
          <h2 className="aca-headline">{slide.headline ?? slide.id}</h2>
        </div>
      );
  }
}

/* -------------------------------------------------------------------------- */
/*  Engine                                                                    */
/* -------------------------------------------------------------------------- */

const SWIPE_THRESHOLD = 50; // px

export default function SlidePresentation() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const isPresenter = searchParams.get("present") === "1";
  const clean = searchParams.get("capture") === "1"; // hide all chrome for video frame capture
  const deck = slug ? decksBySlug[slug] : undefined;

  const [index, setIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const indexRef = useRef(0);

  const total = deck?.slides.length ?? 0;
  const channelKey = slug ? `aca-slides:${slug}` : null;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Apply an index locally WITHOUT re-broadcasting (used for remote updates).
  const applyIndex = useCallback(
    (i: number) => {
      setIndex((cur) => {
        const n = Math.max(0, Math.min(total - 1, i));
        return n === cur ? cur : n;
      });
    },
    [total]
  );

  // Navigate locally AND notify the paired window + persist the position.
  const goTo = useCallback(
    (i: number) => {
      const n = Math.max(0, Math.min(total - 1, i));
      setIndex(n);
      channelRef.current?.postMessage({ type: "goto", index: n });
      if (channelKey) {
        try {
          localStorage.setItem(channelKey, String(n));
        } catch {
          /* ignore */
        }
      }
    },
    [total, channelKey]
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  const openPresenter = useCallback(() => {
    if (!slug) return;
    window.open(`/slides/${slug}?present=1`, "aca-presenter", "width=920,height=1000");
  }, [slug]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // Track fullscreen so the audience view can hide its chrome while recording.
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Cross-window sync: the presenter (notes) window and the audience (slides)
  // window share one slide index, so advancing one advances the other.
  useEffect(() => {
    if (!deck || !channelKey || typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(channelKey);
    channelRef.current = bc;
    bc.onmessage = (e) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "goto" && typeof msg.index === "number") {
        applyIndex(msg.index);
      } else if (msg.type === "request") {
        bc.postMessage({ type: "goto", index: indexRef.current });
      }
    };
    // Pick up any saved position, then ask a live peer for the current one.
    try {
      const saved = localStorage.getItem(channelKey);
      if (saved != null) applyIndex(parseInt(saved, 10));
    } catch {
      /* ignore */
    }
    bc.postMessage({ type: "request" });
    return () => {
      bc.close();
      channelRef.current = null;
    };
  }, [deck, channelKey, applyIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!deck) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case " ":
        case "PageDown":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(total - 1);
          break;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "p":
        case "P":
          e.preventDefault();
          if (!isPresenter) openPresenter();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck, next, prev, goTo, total, toggleFullscreen, openPresenter, isPresenter]);

  // Touch swipe (mobile)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  };

  const progress = useMemo(
    () => (total <= 1 ? 100 : (index / (total - 1)) * 100),
    [index, total]
  );

  // ---- Fallback states -------------------------------------------------
  if (!deck) {
    return (
      <>
        <Helmet>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <div className="aca-fallback">
          <div>Presentation not found{slug ? `: ${slug}` : ""}.</div>
        </div>
      </>
    );
  }

  const current = deck.slides[index];

  // ---- Presenter / teleprompter view --------------------------------------
  // Opened in a separate window and kept in sync. The audience window never
  // renders notes; the presenter reads them privately here.
  if (isPresenter) {
    const upcoming = deck.slides[index + 1];
    const flat = (s?: Slide) => (s ? (s.headline ?? s.id).split("\n").join(" ") : "");
    return (
      <div className="aca-presenter">
        <Helmet>
          <title>Presenter — {deck.title}</title>
          <meta name="robots" content="noindex, nofollow" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
            rel="stylesheet"
          />
        </Helmet>
        <div className="aca-presenter__bar">
          <span className="aca-presenter__counter">
            <b>{String(index + 1).padStart(2, "0")}</b> / {String(total).padStart(2, "0")}
          </span>
          <span className="aca-presenter__title">{flat(current)}</span>
        </div>
        <div className="aca-presenter__notes">
          {current.notes || "— no notes for this slide —"}
        </div>
        {upcoming && (
          <div className="aca-presenter__next">
            <span className="aca-presenter__next-label">Next</span>
            <span className="aca-presenter__next-text">{flat(upcoming)}</span>
          </div>
        )}
        <div className="aca-presenter__hint">← →  navigate · synced with the slide window</div>
        <div className="aca-progress">
          <div className="aca-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  // ---- Audience view — clean slides only, no speaker notes -----------------
  return (
    <div
      className="aca-slides"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <Helmet>
        <title>{deck.title} — ACA</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,700;1,700&display=swap"
          rel="stylesheet"
        />
      </Helmet>

      {/* Background treatment */}
      <div className="aca-slides__bg" />

      {/* Top bar */}
      <div className="aca-chrome aca-topbar">
        <div className="aca-logo">
          ACA<span>.</span>
        </div>
        {!clean && (
          <div className="aca-counter">
            <b>{String(index + 1).padStart(2, "0")}</b> / {String(total).padStart(2, "0")}
          </div>
        )}
      </div>

      {/* Stage */}
      <div className="aca-slides__stage">
        <SlideRenderer key={current.id} slide={current} />
      </div>

      {/* Presenter launcher — hidden in fullscreen/capture so it never lands in a recording */}
      {!isFullscreen && !clean && (
        <button
          type="button"
          className="aca-notes-btn"
          onClick={openPresenter}
          aria-label="Open presenter view with speaker notes (P)"
        >
          presenter ⇗
        </button>
      )}

      {/* Key hints */}
      {!isFullscreen && !clean && (
        <div className="aca-chrome aca-hints">
          <span className="aca-key">←</span>
          <span className="aca-key">→</span>
          <span className="aca-key">F</span>
          <span className="aca-key">P</span>
        </div>
      )}

      {/* Progress bar */}
      {!clean && (
        <div className="aca-progress">
          <div className="aca-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
