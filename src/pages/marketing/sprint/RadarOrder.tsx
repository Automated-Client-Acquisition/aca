import "@/styles/marketing-specialized.css";
import SprintCheckout, { CheckoutConfig } from "./SprintCheckout";
import { RADAR } from "./sprintConfig";

// Radar order form - the shared SprintCheckout with the Buying Signals Kit
// offer. NO choices except yes/no bumps (agent is pre-picked).
const config: CheckoutConfig = {
  offer: "radar",
  leadSource: "radar-checkout",
  productName: "The Buying Signals Kit",
  productSub: "the finished Signals Agent + walkthrough + playbook",
  price: RADAR.price,
  renewalPrice: RADAR.renewalPrice,
  includes: [
    "The Buying Signals Agent, finished",
    "The 30-Minute Launch Walkthrough",
    "The First Meeting Playbook",
    "Bonus: The 8 Signals Cheat Sheet",
    "Bonus: The Signal Scoring Sheet",
    "30 days of ACA Xtreme (platform + community)",
  ],
  bumps: [
    {
      key: "scripts",
      price: RADAR.bumps.scripts.price,
      title: "The Signal Scripts",
      desc:
        "The word-for-word first message for every signal type - funding, new sales leader, hiring spree, launch - plus the follow-up that converts a reply into a calendar link. Fill in the blanks and send.",
    },
    {
      key: "shield",
      price: RADAR.bumps.shield.price,
      title: "The Deliverability Shield",
      desc:
        "Domain setup checklists, the warm-up schedule, and safe daily limits - so your perfectly-timed messages actually land in inboxes instead of spam. The #1 rookie mistake, pre-solved.",
    },
    {
      key: "duo",
      price: RADAR.bumps.duo.price,
      title: "The Other Two Outbound Agents",
      desc:
        "Add the Lead Pipeline Agent (researches and qualifies prospects end to end) and the AI Setter (books calls from LinkedIn, in your voice) - warm windows for timing, volume for coverage.",
    },
  ],
  image: "/radar/radar-bundle.jpg",
  imageAlt: "The Buying Signals Kit bundle: the agent, the First Meeting Playbook, the walkthrough, both bonuses, and 30 days of ACA Xtreme",
  barNote: "watching the market tonight",
};

export default function RadarOrder() {
  return <SprintCheckout config={config} />;
}
