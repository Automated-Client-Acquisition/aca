import { Calendar, Bot } from "lucide-react";
import { CalendarConnectionCard } from "@/components/settings/CalendarConnectionCard";
import { CalendarPreferencesCard } from "@/components/settings/CalendarPreferencesCard";
import { GHLCalendarsSection } from "@/components/settings/GHLCalendarsSection";
import { useGHLAccounts } from "@/hooks/useGHLAccounts";

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function CalendarSection({ icon, title, description, children }: SectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 pb-2 border-b">
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
          {icon}
        </div>
        <div>
          <h3 className="font-semibold text-sm">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function CalendarTab() {
  const { data: accountsData } = useGHLAccounts();
  const ghlConnected = !!(
    accountsData?.success &&
    !accountsData?.needsOAuth &&
    !accountsData?.needsReconnect
  );

  return (
    <div className="space-y-10">
      <CalendarSection
        icon={<Calendar className="w-4 h-4" />}
        title="Meeting Scheduling"
        description="Connect calendars and configure meeting defaults for campaigns and contact pages"
      >
        <CalendarConnectionCard />
        <CalendarPreferencesCard />
      </CalendarSection>

      <CalendarSection
        icon={<Bot className="w-4 h-4" />}
        title="Autopilot Appointments"
        description="GoHighLevel calendars used by AI autopilot for automated booking"
      >
        <GHLCalendarsSection ghlConnected={ghlConnected} />
      </CalendarSection>
    </div>
  );
}
