import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Database,
  GripVertical,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  Settings2,
  Sparkles,
  Key
} from "lucide-react";
import {
  useEnrichmentProviders,
  useEnrichmentSettings,
  useUpdateEnrichmentSettings,
  useEnrichmentJobStats,
  useEnrichmentCreditsUsed,
  DEFAULT_ENRICHMENT_SETTINGS,
  type EnrichmentSettings as EnrichmentSettingsType,
} from "@/hooks/useEnrichmentSettings";
import { AddApiKeyDialog } from "./AddApiKeyDialog";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const PROVIDER_INFO: Record<string, { name: string; description: string; capabilities: string[] }> = {
  apollo: {
    name: "Apollo.io",
    description: "Email + phone enrichment with high accuracy",
    capabilities: ["email", "phone", "company"],
  },
  prospeo: {
    name: "Prospeo",
    description: "Email verification and discovery",
    capabilities: ["email"],
  },
  moltsets: {
    name: "MoltSets",
    description: "LinkedIn identity resolution to business emails",
    capabilities: ["email"],
  },
  quickenrich: {
    name: "QuickEnrich",
    description: "Email, phone & domain search from LinkedIn URL, company, or name",
    capabilities: ["email", "phone"],
  },
};

interface SortableProviderItemProps {
  provider: string;
  isConnected: boolean;
  keyHint?: string;
  creditsUsed?: number;
  onConnect: () => void;
}

