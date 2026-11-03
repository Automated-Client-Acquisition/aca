import { useState } from "react";
import { ArrowRight, KeyRound } from "lucide-react";
import {
  SiAlibabacloud,
  SiBackblaze,
  SiGoogle,
  SiOllama,
  SiPexels,
  SiPorkbun,
  SiYoutube,
} from "react-icons/si";
import {
  GmailIcon,
  OutlookIcon,
  MessengerIcon,
  TwitterXIcon,
} from "@/components/marketing/BrandIcons";
import {
  integrationCatalog,
  integrationCategories,
  type IntegrationBrandName,
  type IntegrationCategory,
} from "@/components/marketing/home/integrationCatalog";
import "@/styles/acquisition-integrations.css";

export type { IntegrationBrandName } from "@/components/marketing/home/integrationCatalog";

const brandAssets: Partial<
  Record<IntegrationBrandName, { src: string; light?: boolean }>
> = {
  LinkedIn: { src: "/logos/linkedin.svg" },
  WhatsApp: { src: "/logos/whatsapp.svg" },
  Instagram: { src: "/logos/instagram.svg" },
  Telegram: { src: "/logos/telegram.svg" },
  GoHighLevel: { src: "/integrations/highlevel.svg" },
  Notion: { src: "/logos/notion.svg", light: true },
  OpenRouter: { src: "/logos/openrouter.svg" },
  OpenAI: { src: "/logos/openai.svg", light: true },
  Replicate: { src: "/logos/replicate.svg", light: true },
  ElevenLabs: { src: "/logos/elevenlabs.svg", light: true },
  Apollo: { src: "/logos/apollo.svg", light: true },
  Prospeo: { src: "/logos/prospeo.svg" },
  Smartlead: { src: "/logos/smartlead.svg" },
  Instantly: { src: "/logos/instantly.svg" },
  WordPress: { src: "/logos/wordpress.svg" },
  Cloudflare: { src: "/logos/cloudflare.svg" },
  "Cloudflare R2": { src: "/logos/cloudflare.svg" },
  "Amazon S3": { src: "/logos/amazons3.svg" },
  "Microsoft 365": { src: "/integrations/vendor-microsoft.png" },
  Hunter: { src: "/integrations/vendor-hunter.svg" },
  QuickEnrich: { src: "/integrations/vendor-quickenrich.png" },
  MoltSets: { src: "/integrations/vendor-moltsets.svg" },
  ZapMail: { src: "/integrations/vendor-zapmail.svg" },
  "Mailtester Ninja": { src: "/integrations/vendor-mailtester-ninja.png" },
  HeyGen: { src: "/integrations/vendor-heygen.png" },
  Unipile: { src: "/integrations/vendor-unipile.svg" },
  LeadConnector: { src: "/integrations/vendor-leadconnector.png" },
  "Success.ai": { src: "/integrations/vendor-successai.svg" },
  Apify: { src: "/integrations/vendor-apify.svg" },
};

const brandIcons = {
  Gmail: { icon: GmailIcon, color: "#EA4335" },
  Outlook: { icon: OutlookIcon, color: "#0078D4" },
  Messenger: { icon: MessengerIcon, color: "#0866FF" },
  X: { icon: TwitterXIcon, color: "#141414" },
  Ollama: { icon: SiOllama, color: "#141414" },
  "Alibaba Cloud": { icon: SiAlibabacloud, color: "#FF6A00" },
  YouTube: { icon: SiYoutube, color: "#FF0033" },
  Pexels: { icon: SiPexels, color: "#05A081" },
  Porkbun: { icon: SiPorkbun, color: "#C55A76" },
  "Google Indexing": { icon: SiGoogle, color: "#4285F4" },
  "Backblaze B2": { icon: SiBackblaze, color: "#E21E29" },
};

const lightSurfaceAssets: Partial<Record<IntegrationBrandName, string>> = {
  GoHighLevel: "/integrations/highlevel-on-light.svg",
  ZapMail: "/integrations/zapmail-on-light.svg",
  Unipile: "/integrations/unipile-on-light.svg",
  Instantly: "/integrations/instantly-on-light.svg",
  OpenRouter: "/integrations/openrouter-on-light.svg",
};

// The viewport isolates each existing vendor symbol without redrawing its geometry.
const symbolViewports: Partial<
  Record<
    IntegrationBrandName,
    { viewBox: string; width: number; height: number }
  >
> = {
  GoHighLevel: { viewBox: "0 0 31 38", width: 172, height: 38 },
  Smartlead: { viewBox: "0 0 40 41", width: 189, height: 41 },
  Instantly: { viewBox: "0 0 32 32", width: 145, height: 32 },
  Prospeo: { viewBox: "0 0 32 32", width: 145, height: 32 },
  "Microsoft 365": { viewBox: "0 0 46 46", width: 216, height: 46 },
  ZapMail: { viewBox: "0 3 36 34", width: 171, height: 44 },
  Hunter: { viewBox: "0 0 120 116.24", width: 653.08002, height: 116.24 },
  QuickEnrich: { viewBox: "8 8 140 192", width: 1020, height: 211 },
  Unipile: { viewBox: "0 10 80 45", width: 300, height: 65 },
  LeadConnector: { viewBox: "0 0 1520 1726", width: 7844, height: 1726 },
  HeyGen: { viewBox: "183 22 95 94", width: 306, height: 214 },
};

