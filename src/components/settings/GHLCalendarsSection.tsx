import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Calendar, RefreshCw, XCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useGHLCalendars } from "@/hooks/useGHLCalendars";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

interface GHLCalendarsSectionProps {
  ghlConnected: boolean;
}

export function GHLCalendarsSection({ ghlConnected }: GHLCalendarsSectionProps) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: ghlCalendars, isLoading, isError } = useGHLCalendars({ enabled: ghlConnected });

  const handleRefresh = async () => {
    if (!currentOrganization) return;
    setIsRefreshing(true);
    try {
      const { error } = await supabase.functions.invoke("ghl-list-calendars", {
        body: { organizationId: currentOrganization.id, force: true },
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["ghl-calendars"] });
      toast.success("Calendars refreshed");
    } catch {
      toast.error("Failed to refresh calendars");
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!ghlConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5 text-muted-foreground" />
            GoHighLevel Calendars
          </CardTitle>
          <CardDescription>
            Connect GoHighLevel to enable AI autopilot appointment booking.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Calendar className="h-4 w-4" />
            <AlertDescription className="text-sm">
              GoHighLevel is not connected yet. Connect it in Integrations to see your calendars here.
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => navigate("/settings?tab=integrations")}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Go to Integrations
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              GoHighLevel Calendars
            </CardTitle>
            <CardDescription>
              Calendars available for AI autopilot booking. The agent will check availability and book appointments into the selected calendar.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-3 w-3 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Alert variant="destructive" className="border-destructive/50">
            <XCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Failed to load calendars. Try reconnecting your GHL account in{" "}
              <a href="/settings?tab=integrations" className="underline underline-offset-2">
                Integrations
              </a>.
            </AlertDescription>
          </Alert>
        ) : ghlCalendars && ghlCalendars.length > 0 ? (
          <div className="space-y-2">
            {ghlCalendars.map((cal) => (
              <div
                key={cal.calendar_id}
                className="flex items-center justify-between p-2.5 rounded-md border bg-background"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{cal.calendar_name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {cal.calendar_type && (
                    <Badge variant="secondary" className="text-[10px] h-5">
                      {cal.calendar_type.replace(/_/g, " ")}
                    </Badge>
                  )}
                  {cal.is_active ? (
                    <div className="w-2 h-2 rounded-full bg-green-500" title="Active" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-muted-foreground" title="Inactive" />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-xs text-muted-foreground">
              No calendars found. Create a calendar in your GHL location, then click Refresh.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
