import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sparkles, Zap, ChevronDown, ChevronUp, MessageSquare, FileText, TrendingUp, Lightbulb, Check, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SelectedAiInsights } from "@/types/wizard";
import { ExtractedVariables } from "@/lib/blueprintUtils";

/**
 * Convert snake_case to Title Case label
 */
function formatLabel(text: string): string {
  if (!text) return '';
  return text
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

interface AIInsightsSelectorProps {
  aiAnalysis: any; // The AI analysis data (parsed or raw)
  selectedInsights: SelectedAiInsights | null;
  onInsightsChange: (insights: SelectedAiInsights | null) => void;
  /** Optional: Variables extracted from the prompt template. Used to show warnings when selections won't be used. */
  templateVariables?: ExtractedVariables | null;
}

// Default state for new selections
// All toggles are OFF by default - user must explicitly opt-in to AI insights
const getDefaultInsights = (): SelectedAiInsights => ({
  createVariations: false,
  selectedHookIndices: [],
  includeCta: false,
  selectedCtaIndex: null,
  includeTalkingPoints: false,
  createTalkingPointVariations: false,
  selectedTalkingPointIndices: [],
  talkingPointMode: 'combine', // Default to combine mode
  includeScriptStructure: false,
  includeEngagementDrivers: false,
});

export function AIInsightsSelector({ aiAnalysis: rawAiAnalysis, selectedInsights: value, onInsightsChange: onChange, templateVariables }: AIInsightsSelectorProps) {
  const [showHookSelector, setShowHookSelector] = useState(false);
  const [showTalkingPointSelector, setShowTalkingPointSelector] = useState(false);

  // Check which AI insights the template actually uses
  const templateUsesHooks = templateVariables?.aiCategories?.hooks ?? true; // Default to true if not provided
  const templateUsesTalkingPoints = templateVariables?.aiCategories?.talking_points ?? true;
  const templateUsesCtas = templateVariables?.aiCategories?.ctas ?? true;
  const templateUsesScriptStructure = templateVariables?.aiCategories?.script_structure ?? true;
  const templateUsesEngagement = templateVariables?.aiCategories?.engagement ?? true;

  // Parse AI analysis if it's a string
  const aiAnalysis = typeof rawAiAnalysis === 'string'
    ? JSON.parse(rawAiAnalysis)
    : (rawAiAnalysis || {});

  const hooks = aiAnalysis.hooks || [];
  const ctas = aiAnalysis.ctas || [];
  const scriptStructure = aiAnalysis.script_structure || null;
  const engagementDrivers = aiAnalysis.engagement_drivers || [];
  const talkingPoints = aiAnalysis.talking_points || [];

  const hasHooks = hooks.length > 0;
  const hasCtas = ctas.length > 0;
  const hasScriptStructure = scriptStructure !== null;
  const hasTalkingPoints = talkingPoints.length > 0;
  const hasEngagementDrivers = engagementDrivers.length > 0;

  const insightsSummary = [
    hasHooks && `${hooks.length} hooks`,
    hasCtas && `${ctas.length} CTAs`,
    hasTalkingPoints && `${talkingPoints.length} talking points`,
    hasScriptStructure && 'script structure',
    hasEngagementDrivers && `${engagementDrivers.length} engagement drivers`,
  ].filter(Boolean);

  if (insightsSummary.length === 0) {
    return null;
  }

  // Use defaults if no value set
  const currentValue = value || getDefaultInsights();
  const createVariations = currentValue.createVariations;
  const selectedHookIndices = currentValue.selectedHookIndices || [];
  const includeCta = currentValue.includeCta ?? false;
  const selectedCtaIndex = currentValue.selectedCtaIndex;
  const includeTalkingPoints = currentValue.includeTalkingPoints ?? false;
  const createTalkingPointVariations = currentValue.createTalkingPointVariations ?? false;
  const selectedTalkingPointIndices = currentValue.selectedTalkingPointIndices || [];
  const talkingPointMode = currentValue.talkingPointMode ?? 'combine';
  const includeScriptStructure = currentValue.includeScriptStructure ?? false;
  const includeEngagementDrivers = currentValue.includeEngagementDrivers ?? false;

  // Calculate total variations (hooks * talking points if both enabled in separate mode)
  const hookVariationsCount = createVariations ? Math.max(1, selectedHookIndices.length) : 1;
  // In combine mode, all selected talking points go into one output; in separate mode, each creates a variation
  const talkingPointVariationsCount = (createTalkingPointVariations && talkingPointMode === 'separate')
    ? Math.max(1, selectedTalkingPointIndices.length)
    : 1;
  const variationsCount = hookVariationsCount * talkingPointVariationsCount;

  // Helper to update insights
  const updateInsights = (updates: Partial<SelectedAiInsights>) => {
    onChange({
      ...currentValue,
      ...updates,
    });
  };

  const handleVariationsToggle = (enabled: boolean) => {
    updateInsights({
      createVariations: enabled,
      selectedHookIndices: enabled ? [0] : [], // Select first hook by default when enabling
    });
    if (enabled) {
      setShowHookSelector(true);
    }
  };

  const handleHookToggle = (index: number, checked: boolean) => {
    let newIndices;

    if (checked) {
      newIndices = [...selectedHookIndices, index].sort((a, b) => a - b);
    } else {
      newIndices = selectedHookIndices.filter(i => i !== index);
    }

    updateInsights({
      createVariations: true,
      selectedHookIndices: newIndices,
    });
  };

  const handleCtaSelect = (index: number) => {
    updateInsights({
      selectedCtaIndex: index,
    });
  };

  const handleTalkingPointVariationsToggle = (enabled: boolean) => {
    updateInsights({
      createTalkingPointVariations: enabled,
      // Select ALL talking points by default when enabling
      selectedTalkingPointIndices: enabled ? talkingPoints.map((_: any, i: number) => i) : [],
      includeTalkingPoints: enabled ? false : includeTalkingPoints, // Disable "include all" when using variations
      talkingPointMode: 'combine', // Default to combine mode
    });
    if (enabled) {
      setShowTalkingPointSelector(true);
    }
  };

  const handleTalkingPointModeChange = (mode: 'combine' | 'separate') => {
    updateInsights({
      talkingPointMode: mode,
    });
  };

  const handleTalkingPointToggle = (index: number, checked: boolean) => {
    let newIndices;

    if (checked) {
      newIndices = [...selectedTalkingPointIndices, index].sort((a, b) => a - b);
    } else {
      newIndices = selectedTalkingPointIndices.filter(i => i !== index);
    }

    updateInsights({
      createTalkingPointVariations: true,
      selectedTalkingPointIndices: newIndices,
    });
  };

  // Count how many sections are enabled
  const enabledSectionsCount = [
    includeCta && hasCtas,
    includeTalkingPoints && hasTalkingPoints,
    includeScriptStructure && hasScriptStructure,
    includeEngagementDrivers && hasEngagementDrivers,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Summary of available insights */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>Available: {insightsSummary.join(', ')}</span>
      </div>

      {/* Hook Variations Section */}
      {hasHooks && hooks.length > 1 && (
        <div className="border rounded-lg p-4 space-y-3 bg-yellow-500/5 border-yellow-500/20">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                Create Hook Variations
              </Label>
              <p className="text-xs text-muted-foreground">
                Generate multiple outputs, one for each selected hook
              </p>
            </div>
            <Switch
              checked={createVariations}
              onCheckedChange={handleVariationsToggle}
            />
          </div>

          {/* Warning if template doesn't use hooks */}
          {createVariations && !templateUsesHooks && templateVariables && (
            <Alert className="border-status-warning/50 bg-status-warning/10 py-2">
              <AlertTriangle className="h-4 w-4 text-status-warning" />
              <AlertDescription className="text-xs text-status-warning">
                Your prompt template doesn't use <code className="bg-status-warning/20 px-1 rounded">{'{{ai_hook}}'}</code>.
                Add this variable to your prompt to use selected hooks.
              </AlertDescription>
            </Alert>
          )}

          {/* Hook selector - only when variations enabled */}
          {createVariations && (
            <Collapsible open={showHookSelector} onOpenChange={setShowHookSelector}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span className="text-sm">
                    {selectedHookIndices.length} of {hooks.length} hooks selected
                  </span>
                  {showHookSelector ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2">
                {hooks.map((hook: any, index: number) => {
                  const isSelected = selectedHookIndices.includes(index);
                  return (
                    <div
                      key={index}
                      className={`flex items-start gap-3 p-2 rounded-lg border transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/10 border-primary/30' : 'bg-background border-border hover:border-primary/20'
                      }`}
                      onClick={() => handleHookToggle(index, !isSelected)}
                    >
                      <Checkbox
                        id={`hook-var-${index}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => handleHookToggle(index, checked as boolean)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <label
                          htmlFor={`hook-var-${index}`}
                          className="text-sm cursor-pointer block"
                        >
                          "{hook.text}"
                        </label>
                        <Badge variant="outline" className="text-xs mt-1">
                          {formatLabel(hook.type)}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Variations summary - only show when just hooks enabled */}
          {createVariations && selectedHookIndices.length > 0 && !createTalkingPointVariations && (
            <div className="bg-yellow-500/10 rounded-lg p-2 text-sm">
              <span className="font-medium text-yellow-700 dark:text-yellow-400">
                Will generate {variationsCount} variation{variationsCount !== 1 ? 's' : ''} (one per hook)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Talking Point Selection Section */}
      {hasTalkingPoints && (
        <div className="border rounded-lg p-4 space-y-3 bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                Select Talking Points
              </Label>
              <p className="text-xs text-muted-foreground">
                Choose which talking points to include in your content
              </p>
            </div>
            <Switch
              checked={createTalkingPointVariations}
              onCheckedChange={handleTalkingPointVariationsToggle}
            />
          </div>

          {/* Warning if template doesn't use talking points */}
          {createTalkingPointVariations && !templateUsesTalkingPoints && templateVariables && (
            <Alert className="border-status-warning/50 bg-status-warning/10 py-2">
              <AlertTriangle className="h-4 w-4 text-status-warning" />
              <AlertDescription className="text-xs text-status-warning">
                Your prompt template doesn't use <code className="bg-status-warning/20 px-1 rounded">{'{{ai_talking_points}}'}</code> or <code className="bg-status-warning/20 px-1 rounded">{'{{ai_talking_point}}'}</code>.
                Add one of these variables to use selected talking points.
              </AlertDescription>
            </Alert>
          )}

          {/* Talking point selector and mode - only when enabled */}
          {createTalkingPointVariations && (
            <>
              {/* Mode selector: Combine vs Separate */}
              <div className="flex gap-2">
                <Button
                  variant={talkingPointMode === 'combine' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleTalkingPointModeChange('combine')}
                >
                  Combine All
                </Button>
                <Button
                  variant={talkingPointMode === 'separate' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => handleTalkingPointModeChange('separate')}
                >
                  Separate Outputs
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {talkingPointMode === 'combine'
                  ? 'All selected points will be combined into one output'
                  : 'Each selected point creates a separate output'}
              </p>

              <Collapsible open={showTalkingPointSelector} onOpenChange={setShowTalkingPointSelector}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    <span className="text-sm">
                      {selectedTalkingPointIndices.length} of {talkingPoints.length} talking points selected
                    </span>
                    {showTalkingPointSelector ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  {talkingPoints.map((point: string, index: number) => {
                    const isSelected = selectedTalkingPointIndices.includes(index);
                    return (
                      <div
                        key={index}
                        className={`flex items-start gap-3 p-2 rounded-lg border transition-colors cursor-pointer ${
                          isSelected ? 'bg-primary/10 border-primary/30' : 'bg-background border-border hover:border-primary/20'
                        }`}
                        onClick={() => handleTalkingPointToggle(index, !isSelected)}
                      >
                        <Checkbox
                          id={`tp-var-${index}`}
                          checked={isSelected}
                          onCheckedChange={(checked) => handleTalkingPointToggle(index, checked as boolean)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <label
                            htmlFor={`tp-var-${index}`}
                            className="text-sm cursor-pointer block"
                          >
                            {point}
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </CollapsibleContent>
              </Collapsible>
            </>
          )}

          {/* Talking point summary */}
          {createTalkingPointVariations && selectedTalkingPointIndices.length > 0 && !createVariations && (
            <div className="bg-primary/10 rounded-lg p-2 text-sm">
              <span className="font-medium text-primary">
                {talkingPointMode === 'combine'
                  ? `${selectedTalkingPointIndices.length} talking point${selectedTalkingPointIndices.length !== 1 ? 's' : ''} will be combined into 1 output`
                  : `Will generate ${variationsCount} variation${variationsCount !== 1 ? 's' : ''} (one per talking point)`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Combined variations summary */}
      {(createVariations && selectedHookIndices.length > 0 && createTalkingPointVariations && selectedTalkingPointIndices.length > 0) && (
        <div className="bg-gradient-to-r from-yellow-500/10 to-primary/10 rounded-lg p-3 text-sm border border-yellow-500/20">
          <span className="font-medium text-foreground">
            Will generate {variationsCount} variation{variationsCount !== 1 ? 's' : ''}
          </span>
          <p className="text-xs text-muted-foreground mt-1">
            {hookVariationsCount} hook{hookVariationsCount !== 1 ? 's' : ''} × {talkingPointVariationsCount} talking point{talkingPointVariationsCount !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Optional Sections - All toggleable */}
      {(hasCtas || hasTalkingPoints || hasScriptStructure || hasEngagementDrivers) && (
        <div className="border rounded-lg p-4 space-y-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              Include in Prompts
              {enabledSectionsCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {enabledSectionsCount} selected
                </Badge>
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              Toggle which AI insights to include in your prompt variables
            </p>
          </div>

          <div className="space-y-3">
            {/* CTA Selection - Toggleable with radio selection */}
            {hasCtas && (
              <Collapsible>
                <div className="flex items-center justify-between p-2 rounded-lg border bg-background">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="flex-1 justify-start h-auto py-1">
                      <MessageSquare className="h-4 w-4 text-green-500 mr-2" />
                      <span className="text-sm">CTAs ({ctas.length})</span>
                      {includeCta && !templateUsesCtas && templateVariables && (
                        <AlertTriangle className="h-3 w-3 text-status-warning ml-1" />
                      )}
                      <ChevronDown className="h-4 w-4 ml-auto" />
                    </Button>
                  </CollapsibleTrigger>
                  <Switch
                    checked={includeCta}
                    onCheckedChange={(checked) => updateInsights({ includeCta: checked })}
                  />
                </div>
                {/* Warning if template doesn't use CTAs */}
                {includeCta && !templateUsesCtas && templateVariables && (
                  <div className="mt-2 px-2 text-xs text-status-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Template doesn't use <code className="bg-status-warning/20 px-1 rounded">{'{{ai_cta}}'}</code>
                  </div>
                )}
                <CollapsibleContent>
                  {includeCta && (
                    <div className="mt-2 px-2">
                      <p className="text-xs text-muted-foreground mb-2">
                        Select which CTA to use as <code className="bg-muted px-1 rounded">{'{{ai_cta}}'}</code>
                      </p>
                      <RadioGroup
                        value={selectedCtaIndex?.toString() ?? "0"}
                        onValueChange={(val) => handleCtaSelect(parseInt(val))}
                      >
                        <ScrollArea className="max-h-[180px]">
                          <div className="space-y-2">
                            {ctas.map((cta: any, index: number) => {
                              const isSelected = (selectedCtaIndex ?? 0) === index;
                              return (
                                <div
                                  key={index}
                                  className={`flex items-start gap-3 p-2 rounded-lg border transition-colors cursor-pointer ${
                                    isSelected ? 'bg-green-500/10 border-green-500/30' : 'bg-background border-border hover:border-green-500/20'
                                  }`}
                                  onClick={() => handleCtaSelect(index)}
                                >
                                  <RadioGroupItem value={index.toString()} id={`cta-${index}`} className="mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <label htmlFor={`cta-${index}`} className="text-xs cursor-pointer block">
                                      "{cta.text}"
                                    </label>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge variant="outline" className="text-[10px]">
                                        {formatLabel(cta.type || cta.cta_type || 'cta')}
                                      </Badge>
                                      {cta.placement && (
                                        <Badge variant="secondary" className="text-[10px]">
                                          {formatLabel(cta.placement)}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      </RadioGroup>
                    </div>
                  )}
                  {!includeCta && (
                    <ScrollArea className="max-h-[120px] mt-2">
                      <div className="space-y-1 px-2 opacity-50">
                        {ctas.map((cta: any, index: number) => (
                          <div key={index} className="text-xs p-2 bg-muted/50 rounded">
                            <span className="text-muted-foreground">"{cta.text}"</span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}


            {/* Script Structure Toggle */}
            {hasScriptStructure && (
              <Collapsible>
                <div className="flex items-center justify-between p-2 rounded-lg border bg-background">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="flex-1 justify-start h-auto py-1">
                      <FileText className="h-4 w-4 text-blue-500 mr-2" />
                      <span className="text-sm">Script Structure</span>
                      {includeScriptStructure && !templateUsesScriptStructure && templateVariables && (
                        <AlertTriangle className="h-3 w-3 text-status-warning ml-1" />
                      )}
                      <ChevronDown className="h-4 w-4 ml-auto" />
                    </Button>
                  </CollapsibleTrigger>
                  <Switch
                    checked={includeScriptStructure}
                    onCheckedChange={(checked) => updateInsights({ includeScriptStructure: checked })}
                  />
                </div>
                {/* Warning if template doesn't use script structure */}
                {includeScriptStructure && !templateUsesScriptStructure && templateVariables && (
                  <div className="mt-2 px-2 text-xs text-status-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Template doesn't use <code className="bg-status-warning/20 px-1 rounded">{'{{ai_script_structure}}'}</code>
                  </div>
                )}
                <CollapsibleContent>
                  <div className={`space-y-2 mt-2 px-2 ${!includeScriptStructure ? 'opacity-50' : ''}`}>
                    {scriptStructure.opening && (
                      <div className="text-xs p-2 bg-muted/50 rounded">
                        <span className="font-medium text-blue-600">Opening:</span>
                        <p className="text-muted-foreground mt-0.5">{scriptStructure.opening}</p>
                      </div>
                    )}
                    {scriptStructure.body && (
                      <div className="text-xs p-2 bg-muted/50 rounded">
                        <span className="font-medium text-blue-600">Body:</span>
                        <p className="text-muted-foreground mt-0.5">{scriptStructure.body}</p>
                      </div>
                    )}
                    {scriptStructure.climax && (
                      <div className="text-xs p-2 bg-muted/50 rounded">
                        <span className="font-medium text-blue-600">Climax:</span>
                        <p className="text-muted-foreground mt-0.5">{scriptStructure.climax}</p>
                      </div>
                    )}
                    {scriptStructure.closing && (
                      <div className="text-xs p-2 bg-muted/50 rounded">
                        <span className="font-medium text-blue-600">Closing:</span>
                        <p className="text-muted-foreground mt-0.5">{scriptStructure.closing}</p>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Engagement Drivers Toggle */}
            {hasEngagementDrivers && (
              <Collapsible>
                <div className="flex items-center justify-between p-2 rounded-lg border bg-background">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="flex-1 justify-start h-auto py-1">
                      <TrendingUp className="h-4 w-4 text-pink-500 mr-2" />
                      <span className="text-sm">Engagement Drivers ({engagementDrivers.length})</span>
                      {includeEngagementDrivers && !templateUsesEngagement && templateVariables && (
                        <AlertTriangle className="h-3 w-3 text-status-warning ml-1" />
                      )}
                      <ChevronDown className="h-4 w-4 ml-auto" />
                    </Button>
                  </CollapsibleTrigger>
                  <Switch
                    checked={includeEngagementDrivers}
                    onCheckedChange={(checked) => updateInsights({ includeEngagementDrivers: checked })}
                  />
                </div>
                {/* Warning if template doesn't use engagement drivers */}
                {includeEngagementDrivers && !templateUsesEngagement && templateVariables && (
                  <div className="mt-2 px-2 text-xs text-status-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Template doesn't use <code className="bg-status-warning/20 px-1 rounded">{'{{ai_engagement_drivers}}'}</code>
                  </div>
                )}
                <CollapsibleContent>
                  <div className="mt-2 max-h-[120px] overflow-y-auto">
                    <div className="space-y-1 px-2">
                      {engagementDrivers.map((driver: string, index: number) => (
                        <div key={index} className={`text-xs p-2 bg-muted/50 rounded flex items-start gap-2 ${!includeEngagementDrivers ? 'opacity-50' : ''}`}>
                          <Check className="h-3 w-3 text-pink-500 mt-0.5 shrink-0" />
                          <span className="text-muted-foreground">{driver}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      )}

      {/* Help text */}
      <p className="text-xs text-muted-foreground">
        Use variables like <code className="bg-muted px-1 rounded">{'{{ai_hook}}'}</code>, <code className="bg-muted px-1 rounded">{'{{ai_cta}}'}</code>, <code className="bg-muted px-1 rounded">{'{{ai_talking_points}}'}</code>, or <code className="bg-muted px-1 rounded">{'{{ai_talking_point}}'}</code> (for variations) in your prompts.
      </p>
    </div>
  );
}