/** Existing authentic marks; the directory uses a light-surface rendering. */
export function BrandMark({
  name,
  showName = true,
  className = "",
  surface = "default",
  layout = "brand",
}: {
  name: IntegrationBrandName;
  showName?: boolean;
  className?: string;
  surface?: "default" | "light";
  layout?: "brand" | "symbol";
}) {
  const asset = brandAssets[name];
  const iconEntry = brandIcons[name as keyof typeof brandIcons];
  const Icon = iconEntry?.icon;
  const symbol = layout === "symbol" ? symbolViewports[name] : undefined;
  const source =
    surface === "light" ? (lightSurfaceAssets[name] ?? asset?.src) : asset?.src;
  const wordmark =
    layout !== "symbol" &&
    [
      "Microsoft 365",
      "GoHighLevel",
      "Smartlead",
      "Instantly",
      "Prospeo",
      "Hunter",
      "QuickEnrich",
      "ZapMail",
      "Unipile",
      "LeadConnector",
    ].includes(name);
  return (
    <span
      className={`integration-brand${wordmark ? " integration-brand--wordmark" : ""}${layout === "symbol" ? " integration-brand--symbol" : ""}${surface === "light" ? " integration-brand--on-light" : ""} ${className}`}
      aria-label={showName ? undefined : name}
      data-brand={name}
    >
      {Icon ? (
        <Icon
          className="integration-brand__icon"
          width={26}
          height={26}
          aria-hidden="true"
          style={{ color: iconEntry.color }}
        />
      ) : symbol && source ? (
        <svg
          className="integration-brand__icon"
          viewBox={symbol.viewBox}
          width={26}
          height={26}
          aria-hidden="true"
          focusable="false"
        >
          <image href={source} width={symbol.width} height={symbol.height} />
        </svg>
      ) : asset ? (
        <img
          src={source}
          alt=""
          aria-hidden="true"
          className={`integration-brand__icon${asset.light ? " integration-brand__icon--light" : ""}`}
          width={wordmark ? 112 : 26}
          height={26}
          loading="lazy"
          decoding="async"
          style={{ objectFit: "contain" }}
        />
      ) : null}
      {showName && (
        <span
          className={wordmark && asset ? "sr-only" : "integration-brand__name"}
        >
          {name}
        </span>
      )}
    </span>
  );
}

export function IntegrationBrands({
  expanded = false,
  className = "",
}: {
  expanded?: boolean;
  className?: string;
}) {
  const [category, setCategory] = useState<IntegrationCategory | "all">("all");
  // "All" opens on a first dozen so 40 tiles don't stack into a page of their
  // own on a phone; the category filters always show their full list.
  const [showAll, setShowAll] = useState(false);
  const visible = integrationCatalog.filter(
    (item) => category === "all" || item.category === category,
  );
  const shown =
    category === "all" && !showAll ? visible.slice(0, 12) : visible;
  const featured = integrationCatalog.filter(
    (item) => "featured" in item && item.featured,
  );
  if (!expanded) {
    return (
      <section
        className={`acq-stack ${className}`}
        aria-labelledby="stack-title"
      >
        <div className="acq-stack__heading">
          <h2 id="stack-title">Your stack. Connected.</h2>
          <a href="#integrations">
            Explore {integrationCatalog.length} connections{" "}
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        </div>
        <ul className="acq-stack__logos" aria-label="Selected ACA integrations">
          {featured.map((item) => (
            <li key={item.name}>
              <BrandMark name={item.name} surface="light" layout="symbol" />
            </li>
          ))}
        </ul>
      </section>
    );
  }
  return (
    <div className={`acq-directory ${className}`}>
      <div className="acq-directory__toolbar">
        <div
          className="acq-directory__filters"
          role="group"
          aria-label="Filter integrations by category"
        >
          {[
            { id: "all", label: "All connections" },
            ...integrationCategories,
          ].map((item) => {
            const count =
              item.id === "all"
                ? integrationCatalog.length
                : integrationCatalog.filter(
                    (entry) => entry.category === item.id,
                  ).length;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={category === item.id}
                onClick={() =>
                  setCategory(item.id as IntegrationCategory | "all")
                }
                aria-controls="integration-results"
              >
                {item.label}
                <span>{count}</span>
              </button>
            );
          })}
        </div>
        <p
          className="acq-directory__summary"
          aria-live="polite"
          aria-atomic="true"
        >
          {category === "all"
            ? "Connect the tools you use. Choose the providers you trust."
            : integrationCategories.find((item) => item.id === category)
                ?.description}
          <span>{visible.length} connections</span>
        </p>
      </div>
      <ul
        className="acq-directory__cards"
        id="integration-results"
        aria-label="Available ACA connections"
      >
        {shown.map((item) => (
          <li key={item.name} className="acq-directory__card">
            <div className="acq-directory__mark" aria-hidden="true">
              <BrandMark
                name={item.name}
                showName={false}
                surface="light"
                layout="symbol"
              />
            </div>
            <div className="acq-directory__details">
              <strong className="acq-directory__name">{item.name}</strong>
              <p>{item.purpose}</p>
            </div>
          </li>
        ))}
      </ul>
      {shown.length < visible.length && (
        <button
          type="button"
          className="acq-directory__more"
          aria-controls="integration-results"
          onClick={() => setShowAll(true)}
        >
          Show all {visible.length} connections
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}
      <div className="acq-directory__billing">
        <KeyRound size={17} aria-hidden="true" />
        <p>
          <strong>Your accounts. Your API keys.</strong> Provider subscriptions,
          usage costs and limits apply separately.
        </p>
      </div>
    </div>
  );
}
