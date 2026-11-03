import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useOpenRouterModels,
  sortModelsForAnalysis,
  RECOMMENDED_CHEAP_MODELS,
} from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useAlibabaModels } from "@/hooks/useAlibabaModels";

interface LlmModelSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Hide the search input for compact contexts */
  showSearch?: boolean;
  className?: string;
  triggerClassName?: string;
}

/**
 * Shared LLM model dropdown listing OpenRouter, Ollama, and Alibaba models in
 * grouped sections. Ollama/Alibaba values are stored with their `ollama:`/
 * `alibaba:` prefix — the backend llm-client routes on it, so consumers just
 * persist the string as before.
 */
export function LlmModelSelect({
  value,
  onValueChange,
  showSearch = true,
  className,
  triggerClassName,
}: LlmModelSelectProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const {
    data: openRouterModels,
    isLoading: isLoadingOpenRouter,
    hasOpenRouterKey,
    isLoadingApiKeys,
  } = useOpenRouterModels();
  const {
    data: ollamaModels,
    isLoading: isLoadingOllama,
    hasOllamaKey,
  } = useOllamaModels();
  const {
    data: alibabaModels,
    isLoading: isLoadingAlibaba,
    hasAlibabaKey,
  } = useAlibabaModels();

  const isLoading =
    isLoadingApiKeys ||
    (hasOpenRouterKey && isLoadingOpenRouter) ||
    (hasOllamaKey && isLoadingOllama) ||
    (hasAlibabaKey && isLoadingAlibaba);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-muted/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading models...</span>
      </div>
    );
  }

  if (!hasOpenRouterKey && !hasOllamaKey && !hasAlibabaKey) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2">
        <div className="flex items-start gap-2 text-amber-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-medium">OpenRouter, Ollama, or Alibaba API key required</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild className="w-full">
          <Link to="/settings?tab=integrations">
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Add API Key
          </Link>
        </Button>
      </div>
    );
  }

  const query = searchQuery.toLowerCase();
  const sortedOpenRouter = sortModelsForAnalysis(openRouterModels || []).filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query),
  );
  const filteredOllama = (ollamaModels || []).filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query),
  );
  const filteredAlibaba = (alibabaModels || []).filter(
    (m) =>
      !query ||
      m.name.toLowerCase().includes(query) ||
      m.id.toLowerCase().includes(query),
  );

  const selectedName =
    filteredOllama.find((m) => m.id === value)?.name ??
    filteredAlibaba.find((m) => m.id === value)?.name ??
    (openRouterModels || []).find((m) => m.id === value)?.name ??
    value;

  const noResults =
    sortedOpenRouter.length === 0 && filteredOllama.length === 0 && filteredAlibaba.length === 0;

  return (
    <div className={className ?? "space-y-2"}>
      {showSearch && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm"
          />
        </div>
      )}
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={triggerClassName ?? "h-9 focus:ring-inset"}>
          <SelectValue placeholder="Select a model">{selectedName}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-[250px]">
          {noResults ? (
            <div className="p-3 text-sm text-muted-foreground text-center">
              No models found
            </div>
          ) : (
            <>
              {filteredOllama.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Ollama
                  </SelectLabel>
                  {filteredOllama.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center gap-2">
                        <span>{model.name}</span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0"
                        >
                          Ollama
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {filteredAlibaba.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Alibaba
                  </SelectLabel>
                  {filteredAlibaba.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center gap-2">
                        <span>{model.name}</span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0"
                        >
                          Alibaba
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {sortedOpenRouter.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    OpenRouter
                  </SelectLabel>
                  {sortedOpenRouter.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      <div className="flex items-center gap-2">
                        <span>{model.name}</span>
                        {RECOMMENDED_CHEAP_MODELS.includes(model.id) && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0"
                          >
                            Cheap
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
