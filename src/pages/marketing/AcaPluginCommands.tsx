import { MarketingNav, MarketingFooter } from "@/components/marketing";
import commands from "@/data/acaPluginCommands.json";
import "@/styles/aca-home.css";

/* Generated from the plugin repo (seguelaCedric/aca-native-mcp-skills,
   scripts/export-commands.mjs). Edit the skills there, not this data. */
type Command = {
  command: string;
  summary: string;
  description: string;
  tools: string[];
  appPages: string[];
};
type Group = { group: string; commands: Command[] };

const REPLACES: { instead: string; aca: string }[] = [
  { instead: "Smartlead / Instantly", aca: "Cold email sequences, mailbox rotation, warmup, and deliverability monitoring" },
  { instead: "HeyReach", aca: "LinkedIn automation across multiple sender accounts, with a unified inbox" },
  { instead: "Separate content tools", aca: "Content blueprints and autopilots for LinkedIn, X, Instagram and more" },
  { instead: "Lead-magnet tools", aca: "Comment-to-DM lead magnets on LinkedIn and Instagram" },
  { instead: "Signal tools", aca: "Buying signals (funding, hiring, engagement) feeding your lists" },
  { instead: "Mailbox infrastructure vendors", aca: "Microsoft 365 sending tenants and your own mail stack" },
  { instead: "Glue code", aca: "CRM, webhooks, GoHighLevel and Notion integrations, native n8n nodes, a CLI, and the MCP connector" },
];

const INSTALL = `/plugin marketplace add seguelaCedric/aca-native-mcp-skills
/plugin install aca-native-mcp-skills@aca-native-mcp-skills`;

// "/campaigns/{campaign_id}" -> "/campaigns": link to a page the user can open.
const pagePath = (url: string) =>
  url.replace("https://www.automatedclientacquisition.com", "").replace(/\/\{[^}]+\}/g, "") || "/";
const uniquePages = (urls: string[]) => [...new Set(urls.map(pagePath))];

const rowStyle = { marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 8px", alignItems: "baseline" } as const;

export default function AcaPluginCommands() {
  const groups = commands.groups as Group[];
  return (
    <>
      <MarketingNav />
      <main className="aca-marketing">
        <section className="hero" style={{ paddingTop: 64, paddingBottom: 32 }}>
          <div className="wrap">
            <div className="hero__top" style={{ textAlign: "center", alignItems: "center" }}>
              <span className="kicker">Claude plugin</span>
              <h1 className="h-hero">
                Every ACA command<span className="dot">.</span>
              </h1>
              <p className="lead" style={{ maxWidth: 640, margin: "0 auto" }}>
                Install the ACA plugin, sign in once, and run your client acquisition from Claude.
                Each command below is a slash command. Start with <code>/aca</code> or{" "}
                <code>/aca-kickoff</code>.
              </p>
            </div>
            <div className="mcp-card" style={{ maxWidth: 720, margin: "32px auto 0" }}>
              <p className="mcp-step__body" style={{ marginBottom: 8 }}>In Claude Code:</p>
              <div className="mcp-code mcp-code--block">
                <pre>{INSTALL}</pre>
              </div>
              <p className="mcp-card__foot" style={{ marginTop: 12 }}>
                No API key. Claude asks you to sign in to ACA the first time a command needs your workspace.{" "}
                <a href="/mcp">Other ways to connect →</a>
              </p>
            </div>
          </div>
        </section>

        <section className="section section--tight">
          <div className="wrap">
            <header className="sect-head">
              <span className="kicker">One platform</span>
              <h2 className="h-section">
                What ACA <em>replaces<span className="dot">.</span></em>
              </h2>
            </header>
            <div className="faq__list">
              {REPLACES.map((row) => (
                <div className="faq__item faq__item--open" key={row.instead}>
                  <div className="faq__q">{row.instead}</div>
                  <div className="faq__a">{row.aca}</div>
                </div>
              ))}
            </div>
            <p className="mcp-step__body" style={{ marginTop: 16 }}>
              From Claude you can check your workspace, search contacts, build lead lists, draft LinkedIn
              campaigns and lead magnets, read results, triage replies, and plan content. Connecting
              accounts, finding new prospects, email sequences, activation and autopilots happen in the
              ACA app; each command links you to the right page.
            </p>
          </div>
        </section>

        {groups.map((group) => (
          <section className="section section--tight" key={group.group} id={group.group.toLowerCase().replace(/\W+/g, "-")}>
            <div className="wrap">
              <header className="sect-head">
                <h2 className="h-section">{group.group}</h2>
              </header>
              <div className="faq__list">
                {group.commands.map((c) => (
                  <div className="faq__item faq__item--open" key={c.command} id={c.command.slice(1)}>
                    <div style={{ marginBottom: 8 }}>
                      <code style={{ fontSize: 15, fontWeight: 700 }}>{c.command}</code>
                      <p style={{ margin: "4px 0 0", fontWeight: 600 }}>{c.summary}</p>
                    </div>
                    <div className="faq__a">
                      <p>{c.description}</p>
                      {c.tools.length > 0 && (
                        <div style={rowStyle}>
                          <strong>In Claude:</strong>
                          {c.tools.map((t) => (
                            <code key={t} style={{ overflowWrap: "anywhere" }}>{t}</code>
                          ))}
                        </div>
                      )}
                      {c.appPages.length > 0 && (
                        <div style={{ ...rowStyle, marginTop: 4 }}>
                          <strong>In ACA:</strong>
                          {uniquePages(c.appPages).map((path) => (
                            <a key={path} href={path} style={{ overflowWrap: "anywhere" }}>{path}</a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </main>
      <MarketingFooter />
    </>
  );
}
