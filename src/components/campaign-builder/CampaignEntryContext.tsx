import { createContext } from "react";
import type { CampaignEntryRule } from "@/lib/campaign-entry";

// Entry rules belong to the campaign, never to saved graph node data.
export const CampaignEntryContext = createContext<CampaignEntryRule[]>([]);

export interface CampaignAudienceList {
  name: string;
  count: number;
}

// The campaign's lead lists, named on the Start step like the homepage mockup.
export const CampaignAudienceContext = createContext<CampaignAudienceList[]>([]);
