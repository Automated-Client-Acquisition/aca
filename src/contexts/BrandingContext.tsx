import { createContext, useContext, useEffect, useState, ReactNode, useCallback, startTransition } from "react";

// HSL color type matching the database schema
interface HSLColor {
  h: number;
  s: number;
  l: number;
}

// Branding configuration type
export interface BrandingConfig {
  app_name: string;
  tagline: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  primary_color: HSLColor;
  cta_color: HSLColor;
  accent_color: HSLColor;
  meta_title: string | null;
  meta_description: string | null;
  twitter_handle: string | null;
  support_email: string | null;
  support_url: string | null;
  footer_text: string | null;
  terms_url: string | null;
  privacy_url: string | null;
  hide_powered_by: boolean;
  custom_css: string | null;
}

interface BrandingContextType {
  branding: BrandingConfig;
  organizationId: string | null;
  organizationSlug: string | null;
  isWhiteLabeled: boolean;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  applyBrandingOverride: (config: BrandingConfig) => void;
}

// Default ACA branding - matches the edge function defaults
const DEFAULT_BRANDING: BrandingConfig = {
  app_name: 'ACA',
  tagline: 'Automated Client Acquisition',
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  og_image_url: null,
  primary_color: { h: 1, s: 70, l: 54 },
  cta_color: { h: 43, s: 80, l: 72 },
  accent_color: { h: 40, s: 15, l: 94 },
  meta_title: null,
  meta_description: null,
  twitter_handle: '@ACAXtreme',
  support_email: null,
  support_url: null,
  footer_text: null,
  terms_url: null,
  privacy_url: null,
  hide_powered_by: false,
  custom_css: null,
};

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

// Helper function to convert HSL color to CSS string
function hslToString(color: HSLColor): string {
  return `${color.h} ${color.s}% ${color.l}%`;
}

// Calculate whether text should be light or dark based on background luminance
function getContrastingTextColor(bgColor: HSLColor): string {
  // For HSL, we can use lightness as a rough approximation
  // Light backgrounds (l > 60%) should have dark text, dark backgrounds should have light text
  // Also factor in saturation - highly saturated colors with medium lightness may need light text
  const effectiveLightness = bgColor.l - (bgColor.s * 0.1);
  return effectiveLightness > 55 ? '0 0% 0%' : '0 0% 100%';
}

