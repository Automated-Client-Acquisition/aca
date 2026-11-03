import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { VariablesList } from "@/components/VariablesList";
import { PromptTemplateSelector } from "@/components/blueprints/PromptTemplateSelector";
import { CreatePromptTemplateDialog } from "@/components/blueprints/CreatePromptTemplateDialog";
import type { PromptType } from "@/hooks/usePromptTemplates";
import type { PipelineId } from "@/types/pipeline";

const PIPELINE_PLACEHOLDERS: Partial<Record<PipelineId, string>> = {
  rich_article: `Write a blog post / newsletter / thread about {{topic}}...

Define structure, tone, audience, and key points.`,
  social_media_post: `Write a {{platform}} post about {{topic}}...

Include hook, body, takeaway, and CTA.`,
  instagram_carousel: `Create an Instagram carousel about {{topic}}...

Define narrative arc, visual direction, and slide structure.`,
  storyboard_video_longform: `Create a {{video_duration_minutes}}-minute video about {{topic}}...

Define narrative structure, character, visual style, and voiceover direction.`,
  generative_video_oneshot: `Create a cinematic video about {{topic}}...

Describe scene, visual style, camera movement, and mood.`,
  video_script: `Write a video script about {{topic}}...

Include character, speaking style, scene directions, and talking points.`,
  image_only: `Detailed image prompt for {{topic}}...

Specify style, colors, composition, lighting, and quality.`,
};

interface PromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  promptType?: PromptType;
  pipeline?: PipelineId;
}

export function PromptEditor({ value, onChange, placeholder, promptType = 'text', pipeline }: PromptEditorProps) {
  const [localValue, setLocalValue] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync external value to local state
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounced update to parent component
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [localValue, onChange, value]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(e.target.value);
  };

  const handleVariableInsert = (variableName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const textBefore = localValue.substring(0, start);
    const textAfter = localValue.substring(end);
    const variableText = `{{${variableName}}}`;

    const newValue = textBefore + variableText + textAfter;
    const newCursorPos = start + variableText.length;

    setLocalValue(newValue);

    // Focus and set cursor position after state update
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const resolvedPlaceholder = placeholder || (pipeline && PIPELINE_PLACEHOLDERS[pipeline]) || `Enter your prompt template. Use {{variable_name}} for dynamic values.

Example:
Create a {{content_type}} about {{topic}} using the {{brand_voice}} tone.`;

  return (
    <div className="grid grid-cols-[1fr,400px] gap-6">
      {/* Left Column - Prompt Editor */}
      <div className="space-y-2">
        <div className="flex justify-end gap-2">
          <PromptTemplateSelector
            onSelect={(prompt) => {
              setLocalValue(prompt);
              onChange(prompt);
            }}
            promptType={promptType}
            pipelineType={pipeline}
          />
          <CreatePromptTemplateDialog promptType={promptType} />
        </div>

        <Textarea
          ref={textareaRef}
          id="prompt"
          name="prompt"
          autoComplete="off"
          placeholder={resolvedPlaceholder}
          value={localValue}
          onChange={handleTextareaChange}
          className="min-h-[400px] font-mono resize-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <p className="text-sm text-muted-foreground">
          Use double curly braces to define variables:{" "}
          <code className="bg-muted px-1 rounded">{"{{variable_name}}"}</code>
        </p>
      </div>

      {/* Right Column - Variables List */}
      <div className="h-[400px]">
        <VariablesList onInsert={handleVariableInsert} pipeline={pipeline} />
      </div>
    </div>
  );
}
