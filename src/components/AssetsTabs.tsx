import { Mic, User, ShoppingBag, Users, Boxes, FileText, BookOpen, Plus, Image as ImageIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

interface AssetTab {
  id: string;
  label: string;
  icon: React.ElementType;
  /** What actually reads this, so nobody fills in something nothing uses. */
  usedFor: string;
  addLabel: string;
}

// Used in every run (the four Brand Kit defaults).
const CORE_TABS: AssetTab[] = [
  {
    id: "brands",
    label: "Brand voices",
    icon: Mic,
    usedFor:
      "How your writing sounds: tone, style rules and banned words. Every blueprint run, autopilot and AI idea uses one. A brand voice isn't a person: for a face and voice in images or video, add a Person.",
    addLabel: "Add brand voice",
  },
  {
    id: "icps",
    label: "Audiences",
    icon: Users,
    usedFor:
      "Who you write for: their pains, goals and the words they use. Runs and AI ideas write for one, and Research scores posts against them.",
    addLabel: "Add audience",
  },
  {
    id: "products",
    label: "Products",
    icon: ShoppingBag,
    usedFor: "What you sell: what it does and its key benefits. Blueprints mention it when it's relevant to the topic.",
    addLabel: "Add product",
  },
  {
    id: "characters",
    label: "People",
    icon: User,
    usedFor: "A real or made-up person whose face and voice appear in images and video. Only blueprints that show a person use one.",
    addLabel: "Add person",
  },
];

// Optional building blocks, each used by specific features only.
const EXTRA_TABS: AssetTab[] = [
  {
    id: "blocks",
    label: "Hooks & CTAs",
    icon: Boxes,
    usedFor: "Reusable hooks, angles, CTAs and story pieces that a blueprint's prompt can pull in.",
    addLabel: "Add hook or CTA",
  },
  {
    id: "images",
    label: "Images",
    icon: ImageIcon,
    usedFor: "Reference pictures: faces, products and styles. Blueprints use them as references and looks. Save one from any post in Research.",
    addLabel: "Add images",
  },
  {
    id: "knowledge",
    label: "Knowledge base",
    icon: BookOpen,
    usedFor:
      "Documents the AI reads when it generates ideas, writes email sequences and drafts replies to messages. Blueprint runs don't read them.",
    addLabel: "Upload document",
  },
  {
    id: "strategies",
    label: "Strategies",
    icon: FileText,
    usedFor: "Strategy documents from your playbook. Used by playbooks and onboarding emails, not by blueprint runs.",
    addLabel: "Add strategy",
  },
];

const ASSET_TABS = [...CORE_TABS, ...EXTRA_TABS];

interface AssetsTabsProps {
  children?: React.ReactNode;
  onTabChange?: (tab: string) => void;
  defaultTab?: string;
  /** Controlled active tab; omit to let the tabs manage themselves. */
  value?: string;
  /** Adds one of the open tab's kind; the button sits next to what the tab is for. */
  onAdd?: () => void;
}

const triggerClass =
  "flex items-center gap-2 px-3 py-2 rounded-md font-medium text-sm transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=inactive]:text-muted-foreground hover:text-foreground";

export function AssetsTabs({ children, onTabChange, defaultTab = "brands", value, onAdd }: AssetsTabsProps) {
  const active = ASSET_TABS.find((t) => t.id === (value ?? defaultTab));
  const renderTrigger = (tab: AssetTab) => (
    <TabsTrigger key={tab.id} value={tab.id} className={triggerClass}>
      <tab.icon className="w-4 h-4" />
      <span>{tab.label}</span>
    </TabsTrigger>
  );
  return (
    <Tabs
      {...(value !== undefined ? { value } : { defaultValue: defaultTab })}
      className="w-full"
      onValueChange={onTabChange}
    >
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList className="inline-flex h-auto items-center gap-1 rounded-lg bg-muted/50 p-1">
          {CORE_TABS.map(renderTrigger)}
          {/* Core four above; the rest are only read by specific features. */}
          <span aria-hidden className="mx-1.5 h-5 w-px shrink-0 bg-border" />
          {EXTRA_TABS.map(renderTrigger)}
        </TabsList>
      </div>
      {active && (
        <div className="mb-5 mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-sm text-muted-foreground">{active.usedFor}</p>
          {onAdd && (
            <Button variant="cta" className="shrink-0 self-start sm:self-auto" onClick={onAdd}>
              <Plus className="w-4 h-4 mr-2" />
              {active.addLabel}
            </Button>
          )}
        </div>
      )}
      {children}
    </Tabs>
  );
}
