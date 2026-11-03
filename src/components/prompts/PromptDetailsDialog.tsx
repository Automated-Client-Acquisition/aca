import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useAutosave } from "@/hooks/useAutosave";
import { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  Trash2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  FileText,
  Code,
  Target,
  Tag,
  Copy,
  X,
  Plus,
  ImageIcon,
  Layers,
  ExternalLink,
} from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useBlueprintsUsingPrompt, type PromptTemplate, type PromptTemplateUpdate, type PromptType } from "@/hooks/usePromptLibrary";
import { PIPELINES } from "@/types/pipeline";
import { Link } from "react-router-dom";

interface PromptDetailsDialogProps {
  prompt: PromptTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: PromptTemplateUpdate) => void;
  onDelete: (id: string) => void;
  onDuplicate: (prompt: PromptTemplate) => void;
  isUpdating: boolean;
}

const parseVariables = (promptContent: string): string[] => {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(promptContent.matchAll(regex));
  const uniqueVars = new Set(matches.map(match => match[1].trim()));
  return Array.from(uniqueVars);
};

export function PromptDetailsDialog({
  prompt,
  open,
  onOpenChange,
  onSave,
  onDelete,
  onDuplicate,
  isUpdating,
}: PromptDetailsDialogProps) {
  const [edited, setEdited] = useState<Partial<PromptTemplate>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contentOpen, setContentOpen] = useState(true);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [blueprintsOpen, setBlueprintsOpen] = useState(false);
  const [contentTypeInput, setContentTypeInput] = useState("");
  const [goalInput, setGoalInput] = useState("");

  // Fetch blueprints that use this prompt
  const { data: blueprintUsages = [], isLoading: isLoadingBlueprints } = useBlueprintsUsingPrompt(prompt?.id ?? null);

  // Reset edited state when dialog opens/closes or prompt changes
  useEffect(() => {
    if (!open || !prompt) {
      setEdited({});
      setContentTypeInput("");
      setGoalInput("");
    }
  }, [open, prompt?.id]);

  // Autosave with debounce
  const { isSaving } = useAutosave(
    (updates) => {
      if (prompt && !prompt.is_preset) {
        // Auto-extract variables when prompt content changes
        if (updates.prompt_content) {
          const vars = parseVariables(updates.prompt_content);
          onSave(prompt.id, { ...updates, variables: vars.length > 0 ? vars : null });
        } else {
          onSave(prompt.id, updates);
        }
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating && !prompt?.is_preset
  );

  const handleDelete = () => {
    if (prompt) {
      onDelete(prompt.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  const handleDuplicate = () => {
    if (prompt) {
      onDuplicate(prompt);
      onOpenChange(false);
    }
  };

  const addContentType = () => {
    if (contentTypeInput.trim()) {
      const current = (edited.content_types ?? prompt?.content_types ?? []) as string[];
      setEdited({ ...edited, content_types: [...current, contentTypeInput.trim()] });
      setContentTypeInput("");
    }
  };

  const removeContentType = (index: number) => {
    const current = (edited.content_types ?? prompt?.content_types ?? []) as string[];
    setEdited({ ...edited, content_types: current.filter((_, i) => i !== index) });
  };

  const addGoal = () => {
    if (goalInput.trim()) {
      const current = (edited.goals ?? prompt?.goals ?? []) as string[];
      setEdited({ ...edited, goals: [...current, goalInput.trim()] });
      setGoalInput("");
    }
  };

  const removeGoal = (index: number) => {
    const current = (edited.goals ?? prompt?.goals ?? []) as string[];
    setEdited({ ...edited, goals: current.filter((_, i) => i !== index) });
  };

  const extractedVariables = useMemo(() => {
    const content = edited.prompt_content ?? prompt?.prompt_content ?? "";
    return parseVariables(content);
  }, [edited.prompt_content, prompt?.prompt_content]);

  if (!prompt) return null;

  const isReadOnly = prompt.is_preset === true;
  const isImagePrompt = prompt.prompt_type === 'image';

  const currentName = edited.name ?? prompt.name;
  const currentDescription = edited.description ?? prompt.description ?? "";
  const currentPreviewUrl = edited.preview_url ?? prompt.preview_url ?? "";
  const currentPromptContent = edited.prompt_content ?? prompt.prompt_content ?? "";
  const currentPipelineType = edited.pipeline_type ?? prompt.pipeline_type ?? "";
  const currentScenario = edited.scenario ?? prompt.scenario ?? "";
  const currentContentTypes = (edited.content_types ?? prompt.content_types ?? []) as string[];
  const currentGoals = (edited.goals ?? prompt.goals ?? []) as string[];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl flex flex-col h-[90vh] overflow-hidden">
          <form className="flex flex-col flex-1 min-h-0">
            <DialogHeader className="shrink-0 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    isImagePrompt
                      ? "bg-gradient-to-br from-pink-500/20 to-rose-500/20"
                      : "bg-gradient-to-br from-blue-500/20 to-cyan-500/20"
                  }`}>
                    {isImagePrompt ? (
                      <ImageIcon className="w-6 h-6 text-pink-600" />
                    ) : (
                      <FileText className="w-6 h-6 text-blue-600" />
                    )}
                  </div>
                  <div>
                    <DialogTitle className="text-2xl flex items-center gap-2">
                      {isReadOnly ? "View Prompt" : "Edit Prompt"}
                      {prompt.is_preset && (
                        <Badge className="bg-cta/10 text-cta border-cta/30">
                          <Sparkles className="w-3 h-3 mr-1" />
                          Preset
                        </Badge>
                      )}
                    </DialogTitle>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(prompt.created_at)}
                      </div>
                      <Badge
                        variant="outline"
                        className={isImagePrompt
                          ? "bg-pink-500/10 text-pink-600 border-pink-500/30"
                          : "bg-blue-500/10 text-blue-600 border-blue-500/30"
                        }
                      >
                        {isImagePrompt ? "Image" : "Text"} Prompt
                      </Badge>
                    </div>
                  </div>
                </div>
                {!isReadOnly && <AutosaveIndicator isSaving={isSaving} />}
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0 px-8 py-6">
              <div className="space-y-6">
                {/* Basic Info Card */}
                <Card className={`border-2 overflow-hidden ${
                  isImagePrompt
                    ? "border-pink-500/20 bg-gradient-to-br from-pink-500/5 to-transparent"
                    : "border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent"
                }`}>
                  <div className={`h-1.5 bg-gradient-to-r ${
                    isImagePrompt
                      ? "from-pink-500 to-rose-500"
                      : "from-blue-500 to-cyan-500"
                  }`} />
                  <CardContent className="pt-6 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-base font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-blue-600" />
                        Template Name
                      </Label>
                      <Input
                        id="name"
                        value={currentName}
                        onChange={(e) => setEdited({ ...edited, name: e.target.value })}
                        className="h-11 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={isReadOnly}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-base font-semibold flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-600" />
                        Description
                      </Label>
                      <Textarea
                        id="description"
                        value={currentDescription}
                        onChange={(e) => setEdited({ ...edited, description: e.target.value })}
                        placeholder="Describe what this template is used for..."
                        className="min-h-[80px] max-h-[150px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={isReadOnly}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="preview_url" className="text-base font-semibold flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-blue-600" />
                        Preview image
                      </Label>
                      {currentPreviewUrl && (
                        <img
                          src={currentPreviewUrl}
                          alt={`${currentName} preview`}
                          className="w-full max-w-sm rounded-lg border bg-muted object-contain"
                          loading="lazy"
                        />
                      )}
                      <Input
                        id="preview_url"
                        value={currentPreviewUrl}
                        onChange={(e) => setEdited({ ...edited, preview_url: e.target.value.trim() || null })}
                        placeholder="https://... example image of what this template produces"
                        disabled={isReadOnly}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Pipeline Type</Label>
                        <Select
                          value={currentPipelineType}
                          onValueChange={(value) => setEdited({ ...edited, pipeline_type: value || null })}
                          disabled={isReadOnly}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select a pipeline" />
                          </SelectTrigger>
                          <SelectContent>
                            {PIPELINES.map((pipeline) => (
                              <SelectItem key={pipeline.id} value={pipeline.id}>
                                {pipeline.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Scenario</Label>
                        <Input
                          value={currentScenario}
                          onChange={(e) => setEdited({ ...edited, scenario: e.target.value || null })}
                          placeholder="e.g., testimonial, tutorial"
                          disabled={isReadOnly}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Prompt Content Section */}
                <Collapsible open={contentOpen} onOpenChange={setContentOpen}>
                  <CollapsibleTrigger className="w-full">
                    <Card className="border-2 hover:border-primary/30 transition-all duration-200 cursor-pointer">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/10 to-pink-500/10 flex items-center justify-center">
                              <Code className="w-5 h-5 text-primary" />
                            </div>
                            <div className="text-left">
                              <span className="text-base font-semibold block">Prompt Content</span>
                              <span className="text-xs text-muted-foreground">
                                {extractedVariables.length} variable{extractedVariables.length !== 1 ? "s" : ""} detected
                              </span>
                            </div>
                          </div>
                          {contentOpen ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4 space-y-4">
                    <Textarea
                      value={currentPromptContent}
                      onChange={(e) => setEdited({ ...edited, prompt_content: e.target.value })}
                      placeholder="Enter your prompt template here. Use {{variable_name}} for dynamic values..."
                      className="min-h-[200px] max-h-[400px] resize-y font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={isReadOnly}
                    />

                    {extractedVariables.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium flex items-center gap-2">
                          <Tag className="w-4 h-4 text-primary" />
                          Detected Variables
                        </Label>
                        <div className="flex flex-wrap gap-2">
                          {extractedVariables.map((variable) => (
                            <Badge
                              key={variable}
                              variant="outline"
                              className="font-mono bg-gradient-to-r from-primary/10 to-pink-500/10 text-primary border-primary/30 hover:from-primary/20 hover:to-pink-500/20"
                            >
                              {`{{${variable}}}`}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                {/* Metadata Section */}
                <Collapsible open={metadataOpen} onOpenChange={setMetadataOpen}>
                  <CollapsibleTrigger className="w-full">
                    <Card className="border-2 hover:border-emerald-500/30 transition-all duration-200 cursor-pointer">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500/10 to-teal-500/10 flex items-center justify-center">
                              <Target className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div className="text-left">
                              <span className="text-base font-semibold block">Content Types & Goals</span>
                              <span className="text-xs text-muted-foreground">
                                {currentContentTypes.length} content type{currentContentTypes.length !== 1 ? "s" : ""}, {currentGoals.length} goal{currentGoals.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>
                          {metadataOpen ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <Card className="border">
                      <CardContent className="pt-6 space-y-6">
                        {/* Content Types */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Content Types</Label>
                          {!isReadOnly && (
                            <div className="flex gap-2">
                              <Input
                                placeholder="e.g., video, blog post, social media"
                                value={contentTypeInput}
                                onChange={(e) => setContentTypeInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addContentType();
                                  }
                                }}
                              />
                              <Button type="button" onClick={addContentType} variant="outline" size="icon">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {currentContentTypes.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {currentContentTypes.map((type, index) => (
                                <Badge key={index} variant="secondary" className="gap-1">
                                  {type}
                                  {!isReadOnly && (
                                    <button
                                      type="button"
                                      onClick={() => removeContentType(index)}
                                      className="ml-1 hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Goals */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">Goals</Label>
                          {!isReadOnly && (
                            <div className="flex gap-2">
                              <Input
                                placeholder="e.g., increase engagement, drive sales"
                                value={goalInput}
                                onChange={(e) => setGoalInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    addGoal();
                                  }
                                }}
                              />
                              <Button type="button" onClick={addGoal} variant="outline" size="icon">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {currentGoals.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2">
                              {currentGoals.map((goal, index) => (
                                <Badge key={index} variant="secondary" className="gap-1">
                                  {goal}
                                  {!isReadOnly && (
                                    <button
                                      type="button"
                                      onClick={() => removeGoal(index)}
                                      className="ml-1 hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Usage Stats */}
                        {prompt.usage_count !== null && prompt.usage_count > 0 && (
                          <div className="pt-4 border-t">
                            <p className="text-sm text-muted-foreground">
                              This template has been used <strong>{prompt.usage_count}</strong> time{prompt.usage_count !== 1 ? "s" : ""}.
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>

                {/* Blueprint Usage Section */}
                <Collapsible open={blueprintsOpen} onOpenChange={setBlueprintsOpen}>
                  <CollapsibleTrigger className="w-full">
                    <Card className="border-2 hover:border-primary/30 transition-all duration-200 cursor-pointer">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                              <Layers className="w-5 h-5 text-primary" />
                            </div>
                            <div className="text-left">
                              <span className="text-base font-semibold block">Used in Blueprints</span>
                              <span className="text-xs text-muted-foreground">
                                {isLoadingBlueprints
                                  ? "Loading..."
                                  : `${blueprintUsages.length} blueprint${blueprintUsages.length !== 1 ? "s" : ""}`}
                              </span>
                            </div>
                          </div>
                          {blueprintsOpen ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <Card className="border">
                      <CardContent className="pt-6">
                        {isLoadingBlueprints ? (
                          <p className="text-sm text-muted-foreground">Loading blueprints...</p>
                        ) : blueprintUsages.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            This prompt template is not currently used in any blueprints.
                          </p>
                        ) : (
                          <div className="space-y-3">
                            {blueprintUsages.map((usage) => (
                              <div
                                key={`${usage.id}-${usage.usageType}`}
                                className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-md bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center">
                                    <Layers className="w-4 h-4 text-primary" />
                                  </div>
                                  <div>
                                    <p className="font-medium text-sm">{usage.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      {usage.pipeline && (
                                        <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                                          {PIPELINES.find(p => p.id === usage.pipeline)?.name || usage.pipeline}
                                        </Badge>
                                      )}
                                      <Badge
                                        variant="outline"
                                        className={`text-xs ${
                                          usage.usageType === 'master_prompt'
                                            ? "bg-blue-500/10 text-blue-600 border-blue-500/30"
                                            : "bg-pink-500/10 text-pink-600 border-pink-500/30"
                                        }`}
                                      >
                                        {usage.usageType === 'master_prompt' ? 'Master Prompt' : 'Image Prompt'}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                                <Link
                                  to={`/blueprints/${usage.id}`}
                                  onClick={() => onOpenChange(false)}
                                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  View
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ScrollArea>

            <div className="shrink-0 px-8 py-6 border-t flex items-center justify-between">
              <div className="flex items-center gap-2">
                {!isReadOnly && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setDeleteDialogOpen(true)}
                    disabled={isUpdating}
                    className="gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDuplicate}
                  className="gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Duplicate
                </Button>
              </div>
              <Button type="button" onClick={() => onOpenChange(false)} className="min-w-24">
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Prompt Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{prompt.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
