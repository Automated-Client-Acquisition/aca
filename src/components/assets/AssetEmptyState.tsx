import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Megaphone,
  Users,
  Package,
  Target,
  Blocks,
  Plus,
  Sparkles,
  FileText,
  Image as ImageIcon,
  type LucideIcon
} from "lucide-react";

type AssetType = "brands" | "characters" | "products" | "icps" | "blocks" | "strategies" | "images";

interface AssetEmptyStateProps {
  type: AssetType;
  onAdd: () => void;
}

interface AssetConfig {
  icon: LucideIcon;
  iconColor: string;
  bgGradient: string;
  title: string;
  description: string;
  buttonLabel: string;
  tips: {
    icon: LucideIcon;
    iconColor: string;
    title: string;
    description: string;
  }[];
}

const assetConfigs: Record<AssetType, AssetConfig> = {
  brands: {
    icon: Megaphone,
    iconColor: "text-primary",
    bgGradient: "from-primary/10 to-primary/5",
    title: "No brands yet",
    description: "Define your brand voices to maintain consistent tone and messaging across all generated content.",
    buttonLabel: "Create Brand",
    tips: [
      {
        icon: Sparkles,
        iconColor: "text-primary",
        title: "Define Tone",
        description: "Set professional, casual, or playful voice"
      },
      {
        icon: Target,
        iconColor: "text-primary",
        title: "Stay Consistent",
        description: "Reuse across all content types"
      },
      {
        icon: Users,
        iconColor: "text-pink-500",
        title: "Multiple Brands",
        description: "Manage different brand identities"
      }
    ]
  },
  characters: {
    icon: Users,
    iconColor: "text-emerald-500",
    bgGradient: "from-emerald-500/10 to-teal-500/10",
    title: "No characters yet",
    description: "Create characters or personas to feature in your content. Perfect for storytelling and relatable narratives.",
    buttonLabel: "Create Character",
    tips: [
      {
        icon: Users,
        iconColor: "text-emerald-500",
        title: "Build Personas",
        description: "Create relatable characters"
      },
      {
        icon: Sparkles,
        iconColor: "text-teal-500",
        title: "Add Depth",
        description: "Define backstories and traits"
      },
      {
        icon: Target,
        iconColor: "text-cyan-500",
        title: "Engage Audiences",
        description: "Characters drive connection"
      }
    ]
  },
  products: {
    icon: Package,
    iconColor: "text-orange-500",
    bgGradient: "from-orange-500/10 to-amber-500/10",
    title: "No products yet",
    description: "Add your products or services to seamlessly integrate them into generated content and marketing materials.",
    buttonLabel: "Add Product",
    tips: [
      {
        icon: Package,
        iconColor: "text-orange-500",
        title: "Product Details",
        description: "Store key features and benefits"
      },
      {
        icon: Sparkles,
        iconColor: "text-amber-500",
        title: "Auto-Integration",
        description: "Weave products into content"
      },
      {
        icon: Megaphone,
        iconColor: "text-yellow-500",
        title: "Marketing Ready",
        description: "Generate promotional content"
      }
    ]
  },
  icps: {
    icon: Target,
    iconColor: "text-rose-500",
    bgGradient: "from-rose-500/10 to-pink-500/10",
    title: "No target audiences yet",
    description: "Define your ideal customer profiles to generate content that resonates with your specific audience segments.",
    buttonLabel: "Define Audience",
    tips: [
      {
        icon: Target,
        iconColor: "text-rose-500",
        title: "Know Your Audience",
        description: "Define demographics and interests"
      },
      {
        icon: Sparkles,
        iconColor: "text-pink-500",
        title: "Tailored Content",
        description: "Generate audience-specific messaging"
      },
      {
        icon: Users,
        iconColor: "text-red-500",
        title: "Multiple Segments",
        description: "Create content for each ICP"
      }
    ]
  },
  blocks: {
    icon: Blocks,
    iconColor: "text-blue-500",
    bgGradient: "from-blue-500/10 to-sky-500/10",
    title: "No content blocks yet",
    description: "Create reusable content blocks like CTAs, disclaimers, or boilerplate text to streamline your content creation.",
    buttonLabel: "Create Block",
    tips: [
      {
        icon: Blocks,
        iconColor: "text-blue-500",
        title: "Reusable Content",
        description: "Save common text snippets"
      },
      {
        icon: Sparkles,
        iconColor: "text-sky-500",
        title: "Quick Insert",
        description: "Drop blocks into any content"
      },
      {
        icon: Target,
        iconColor: "text-cyan-500",
        title: "Stay Compliant",
        description: "Standard disclaimers and CTAs"
      }
    ]
  },
  strategies: {
    icon: FileText,
    iconColor: "text-primary",
    bgGradient: "from-primary/10 to-primary/5",
    title: "No strategy documents yet",
    description: "Create strategy documents like lead magnets, sales strategies, content calendars, and funnels to guide your content creation.",
    buttonLabel: "Create Strategy",
    tips: [
      {
        icon: FileText,
        iconColor: "text-primary",
        title: "Strategic Plans",
        description: "Document your marketing strategies"
      },
      {
        icon: Sparkles,
        iconColor: "text-primary",
        title: "Guide Creation",
        description: "Reference during content generation"
      },
      {
        icon: Target,
        iconColor: "text-fuchsia-500",
        title: "Stay Aligned",
        description: "Keep all content on strategy"
      }
    ]
  },
  images: {
    icon: ImageIcon,
    iconColor: "text-violet-500",
    bgGradient: "from-violet-500/10 to-purple-500/10",
    title: "No images yet",
    description: "Upload standalone pictures to use as reference images during content generation — no product, character, or brand wrapper needed.",
    buttonLabel: "Add Images",
    tips: [
      {
        icon: ImageIcon,
        iconColor: "text-violet-500",
        title: "Just Pictures",
        description: "No extra metadata required"
      },
      {
        icon: Sparkles,
        iconColor: "text-purple-500",
        title: "Group Freely",
        description: "Bundle several images under one name"
      },
      {
        icon: Target,
        iconColor: "text-fuchsia-500",
        title: "Pick in Wizard",
        description: "Select them like any other library asset"
      }
    ]
  }
};

export function AssetEmptyState({ type, onAdd }: AssetEmptyStateProps) {
  const config = assetConfigs[type];
  const Icon = config.icon;

  return (
    <Card className="border-dashed border-2 bg-gradient-to-br from-card to-card/50">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-6 relative">
          <div className={`absolute inset-0 bg-gradient-to-br ${config.bgGradient} rounded-full blur-2xl scale-150`} />
          <div className={`relative bg-gradient-to-br ${config.bgGradient} p-6 rounded-full border border-border/50`}>
            <Icon className={`h-12 w-12 ${config.iconColor}`} />
          </div>
        </div>

        <h3 className="text-2xl font-semibold mb-3">{config.title}</h3>
        <p className="text-muted-foreground mb-8 max-w-md">
          {config.description}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 max-w-2xl w-full">
          {config.tips.map((tip, index) => {
            const TipIcon = tip.icon;
            return (
              <div
                key={index}
                className="p-4 rounded-lg bg-muted/50 border border-border/50 hover:bg-muted/70 transition-colors"
              >
                <TipIcon className={`h-6 w-6 ${tip.iconColor} mb-2 mx-auto`} />
                <p className="text-sm font-medium mb-1">{tip.title}</p>
                <p className="text-xs text-muted-foreground">{tip.description}</p>
              </div>
            );
          })}
        </div>

        <Button variant="cta" onClick={onAdd} className="gap-2">
          <Plus className="h-4 w-4" />
          {config.buttonLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
