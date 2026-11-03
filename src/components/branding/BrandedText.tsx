import { useBranding, BrandingConfig } from "@/contexts/BrandingContext";
import { cn } from "@/lib/utils";

type BrandingTextKey = Extract<
  keyof BrandingConfig,
  'app_name' | 'tagline' | 'support_email' | 'support_url' | 'footer_text' | 'twitter_handle'
>;

interface BrandedTextProps {
  /** Which branding field to display */
  field: BrandingTextKey;
  /** Fallback text if the branding field is empty */
  fallback?: string;
  /** Additional CSS classes */
  className?: string;
  /** HTML element to render (defaults to span) */
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'div';
}

/**
 * BrandedText component
 *
 * Renders text from the branding configuration. Use this component anywhere
 * you need to display the app name, tagline, or other branded text that
 * should be customizable for white-labeled deployments.
 *
 * @example
 * // Display the app name
 * <BrandedText field="app_name" />
 *
 * @example
 * // Display tagline with fallback
 * <BrandedText field="tagline" fallback="Your automation platform" />
 *
 * @example
 * // Display as heading
 * <BrandedText field="app_name" as="h1" className="text-4xl font-bold" />
 */
export function BrandedText({
  field,
  fallback = '',
  className,
  as: Component = 'span',
}: BrandedTextProps) {
  const { branding, isLoading } = useBranding();

  // Show loading placeholder
  if (isLoading) {
    return (
      <Component className={cn("animate-pulse", className)}>
        <span className="inline-block h-4 w-20 rounded bg-muted" />
      </Component>
    );
  }

  const text = branding[field] || fallback;

  return (
    <Component className={className}>
      {text}
    </Component>
  );
}

/**
 * Hook to get a specific branding text value
 *
 * @example
 * const appName = useBrandingText('app_name');
 * const tagline = useBrandingText('tagline', 'Default tagline');
 */
export function useBrandingText(field: BrandingTextKey, fallback: string = ''): string {
  const { branding } = useBranding();
  return branding[field] || fallback;
}

export default BrandedText;
