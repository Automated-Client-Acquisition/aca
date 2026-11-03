import { Crown, ExternalLink, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { UPGRADE_URL } from "@/hooks/useFeatureAccess";

interface ShowcaseHeroProps {
  icon: React.ElementType;
  title: string;
  description: string;
}

export function ShowcaseHero({ icon: Icon, title, description }: ShowcaseHeroProps) {
  return (
    <div className="text-center mb-12">
      <div className="inline-flex items-center gap-2 px-4 py-2 bg-cta/10 border border-cta/20 rounded-full text-cta font-medium text-sm mb-6">
        <Crown className="h-4 w-4" />
        Pro Feature
      </div>
      <div className="flex justify-center mb-6">
        <div className="w-20 h-20 rounded-3xl bg-gradient-aca flex items-center justify-center shadow-2xl shadow-primary/20">
          <Icon className="w-10 h-10 text-white" />
        </div>
      </div>
      <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">{title}</h1>
      <p className="text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">{description}</p>
    </div>
  );
}

export interface ShowcaseFeature {
  icon: React.ElementType;
  title: string;
  description: string;
}

interface ShowcaseFeatureGridProps {
  features: ShowcaseFeature[];
}

export function ShowcaseFeatureGrid({ features }: ShowcaseFeatureGridProps) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-12">
      {features.map((feature, index) => (
        <Card key={index} className="border-2 hover:border-primary/20 hover:shadow-lg transition-all duration-200">
          <CardHeader>
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg mb-2">{feature.title}</CardTitle>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

interface ShowcaseBenefitsProps {
  benefits: string[];
}

export function ShowcaseBenefits({ benefits }: ShowcaseBenefitsProps) {
  return (
    <Card className="bg-muted/50 border-2 mb-12">
      <CardContent className="p-8">
        <h3 className="text-2xl font-bold mb-6 text-center">Why Upgrade?</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {benefits.map((benefit, index) => (
            <div key={index} className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              <p className="text-sm">{benefit}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function ShowcaseCTA() {
  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="text-center py-8">
      <Button
        variant="cta"
        onClick={handleUpgrade}
        size="lg"
        className="shadow-lg px-12 py-6 text-lg"
      >
        <Sparkles className="h-5 w-5 mr-3" />
        Upgrade to Pro
        <ExternalLink className="h-5 w-5 ml-3" />
      </Button>
      <p className="text-sm text-muted-foreground mt-4">
        Your plan is linked to your Skool community membership
      </p>
    </div>
  );
}

interface ShowcaseLayoutProps {
  children: React.ReactNode;
}

export function ShowcaseLayout({ children }: ShowcaseLayoutProps) {
  return (
    <div className={cn("max-w-6xl mx-auto py-12")}>
      {children}
    </div>
  );
}
