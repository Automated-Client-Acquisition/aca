import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useCreateSkill } from "@/hooks/useSkills";
import { Upload } from "lucide-react";

interface AddSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSkillDialog({ open, onOpenChange }: AddSkillDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mutate: createSkill, isPending } = useCreateSkill();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setContent(text);
      // Auto-fill name from filename if empty
      if (!name) {
        setName(file.name.replace(/\.md$/i, "").replace(/[-_]/g, " "));
      }
    };
    reader.readAsText(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    createSkill(
      { name: name.trim(), description: description.trim() || undefined, content, is_public: isPublic },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setDescription("");
          setContent("");
          setIsPublic(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Skill</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              id="skill-name"
              placeholder="e.g. ACA Campaign Builder"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-description">Description</Label>
            <Input
              id="skill-description"
              placeholder="Brief description of what this skill teaches"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Skill Content (.md)</Label>
            <div className="flex gap-2 mb-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload .md file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                className="hidden"
                onChange={handleFileUpload}
              />
              {content && (
                <span className="text-sm text-muted-foreground self-center">
                  {content.length} chars loaded
                </span>
              )}
            </div>
            <Textarea
              placeholder="Paste your skill Markdown content here, or upload a .md file above..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-sm min-h-[180px]"
              required
            />
          </div>

          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <Switch
              id="skill-public"
              checked={isPublic}
              onCheckedChange={setIsPublic}
            />
            <div>
              <Label htmlFor="skill-public" className="cursor-pointer font-medium">
                Make public
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Public skills can be discovered and installed by the community
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="cta" disabled={isPending || !name.trim() || !content.trim()}>
              {isPending ? "Creating..." : "Create Skill"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
