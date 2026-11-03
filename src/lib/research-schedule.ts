export interface ResearchScheduleDraft {
  enabled: boolean;
  frequency: "hourly" | "daily" | "weekly";
  maxItems: string;
  autoPause: boolean;
}

export const defaultResearchSchedule: ResearchScheduleDraft = {
  enabled: false,
  frequency: "daily",
  maxItems: "100",
  autoPause: true,
};

export function getNextResearchScheduleRun(frequency: ResearchScheduleDraft["frequency"], now = new Date()): string {
  const hours = { hourly: 1, daily: 24, weekly: 168 };
  return new Date(now.getTime() + hours[frequency] * 60 * 60 * 1000).toISOString();
}
