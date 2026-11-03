import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { Skill } from "@/hooks/useSkills";
import { useUpdateSkill, useDeleteSkill } from "@/hooks/useSkills";
import { useAuth } from "@/contexts/AuthContext";
import { getSkillInstallCommand, slugify } from "@/lib/skillUtils";
import { Copy, Check, Trash2, Globe, Lock } from "lucide-react";
import { toast } from "sonner";

interface SkillDetailsDialogProps {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SkillDetailsDialog({ skill, open, onOpenChange }: SkillDetailsDialogProps) {
  const { currentOrganization } = useAuth();
  const [copied, setCopied] = useState(false);
  const { mutate: updateSkill, isPending: isUpdating } = useUpdateSkill();
  const { mutate: deleteSkill, isPending: isDeleting } = useDeleteSkill();

  if (!skill) return null;

  const orgSlug = slugify(currentOrganization?.name ?? "org");
  const installCmd = getSkillInstallCommand(orgSlug, skill.slug);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(installCmd);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTogglePublic = () => {
    updateSkill({ id: skill.id, is_public: !skill.is_public });
  };

  const handleDelete = () => {
    deleteSkill(skill.id, {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>{skill.name}</DialogTitle>
              {skill.description && (
                <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
              )}
            </div>
            <Badge variant={skill.is_public ? "default" : "outline"} className="flex-shrink-0">
              {skill.is_public ? (
                <><Globe className="h-3 w-3 mr-1" />Public</>
              ) : (
                <><Lock className="h-3 w-3 mr-1" />Private</>
              )}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Install command</Label>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg font-mono text-sm">
              <span className="flex-1 truncate">{installCmd}</span>
              <Button size="sm" variant="ghost" onClick={handleCopy} className="flex-shrink-0">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {skill.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skill.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium">Content preview</Label>
            <pre className="p-3 bg-muted rounded-lg text-xs font-mono overflow-auto max-h-[200px] whitespace-pre-wrap">
              {skill.content.slice(0, 1000)}{skill.content.length > 1000 ? "\n\n... (truncated)" : ""}
            </pre>
          </div>

          <div className="flex items-center gap-3 p-3 border rounded-lg">
            <Switch
              id="details-public"
              checked={skill.is_public}
              onCheckedChange={handleTogglePublic}
              disabled={isUpdating}
            />
            <div>
              <Label htmlFor="details-public" className="cursor-pointer font-medium">
                Public skill
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                {skill.install_count} installs
              </p>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
