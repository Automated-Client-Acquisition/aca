import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  StopCircle,
  Download,
  Search,
  UserSearch,
  Hash,
  Mail,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { StageProgressCard } from "./StageProgressCard";
import { ThroughputGauge } from "./ThroughputGauge";
import { EnrichedLeadsTable } from "./EnrichedLeadsTable";
import { DiscoveredCompaniesTable } from "./DiscoveredCompaniesTable";
import {
  useListBuildingJob,
  useStopListBuildingJob,
  useListBuildingLeads,
  useExportListBuildingLeads,
  useDiscoveredCompanies,
  type FitLabel,
} from "@/hooks/useListBuilding";
import { useLeadLists } from "@/hooks/useLeadLists";

const FIT_LABELS: FitLabel[] = ["Strong", "Good", "Weak", "Disqualify"];

interface JobDetailProps {
  jobId: string;
}

export function JobDetail({ jobId }: JobDetailProps) {
  const navigate = useNavigate();
  const { data: job, isLoading } = useListBuildingJob(jobId);
  const stopJob = useStopListBuildingJob();
  const [fitFilter, setFitFilter] = useState<FitLabel | null>(null);
  const { data: leadsData, isLoading: leadsLoading } = useListBuildingLeads(
    jobId,
    { fit_label: fitFilter }
  );
  const { data: companies = [], isLoading: companiesLoading } =
    useDiscoveredCompanies(jobId);
  const [exportOpen, setExportOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Loading...</div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Job not found
      </div>
    );
  }

  const canStop = job.status === "running" || job.status === "pending";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate("/list-building")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{job.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline">{job.status}</Badge>
              <span className="text-sm text-muted-foreground">
                {job.query.niche}
                {job.query.geo ? ` - ${job.query.geo}` : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canStop && (
            <Button
              variant="outline"
              onClick={() => stopJob.mutate(job.id)}
              disabled={stopJob.isPending}
            >
              <StopCircle className="h-4 w-4 mr-2" />
              Stop
            </Button>
          )}
          <Button variant="cta" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">{job.progress}%</span>
        </div>
        <Progress value={job.progress} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StageProgressCard
          title="Discovery"
          count={job.total_companies}
          subtitle="Companies found"
          icon={Search}
        />
        <StageProgressCard
          title="DM ID"
          count={job.found_dms}
          subtitle="Decision makers"
          icon={UserSearch}
        />
        <StageProgressCard
          title="Pattern"
          count={0}
          subtitle="Patterns inferred"
          icon={Hash}
        />
        <StageProgressCard
          title="SMTP"
          count={job.verified_emails}
          subtitle="Verified emails"
          icon={Mail}
        />
        <StageProgressCard
          title="ICP"
          count={job.strong_leads}
          subtitle="Strong leads"
          icon={Target}
        />
      </div>

      <ThroughputGauge jobId={job.id} enabled={job.status === "running"} />

      {/* Discovered companies */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Discovered companies ({companies.length})
          </h2>
        </div>
        <DiscoveredCompaniesTable
          companies={companies}
          isLoading={companiesLoading}
        />
      </div>

      {/* Enriched leads */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground mr-2">Filter:</span>
          <Button
            size="sm"
            variant={fitFilter === null ? "default" : "outline"}
            onClick={() => setFitFilter(null)}
          >
            All
          </Button>
          {FIT_LABELS.map((label) => (
            <Button
              key={label}
              size="sm"
              variant={fitFilter === label ? "default" : "outline"}
              onClick={() => setFitFilter(label)}
              className={cn(
                fitFilter === label && label === "Strong" && "bg-green-600",
                fitFilter === label && label === "Good" && "bg-amber-600",
                fitFilter === label && label === "Disqualify" && "bg-red-600"
              )}
            >
              {label}
            </Button>
          ))}
          <span className="text-sm text-muted-foreground ml-auto">
            {leadsData?.count ?? 0} leads
          </span>
        </div>
        <EnrichedLeadsTable
          leads={leadsData?.rows ?? []}
          isLoading={leadsLoading}
        />
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        jobId={job.id}
        defaultListId={job.target_list_id}
      />
    </div>
  );
}

function ExportDialog({
  open,
  onOpenChange,
  jobId,
  defaultListId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  defaultListId: string | null;
}) {
  const { leadLists } = useLeadLists();
  const exportLeads = useExportListBuildingLeads();
  const [selectedLabels, setSelectedLabels] = useState<FitLabel[]>([
    "Strong",
    "Good",
  ]);
  const [targetList, setTargetList] = useState<string | null>(defaultListId);

  const toggleLabel = (label: FitLabel) => {
    setSelectedLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
    );
  };

  const handleExport = () => {
    if (!targetList || selectedLabels.length === 0) return;
    exportLeads.mutate(
      { job_id: jobId, fit_labels: selectedLabels, target_list_id: targetList },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export leads</DialogTitle>
          <DialogDescription>
            Pick fit labels and a destination lead list.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Fit labels</Label>
            <div className="grid grid-cols-2 gap-2">
              {FIT_LABELS.map((label) => (
                <div key={label} className="flex items-center gap-2">
                  <Checkbox
                    id={`fit-${label}`}
                    checked={selectedLabels.includes(label)}
                    onCheckedChange={() => toggleLabel(label)}
                  />
                  <Label
                    htmlFor={`fit-${label}`}
                    className="cursor-pointer font-normal"
                  >
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Target lead list</Label>
            <Select
              value={targetList ?? ""}
              onValueChange={(v) => setTargetList(v || null)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a lead list" />
              </SelectTrigger>
              <SelectContent>
                {leadLists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleExport}
            disabled={
              !targetList ||
              selectedLabels.length === 0 ||
              exportLeads.isPending
            }
          >
            {exportLeads.isPending ? "Exporting..." : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
