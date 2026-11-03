import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, BookTemplate, Eye, Sparkles, Target, Code2, ImageIcon, Filter, Zap, Lightbulb, MessageSquare } from "lucide-react";
import { usePromptTemplates, usePromptScenarios, type PromptType } from "@/hooks/usePromptTemplates";
import { PIPELINES, type PipelineId } from "@/types/pipeline";
import type { Database } from "@/integrations/supabase/types";
import { extractPromptVariables } from "@/lib/blueprintUtils";

type PromptTemplate = Database["public"]["Tables"]["prompt_library"]["Row"];

interface PromptTemplateSelectorProps {
  onSelect: (prompt: string) => void;
  promptType?: PromptType;
  pipelineType?: PipelineId | null;
}

export function PromptTemplateSelector({ onSelect, promptType = 'text', pipelineType: initialPipelineType }: PromptTemplateSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [previewTemplate, setPreviewTemplate] = useState<PromptTemplate | null>(null);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineId | "all">(initialPipelineType || "all");
  const [selectedScenario, setSelectedScenario] = useState<string | "all">("all");

  const activePipeline = selectedPipeline === "all" ? null : selectedPipeline;
  const activeScenario = selectedScenario === "all" ? null : selectedScenario;

  const { data: templates, isLoading } = usePromptTemplates({
    promptType,
    pipelineType: activePipeline,
    scenario: activeScenario,
  });

  const { data: scenarios } = usePromptScenarios(activePipeline, promptType);

  const isImagePrompt = promptType === 'image';
  const isDirectorPrompt = promptType === 'director';

  // Reset scenario when pipeline changes
  const handlePipelineChange = (value: string) => {
    setSelectedPipeline(value as PipelineId | "all");
    setSelectedScenario("all");
  };

  const filteredTemplates = templates?.filter(template =>
    template.name.toLowerCase().includes(search.toLowerCase()) ||
    template.description?.toLowerCase().includes(search.toLowerCase()) ||
    template.prompt_content.toLowerCase().includes(search.toLowerCase()) ||
    template.category?.toLowerCase().includes(search.toLowerCase()) ||
    template.scenario?.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelectTemplate = (template: PromptTemplate) => {
    onSelect(template.prompt_content);
    setOpen(false);
  };

  const getVariables = (template: PromptTemplate): string[] => {
    if (!template.variables) return [];
    try {
      if (Array.isArray(template.variables)) {
        return template.variables as string[];
      }
      return [];
    } catch {
      return [];
    }
  };

  const formatLabel = (text: string): string => {
    return text
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            {isImagePrompt ? <ImageIcon className="h-4 w-4" /> : <BookTemplate className="h-4 w-4" />}
            {isImagePrompt ? "Browse Image Templates" : isDirectorPrompt ? "Browse Director Templates" : "Browse Templates"}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-5xl h-[85vh] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 space-y-2 shrink-0">
            <DialogTitle className="text-2xl">
              {isImagePrompt ? "Image Prompt Template Library" : isDirectorPrompt ? "Director Prompt Template Library" : "Prompt Template Library"}
            </DialogTitle>
            <DialogDescription>
              {isImagePrompt
                ? "Choose from pre-built image generation prompt templates"
                : isDirectorPrompt
                ? "Choose from pre-built video director prompt templates for visual creative direction"
                : "Choose from pre-built prompt templates to get started quickly"}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 pb-4 shrink-0 space-y-3">
            <div className="flex gap-3">
              <Select value={selectedPipeline} onValueChange={handlePipelineChange}>
                <SelectTrigger className="w-[200px]">
                  <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="All Pipelines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Pipelines</SelectItem>
                  {PIPELINES.map((pipeline) => (
                    <SelectItem key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {scenarios && scenarios.length > 0 && (
                <Select value={selectedScenario} onValueChange={setSelectedScenario}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Scenarios" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Scenarios</SelectItem>
                    {scenarios.map((scenario) => (
                      <SelectItem key={scenario} value={scenario}>
                        {formatLabel(scenario)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <Input
              placeholder="Search templates by name, scenario, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
              className="h-10"
            />
          </div>

          <ScrollArea className="flex-1 px-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredTemplates && filteredTemplates.length > 0 ? (
              <div className="grid gap-4 pb-6">
                {filteredTemplates.map((template) => {
                  const variables = getVariables(template);
                  const extractedVars = extractPromptVariables(template.prompt_content);
                  const { aiCategories } = extractedVars;
                  const hasAiInsights = aiCategories.hooks || aiCategories.talking_points || aiCategories.ctas || aiCategories.script_structure || aiCategories.engagement;

                  return (
                    <Card key={template.id} className="group hover:border-primary/50 hover:shadow-md transition-all duration-200">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          {template.preview_url && (
                            <img
                              src={template.preview_url}
                              alt={`${template.name} preview`}
                              className="h-24 w-24 shrink-0 rounded-md border bg-muted object-cover"
                              loading="lazy"
                            />
                          )}
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <CardTitle className="text-lg line-clamp-1">
                                {template.name}
                              </CardTitle>
                              {template.is_preset && (
                                <Badge variant="secondary" className="text-xs gap-1">
                                  <Sparkles className="h-3 w-3" />
                                  Preset
                                </Badge>
                              )}
                              {template.pipeline_type && (
                                <Badge variant="default" className="text-xs">
                                  {PIPELINES.find(p => p.id === template.pipeline_type)?.name || formatLabel(template.pipeline_type)}
                                </Badge>
                              )}
                              {template.scenario && (
                                <Badge variant="outline" className="text-xs">
                                  {formatLabel(template.scenario)}
                                </Badge>
                              )}
                            </div>
                            {template.description && (
                              <CardDescription className="line-clamp-2 text-sm">
                                {template.description}
                              </CardDescription>
                            )}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPreviewTemplate(template)}
                              className="gap-2"
                            >
                              <Eye className="h-4 w-4" />
                              Preview
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleSelectTemplate(template)}
                              className="gap-2"
                            >
                              Use Template
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 space-y-2">
                        {/* AI Insights badges */}
                        {hasAiInsights && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs text-muted-foreground mr-1">Uses:</span>
                            {aiCategories.hooks && (
                              <Badge variant="outline" className="text-xs gap-1 bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400">
                                <Zap className="h-3 w-3" />
                                Hooks
                              </Badge>
                            )}
                            {aiCategories.talking_points && (
                              <Badge variant="outline" className="text-xs gap-1 bg-primary/10 border-primary/30 text-primary">
                                <Lightbulb className="h-3 w-3" />
                                Talking Points
                              </Badge>
                            )}
                            {aiCategories.ctas && (
                              <Badge variant="outline" className="text-xs gap-1 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">
                                <MessageSquare className="h-3 w-3" />
                                CTAs
                              </Badge>
                            )}
                            {aiCategories.script_structure && (
                              <Badge variant="outline" className="text-xs bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400">
                                Script Structure
                              </Badge>
                            )}
                            {aiCategories.engagement && (
                              <Badge variant="outline" className="text-xs bg-pink-500/10 border-pink-500/30 text-pink-700 dark:text-pink-400">
                                Engagement
                              </Badge>
                            )}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {template.content_types?.slice(0, 3).map((type) => (
                            <Badge key={type} variant="outline" className="text-xs">
                              {formatLabel(type)}
                            </Badge>
                          ))}
                          {template.content_types && template.content_types.length > 3 && (
                            <span className="text-muted-foreground">
                              +{template.content_types.length - 3} more
                            </span>
                          )}
                          {variables.length > 0 && (
                            <>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground flex items-center gap-1">
                                <Code2 className="h-3 w-3" />
                                {variables.length} {variables.length === 1 ? 'variable' : 'variables'}
                              </span>
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
                <BookTemplate className="h-12 w-12 text-muted-foreground/50" />
                <p className="text-muted-foreground">
                  {search ? "No templates found matching your search" : "No templates available"}
                </p>
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <DialogTitle className="text-2xl">{previewTemplate?.name}</DialogTitle>
                {previewTemplate?.description && (
                  <DialogDescription className="text-base">
                    {previewTemplate.description}
                  </DialogDescription>
                )}
                {previewTemplate?.preview_url && (
                  <img
                    src={previewTemplate.preview_url}
                    alt={`${previewTemplate.name} preview`}
                    className="mt-3 max-h-72 rounded-lg border bg-muted object-contain"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="flex gap-2 shrink-0 flex-wrap">
                {previewTemplate?.pipeline_type && (
                  <Badge variant="default">
                    {PIPELINES.find(p => p.id === previewTemplate.pipeline_type)?.name || formatLabel(previewTemplate.pipeline_type)}
                  </Badge>
                )}
                {previewTemplate?.scenario && (
                  <Badge variant="secondary">
                    {formatLabel(previewTemplate.scenario)}
                  </Badge>
                )}
                {previewTemplate?.is_preset && (
                  <Badge variant="outline" className="gap-1">
                    <Sparkles className="h-3 w-3" />
                    Preset
                  </Badge>
                )}
              </div>
            </div>
          </DialogHeader>

          <Separator />
          
          {previewTemplate && (() => {
            const previewExtractedVars = extractPromptVariables(previewTemplate.prompt_content);
            const previewAiCategories = previewExtractedVars.aiCategories;
            const previewHasAiInsights = previewAiCategories.hooks || previewAiCategories.talking_points || previewAiCategories.ctas || previewAiCategories.script_structure || previewAiCategories.engagement;

            return (
            <ScrollArea className="flex-1 px-6">
              <div className="space-y-6 py-6">
                {/* Goals Section */}
                {previewTemplate.goals && previewTemplate.goals.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Target className="h-4 w-4 text-primary" />
                      Goals
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {previewTemplate.goals.map((goal) => (
                        <Badge key={goal} variant="secondary" className="text-sm py-1">
                          {formatLabel(goal)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI Insights Section */}
                {previewHasAiInsights && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-primary" />
                      AI Insights Used
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {previewAiCategories.hooks && (
                        <Badge variant="outline" className="text-sm py-1 gap-1.5 bg-yellow-500/10 border-yellow-500/30 text-yellow-700 dark:text-yellow-400">
                          <Zap className="h-3.5 w-3.5" />
                          Hooks
                        </Badge>
                      )}
                      {previewAiCategories.talking_points && (
                        <Badge variant="outline" className="text-sm py-1 gap-1.5 bg-primary/10 border-primary/30 text-primary">
                          <Lightbulb className="h-3.5 w-3.5" />
                          Talking Points
                        </Badge>
                      )}
                      {previewAiCategories.ctas && (
                        <Badge variant="outline" className="text-sm py-1 gap-1.5 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400">
                          <MessageSquare className="h-3.5 w-3.5" />
                          CTAs
                        </Badge>
                      )}
                      {previewAiCategories.script_structure && (
                        <Badge variant="outline" className="text-sm py-1 bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400">
                          Script Structure
                        </Badge>
                      )}
                      {previewAiCategories.engagement && (
                        <Badge variant="outline" className="text-sm py-1 bg-pink-500/10 border-pink-500/30 text-pink-700 dark:text-pink-400">
                          Engagement Drivers
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This template uses AI-analyzed insights from your ideas. Make sure your selected ideas have AI analysis data.
                    </p>
                  </div>
                )}

                {/* Prompt Content */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Code2 className="h-4 w-4 text-primary" />
                    Prompt Template
                  </div>
                  <div className="rounded-lg border bg-muted/50 p-4">
                    <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">
                      {previewTemplate.prompt_content}
                    </pre>
                  </div>
                </div>

                {/* Variables Section */}
                {getVariables(previewTemplate).length > 0 && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">
                      Variables ({getVariables(previewTemplate).length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {getVariables(previewTemplate).map((variable) => (
                        <Badge key={variable} variant="outline" className="font-mono text-sm py-1 px-3">
                          {`{{${variable}}}`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content Types Section */}
                {previewTemplate.content_types && previewTemplate.content_types.length > 0 && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold">Supported Content Types</div>
                    <div className="flex flex-wrap gap-2">
                      {previewTemplate.content_types.map((type) => (
                        <Badge key={type} variant="outline" className="text-sm py-1">
                          {formatLabel(type)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
            );
          })()}

          <Separator />

          <div className="flex justify-end gap-3 px-6 py-4 shrink-0">
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>
              Close
            </Button>
            {previewTemplate && (
              <Button onClick={() => {
                handleSelectTemplate(previewTemplate);
                setPreviewTemplate(null);
              }} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Use This Template
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
