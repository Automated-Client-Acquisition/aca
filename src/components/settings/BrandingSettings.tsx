import { useState, useEffect, useRef } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Palette,
  Globe,
  Image,
  Link2,
  Loader2,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding, type BrandingConfig } from "@/contexts/BrandingContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface HSLColor {
  h: number;
  s: number;
  l: number;
}

interface BrandingData {
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

interface DomainData {
  id: string;
  domain: string;
  domain_type: string;
  verification_status: string;
  verification_token: string | null;
  ssl_status: string;
  dns_configured: boolean;
  created_at: string;
}

const DEFAULT_BRANDING: BrandingData = {
  app_name: 'ACA',
  tagline: null,
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  og_image_url: null,
  primary_color: { h: 1, s: 70, l: 54 },
  cta_color: { h: 43, s: 80, l: 72 },
  accent_color: { h: 40, s: 15, l: 94 },
  meta_title: null,
  meta_description: null,
  twitter_handle: null,
  support_email: null,
  support_url: null,
  footer_text: null,
  terms_url: null,
  privacy_url: null,
  hide_powered_by: false,
  custom_css: null,
};

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): HSLColor {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 0, l: 50 };

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: HSLColor;
  onChange: (color: HSLColor) => void;
}) {
  const hexValue = hslToHex(value.h, value.s, value.l);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={hexValue}
          onChange={(e) => onChange(hexToHsl(e.target.value))}
          className="w-12 h-10 rounded border cursor-pointer"
        />
        <Input
          value={hexValue}
          onChange={(e) => {
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
              onChange(hexToHsl(e.target.value));
            }
          }}
          className="font-mono w-28"
          placeholder="#000000"
        />
        <div
          className="w-20 h-10 rounded border"
          style={{ backgroundColor: hexValue }}
        />
      </div>
    </div>
  );
}

/**
 * Common multi-part TLDs where registrations happen at the third level
 * (e.g., example.co.uk, example.com.au). Covers ~95% of real-world usage.
 * Sorted by popularity/region.
 */
const MULTI_PART_TLDS = [
  // United Kingdom
  'co.uk', 'org.uk', 'net.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  // Australia
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  // Brazil
  'com.br', 'net.br', 'org.br', 'edu.br', 'gov.br',
  // Japan
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  // India
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in', 'ind.in',
  // South Korea
  'co.kr', 'or.kr', 'ne.kr', 'ac.kr', 'go.kr',
  // New Zealand
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  // South Africa
  'co.za', 'org.za', 'net.za', 'ac.za', 'gov.za', 'web.za',
  // Mexico & Latin America
  'com.mx', 'org.mx', 'net.mx', 'com.ar', 'com.co', 'com.pe', 'com.ve', 'com.cl', 'com.ec', 'com.uy',
  // Asia-Pacific
  'com.tw', 'org.tw', 'com.hk', 'org.hk', 'com.sg', 'org.sg', 'com.my', 'org.my',
  'com.ph', 'com.pk', 'com.bd', 'com.np', 'com.vn', 'com.cn', 'com.lk',
  // Indonesia
  'co.id', 'or.id', 'web.id', 'ac.id', 'go.id',
  // Thailand
  'co.th', 'or.th', 'ac.th', 'go.th', 'in.th',
  // Africa
  'com.ng', 'org.ng', 'com.eg', 'com.gh', 'co.ke', 'co.tz', 'co.ug', 'co.zw',
  // Middle East
  'com.tr', 'org.tr', 'net.tr', 'com.sa', 'com.ae', 'co.il',
  // Europe
  'com.ua', 'org.ua', 'co.hu', 'com.pl', 'com.ro', 'com.gr', 'com.pt',
  // Israel
  'org.il', 'net.il', 'ac.il',
];

/** Detect apex domains, accounting for common multi-part TLDs (.co.uk, .com.au, etc.) */
function isApexDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  for (const tld of MULTI_PART_TLDS) {
    if (lower.endsWith('.' + tld)) {
      const prefix = lower.slice(0, -(tld.length + 1));
      return !prefix.includes('.');
    }
  }
  return domain.split('.').length === 2;
}

