import {
  Mail,
  TrendingUp,
  Shield,
  GitBranch,
  BarChart3,
  Users,
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
    icon: TrendingUp,
    title: "Email Warmup System",
    description: "29-day automated warmup ramp to establish sender reputation and avoid spam filters",
  },
  {
    icon: RefreshCw,
    title: "Multi-Mailbox Rotation",
    description: "Rotate between unlimited mailboxes to scale volume while maintaining deliverability",
  },
  {
    icon: Users,
    title: "Multiple Providers",
    description: "SMTP, ZapMail, Gmail OAuth, and Outlook OAuth support in one unified platform",
  },
  {
    icon: GitBranch,
    title: "Sequence Builder",
    description: "Create multi-step email sequences with A/B testing and conditional logic",
  },
  {
    icon: Shield,
    title: "Deliverability Tracking",
    description: "Monitor spam scores, domain health, and inbox placement rates in real time",
  },
  {
    icon: BarChart3,
    title: "Advanced Analytics",
    description: "Track opens, clicks, replies, and conversions with detailed per-campaign reporting",
  },
];

const benefits = [
  "Reach inbox instead of spam with proven warmup system",
  "Send thousands of emails per day with multi-mailbox rotation",
  "Automatic reply detection and CRM integration",
  "Real-time deliverability insights to optimize campaigns",
  "Flexible provider support for any email infrastructure",
  "Scale cold email without damaging sender reputation",
];

export function EmailCampaignsShowcase() {
  return (
    <ShowcaseLayout>
      <ShowcaseHero
        icon={Mail}
        title="Professional Cold Email at Scale"
        description="Email sequences with warmup, deliverability tracking, and multi-mailbox rotation"
      />
      <ShowcaseFeatureGrid features={features} />
      <ShowcaseBenefits benefits={benefits} />
      <ShowcaseCTA />
    </ShowcaseLayout>
  );
}
