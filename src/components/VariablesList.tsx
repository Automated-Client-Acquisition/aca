import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, ChevronDown, ImageIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PipelineId } from "@/types/pipeline";

interface Variable {
  name: string;
  label: string;
  category: string;
  description?: string;
}

interface LibraryField {
  field: string;
  label: string;
  description?: string;
  /** Indicates this field contains visual references for AI generation */
  isVisualReference?: boolean;
}

// Library types that support reference images for visual consistency
const LIBRARIES_WITH_IMAGES = ["character", "product", "brand"] as const;

// Idea variables — resolved from selected ideas
const IDEA_VARIABLES: Variable[] = [
  { name: "topic", label: "Topic / Idea", category: "Idea", description: "The idea title/context (also works as {{idea}}, {{context}}, {{title}})" },
  { name: "idea_text", label: "Free Text", category: "Idea", description: "Custom free text written on the idea" },
];

// Video Config variables - automatically available for video pipelines based on wizard settings
const VIDEO_CONFIG_VARIABLES: Variable[] = [
  { name: "video_duration", label: "Video Duration (seconds)", category: "Video Config", description: "Total video duration in seconds (e.g., 60, 120)" },
  { name: "video_duration_minutes", label: "Video Duration (minutes)", category: "Video Config", description: "Total video duration in minutes (e.g., 1, 2)" },
  { name: "scene_count", label: "Scene Count", category: "Video Config", description: "Number of scenes configured in wizard (e.g., 8, 15)" },
  { name: "scene_duration", label: "Scene Duration", category: "Video Config", description: "Duration per scene in seconds (e.g., 8)" },
];

// Date & Time variables - automatically resolved at generation time
const DATE_VARIABLES: Variable[] = [
  { name: "current_year", label: "Current Year", category: "Date & Time", description: "Current year (e.g., 2026)" },
  { name: "current_month", label: "Current Month", category: "Date & Time", description: "Full month name (e.g., February)" },
  { name: "current_month_short", label: "Month (Short)", category: "Date & Time", description: "Short month name (e.g., Feb)" },
  { name: "current_month_number", label: "Month Number", category: "Date & Time", description: "Month as number (e.g., 02)" },
  { name: "current_date", label: "Current Date", category: "Date & Time", description: "Full date (e.g., 2026-02-23)" },
  { name: "current_quarter", label: "Current Quarter", category: "Date & Time", description: "Quarter (e.g., Q1)" },
];

// AI Insights variables - automatically available when using AI-analyzed ideas
// Ordered by most commonly used first
const AI_INSIGHTS_VARIABLES: Variable[] = [
  // Hook — most used in content
  { name: "ai_hook", label: "Hook", category: "AI Insights", description: "First hook (or selected hook for variations)" },
  { name: "ai_hook_type", label: "Hook Type", category: "AI Insights", description: "Type of hook (curiosity, fear, question, etc.)" },
  { name: "ai_hooks", label: "All Hooks", category: "AI Insights", description: "All hooks as numbered list with types" },
  { name: "ai_hooks_list", label: "All Hooks (pipe-separated)", category: "AI Insights", description: "All hook texts separated by |" },
  // CTA — second most used
  { name: "ai_cta", label: "CTA", category: "AI Insights", description: "First CTA text" },
  { name: "ai_cta_type", label: "CTA Type", category: "AI Insights", description: "Type of CTA (comment, follow, subscribe, etc.)" },
  { name: "ai_cta_placement", label: "CTA Placement", category: "AI Insights", description: "Where to place the CTA (end, middle, etc.)" },
  { name: "ai_ctas", label: "All CTAs", category: "AI Insights", description: "All CTAs as numbered list with placements" },
  { name: "ai_ctas_list", label: "All CTAs (pipe-separated)", category: "AI Insights", description: "All CTA texts separated by |" },
  // Talking points
  { name: "ai_talking_points", label: "Talking Points", category: "AI Insights", description: "Key talking points as bullet list" },
  { name: "ai_talking_point", label: "Talking Point (single)", category: "AI Insights", description: "Single talking point for variation-based generation" },
  { name: "ai_talking_points_list", label: "Talking Points (comma)", category: "AI Insights", description: "Key talking points as comma-separated list" },
  { name: "ai_guidelines", label: "Idea Guidelines", category: "AI Insights", description: "Points to make, what not to mention, and the rule to only state facts from them" },
  // Script structure
  { name: "ai_script_structure", label: "Script Structure", category: "AI Insights", description: "Full script structure (opening/body/climax/closing)" },
  { name: "ai_script_opening", label: "Script Opening", category: "AI Insights", description: "Opening section guidance" },
  { name: "ai_script_body", label: "Script Body", category: "AI Insights", description: "Body section guidance" },
  { name: "ai_script_climax", label: "Script Climax", category: "AI Insights", description: "Climax section guidance" },
  { name: "ai_script_closing", label: "Script Closing", category: "AI Insights", description: "Closing section guidance" },
  // Engagement drivers — least used
  { name: "ai_engagement_drivers", label: "Engagement Drivers", category: "AI Insights", description: "Engagement drivers as bullet list" },
  { name: "ai_engagement_drivers_list", label: "Engagement Drivers (comma)", category: "AI Insights", description: "Engagement drivers as comma-separated list" },
];

