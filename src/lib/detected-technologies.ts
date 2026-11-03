/**
 * Catalog of technologies/ad-pixels the analyzer can detect from a website.
 *
 * Must stay in sync with the signature names in
 * `supabase/functions/_shared/tech-detector.ts` (the edge runtime can't be
 * imported into the frontend, so the names are mirrored here). These are used to
 * populate the "Detected Technology / Pixels" filter so users can select any
 * detectable technology even before many leads have been analyzed.
 */
export const DETECTABLE_TECHNOLOGIES: string[] = [
  // Advertising / retargeting pixels
  "Meta Pixel",
  "Google Ads",
  "LinkedIn Insight Tag",
  "TikTok Pixel",
  "Microsoft/Bing Ads (UET)",
  "Twitter/X Pixel",
  "Pinterest Tag",
  "Reddit Pixel",
  "Snapchat Pixel",
  "Taboola",
  "Outbrain",
  "DoubleClick",
  // Analytics / tag management
  "Google Analytics 4",
  "Google Tag Manager",
  "Segment",
  "Hotjar",
  "Microsoft Clarity",
  "Mixpanel",
  "Amplitude",
  "Plausible",
  // Marketing / CRM automation
  "HubSpot",
  "Marketo",
  "Salesforce Pardot",
  "ActiveCampaign",
  "Klaviyo",
  "Mailchimp",
  "Marketo/Adobe",
  // CMS / website builders
  "WordPress",
  "Shopify",
  "Wix",
  "Squarespace",
  "Webflow",
  "Framer",
  "Ghost",
  "Duda",
  "GoDaddy Website Builder",
  "HubSpot CMS",
  "Drupal",
  // Ecommerce
  "WooCommerce",
  "Magento",
  "BigCommerce",
  // Chat / support
  "Intercom",
  "Drift",
  "Zendesk",
  "Tawk.to",
  "Crisp",
  "LiveChat",
];
