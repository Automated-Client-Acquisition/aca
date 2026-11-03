import { useState } from "react";
import { ManualIdeaRow } from "@/types/generation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIdeas } from "@/hooks/useIdeas";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, FileText, Upload, Plus, Trash2, ChevronDown, Search, Info } from "lucide-react";
import { nanoid } from "nanoid";
import { toast } from "sonner";

interface IdeaSelectorProps {
  rows: ManualIdeaRow[];
  onChange: (rows: ManualIdeaRow[]) => void;
}

export function IdeaSelector({ rows, onChange }: IdeaSelectorProps) {
  const { ideas, isLoading } = useIdeas();
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<Set<string>>(new Set());
  const [expandedIdeaIds, setExpandedIdeaIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const toggleExpanded = (ideaId: string) => {
    const newExpanded = new Set(expandedIdeaIds);
    if (newExpanded.has(ideaId)) {
      newExpanded.delete(ideaId);
    } else {
      newExpanded.add(ideaId);
    }
    setExpandedIdeaIds(newExpanded);
  };

  // Handle selecting ideas from bank
  const handleToggleIdea = (ideaId: string, title: string, checked: boolean) => {
    const newSelected = new Set(selectedIdeaIds);
    if (checked) {
      newSelected.add(ideaId);
      // Add to rows, including free_text and source_urls from database idea
      const dbIdea = ideas.find(i => i.id === ideaId);
      onChange([
        ...rows,
        {
          id: ideaId,
          context: title,
          ...(dbIdea?.free_text ? { freeText: dbIdea.free_text } : {}),
          ...(dbIdea?.source_urls ? { sourceUrls: dbIdea.source_urls } : {}),
        }
      ]);
    } else {
      newSelected.delete(ideaId);
      // Remove from rows
      onChange(rows.filter(r => r.id !== ideaId));
    }
    setSelectedIdeaIds(newSelected);
  };

  // Manual entry handlers
  const handleAddManualRow = () => {
    onChange([
      ...rows,
      { id: nanoid(), context: '' }
    ]);
  };

  const handleUpdateManualRow = (id: string, field: string, value: string) => {
    onChange(rows.map(row =>
      row.id === id ? { ...row, [field]: value } : row
    ));
  };

  const handleDeleteManualRow = (id: string) => {
    onChange(rows.filter(row => row.id !== id));
    // Also remove from selected if it was from bank
    const newSelected = new Set(selectedIdeaIds);
    newSelected.delete(id);
    setSelectedIdeaIds(newSelected);
  };

  // CSV import handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCsvFile(file);
    }
  };

  const handleImportCSV = () => {
    if (!csvFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        // Skip header if it exists
        const hasHeader = lines[0].toLowerCase().includes('context') || 
                          lines[0].toLowerCase().includes('title') ||
                          lines[0].toLowerCase().includes('idea');
        const dataLines = hasHeader ? lines.slice(1) : lines;

        const newRows = dataLines.map(line => ({
          id: nanoid(),
          context: line.trim()
        })).filter(row => row.context);

        onChange([...rows, ...newRows]);
        toast.success(`Imported ${newRows.length} ideas from CSV`);
        setCsvFile(null);
      } catch (error) {
        toast.error('Failed to parse CSV file');
      }
    };
    reader.readAsText(csvFile);
  };

  const manualRows = rows.filter(r => !selectedIdeaIds.has(r.id));

  // Filter ideas based on search query
  const filteredIdeas = ideas.filter(idea => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      idea.title.toLowerCase().includes(query) ||
      idea.keywords?.some(k => k.toLowerCase().includes(query)) ||
      (idea.ai_analysis as any)?.talking_points?.some((p: string) => p.toLowerCase().includes(query)) ||
      idea.product?.name.toLowerCase().includes(query) ||
      idea.brand_voice?.name.toLowerCase().includes(query) ||
      idea.content_angle?.name.toLowerCase().includes(query)
    );
  });

  return (
    <Tabs defaultValue="bank" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="bank">
          <Database className="h-4 w-4 mr-2" />
          Idea Bank
        </TabsTrigger>
        <TabsTrigger value="manual">
          <FileText className="h-4 w-4 mr-2" />
          Manual Entry
        </TabsTrigger>
        <TabsTrigger value="csv">
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </TabsTrigger>
      </TabsList>

      <TabsContent value="bank" className="space-y-4">
        <Card className="p-4">
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-sm">Select from your idea bank</h3>
                <p className="text-xs text-muted-foreground">
                  {selectedIdeaIds.size} ideas selected
                </p>
              </div>
            </div>
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, product, brand, keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-9 h-9"
              />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-xs">Search filters by:</p>
                    <ul className="text-xs mt-1 space-y-0.5 list-disc list-inside">
                      <li>Idea title</li>
                      <li>Product name</li>
                      <li>Brand voice</li>
                      <li>Content angle</li>
                      <li>Keywords</li>
                      <li>Talking points</li>
                    </ul>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredIdeas.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No ideas found</p>
              <p className="text-xs mt-1">
                {searchQuery ? 'Try a different search term' : 'Create ideas in the Ideas page'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {filteredIdeas.map(idea => {
                const isChecked = selectedIdeaIds.has(idea.id);
                const isExpanded = expandedIdeaIds.has(idea.id);
                return (
                  <Collapsible
                    key={idea.id}
                    open={isExpanded}
                    onOpenChange={() => toggleExpanded(idea.id)}
                  >
                    <div className="flex items-start space-x-3 p-3 hover:bg-muted/50 rounded border border-border">
                      <Checkbox
                        id={`idea-${idea.id}`}
                        checked={isChecked}
                        onCheckedChange={(checked) => 
                          handleToggleIdea(idea.id, idea.title, checked as boolean)
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <CollapsibleTrigger className="w-full text-left group">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 font-medium text-sm cursor-pointer hover:text-primary transition-colors">
                              {idea.title}
                            </div>
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </CollapsibleTrigger>
                        
                        <CollapsibleContent className="pt-3 space-y-2">
                          {idea.free_text && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Free Text:</p>
                              <p className="text-xs text-muted-foreground whitespace-pre-wrap">{idea.free_text}</p>
                            </div>
                          )}
                          {idea.source_urls && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">URLs:</p>
                              <p className="text-xs text-muted-foreground break-all">{idea.source_urls}</p>
                            </div>
                          )}
                          {idea.keywords && idea.keywords.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Keywords:</p>
                              <div className="flex flex-wrap gap-1">
                                {idea.keywords.map((keyword, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">
                                    {keyword}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {((idea.ai_analysis as any)?.talking_points?.length > 0) && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Key Points:</p>
                              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                                {(idea.ai_analysis as any).talking_points.map((point: string, idx: number) => (
                                  <li key={idx}>{point}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {idea.emotional_triggers && idea.emotional_triggers.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-muted-foreground mb-1">Emotional Triggers:</p>
                              <div className="flex flex-wrap gap-1">
                                {idea.emotional_triggers.map((trigger, idx) => (
                                  <Badge key={idx} variant="outline" className="text-xs">
                                    {trigger}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </CollapsibleContent>
                      </div>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </Card>
      </TabsContent>

      <TabsContent value="manual" className="space-y-4">
        <Card className="p-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-sm">Manual idea entry</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Add context for each piece of content
                </p>
              </div>
              <Button onClick={handleAddManualRow} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Row
              </Button>
            </div>

            {manualRows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No manual ideas yet</p>
                <p className="text-xs mt-1">Click "Add Row" to create one</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {manualRows.map((row, index) => (
                  <div key={row.id} className="flex gap-2 items-start">
                    <div className="flex-1 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Idea {index + 1}
                      </div>
                      <Textarea
                        value={row.context}
                        onChange={(e) => handleUpdateManualRow(row.id, 'context', e.target.value)}
                        placeholder="Enter context or description for this content idea..."
                        className="min-h-[80px]"
                      />
                      <Textarea
                        value={row.freeText || ''}
                        onChange={(e) => handleUpdateManualRow(row.id, 'freeText', e.target.value)}
                        placeholder="Additional text or notes (optional)"
                        className="min-h-[50px] text-sm"
                      />
                      <Input
                        value={row.sourceUrls || ''}
                        onChange={(e) => handleUpdateManualRow(row.id, 'sourceUrls', e.target.value)}
                        placeholder="Reference URLs (optional, one per line)"
                        className="text-sm"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteManualRow(row.id)}
                      className="mt-6"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="csv" className="space-y-4">
        <Card className="p-4">
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-sm mb-1">Import ideas from CSV</h3>
              <p className="text-xs text-muted-foreground">
                Upload a CSV file with one idea per line. First line can be a header (optional).
              </p>
            </div>

            <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <Input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="max-w-xs mx-auto"
              />
              {csvFile && (
                <div className="mt-4">
                  <p className="text-sm text-muted-foreground mb-2">
                    Selected: {csvFile.name}
                  </p>
                  <Button variant="cta" onClick={handleImportCSV} size="sm">
                    Import File
                  </Button>
                </div>
              )}
            </div>

            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">CSV Format Example:</p>
              <pre className="bg-muted p-2 rounded">
                context{'\n'}
                How to use our product for beginners{'\n'}
                Advanced tips and tricks{'\n'}
                Common mistakes to avoid
              </pre>
            </div>
          </div>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
