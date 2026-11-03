import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ContentTabs } from "@/components/ContentTabs";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { useGenerationJobs, useGenerationJobStats, useRetryJobDispatch } from "@/hooks/useGenerationJobs";
import { useDeleteGenerationJob, useBulkDeleteGenerationJobs } from "@/hooks/useDeleteGenerationJob";
import { useUpdateJobName } from "@/hooks/useUpdateJobName";
import { useVideoProjects, useDeleteVideoProject, useBulkDeleteVideoProjects } from "@/hooks/useVideoProject";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { JobStatusBadge } from "@/components/jobs/JobStatusBadge";
import { JobFilters, JobFilterState } from "@/components/jobs/JobFilters";
import { JobsHeader } from "@/components/JobsHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import {
  Search,
  Trash2,
  Video,
  FileText,
  Sparkles,
  LayoutGrid,
  Clock,
  ChevronRight,
  Plus,
  Pencil,
  ChevronLeft,
  RefreshCw,
  Download,
  Film,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJobContentSummaries } from "@/hooks/useJobContentSummaries";
import { getJobContentCounts } from "@/lib/job-content-state";
import { JobContentPreview } from "@/components/jobs/JobContentPreview";
import { JobPublicationDetails } from "@/components/jobs/JobPublicationDetails";
import { AlertCircle } from "lucide-react";
import { ProFeaturesShowcase, LimitWarning } from "@/components/ProFeaturesShowcase";
import { useOrganizationQuota } from "@/hooks/useOrganizationQuota";
import type { Database } from "@/integrations/supabase/types";

type GenerationJob = Database["public"]["Tables"]["content_generation_jobs"]["Row"];
type JobConfiguration = { blueprint_name?: string; blueprint?: { name?: string } };
type JobItem = {
  slot_values?: { topic?: string; title?: string };
  idea_title?: string;
  library_elements?: {
    library_brand_voices?: { name?: string };
    library_products?: { name?: string };
    library_characters?: { name?: string };
  };
};

// Inline editable job name component
function EditableJobName({
  jobId,
  currentName,
  fallbackName,
  onNavigate
}: {
  jobId: string;
  currentName: string | null;
  fallbackName: string;
  onNavigate: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentName || fallbackName);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateNameMutation = useUpdateJobName();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== currentName) {
      updateNameMutation.mutate({ jobId, name: trimmedValue });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(currentName || fallbackName);
      setIsEditing(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        aria-label="Run name"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="h-6 text-sm font-semibold py-0 px-1 w-full min-w-0"
      />
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-1.5 group/name">
      <h3 className="min-w-0"><button className="text-left font-semibold text-sm leading-snug break-words hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={onNavigate}>{currentName || fallbackName}</button></h3>
      <button
        onClick={handleEditClick}
        className="shrink-0 p-1 rounded text-muted-foreground hover:bg-muted"
        aria-label="Edit run name"
        title="Edit job name"
      >
        <Pencil className="h-3 w-3 text-muted-foreground" />
      </button>
    </div>
  );
}

