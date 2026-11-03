import { useEffect } from "react";
import { useBranding } from "@/contexts/BrandingContext";

/**
 * DynamicMetadata component
 *
 * Updates document metadata (title, meta tags, favicon, OG tags) based on
 * the current branding configuration. This enables white-labeled experiences
 * where partners can customize how the app appears in browser tabs, search
 * results, and social media shares.
 */
export function DynamicMetadata() {
  const { branding, isLoading, isWhiteLabeled } = useBranding();

  useEffect(() => {
    if (isLoading) return;
    // ACA's own domains get per-page title/description/og tags from useSEO
    // (Helmet). Applying the default branding here would overwrite them on every
    // page with the generic "ACA - Automated Client Acquisition" string.
    if (!isWhiteLabeled) return;

    // Update document title
    const title = branding.meta_title ||
      (branding.tagline
        ? `${branding.app_name} - ${branding.tagline}`
        : branding.app_name);
    document.title = title;

    // Update meta description
    if (branding.meta_description) {
      updateMetaTag('description', branding.meta_description);
    }

    // Update Open Graph tags
    updateMetaTag('og:title', title, 'property');
    updateMetaTag('og:site_name', branding.app_name, 'property');

    if (branding.meta_description) {
      updateMetaTag('og:description', branding.meta_description, 'property');
    }

    if (branding.og_image_url) {
      updateMetaTag('og:image', branding.og_image_url, 'property');
    }

    // Update Twitter Card tags
    if (branding.twitter_handle) {
      updateMetaTag('twitter:site', branding.twitter_handle);
      updateMetaTag('twitter:creator', branding.twitter_handle);
    }

    updateMetaTag('twitter:title', title);

    if (branding.meta_description) {
      updateMetaTag('twitter:description', branding.meta_description);
    }

    if (branding.og_image_url) {
      updateMetaTag('twitter:image', branding.og_image_url);
      updateMetaTag('twitter:card', 'summary_large_image');
    }

    // Update favicon
    if (branding.favicon_url) {
      updateFavicon(branding.favicon_url);
    }

    // Update application name
    updateMetaTag('application-name', branding.app_name);
    updateMetaTag('apple-mobile-web-app-title', branding.app_name);

  }, [branding, isLoading, isWhiteLabeled]);

  // This component doesn't render anything visible
  return null;
}

/**
 * Updates or creates a meta tag in the document head
 */
function updateMetaTag(
  name: string,
  content: string,
  attr: 'name' | 'property' = 'name'
) {
  let element = document.querySelector(
    `meta[${attr}="${name}"]`
  ) as HTMLMetaElement | null;

  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attr, name);
    document.head.appendChild(element);
  }

  element.content = content;
}

/**
 * Updates the favicon link elements
 */
function updateFavicon(faviconUrl: string) {
  // Update standard favicon
  let favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (favicon) {
    favicon.href = faviconUrl;
  } else {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = faviconUrl;
    document.head.appendChild(favicon);
  }

  // Update apple-touch-icon if it exists
  const appleTouchIcon = document.querySelector(
    'link[rel="apple-touch-icon"]'
  ) as HTMLLinkElement | null;
  if (appleTouchIcon) {
    appleTouchIcon.href = faviconUrl;
  }

  // Update shortcut icon if it exists
  const shortcutIcon = document.querySelector(
    'link[rel="shortcut icon"]'
  ) as HTMLLinkElement | null;
  if (shortcutIcon) {
    shortcutIcon.href = faviconUrl;
  }
}

export default DynamicMetadata;
