import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Plus, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useWordPressTaxonomies, useDefaultWordPressSite } from "@/hooks/useWordPressTaxonomies";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ArticleMetadata {
  excerpt: string;
  categories: string[];
  tags: string[];
  featured_image_alt: string;
  author: string;
}

interface ArticleMetadataEditorProps {
  metadata: ArticleMetadata;
  onUpdate: (updates: Partial<ArticleMetadata>) => void;
  wordCount?: number;
  readingTime?: number;
}

export function ArticleMetadataEditor({
  metadata,
  onUpdate,
  wordCount = 0,
  readingTime = 0,
}: ArticleMetadataEditorProps) {
  const { excerpt, categories, tags, featured_image_alt, author } = metadata;
  const { user, currentOrganization } = useAuth();
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  // Use currentOrganization from AuthContext - it already respects impersonation
  const organizationId = currentOrganization?.id || null;

  // Get default WordPress site for the organization
  const { data: wpSite } = useDefaultWordPressSite(organizationId);

  // Fetch WordPress taxonomies
  const { data: taxonomies, isLoading: isLoadingTaxonomies } = useWordPressTaxonomies(wpSite?.id || null);

  const hasWordPress = !!wpSite && !!taxonomies;

  // Filter available categories (not already selected)
  const availableCategories = useMemo(() => {
    if (!taxonomies?.categories) return [];
    return taxonomies.categories.filter(c => !categories.includes(c.name));
  }, [taxonomies?.categories, categories]);

  // Filter available tags (not already selected)
  const availableTags = useMemo(() => {
    if (!taxonomies?.tags) return [];
    return taxonomies.tags.filter(t => !tags.includes(t.name));
  }, [taxonomies?.tags, tags]);

  const handleSelectCategory = (categoryName: string) => {
    if (!categories.includes(categoryName)) {
      onUpdate({ categories: [...categories, categoryName] });
    }
    setCategoryPopoverOpen(false);
  };

  const handleRemoveCategory = (categoryToRemove: string) => {
    onUpdate({ categories: categories.filter((c) => c !== categoryToRemove) });
  };

  const handleSelectTag = (tagName: string) => {
    if (!tags.includes(tagName)) {
      onUpdate({ tags: [...tags, tagName] });
    }
    setTagPopoverOpen(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdate({ tags: tags.filter((t) => t !== tagToRemove) });
  };

  return (
    <div className="space-y-6">
      {/* Article Stats */}
      <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg">
        <div className="text-sm">
          <span className="font-medium">{wordCount.toLocaleString()}</span>{" "}
          <span className="text-muted-foreground">words</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="text-sm">
          <span className="font-medium">{readingTime}</span>{" "}
          <span className="text-muted-foreground">min read</span>
        </div>
      </div>

      {/* Excerpt */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="excerpt">Excerpt / Summary</Label>
          <span className="text-xs text-muted-foreground">
            {excerpt?.length || 0}/300
          </span>
        </div>
        <Textarea
          id="excerpt"
          value={excerpt || ""}
          onChange={(e) => onUpdate({ excerpt: e.target.value })}
          placeholder="Write a brief summary of the article (used for previews and RSS feeds)"
          rows={3}
          maxLength={300}
        />
        <p className="text-xs text-muted-foreground">
          A short summary shown in article listings and social shares
        </p>
      </div>

      {/* WordPress Categories - Only show if WordPress is connected */}
      {hasWordPress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Categories</Label>
            <span className="text-xs text-muted-foreground">
              from {taxonomies.site_name}
            </span>
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {categories.map((category) => (
              <Badge
                key={category}
                variant="secondary"
                className="px-2 py-1 gap-1"
              >
                {category}
                <button
                  onClick={() => handleRemoveCategory(category)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {categories.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No categories selected
              </span>
            )}
          </div>
          <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={categoryPopoverOpen}
                className="w-full justify-between"
                disabled={isLoadingTaxonomies}
              >
                {isLoadingTaxonomies ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading categories...
                  </>
                ) : (
                  <>
                    Select a category...
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0">
              <Command>
                <CommandInput placeholder="Search categories..." />
                <CommandList>
                  <CommandEmpty>No categories found.</CommandEmpty>
                  <CommandGroup>
                    {availableCategories.map((category) => (
                      <CommandItem
                        key={category.id}
                        value={category.name}
                        onSelect={(currentValue) => {
                          // Find the category by lowercase match since CommandItem lowercases the value
                          const selectedCategory = availableCategories.find(
                            c => c.name.toLowerCase() === currentValue.toLowerCase()
                          );
                          if (selectedCategory) {
                            handleSelectCategory(selectedCategory.name);
                          }
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            categories.includes(category.name) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span>{category.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {category.count} posts
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* WordPress Tags - Only show if WordPress is connected */}
      {hasWordPress && (
        <div className="space-y-2">
          <Label>Tags</Label>
          <div className="flex flex-wrap gap-2 mb-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="px-2 py-1 gap-1">
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {tags.length === 0 && (
              <span className="text-sm text-muted-foreground">No tags selected</span>
            )}
          </div>
          <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={tagPopoverOpen}
                className="w-full justify-between"
                disabled={isLoadingTaxonomies}
              >
                {isLoadingTaxonomies ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading tags...
                  </>
                ) : (
                  <>
                    Select a tag...
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0">
              <Command>
                <CommandInput placeholder="Search tags..." />
                <CommandList>
                  <CommandEmpty>No tags found.</CommandEmpty>
                  <CommandGroup>
                    {availableTags.map((tag) => (
                      <CommandItem
                        key={tag.id}
                        value={tag.name}
                        onSelect={(currentValue) => {
                          // Find the tag by lowercase match since CommandItem lowercases the value
                          const selectedTag = availableTags.find(
                            t => t.name.toLowerCase() === currentValue.toLowerCase()
                          );
                          if (selectedTag) {
                            handleSelectTag(selectedTag.name);
                          }
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            tags.includes(tag.name) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span>{tag.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {tag.count} posts
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Featured Image Alt Text */}
      <div className="space-y-2">
        <Label htmlFor="featured-image-alt">Featured Image Alt Text</Label>
        <Input
          id="featured-image-alt"
          value={featured_image_alt || ""}
          onChange={(e) => onUpdate({ featured_image_alt: e.target.value })}
          placeholder="Describe the featured image for accessibility"
        />
        <p className="text-xs text-muted-foreground">
          Improves accessibility and SEO for the featured image
        </p>
      </div>

      {/* Author */}
      <div className="space-y-2">
        <Label htmlFor="author">Author</Label>
        <Input
          id="author"
          value={author || ""}
          onChange={(e) => onUpdate({ author: e.target.value })}
          placeholder="Article author name"
        />
      </div>
    </div>
  );
}