// Helper to get a readable pipeline label
function getPipelineInfo(pipeline: string): { label: string; icon: React.ReactNode; color: string } {
  switch (pipeline) {
    case 'generative_video_oneshot':
      return {
        label: 'AI Video',
        icon: <Video className="h-4 w-4" />,
        color: 'bg-primary/10 text-primary border-primary/20'
      };
    case 'instagram_carousel':
    case 'instagram_carousel_ai':
      return { label: 'Carousel', icon: <LayoutGrid className="h-4 w-4" />, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
    case 'image_only':
      return { label: 'Image', icon: <LayoutGrid className="h-4 w-4" />, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
    case 'rich_article':
      return { label: 'Article', icon: <FileText className="h-4 w-4" />, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
    case 'twitter_thread':
      return { label: 'X thread', icon: <FileText className="h-4 w-4" />, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
    case 'social_media_post':
      return {
        label: 'Social Post',
        icon: <FileText className="h-4 w-4" />,
        color: 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      };
    case 'youtube_script':
      return {
        label: 'YouTube Script',
        icon: <FileText className="h-4 w-4" />,
        color: 'bg-red-500/10 text-red-600 border-red-500/20'
      };
    default:
      return {
        label: pipeline.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase()),
        icon: <Sparkles className="h-4 w-4" />,
        color: 'bg-gray-500/10 text-gray-600 border-gray-500/20'
      };
  }
}

// Helper to extract a topic/subject from job items
function extractJobTopic(items: JobItem[]): string | null {
  if (!items || items.length === 0) return null;

  // Try to get topic from first item's slot_values or idea_title
  const firstItem = items[0];
  const topic = firstItem?.slot_values?.topic
    || firstItem?.slot_values?.title
    || firstItem?.idea_title;

  if (!topic) return null;

  // Return the full topic without truncation
  return topic;
}

// Helper to generate a descriptive job name
function getJobDisplayName(job: GenerationJob): { title: string; subtitle: string; blueprintTag?: string } {
  const config = job.configuration as JobConfiguration;
  const blueprintName = config?.blueprint_name || config?.blueprint?.name;
  const createdDate = format(new Date(job.created_at), 'MMM d, h:mm a');
  const pipelineInfo = getPipelineInfo(job.pipeline);
  const items = job.items as JobItem[];
  const itemCount = items?.length || 0;

  // If job has a custom name, use it as title
  if (job.name) {
    return {
      title: job.name,
      subtitle: createdDate,
      blueprintTag: blueprintName
    };
  }

  // Extract topic from items
  const topic = extractJobTopic(items);

  // Generate a descriptive title based on pipeline type, count, and topic
  let contentLabel: string;
  if (itemCount > 1) {
    contentLabel = topic
      ? `${itemCount} ${pipelineInfo.label}s: ${topic}`
      : `${itemCount} ${pipelineInfo.label}s`;
  } else {
    contentLabel = topic
      ? `${pipelineInfo.label}: ${topic}`
      : pipelineInfo.label;
  }

  return {
    title: contentLabel,
    subtitle: createdDate,
    blueprintTag: blueprintName
  };
}

function VideoProjectsSection({ searchQuery }: { searchQuery: string }) {
  const navigate = useNavigate();
  const { data: videoProjects, isLoading } = useVideoProjects();
  const deleteVideoProject = useDeleteVideoProject();
  const bulkDeleteVideoProjects = useBulkDeleteVideoProjects();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!videoProjects) return [];
    let projects = videoProjects.filter((p) => p.status !== "draft");
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      projects = projects.filter((p) => p.title.toLowerCase().includes(q));
    }
    return projects;
  }, [videoProjects, searchQuery]);

  if (isLoading || filtered.length === 0) return null;

  const statusColor: Record<string, string> = {
    rendering: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    failed: "bg-red-500/10 text-red-500 border-red-500/20",
  };

  const allSelected = filtered.length > 0 && selectedProjects.size === filtered.length;
  const someSelected = selectedProjects.size > 0 && !allSelected;

  const handleSelectProject = (projectId: string, checked: boolean) => {
    const next = new Set(selectedProjects);
    if (checked) next.add(projectId);
    else next.delete(projectId);
    setSelectedProjects(next);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) setSelectedProjects(new Set(filtered.map((p) => p.id)));
    else setSelectedProjects(new Set());
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Film className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-muted-foreground">Video Projects</h3>
        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{filtered.length}</Badge>
      </div>

      {/* Bulk Actions Bar */}

      {selectedProjects.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg border">
          <span className="text-sm font-medium">
            {selectedProjects.size} video project{selectedProjects.size > 1 ? 's' : ''} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteDialogOpen(true)}
            disabled={bulkDeleteVideoProjects.isPending}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete Selected
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedProjects(new Set())}
          >
            Clear Selection
          </Button>
        </div>
      )}

      {/* Select All Header */}
      <div className="flex items-center gap-3 px-4 py-1 text-sm text-muted-foreground">
        <Checkbox
          checked={allSelected}
          onCheckedChange={handleSelectAll}
          aria-label="Select all video projects"
          className={someSelected ? "data-[state=checked]:bg-primary/50" : ""}
        />
        <span className="text-xs">Select all</span>
      </div>

      {filtered.map((project) => {
        const isSelected = selectedProjects.has(project.id);
        return (
          <div
            key={project.id}
            className={cn(
              "group border rounded-xl p-4 cursor-pointer transition-all duration-200",
              "hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5",
              project.status === "rendering" && "border-blue-500/30 bg-blue-500/5",
              project.status === "failed" && "border-red-500/20 bg-red-500/5",
              project.status === "completed" && "border-green-500/20",
              isSelected && "border-primary bg-primary/5",
            )}
            onClick={() => navigate(`/editor/${project.id}`)}
          >
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Checkbox */}
              <div onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => handleSelectProject(project.id, checked as boolean)}
                  aria-label={`Select ${project.title}`}
                />
              </div>
              <div className="flex-shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center border shadow-sm bg-primary/10 text-primary border-primary/20">
                <Video className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm leading-snug">{project.title}</h3>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                  <Clock className="h-3 w-3 hidden sm:block" />
                  <span>{format(new Date(project.updated_at), "MMM d, h:mm a")}</span>
                  <span className="opacity-40">-</span>
                  <span>{formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}</span>
                  <span className="opacity-40">-</span>
                  <span>{project.scenes.length} scene{project.scenes.length !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {project.output_url && (
                  <a
                    href={project.output_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </a>
                )}
                <Badge variant="outline" className={cn("text-[10px] capitalize", statusColor[project.status] || "")}>
                  {project.status === "rendering" ? "Rendering..." : project.status}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectToDelete({ id: project.id, name: project.title });
                    setDeleteDialogOpen(true);
                  }}
                  disabled={deleteVideoProject.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-destructive" />
                </Button>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all hidden sm:block" />
              </div>
            </div>
          </div>
        );
      })}

      {/* Single Delete Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={() => {
          if (projectToDelete) {
            deleteVideoProject.mutate(projectToDelete.id);
            setProjectToDelete(null);
          }
        }}
        itemName={projectToDelete?.name || ""}
        itemType="video project"
      />

      {/* Bulk Delete Dialog */}
      <DeleteConfirmDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        onConfirm={() => {
          if (selectedProjects.size > 0) {
            bulkDeleteVideoProjects.mutate(Array.from(selectedProjects));
            setSelectedProjects(new Set());
          }
        }}
        itemName={`${selectedProjects.size} video project${selectedProjects.size > 1 ? 's' : ''}`}
        itemType="video projects"
      />
    </div>
  );
}

