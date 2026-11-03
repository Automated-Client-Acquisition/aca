import { ManualIdeaRow } from "@/types/generation";
import { Blueprint } from "@/types/blueprint";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Lightbulb, Plus, X, AlertCircle, Search, Upload, Database, ExternalLink, Tag, Filter } from "lucide-react";
import { nanoid } from "nanoid";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useIdeas } from "@/hooks/useIdeas";
import { useIdeaTags, useIdeasCountByTag } from "@/hooks/useIdeaTags";
import { useState, useMemo, useRef } from "react";
import { toast } from "sonner";
import { formatLabel } from "@/lib/blueprintCardUtils";
import { useNavigate } from "react-router-dom";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface IdeaStepProps {
  blueprint: Blueprint;
  ideaRows: ManualIdeaRow[];
  onChange: (rows: ManualIdeaRow[]) => void;
}
export function IdeaStep({
  blueprint,
  ideaRows,
  onChange
}: IdeaStepProps) {
  const navigate = useNavigate();
  const {
    ideas: dbIdeas,
    isLoading
  } = useIdeas();
  const { data: availableTags = [], isLoading: isLoadingTags } = useIdeaTags();
  const { data: tagCounts = {} } = useIdeasCountByTag();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addIdea = () => {
    onChange([...ideaRows, {
      id: nanoid(),
      context: ""
    }]);
  };
  const updateIdea = (id: string, context: string) => {
    onChange(ideaRows.map(row => row.id === id ? {
      ...row,
      context
    } : row));
  };
  const removeIdea = (id: string) => {
    onChange(ideaRows.filter(row => row.id !== id));
  };
  const toggleDatabaseIdea = (idea: { id: string; title: string }) => {
    const exists = ideaRows.some(row => row.id === idea.id);
    if (exists) {
      onChange(ideaRows.filter(row => row.id !== idea.id));
    } else {
      onChange([...ideaRows, { id: idea.id, context: idea.title }]);
    }
  };
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      const text = event.target?.result as string;
      const lines = text.split('\n').map(line => line.trim()).filter(line => line);

      // Skip header if it looks like a CSV header
      const startIndex = lines[0]?.toLowerCase().includes('idea') || lines[0]?.toLowerCase().includes('title') ? 1 : 0;
      const newIdeas = lines.slice(startIndex).map(line => ({
        id: nanoid(),
        context: line.split(',')[0].trim() // Take first column
      }));
      if (newIdeas.length > 0) {
        onChange([...ideaRows, ...newIdeas]);
        toast.success(`Imported ${newIdeas.length} idea${newIdeas.length !== 1 ? 's' : ''} from CSV`);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  const toggleTag = (tagName: string) => {
    setSelectedTags(prev =>
      prev.includes(tagName)
        ? prev.filter(t => t !== tagName)
        : [...prev, tagName]
    );
  };

  const filteredDbIdeas = useMemo(() => {
    if (!dbIdeas) return [];

    let filtered = dbIdeas;

    // Filter by selected tags (AND logic - idea must have ALL selected tags)
    if (selectedTags.length > 0) {
      filtered = filtered.filter(idea => {
        const ideaTagNames = idea.tags?.map(t => t.name) || [];
        return selectedTags.every(tag => ideaTagNames.includes(tag));
      });
    }

    // Filter by search query
    const query = searchQuery.toLowerCase().trim();
    if (query) {
      filtered = filtered.filter(idea => idea.title.toLowerCase().includes(query));
    }

    return filtered;
  }, [dbIdeas, searchQuery, selectedTags]);
  const hasEmptyIdeas = ideaRows.some(row => !row.context.trim());
  return <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
          <Lightbulb className="h-8 w-8 text-cta" />
          Add Content Ideas
        </h1>
        <p className="text-muted-foreground text-lg">
          Provide context for your content generation. Each idea will be combined with your selected library elements.
        </p>
      </div>

      {/* Blueprint Context Card */}
      <Card className="border-cta/20 bg-cta/5">
        <CardHeader>
          <CardTitle className="text-lg">Selected Blueprint</CardTitle>
          <CardDescription>
            Your ideas will be used to generate: <strong>{formatLabel(blueprint.pipeline || 'content')}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{blueprint.name}</Badge>
              <Badge variant="outline">{formatLabel(blueprint.pipeline)}</Badge>
            </div>
            {blueprint.description && <p className="text-sm text-muted-foreground">
                {blueprint.description}
              </p>}
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Each idea represents a unique piece of content. Add multiple ideas to generate a batch of content at once.
          Ideas will be multiplied by your library element selections in the next steps.
        </AlertDescription>
      </Alert>

      {/* Ideas Management */}
      <Tabs defaultValue="database" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="database">
            <Database className="h-4 w-4 mr-2" />
            From Bank
          </TabsTrigger>
          <TabsTrigger value="manual">
            <Plus className="h-4 w-4 mr-2" />
            Manual Entry
          </TabsTrigger>
          <TabsTrigger value="csv">
            <Upload className="h-4 w-4 mr-2" />
            CSV Import
          </TabsTrigger>
        </TabsList>

        {/* Manual Entry Tab */}
        <TabsContent value="manual" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Your Ideas ({ideaRows.length})
            </h2>
            <Button onClick={addIdea} variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add Idea
            </Button>
          </div>

          {ideaRows.length === 0 ? <Card className="p-12 text-center border-dashed">
              <Lightbulb className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No ideas yet</h3>
              <p className="text-muted-foreground mb-4">
                Add your first idea to get started with content generation
              </p>
              <Button onClick={addIdea}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Idea
              </Button>
            </Card> : <div className="space-y-3">
              {ideaRows.map((row, index) => <Card key={row.id}>
                  <CardContent className="pt-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline">Idea {index + 1}</Badge>
                        <Button variant="ghost" size="sm" onClick={() => removeIdea(row.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <Textarea placeholder="Describe your content idea... (e.g., 'Create a video about the benefits of morning meditation')" value={row.context} onChange={e => updateIdea(row.id, e.target.value)} rows={3} className="resize-none" />
                      {!row.context.trim() && <p className="text-xs text-destructive">
                          Idea description is required
                        </p>}
                    </div>
                  </CardContent>
                </Card>)}
            </div>}
        </TabsContent>

        {/* Database Tab */}
        <TabsContent value="database" className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">
              Select from Idea Bank
            </h2>
          </div>

          {/* Search and Tag Filter Row */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search ideas..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-10" />
            </div>

            {/* Tag Filter Popover */}
            <Popover open={tagFilterOpen} onOpenChange={setTagFilterOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  Tags
                  {selectedTags.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                      {selectedTags.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <div className="p-3 border-b">
                  <h4 className="font-medium text-sm">Filter by Tags</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ideas must have ALL selected tags
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  {isLoadingTags ? (
                    <p className="text-sm text-muted-foreground p-2">Loading tags...</p>
                  ) : availableTags.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-2">No tags available</p>
                  ) : (
                    <div className="space-y-1">
                      {availableTags.map(tag => (
                        <div
                          key={tag.id}
                          className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                          onClick={() => toggleTag(tag.name)}
                        >
                          <Checkbox checked={selectedTags.includes(tag.name)} />
                          <Tag className="h-3 w-3 text-muted-foreground" />
                          <span className="flex-1 text-sm">{tag.name}</span>
                          {tagCounts[tag.name] !== undefined && (
                            <span className="text-xs text-muted-foreground">
                              ({tagCounts[tag.name]})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {selectedTags.length > 0 && (
                  <div className="p-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => setSelectedTags([])}
                    >
                      Clear all tags
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {/* Active Tag Filters Display */}
          {selectedTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedTags.map(tagName => (
                <Badge
                  key={tagName}
                  variant="secondary"
                  className="cursor-pointer hover:bg-secondary/80"
                  onClick={() => toggleTag(tagName)}
                >
                  <Tag className="h-3 w-3 mr-1" />
                  {tagName}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
          )}

          {isLoading ? <div className="text-center py-8 text-muted-foreground">
              Loading ideas...
            </div> : filteredDbIdeas.length === 0 ? <Card className="p-12 text-center border-dashed">
              <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No ideas found</h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || selectedTags.length > 0
                  ? "Try different search terms or tags"
                  : "Create ideas in the Ideas section first"}
              </p>
              {!searchQuery && selectedTags.length === 0 && (
                <Button variant="outline" onClick={() => navigate("/ideas")}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Go to Ideas
                </Button>
              )}
              {selectedTags.length > 0 && (
                <Button variant="outline" onClick={() => setSelectedTags([])}>
                  Clear tag filters
                </Button>
              )}
            </Card> : <div className="space-y-2 max-h-96 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-2">
                Showing {filteredDbIdeas.length} idea{filteredDbIdeas.length !== 1 ? 's' : ''}
                {selectedTags.length > 0 && ` matching ${selectedTags.length} tag${selectedTags.length !== 1 ? 's' : ''}`}
              </p>
              {filteredDbIdeas.map(idea => {
                const isSelected = ideaRows.some(row => row.id === idea.id);
                return <Card key={idea.id} className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => toggleDatabaseIdea(idea)}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-3">
                      <Checkbox checked={isSelected} className="mt-1" />
                      <div className="flex-1 min-w-0">
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="font-medium truncate">{idea.title}</p>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-md">
                              <p className="whitespace-normal">{idea.title}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        {/* Show tags if idea has them */}
                        {idea.tags && idea.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {idea.tags.slice(0, 5).map(tag => (
                              <Badge key={tag.id} variant="outline" className="text-xs">
                                <Tag className="h-2.5 w-2.5 mr-1" />
                                {tag.name}
                              </Badge>
                            ))}
                            {idea.tags.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{idea.tags.length - 5} more
                              </Badge>
                            )}
                          </div>
                        )}
                        {/* Show keywords as fallback if no tags */}
                        {(!idea.tags || idea.tags.length === 0) && idea.keywords && idea.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {idea.keywords.slice(0, 3).map(kw => (
                              <Badge key={kw} variant="secondary" className="text-xs">
                                {kw}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>;
              })}
            </div>}
        </TabsContent>

        {/* CSV Import Tab */}
        <TabsContent value="csv" className="space-y-4">
          <Card className="p-8 text-center border-dashed">
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Import Ideas from CSV</h3>
            <p className="text-muted-foreground mb-4">
              Upload a CSV file with one idea per row. The first column will be used as the idea text.
            </p>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Choose CSV File
            </Button>
            <div className="mt-4 text-xs text-muted-foreground">
              <p>Example CSV format:</p>
              <pre className="mt-2 p-2 bg-muted rounded text-left inline-block">
                {`idea\nHow to meditate in 5 minutes\nBenefits of morning routines\nProductivity hacks for developers`}
              </pre>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Selected Ideas Summary */}
      {ideaRows.length > 0 && <Card className="bg-cta/5 border-cta/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Selected Ideas: {ideaRows.length}</p>
                <p className="text-sm text-muted-foreground">
                  These ideas will be combined with library elements for generation
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => onChange([])}>
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>}

      {/* Validation Warning */}
      {hasEmptyIdeas && <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Please fill in all idea descriptions before continuing.
          </AlertDescription>
        </Alert>}
    </div>;
}