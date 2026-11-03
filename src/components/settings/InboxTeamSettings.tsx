import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield } from "lucide-react";
import {
  useInboxVisibilityMode,
  useUpdateInboxVisibilityMode,
  type InboxVisibilityMode,
} from "@/hooks/useInboxVisibilityMode";

const VISIBILITY_OPTIONS: {
  value: InboxVisibilityMode;
  label: string;
  description: string;
}[] = [
  {
    value: "all",
    label: "Everyone sees all",
    description:
      "All team members can see every conversation in the inbox. This is the default and simplest option.",
  },
  {
    value: "assigned_only",
    label: "Assigned only",
    description:
      "Members see only conversations assigned to them, plus unassigned conversations. Great for teams with clear ownership.",
  },
  {
    value: "own_accounts_only",
    label: "Own accounts only",
    description:
      "Members see conversations from sender accounts they own, conversations assigned to them, and unassigned conversations.",
  },
];

export function InboxTeamSettings() {
  const { data: currentMode, isLoading } = useInboxVisibilityMode();
  const updateMode = useUpdateInboxVisibilityMode();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Inbox & Team</h2>
        <p className="text-sm text-muted-foreground">
          Control who can see which conversations in the shared inbox.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation Visibility</CardTitle>
          <CardDescription>
            Choose how conversations are visible to team members. Admins and
            Owners always see everything regardless of this setting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <RadioGroup
              value={currentMode || "all"}
              onValueChange={(v) => updateMode.mutate(v as InboxVisibilityMode)}
              className="space-y-4"
              disabled={updateMode.isPending}
            >
              {VISIBILITY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-3 p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors has-[input:checked]:border-primary has-[input:checked]:bg-primary/5"
                >
                  <RadioGroupItem value={option.value} className="mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{option.label}</span>
                      {option.value === "all" && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {option.description}
                    </p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Admin Override
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Organization owners and admins always have full visibility into all
            conversations, regardless of the visibility mode selected above.
            This ensures managers can monitor team performance and step in when
            needed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
