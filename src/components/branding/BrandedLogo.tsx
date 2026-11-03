import { useState, useEffect } from "react";
import { useBranding } from "@/contexts/BrandingContext";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandedLogoProps {
  /** Whether to show just the icon or full logo with text */
  variant?: "full" | "icon";
  /** Additional CSS classes */
  className?: string;
  /** Size of the icon in pixels */
  iconSize?: number;
  /** Whether to use dark mode variant (auto-detected from document class if omitted) */
  darkMode?: boolean;
  /** Whether to show loading skeleton while branding loads */
  showSkeleton?: boolean;
}

/**
 * BrandedLogo component
 *
 * Renders the organization's logo if available, or falls back to the default
 * ACA logo (Sparkles icon + app name). Supports light/dark variants and
 * different display modes (full logo vs icon only).
 */
export function BrandedLogo({
  variant = "full",
  className,
  iconSize = 24,
  darkMode,
  showSkeleton = false,
}: BrandedLogoProps) {
  const { branding, isLoading } = useBranding();

  // Auto-detect dark mode from document class when not explicitly provided
  const [autoDarkMode, setAutoDarkMode] = useState(
    () => document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    if (darkMode !== undefined) return; // Explicit prop takes precedence
    const observer = new MutationObserver(() => {
      setAutoDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [darkMode]);

  const isDark = darkMode ?? autoDarkMode;

  // Show skeleton while loading
  if (isLoading && showSkeleton) {
    return (
      <div className={cn("flex items-center gap-2 animate-pulse", className)}>
        <div
          className="rounded-md bg-muted"
          style={{ width: iconSize, height: iconSize }}
        />
        {variant === "full" && (
          <div className="h-5 w-20 rounded bg-muted" />
        )}
      </div>
    );
  }

  // Determine which logo URL to use (dark mode logo with fallback to light)
  const logoUrl = isDark && branding.logo_dark_url
    ? branding.logo_dark_url
    : branding.logo_url;

  // If we have a custom logo, use it
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={branding.app_name}
        className={cn(
          "object-contain",
          variant === "icon" ? "h-auto" : "h-8 w-auto max-w-[180px]",
          className
        )}
        style={variant === "icon" ? { width: iconSize, height: iconSize } : undefined}
      />
    );
  }

  // Fallback to default ACA-style logo
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Sparkles
        className="text-primary shrink-0"
        style={{ width: iconSize, height: iconSize }}
      />
      {variant === "full" && (
        <span className="text-xl font-bold tracking-tight">
          {branding.app_name}
        </span>
      )}
    </div>
  );
}

export default BrandedLogo;
