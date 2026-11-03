import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sparkles,
  Crown,
  Zap,
  Check,
  X,
  AlertTriangle,
  Info,
  Star,
  ArrowRight,
  Plus,
  Loader2
} from "lucide-react";

export default function Stylesheet() {
  return (
    <AppLayout>
      <div className="container py-8 space-y-12 max-w-6xl">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">ACA Design System</h1>
          <p className="text-lg text-muted-foreground">
            Reference guide for colors, components, and design tokens
          </p>
        </div>

        {/* Color Palette */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Color Palette</h2>
            <p className="text-muted-foreground">Core brand colors and their usage</p>
          </div>

          {/* Primary Colors */}
          <Card>
            <CardHeader>
              <CardTitle>Primary Colors</CardTitle>
              <CardDescription>Main brand colors for identity and accents</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Primary Red */}
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-primary flex items-end p-3">
                    <span className="text-primary-foreground text-sm font-medium">Primary</span>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">Primary Red</p>
                    <p className="text-muted-foreground font-mono text-xs">#DC3A38 / hsl(1, 70%, 54%)</p>
                    <p className="text-xs text-muted-foreground mt-1">Brand identity, links, active states</p>
                  </div>
                </div>

                {/* CTA Gold */}
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-cta flex items-end p-3">
                    <span className="text-cta-foreground text-sm font-medium">CTA</span>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">CTA Gold</p>
                    <p className="text-muted-foreground font-mono text-xs">#F1D07B / hsl(43, 80%, 72%)</p>
                    <p className="text-xs text-muted-foreground mt-1">Buttons, upgrade prompts, action items</p>
                  </div>
                </div>

                {/* Accent */}
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-accent flex items-end p-3">
                    <span className="text-accent-foreground text-sm font-medium">Accent</span>
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">Accent</p>
                    <p className="text-muted-foreground font-mono text-xs">hsl(43, 80%, 72%)</p>
                    <p className="text-xs text-muted-foreground mt-1">Highlights, hover states</p>
                  </div>
                </div>
              </div>

              {/* Primary Variations */}
              <div className="pt-4">
                <p className="text-sm font-medium mb-3">Primary Variations</p>
                <div className="flex gap-2 flex-wrap">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary" />
                    <span className="text-xs">100%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary/80" />
                    <span className="text-xs">80%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary/60" />
                    <span className="text-xs">60%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary/40" />
                    <span className="text-xs">40%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary/20" />
                    <span className="text-xs">20%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 border" />
                    <span className="text-xs">10%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-primary/5 border" />
                    <span className="text-xs">5%</span>
                  </div>
                </div>
              </div>

              {/* CTA Variations */}
              <div className="pt-4">
                <p className="text-sm font-medium mb-3">CTA Variations</p>
                <div className="flex gap-2 flex-wrap">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-cta" />
                    <span className="text-xs">100%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-cta-hover" />
                    <span className="text-xs">Hover</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-cta/60" />
                    <span className="text-xs">60%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-cta/40" />
                    <span className="text-xs">40%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-cta/20" />
                    <span className="text-xs">20%</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-12 h-12 rounded-lg bg-cta/10 border" />
                    <span className="text-xs">10%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pro Features Colors */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-pro-accent" />
                Pro Feature Colors
              </CardTitle>
              <CardDescription>Colors for premium/pro feature indicators</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-pro-bg border border-pro-border flex items-center justify-center">
                    <span className="text-pro-text text-sm font-medium">Pro Background</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">bg-pro-bg</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-lg border-2 border-pro-border flex items-center justify-center">
                    <span className="text-sm font-medium">Pro Border</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">border-pro-border</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-muted flex items-center justify-center">
                    <span className="text-pro-text text-sm font-medium">Pro Text</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">text-pro-text</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-pro-accent flex items-center justify-center">
                    <span className="text-white text-sm font-medium">Pro Accent</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">bg-pro-accent</p>
                </div>
              </div>

              {/* Pro Container Example */}
              <div className="mt-6 p-4 rounded-lg bg-pro-bg border border-pro-border">
                <div className="flex items-center gap-2 mb-2">
                  <Crown className="h-4 w-4 text-pro-accent" />
                  <span className="text-pro-text font-medium">Pro Feature Container</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Use this style for premium feature callouts and upgrade prompts.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Semantic Colors */}
          <Card>
            <CardHeader>
              <CardTitle>Semantic Colors</CardTitle>
              <CardDescription>Status and feedback colors</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-green-500 flex items-center justify-center">
                    <Check className="h-6 w-6 text-white" />
                  </div>
                  <p className="text-sm font-medium">Success</p>
                  <p className="text-xs text-muted-foreground">green-500</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-destructive flex items-center justify-center">
                    <X className="h-6 w-6 text-destructive-foreground" />
                  </div>
                  <p className="text-sm font-medium">Destructive</p>
                  <p className="text-xs text-muted-foreground">destructive</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-amber-500 flex items-center justify-center">
                    <AlertTriangle className="h-6 w-6 text-white" />
                  </div>
                  <p className="text-sm font-medium">Warning</p>
                  <p className="text-xs text-muted-foreground">amber-500</p>
                </div>
                <div className="space-y-2">
                  <div className="h-16 rounded-lg bg-blue-500 flex items-center justify-center">
                    <Info className="h-6 w-6 text-white" />
                  </div>
                  <p className="text-sm font-medium">Info</p>
                  <p className="text-xs text-muted-foreground">blue-500</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Buttons */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Buttons</h2>
            <p className="text-muted-foreground">Button variants and states</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Button Variants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Standard Variants */}
              <div>
                <p className="text-sm font-medium mb-3">Standard Variants</p>
                <div className="flex flex-wrap gap-3">
                  <Button>Default</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="link">Link</Button>
                  <Button variant="destructive">Destructive</Button>
                </div>
              </div>

              {/* CTA Buttons */}
              <div>
                <p className="text-sm font-medium mb-3">CTA Buttons (Gold)</p>
                <div className="flex flex-wrap gap-3">
                  <Button className="bg-cta text-cta-foreground hover:bg-cta-hover">
                    <Zap className="mr-2 h-4 w-4" />
                    Upgrade Now
                  </Button>
                  <Button className="bg-gradient-cta text-cta-foreground hover:opacity-90">
                    <Crown className="mr-2 h-4 w-4" />
                    Go Pro
                  </Button>
                  <Button className="btn-cta">
                    <Star className="mr-2 h-4 w-4" />
                    Using .btn-cta
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Use gold CTA buttons for primary actions, upgrades, and important calls-to-action.
                </p>
              </div>

              {/* Sizes */}
              <div>
                <p className="text-sm font-medium mb-3">Sizes</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                  <Button size="icon"><Plus className="h-4 w-4" /></Button>
                </div>
              </div>

              {/* States */}
              <div>
                <p className="text-sm font-medium mb-3">States</p>
                <div className="flex flex-wrap gap-3">
                  <Button>Normal</Button>
                  <Button disabled>Disabled</Button>
                  <Button disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading
                  </Button>
                </div>
              </div>

              {/* With Icons */}
              <div>
                <p className="text-sm font-medium mb-3">With Icons</p>
                <div className="flex flex-wrap gap-3">
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Item
                  </Button>
                  <Button variant="outline">
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button variant="secondary">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Badges */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Badges</h2>
            <p className="text-muted-foreground">Badge variants for labels and status</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Badge Variants</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Standard */}
              <div>
                <p className="text-sm font-medium mb-3">Standard Variants</p>
                <div className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="secondary">Secondary</Badge>
                  <Badge variant="outline">Outline</Badge>
                  <Badge variant="destructive">Destructive</Badge>
                </div>
              </div>

              {/* Custom Colors */}
              <div>
                <p className="text-sm font-medium mb-3">Custom Status Badges</p>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Success</Badge>
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Warning</Badge>
                  <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Info</Badge>
                  <Badge className="bg-primary/10 text-primary border-primary/20">Primary</Badge>
                  <Badge className="bg-cta/10 text-cta border-cta/20">CTA</Badge>
                </div>
              </div>

              {/* Pro Badge */}
              <div>
                <p className="text-sm font-medium mb-3">Pro Badge</p>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-pro-bg text-pro-text border-pro-border">
                    <Crown className="mr-1 h-3 w-3" />
                    Pro
                  </Badge>
                  <Badge className="bg-pro-accent text-white">
                    <Crown className="mr-1 h-3 w-3" />
                    Pro Feature
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Gradients */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Gradients</h2>
            <p className="text-muted-foreground">Gradient backgrounds for visual appeal</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Available Gradients</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-gradient-aca flex items-center justify-center">
                    <span className="text-white font-medium">ACA Gradient</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">bg-gradient-aca</p>
                  <p className="text-xs text-muted-foreground">Primary red gradient</p>
                </div>
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-gradient-cta flex items-center justify-center">
                    <span className="text-cta-foreground font-medium">CTA Gradient</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">bg-gradient-cta</p>
                  <p className="text-xs text-muted-foreground">Gold CTA gradient</p>
                </div>
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-gradient-to-r from-primary to-cta flex items-center justify-center">
                    <span className="text-white font-medium">Primary to CTA</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">from-primary to-cta</p>
                </div>
                <div className="space-y-2">
                  <div className="h-24 rounded-lg bg-gradient-to-br from-primary/20 to-cta/20 border flex items-center justify-center">
                    <span className="font-medium">Subtle Gradient</span>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">from-primary/20 to-cta/20</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Typography */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Typography</h2>
            <p className="text-muted-foreground">Fonts, text styles, and colors</p>
          </div>

          {/* Font Families */}
          <Card>
            <CardHeader>
              <CardTitle>Font Families</CardTitle>
              <CardDescription>Primary font families used throughout the application</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Sans-serif (Default) */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge>Primary</Badge>
                  <span className="text-sm font-mono text-muted-foreground">font-sans</span>
                </div>
                <div className="p-4 rounded-lg border bg-muted/30">
                  <p className="text-2xl font-sans mb-2">Inter / System Sans-Serif</p>
                  <p className="text-sm text-muted-foreground font-sans">
                    The quick brown fox jumps over the lazy dog. 0123456789
                  </p>
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif
                  </p>
                </div>
              </div>

              {/* Monospace */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">Code</Badge>
                  <span className="text-sm font-mono text-muted-foreground">font-mono</span>
                </div>
                <div className="p-4 rounded-lg border bg-muted/30">
                  <p className="text-2xl font-mono mb-2">Monospace</p>
                  <p className="text-sm text-muted-foreground font-mono">
                    The quick brown fox jumps over the lazy dog. 0123456789
                  </p>
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Font Weights */}
          <Card>
            <CardHeader>
              <CardTitle>Font Weights</CardTitle>
              <CardDescription>Available font weight variations</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <span className="font-thin text-lg">Thin (100)</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-thin</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <span className="font-extralight text-lg">Extra Light (200)</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-extralight</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <span className="font-light text-lg">Light (300)</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-light</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <span className="font-normal text-lg">Normal (400)</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-normal</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border bg-primary/5">
                  <span className="font-medium text-lg">Medium (500) ← Preferred</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-medium</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border bg-primary/5">
                  <span className="font-semibold text-lg">Semibold (600) ← Preferred</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-semibold</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border bg-primary/5">
                  <span className="font-bold text-lg">Bold (700) ← Preferred</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-bold</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <span className="font-extrabold text-lg">Extra Bold (800)</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-extrabold</code>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <span className="font-black text-lg">Black (900)</span>
                  <code className="text-xs bg-muted px-2 py-1 rounded">font-black</code>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                Recommended: Use font-medium (500) for labels, font-semibold (600) for subheadings, and font-bold (700) for headings.
              </p>
            </CardContent>
          </Card>

          {/* Type Scale */}
          <Card>
            <CardHeader>
              <CardTitle>Type Scale</CardTitle>
              <CardDescription>Complete font size hierarchy</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-5xl font-bold">Display XL</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-5xl</code>
                    <p className="text-xs text-muted-foreground mt-1">48px / 3rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-4xl font-bold">Heading 1</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-4xl</code>
                    <p className="text-xs text-muted-foreground mt-1">36px / 2.25rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-3xl font-bold">Heading 2</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-3xl</code>
                    <p className="text-xs text-muted-foreground mt-1">30px / 1.875rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-2xl font-semibold">Heading 3</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-2xl</code>
                    <p className="text-xs text-muted-foreground mt-1">24px / 1.5rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-xl font-semibold">Heading 4</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-xl</code>
                    <p className="text-xs text-muted-foreground mt-1">20px / 1.25rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-lg font-medium">Heading 5 / Lead</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-lg</code>
                    <p className="text-xs text-muted-foreground mt-1">18px / 1.125rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3 bg-primary/5 p-3 rounded-lg -mx-3">
                  <span className="text-base">Body (Default)</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-base</code>
                    <p className="text-xs text-muted-foreground mt-1">16px / 1rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between border-b pb-3">
                  <span className="text-sm">Small / UI Text</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-sm</code>
                    <p className="text-xs text-muted-foreground mt-1">14px / 0.875rem</p>
                  </div>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs">Caption / Fine Print</span>
                  <div className="text-right">
                    <code className="text-xs bg-muted px-2 py-1 rounded">text-xs</code>
                    <p className="text-xs text-muted-foreground mt-1">12px / 0.75rem</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Text Colors */}
          <Card>
            <CardHeader>
              <CardTitle>Text Colors</CardTitle>
              <CardDescription>Semantic text color utilities</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border space-y-2">
                  <p className="text-foreground font-medium">text-foreground</p>
                  <p className="text-xs text-muted-foreground">Primary text color - headings, body text</p>
                </div>
                <div className="p-4 rounded-lg border space-y-2">
                  <p className="text-muted-foreground font-medium">text-muted-foreground</p>
                  <p className="text-xs text-muted-foreground">Secondary text - descriptions, captions</p>
                </div>
                <div className="p-4 rounded-lg border space-y-2">
                  <p className="text-primary font-medium">text-primary</p>
                  <p className="text-xs text-muted-foreground">Brand accent - links, highlights</p>
                </div>
                <div className="p-4 rounded-lg border space-y-2">
                  <p className="text-cta font-medium">text-cta</p>
                  <p className="text-xs text-muted-foreground">CTA gold - special emphasis</p>
                </div>
                <div className="p-4 rounded-lg border space-y-2">
                  <p className="text-destructive font-medium">text-destructive</p>
                  <p className="text-xs text-muted-foreground">Error states, delete actions</p>
                </div>
                <div className="p-4 rounded-lg border space-y-2">
                  <p className="text-green-600 font-medium">text-green-600</p>
                  <p className="text-xs text-muted-foreground">Success states, positive indicators</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Height & Letter Spacing */}
          <Card>
            <CardHeader>
              <CardTitle>Line Height & Letter Spacing</CardTitle>
              <CardDescription>Text rhythm and spacing utilities</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Line Heights */}
              <div>
                <p className="text-sm font-medium mb-3">Line Height</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg border">
                    <p className="leading-none mb-2">leading-none (1)</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">leading-none</code>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="leading-tight mb-2">leading-tight (1.25)</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">leading-tight</code>
                  </div>
                  <div className="p-3 rounded-lg border bg-primary/5">
                    <p className="leading-normal mb-2">leading-normal (1.5) ← Default</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">leading-normal</code>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="leading-relaxed mb-2">leading-relaxed (1.625)</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">leading-relaxed</code>
                  </div>
                </div>
              </div>

              {/* Letter Spacing */}
              <div>
                <p className="text-sm font-medium mb-3">Letter Spacing</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg border">
                    <p className="tracking-tight mb-2">Tracking Tight</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">tracking-tight</code>
                  </div>
                  <div className="p-3 rounded-lg border bg-primary/5">
                    <p className="tracking-normal mb-2">Tracking Normal</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">tracking-normal</code>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="tracking-wide mb-2">Tracking Wide</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">tracking-wide</code>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Typography Examples */}
          <Card>
            <CardHeader>
              <CardTitle>Typography Examples</CardTitle>
              <CardDescription>Common text patterns used in the application</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Page Header */}
              <div className="p-4 rounded-lg border space-y-2">
                <p className="text-xs text-muted-foreground font-mono mb-2">Page Header</p>
                <h1 className="text-4xl font-bold">Page Title</h1>
                <p className="text-lg text-muted-foreground">Descriptive subtitle explaining the page purpose</p>
              </div>

              {/* Card Header */}
              <div className="p-4 rounded-lg border space-y-2">
                <p className="text-xs text-muted-foreground font-mono mb-2">Card Header</p>
                <h3 className="text-xl font-semibold">Card Title</h3>
                <p className="text-sm text-muted-foreground">Supporting description for the card content</p>
              </div>

              {/* Form Label */}
              <div className="p-4 rounded-lg border space-y-2">
                <p className="text-xs text-muted-foreground font-mono mb-2">Form Elements</p>
                <label className="text-sm font-medium">Form Label</label>
                <p className="text-xs text-muted-foreground">Helper text that appears below form inputs</p>
              </div>

              {/* Body Copy */}
              <div className="p-4 rounded-lg border space-y-2">
                <p className="text-xs text-muted-foreground font-mono mb-2">Body Copy</p>
                <p className="text-base leading-relaxed">
                  This is an example of body copy. Use text-base (16px) for primary content with leading-relaxed for comfortable reading.
                  Keep paragraphs concise and use text-muted-foreground for secondary information.
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <Separator />

        {/* Usage Guidelines */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Usage Guidelines</h2>
            <p className="text-muted-foreground">When to use each color</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-primary">Primary Red</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Brand identity elements</li>
                  <li>Links and interactive text</li>
                  <li>Active/selected states</li>
                  <li>Important highlights</li>
                  <li>Focus rings</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-cta">CTA Gold</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Primary action buttons</li>
                  <li>Upgrade prompts</li>
                  <li>Pro feature badges</li>
                  <li>Important calls-to-action</li>
                  <li>Highlight important info</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-amber-600">Amber/Orange</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Warning messages</li>
                  <li>Pending status indicators</li>
                  <li>Caution alerts</li>
                  <li>In-progress states</li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-green-600">Green</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li>Success states</li>
                  <li>Completed status</li>
                  <li>Positive indicators</li>
                  <li>Online/active status</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* CSS Variables Reference */}
        <section className="space-y-6">
          <div>
            <h2 className="text-2xl font-semibold mb-1">CSS Variables</h2>
            <p className="text-muted-foreground">Available design tokens in index.css</p>
          </div>

          <Card>
            <CardContent className="pt-6">
              <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto">
{`/* Primary */
--primary: 1 70% 54%;        /* #DC3A38 */
--primary-foreground: 0 0% 100%;

/* CTA (Gold) */
--cta: 43 80% 72%;           /* #F1D07B */
--cta-foreground: 30 30% 20%;
--cta-hover: 43 75% 65%;

/* Pro Features */
--pro-bg: 1 70% 97%;
--pro-border: 1 60% 85%;
--pro-text: 1 70% 40%;
--pro-accent: 1 70% 54%;

/* Gradients */
--gradient-aca: linear-gradient(135deg, hsl(1, 70%, 54%) 0%, hsl(15, 70%, 50%) 100%);
--gradient-cta: linear-gradient(135deg, hsl(43, 80%, 72%) 0%, hsl(38, 85%, 65%) 100%);

/* Tailwind Classes */
bg-primary, text-primary, border-primary
bg-cta, text-cta, border-cta, bg-cta-hover
bg-pro-bg, text-pro-text, border-pro-border, bg-pro-accent
bg-gradient-aca, bg-gradient-cta`}
              </pre>
            </CardContent>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
}
