import "@/styles/marketing-specialized.css";
import SprintCheckout, { CheckoutConfig } from "./SprintCheckout";
import { KIT } from "./sprintConfig";

// Kit order form - renders the shared SprintCheckout with the Money Agent Kit
// offer. NO choices except yes/no bumps - the front-end agent is pre-picked
// (Local Leads; "pick your path" tested as a conversion killer).
const config: CheckoutConfig = {
  offer: "kit",
  leadSource: "kit-checkout",
  productName: "The Money Agent Kit",
  productSub: "the finished Local Leads Agent + walkthrough + playbook",
  price: KIT.price,
  renewalPrice: KIT.renewalPrice,
  includes: [
    "The Local Leads Agent, finished",
    "The 30-Minute Launch Walkthrough",
    "The First Dollar Playbook",
    "Bonus: The Niche Heat List",
    "Bonus: The Lead Pricing Cheat Sheet",
    "30 days of ACA Xtreme (platform + community)",
  ],
  bumps: [
    {
      key: "scripts",
      price: KIT.bumps.scripts.price,
      title: "The First Client Scripts",
      desc:
        "The exact messages that turn your agent's output into money: the cold DM and email that offer a sample batch, the pricing one-pager, and the simple agreement - for all three paths. Fill in the blanks and send.",
    },
    {
      key: "shield",
      price: KIT.bumps.shield.price,
      title: "The Deliverability Shield",
      desc:
        "Domain setup checklists, the warm-up schedule, and safe daily limits - so the emails your agent finds actually land in inboxes instead of spam. The #1 rookie mistake, pre-solved.",
    },
    {
      key: "all3",
      price: KIT.bumps.all3.price,
      title: "The Other Two Agents",
      desc:
        "Add the AI Setter (books sales calls from LinkedIn, in your voice) and the Content Factory (turns a link into carousels posted everywhere) - so you own all three money paths: leads, calls, and content.",
    },
  ],
  image: "/kit/kit-bundle.jpg",
  imageAlt: "The Money Agent Kit bundle: product box showing the agent's real verified-leads batch, quick start guide, and templates",
  barNote: "running today",
};

export default function KitOrder() {
  return <SprintCheckout config={config} />;
}