// Use shorthand names that match the backend SHORTHAND_MAP
const LIBRARY_FIELDS: Record<string, LibraryField[]> = {
  brand: [
    { field: "name", label: "Name", description: "Brand name" },
    { field: "description", label: "Description", description: "Full brand description" },
    { field: "tone", label: "Tone", description: "Brand tone characteristics" },
    { field: "style_guidelines", label: "Style Guidelines", description: "Style guidelines" },
    { field: "visual_style_description", label: "Visual Style Description", description: "Free-form visual style for image prompts" },
    { field: "reference_images", label: "Reference Images", description: "Visual references for brand style consistency", isVisualReference: true },
    { field: "logo", label: "Logo", description: "Brand logo URL" },
    { field: "color_palette", label: "Color Palette", description: "Brand colors as JSON (primary, secondary, background, text, textMuted)" },
    { field: "visual_template", label: "Visual Template", description: "Design template (minimal, bold, elegant, playful, professional)" },
    { field: "font_style", label: "Font Style", description: "Typography style (sans-serif, serif, display, handwritten)" },
    { field: "accent_style", label: "Accent Style", description: "Accent element style (gradient, solid, outline, glow)" },
    { field: "mood_keywords", label: "Mood Keywords", description: "Mood/aesthetic keywords (array)" },
  ],
  character: [
    { field: "name", label: "Name", description: "Character name" },
    { field: "description", label: "Description", description: "Character description" },
    { field: "personality", label: "Personality", description: "Character personality (JSON)" },
    { field: "speaking_style", label: "Speaking Style", description: "Character speaking style" },
    { field: "overall_tone", label: "Overall Tone", description: "Character overall tone" },
    { field: "expertise", label: "Expertise", description: "Character expertise (JSON)" },
    { field: "reference_images", label: "Reference Images", description: "Visual references for character appearance consistency", isVisualReference: true },
    { field: "visual_style", label: "Visual Style", description: "Character visual style" },
    { field: "typical_clothing", label: "Typical Clothing", description: "Character typical clothing" },
    { field: "age_range", label: "Age Range", description: "Character age range" },
    { field: "gender", label: "Gender", description: "Character gender" },
    { field: "ethnicity", label: "Ethnicity", description: "Character ethnicity" },
    { field: "build", label: "Build", description: "Character build/physique" },
    { field: "hair_description", label: "Hair Description", description: "Character hair description" },
    { field: "personality_traits", label: "Personality Traits", description: "Personality traits (JSON)" },
    { field: "voice_selection", label: "Voice Selection", description: "Voice selection" },
    { field: "accessories", label: "Accessories", description: "Character accessories (JSON)" },
    { field: "tags", label: "Tags", description: "Character tags" },
  ],
  block: [
    { field: "content", label: "Content", description: "Block content" },
    { field: "name", label: "Name", description: "Block name" },
    { field: "block_type", label: "Type", description: "Block type (hook, angle, cta, story_element)" },
    { field: "tags", label: "Tags", description: "Block tags (array)" },
  ],
  product: [
    { field: "name", label: "Name", description: "Product name" },
    { field: "description", label: "Description", description: "Product description" },
    { field: "features", label: "Features", description: "Product features (array)" },
    { field: "brand", label: "Brand", description: "Product brand" },
    { field: "category", label: "Category", description: "Product category" },
    { field: "price", label: "Price", description: "Product price" },
    { field: "images", label: "Images", description: "Product images for visual placement", isVisualReference: true },
    { field: "currency", label: "Currency", description: "Currency code" },
    { field: "sku", label: "SKU", description: "Product SKU" },
    { field: "videos", label: "Videos", description: "Product videos (array)" },
    { field: "tags", label: "Tags", description: "Product tags (array)" },
  ],
  icp: [
    { field: "name", label: "Name", description: "Target audience name" },
    { field: "description", label: "Description", description: "Audience description" },
    { field: "pain_points", label: "Pain Points", description: "Audience pain points (array)" },
    { field: "desires", label: "Desires", description: "Audience desires (array)" },
    { field: "language_style", label: "Language Style", description: "How this audience communicates" },
    { field: "objections", label: "Objections", description: "Common objections (array)" },
    { field: "tags", label: "Tags", description: "ICP tags (array)" },
  ],
  identity: [
    { field: "name", label: "Name", description: "Identity name" },
    { field: "description", label: "Description", description: "Identity description" },
    { field: "delivery", label: "Delivery", description: "Delivery settings (JSON)" },
  ],
};

