import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Mic,
  Users,
  Target,
  Package,
  Blocks,
  Lightbulb,
  Check,
  Loader2,
  ChevronRight,
  Zap,
  Gift
} from "lucide-react";
import {
  starterBrandVoices,
  starterCharacters,
  starterICPs,
  starterProducts,
  starterBlocks,
  starterIdeas,
  getStarterPackCounts,
  type StarterBrandVoice,
  type StarterCharacter,
  type StarterICP,
  type StarterProduct,
  type StarterBlock,
  type StarterIdea,
} from "@/data/starterPack";
import { useStarterPackImport } from "@/hooks/useStarterPackImport";
import { cn } from "@/lib/utils";

interface StarterPackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SelectionState = {
  brandVoices: Set<string>;
  characters: Set<string>;
  icps: Set<string>;
  products: Set<string>;
  blocks: Set<string>;
  ideas: Set<string>;
};

type CategoryKey = keyof SelectionState;

const categories: {
  key: CategoryKey;
  label: string;
  icon: typeof Mic;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}[] = [
  {
    key: "brandVoices",
    label: "Brand Voices",
    icon: Mic,
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/30",
    description: "Tone & style templates"
  },
  {
    key: "characters",
    label: "Characters",
    icon: Users,
    color: "text-blue-600",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    description: "UGC & video personas"
  },
  {
    key: "icps",
    label: "Target Audiences",
    icon: Target,
    color: "text-green-600",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    description: "Buyer personas"
  },
  {
    key: "products",
    label: "Product Templates",
    icon: Package,
    color: "text-orange-600",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    description: "Offer structures"
  },
  {
    key: "blocks",
    label: "Copy Blocks",
    icon: Blocks,
    color: "text-pink-600",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
    description: "Hooks, CTAs, angles"
  },
  {
    key: "ideas",
    label: "Content Ideas",
    icon: Lightbulb,
    color: "text-yellow-600",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    description: "Templates that trigger AI generation"
  },
];

