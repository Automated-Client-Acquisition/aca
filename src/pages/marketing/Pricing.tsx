import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  KeyRound,
  Minus,
  Mail,
  Network,
  PenLine,
  Magnet,
  Server,
  UsersRound,
  CalendarDays,
  ArrowDown,
  Sparkles,
  Target,
  FileText,
  Github,
} from "lucide-react";
import { MarketingNav, MarketingFooter } from "@/components/marketing";
import { ACA_GITHUB_URL } from "@/components/marketing/links";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/home/IntegrationBrands";
import { AcquisitionHeroProof } from "@/components/marketing/home/AcquisitionProofPreview";
import {
  monthlyToolCostCents,
  pricingComparison,
} from "@/lib/pricing-calculator";
import "@/styles/aca-home.css";
import "@/styles/pricing-editorial.css";

const features = [
  {
    title: "Find your next buyers",
    description: "Build a list worth reaching out to.",
    items: [
      "B2B contact search and ICP targeting",
      "LinkedIn and Apify list builders",
      "Email, phone and company enrichment",
      "Company analysis and ICP scoring",
      "CSV imports and bulk operations",
    ],
  },
  {
    title: "Catch buying signals",
    description: "Give your outreach a reason to happen now.",
    items: [
      "Open-web signal detection",
      "LinkedIn engagement tracking",
      "Lead-to-comment workflows",
      "Signal-based trigger rules",
      "Hiring, funding and company events",
    ],
  },
  {
    title: "Start conversations",
    description: "Email and social outreach in one workflow.",
    items: [
      "Visual campaign and sequence builders",
      "LinkedIn connections, InMail and messages",
      "Email and multi-channel follow-ups",
      "Sender rotation and configured rate limits",
      "Reply matching and campaign tracking",
    ],
  },
  {
    title: "Keep replies moving",
    description: "Bring the conversation into one place.",
    items: [
      "Unified inbox for connected channels",
      "AI-assisted reply workflows",
      "Human escalation rules",
      "Meeting and conversation context",
      "Contact history alongside replies",
    ],
  },
  {
    title: "Create content that works",
    description: "Turn your expertise into a publishing rhythm.",
    items: [
      "Brand voices and content blueprints",
      "Image and video generation with your providers",
      "Voice and text-to-speech generation",
      "Subtitles and carousel creation",
      "Content generation and publishing workflows",
    ],
  },
  {
    title: "Discover better angles",
    description: "Find topics and formats to make your own.",
    items: [
      "Keyword and creator discovery",
      "Content research across social platforms",
      "Hooks and format inspiration",
      "Repurposing in your brand voice",
      "Connected publishing workflows",
    ],
  },
  {
    title: "Turn attention into leads",
    description: "Give interested buyers a next step.",
    items: [
      "Lead magnet builder",
      "Custom landing pages",
      "Forms connected to your CRM",
      "Page previews and experimentation",
      "Lead capture and follow-up flows",
    ],
  },
  {
    title: "Connect your stack",
    description: "Use the providers and systems you trust.",
    items: [
      "Bring your own AI provider keys",
      "Notion and GoHighLevel integrations",
      "Email infrastructure connections",
      "Enrichment and scraping providers",
      "No ACA token markup",
    ],
  },
  {
    title: "Work with your AI agent",
    description: "Give your assistant access to your work.",
    items: [
      "Native MCP access",
      "REST API and CLI",
      "Claude, ChatGPT and compatible clients",
      "Authenticated workspace access",
      "Campaign, contact and content tools",
    ],
  },
];
const operatorFeatures = [
  "Unlimited seats, leads, campaigns and content",
  "All acquisition workflows included",
  "Lead sourcing, signals and multi-channel outreach",
  "Content studio, lead magnets and unified inbox",
  "MCP, API and your connected integrations",
  "Bring your own AI and data provider keys",
  "Email support",
];
const agencyFeatures = [
  "Everything in Operator",
  "Multi-tenant client workspaces",
  "Your branding and your domain",
  "Role-based access and per-client audit logs",
  "Tenant Stripe checkout",
  "Slack escalation channel",
  "White-glove onboarding",
];
const serviceFeatures = [
  "Everything in White-label",
  "ICP, lists and campaign setup",
  "Content engine in your brand voice",
  "Campaign launch and management",
  "Reply nurturing and follow-up workflows",
  "Weekly pipeline reporting",
  "A direct line to the team",
];
const selfHostedFeatures = [
  "Every Operator feature",
  "Your own database, servers and workers",
  "Your own AI and channel API keys",
  "ACA Network through the API: shared warmup, lead pool credits",
  "Community support",
  "Not for resale as a hosted service",
];
const questions = [
  {
    q: "What does unlimited mean?",
    a: "Operator includes unlimited ACA seats, leads, campaigns and content. Your connected services still apply their own billing, account capacity, usage limits and sending policies. The platform subscription does not include third-party usage.",
  },
  {
    q: "Do you charge credits?",
    a: "ACA does not sell credit packs for leads, campaigns or AI tokens. You pay the platform subscription, then your providers bill you directly for services you use with your own keys. ACA adds no token markup.",
  },
  {
    q: "How do bring-your-own keys work?",
    a: "Connect your own provider accounts, such as OpenRouter, Replicate, ElevenLabs or your enrichment provider. You choose the provider and model, manage its budget, and pay its usage charges directly.",
  },
  {
    q: "Are mailboxes and email infrastructure included?",
    a: "Email infrastructure tools are available in ACA. Mailbox subscriptions, domains, tenant licences and other external infrastructure costs are separate. The amount depends on your provider and setup, including Microsoft 365 or ZapMail where supported.",
  },
  {
    q: "What does White-label add?",
    a: "White-label includes Operator, plus multi-tenant workspaces, your branding and domain, role-based access, audit logs and tenant Stripe checkout. It is designed for agencies delivering ACA to clients.",
  },
  {
    q: "Can I try ACA first?",
    a: "Start with a free website preview: see your buyer profile, first email and content drafts without an account or credit card. Then create a workspace to try ACA. Trial duration, any charge and card requirements are shown before checkout. Operator is $67/month or $490/year after the trial.",
  },
  {
    q: "Can I run ACA on my own servers?",
    a: "Yes, for free. The self-hosted version is source available on GitHub under the Functional Source License (FSL-1.1-ALv2). You can run it, change it and use it for your business and your clients' campaigns. You can't sell it, or a modified copy, as a product or hosted service that competes with ACA. Each version becomes Apache 2.0 two years after release. You bring your own database, servers and API keys, and support comes from the community.",
  },
  {
    q: "Can I cancel?",
    a: "Yes. Cancel from settings at any time. Your subscription stays active until the end of the period you have paid for.",
  },
  {
    q: "Can the ACA team run it for me?",
    a: "The Done-for-you service covers setup and operation of your acquisition workflows, including targeting, lists, content and campaigns. Pricing depends on scope. Book a call to agree the work and the price.",
  },
];
const stackCategories = [
  {
    id: "sequencer",
    icon: Mail,
    label: "Cold email sequencer",
    detail: "Sequences and follow-ups",
    example: "49",
  },
  {
    id: "linkedin",
    icon: Network,
    label: "LinkedIn automation",
    detail: "Connections and messages",
    example: "79",
  },
  {
    id: "content",
    icon: PenLine,
    label: "Content & publishing",
    detail: "Creation, repurposing and scheduling",
    example: "39",
  },
  {
    id: "magnets",
    icon: Magnet,
    label: "Lead magnets & pages",
    detail: "Forms and lead magnet delivery",
    example: "29",
  },
  {
    id: "infra",
    icon: Server,
    label: "Email infrastructure tools",
    detail: "Mailbox management and warmup tools",
    example: "29",
  },
  {
    id: "leads",
    icon: UsersRound,
    label: "Lead sourcing & CRM",
    detail: "Prospecting and pipeline software",
    example: "49",
  },
  {
    id: "booking",
    icon: CalendarDays,
    label: "Scheduling",
    detail: "Booking and calendar software",
    example: "19",
  },
];
const comparisonRows = [
  ["Acquisition tools and workflows", "Included", "Included", "Included"],
  [
    "Unlimited seats, leads, campaigns & content",
    "Included",
    "Included",
    "Included",
  ],
  ["Client workspaces", "—", "Included", "Included"],
  ["Your branding & domain", "—", "Included", "Included"],
  ["Client billing with Stripe", "—", "Included", "Included"],
  ["Who builds and runs your campaigns?", "Your team", "Your team", "ACA team"],
  [
    "Onboarding & support",
    "Email support",
    "White-glove onboarding",
    "Direct line to our team",
  ],
  [
    "External provider usage",
    "Billed separately",
    "Billed separately",
    "Agreed in your scope",
  ],
];
function FeatureList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>
          <Check size={15} />
          {item}
        </li>
      ))}
    </ul>
  );
}
function PricingStackCalculator({
  yearly,
  onBillingChange,
}: {
  yearly: boolean;
  onBillingChange: (yearly: boolean) => void;
}) {
  const [tools, setTools] = useState(() =>
    stackCategories.map((tool) => ({
      ...tool,
      selected: true,
      cost: tool.example,
    })),
  );
  const {
    selectedCount,
    toolsCents,
    acaCents,
    differenceCents: difference,
    period,
  } = pricingComparison(tools, yearly);
  const dollars = (cents: number) =>
    (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div className="pe-calculator">
      <fieldset aria-describedby="pe-calc-note">
        <legend className="sr-only">Tool subscriptions to compare</legend>
        <div className="pe-calc-head">
          <span>Your current tools</span>
          <span>Per month</span>
        </div>
        {tools.map((tool) => (
          <div
            className={"pe-calc-row" + (!tool.selected ? " is-disabled" : "")}
            key={tool.id}
          >
            <label htmlFor={"pe-tool-" + tool.id}>
              <input
                type="checkbox"
                id={"pe-tool-" + tool.id}
                checked={tool.selected}
                onChange={(event) =>
                  setTools((current) =>
                    current.map((item) =>
                      item.id === tool.id
                        ? { ...item, selected: event.target.checked }
                        : item,
                    ),
                  )
                }
              />
              <tool.icon size={18} />
              <span>
                <strong>{tool.label}</strong>
                <small>{tool.detail}</small>
              </span>
            </label>
            <div className="pe-calc-input">
              <span aria-hidden="true">$</span>
              <input
                aria-label={tool.label + " monthly cost"}
                type="number"
                min="0"
                max="100000"
                step="0.01"
                inputMode="decimal"
                disabled={!tool.selected}
                value={tool.cost}
                onChange={(event) =>
                  setTools((current) =>
                    current.map((item) =>
                      item.id === tool.id
                        ? { ...item, cost: event.target.value }
                        : item,
                    ),
                  )
                }
                onBlur={() =>
                  setTools((current) =>
                    current.map((item) =>
                      item.id === tool.id
                        ? {
                            ...item,
                            cost: String(monthlyToolCostCents(item.cost) / 100),
                          }
                        : item,
                    ),
                  )
                }
              />
            </div>
          </div>
        ))}
      </fieldset>
      <aside className="pe-calc-summary">
        <span className="pe-eyebrow">Your subscription comparison</span>
        <div
          className="pe-calc-billing"
          role="group"
          aria-label="Comparison period"
        >
          <button
            type="button"
            aria-label="Compare monthly costs"
            aria-pressed={!yearly}
            onClick={() => onBillingChange(false)}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-label="Compare annual costs"
            aria-pressed={yearly}
            onClick={() => onBillingChange(true)}
          >
            Yearly
          </button>
        </div>
        <div className="pe-calc-total">
          <span>Selected tools</span>
          <strong>
            ${dollars(toolsCents)}
            <small>/{period}</small>
          </strong>
        </div>
        <div className="pe-calc-total">
          <span>ACA Operator</span>
          <strong>
            ${dollars(acaCents)}
            <small>/{period}</small>
          </strong>
        </div>
        <div className="pe-calc-result" aria-live="polite" aria-atomic="true">
          <span>
            {selectedCount === 0
              ? "Select your tools to compare"
              : difference > 0
                ? "Potential subscription savings"
                : difference === 0
                  ? "Same subscription cost"
                  : "Your selected tools cost less"}
          </span>
          <strong>
            {selectedCount === 0 ? "$0" : "$" + dollars(Math.abs(difference))}
            <small>{selectedCount > 0 ? `/${period}` : ""}</small>
          </strong>
        </div>
        <p>
          Compare subscriptions only. AI, enrichment, mailbox licences, domains
          and other provider costs are separate.
        </p>
        <Button asChild variant="cta" className="pe-button">
          <Link to="/get-started">
            Build my free preview <ArrowRight size={16} />
          </Link>
        </Button>
        <small className="pe-calc-method">
          {yearly
            ? "Tools × 12 months compared with ACA’s $490 annual bill."
            : "Compared with ACA’s $67 monthly subscription."}
        </small>
      </aside>
      <p id="pe-calc-note">
        Example budgets, not competitor price quotes. Edit each amount to match
        your own bills. Select only subscriptions you expect to replace.
      </p>
    </div>
  );
}
function PricingPreview() {
  return (
    <section
      className="pe-workflow-preview pe-wrap"
      aria-labelledby="pe-preview-title"
    >
      <header className="pe-workflow-preview__header">
        <div>
          <h2 id="pe-preview-title">
            Email, LinkedIn and the tools behind them.
            <br />
            <em>All included in Operator.</em>
          </h2>
          <p>
            Email sequences, Microsoft 365 infrastructure, LinkedIn campaigns,
            lead magnets and content farming. Choose a view to see an example
            workflow and output.
          </p>
        </div>
        <div className="pe-workflow-preview__action">
          <svg viewBox="182 279 721 947" aria-hidden="true">
            <image
              href="/media/mascot/fox-wave-cut.png"
              width="1024"
              height="1536"
            />
          </svg>
          <Button asChild variant="cta" className="pe-button">
            <Link to="/get-started">
              Build my free preview <ArrowRight size={16} />
            </Link>
          </Button>
          <span>
            Get your own buyer, email and content drafts.
            <br />
            No account or card needed for the preview.
          </span>
        </div>
      </header>
      <h3 className="sr-only">Example workflows you can run in ACA</h3>
      <AcquisitionHeroProof />
    </section>
  );
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <>
      <MarketingNav />
      <main className="aca-marketing mkt-page pricing-editorial">
        <section className="pe-hero pe-wrap">
          <span className="pe-eyebrow">
            No seat fees. No ACA credit packs. One flat price.
          </span>
          <h1>
            Replace your outreach tool stack
            <br />
            <em>with one $67/month platform.</em>
          </h1>
          <p>
            Find buyers, launch email and LinkedIn outreach, create content and
            capture leads in one workspace. Add your team without adding seat
            fees.
          </p>
          <div className="pe-unlimited">
            {[
              "Unlimited seats",
              "Unlimited leads",
              "Unlimited campaigns",
              "Unlimited content",
            ].map((text) => (
              <span key={text}>
                <Check size={15} />
                {text}
              </span>
            ))}
          </div>
          <div className="pe-hero__actions">
            <Button asChild variant="cta" className="pe-button">
              <Link to="/get-started">
                Build my free preview <ArrowRight size={16} />
              </Link>
            </Button>
            <a href="#plans">
              Compare plans <ArrowDown size={15} />
            </a>
            <span>No account or card needed for the preview.</span>
          </div>
          <p className="pe-hero__keys">
            <KeyRound size={15} /> Bring your own API keys. Provider usage and
            subscriptions are separate.
          </p>
        </section>
        <section className="pe-plans pe-wrap" id="plans">
          <div className="pe-plans__intro">
            <p>
              Start with Operator. Choose White-label for your own client
              platform.
            </p>
            <div
              className="pe-billing"
              role="group"
              aria-label="Billing period"
            >
              <button
                type="button"
                aria-pressed={!yearly}
                className={!yearly ? "is-active" : ""}
                onClick={() => setYearly(false)}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={yearly}
                className={yearly ? "is-active" : ""}
                onClick={() => setYearly(true)}
              >
                Yearly <span>Save up to 39%</span>
              </button>
            </div>
          </div>
          <div className="pe-plan-grid">
            <article className="pe-plan pe-plan--operator">
              <span className="pe-plan__label">
                For founders & teams{" "}
                <span className="pe-plan__recommend">
                  EVERY WORKFLOW INCLUDED
                </span>
              </span>
              <h2>Operator</h2>
              <p className="pe-plan__description">
                Find leads, send outreach and publish content.
              </p>
              <div className="pe-plan__price">
                {yearly ? "$490" : "$67"}
                <span>/{yearly ? "year" : "month"}</span>
              </div>
              <p className="pe-plan__billing">
                {yearly
                  ? "$490 billed yearly · $40.83/month equivalent"
                  : "$67 billed monthly · Cancel any time"}
              </p>
              <Button asChild variant="cta" className="pe-button">
                <Link to="/get-started">
                  Build my free preview <ArrowRight size={17} />
                </Link>
              </Button>
              <p className="pe-plan__trial">
                See your drafts before creating an account
              </p>
              <FeatureList items={operatorFeatures} />
            </article>
            <article className="pe-plan">
              <span className="pe-plan__label">
                For agencies & client workspaces
              </span>
              <h2>White-label</h2>
              <p className="pe-plan__description">
                Offer ACA under your own brand.
              </p>
              <div className="pe-plan__price">
                {yearly ? "$2,490" : "$297"}
                <span>/{yearly ? "year" : "month"}</span>
              </div>
              <p className="pe-plan__billing">
                {yearly
                  ? "$2,490 billed yearly · $207.50/month equivalent"
                  : "$297 billed monthly · Cancel any time"}
              </p>
              <Button asChild variant="outline" className="pe-button">
                <Link to="/auth">
                  Start white-label <ArrowRight size={17} />
                </Link>
              </Button>
              <p className="pe-plan__trial">
                Operator plus your client-facing platform
              </p>
              <FeatureList items={agencyFeatures} />
            </article>
            <article className="pe-plan">
              <span className="pe-plan__label">
                For businesses that want it managed
              </span>
              <h2>Done-for-you</h2>
              <p className="pe-plan__description">
                Our team builds and runs your system.
              </p>
              <div className="pe-plan__price pe-plan__price--custom">
                Custom
              </div>
              <p className="pe-plan__billing">
                Scope and price agreed with our team
              </p>
              <Button asChild variant="outline" className="pe-button">
                <a
                  href="https://api.leadconnectorhq.com/widget/bookings/yt-get-leads-and-sales"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discuss my acquisition setup <ArrowRight size={17} />
                </a>
              </Button>
              <p className="pe-plan__trial">
                A plan built around your business
              </p>
              <FeatureList items={serviceFeatures} />
            </article>
          </div>
          <article className="pe-plan pe-plan--selfhost">
            <div className="pe-plan--selfhost__head">
              <span className="pe-plan__label">
                For developers & high-volume senders{" "}
                <span className="pe-plan__recommend">CODE RELEASE SOON</span>
              </span>
              <h2>Self-hosted</h2>
              <p className="pe-plan__description">
                Run ACA on your own servers, with no limits from us.
              </p>
              <div className="pe-plan__price">
                $0<span>/forever</span>
              </div>
              <p className="pe-plan__billing">
                Source available · FSL-1.1-ALv2, Apache 2.0 after two years
              </p>
              <Button asChild variant="outline" className="pe-button">
                <a href={ACA_GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  <Github size={17} /> Watch the repo on GitHub
                </a>
              </Button>
            </div>
            <FeatureList items={selfHostedFeatures} />
          </article>
          <p className="pe-plan-note">
            External providers apply their own charges, account limits and
            sending policies. Unlimited ACA usage does not remove those limits.
          </p>
        </section>
        <PricingPreview />
        <section className="pe-savings-section" id="savings">
          <div className="pe-wrap">
            <header className="pe-section-heading">
              <h2>What are your tools costing you?</h2>
              <p>
                Tick the subscriptions ACA could replace. Enter what you pay
                each month.
              </p>
            </header>
            <PricingStackCalculator
              yearly={yearly}
              onBillingChange={setYearly}
            />
          </div>
        </section>
        <section className="pe-comparison pe-wrap">
          <header className="pe-section-heading">
            <h2>
              Same acquisition platform.
              <br />
              <em>Different ways to run it.</em>
            </h2>
          </header>
          <div
            className="pe-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Plan comparison"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">What you need</th>
                  <th scope="col">Operator</th>
                  <th scope="col">White-label</th>
                  <th scope="col">Done-for-you</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map(([label, ...values]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {values.map((value, index) => (
                      <td key={index}>
                        {value === "Included" ? (
                          <span className="pe-table-check">
                            <Check size={16} />
                            <span className="sr-only">Included</span>
                          </span>
                        ) : value === "—" ? (
                          <>
                            <Minus size={14} />
                            <span className="sr-only">Not included</span>
                          </>
                        ) : (
                          value
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="pe-provider pe-wrap">
          <div>
            <h2>What costs extra?</h2>
            <p>
              The ACA subscription pays for the platform. You bring your own
              keys, and your providers bill for the services you connect and
              use. ACA adds no markup to AI tokens.
            </p>
          </div>
          <dl>
            <div>
              <dt>AI & media generation</dt>
              <dd>Model tokens, images, video and voice usage.</dd>
            </div>
            <div>
              <dt>Data & enrichment</dt>
              <dd>Contact data, scraping and verification usage.</dd>
            </div>
            <div>
              <dt>Sending infrastructure</dt>
              <dd>Domains, mailboxes, tenant licences and sender services.</dd>
            </div>
          </dl>
        </section>
        <section className="pe-features pe-wrap">
          <header className="pe-section-heading">
            <h2>All acquisition tools. Included in every plan.</h2>
            <p>Expand a workflow to see what is included in the platform.</p>
          </header>
          <div className="pe-feature-grid">
            {features.map((feature, index) => (
              <details className="pe-feature" key={feature.title}>
                <summary>
                  <span className="pe-feature__number">0{index + 1}</span>
                  <span>
                    <strong>{feature.title}</strong>
                    <small>{feature.description}</small>
                  </span>
                  <ChevronDown size={18} />
                </summary>
                <FeatureList items={feature.items} />
              </details>
            ))}
          </div>
        </section>
        <section className="pe-connections pe-wrap">
          <div>
            <h2>Connect the providers you use.</h2>
            <p>AI, data, content, CRM and email infrastructure.</p>
            <Link className="pe-text-link" to="/#integrations">
              Explore all integrations <ArrowRight size={17} />
            </Link>
          </div>
          <div className="pe-brand-grid">
            {(
              [
                "OpenRouter",
                "OpenAI",
                "Replicate",
                "ElevenLabs",
                "Apify",
                "GoHighLevel",
                "Notion",
                "Microsoft 365",
                "ZapMail",
              ] as const
            ).map((name) => (
              <BrandMark
                key={name}
                name={name}
                surface="light"
                layout="symbol"
              />
            ))}
          </div>
        </section>
        <section className="pe-faq pe-wrap">
          <header className="pe-section-heading">
            <h2>Pricing questions.</h2>
          </header>
          <div className="pe-faq-list">
            {questions.map((question) => (
              <details key={question.q}>
                <summary>
                  {question.q}
                  <ChevronDown size={18} />
                </summary>
                <p>{question.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="pe-final">
          <div className="pe-wrap">
            <h2>
              See what ACA would create
              <br />
              <em>for your business.</em>
            </h2>
            <p>
              Get a useful draft first. Create an account when you’re ready.
              <br />
              Operator is $67/month or $490/year. Your team included.
            </p>
            <Button asChild variant="cta" className="pe-button">
              <Link to="/get-started">
                Build my free preview <ArrowRight size={17} />
              </Link>
            </Button>
            <small>
              Provider usage and infrastructure are billed separately.
            </small>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
