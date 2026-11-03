import "@/styles/aca-home.css";
import { MarketingFooter, MarketingNav } from "@/components/marketing";
import {
  Hero,
  SetupSection,
  DualEngineSection,
  LogoStrip,
  ProblemSection,
  OrchestrationSection,
  WhyNowSection,
  AgentStackSection,
  ProofSection,
  MagnetSection,
  BYOKSection,
  StackReplaceSection,
  WhoThisIsForSection,
  PricingSection,
  GuaranteeSection,
  FAQSection,
  FinalCTA,
} from "@/components/marketing/home";

export default function Index() {
  return (
    <div className="aca-home">
      <MarketingNav />
      <Hero />
      <SetupSection />
      <DualEngineSection />
      <LogoStrip />
      <ProblemSection />
      <OrchestrationSection />
      <AgentStackSection />
      <WhyNowSection />
      <ProofSection />
      <MagnetSection />
      <BYOKSection />
      <StackReplaceSection />
      <WhoThisIsForSection />
      <PricingSection />
      <GuaranteeSection />
      <FAQSection />
      <FinalCTA />
      <MarketingFooter />
    </div>
  );
}
