import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";
import { useICPs } from "@/hooks/useICPs";
import { useLeadLists } from "@/hooks/useLeadLists";
import {
  useCreateListBuildingJob,
  useDomainSearch,
  type CreateListBuildingJobInput,
  type DomainSearchFilters,
} from "@/hooks/useListBuilding";

interface JobWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SOURCES = [
  { id: "common_crawl", label: "Common Crawl (global domain index)" },
  { id: "google_maps", label: "Google Maps (local businesses)" },
  { id: "google_search", label: "Google Search" },
  { id: "directory", label: "Directories" },
  { id: "linkedin", label: "LinkedIn" },
];

const STEPS = ["Basic", "ICP", "Query", "Target", "Workers", "Review"] as const;

export function JobWizard({ open, onOpenChange }: JobWizardProps) {
  const navigate = useNavigate();
  const { icps = [] } = useICPs();
  const { leadLists } = useLeadLists();
  const createJob = useCreateListBuildingJob();

  const [step, setStep] = useState(0);
  const [domainIndexOpen, setDomainIndexOpen] = useState(false);
  const [diCountry, setDiCountry] = useState("");
  const [diState, setDiState] = useState("");
  const [diTechStack, setDiTechStack] = useState<string[]>([]);
  const [form, setForm] = useState<CreateListBuildingJobInput>({
    name: "",
    icp_id: null,
    query: { niche: "", geo: "", employee_range: "", sources: ["google_maps"] },
    target_list_id: null,
    worker_config: { discovery: 10, dm: 5, pattern: 20, smtp: 15, icp: 5 },
  });

  const reset = () => {
    setStep(0);
    setDomainIndexOpen(false);
    setDiCountry("");
    setDiState("");
    setDiTechStack([]);
    setForm({
      name: "",
      icp_id: null,
      query: {
        niche: "",
        geo: "",
        employee_range: "",
        sources: ["google_maps"],
      },
      target_list_id: null,
      worker_config: { discovery: 10, dm: 5, pattern: 20, smtp: 15, icp: 5 },
    });
  };

  const isCommonCrawlSelected = form.query.sources.includes("common_crawl");
  const domainSearchFilters: DomainSearchFilters = useMemo(
    () => ({
      keywords: form.query.niche ? form.query.niche.split(/[,\s]+/).filter(Boolean) : [],
      country: diCountry || null,
      state: diState || null,
      tech_stack: diTechStack.length > 0 ? diTechStack : undefined,
      limit: 1,
    }),
    [form.query.niche, diCountry, diState, diTechStack],
  );
  const domainSearchEnabled =
    isCommonCrawlSelected &&
    domainIndexOpen &&
    (domainSearchFilters.keywords?.length ?? 0) > 0;
  const domainSearch = useDomainSearch(domainSearchFilters, domainSearchEnabled);

  const TECH_OPTIONS = [
    "wordpress", "shopify", "nextjs", "wix", "squarespace", "hubspot",
    "webflow", "react", "stripe", "google_analytics", "google_tag_manager",
  ];

  const toggleTech = (tech: string) => {
    setDiTechStack((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech],
    );
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const toggleSource = (id: string) => {
    setForm((f) => {
      const has = f.query.sources.includes(id);
      return {
        ...f,
        query: {
          ...f.query,
          sources: has
            ? f.query.sources.filter((s) => s !== id)
            : [...f.query.sources, id],
        },
      };
    });
  };

  const handleCreate = () => {
    createJob.mutate(form, {
      onSuccess: (data) => {
        handleClose(false);
        if (data?.job_id) navigate(`/list-building/${data.job_id}`);
      },
    });
  };

  const canNext = () => {
    if (step === 0) return form.name.trim().length > 0;
    if (step === 2)
      return (
        form.query.niche.trim().length > 0 && form.query.sources.length > 0
      );
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New List Building Job</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4 min-h-[280px]">
          {step === 0 && (
            <div className="space-y-2">
              <Label htmlFor="job-name">Job name</Label>
              <Input
                id="job-name"
                placeholder="Q2 SaaS founders in Berlin"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <Label>ICP (optional)</Label>
              <Select
                value={form.icp_id ?? "none"}
                onValueChange={(v) =>
                  setForm({ ...form, icp_id: v === "none" ? null : v })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an ICP" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No ICP</SelectItem>
                  {icps.map((icp) => (
                    <SelectItem key={icp.id} value={icp.id}>
                      {icp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                ICP is used for scoring and fit labels at the end of the
                pipeline.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="niche">Niche / keyword</Label>
                <Input
                  id="niche"
                  placeholder="dental clinics, SaaS agencies, etc."
                  value={form.query.niche}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      query: { ...form.query, niche: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="geo">Geography</Label>
                <Input
                  id="geo"
                  placeholder="Berlin, Germany"
                  value={form.query.geo}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      query: { ...form.query, geo: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="employees">Employee range (optional)</Label>
                <Input
                  id="employees"
                  placeholder="10-50"
                  value={form.query.employee_range ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      query: { ...form.query, employee_range: e.target.value },
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Sources</Label>
                <div className="grid grid-cols-2 gap-2">
                  {SOURCES.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`src-${s.id}`}
                        checked={form.query.sources.includes(s.id)}
                        onCheckedChange={() => toggleSource(s.id)}
                      />
                      <Label
                        htmlFor={`src-${s.id}`}
                        className="cursor-pointer font-normal"
                      >
                        {s.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {isCommonCrawlSelected && (
                <Collapsible
                  open={domainIndexOpen}
                  onOpenChange={setDomainIndexOpen}
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-between"
                    >
                      <span className="text-xs">
                        Advanced: search your enriched domain index
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${domainIndexOpen ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-3 rounded-lg border p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Country</Label>
                        <Input
                          placeholder="US"
                          value={diCountry}
                          onChange={(e) => setDiCountry(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">State</Label>
                        <Input
                          placeholder="TX"
                          value={diState}
                          onChange={(e) => setDiState(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Tech stack filter</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {TECH_OPTIONS.map((tech) => (
                          <Badge
                            key={tech}
                            variant={
                              diTechStack.includes(tech)
                                ? "default"
                                : "outline"
                            }
                            className="cursor-pointer text-xs"
                            onClick={() => toggleTech(tech)}
                          >
                            {tech}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {domainSearchEnabled && (
                      <div className="text-xs text-muted-foreground">
                        {domainSearch.isLoading
                          ? "Searching..."
                          : domainSearch.data
                            ? `${domainSearch.data.total.toLocaleString()} matching domains in your index`
                            : "Enter keywords above to preview"}
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-2">
              <Label>Target lead list (optional)</Label>
              <Select
                value={form.target_list_id ?? "none"}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    target_list_id: v === "none" ? null : v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a lead list" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No target list</SelectItem>
                  {leadLists.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Export destination. You can change this later when exporting.
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">
                  Speed preset
                </Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(
                    [
                      {
                        key: "gentle",
                        label: "Gentle",
                        cfg: { discovery: 5, dm: 3, pattern: 10, smtp: 5, icp: 3 },
                        warn: null,
                      },
                      {
                        key: "balanced",
                        label: "Balanced",
                        cfg: { discovery: 10, dm: 5, pattern: 20, smtp: 15, icp: 5 },
                        warn: null,
                      },
                      {
                        key: "aggressive",
                        label: "Aggressive",
                        cfg: { discovery: 25, dm: 10, pattern: 50, smtp: 30, icp: 10 },
                        warn: "Requires multiple proxies",
                      },
                      {
                        key: "scrapebox",
                        label: "ScrapeBox mode",
                        cfg: { discovery: 50, dm: 20, pattern: 100, smtp: 60, icp: 20 },
                        warn: "Requires >=10 proxies",
                      },
                    ] as const
                  ).map((preset) => {
                    const active =
                      form.worker_config.discovery === preset.cfg.discovery &&
                      form.worker_config.dm === preset.cfg.dm &&
                      form.worker_config.pattern === preset.cfg.pattern &&
                      form.worker_config.smtp === preset.cfg.smtp &&
                      form.worker_config.icp === preset.cfg.icp;
                    return (
                      <Button
                        key={preset.key}
                        type="button"
                        size="sm"
                        variant={active ? "cta" : "outline"}
                        onClick={() =>
                          setForm({ ...form, worker_config: { ...preset.cfg } })
                        }
                        className="flex flex-col h-auto py-2"
                      >
                        <span className="text-xs font-medium">{preset.label}</span>
                        {preset.warn && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            {preset.warn}
                          </span>
                        )}
                      </Button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Picking a preset updates the sliders. Tune below for custom.
                </p>
              </div>
              {(
                [
                  ["discovery", "Discovery workers", 1, 50],
                  ["dm", "DM ID workers", 1, 30],
                  ["pattern", "Pattern workers", 1, 50],
                  ["smtp", "SMTP verify workers", 1, 50],
                  ["icp", "ICP scoring workers", 1, 20],
                ] as const
              ).map(([key, label, min, max]) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{label}</Label>
                    <span className="text-sm font-medium">
                      {form.worker_config[key]}
                    </span>
                  </div>
                  <Slider
                    min={min}
                    max={max}
                    step={1}
                    value={[form.worker_config[key]]}
                    onValueChange={([v]) =>
                      setForm({
                        ...form,
                        worker_config: { ...form.worker_config, [key]: v },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border p-4 space-y-2">
                <div>
                  <span className="text-muted-foreground">Name: </span>
                  <span className="font-medium">{form.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">ICP: </span>
                  <span className="font-medium">
                    {icps.find((i) => i.id === form.icp_id)?.name ?? "None"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Niche: </span>
                  <span className="font-medium">{form.query.niche}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Geo: </span>
                  <span className="font-medium">
                    {form.query.geo || "Any"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Sources: </span>
                  <span className="font-medium">
                    {form.query.sources.join(", ")}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Target list: </span>
                  <span className="font-medium">
                    {leadLists.find((l) => l.id === form.target_list_id)
                      ?.name ?? "None"}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Workers: </span>
                  <span className="font-medium">
                    {Object.entries(form.worker_config)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(" ")}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              variant="cta"
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="cta"
              onClick={handleCreate}
              disabled={createJob.isPending}
            >
              {createJob.isPending ? "Creating..." : "Create Job"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
