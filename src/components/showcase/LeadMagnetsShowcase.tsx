import {
  Magnet,
  MessageSquare,
  Zap,
  Users,
  BarChart3,
  Shield,
  Target,
} from "lucide-react";
import {
  ShowcaseLayout,
  ShowcaseHero,
  ShowcaseFeatureGrid,
  ShowcaseBenefits,
  ShowcaseCTA,
} from "@/components/showcase/ShowcaseLayout";
import type { ShowcaseFeature } from "@/components/showcase/ShowcaseLayout";

const features: ShowcaseFeature[] = [
  {
    icon: MessageSquare,
    title: "Comment Monitoring",
    description: "Automatically detect keywords in LinkedIn and Instagram comments in real time",
  },
  {
    icon: Zap,
    title: "Auto-DM Delivery",
    description: "Send lead magnet links via DM instantly when someone comments with trigger words",
  },
  {
    icon: Users,
    title: "Multi-Channel Support",
    description: "Works across LinkedIn, Instagram, WhatsApp, Telegram, and more platforms",
  },
  {
    icon: Target,
    title: "Lead Qualification",
    description: "Track engagement, qualify leads, and route to your CRM automatically",
  },
  {
    icon: Shield,
    title: "Handoff Rules",
    description: "Create custom rules to route qualified leads to sales or automation workflows",
  },
  {
    icon: BarChart3,
    title: "Capture Analytics",
    description: "Monitor capture rates, engagement, and conversion metrics by platform",
  },
];

const benefits = [
  "Never miss a warm lead from social media comments",
  "Capture leads 24/7 without manual monitoring",
  "Qualify leads before sending them to your sales team",
  "Scale lead capture across multiple social platforms",
  "Custom landing pages for each lead magnet",
  "Automatic CRM integration and handoff to sales",
];

export function LeadMagnetsShowcase() {
  return (
    <ShowcaseLayout>
      <ShowcaseHero
        icon={Magnet}
        title="Capture Leads on Autopilot"
        description="Automated lead capture from social media comments with instant DM delivery and CRM integration"
      />
      <ShowcaseFeatureGrid features={features} />
      <ShowcaseBenefits benefits={benefits} />
      <ShowcaseCTA />
    </ShowcaseLayout>
  );
}
