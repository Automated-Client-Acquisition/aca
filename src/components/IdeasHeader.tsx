import { Link } from "react-router-dom";
import {
  Lightbulb,
  Plus,
  ChevronDown,
  Sparkles,
  PenLine,
  FileSpreadsheet,
  Lock,
  Telescope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";

interface IdeasHeaderProps {
  onAddClick: () => void;
  onAddManualClick?: () => void;
  onImportCSVClick?: () => void;
  onStarterPackClick?: () => void;
}

export function IdeasHeader({
  onAddClick,
  onAddManualClick,
  onImportCSVClick,
  onStarterPackClick,
}: IdeasHeaderProps) {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseStarterPacks = hasFeature("starter_packs");
  // Only show upgrade prompts for non-client organizations
  const showLockedState = !canUseStarterPacks && showUpgradePrompts;

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            <Lightbulb className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Ideas</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-2.5 sm:px-3"
          >
            <Link to="/research">
              <Telescope className="h-4 w-4" />
              <span>Research</span>
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="cta"
                size="sm"
                className="h-9 gap-1.5 px-2.5 sm:px-3"
              >
                <Plus className="hidden h-4 w-4 sm:block" />
                Add ideas
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={onAddClick} className="cursor-pointer">
                <Sparkles className="w-4 h-4 mr-2 text-primary" />
                <div>
                  <div className="font-medium">Generate with AI</div>
                  <div className="text-xs text-muted-foreground">
                    From a topic, keyword or link
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onAddManualClick}
                className="cursor-pointer"
              >
                <PenLine className="w-4 h-4 mr-2 text-blue-500" />
                <div>
                  <div className="font-medium">Write them yourself</div>
                  <div className="text-xs text-muted-foreground">
                    One per line, no AI
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onImportCSVClick}
                className="cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2 text-green-500" />
                <div>
                  <div className="font-medium">Import a CSV</div>
                  <div className="text-xs text-muted-foreground">
                    Bulk import from a spreadsheet
                  </div>
                </div>
              </DropdownMenuItem>
              {/* Starter pack: enabled with access, locked with upgrade for non-clients, hidden for clients without access */}
              {onStarterPackClick &&
                (canUseStarterPacks || showLockedState) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={
                        canUseStarterPacks
                          ? onStarterPackClick
                          : () => window.open(UPGRADE_URL, "_blank")
                      }
                      className="cursor-pointer"
                    >
                      {canUseStarterPacks ? (
                        <Sparkles className="w-4 h-4 mr-2 text-primary" />
                      ) : (
                        <Lock className="w-4 h-4 mr-2 text-cta" />
                      )}
                      <div className="flex-1">
                        <div className="font-medium">Starter pack</div>
                        <div className="text-xs text-muted-foreground">
                          Ready-made ideas for your niche
                        </div>
                      </div>
                      {showLockedState && (
                        <Badge
                          variant="outline"
                          className="ml-2 text-xs py-0 px-1.5 border-cta/50 text-cta bg-cta/10"
                        >
                          Pro
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  </>
                )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Save topics, shape their guidelines, and turn them into content.
      </p>
    </div>
  );
}
