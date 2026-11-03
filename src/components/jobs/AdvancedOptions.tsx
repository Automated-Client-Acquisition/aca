import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronRight, Plus, HelpCircle, X, Check } from "lucide-react";
import { FaInstagram } from "react-icons/fa";
import { usePostCategories } from "@/hooks/usePostCategories";
import { usePostTags } from "@/hooks/usePostTags";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface AdvancedOptionsProps {
  selectedCategory: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  selectedTags: string[];
  onTagsChange: (tagIds: string[]) => void;
  showInstagramOptions: boolean;
  postType: string;
  onPostTypeChange: (type: string) => void;
  hasVideo: boolean;
  hasImage: boolean;
  organizationId?: string;
}

export function AdvancedOptions({
  selectedCategory,
  onCategoryChange,
  selectedTags,
  onTagsChange,
  showInstagramOptions,
  postType,
  onPostTypeChange,
  hasVideo,
  hasImage,
  organizationId,
}: AdvancedOptionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [tagsOpen, setTagsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const { categories, createCategory, isCreating: isCreatingCat } = usePostCategories();
  const { tags, createTag, isCreating: isCreatingTag } = usePostTags();

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim() || !organizationId) return;

    await createCategory.mutateAsync({
      name: newCategoryName.trim(),
      organization_id: organizationId,
    });
    setNewCategoryName("");
    setIsCreatingCategory(false);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim() || !organizationId) return;

    await createTag.mutateAsync({
      name: newTagName.trim(),
      organization_id: organizationId,
    });
    setNewTagName("");
  };

  const handleTagToggle = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      onTagsChange(selectedTags.filter((id) => id !== tagId));
    } else {
      onTagsChange([...selectedTags, tagId]);
    }
  };

  const selectedTagObjects = tags.filter((t) => selectedTags.includes(t.id));

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 py-2 text-sm font-medium hover:text-foreground/80 transition-colors w-full">
        <ChevronRight
          className={cn(
            "h-4 w-4 transition-transform",
            isOpen && "rotate-90"
          )}
        />
        <span>Advanced options</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-4 pl-6">
        {/* Category Selector */}
        <div className="space-y-2">
          <Label className="text-sm">Choose Category</Label>
          <div className="flex gap-2">
            <Select
              value={selectedCategory || ""}
              onValueChange={(value) => onCategoryChange(value || null)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Popover open={isCreatingCategory} onOpenChange={setIsCreatingCategory}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="end">
                <div className="space-y-2">
                  <Label className="text-sm">New Category</Label>
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Category name"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCreateCategory();
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsCreatingCategory(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="cta"
                      size="sm"
                      onClick={handleCreateCategory}
                      disabled={!newCategoryName.trim() || isCreatingCat}
                    >
                      Create
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Tags Selector */}
        <div className="space-y-2">
          <Label className="text-sm">Tags</Label>
          <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start h-auto min-h-[40px] py-2"
              >
                {selectedTagObjects.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {selectedTagObjects.map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="secondary"
                        className="text-xs"
                        style={{ backgroundColor: tag.color || undefined }}
                      >
                        {tag.name}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTagToggle(tag.id);
                          }}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Search tags</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput
                  placeholder="Search tags..."
                  value={newTagName}
                  onValueChange={setNewTagName}
                />
                <CommandList>
                  <CommandEmpty>
                    {newTagName && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={handleCreateTag}
                        disabled={isCreatingTag}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create "{newTagName}"
                      </Button>
                    )}
                    {!newTagName && "No tags found"}
                  </CommandEmpty>
                  <CommandGroup>
                    {tags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={() => handleTagToggle(tag.id)}
                      >
                        <div
                          className={cn(
                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                            selectedTags.includes(tag.id)
                              ? "bg-primary text-primary-foreground"
                              : "opacity-50"
                          )}
                        >
                          {selectedTags.includes(tag.id) && (
                            <Check className="h-3 w-3" />
                          )}
                        </div>
                        <span>{tag.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Instagram Options */}
        {showInstagramOptions && (
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex items-center gap-2 py-2 text-sm font-medium hover:text-foreground/80 transition-colors w-full">
              <ChevronRight className="h-4 w-4" />
              <FaInstagram className="h-4 w-4 text-[#E4405F]" />
              <span>Instagram options</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 pl-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Post this as</Label>
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">
                          <strong>Feed:</strong> Standard post in your feed<br />
                          <strong>Reel:</strong> Short-form video (requires video)<br />
                          <strong>Story:</strong> 24-hour temporary post (requires image)
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <RadioGroup
                  value={postType}
                  onValueChange={onPostTypeChange}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="feed" id="feed" />
                    <Label htmlFor="feed" className="text-sm font-normal cursor-pointer">
                      Feed
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="reel"
                      id="reel"
                      disabled={!hasVideo}
                    />
                    <Label
                      htmlFor="reel"
                      className={cn(
                        "text-sm font-normal cursor-pointer",
                        !hasVideo && "text-muted-foreground"
                      )}
                    >
                      Reel
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="story"
                      id="story"
                      disabled={!hasImage}
                    />
                    <Label
                      htmlFor="story"
                      className={cn(
                        "text-sm font-normal cursor-pointer",
                        !hasImage && "text-muted-foreground"
                      )}
                    >
                      Story
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
