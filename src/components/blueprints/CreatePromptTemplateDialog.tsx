import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, X, ImageIcon } from "lucide-react";
import { useCreatePromptTemplate } from "@/hooks/useCreatePromptTemplate";
import type { PromptType } from "@/hooks/usePromptTemplates";
import { PIPELINES, type PipelineId } from "@/types/pipeline";

const promptTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  description: z.string().optional(),
  prompt_content: z.string().min(10, "Prompt must be at least 10 characters"),
  category: z.string().optional(),
  pipeline_type: z.string().optional(),
  scenario: z.string().optional(),
  content_types: z.array(z.string()).optional(),
  goals: z.array(z.string()).optional(),
});

type FormData = z.infer<typeof promptTemplateSchema>;

interface CreatePromptTemplateDialogProps {
  promptType?: PromptType;
}

export function CreatePromptTemplateDialog({ promptType = 'text' }: CreatePromptTemplateDialogProps) {
  const [open, setOpen] = useState(false);
  const isImagePrompt = promptType === 'image';
  const isDirectorPrompt = promptType === 'director';
  const [contentTypeInput, setContentTypeInput] = useState("");
  const [goalInput, setGoalInput] = useState("");
  const createMutation = useCreatePromptTemplate();

  const form = useForm<FormData>({
    resolver: zodResolver(promptTemplateSchema),
    defaultValues: {
      name: "",
      description: "",
      prompt_content: "",
      category: "",
      pipeline_type: "",
      scenario: "",
      content_types: [],
      goals: [],
    },
  });

  const parseVariables = (prompt: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = Array.from(prompt.matchAll(regex));
    const uniqueVars = new Set(matches.map(match => match[1].trim()));
    return Array.from(uniqueVars);
  };

  const onSubmit = (data: FormData) => {
    const variables = parseVariables(data.prompt_content);

    createMutation.mutate(
      {
        name: data.name,
        description: data.description || null,
        prompt_content: data.prompt_content,
        category: data.category || null,
        pipeline_type: data.pipeline_type || null,
        scenario: data.scenario || null,
        content_types: data.content_types && data.content_types.length > 0 ? data.content_types : null,
        goals: data.goals && data.goals.length > 0 ? data.goals : null,
        variables: variables.length > 0 ? variables : null,
        prompt_type: promptType,
      },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
        },
      }
    );
  };

  const addContentType = () => {
    if (contentTypeInput.trim()) {
      const current = form.getValues("content_types") || [];
      form.setValue("content_types", [...current, contentTypeInput.trim()]);
      setContentTypeInput("");
    }
  };

  const removeContentType = (index: number) => {
    const current = form.getValues("content_types") || [];
    form.setValue("content_types", current.filter((_, i) => i !== index));
  };

  const addGoal = () => {
    if (goalInput.trim()) {
      const current = form.getValues("goals") || [];
      form.setValue("goals", [...current, goalInput.trim()]);
      setGoalInput("");
    }
  };

  const removeGoal = (index: number) => {
    const current = form.getValues("goals") || [];
    form.setValue("goals", current.filter((_, i) => i !== index));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {isImagePrompt ? <ImageIcon className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {isImagePrompt ? "Save Image Template" : isDirectorPrompt ? "Save Director Template" : "Save Template"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {isImagePrompt ? "Save Image Prompt Template" : isDirectorPrompt ? "Save Director Prompt Template" : "Save Custom Prompt Template"}
          </DialogTitle>
          <DialogDescription>
            {isImagePrompt
              ? "Create a reusable image generation prompt template"
              : isDirectorPrompt
              ? "Save your video director creative direction as a reusable template"
              : "Create a reusable prompt template for future use"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Template Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="My Custom Prompt Template" 
                      autoComplete="off"
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe what this template is used for..."
                      autoComplete="off"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="pipeline_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pipeline Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a pipeline" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PIPELINES.map((pipeline) => (
                          <SelectItem key={pipeline.id} value={pipeline.id}>
                            {pipeline.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Which pipeline is this template for?
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="scenario"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Scenario</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., testimonial, tutorial, listicle"
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Type of content (e.g., testimonial, demo)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category (Legacy)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="hook">Hook</SelectItem>
                      <SelectItem value="framework">Framework</SelectItem>
                      <SelectItem value="angle">Angle</SelectItem>
                      <SelectItem value="structure">Structure</SelectItem>
                      <SelectItem value="tone">Tone</SelectItem>
                      <SelectItem value="cta">CTA</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="prompt_content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isImagePrompt ? "Image Prompt Template" : "Prompt Template"}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={isImagePrompt
                        ? "Enter your image prompt template here. Use {{caption}}, {{character_description}}, {{product_name}} and other variables..."
                        : "Enter your prompt template here. Use {{variable_name}} for dynamic values..."}
                      autoComplete="off"
                      rows={8}
                      className="font-mono"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Variables will be automatically detected from {`{{variable_name}}`} patterns
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Content Types</FormLabel>
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
                  autoComplete="off"
                />
                <Button type="button" onClick={addContentType} variant="outline" size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {form.watch("content_types") && form.watch("content_types")!.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {form.watch("content_types")!.map((type, index) => (
                    <Badge key={index} variant="secondary" className="gap-1">
                      {type}
                      <button
                        type="button"
                        onClick={() => removeContentType(index)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <FormLabel>Goals</FormLabel>
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
                  autoComplete="off"
                />
                <Button type="button" onClick={addGoal} variant="outline" size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {form.watch("goals") && form.watch("goals")!.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {form.watch("goals")!.map((goal, index) => (
                    <Badge key={index} variant="secondary" className="gap-1">
                      {goal}
                      <button
                        type="button"
                        onClick={() => removeGoal(index)}
                        className="ml-1 hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="cta" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Template
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