// Determine which sections to auto-expand based on pipeline
function getDefaultOpenSections(pipeline?: PipelineId): Record<string, boolean> {
  const defaults: Record<string, boolean> = { "Idea": true, "Date & Time": true };

  if (!pipeline) return defaults;

  const VIDEO_PIPELINES: PipelineId[] = ['storyboard_video_longform', 'generative_video_oneshot'];
  const IMAGE_PIPELINES: PipelineId[] = ['social_media_post', 'instagram_carousel', 'storyboard_video_longform', 'image_only'];

  // Always expand AI Insights for content-producing pipelines
  if (pipeline !== 'image_only') {
    defaults["AI Insights"] = true;
  }

  // Expand visual sections for image-generating pipelines
  if (IMAGE_PIPELINES.includes(pipeline)) {
    defaults["Brands"] = true;
    defaults["Characters"] = true;
  }

  // Expand Video Config for video pipelines
  if (VIDEO_PIPELINES.includes(pipeline)) {
    defaults["Video Config"] = true;
  }

  return defaults;
}

interface VariablesListProps {
  onInsert: (variableName: string) => void;
  pipeline?: PipelineId;
}

export function VariablesList({ onInsert, pipeline }: VariablesListProps) {
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    getDefaultOpenSections(pipeline)
  );

  // Update open sections when pipeline changes
  useEffect(() => {
    setOpenSections(getDefaultOpenSections(pipeline));
  }, [pipeline]);

  const filteredIdeaVariables = IDEA_VARIABLES.filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.label.toLowerCase().includes(search.toLowerCase()) ||
    v.description?.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const renderLibrarySection = (
    title: string,
    tableName: string
  ) => {
    const fields = LIBRARY_FIELDS[tableName];
    const filteredFields = fields?.filter((field) =>
      field.field.toLowerCase().includes(search.toLowerCase()) ||
      field.label.toLowerCase().includes(search.toLowerCase()) ||
      field.description?.toLowerCase().includes(search.toLowerCase())
    );

    if (search && (!filteredFields || filteredFields.length === 0)) return null;

    // Check if this library type supports visual references
    const hasVisualReferences = LIBRARIES_WITH_IMAGES.includes(tableName as typeof LIBRARIES_WITH_IMAGES[number]);

    return (
      <Collapsible
        open={openSections[title] ?? false}
        onOpenChange={() => toggleSection(title)}
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-medium text-muted-foreground hover:text-foreground mb-2 transition-colors">
          <span className="flex items-center gap-1.5">
            {title}
            {hasVisualReferences && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ImageIcon className="h-3.5 w-3.5 text-primary" />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">Supports reference images for visual consistency</p>
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${
              openSections[title] ? "transform rotate-180" : ""
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1">
          {filteredFields && filteredFields.length > 0 ? (
            filteredFields.map((field) => (
              <button
                type="button"
                key={field.field}
                onClick={() => onInsert(`${tableName}.${field.field}`)}
                className={`w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors group ${
                  field.isVisualReference ? "bg-primary/5 border border-primary/20" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    {field.isVisualReference && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ImageIcon className="h-3.5 w-3.5 text-primary" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[200px]">
                          <p className="text-xs">Visual reference images - select in the wizard for AI generation consistency</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {field.label}
                  </span>
                  <Badge
                    variant="secondary"
                    className={`font-mono text-xs shrink-0 ${
                      field.isVisualReference
                        ? "bg-primary/10 text-primary hover:bg-primary/20 border-primary/20"
                        : "bg-primary/10 text-primary hover:bg-primary/20 border-primary/20"
                    }`}
                  >
                    {`{{${tableName}.${field.field}}}`}
                  </Badge>
                </div>
                {field.description && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {field.description}
                  </p>
                )}
              </button>
            ))
          ) : (
            <p className="text-xs text-muted-foreground p-2">
              No fields available
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <Card className="p-4 h-full overflow-hidden flex flex-col">
      <Label className="mb-3 text-base font-semibold">Available Variables</Label>
      
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search variables..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          autoComplete="off"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-4">
        {/* 1. Idea Variables — most important, always first */}
        {filteredIdeaVariables.length > 0 && (
          <div>
            <Collapsible
              open={openSections["Idea"] ?? false}
              onOpenChange={() => toggleSection("Idea")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold hover:text-foreground mb-2 transition-colors">
                <span>Idea</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    openSections["Idea"] ? "transform rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1">
                {filteredIdeaVariables.map((variable) => (
                  <button
                    type="button"
                    key={variable.name}
                    onClick={() => onInsert(variable.name)}
                    className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{variable.label}</span>
                      <Badge variant="secondary" className="font-mono text-xs bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                        {`{{${variable.name}}}`}
                      </Badge>
                    </div>
                    {variable.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {variable.description}
                      </p>
                    )}
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* 2. AI Insights Variables */}
        {AI_INSIGHTS_VARIABLES.filter((v) =>
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.label.toLowerCase().includes(search.toLowerCase()) ||
          v.description?.toLowerCase().includes(search.toLowerCase())
        ).length > 0 && (
          <div>
            <Collapsible
              open={openSections["AI Insights"] ?? false}
              onOpenChange={() => toggleSection("AI Insights")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold hover:text-foreground mb-2 transition-colors">
                <span>AI Insights (from analyzed ideas)</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    openSections["AI Insights"] ? "transform rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1">
                <p className="text-xs text-muted-foreground mb-2 px-2">
                  These variables are populated when using AI-analyzed ideas and selecting hooks/CTAs in the wizard.
                </p>
                {AI_INSIGHTS_VARIABLES.filter((v) =>
                  v.name.toLowerCase().includes(search.toLowerCase()) ||
                  v.label.toLowerCase().includes(search.toLowerCase()) ||
                  v.description?.toLowerCase().includes(search.toLowerCase())
                ).map((variable) => (
                  <button
                    type="button"
                    key={variable.name}
                    onClick={() => onInsert(variable.name)}
                    className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{variable.label}</span>
                      <Badge variant="secondary" className="font-mono text-xs bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">
                        {`{{${variable.name}}}`}
                      </Badge>
                    </div>
                    {variable.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {variable.description}
                      </p>
                    )}
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* 3. Library Elements */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Library Elements</h2>

          {renderLibrarySection("Brands", "brand")}
          {renderLibrarySection("Characters", "character")}
          {renderLibrarySection("Products", "product")}
          {renderLibrarySection("Target Audiences (ICP)", "icp")}
          {renderLibrarySection("Blocks", "block")}
          {renderLibrarySection("Identities", "identity")}
        </div>

        {/* 4. Video Config Variables */}
        {VIDEO_CONFIG_VARIABLES.filter((v) =>
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.label.toLowerCase().includes(search.toLowerCase()) ||
          v.description?.toLowerCase().includes(search.toLowerCase())
        ).length > 0 && (
          <div>
            <Collapsible
              open={openSections["Video Config"] ?? false}
              onOpenChange={() => toggleSection("Video Config")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold hover:text-foreground mb-2 transition-colors">
                <span>Video Config (from wizard settings)</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    openSections["Video Config"] ? "transform rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1">
                <p className="text-xs text-muted-foreground mb-2 px-2">
                  These variables are automatically set based on the video duration and scene count configured in the generation wizard.
                </p>
                {VIDEO_CONFIG_VARIABLES.filter((v) =>
                  v.name.toLowerCase().includes(search.toLowerCase()) ||
                  v.label.toLowerCase().includes(search.toLowerCase()) ||
                  v.description?.toLowerCase().includes(search.toLowerCase())
                ).map((variable) => (
                  <button
                    type="button"
                    key={variable.name}
                    onClick={() => onInsert(variable.name)}
                    className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{variable.label}</span>
                      <Badge variant="secondary" className="font-mono text-xs bg-cyan-500/10 text-cyan-600 hover:bg-cyan-500/20 border-cyan-500/20">
                        {`{{${variable.name}}}`}
                      </Badge>
                    </div>
                    {variable.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {variable.description}
                      </p>
                    )}
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* 5. Date & Time Variables */}
        {DATE_VARIABLES.filter((v) =>
          v.name.toLowerCase().includes(search.toLowerCase()) ||
          v.label.toLowerCase().includes(search.toLowerCase()) ||
          v.description?.toLowerCase().includes(search.toLowerCase())
        ).length > 0 && (
          <div>
            <Collapsible
              open={openSections["Date & Time"] ?? false}
              onOpenChange={() => toggleSection("Date & Time")}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full text-sm font-semibold hover:text-foreground mb-2 transition-colors">
                <span>Date & Time (auto-resolved)</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    openSections["Date & Time"] ? "transform rotate-180" : ""
                  }`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1">
                <p className="text-xs text-muted-foreground mb-2 px-2">
                  These variables are automatically resolved to the current date when content is generated.
                </p>
                {DATE_VARIABLES.filter((v) =>
                  v.name.toLowerCase().includes(search.toLowerCase()) ||
                  v.label.toLowerCase().includes(search.toLowerCase()) ||
                  v.description?.toLowerCase().includes(search.toLowerCase())
                ).map((variable) => (
                  <button
                    type="button"
                    key={variable.name}
                    onClick={() => onInsert(variable.name)}
                    className="w-full text-left p-2 rounded-md hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{variable.label}</span>
                      <Badge variant="secondary" className="font-mono text-xs bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-500/20">
                        {`{{${variable.name}}}`}
                      </Badge>
                    </div>
                    {variable.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {variable.description}
                      </p>
                    )}
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t">
        <p className="text-xs text-muted-foreground">
          Click any variable to insert it at your cursor position
        </p>
      </div>
    </Card>
  );
}
