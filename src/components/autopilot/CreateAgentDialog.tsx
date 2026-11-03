import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AgentSettingsPanel } from "@/components/autopilot/AgentSettingsPanel";
import { useCreateAgentProfile, type AgentProfile } from "@/hooks/useAgentProfiles";
import type { AutopilotConfig } from "@/types/email";

const DEFAULT_CONFIG: AutopilotConfig = {
  enabled: true,
  rules: [
    { intent: "interested", action: "auto_reply" },
    { intent: "neutral", action: "auto_reply" },
    { intent: "out_of_office", action: "auto_followup_after_return" },
    { intent: "not_interested", action: "auto_reply" },
  ],
  require_approval: true,
  max_auto_replies: 10,
  max_conversation_turns: 10,
};

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (profile: AgentProfile) => void;
  /** Pre-fill config when creating from "Save as New" flow */
  initialConfig?: AutopilotConfig;
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  onCreated,
  initialConfig,
}: CreateAgentDialogProps) {
  const createProfile = useCreateAgentProfile();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<AutopilotConfig>(DEFAULT_CONFIG);

  // Pre-fill config when opening with initialConfig (Save as New flow)
  useEffect(() => {
    if (open && initialConfig) {
      setConfig(initialConfig);
    }
  }, [open, initialConfig]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setConfig(DEFAULT_CONFIG);
  };

  const handleCreate = () => {
    if (!name.trim()) return;
    createProfile.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        config,
      },
      {
        onSuccess: (newProfile) => {
          onCreated?.(newProfile);
          onOpenChange(false);
          resetForm();
        },
      }
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>New Agent</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Configure your new AI agent profile
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="e.g. SDR Follow-up, Inbound Qualifier"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="What does this agent do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[60px]"
              />
            </div>
            <AgentSettingsPanel
              config={config}
              onChange={setConfig}
              context="conversation"
            />
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t shrink-0">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleCreate}
            disabled={!name.trim() || createProfile.isPending}
          >
            {createProfile.isPending ? "Creating..." : "Create Agent"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
