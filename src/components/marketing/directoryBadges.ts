/**
 * Third-party directory listings ("Featured on …") shown as a small strip in the
 * MARKETING footer only. Never render these inside the authenticated app.
 *
 * `rel` / `title` / `target` are kept exactly as each directory issued them:
 * their verifiers check for the specific attributes (e.g. rel="dofollow").
 * index.html carries a static copy of the same links for crawlers that don't run
 * JS — keep the two in sync when adding a listing.
 */
export interface DirectoryBadge {
  href: string;
  /** Defaults to "_blank". Some directories issue their snippet with no target. */
  target?: string | null;
  rel?: string;
  title?: string;
  /** Badge image. Omit for text-only listings. */
  src?: string;
  alt?: string;
  /** Link text for text-only listings. */
  text?: string;
}

export const DIRECTORY_BADGES: DirectoryBadge[] = [
  { href: "https://marketingdb.live", rel: "noopener noreferrer", src: "https://marketingdb.live/badge.svg", alt: "Listed on MarketingDB" },
  { href: "https://launch01.com/projects/automated-client-acquisition-aca?utm_source=badge", rel: "noopener noreferrer", src: "https://r2.direasy-multi-tenant.focusapps.app/uploads/616d0b1a-3979-4b8c-94d1-b4f1fedd3ead/1782997254784/3uiqk91geh6/featured-on-light.svg", alt: "Featured on Launch01" },
  { href: "https://saashunt.best/projects/nurtureflow?utm_source=badge", rel: "noopener noreferrer", src: "https://saashunt.best/images/badges/featured-on-light.svg", alt: "Featured on SaasHunt" },
  { href: "https://twelve.tools", rel: "noopener noreferrer", src: "https://twelve.tools/badge0-white.svg", alt: "Featured on Twelve Tools" },
  { href: "https://wired.business", rel: "noopener noreferrer", src: "https://wired.business/badge0-white.svg", alt: "Featured on Wired Business" },
  { href: "https://openhunts.com", title: "OpenHunts Club", src: "https://cdn.openhunts.com/badges/club.webp", alt: "OpenHunts Club Member" },
  { href: "https://aitop10.tools/", rel: "noopener noreferrer", text: "AiTop10 Tools" },
  { href: "https://neeed.directory/products/aca-automated-client-acquisition?utm_source=aca-automated-client-acquisition", rel: "noopener noreferrer", src: "https://neeed.directory/badges/neeed-badge-light.svg", alt: "Featured on neeed.directory" },
  { href: "https://indieai.directory/", rel: "noopener", text: "Listed on IndieAI Directory" },
  { href: "https://saasfame.com/item/automated-client-acquisition", rel: "noopener noreferrer", src: "https://saasfame.com/badge-light.svg", alt: "Featured on saasfame.com" },
  { href: "https://newtools.site/item/automated-client-acquisition", rel: "noopener noreferrer", src: "https://newtools.site/badges/newtool-light.png", alt: "Featured on NewTools.site" },
  { href: "https://smollaunch.com", rel: "noopener", src: "https://smollaunch.com/badges/featured.svg", alt: "ACA: Automated Client Acquisition — Featured on Smol Launch" },
  { href: "https://www.launchvault.dev", title: "Featured on LaunchVault", src: "https://www.launchvault.dev/images/badges/launch-valut-badge.svg", alt: "Featured on LaunchVault" },
  { href: "https://productfame.com", rel: "noopener noreferrer", src: "https://productfame.com/badges/featured-light.svg", alt: "Featured on ProductFame" },
  { href: "https://launchstreak.dev/marketing/aca-automated-client-acquisition", rel: "noopener", src: "https://launchstreak.dev/badge/launch-streak-badge-light.svg", alt: "Launched on Launch Streak" },
  { href: "https://codehype.ai/product/aca-client-acquisition?utm_source=codehype_badge", rel: "noopener noreferrer", src: "https://codehype.ai/badges/aca-client-acquisition.svg?variant=find-us&v=20", alt: "Featured on CodeHype" },
  { href: "https://fastlaunch.io", rel: "noopener", src: "https://fastlaunch.io/images/badges/featured-dark.svg", alt: "Featured on FastLaunch" },
  { href: "https://aibesttop.com", rel: "noopener noreferrer", src: "https://aibesttop.com/badges/light.svg", alt: "Listed on AIBestTop" },
  { href: "https://aihuntlist.com/tool/aca-client-acquisition", rel: "noopener noreferrer", src: "https://aihuntlist.com/badge-light.svg", alt: "Featured on aihuntlist.com" },
  { href: "https://aiagentsdirectory.com/agent/aca-automated-client-acquisition", rel: "noopener", title: "Discover ACA: Automated Client Acquisition on AI Agents Directory", src: "https://aiagentsdirectory.com/featured-badge.svg?v=2024", alt: "ACA: Automated Client Acquisition - Featured on AI Agents Directory" },
  { href: "https://earlyhunt.com/project/aca-automated-client-acquisition", rel: "noopener", src: "https://earlyhunt.com/badges/earlyhunt-badge-light.svg", alt: "Featured on EarlyHunt" },
  { href: "https://aitoolsmarketer.com/", target: null, src: "https://aitoolsmarketer.com/badges/badge-dark.svg", alt: "Featured on AI Tools for Marketers" },
  { href: "https://www.foundrlist.com/product/acaautomatedclientacquisition?utm_source=badge&utm_medium=embed", rel: "noopener", src: "https://www.foundrlist.com/api/badge/acaautomatedclientacquisition", alt: "Featured on FoundrList" },
  { href: "https://aitoolhunt.co/item/aca-client-acquisition", rel: "noopener noreferrer", src: "https://aitoolhunt.co/badge-listed-light.svg", alt: "Listed on AIToolHunt" },
  { href: "https://ailaunch.space/", rel: "noopener noreferrer", src: "https://ailaunch.space/assets/badges/featured.svg", alt: "Featured on AILaunchSpace" },
  { href: "https://dang.ai", rel: "dofollow noopener", src: "https://assets.dang.ai/badges/dang-verified-dark.png", alt: "Verified on DANG!" },
  { href: "https://daniellaunches.com", src: "https://daniellaunches.com/badge-light.svg", alt: "Featured on DanielLaunches" },
  { href: "https://www.aitoolzdir.com", text: "AI Toolz Dir" },
  { href: "https://dailypings.com/p/aca-automated-client-acquisition", rel: "noopener", title: "Featured on DailyPings", src: "https://dailypings.com/badge.svg", alt: "Featured on DailyPings" },
  { href: "https://collectai.tools/item/aca-automated-client-acq", rel: "dofollow", src: "https://img.collectai.tools/badge-light.svg", alt: "Listed on CollectAI" },
  { href: "https://auraplusplus.com/projects/aca-automated-client-acquisition", rel: "noopener", title: "View this project on Aura++", src: "https://auraplusplus.com/images/badges/featured-on-light.svg", alt: "Featured on Aura++" },
  { href: "https://www.aitoolsaver.com", rel: "noopener noreferrer", src: "https://www.aitoolsaver.com/images/badges/featured-on-aitoolsaver-badge-brand-wide.svg", alt: "Featured on AiToolSaver" },
  { href: "https://www.toolpilot.ai", rel: "noopener noreferrer", src: "https://www.toolpilot.ai/cdn/shop/files/f-w_690x151_crop_center.png", alt: "Featured on ToolPilot" },
  { href: "https://uno.directory", rel: "noopener", src: "https://uno.directory/uno-directory.svg", alt: "Listed on Uno Directory" },
  { href: "https://sumodir.com", rel: "dofollow", src: "https://sumodir.com/badge.png", alt: "Featured on SumoDir" },
  { href: "https://www.vibe-coding.cloud/", target: null, rel: "nofollow", title: "Listed on Vibe Coding — AI tools directory", src: "https://www.vibe-coding.cloud/vibe-coding-badge.svg", alt: "Listed on Vibe Coding — AI tools directory" },
  { href: "https://goodaitools.com/ai/automatedclientacquisition", rel: "noopener noreferrer", src: "https://goodaitools.com/assets/images/badge.png", alt: "Good AI Tools" },
  { href: "https://dododirectory.com", rel: "dofollow", src: "https://dododirectory.com/badge-light.png", alt: "Featured on DodoDirectory" },
  { href: "https://saasbison.com", rel: "dofollow", src: "https://saasbison.com/badge.png", alt: "Featured on SaaSBison" },
  { href: "https://saasgrow.app?ref=automatedclientacquisition.com", rel: "noopener", src: "https://saasgrow.app/api/badge?type=featured&style=light", alt: "ACA: Automated Client Acquisition on SaaSGrow" },
  { href: "https://mylaunchstash.com/product/automatedclientacquisition", target: "_blank", src: "https://mylaunchstash.com/assets/images/badge.png", alt: "My Launch Stash" },
  // Bowora free launch verifies a link to its referral URL; its official badge is a large
  // styled block, so we keep only the required link as small text in the footer strip.
  { href: "https://bowora.com/?via=u02phdhc", target: "_blank", text: "Bowora" },
  { href: "https://indiehunt.io/project/aca-automated-client-acquisition", target: "_blank", rel: "noopener", src: "https://indiehunt.io/badges/indiehunt-badge-light.svg", alt: "Featured on IndieHunt" },
  { href: "https://launchclash.com/product/automatedclientacquisition", target: "_blank", src: "https://launchclash.com/assets/images/badge.png", alt: "LaunchClash" },
  { href: "https://huzzler.so/products/4UDtvfHUhG/aca-automated-client-acquisition?utm_source=huzzler_product_website&utm_medium=badge&utm_campaign=free_listing", target: "_blank", rel: "noopener noreferrer", src: "https://huzzler.so/assets/images/embeddable-badges/featured.png", alt: "Huzzler Embed Badge" },
  { href: "https://aitooltrek.com", text: "AI Tool Trek" },
  { href: "https://aihustle.tools", text: "AI Hustle" },
  { href: "https://showmebest.ai", text: "ShowMeBest" },
  { href: "https://www.startupfa.st", text: "Startup Fast" },
  { href: "https://kickproduct.com/products/6ab634972c148fdc117212c1", target: "_blank", rel: "noopener noreferrer", src: "https://www.kickproduct.com/listedbadge.png", alt: "Listed on Kick Product" },
  { href: "https://webspot.app", target: "_blank", rel: "noopener noreferrer", src: "https://webspot.app/featured-light.svg", alt: "Featured on Webspot" },
  { href: "https://thedevtoolsdir.com/product/aca-automated-client-acquisition?ref=badge", target: "_blank", rel: "dofollow", src: "https://thedevtoolsdir.com/badge/aca-automated-client-acquisition.svg", alt: "Featured on TheDevToolsDir" },
  { href: "https://www.stork.ai/", target: "_blank", rel: "noopener noreferrer", src: "https://www.stork.ai/badge/verified-light.svg", alt: "Stork Verified — stork.ai AI tools directory" },
  { href: "https://saascity.io", target: "_blank", rel: "noopener", src: "https://saascity.io/badges/featured-dark.svg", alt: "Featured on SaaSCity" },
  { href: "https://postmake.io/submit", target: "_blank", rel: "noopener", src: "https://postmake.io/postmake_badge_dark.png", alt: "Featured on the Postmake directory" },
  { href: "https://turbo0.com/item/aca-automated-acquisition", target: "_blank", rel: "noopener noreferrer", src: "https://img.turbo0.com/badge-listed-light.svg", alt: "Listed on Turbo0" },
  {
    href: "https://www.scrolllaunch.com/products/aca-automated-client-acquisition?ref=badge",
    target: "_blank",
    rel: "noopener",
    src: "https://www.scrolllaunch.com/api/badge/aca-automated-client-acquisition?variant=featured&theme=light",
    alt: "ACA: Automated Client Acquisition - Featured on ScrollLaunch",
  },
  {
    href: "https://shinylaunch.com/product/automatedclientacquisition",
    target: "_blank",
    rel: "noopener",
    src: "https://shinylaunch.com/assets/images/badge.png",
    alt: "ShinyLaunch",
  },
  { href: 'https://confettisaas.com/saas/automatedclientacquisition-com-2?ref=badge', target: '_blank', rel: 'noopener', src: 'https://confettisaas.com/badge-light.svg', alt: 'ACA: Automated Client Acquisition on ConfettiSaaS' },
  {
    href: "https://toolfame.com/item/aca-automated-client-acquisition",
    target: "_blank",
    rel: "noopener noreferrer",
    src: "https://toolfame.com/badge-light.svg",
    alt: "Featured on toolfame.com",
  },
  {
    href: "https://startuptrusted.com?ref=automatedclientacquisition.com",
    target: "_blank",
    rel: "noopener",
    src: "https://startuptrusted.com/api/badge?type=featured&style=light",
    alt: "ACA: Automated Client Acquisition",
  },
  { href: 'https://tooldirs.com', target: '_blank', rel: 'noopener', src: 'https://tooldirs.com/badge/badge_dark.svg', alt: 'Featured on ToolDirs' },
  { href: 'https://dofollow.tools', target: '_blank', rel: 'noopener', src: 'https://dofollow.tools/badge/badge_dark.svg', alt: 'Featured on Dofollow.Tools' },
  {
    href: "https://siteefy.com/tools/aca-automated-client-acquisition?utm_source=owner_badge",
    target: "_blank",
    rel: "nofollow",
    src: "https://siteefy.com/api/public/badge/aca-automated-client-acquisition?type=featured",
    alt: "ACA: Automated Client Acquisition on Siteefy",
  },
  // navfolders requires a dofollow link to its homepage to be live BEFORE its
  // verify-badge step unlocks the free route. No badge asset is issued, so this
  // is a text link, and the wording stays neutral because the listing does not
  // exist yet — never claim "Featured on" a board we are not on.
  { href: "https://navfolders.com", rel: "dofollow", text: "Navfolders" },
];
