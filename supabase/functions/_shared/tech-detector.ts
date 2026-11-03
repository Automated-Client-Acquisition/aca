/**
 * Website technology & marketing-signal detector.
 *
 * Scans the RAW HTML of a page (must be run BEFORE scripts are stripped) for
 * signatures of advertising pixels, analytics, marketing/CRM automation, CMS /
 * site builders, ecommerce, and chat widgets.
 *
 * The advertising pixels are the authoritative signal for "do they run paid ads":
 * a company embeds a Meta Pixel / Google Ads tag / LinkedIn Insight tag ONLY when
 * it is actively running (or retargeting from) paid campaigns on that network.
 *
 * Signature-based (like a lightweight Wappalyzer). Precision is favoured over
 * recall — each pattern is chosen to avoid false positives.
 */

export type TechCategory =
  | 'advertising'
  | 'analytics'
  | 'marketing'
  | 'cms'
  | 'ecommerce'
  | 'chat';

interface Signature {
  name: string;
  category: TechCategory;
  patterns: RegExp[];
}

// Ordered roughly by sales-intelligence value. Patterns are matched against raw HTML.
const SIGNATURES: Signature[] = [
  // ── Advertising / retargeting pixels (⇒ actively running paid ads) ──
  { name: 'Meta Pixel', category: 'advertising', patterns: [/connect\.facebook\.net\/[^"']*\/fbevents\.js/i, /fbq\s*\(\s*['"]init['"]/i] },
  { name: 'Google Ads', category: 'advertising', patterns: [/googleadservices\.com/i, /google_conversion_id/i, /gtag\/js\?id=AW-/i, /['"]send_to['"]\s*:\s*['"]AW-/i, /\bAW-\d{6,}/] },
  { name: 'LinkedIn Insight Tag', category: 'advertising', patterns: [/snap\.licdn\.com/i, /_linkedin_partner_id/i] },
  { name: 'TikTok Pixel', category: 'advertising', patterns: [/analytics\.tiktok\.com/i, /ttq\.(load|track)\s*\(/i] },
  { name: 'Microsoft/Bing Ads (UET)', category: 'advertising', patterns: [/bat\.bing\.com/i, /\buetq\b/i] },
  { name: 'Twitter/X Pixel', category: 'advertising', patterns: [/static\.ads-twitter\.com/i, /twq\s*\(/i] },
  { name: 'Pinterest Tag', category: 'advertising', patterns: [/s\.pinimg\.com\/ct/i, /pintrk\s*\(/i] },
  { name: 'Reddit Pixel', category: 'advertising', patterns: [/rdt\s*\(\s*['"]init['"]/i, /redditstatic\.com\/ads/i] },
  { name: 'Snapchat Pixel', category: 'advertising', patterns: [/sc-static\.net\/scevent/i, /snaptr\s*\(/i] },
  { name: 'Taboola', category: 'advertising', patterns: [/cdn\.taboola\.com/i, /_tfa\b/i] },
  { name: 'Outbrain', category: 'advertising', patterns: [/outbrain\.com\/outbrain\.js/i, /obApi\s*\(/i] },
  { name: 'DoubleClick', category: 'advertising', patterns: [/doubleclick\.net/i, /fls\.doubleclick/i] },

  // ── Analytics / tag management ──
  { name: 'Google Analytics 4', category: 'analytics', patterns: [/gtag\/js\?id=G-/i, /\bG-[A-Z0-9]{6,}\b/, /google-analytics\.com\/(analytics|g\/collect)/i] },
  { name: 'Google Tag Manager', category: 'analytics', patterns: [/googletagmanager\.com\/gtm\.js/i, /GTM-[A-Z0-9]{5,}/] },
  { name: 'Segment', category: 'analytics', patterns: [/cdn\.segment\.com\/analytics\.js/i, /analytics\.load\s*\(/i] },
  { name: 'Hotjar', category: 'analytics', patterns: [/static\.hotjar\.com/i, /\bhj\s*\(/i] },
  { name: 'Microsoft Clarity', category: 'analytics', patterns: [/clarity\.ms\/tag/i, /\bclarity\s*\(\s*['"]/i] },
  { name: 'Mixpanel', category: 'analytics', patterns: [/cdn\.mxpnl\.com/i] },
  { name: 'Amplitude', category: 'analytics', patterns: [/cdn\.amplitude\.com/i, /amplitude\.getInstance/i] },
  { name: 'Plausible', category: 'analytics', patterns: [/plausible\.io\/js/i] },

  // ── Marketing / CRM automation (buying signal for outbound sophistication) ──
  { name: 'HubSpot', category: 'marketing', patterns: [/js\.hs-scripts\.com/i, /js\.hs-analytics\.net/i, /hsforms\.(net|com)/i] },
  { name: 'Marketo', category: 'marketing', patterns: [/munchkin\.marketo(static)?\.(net|com)/i, /Munchkin\.init/i] },
  { name: 'Salesforce Pardot', category: 'marketing', patterns: [/pardot\.com/i, /pi\.pardot/i] },
  { name: 'ActiveCampaign', category: 'marketing', patterns: [/[a-z0-9]+\.activehosted\.com/i, /trackcmp\.net/i] },
  { name: 'Klaviyo', category: 'marketing', patterns: [/static\.klaviyo\.com/i, /klaviyo\.js/i] },
  { name: 'Mailchimp', category: 'marketing', patterns: [/chimpstatic\.com/i, /list-manage\.com/i, /mc\.us\d+\.list-manage/i] },
  { name: 'Marketo/Adobe', category: 'marketing', patterns: [/omtrdc\.net/i] },

  // ── CMS / website builders ──
  { name: 'WordPress', category: 'cms', patterns: [/\/wp-content\//i, /\/wp-includes\//i, /name=["']generator["'][^>]*WordPress/i] },
  { name: 'Shopify', category: 'cms', patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /myshopify\.com/i] },
  { name: 'Wix', category: 'cms', patterns: [/static\.wixstatic\.com/i, /wix\.com/i, /_wixCssStates/i] },
  { name: 'Squarespace', category: 'cms', patterns: [/static1\.squarespace\.com/i, /squarespace\.com/i, /Static\.SQUARESPACE_CONTEXT/i] },
  { name: 'Webflow', category: 'cms', patterns: [/assets\.website-files\.com/i, /webflow\.js/i, /data-wf-(site|page)/i] },
  { name: 'Framer', category: 'cms', patterns: [/framerusercontent\.com/i, /framer\.com/i] },
  { name: 'Ghost', category: 'cms', patterns: [/content=["']Ghost[^"']*["']/i, /ghost\.io/i] },
  { name: 'Duda', category: 'cms', patterns: [/irp\.cdn-website\.com/i, /dudaone/i] },
  { name: 'GoDaddy Website Builder', category: 'cms', patterns: [/img\d?\.wsimg\.com/i] },
  { name: 'HubSpot CMS', category: 'cms', patterns: [/hs-sites\.com/i, /hubspotusercontent/i] },
  { name: 'Drupal', category: 'cms', patterns: [/name=["']generator["'][^>]*Drupal/i, /\/sites\/default\/files\//i] },

  // ── Ecommerce ──
  { name: 'WooCommerce', category: 'ecommerce', patterns: [/woocommerce/i, /wc-ajax/i] },
  { name: 'Magento', category: 'ecommerce', patterns: [/\/static\/version\d+\/frontend\//i, /Magento_/i] },
  { name: 'BigCommerce', category: 'ecommerce', patterns: [/cdn\d*\.bigcommerce\.com/i] },

  // ── Chat / support widgets ──
  { name: 'Intercom', category: 'chat', patterns: [/widget\.intercom\.io/i, /intercomSettings/i] },
  { name: 'Drift', category: 'chat', patterns: [/js\.driftt\.com/i, /drift\.load/i] },
  { name: 'Zendesk', category: 'chat', patterns: [/static\.zdassets\.com/i, /zendesk/i] },
  { name: 'Tawk.to', category: 'chat', patterns: [/embed\.tawk\.to/i] },
  { name: 'Crisp', category: 'chat', patterns: [/client\.crisp\.chat/i] },
  { name: 'LiveChat', category: 'chat', patterns: [/cdn\.livechatinc\.com/i] },
];

const CATEGORY_ORDER: TechCategory[] = ['advertising', 'marketing', 'cms', 'ecommerce', 'analytics', 'chat'];

export interface TechSignals {
  advertising: string[];
  analytics: string[];
  marketing: string[];
  cms: string[];
  ecommerce: string[];
  chat: string[];
  all: string[]; // flat union of every detected name — used for single-shot filtering
  total: number;
  runs_paid_ads: boolean; // true if any advertising pixel was found
}

/**
 * Detect technologies from raw page HTML. Returns names grouped by category.
 * Safe on empty/undefined input.
 */
export function detectTechnologies(html: string | null | undefined): TechSignals {
  const result: TechSignals = {
    advertising: [], analytics: [], marketing: [], cms: [], ecommerce: [], chat: [],
    all: [], total: 0, runs_paid_ads: false,
  };
  if (!html) return result;

  // Cap the scan window to keep regex cost bounded on huge pages.
  const hay = html.length > 400_000 ? html.slice(0, 400_000) : html;

  for (const sig of SIGNATURES) {
    if (result[sig.category].includes(sig.name)) continue;
    if (sig.patterns.some((p) => p.test(hay))) {
      result[sig.category].push(sig.name);
    }
  }

  result.advertising.sort();
  result.all = CATEGORY_ORDER.flatMap((c) => result[c]);
  result.total = result.all.length;
  result.runs_paid_ads = result.advertising.length > 0;
  return result;
}

/**
 * Render detected signals as a prompt section the LLM can reason over. Returns
 * '' when nothing was detected. The advertising line is phrased as the
 * authoritative answer to "do they run paid ads".
 */
export function renderTechSignalsForPrompt(t: TechSignals | null | undefined): string {
  if (!t || t.total === 0) return '';
  const parts: string[] = [
    '--- DETECTED WEBSITE TECHNOLOGY (factual — parsed from tracking scripts/tags on their live site) ---',
  ];
  if (t.advertising.length) {
    parts.push(`Advertising / retargeting pixels: ${t.advertising.join(', ')} — CONCLUSIVE evidence they run paid ads on ${t.advertising.length > 1 ? 'these networks' : 'this network'}.`);
  } else {
    parts.push('Advertising / retargeting pixels: none detected — no on-site evidence of paid ads (they may still advertise without a pixel).');
  }
  if (t.marketing.length) parts.push(`Marketing / CRM automation: ${t.marketing.join(', ')}`);
  if (t.cms.length) parts.push(`Website platform / CMS: ${t.cms.join(', ')}`);
  if (t.ecommerce.length) parts.push(`Ecommerce: ${t.ecommerce.join(', ')}`);
  if (t.analytics.length) parts.push(`Analytics / tag management: ${t.analytics.join(', ')}`);
  if (t.chat.length) parts.push(`Chat / support: ${t.chat.join(', ')}`);
  return '\n\n' + parts.join('\n');
}