export function StarterPackDialog({ open, onOpenChange }: StarterPackDialogProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);
  const [selection, setSelection] = useState<SelectionState>({
    brandVoices: new Set(),
    characters: new Set(),
    icps: new Set(),
    products: new Set(),
    blocks: new Set(),
    ideas: new Set(),
  });

  const { importItems, isImporting } = useStarterPackImport();
  const counts = getStarterPackCounts();

  const totalSelected = useMemo(() => {
    return (
      selection.brandVoices.size +
      selection.characters.size +
      selection.icps.size +
      selection.products.size +
      selection.blocks.size +
      selection.ideas.size
    );
  }, [selection]);

  const toggleItem = (category: CategoryKey, id: string) => {
    setSelection((prev) => {
      const newSet = new Set(prev[category]);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { ...prev, [category]: newSet };
    });
  };

  const selectAllInCategory = (category: CategoryKey) => {
    const items = getItemsForCategory(category);
    setSelection((prev) => ({
      ...prev,
      [category]: new Set(items.map((item) => item.id)),
    }));
  };

  const deselectAllInCategory = (category: CategoryKey) => {
    setSelection((prev) => ({
      ...prev,
      [category]: new Set(),
    }));
  };

  const selectAll = () => {
    setSelection({
      brandVoices: new Set(starterBrandVoices.map((v) => v.id)),
      characters: new Set(starterCharacters.map((c) => c.id)),
      icps: new Set(starterICPs.map((i) => i.id)),
      products: new Set(starterProducts.map((p) => p.id)),
      blocks: new Set(starterBlocks.map((b) => b.id)),
      ideas: new Set(starterIdeas.map((i) => i.id)),
    });
  };

  const deselectAll = () => {
    setSelection({
      brandVoices: new Set(),
      characters: new Set(),
      icps: new Set(),
      products: new Set(),
      blocks: new Set(),
      ideas: new Set(),
    });
  };

  const allSelected = totalSelected === counts.total;

  const handleImport = async () => {
    await importItems({
      brandVoices: starterBrandVoices.filter((v) => selection.brandVoices.has(v.id)),
      characters: starterCharacters.filter((c) => selection.characters.has(c.id)),
      icps: starterICPs.filter((i) => selection.icps.has(i.id)),
      products: starterProducts.filter((p) => selection.products.has(p.id)),
      blocks: starterBlocks.filter((b) => selection.blocks.has(b.id)),
      ideas: starterIdeas.filter((i) => selection.ideas.has(i.id)),
    });
    onOpenChange(false);
    setSelection({
      brandVoices: new Set(),
      characters: new Set(),
      icps: new Set(),
      products: new Set(),
      blocks: new Set(),
      ideas: new Set(),
    });
    setActiveCategory(null);
  };

  const getItemsForCategory = (category: CategoryKey) => {
    switch (category) {
      case "brandVoices": return starterBrandVoices;
      case "characters": return starterCharacters;
      case "icps": return starterICPs;
      case "products": return starterProducts;
      case "blocks": return starterBlocks;
      case "ideas": return starterIdeas;
    }
  };

  const getCategoryCount = (category: CategoryKey) => {
    switch (category) {
      case "brandVoices": return counts.brandVoices;
      case "characters": return counts.characters;
      case "icps": return counts.icps;
      case "products": return counts.products;
      case "blocks": return counts.blocks;
      case "ideas": return counts.ideas;
    }
  };

  // Render the main category grid or the detail view
  if (activeCategory) {
    const cat = categories.find((c) => c.key === activeCategory)!;
    const items = getItemsForCategory(activeCategory);
    const selected = selection[activeCategory];
    const allSelected = selected.size === items.length;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl flex flex-col max-h-[85vh] overflow-hidden p-0">
          {/* Header with gradient */}
          <div className={cn("shrink-0 px-6 pt-6 pb-4", cat.bgColor)}>
            <button
              onClick={() => setActiveCategory(null)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              Back to categories
            </button>
            <div className="flex items-center gap-4">
              <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", cat.bgColor, "border-2", cat.borderColor)}>
                <cat.icon className={cn("w-6 h-6", cat.color)} />
              </div>
              <div>
                <DialogTitle className="text-xl">{cat.label}</DialogTitle>
                <DialogDescription className="mt-0.5">
                  {items.length} templates available
                </DialogDescription>
              </div>
            </div>
            {activeCategory === "ideas" && (
              <div className="mt-3 p-2.5 rounded-lg bg-yellow-500/20 border border-yellow-500/30">
                <p className="text-xs text-yellow-700 dark:text-yellow-300">
                  <Sparkles className="w-3.5 h-3.5 inline mr-1.5" />
                  Imported ideas will trigger AI generation to create hooks, CTAs, and content frameworks
                </p>
              </div>
            )}
          </div>

          {/* Selection controls */}
          <div className="shrink-0 px-6 py-3 border-b flex items-center justify-between bg-muted/30">
            <span className="text-sm font-medium">
              {selected.size} of {items.length} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => allSelected ? deselectAllInCategory(activeCategory) : selectAllInCategory(activeCategory)}
              >
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
            </div>
          </div>

          {/* Items list - grouped by subcategory */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="p-4 space-y-6">
              <GroupedItemsList
                category={activeCategory}
                items={items}
                selected={selected}
                onToggle={(id) => toggleItem(activeCategory, id)}
                categoryColor={cat.color}
                categoryBorderColor={cat.borderColor}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {totalSelected} total items selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setActiveCategory(null)}>
                Back
              </Button>
              <Button
                variant="cta"
                onClick={handleImport}
                disabled={totalSelected === 0 || isImporting}
                className="min-w-[140px]"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Import ({totalSelected})
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Main category selection view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        {/* Hero header */}
        <div className="relative shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <div className="absolute top-4 right-4">
            <Badge className="bg-gradient-aca text-white border-0 gap-1">
              <Gift className="w-3 h-3" />
              {counts.total} Templates
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-aca flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Starter Pack</DialogTitle>
              <DialogDescription className="mt-0.5">
                Import battle-tested templates for instant productivity.
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Quick import all */}
        <div className="shrink-0 px-6 py-2 border-b bg-muted/30">
          <button
            onClick={allSelected ? deselectAll : selectAll}
            className={cn(
              "w-full flex items-center justify-between p-2.5 rounded-lg border-2 border-dashed transition-all group",
              allSelected
                ? "border-primary bg-primary/10 hover:bg-primary/5"
                : "border-primary/30 hover:border-primary/50 hover:bg-primary/5"
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center",
                allSelected ? "bg-primary" : "bg-gradient-aca"
              )}>
                {allSelected ? <Check className="w-4 h-4 text-white" /> : <Zap className="w-4 h-4 text-white" />}
              </div>
              <div className="text-left">
                <p className="font-semibold text-sm">{allSelected ? "Deselect All" : "Import Everything"}</p>
                <p className="text-xs text-muted-foreground">
                  {allSelected ? `${counts.total} templates selected` : `All ${counts.total} templates in one click`}
                </p>
              </div>
            </div>
            {!allSelected && (
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
            )}
          </button>
        </div>

        {/* Category cards */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="px-6 py-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Or choose by category:</p>
            <div className="space-y-1.5">
            {categories.map((cat) => {
              const count = getCategoryCount(cat.key);
              const selectedCount = selection[cat.key].size;

              return (
                <Card
                  key={cat.key}
                  className={cn(
                    "cursor-pointer transition-all hover:shadow-md group",
                    "border hover:border-primary/30",
                    selectedCount > 0 && "border-primary/50 bg-primary/5"
                  )}
                  onClick={() => setActiveCategory(cat.key)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                        cat.bgColor,
                        "border",
                        cat.borderColor
                      )}>
                        <cat.icon className={cn("w-4 h-4", cat.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-sm">{cat.label}</h3>
                          <Badge variant="secondary" className="text-xs h-5">
                            {count}
                          </Badge>
                          {selectedCount > 0 && (
                            <Badge className={cn("text-xs h-5", cat.bgColor, cat.color, "border", cat.borderColor)}>
                              {selectedCount} selected
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{cat.description}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-3 border-t bg-muted/30 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {totalSelected > 0 ? `${totalSelected} items selected` : "Select templates to import"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleImport}
              disabled={totalSelected === 0 || isImporting}
              className="min-w-[140px]"
            >
              {isImporting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Import ({totalSelected})
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Grouped items list component
interface GroupedItemsListProps {
  category: CategoryKey;
  items: (StarterBrandVoice | StarterCharacter | StarterICP | StarterProduct | StarterBlock | StarterIdea)[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  categoryColor: string;
  categoryBorderColor: string;
}

function GroupedItemsList({ category, items, selected, onToggle, categoryColor, categoryBorderColor }: GroupedItemsListProps) {
  // Group items by subcategory if applicable
  const groupedItems = useMemo(() => {
    if (category === "blocks") {
      const groups: Record<string, StarterBlock[]> = {};
      (items as StarterBlock[]).forEach((item) => {
        const type = item.block_type;
        if (!groups[type]) groups[type] = [];
        groups[type].push(item);
      });
      return groups;
    }
    if (category === "ideas") {
      const groups: Record<string, StarterIdea[]> = {};
      (items as StarterIdea[]).forEach((item) => {
        const cat = item.category;
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(item);
      });
      return groups;
    }
    return { "All": items };
  }, [category, items]);

  const groupLabels: Record<string, string> = {
    hook: "Hooks",
    angle: "Angles",
    cta: "CTAs",
    story_element: "Story Elements",
    visual_style: "Visual Styles",
  };

  return (
    <>
      {Object.entries(groupedItems).map(([group, groupItems]) => (
        <div key={group}>
          {group !== "All" && (
            <h3 className="text-sm font-medium text-muted-foreground mb-2 capitalize">
              {groupLabels[group] || group}
            </h3>
          )}
          <div className="space-y-2">
            {groupItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                category={category}
                isSelected={selected.has(item.id)}
                onToggle={() => onToggle(item.id)}
                categoryColor={categoryColor}
                categoryBorderColor={categoryBorderColor}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// Individual item card component
interface ItemCardProps {
  item: StarterBrandVoice | StarterCharacter | StarterICP | StarterProduct | StarterBlock | StarterIdea;
  category: CategoryKey;
  isSelected: boolean;
  onToggle: () => void;
  categoryColor: string;
  categoryBorderColor: string;
}

function ItemCard({ item, category, isSelected, onToggle, categoryColor, categoryBorderColor }: ItemCardProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all",
        isSelected
          ? cn("border-primary bg-primary/5 shadow-sm")
          : "border-border hover:border-primary/30 hover:bg-muted/50"
      )}
      onClick={onToggle}
    >
      <Checkbox
        checked={isSelected}
        className="mt-0.5"
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={onToggle}
      />
      <div className="flex-1 min-w-0">
        {category === "brandVoices" && <BrandVoiceContent item={item as StarterBrandVoice} />}
        {category === "characters" && <CharacterContent item={item as StarterCharacter} />}
        {category === "icps" && <ICPContent item={item as StarterICP} />}
        {category === "products" && <ProductContent item={item as StarterProduct} />}
        {category === "blocks" && <BlockContent item={item as StarterBlock} />}
        {category === "ideas" && <IdeaContent item={item as StarterIdea} />}
      </div>
      {isSelected && (
        <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
          <Check className="w-4 h-4 text-white" />
        </div>
      )}
    </div>
  );
}

// Content renderers for each type
function BrandVoiceContent({ item }: { item: StarterBrandVoice }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold">{item.name}</span>
        <Badge variant="outline" className="text-xs capitalize bg-primary/10 text-primary border-primary/30">
          {item.visual_template}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {item.mood_keywords.slice(0, 4).map((keyword) => (
          <Badge key={keyword} variant="secondary" className="text-xs font-normal">
            {keyword}
          </Badge>
        ))}
      </div>
    </>
  );
}

function CharacterContent({ item }: { item: StarterCharacter }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold">{item.name}</span>
        <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">
          {item.gender} • {item.age_range}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {item.tags.slice(0, 4).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs font-normal">
            {tag}
          </Badge>
        ))}
      </div>
    </>
  );
}

function ICPContent({ item }: { item: StarterICP }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold">{item.name}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">{item.description}</p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {item.tags.slice(0, 4).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs font-normal">
            {tag}
          </Badge>
        ))}
      </div>
    </>
  );
}

function ProductContent({ item }: { item: StarterProduct }) {
  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold">{item.name}</span>
        <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/30">
          {item.category}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
    </>
  );
}

function BlockContent({ item }: { item: StarterBlock }) {
  const typeStyles: Record<string, string> = {
    hook: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    angle: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    cta: "bg-green-500/10 text-green-600 border-green-500/30",
    story_element: "bg-primary/10 text-primary border-primary/30",
    visual_style: "bg-pink-500/10 text-pink-600 border-pink-500/30",
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold">{item.name}</span>
        <Badge variant="outline" className={cn("text-xs capitalize", typeStyles[item.block_type])}>
          {item.block_type.replace("_", " ")}
        </Badge>
      </div>
      <div className="mt-2 p-2.5 rounded-lg bg-muted/50 border">
        <p className="text-sm font-mono text-muted-foreground leading-relaxed line-clamp-2">
          {item.content}
        </p>
      </div>
    </>
  );
}

function IdeaContent({ item }: { item: StarterIdea }) {
  const categoryStyles: Record<string, string> = {
    "Authority Building": "bg-primary/10 text-primary border-primary/30",
    "Social Proof": "bg-green-500/10 text-green-600 border-green-500/30",
    "Product Launch": "bg-blue-500/10 text-blue-600 border-blue-500/30",
    "Objection Handling": "bg-orange-500/10 text-orange-600 border-orange-500/30",
    "Education": "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
    "Engagement": "bg-pink-500/10 text-pink-600 border-pink-500/30",
    "Storytelling": "bg-primary/10 text-primary border-primary/30",
    "Urgency": "bg-red-500/10 text-red-600 border-red-500/30",
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <Badge variant="outline" className={cn("text-xs", categoryStyles[item.category] || "bg-yellow-500/10 text-yellow-600 border-yellow-500/30")}>
          {item.category}
        </Badge>
      </div>
      <div className="mt-1 p-2.5 rounded-lg bg-muted/50 border">
        <p className="text-sm text-foreground leading-relaxed">
          {item.title}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {item.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs font-normal">
            {tag}
          </Badge>
        ))}
      </div>
    </>
  );
}