function SortableProviderItem({ provider, isConnected, keyHint, creditsUsed, onConnect }: SortableProviderItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const info = PROVIDER_INFO[provider];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 p-3 border rounded-lg bg-background ${
        isDragging ? "shadow-lg z-50" : ""
      } ${isConnected ? "border-green-200 dark:border-green-900" : "border-muted"}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{info?.name || provider}</span>
          {isConnected ? (
            <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <XCircle className="h-3 w-3" />
              Not Connected
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground truncate">
          {info?.description || "Contact enrichment provider"}
        </p>
        {isConnected && keyHint && (
          <p className="text-xs text-muted-foreground font-mono mt-1">{keyHint}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isConnected && creditsUsed !== undefined && (
          <span className="text-sm text-muted-foreground">{creditsUsed} credits used</span>
        )}
        {!isConnected && (
          <Button variant="outline" size="sm" onClick={onConnect}>
            <Key className="h-3 w-3 mr-1" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

export function EnrichmentSettings() {
  const { data: providers, isLoading: loadingProviders } = useEnrichmentProviders();
  const { data: settings, isLoading: loadingSettings } = useEnrichmentSettings();
  const { data: jobStats } = useEnrichmentJobStats();
  const { data: creditsUsed } = useEnrichmentCreditsUsed();
  const updateSettings = useUpdateEnrichmentSettings();

  const [localSettings, setLocalSettings] = useState<EnrichmentSettingsType>(DEFAULT_ENRICHMENT_SETTINGS);
  const [showAddKeyDialog, setShowAddKeyDialog] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState<string | undefined>();
  const [hasChanges, setHasChanges] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sync settings when loaded
  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);
    }
  }, [settings]);

  // Check for changes
  useEffect(() => {
    if (settings) {
      const changed = JSON.stringify(localSettings) !== JSON.stringify(settings);
      setHasChanges(changed);
    }
  }, [localSettings, settings]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localSettings.providerPriority.indexOf(active.id as string);
      const newIndex = localSettings.providerPriority.indexOf(over.id as string);

      setLocalSettings((prev) => ({
        ...prev,
        providerPriority: arrayMove(prev.providerPriority, oldIndex, newIndex),
      }));
    }
  };

  const handleSave = () => {
    updateSettings.mutate(localSettings);
  };

  const isLoading = loadingProviders || loadingSettings;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Build provider connection map
  const connectedProviders = new Set(providers?.filter((p) => p.isConnected).map((p) => p.provider));
  const providerKeyHints = Object.fromEntries(
    providers?.map((p) => [p.provider, p.keyHint]) || []
  );

  return (
    <div className="space-y-6">
      {/* Job Stats Summary */}
      {jobStats && (jobStats.pending > 0 || jobStats.processing > 0) && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-4">
            <div className="flex items-center gap-4">
              <Sparkles className="h-5 w-5 text-blue-600" />
              <div className="flex-1">
                <p className="font-medium">Enrichment Queue Active</p>
                <p className="text-sm text-muted-foreground">
                  {jobStats.processing} processing, {jobStats.pending} pending
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href="/enrichment-queue">View Queue</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider Priority */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Provider Priority
          </CardTitle>
          <CardDescription>
            Drag to reorder which providers to try first when enriching contacts.
            We'll use the first connected provider, then fall back to others.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={localSettings.providerPriority}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {localSettings.providerPriority.map((provider) => (
                  <SortableProviderItem
                    key={provider}
                    provider={provider}
                    isConnected={connectedProviders.has(provider)}
                    keyHint={providerKeyHints[provider]}
                    creditsUsed={creditsUsed?.[provider]}
                    onConnect={() => { setDefaultProvider(provider); setShowAddKeyDialog(true); }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>

      {/* Enrichment Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Enrichment Preferences
          </CardTitle>
          <CardDescription>
            Configure how contacts should be enriched by default
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Default Enrichment Type */}
          <div className="space-y-3">
            <Label>Default Enrichment Type</Label>
            <RadioGroup
              value={localSettings.defaultEnrichmentType}
              onValueChange={(value) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  defaultEnrichmentType: value as EnrichmentSettingsType["defaultEnrichmentType"],
                }))
              }
              className="grid grid-cols-2 gap-3"
            >
              <Label
                htmlFor="email-only"
                className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                  localSettings.defaultEnrichmentType === "email"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <RadioGroupItem value="email" id="email-only" />
                <div>
                  <p className="font-medium">Email Only</p>
                  <p className="text-sm text-muted-foreground">Find email addresses</p>
                </div>
              </Label>
              <Label
                htmlFor="phone-only"
                className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                  localSettings.defaultEnrichmentType === "phone"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <RadioGroupItem value="phone" id="phone-only" />
                <div>
                  <p className="font-medium">Phone Only</p>
                  <p className="text-sm text-muted-foreground">Find phone numbers</p>
                </div>
              </Label>
              <Label
                htmlFor="email-phone"
                className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                  localSettings.defaultEnrichmentType === "email,phone"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <RadioGroupItem value="email,phone" id="email-phone" />
                <div>
                  <p className="font-medium">Email + Phone</p>
                  <p className="text-sm text-muted-foreground">Find both (recommended)</p>
                </div>
              </Label>
              <Label
                htmlFor="full"
                className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                  localSettings.defaultEnrichmentType === "full"
                    ? "border-primary bg-primary/5"
                    : "border-muted hover:border-muted-foreground/50"
                }`}
              >
                <RadioGroupItem value="full" id="full" />
                <div>
                  <p className="font-medium">Full Profile</p>
                  <p className="text-sm text-muted-foreground">Email, phone, company data</p>
                </div>
              </Label>
            </RadioGroup>
          </div>

          {/* Email Validation Options */}
          <div className="space-y-3">
            <Label>Email Validation</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="accept-catchall"
                  checked={localSettings.acceptCatchAllEmails}
                  onCheckedChange={(checked) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      acceptCatchAllEmails: !!checked,
                    }))
                  }
                />
                <div>
                  <label htmlFor="accept-catchall" className="text-sm cursor-pointer font-medium">
                    Accept catch-all emails
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Catch-all domains accept any email address. Higher deliverability risk but more results.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="require-validation"
                  checked={localSettings.requireEmailValidation}
                  onCheckedChange={(checked) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      requireEmailValidation: !!checked,
                    }))
                  }
                />
                <div>
                  <label htmlFor="require-validation" className="text-sm cursor-pointer font-medium">
                    Require email validation
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Only accept emails that have been verified as valid and deliverable.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Skip conditions */}
          <div className="space-y-3">
            <Label>Skip Enrichment If Contact Already Has</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="skip-email"
                  checked={localSettings.skipIfHasEmail}
                  onCheckedChange={(checked) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      skipIfHasEmail: !!checked,
                    }))
                  }
                />
                <label htmlFor="skip-email" className="text-sm cursor-pointer">
                  Email address
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="skip-phone"
                  checked={localSettings.skipIfHasPhone}
                  onCheckedChange={(checked) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      skipIfHasPhone: !!checked,
                    }))
                  }
                />
                <label htmlFor="skip-phone" className="text-sm cursor-pointer">
                  Phone number
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="skip-company"
                  checked={localSettings.skipIfHasCompany}
                  onCheckedChange={(checked) =>
                    setLocalSettings((prev) => ({
                      ...prev,
                      skipIfHasCompany: !!checked,
                    }))
                  }
                />
                <label htmlFor="skip-company" className="text-sm cursor-pointer">
                  Company information
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto-Enrichment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Auto-Enrichment
          </CardTitle>
          <CardDescription>
            Automatically enrich contacts at key moments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="auto-import">Enrich on Lead Import</Label>
              <p className="text-sm text-muted-foreground">
                Automatically queue enrichment when leads are imported
              </p>
            </div>
            <Switch
              id="auto-import"
              checked={localSettings.autoEnrichOnImport}
              onCheckedChange={(checked) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  autoEnrichOnImport: checked,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="auto-campaign">Enrich Before Campaign Launch</Label>
              <p className="text-sm text-muted-foreground">
                Enrich contacts missing data before starting a campaign
              </p>
            </div>
            <Switch
              id="auto-campaign"
              checked={localSettings.autoEnrichBeforeCampaign}
              onCheckedChange={(checked) =>
                setLocalSettings((prev) => ({
                  ...prev,
                  autoEnrichBeforeCampaign: checked,
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Enrichment Queue Link */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Enrichment Queue</h3>
              <p className="text-sm text-muted-foreground">
                View and manage pending enrichment jobs, retry failed jobs, and see enrichment history.
              </p>
            </div>
            <Button variant="outline" asChild>
              <a href="/enrichment-queue">
                <Database className="h-4 w-4 mr-2" />
                Open Queue
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {hasChanges && (
        <div className="sticky bottom-4 flex justify-end">
          <Button
            variant="cta"
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="font-medium shadow-lg"
          >
            {updateSettings.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      )}

      <AddApiKeyDialog open={showAddKeyDialog} onOpenChange={setShowAddKeyDialog} defaultProvider={defaultProvider} />
    </div>
  );
}
