import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Loader2, FileText } from "lucide-react";
import {
  useMeetingTemplates,
  useCreateMeetingTemplate,
  type MeetingTemplate,
} from "@/hooks/calendar/useMeetingTemplates";
import { CONFERENCE_PROVIDERS, DURATION_OPTIONS } from "@/hooks/calendar/useCalendarPreferences";

interface MeetingTemplateSelectorProps {
  value: string;
  onChange: (templateId: string, template?: MeetingTemplate) => void;
  disabled?: boolean;
}

export function MeetingTemplateSelector({
  value,
  onChange,
  disabled,
}: MeetingTemplateSelectorProps) {
  const { data: templates, isLoading } = useMeetingTemplates();
  const createTemplate = useCreateMeetingTemplate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // New template form state
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    description: "",
    title_template: "",
    body_template: "",
    duration_minutes: 30,
    conference_provider: "google_meet" as const,
    location: "",
    is_default: false,
  });

  const handleCreateTemplate = async () => {
    await createTemplate.mutateAsync({
      ...newTemplate,
      conference_provider: newTemplate.conference_provider || null,
    });
    setShowCreateDialog(false);
    setNewTemplate({
      name: "",
      description: "",
      title_template: "",
      body_template: "",
      duration_minutes: 30,
      conference_provider: "google_meet",
      location: "",
      is_default: false,
    });
  };

  const handleChange = (templateId: string) => {
    const template = templates?.find((t) => t.id === templateId);
    onChange(templateId, template);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={handleChange} disabled={disabled}>
          <SelectTrigger className="flex-1">
            <FileText className="h-4 w-4 mr-2 opacity-50" />
            <SelectValue placeholder="Choose a template (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">No template</SelectItem>
            {templates?.map((template) => (
              <SelectItem key={template.id} value={template.id} textValue={template.name}>
                <div className="flex items-center gap-2">
                  <span>{template.name}</span>
                  {template.is_default && (
                    <Badge variant="secondary" className="text-[10px] px-1">
                      Default
                    </Badge>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" disabled={disabled}>
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Meeting Template</DialogTitle>
              <DialogDescription>
                Save time by creating reusable meeting templates. Use {"{contact_name}"} for
                dynamic contact names.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="template-name">Template Name</Label>
                <Input
                  id="template-name"
                  placeholder="e.g., Discovery Call"
                  value={newTemplate.name}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, name: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-title">Meeting Title Template</Label>
                <Input
                  id="template-title"
                  placeholder="e.g., Intro call with {contact_name}"
                  value={newTemplate.title_template}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, title_template: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Available variables: {"{contact_name}"}, {"{contact_first_name}"}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="template-duration">Duration</Label>
                  <Select
                    value={String(newTemplate.duration_minutes)}
                    onValueChange={(v) =>
                      setNewTemplate({ ...newTemplate, duration_minutes: parseInt(v, 10) })
                    }
                  >
                    <SelectTrigger id="template-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template-conference">Video Conference</Label>
                  <Select
                    value={newTemplate.conference_provider}
                    onValueChange={(v) =>
                      setNewTemplate({
                        ...newTemplate,
                        conference_provider: v as typeof newTemplate.conference_provider,
                      })
                    }
                  >
                    <SelectTrigger id="template-conference">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFERENCE_PROVIDERS.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-body">Description Template (optional)</Label>
                <Textarea
                  id="template-body"
                  placeholder="Add default meeting agenda..."
                  rows={3}
                  value={newTemplate.body_template}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, body_template: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-location">Location (optional)</Label>
                <Input
                  id="template-location"
                  placeholder="e.g., Conference Room A"
                  value={newTemplate.location}
                  onChange={(e) =>
                    setNewTemplate({ ...newTemplate, location: e.target.value })
                  }
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="template-default"
                  checked={newTemplate.is_default}
                  onCheckedChange={(checked) =>
                    setNewTemplate({ ...newTemplate, is_default: checked === true })
                  }
                />
                <Label htmlFor="template-default" className="font-normal">
                  Set as default template
                </Label>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateTemplate}
                disabled={
                  !newTemplate.name ||
                  !newTemplate.title_template ||
                  createTemplate.isPending
                }
              >
                {createTemplate.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {value && templates?.find((t) => t.id === value)?.description && (
        <p className="text-xs text-muted-foreground">
          {templates.find((t) => t.id === value)?.description}
        </p>
      )}
    </div>
  );
}
