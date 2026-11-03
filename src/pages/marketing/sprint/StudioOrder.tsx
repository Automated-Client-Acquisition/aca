import "@/styles/marketing-specialized.css";
import SprintCheckout, { CheckoutConfig } from "./SprintCheckout";
import { STUDIO } from "./sprintConfig";

// Studio order form - renders the shared SprintCheckout with the Faceless
// Channel Kit offer. NO choices except yes/no bumps (agent is pre-picked).
const config: CheckoutConfig = {
  offer: "studio",
  leadSource: "studio-checkout",
  productName: "The Faceless Channel Kit",
  productSub: "the finished Channel Agent + walkthrough + playbook",
  price: STUDIO.price,
  renewalPrice: STUDIO.renewalPrice,
  includes: [
    "The Faceless Channel Agent, finished",
    "The 30-Minute Launch Walkthrough",
    "The First 1,000 Subscribers Playbook",
    "Bonus: The Niche Goldmine List",
    "Bonus: The Hook Vault",
    "30 days of ACA Xtreme (platform + community)",
  ],
  bumps: [
    {
      key: "titles",
      price: STUDIO.bumps.titles.price,
      title: "The Viral Title & Thumbnail Pack",
      desc:
        "100 proven title formulas and the thumbnail prompt library the agent pulls from - so every video gets the click, not just the watch. The half of YouTube nobody scripts for, pre-solved.",
    },
    {
      key: "shield",
      price: STUDIO.bumps.shield.price,
      title: "The Monetization Shield",
      desc:
        "The copyright-safe footage sources, the reused-content rules, and the AdSense-safe checklist - so your faceless channel gets monetized instead of struck or demonetized. The #1 rookie mistake, pre-solved.",
    },
    {
      key: "content2",
      price: STUDIO.bumps.content2.price,
      title: "The Other Two Content Agents",
      desc:
        "Add the Carousel Factory (turns any script into carousels posted everywhere) and the SEO Growth Agent (turns your videos into ranking blog posts) - so one script becomes content on every platform, not just YouTube.",
    },
  ],
  image: "/studio/studio-bundle.jpg",
  imageAlt: "The Faceless Channel Kit bundle: product box, playbook, and devices showing the agent's real 30-video content calendar",
  barNote: "writing today",
};

export default function StudioOrder() {
  return <SprintCheckout config={config} />;
}