const PAGE_SIZE = 20;

export default function Jobs() {
  const navigate = useNavigate();
  const { data: quota } = useOrganizationQuota();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [publicationFilter, setPublicationFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [advancedFilters, setAdvancedFilters] = useState<JobFilterState>({
    blueprint: "",
    pipeline: "",
    brandVoice: "",
    product: "",
    character: "",
    dateRange: "all",
    sortBy: "date_desc",
  });

  // Fetch jobs with pagination and sorting
  const { data: jobsData, isLoading, error: jobsError, refetch: refetchJobs } = useGenerationJobs({
    status: statusFilter === "all" ? undefined : statusFilter,
    page: currentPage,
    pageSize: PAGE_SIZE,
    sortBy: advancedFilters.sortBy,
    dateRange: advancedFilters.dateRange,
  });

  // Fetch stats for filter badges
  const { data: stats } = useGenerationJobStats();

  const deleteMutation = useDeleteGenerationJob();
  const bulkDeleteMutation = useBulkDeleteGenerationJobs();
  const retryMutation = useRetryJobDispatch();

  const jobs = useMemo(() => jobsData?.jobs || [], [jobsData]);
  const totalPages = jobsData?.totalPages || 1;
  const totalCount = jobsData?.totalCount || 0;
  const content = useJobContentSummaries(jobs.map(job => job.id), jobs.some(job => ["queued", "processing"].includes(job.status)));
  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setPublicationFilter("all");
    setAdvancedFilters({ blueprint: "", pipeline: "", brandVoice: "", product: "", character: "", dateRange: "all", sortBy: "date_desc" });
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, advancedFilters.dateRange, advancedFilters.sortBy]);

  // Clear selection when page changes
  useEffect(() => {
    setSelectedJobs(new Set());
  }, [currentPage, statusFilter, searchQuery, publicationFilter, advancedFilters]);

  useEffect(() => {
    if (jobsData && currentPage > Math.max(1, jobsData.totalPages)) setCurrentPage(Math.max(1, jobsData.totalPages));
  }, [jobsData, currentPage]);

  // Extract available filter options from current page jobs
  const filterOptions = useMemo(() => {
    const blueprints = new Set<string>();
    const pipelines = new Map<string, string>();
    const brandVoices = new Set<string>();
    const products = new Set<string>();
    const characters = new Set<string>();

    jobs?.forEach((job) => {
      const config = job.configuration as JobConfiguration;
      const items = job.items as JobItem[];

      // Blueprint
      const blueprintName = config?.blueprint_name || config?.blueprint?.name;
      if (blueprintName) blueprints.add(blueprintName);

      // Pipeline
      if (job.pipeline) {
        pipelines.set(job.pipeline, getPipelineInfo(job.pipeline).label);
      }

      // Extract library elements from items
      items?.forEach((item) => {
        const libElements = item?.library_elements;
        if (libElements) {
          // Brand voice
          const brandVoice = libElements.library_brand_voices?.name;
          if (brandVoice) brandVoices.add(brandVoice);

          // Product
          const product = libElements.library_products?.name;
          if (product) products.add(product);

          // Character
          const character = libElements.library_characters?.name;
          if (character) characters.add(character);
        }
      });
    });

    return {
      blueprints: Array.from(blueprints).sort(),
      pipelines: Array.from(pipelines.entries()).map(([value, label]) => ({ value, label })),
      brandVoices: Array.from(brandVoices).sort(),
      products: Array.from(products).sort(),
      characters: Array.from(characters).sort(),
    };
  }, [jobs]);

  // Filter jobs based on search and advanced filters (client-side for search)
  const pageFilteredJobs = useMemo(() => {
    return jobs?.filter((job) => {
      const config = job.configuration as JobConfiguration;
      const items = job.items as JobItem[];
      const displayName = getJobDisplayName(job);
      const blueprintName = config?.blueprint_name || config?.blueprint?.name;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          displayName.title.toLowerCase().includes(query) ||
          displayName.subtitle.toLowerCase().includes(query) ||
          blueprintName?.toLowerCase().includes(query) ||
          job.pipeline?.toLowerCase().includes(query) ||
          job.name?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Blueprint filter
      if (advancedFilters.blueprint && blueprintName !== advancedFilters.blueprint) {
        return false;
      }

      // Pipeline filter
      if (advancedFilters.pipeline && job.pipeline !== advancedFilters.pipeline) {
        return false;
      }

      // Library element filters - check if any item matches
      if (advancedFilters.brandVoice || advancedFilters.product || advancedFilters.character) {
        const hasMatchingItem = items?.some((item) => {
          const libElements = item?.library_elements;
          if (!libElements) return false;

          const matchesBrandVoice = !advancedFilters.brandVoice ||
            libElements.library_brand_voices?.name === advancedFilters.brandVoice;
          const matchesProduct = !advancedFilters.product ||
            libElements.library_products?.name === advancedFilters.product;
          const matchesCharacter = !advancedFilters.character ||
            libElements.library_characters?.name === advancedFilters.character;

          return matchesBrandVoice && matchesProduct && matchesCharacter;
        });

        if (!hasMatchingItem) return false;
      }

      return true;
    });
  }, [jobs, searchQuery, advancedFilters]);

  const filteredJobs = useMemo(() => pageFilteredJobs.filter(job => {
      if (publicationFilter !== "all") {
        if (content.isLoading || content.isPublicationLoading || content.outputsError || content.publicationError) return false;
        const counts = getJobContentCounts(content.summaries[job.id]);
        if (publicationFilter === "published" && !counts.publishedTargets) return false;
        if (publicationFilter === "scheduled" && !(counts.scheduledTargets + counts.pendingTargets + counts.publishingTargets)) return false;
        if (publicationFilter === "unpublished" && (!counts.created || counts.publishedTargets || counts.scheduledTargets || counts.pendingTargets || counts.publishingTargets)) return false;
        if (publicationFilter === "attention" && !(counts.review || counts.failed || counts.publicationFailedTargets || job.status === "failed")) return false;
      }
    return true;
  }), [pageFilteredJobs, publicationFilter, content.summaries, content.isLoading, content.isPublicationLoading, content.outputsError, content.publicationError]);

  const handleRowClick = (jobId: string) => {
    const job = filteredJobs?.find(j => j.id === jobId);
    if (job?.video_project_id) {
      navigate(`/editor/${job.video_project_id}`);
      return;
    }
    navigate(`/jobs/${jobId}`);
  };

  const handleDeleteClick = (e: React.MouseEvent, jobId: string, jobName: string) => {
    e.stopPropagation();
    setJobToDelete({ id: jobId, name: jobName });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (jobToDelete) {
      deleteMutation.mutate(jobToDelete.id);
      setJobToDelete(null);
    }
  };

  const handleBulkDeleteConfirm = () => {
    if (selectedJobs.size > 0) {
      bulkDeleteMutation.mutate(Array.from(selectedJobs));
      setSelectedJobs(new Set());
    }
  };

  const handleSelectJob = (jobId: string, checked: boolean) => {
    const newSelection = new Set(selectedJobs);
    if (checked) {
      newSelection.add(jobId);
    } else {
      newSelection.delete(jobId);
    }
    setSelectedJobs(newSelection);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedJobs(new Set(filteredJobs?.map(j => j.id) || []));
    } else {
      setSelectedJobs(new Set());
    }
  };

  const statusFilters = [
    { key: 'all', label: 'All', count: stats?.total },
    { key: 'queued', label: 'Queued', count: stats?.queued },
    { key: 'processing', label: 'Generating', count: stats?.processing },
    { key: 'completed', label: 'Finished', count: stats?.completed },
    { key: 'failed', label: 'Failed', count: stats?.failed },
  ];

  const publicationCounts = { all: pageFilteredJobs.length, published: 0, scheduled: 0, unpublished: 0, attention: 0 };
  for (const job of pageFilteredJobs) {
    const counts = getJobContentCounts(content.summaries[job.id]);
    if (counts.publishedTargets) publicationCounts.published++;
    if (counts.scheduledTargets + counts.pendingTargets + counts.publishingTargets) publicationCounts.scheduled++;
    if (counts.created && !(counts.publishedTargets + counts.scheduledTargets + counts.pendingTargets + counts.publishingTargets)) publicationCounts.unpublished++;
    if (counts.review || counts.failed || counts.publicationFailedTargets || job.status === "failed") publicationCounts.attention++;
  }
  const publicationCountsReady = !(content.isLoading || content.isPublicationLoading || content.outputsError || content.publicationError);

  const allSelected = filteredJobs.length > 0 && filteredJobs.every(job => selectedJobs.has(job.id));
  const someSelected = selectedJobs.size > 0 && !allSelected;

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
        <div className="max-w-[1600px] mx-auto space-y-4">
          <ContentTabs />
          <JobsHeader onAddClick={() => navigate("/create")} />

          {/* Pro upgrade banner for free users */}
          {quota?.planTier === "free" && (
            <ProFeaturesShowcase variant="banner" />
          )}

          {/* Limit warning */}
          {quota && (
            <LimitWarning
              limitType="daily"
              current={quota.usage.daily.generations}
              max={quota.limits.daily_generations}
            />
          )}

          {/* Search, Status Filters, and Advanced Filters */}
          <div className="flex flex-col gap-3">
            {/* Top row: Search and Filters */}
            <div className="flex flex-wrap gap-3 items-start sm:items-center">
              {/* Search */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search this page…"
                  aria-label="Search runs on this page"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>

              {/* Status Filter Pills - Scrollable on mobile */}
              <div className="hidden xl:flex items-center gap-1.5 overflow-x-auto scrollbar-hide max-w-full">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setStatusFilter(filter.key)}
                    aria-pressed={statusFilter === filter.key}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium rounded-full transition-all flex items-center gap-1.5 whitespace-nowrap flex-shrink-0",
                      statusFilter === filter.key
                        ? "bg-foreground text-background shadow-sm"
                        : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {filter.key !== 'all' && (
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        filter.key === 'processing' && "bg-blue-500",
                        filter.key === 'completed' && "bg-green-500",
                        filter.key === 'failed' && "bg-red-500",
                        statusFilter === filter.key && "bg-primary-foreground"
                      )} />
                    )}
                    {filter.label}
                    <span className={cn(
                      "text-[10px] tabular-nums",
                      statusFilter === filter.key ? "opacity-80" : "opacity-60"
                    )}>
                      {filter.count ?? "—"}
                    </span>
                  </button>
                ))}
              </div>

              <div className="min-w-0 flex-1 sm:w-[150px] sm:flex-none xl:hidden"><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-9" aria-label="Generation status"><SelectValue /></SelectTrigger><SelectContent>{statusFilters.map(filter => <SelectItem key={filter.key} value={filter.key}>{filter.key === "all" ? "All runs" : filter.label} ({filter.count ?? "—"})</SelectItem>)}</SelectContent></Select></div>

              {/* Advanced Filters */}
              <div className="ml-auto flex-shrink-0">
                <JobFilters
                  filters={advancedFilters}
                  onFiltersChange={setAdvancedFilters}
                  availableOptions={filterOptions}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <span className="mr-1 hidden text-xs text-muted-foreground xl:block">Publishing · this page</span>
              <div className="min-w-0 flex-1 space-y-1 xl:hidden"><p className="text-[11px] text-muted-foreground">Publishing · this page</p><Select value={publicationFilter} onValueChange={setPublicationFilter}><SelectTrigger className="h-9" aria-label="Publishing view on this page"><SelectValue /></SelectTrigger><SelectContent>{[
                { key: "all", label: "All" }, { key: "published", label: "Published" }, { key: "scheduled", label: "Scheduled / in queue" }, { key: "unpublished", label: "Created, not published" }, { key: "attention", label: "Needs attention" },
              ].map(view => <SelectItem key={view.key} value={view.key} disabled={view.key !== "all" && !!(content.outputsError || content.publicationError)}>{view.label} ({publicationCountsReady ? publicationCounts[view.key as keyof typeof publicationCounts] : "—"})</SelectItem>)}</SelectContent></Select></div>
              {[
                { key: "all", label: "All" },
                { key: "published", label: "Published" },
                { key: "scheduled", label: "Scheduled / in queue" },
                { key: "unpublished", label: "Created, not published" },
                { key: "attention", label: "Needs attention" },
              ].map(view => <Button key={view.key} variant="ghost" size="sm" aria-pressed={publicationFilter === view.key} disabled={view.key !== "all" && !!(content.outputsError || content.publicationError)} onClick={() => setPublicationFilter(view.key)} className={cn("hidden h-8 rounded-full text-xs xl:inline-flex", publicationFilter === view.key && "bg-muted font-semibold")}>{view.label}<span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">{publicationCountsReady ? publicationCounts[view.key as keyof typeof publicationCounts] : "—"}</span></Button>)}
              <Button variant="ghost" size="sm" className="ml-auto h-9 self-end sm:self-auto" aria-label="Refresh runs and publishing status" disabled={content.isFetching} onClick={() => { void refetchJobs(); void content.refetch(); }}><RefreshCw className={cn("h-3.5 w-3.5", content.isFetching && "animate-spin")} /></Button>
            </div>
            {(content.outputsError || content.publicationError) && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"><AlertCircle className="h-4 w-4 shrink-0" /><span>{content.outputsError ? "Content previews could not be loaded." : "Some publishing records could not be loaded."} Publishing filters are unavailable until this is resolved.</span><Button variant="outline" size="sm" onClick={() => { void content.refetch(); }}>Try again</Button></div>}

            {/* Bulk Actions Bar */}
            {selectedJobs.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/50 rounded-lg border">
                <span className="text-sm font-medium">
                  {selectedJobs.size} job{selectedJobs.size > 1 ? 's' : ''} selected
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                  disabled={bulkDeleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete Selected
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedJobs(new Set())}
                >
                  Clear Selection
                </Button>
              </div>
            )}
          </div>

          {/* Video Projects */}
          <VideoProjectsSection searchQuery={searchQuery} />

          {/* Jobs List */}
          <div className="space-y-3">
          {jobsError ? (
            <div role="alert" className="rounded-xl border p-8 text-center"><AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" /><h2 className="font-semibold">Runs couldn’t be loaded</h2><p className="mt-1 text-sm text-muted-foreground">Try again to see your content and publishing activity.</p><Button variant="outline" className="mt-4" onClick={() => { void refetchJobs(); }}>Try again</Button></div>
          ) : isLoading || (publicationFilter !== "all" && (content.isLoading || content.isPublicationLoading)) ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="border rounded-xl p-4 animate-pulse">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-11 h-11 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="w-36 h-2 hidden md:block rounded-full" />
                  <Skeleton className="w-20 h-6 rounded-full" />
                </div>
              </div>
            ))
          ) : filteredJobs && filteredJobs.length > 0 ? (
            <>
              {/* Select All Header */}
              <div className="flex items-center gap-3 px-4 py-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label="Select all jobs"
                  className={someSelected ? "data-[state=checked]:bg-primary/50" : ""}
                />
                <span className="text-xs">
                  {filteredJobs.length} shown · {totalCount} run{totalCount !== 1 ? 's' : ''} in this generation view
                  <span className="ml-2">Page {currentPage} of {totalPages}</span>
                </span>
              </div>

              {filteredJobs.map((job) => {
                const pipelineInfo = getPipelineInfo(job.pipeline);
                const displayName = getJobDisplayName(job);
                const summary = content.summaries[job.id];
                const outputs = summary?.outputs || [];
                const counts = getJobContentCounts(summary);
                const isSelected = selectedJobs.has(job.id);
                const creationStatus = counts.review ? "review" : counts.generating ? "processing" : counts.failed ? "failed" : job.status;
                const creationLabel = counts.review ? "Needs review" : counts.generating ? "Generating" : counts.failed && counts.created ? "Partly created" : creationStatus === "completed" ? "Finished" : undefined;
                const requested = Array.isArray(job.items) ? job.items.length : 0;
                const href = job.video_project_id ? `/editor/${job.video_project_id}` : `/jobs/${job.id}${outputs[0] ? `?piece=${outputs[0].id}` : ""}`;
                return (
                  <article key={job.id} className={cn("rounded-xl border bg-card p-4 transition-colors", isSelected && "border-amber-500 bg-amber-500/5")}>
                    <div className="flex items-start gap-3">
                      <Checkbox className="mt-1" checked={isSelected} onCheckedChange={checked => handleSelectJob(job.id, checked === true)} aria-label={`Select ${displayName.title}`} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <EditableJobName jobId={job.id} currentName={job.name} fallbackName={displayName.title} onNavigate={() => handleRowClick(job.id)} />
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"><span>{pipelineInfo.label}</span><span>·</span><time dateTime={job.created_at}>{displayName.subtitle}</time>{displayName.blueprintTag && <Badge variant="secondary" className="max-w-full break-words whitespace-normal text-[10px]">{displayName.blueprintTag}</Badge>}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete ${displayName.title}`} onClick={e => handleDeleteClick(e, job.id, displayName.title)} disabled={deleteMutation.isPending}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                        <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 sm:gap-4 sm:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_minmax(220px,280px)]">
                          <JobContentPreview jobId={job.id} outputs={outputs} isLoading={content.isLoading} hasError={!!content.outputsError} jobStatus={job.status} editorId={job.video_project_id} />
                          <div className="min-w-0 space-y-3">
                            <div>
                              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Creation</p>
                              <div className="flex flex-wrap items-center gap-2"><JobStatusBadge status={creationStatus} label={creationLabel} />{!content.isLoading && !content.outputsError && <span className="text-sm font-medium">{counts.created} / {requested || outputs.length} created</span>}</div>
                              {!content.isLoading && !content.outputsError && <p className="mt-1.5 text-xs text-muted-foreground">{[counts.review ? `${counts.review} awaiting review` : "", counts.generating ? `${counts.generating} generating` : "", counts.failed ? `${counts.failed} failed` : "", counts.discarded ? `${counts.discarded} discarded` : ""].filter(Boolean).join(" · ") || (counts.created ? "Content is ready to open" : "No finished content yet")}</p>}
                            </div>
                            {outputs[0]?.excerpt && <p className="line-clamp-3 break-words text-sm leading-relaxed text-muted-foreground">{outputs[0].excerpt}</p>}
                            {job.error && <p className="line-clamp-2 break-words text-xs text-destructive" title={job.error}>{job.error}</p>}
                            <div className="flex flex-wrap items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => navigate(href)}>{counts.review ? "Review content" : outputs.length ? "Open content" : "View run"}<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
                              {job.status === "failed" && !content.isLoading && !content.outputsError && !counts.created && <Button variant="outline" size="sm" disabled={retryMutation.isPending} onClick={() => retryMutation.mutate(job.id)}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", retryMutation.isPending && "animate-spin")} />Retry run</Button>}
                            </div>
                          </div>
                          <div className="col-span-2 min-w-0 border-t pt-3 xl:col-span-1 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0"><JobPublicationDetails targets={summary?.targets || []} outputs={outputs} isLoading={content.isPublicationLoading} hasError={!!(content.publicationError || content.outputsError)} hasOutputs={counts.created > 0} /></div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}

            </>
          ) : (
            <div className="text-center py-20 bg-gradient-to-b from-muted/30 to-muted/10 rounded-2xl border border-dashed">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-muted/50 flex items-center justify-center">
                <LayoutGrid className="h-8 w-8 text-muted-foreground/50" />
              </div>
              <h3 className="text-xl font-semibold mb-2">No runs to show</h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
                {totalCount > 0 || searchQuery || statusFilter !== "all" || publicationFilter !== "all"
                  ? "Nothing on this page matches these filters. Clear filters or browse another page."
                  : "Create your first run to see generated content and track publication here."}
              </p>
              <Button
                variant="cta"
                onClick={() => totalCount > 0 || searchQuery || statusFilter !== "all" || publicationFilter !== "all" ? resetFilters() : navigate("/create")}
                size="lg"
                className="shadow-lg"
              >
                <Plus className="h-4 w-4 mr-2" />
                {totalCount > 0 || searchQuery || statusFilter !== "all" || publicationFilter !== "all" ? "Clear filters" : "Create content"}
              </Button>
            </div>
            )}
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
          </div>

          {/* Single Delete Dialog */}
          <DeleteConfirmDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            onConfirm={handleDeleteConfirm}
            itemName={jobToDelete?.name || ""}
            itemType="job"
          />

          {/* Bulk Delete Dialog */}
          <DeleteConfirmDialog
            open={bulkDeleteDialogOpen}
            onOpenChange={setBulkDeleteDialogOpen}
            onConfirm={handleBulkDeleteConfirm}
            itemName={`${selectedJobs.size} job${selectedJobs.size > 1 ? 's' : ''}`}
            itemType="jobs"
          />
        </div>
      </div>
    </AppLayout>
  );
}