/** Extract the subdomain prefix for CNAME records (e.g., "app.staging" from "app.staging.example.com") */
function getSubdomainPrefix(domain: string): string {
  const lower = domain.toLowerCase();
  // Check multi-part TLDs first (e.g., example.co.uk → everything before the apex)
  for (const tld of MULTI_PART_TLDS) {
    if (lower.endsWith('.' + tld)) {
      const prefix = lower.slice(0, -(tld.length + 1));
      const lastDot = prefix.lastIndexOf('.');
      return lastDot === -1 ? prefix : prefix; // Return the full prefix (may have dots)
    }
  }
  // Standard TLD: everything before the last two parts
  const parts = lower.split('.');
  return parts.slice(0, -2).join('.');
}

/** Check if a multi-part TLD domain might not be in our known list */
function isUnrecognizedMultiPartTld(domain: string): boolean {
  const parts = domain.toLowerCase().split('.');
  if (parts.length <= 2) return false; // standard TLD, always recognized
  // 3+ parts: check if the last two parts form a known multi-part TLD
  const possibleTld = parts.slice(-2).join('.');
  const secondLevel = parts[parts.length - 2];
  // Common second-level patterns that suggest a multi-part TLD
  const knownSecondLevels = ['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'or', 'ne', 'go', 'govt', 'web', 'gen', 'firm', 'ind', 'ltd', 'plc', 'id', 'in', 'me'];
  if (knownSecondLevels.includes(secondLevel) && !MULTI_PART_TLDS.includes(possibleTld)) {
    return true;
  }
  return false;
}

export function BrandingSettings() {
  const { currentOrganization, userRole } = useAuth();
  const { applyBrandingOverride } = useBranding();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [branding, setBranding] = useState<BrandingData>(DEFAULT_BRANDING);
  const [savedBranding, setSavedBranding] = useState<BrandingData>(DEFAULT_BRANDING);
  const [domains, setDomains] = useState<DomainData[]>([]);
  const [newDomain, setNewDomain] = useState("");
  const [isAddingDomain, setIsAddingDomain] = useState(false);
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null);
  const [removingDomainId, setRemovingDomainId] = useState<string | null>(null);
  const [isWhiteLabelEnabled, setIsWhiteLabelEnabled] = useState(false);

  const canManageBranding = userRole === 'owner' || userRole === 'admin' || userRole === 'super_admin';

  // Fetch branding data
  useEffect(() => {
    async function fetchBranding() {
      if (!currentOrganization) return;

      setIsLoading(true);
      try {
        // Fetch branding (use maybeSingle to handle case where no row exists yet)
        const { data: brandingData } = await supabase
          .from("organization_branding")
          .select("*")
          .eq("organization_id", currentOrganization.id)
          .maybeSingle();

        if (brandingData) {
          const merged = {
            ...DEFAULT_BRANDING,
            ...(brandingData as any),
          };
          setBranding(merged);
          setSavedBranding(merged);
        }

        // Fetch domains
        const { data: domainsData } = await supabase
          .from("organization_domains")
          .select("*")
          .eq("organization_id", currentOrganization.id)
          .order("created_at", { ascending: false });

        if (domainsData) {
          setDomains(domainsData as DomainData[]);
        }

        // Check if white-label is enabled
        const { data: orgData } = await supabase
          .from("organizations")
          .select("is_white_labeled")
          .eq("id", currentOrganization.id)
          .single();

        if (orgData) {
          setIsWhiteLabelEnabled((orgData as any).is_white_labeled ?? false);
        }
      } catch (error) {
        console.error("Error fetching branding:", error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBranding();
  }, [currentOrganization]);

  // Live preview: apply branding as the user edits colors (works even before enabling white-label)
  const savedBrandingRef = useRef(savedBranding);
  savedBrandingRef.current = savedBranding;
  const isWhiteLabelEnabledRef = useRef(isWhiteLabelEnabled);
  isWhiteLabelEnabledRef.current = isWhiteLabelEnabled;

  useEffect(() => {
    if (!isLoading) {
      applyBrandingOverride(branding as BrandingConfig);
    }
  }, [branding, isLoading]);

  // Revert to saved branding on unmount (if user didn't save)
  useEffect(() => {
    return () => {
      applyBrandingOverride(savedBrandingRef.current as BrandingConfig);
    };
  }, [applyBrandingOverride]);

  const handleSaveBranding = async () => {
    if (!currentOrganization || !canManageBranding) return;

    // Validate custom CSS doesn't contain XSS / injection payloads
    if (branding.custom_css) {
      const css = branding.custom_css;
      const dangerous = /<\s*script/i.test(css)                   // <script> tag
        || /<\s*\/\s*style/i.test(css)                            // </style> tag breakout
        || /url\s*\(\s*['"]?\s*javascript:/i.test(css)            // url(javascript:...)
        || /expression\s*\(/i.test(css)                           // IE expression()
        || /behavior\s*:/i.test(css)                              // IE behavior: url(...)
        || /@import\s+url\s*\(/i.test(css);                       // @import url(...) exfiltration
      if (dangerous) {
        toast.error("Custom CSS contains disallowed patterns (script tags, javascript URLs, expressions, or @import)");
        return;
      }
    }

    setIsSaving(true);
    try {
      // Upsert branding — explicitly pick only BrandingData fields to avoid
      // including DB-managed fields (id, created_at) that could cause conflicts
      const { error } = await supabase
        .from("organization_branding")
        .upsert({
          organization_id: currentOrganization.id,
          app_name: branding.app_name,
          tagline: branding.tagline,
          logo_url: branding.logo_url,
          logo_dark_url: branding.logo_dark_url,
          favicon_url: branding.favicon_url,
          og_image_url: branding.og_image_url,
          primary_color: branding.primary_color,
          cta_color: branding.cta_color,
          accent_color: branding.accent_color,
          meta_title: branding.meta_title,
          meta_description: branding.meta_description,
          twitter_handle: branding.twitter_handle,
          support_email: branding.support_email,
          support_url: branding.support_url,
          footer_text: branding.footer_text,
          terms_url: branding.terms_url,
          privacy_url: branding.privacy_url,
          hide_powered_by: branding.hide_powered_by,
          custom_css: branding.custom_css,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id',
        });

      if (error) throw error;

      setSavedBranding(branding);
      applyBrandingOverride(branding as BrandingConfig);
      toast.success("Branding saved successfully");
    } catch (error) {
      console.error("Error saving branding:", error);
      toast.error("Failed to save branding");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleWhiteLabel = async (enabled: boolean) => {
    if (!currentOrganization || !canManageBranding) return;

    try {
      const { error } = await supabase
        .from("organizations")
        .update({
          is_white_labeled: enabled,
          white_label_enabled_at: enabled ? new Date().toISOString() : null,
        })
        .eq("id", currentOrganization.id);

      if (error) throw error;

      setIsWhiteLabelEnabled(enabled);
      applyBrandingOverride(enabled ? branding as BrandingConfig : DEFAULT_BRANDING as BrandingConfig);
      toast.success(enabled ? "White-label enabled" : "White-label disabled");
    } catch (error) {
      console.error("Error toggling white-label:", error);
      toast.error("Failed to update white-label status");
    }
  };

  const handleAddDomain = async () => {
    if (!currentOrganization || !canManageBranding || !newDomain.trim()) return;

    // Basic domain validation
    const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    const trimmedDomain = newDomain.trim().toLowerCase();
    if (!domainRegex.test(trimmedDomain)) {
      toast.error("Please enter a valid domain name");
      return;
    }

    setIsAddingDomain(true);
    try {
      const verificationToken = `aca-verify-${crypto.randomUUID().slice(0, 8)}`;

      // 1. Insert domain record in database
      const { data, error } = await supabase
        .from("organization_domains" as any)
        .insert({
          organization_id: currentOrganization.id,
          domain: trimmedDomain,
          domain_type: 'custom',
          verification_status: 'pending',
          verification_token: verificationToken,
          ssl_status: 'pending',
          dns_configured: false,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          toast.error("This domain is already registered");
        } else {
          throw error;
        }
        return;
      }

      // 2. Register domain with Vercel via edge function
      const { data: vercelResult, error: vercelError } = await supabase.functions.invoke(
        'manage-custom-domain',
        {
          body: {
            domain: trimmedDomain,
            organizationId: currentOrganization.id,
          },
        }
      );

      if (vercelError) {
        console.error("Vercel registration error:", vercelError);
        // Domain is in DB but not registered with Vercel - still show it but warn
        toast.warning("Domain added but Vercel registration failed. You can retry verification later.");
      } else if (vercelResult?.error) {
        console.error("Vercel registration error:", vercelResult.error);
        toast.warning(vercelResult.message || "Domain added but Vercel registration needs attention.");
      } else {
        toast.success("Domain added and registered. Please configure your DNS settings.");
      }

      setDomains([data as DomainData, ...domains]);
      setNewDomain("");
    } catch (error) {
      console.error("Error adding domain:", error);
      toast.error("Failed to add domain");
    } finally {
      setIsAddingDomain(false);
    }
  };

  const handleRemoveDomain = async (domainId: string) => {
    if (!currentOrganization || !canManageBranding) return;

    const domainToRemove = domains.find(d => d.id === domainId);
    if (!domainToRemove) return;

    try {
      // 1. Remove from Vercel via edge function
      // Use query params for DELETE — Supabase JS may strip the request body
      const deleteParams = new URLSearchParams({
        domain: domainToRemove.domain,
        organizationId: currentOrganization.id,
      });
      const { error: vercelError } = await supabase.functions.invoke(
        `manage-custom-domain?${deleteParams.toString()}`,
        { method: 'DELETE' }
      );

      if (vercelError) {
        console.error("Vercel removal error:", vercelError);
        // Continue with DB deletion even if Vercel fails
      }

      // 2. Remove from database
      const { error } = await supabase
        .from("organization_domains" as any)
        .delete()
        .eq("id", domainId);

      if (error) throw error;

      setDomains(domains.filter(d => d.id !== domainId));
      toast.success("Domain removed");
    } catch (error) {
      console.error("Error removing domain:", error);
      toast.error("Failed to remove domain");
    }
  };

  const handleVerifyDomain = async (domainItem: DomainData) => {
    if (!currentOrganization || !canManageBranding) return;

    setVerifyingDomainId(domainItem.id);
    try {
      // Use invoke with query params encoded in the function name path
      const params = new URLSearchParams({
        domain: domainItem.domain,
        organizationId: currentOrganization.id,
      });
      const { data, error } = await supabase.functions.invoke(
        `manage-custom-domain?${params.toString()}`,
        { method: 'GET' }
      );

      if (error) throw error;

      if (data?.verified) {
        setDomains(domains.map(d =>
          d.id === domainItem.id
            ? { ...d, verification_status: 'verified', dns_configured: true, ssl_status: 'active' }
            : d
        ));
        toast.success("Domain verified successfully!");
      } else {
        toast.info("Domain not yet verified. Please ensure your DNS records are configured correctly.");
      }
    } catch (error) {
      console.error("Error verifying domain:", error);
      toast.error("Failed to check domain verification status");
    } finally {
      setVerifyingDomainId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* White-Label Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            White-Label Mode
          </CardTitle>
          <CardDescription>
            Enable white-label mode to customize branding for your custom domain
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Enable White-Label</p>
              <p className="text-sm text-muted-foreground">
                When enabled, visitors to your custom domain will see your branding
              </p>
            </div>
            <Switch
              checked={isWhiteLabelEnabled}
              onCheckedChange={handleToggleWhiteLabel}
              disabled={!canManageBranding}
            />
          </div>
        </CardContent>
      </Card>

      {/* Brand Identity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="w-5 h-5" />
            Brand Identity
          </CardTitle>
          <CardDescription>
            Customize your app name, logo, and tagline
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="app_name">App Name</Label>
              <Input
                id="app_name"
                value={branding.app_name}
                onChange={(e) => setBranding({ ...branding, app_name: e.target.value })}
                placeholder="Your App Name"
                disabled={!canManageBranding}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tagline">Tagline</Label>
              <Input
                id="tagline"
                value={branding.tagline || ""}
                onChange={(e) => setBranding({ ...branding, tagline: e.target.value || null })}
                placeholder="Your catchy tagline"
                disabled={!canManageBranding}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="logo_url">Logo URL (Light Mode)</Label>
              <Input
                id="logo_url"
                value={branding.logo_url || ""}
                onChange={(e) => setBranding({ ...branding, logo_url: e.target.value || null })}
                placeholder="https://..."
                disabled={!canManageBranding}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo_dark_url">Logo URL (Dark Mode)</Label>
              <Input
                id="logo_dark_url"
                value={branding.logo_dark_url || ""}
                onChange={(e) => setBranding({ ...branding, logo_dark_url: e.target.value || null })}
                placeholder="https://..."
                disabled={!canManageBranding}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="favicon_url">Favicon URL</Label>
              <Input
                id="favicon_url"
                value={branding.favicon_url || ""}
                onChange={(e) => setBranding({ ...branding, favicon_url: e.target.value || null })}
                placeholder="https://..."
                disabled={!canManageBranding}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="og_image_url">Social Share Image URL</Label>
              <Input
                id="og_image_url"
                value={branding.og_image_url || ""}
                onChange={(e) => setBranding({ ...branding, og_image_url: e.target.value || null })}
                placeholder="https://..."
                disabled={!canManageBranding}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Colors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Brand Colors
          </CardTitle>
          <CardDescription>
            Customize your primary, CTA, and accent colors
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <ColorPicker
              label="Primary Color"
              value={branding.primary_color}
              onChange={(color) => setBranding({ ...branding, primary_color: color })}
            />
            <ColorPicker
              label="CTA Color"
              value={branding.cta_color}
              onChange={(color) => setBranding({ ...branding, cta_color: color })}
            />
            <ColorPicker
              label="Accent Color"
              value={branding.accent_color}
              onChange={(color) => setBranding({ ...branding, accent_color: color })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Metadata & SEO
          </CardTitle>
          <CardDescription>
            Configure meta tags for search engines and social sharing
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meta_title">Meta Title</Label>
            <Input
              id="meta_title"
              value={branding.meta_title || ""}
              onChange={(e) => setBranding({ ...branding, meta_title: e.target.value || null })}
              placeholder="Page title for browser tabs and search results"
              disabled={!canManageBranding}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta_description">Meta Description</Label>
            <Textarea
              id="meta_description"
              value={branding.meta_description || ""}
              onChange={(e) => setBranding({ ...branding, meta_description: e.target.value || null })}
              placeholder="Description for search engine results"
              disabled={!canManageBranding}
              rows={3}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="twitter_handle">Twitter Handle</Label>
              <Input
                id="twitter_handle"
                value={branding.twitter_handle || ""}
                onChange={(e) => setBranding({ ...branding, twitter_handle: e.target.value || null })}
                placeholder="@yourhandle"
                disabled={!canManageBranding}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support_email">Support Email</Label>
              <Input
                id="support_email"
                type="email"
                value={branding.support_email || ""}
                onChange={(e) => setBranding({ ...branding, support_email: e.target.value || null })}
                placeholder="support@yourdomain.com"
                disabled={!canManageBranding}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Legal Links */}
      <Card>
        <CardHeader>
          <CardTitle>Legal & Footer</CardTitle>
          <CardDescription>
            Configure legal page links and footer text
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="terms_url">Terms of Service URL</Label>
              <Input
                id="terms_url"
                value={branding.terms_url || ""}
                onChange={(e) => setBranding({ ...branding, terms_url: e.target.value || null })}
                placeholder="https://yourdomain.com/terms"
                disabled={!canManageBranding}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="privacy_url">Privacy Policy URL</Label>
              <Input
                id="privacy_url"
                value={branding.privacy_url || ""}
                onChange={(e) => setBranding({ ...branding, privacy_url: e.target.value || null })}
                placeholder="https://yourdomain.com/privacy"
                disabled={!canManageBranding}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="footer_text">Footer Text</Label>
            <Input
              id="footer_text"
              value={branding.footer_text || ""}
              onChange={(e) => setBranding({ ...branding, footer_text: e.target.value || null })}
              placeholder="Custom footer message"
              disabled={!canManageBranding}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Hide "Powered by ACA"</p>
              <p className="text-sm text-muted-foreground">
                Remove the ACA attribution from the footer
              </p>
            </div>
            <Switch
              checked={branding.hide_powered_by}
              onCheckedChange={(checked) => setBranding({ ...branding, hide_powered_by: checked })}
              disabled={!canManageBranding}
            />
          </div>
        </CardContent>
      </Card>

      {/* Custom Domains */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Custom Domains
          </CardTitle>
          <CardDescription>
            Add custom domains to serve your white-labeled app
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Domain Form */}
          <div className="flex gap-2">
            <Input
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="app.yourdomain.com"
              disabled={!canManageBranding || isAddingDomain}
            />
            <Button
              variant="cta"
              onClick={handleAddDomain}
              disabled={!canManageBranding || isAddingDomain || !newDomain.trim()}
            >
              {isAddingDomain ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Add Domain"
              )}
            </Button>
          </div>

          {/* Domain List */}
          {domains.length > 0 ? (
            <div className="space-y-3">
              {domains.map((domain) => (
                <div
                  key={domain.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-muted/30"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{domain.domain}</span>
                      <Badge
                        variant={
                          domain.verification_status === 'verified'
                            ? 'default'
                            : domain.verification_status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="text-xs"
                      >
                        {domain.verification_status === 'verified' && (
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                        )}
                        {domain.verification_status === 'pending' && (
                          <Clock className="w-3 h-3 mr-1" />
                        )}
                        {domain.verification_status === 'failed' && (
                          <AlertCircle className="w-3 h-3 mr-1" />
                        )}
                        {domain.verification_status}
                      </Badge>
                    </div>

                    {(domain.verification_status === 'pending' || domain.verification_status === 'failed') && (
                      <div className="text-sm text-muted-foreground space-y-2 mt-2">
                        {domain.verification_status === 'failed' && (
                          <p className="text-destructive text-xs">Verification failed. Please check your DNS configuration below and try again.</p>
                        )}
                        <p className="font-medium text-foreground">DNS Configuration:</p>
                        {/* Check if apex domain (e.g., example.com) vs subdomain (e.g., app.example.com) */}
                        {isApexDomain(domain.domain) ? (
                          // Apex domain - needs A record
                          <div className="bg-muted p-3 rounded text-xs font-mono space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Type:</span>
                              <span>A</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Name:</span>
                              <span>@</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={() => copyToClipboard('@')}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Value:</span>
                              <span>76.76.21.21</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={() => copyToClipboard('76.76.21.21')}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <p className="text-muted-foreground mt-2 text-[10px]">
                              For apex domains, add an A record pointing to Vercel's IP address.
                            </p>
                          </div>
                        ) : (
                          // Subdomain - needs CNAME record
                          <div className="bg-muted p-3 rounded text-xs font-mono space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Type:</span>
                              <span>CNAME</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Name:</span>
                              <span>{getSubdomainPrefix(domain.domain)}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={() => copyToClipboard(getSubdomainPrefix(domain.domain))}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Value:</span>
                              <span>cname.vercel-dns.com</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 w-5 p-0"
                                onClick={() => copyToClipboard('cname.vercel-dns.com')}
                              >
                                <Copy className="w-3 h-3" />
                              </Button>
                            </div>
                            <p className="text-muted-foreground mt-2 text-[10px]">
                              For subdomains, add a CNAME record pointing to Vercel's DNS.
                            </p>
                          </div>
                        )}
                        {isUnrecognizedMultiPartTld(domain.domain) && (
                          <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-2 rounded text-xs text-yellow-800 dark:text-yellow-300">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>
                              This domain's TLD may not be fully recognized. The DNS instructions above might be incorrect for your region's domain format. If in doubt, use a subdomain (e.g., app.{domain.domain}) instead.
                            </span>
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          DNS changes can take up to 48 hours to propagate. Use{' '}
                          <a
                            href="https://www.whatsmydns.net/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-foreground"
                          >
                            whatsmydns.net
                          </a>
                          {' '}to check propagation status.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {(domain.verification_status === 'pending' || domain.verification_status === 'failed') && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVerifyDomain(domain)}
                        disabled={!canManageBranding || verifyingDomainId === domain.id}
                      >
                        {verifyingDomainId === domain.id ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-1" />
                        )}
                        {verifyingDomainId === domain.id ? 'Verifying...' : 'Verify'}
                      </Button>
                    )}
                    {domain.verification_status === 'verified' && (
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                      >
                        <a
                          href={`https://${domain.domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setRemovingDomainId(domain.id)}
                      disabled={!canManageBranding}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No custom domains configured. Add a domain to get started.
            </p>
          )}

          {/* Domain Removal Confirmation Dialog */}
          <AlertDialog open={!!removingDomainId} onOpenChange={(open) => !open && setRemovingDomainId(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Domain</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to remove <span className="font-medium text-foreground">{domains.find(d => d.id === removingDomainId)?.domain}</span>? This will remove the domain from Vercel and your white-labeled site will no longer be accessible at this address.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    if (removingDomainId) {
                      handleRemoveDomain(removingDomainId);
                      setRemovingDomainId(null);
                    }
                  }}
                >
                  Remove Domain
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          variant="cta"
          onClick={handleSaveBranding}
          disabled={!canManageBranding || isSaving}
          size="lg"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Branding
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default BrandingSettings;
