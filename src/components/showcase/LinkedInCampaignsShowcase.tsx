import {
  Megaphone,
  Users,
  MessageSquare,
  GitBranch,
  BarChart3,
  Brain,
  RefreshCw,
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
    icon: GitBranch,
    title: "Visual Sequence Builder",
    description: "Drag-and-drop builder with conditional logic, delays, and multi-step workflows",
  },
  {
    icon: MessageSquare,
    title: "Multi-Step Outreach",
    description: "Connection requests, messages, InMails, and automated follow-ups in one sequence",
  },
  {
    icon: Brain,
    title: "AI Personalization",
    description: "Generate personalized messages using AI with profile context and custom variables",
  },
  {
    icon: Users,
    title: "Lead Management",
    description: "Track connections, replies, and engagement across your entire campaign pipeline",
  },
  {
    icon: RefreshCw,
    title: "Sender Rotation",
    description: "Rotate between multiple LinkedIn accounts with smart daily limits and safety controls",
  },
  {
    icon: BarChart3,
    title: "Campaign Analytics",
    description: "Real-time metrics on connection rates, response rates, and conversion tracking",
  },
];

const benefits = [
  "10x your outreach capacity without hiring SDRs",
  "Never miss a follow-up with automated sequences",
  "Maintain personal touch with AI-powered personalization",
  "Track every interaction in a unified dashboard",
  "Protect your LinkedIn accounts with smart rate limiting",
  "Scale to hundreds of connections per week safely",
];

export function LinkedInCampaignsShowcase() {
  return (
    <ShowcaseLayout>
      <ShowcaseHero
        icon={Megaphone}
        title="Scale Your Outreach Automations"
        description="Multi-channel outreach automations (LinkedIn, email, WhatsApp & more) with multi-step sequences, AI personalization, and advanced analytics"
      />
      <ShowcaseFeatureGrid features={features} />
      <ShowcaseBenefits benefits={benefits} />
      <ShowcaseCTA />
    </ShowcaseLayout>
  );
}
