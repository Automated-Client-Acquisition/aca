import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Lightbulb,
  Users,
  Search,
  FileText,
  Plus,
  Sparkles,
  TrendingUp,
  Globe,
  Video,
  type LucideIcon
} from "lucide-react";

type IdeasTabType = "ideas" | "creators" | "search" | "scraped";

interface IdeasEmptyStateProps {
  type: IdeasTabType;
  onAdd?: () => void;
}

interface TabConfig {
  icon: LucideIcon;
  iconColor: string;
  bgGradient: string;
  title: string;
  description: string;
  buttonLabel?: string;
  tips: {
    icon: LucideIcon;
    iconColor: string;
    title: string;
    description: string;
  }[];
}

const tabConfigs: Record<IdeasTabType, TabConfig> = {
  ideas: {
    icon: Lightbulb,
    iconColor: "text-cta",
    bgGradient: "from-cta/10 to-cta/15",
    title: "No ideas yet",
    description: "Ideas are the starting point for all your content. Generate them with AI, add manually, or create from scraped content.",
    buttonLabel: "Create Idea",
    tips: [
      {
        icon: Sparkles,
        iconColor: "text-cta",
        title: "AI Generate",
        description: "Let AI brainstorm ideas for you"
      },
      {
        icon: FileText,
        iconColor: "text-cta",
        title: "From Scraped",
        description: "Transform scraped content into ideas"
      },
      {
        icon: TrendingUp,
        iconColor: "text-cta",
        title: "Track Progress",
        description: "Move ideas through your pipeline"
      }
    ]
  },
  creators: {
    icon: Users,
    iconColor: "text-primary",
    bgGradient: "from-primary/10 to-primary/15",
    title: "No creators yet",
    description: "Add creators from TikTok, Instagram, or YouTube to discover trending content and inspiration for your ideas.",
    buttonLabel: "Add Creator",
    tips: [
      {
        icon: Users,
        iconColor: "text-primary",
        title: "Track Creators",
        description: "Monitor content from top creators"
      },
      {
        icon: Video,
        iconColor: "text-primary",
        title: "Auto-Scrape",
        description: "Automatically fetch their latest content"
      },
      {
        icon: Sparkles,
        iconColor: "text-pink-500",
        title: "Get Inspired",
        description: "Turn their content into your ideas"
      }
    ]
  },
  search: {
    icon: Search,
    iconColor: "text-cyan-500",
    bgGradient: "from-cyan-500/10 to-blue-500/10",
    title: "No search terms yet",
    description: "Add search terms to discover trending content across platforms. Find viral posts and turn them into content ideas.",
    buttonLabel: "Add Search Term",
    tips: [
      {
        icon: Search,
        iconColor: "text-cyan-500",
        title: "Keyword Research",
        description: "Track trending topics in your niche"
      },
      {
        icon: Globe,
        iconColor: "text-blue-500",
        title: "Multi-Platform",
        description: "Search across TikTok, IG, YouTube"
      },
      {
        icon: TrendingUp,
        iconColor: "text-sky-500",
        title: "Trend Discovery",
        description: "Find what's going viral now"
      }
    ]
  },
  scraped: {
    icon: FileText,
    iconColor: "text-emerald-500",
    bgGradient: "from-emerald-500/10 to-green-500/10",
    title: "No scraped content yet",
    description: "Scraped content appears here after you scrape creators or search terms. Use it as inspiration for your own content.",
    tips: [
      {
        icon: Users,
        iconColor: "text-emerald-500",
        title: "From Creators",
        description: "Scrape content from tracked creators"
      },
      {
        icon: Search,
        iconColor: "text-green-500",
        title: "From Search",
        description: "Discover content via search terms"
      },
      {
        icon: Lightbulb,
        iconColor: "text-teal-500",
        title: "Create Ideas",
        description: "Transform scraped content into ideas"
      }
    ]
  }
};

export function IdeasEmptyState({ type, onAdd }: IdeasEmptyStateProps) {
  const config = tabConfigs[type];
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

        {config.buttonLabel && onAdd && (
          <Button variant="cta" onClick={onAdd} className="gap-2">
            <Plus className="h-4 w-4" />
            {config.buttonLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
