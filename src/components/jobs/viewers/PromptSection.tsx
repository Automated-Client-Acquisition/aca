import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Edit2, Check, X, Copy, Sparkles, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PromptSectionProps {
  masterPrompt?: string;
  imagePrompt?: string;
  onUpdateMasterPrompt?: (newPrompt: string) => void;
  onUpdateImagePrompt?: (newPrompt: string) => void;
  isEditable?: boolean;
  className?: string;
}

export function PromptSection({
  masterPrompt,
  imagePrompt,
  onUpdateMasterPrompt,
  onUpdateImagePrompt,
  isEditable = true,
  className,
}: PromptSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingMaster, setEditingMaster] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [editedMasterPrompt, setEditedMasterPrompt] = useState(masterPrompt || "");
  const [editedImagePrompt, setEditedImagePrompt] = useState(imagePrompt || "");

  const hasPrompts = masterPrompt || imagePrompt;

  if (!hasPrompts) return null;

  const handleCopy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const handleSaveMaster = () => {
    onUpdateMasterPrompt?.(editedMasterPrompt);
    setEditingMaster(false);
    toast.success("Master prompt updated");
  };

  const handleSaveImage = () => {
    onUpdateImagePrompt?.(editedImagePrompt);
    setEditingImage(false);
    toast.success("Image prompt updated");
  };

  const handleCancelMaster = () => {
    setEditedMasterPrompt(masterPrompt || "");
    setEditingMaster(false);
  };

  const handleCancelImage = () => {
    setEditedImagePrompt(imagePrompt || "");
    setEditingImage(false);
  };

  const promptCount = [masterPrompt, imagePrompt].filter(Boolean).length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between h-auto py-2 px-3 hover:bg-muted/50"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">Generation Prompts</span>
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {promptCount}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent className="px-3 pb-3 space-y-3">
        {/* Master Prompt */}
        {masterPrompt && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-blue-500" />
                <span className="text-xs font-medium text-muted-foreground">Master Prompt</span>
              </div>
              <div className="flex items-center gap-1">
                {editingMaster ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleCancelMaster}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleSaveMaster}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Save
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleCopy(masterPrompt, "Master prompt")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    {isEditable && onUpdateMasterPrompt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          setEditedMasterPrompt(masterPrompt);
                          setEditingMaster(true);
                        }}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {editingMaster ? (
              <Textarea
                value={editedMasterPrompt}
                onChange={(e) => setEditedMasterPrompt(e.target.value)}
                className="min-h-[120px] text-xs font-mono resize-y"
                placeholder="Enter master prompt..."
              />
            ) : (
              <div className="bg-muted/30 rounded-md p-2.5 text-xs text-muted-foreground font-mono max-h-[150px] overflow-y-auto whitespace-pre-wrap">
                {masterPrompt}
              </div>
            )}
          </div>
        )}

        {/* Image Prompt */}
        {imagePrompt && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <ImageIcon className="h-3 w-3 text-pink-500" />
                <span className="text-xs font-medium text-muted-foreground">Image Prompt</span>
              </div>
              <div className="flex items-center gap-1">
                {editingImage ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleCancelImage}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={handleSaveImage}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Save
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => handleCopy(imagePrompt, "Image prompt")}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    {isEditable && onUpdateImagePrompt && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => {
                          setEditedImagePrompt(imagePrompt);
                          setEditingImage(true);
                        }}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
            {editingImage ? (
              <Textarea
                value={editedImagePrompt}
                onChange={(e) => setEditedImagePrompt(e.target.value)}
                className="min-h-[120px] text-xs font-mono resize-y"
                placeholder="Enter image prompt..."
              />
            ) : (
              <div className="bg-muted/30 rounded-md p-2.5 text-xs text-muted-foreground font-mono max-h-[150px] overflow-y-auto whitespace-pre-wrap">
                {imagePrompt}
              </div>
            )}
          </div>
        )}

        {isEditable && (onUpdateMasterPrompt || onUpdateImagePrompt) && (
          <p className="text-[10px] text-muted-foreground pt-1">
            Edit prompts to customize regeneration. Changes will be used when regenerating content.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