// Apply CSS variables to document root
function applyBrandingStyles(branding: BrandingConfig) {
  const root = document.documentElement;

  // Apply primary color.
  // --ring is deliberately NOT branded: it drives every focus ring in the
  // design system (`ring-ring`), and painting it with the primary colour turns
  // an ordinary focused field into what reads as a validation error — ACA's
  // primary is red, so a focused Select rendered a heavy red outline with no
  // error message while the panel next to it said "Ready to enroll". index.css
  // owns --ring (warm grey in light mode, slate in dark) for both modes.
  const primaryHsl = hslToString(branding.primary_color);
  root.style.setProperty('--primary', primaryHsl);
  root.style.setProperty('--aca-red', primaryHsl);

  // Calculate lighter/darker variants
  const primaryLight = `${branding.primary_color.h} ${branding.primary_color.s}% ${Math.min(branding.primary_color.l + 10, 100)}%`;
  const primaryDark = `${branding.primary_color.h} ${branding.primary_color.s}% ${Math.max(branding.primary_color.l - 10, 0)}%`;
  root.style.setProperty('--aca-red-light', primaryLight);
  root.style.setProperty('--aca-red-dark', primaryDark);

  // Calculate primary foreground (for text on primary-colored backgrounds)
  const primaryForeground = getContrastingTextColor(branding.primary_color);
  root.style.setProperty('--primary-foreground', primaryForeground);

  // Apply CTA color
  const ctaHsl = hslToString(branding.cta_color);
  root.style.setProperty('--cta', ctaHsl);
  root.style.setProperty('--aca-gold', ctaHsl);

  // Calculate CTA hover (darken for light CTAs, lighten for dark CTAs)
  const ctaHoverL = branding.cta_color.l > 50
    ? Math.max(branding.cta_color.l - 8, 0)
    : Math.min(branding.cta_color.l + 8, 100);
  const ctaHover = `${branding.cta_color.h} ${branding.cta_color.s}% ${ctaHoverL}%`;
  root.style.setProperty('--cta-hover', ctaHover);

  // Calculate CTA foreground (text color on CTA buttons)
  const ctaForeground = getContrastingTextColor(branding.cta_color);
  root.style.setProperty('--cta-foreground', ctaForeground);

  // Apply accent/background color
  const accentHsl = hslToString(branding.accent_color);
  root.style.setProperty('--aca-beige', accentHsl);

  // In dark mode, don't override --secondary and --accent with light branding colors
  // Let the .dark CSS class values apply instead (they provide proper dark backgrounds)
  const isDark = root.classList.contains('dark');
  if (!isDark) {
    root.style.setProperty('--secondary', accentHsl);
    root.style.setProperty('--accent', accentHsl);
  } else {
    root.style.removeProperty('--secondary');
    root.style.removeProperty('--accent');
  }

  // Generate brand gradient from primary color
  const gradientStart = `hsl(${branding.primary_color.h}, ${branding.primary_color.s}%, ${branding.primary_color.l}%)`;
  const gradientEnd = `hsl(${(branding.primary_color.h + 14) % 360}, ${branding.primary_color.s}%, ${Math.max(branding.primary_color.l - 4, 0)}%)`;
  root.style.setProperty('--gradient-aca', `linear-gradient(135deg, ${gradientStart} 0%, ${gradientEnd} 100%)`);

  // Generate CTA gradient from CTA color
  const ctaGradientStart = `hsl(${branding.cta_color.h}, ${branding.cta_color.s}%, ${branding.cta_color.l}%)`;
  const ctaGradientEnd = `hsl(${(branding.cta_color.h + 10) % 360}, ${branding.cta_color.s}%, ${Math.max(branding.cta_color.l - 5, 0)}%)`;
  root.style.setProperty('--gradient-cta', `linear-gradient(135deg, ${ctaGradientStart} 0%, ${ctaGradientEnd} 100%)`);

  // Apply custom CSS if provided
  if (branding.custom_css) {
    let styleEl = document.getElementById('custom-branding-css');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'custom-branding-css';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = branding.custom_css;
  } else {
    // Remove custom CSS element if no custom CSS
    const existingEl = document.getElementById('custom-branding-css');
    if (existingEl) {
      existingEl.remove();
    }
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationSlug, setOrganizationSlug] = useState<string | null>(null);
  const [isWhiteLabeled, setIsWhiteLabeled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBranding = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // In development, skip the API call and use defaults
      // The API route only works in production with Vercel rewrites
      const hostname = window.location.hostname;
      const isDevelopment = hostname === 'localhost' ||
                           hostname === '127.0.0.1' ||
                           hostname.endsWith('.vercel.app');

      if (isDevelopment) {
        // Use default branding in development
        setBranding(DEFAULT_BRANDING);
        setOrganizationId(null);
        setOrganizationSlug(null);
        setIsWhiteLabeled(false);
        return;
      }

      const response = await fetch('/api/branding');

      if (!response.ok) {
        throw new Error(`Failed to fetch branding: ${response.status}`);
      }

      // Check if response is JSON (not HTML error page)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response type - expected JSON');
      }

      const data = await response.json();

      startTransition(() => {
        if (data.branding) {
          // Merge with defaults to ensure all fields exist
          const mergedBranding = { ...DEFAULT_BRANDING, ...data.branding };
          setBranding(mergedBranding);
        }

        setOrganizationId(data.organization_id || null);
        setOrganizationSlug(data.organization_slug || null);
        setIsWhiteLabeled(data.is_white_labeled || false);
      });

      if (data.error) {
        console.warn('Branding fetch warning:', data.error);
      }

    } catch (err) {
      console.error('Failed to fetch branding:', err);
      startTransition(() => {
        setError(err instanceof Error ? err.message : 'Failed to fetch branding');
      });
      // Keep default branding on error
    } finally {
      // A transition, not an urgent update: this lands while prerendered marketing
      // pages are still hydrating their lazy route chunk, and an urgent context
      // change there throws React #421 and discards the server HTML.
      startTransition(() => setIsLoading(false));
    }
  }, []);

  const applyBrandingOverride = useCallback((config: BrandingConfig) => {
    setBranding(config);
  }, []);

  // Fetch branding on mount
  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  // Apply CSS variables when branding changes
  useEffect(() => {
    if (!isLoading) {
      applyBrandingStyles(branding);
    }
  }, [branding, isLoading]);

  // Re-apply branding when dark mode toggles (the .dark class in index.css
  // re-declares --primary, --cta, etc. with hardcoded values, overriding
  // the branded inline styles — we must re-apply after every class change)
  useEffect(() => {
    if (isLoading) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          applyBrandingStyles(branding);
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, [branding, isLoading]);

  return (
    <BrandingContext.Provider
      value={{
        branding,
        organizationId,
        organizationSlug,
        isWhiteLabeled,
        isLoading,
        error,
        refetch: fetchBranding,
        applyBrandingOverride,
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within BrandingProvider');
  }
  return context;
}

// Export the default branding for use in other components
export { DEFAULT_BRANDING };
