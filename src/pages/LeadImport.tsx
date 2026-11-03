import { useState, useCallback, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Papa from "papaparse";
import { ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportMethodsSidebar } from "@/components/lead-import/ImportMethodsSidebar";
import { CSVUploader } from "@/components/lead-import/CSVUploader";
import { CSVFieldMapper, FieldMapping, type PendingCustomField } from "@/components/lead-import/CSVFieldMapper";
import { buildAutoFieldMappings } from "@/lib/csv-field-detection";
import { CSVPreview } from "@/components/lead-import/CSVPreview";
import { ListSelector } from "@/components/lead-import/ListSelector";
import { ImportProgress } from "@/components/lead-import/ImportProgress";
import { PostReactorsImport } from "@/components/lead-import/PostReactorsImport";
import { EventAttendeesImport } from "@/components/lead-import/EventAttendeesImport";
import { LinkedInImportProgress } from "@/components/lead-import/LinkedInImportProgress";
import { LinkedInSearchDetail } from "@/components/lead-import/linkedin-search/LinkedInSearchDetail";
import { ApifyLeadsFinderForm } from "@/components/lead-import/ApifyLeadsFinderForm";
import { ApifyLeadsImportProgress } from "@/components/lead-import/ApifyLeadsImportProgress";
import { useStartApifyLeadsImport, type ApifyLeadsSearchConfig } from "@/hooks/useApifyLeadsImport";
import { ManualLeadForm, type ManualLeadData } from "@/components/lead-import/ManualLeadForm";
import { ComingSoonPlaceholder } from "@/components/lead-import/placeholders/ComingSoonPlaceholder";
import { IMPORT_SOURCES, type ImportSourceId } from "@/config/importSources";
import { useLeadLists } from "@/hooks/useLeadLists";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import { useAuth } from "@/contexts/AuthContext";
import { useStartLinkedInImport, type LinkedInImportType, type SearchMode, type ApiType, type SearchParams } from "@/hooks/useLinkedInImport";
import { useAddLeadListSources } from "@/hooks/useLeadListSources";
import { useStartCSVImport, useCSVImportJob } from "@/hooks/useCSVImportJob";
import { useCustomFieldDefs, useCreateCustomFieldDefs } from "@/hooks/useCustomFieldDefs";
import { useCreateContact } from "@/hooks/crm/useContacts";
import { useAddLeadListMember } from "@/hooks/useLeadListMembers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type ImportStep =
  | "browse"
  | "csv_upload"
  | "csv_map"
  | "csv_preview"
  | "list_select"
  | "importing"
  | "linkedin_importing"
  | "apify_importing"
  | "complete";

interface ImportState {
  sourceType: ImportSourceId | null;
  file: File | null;
  headers: string[];
  data: Record<string, string>[];
  mappings: FieldMapping[];
  pendingCustomFields: PendingCustomField[];
  selectedListId: string | null;
  newListName: string;
  importedCount: number;
  skippedCount: number;
  skipReasons: Record<string, number> | null;
  progress: number;
  error: string | null;
  linkedInJobId: string | null;
  csvImportJobId: string | null;
  apifyJobId: string | null;
}

export default function LeadImport() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentOrganization } = useAuth();
  const { leadLists } = useLeadLists();
  const { data: unipileData } = useUnipileAccounts();
  const startLinkedInImport = useStartLinkedInImport();
  const addListSources = useAddLeadListSources();
  const startApifyImport = useStartApifyLeadsImport();
  const startCSVImport = useStartCSVImport();
  const createContact = useCreateContact();
  const addLeadListMember = useAddLeadListMember();

  // Get pre-selected list and source from URL params
  const preSelectedListId = searchParams.get("listId");
  const preSelectedSource = searchParams.get("source") as ImportSourceId | null;

  const hasLinkedInAccount = (unipileData?.linkedinAccounts?.length ?? 0) > 0;

  const { data: existingCustomFields } = useCustomFieldDefs();
  const createCustomFieldDefs = useCreateCustomFieldDefs();

  const [step, setStep] = useState<ImportStep>("browse");
  const [state, setState] = useState<ImportState>({
    sourceType: preSelectedSource,
    file: null,
    headers: [],
    data: [],
    mappings: [],
    pendingCustomFields: [],
    selectedListId: preSelectedListId,
    newListName: "",
    importedCount: 0,
    skippedCount: 0,
    skipReasons: null,
    progress: 0,
    error: null,
    linkedInJobId: null,
    csvImportJobId: null,
    apifyJobId: null,
  });

  // Poll for CSV import job status
  const { data: csvImportJob } = useCSVImportJob(state.csvImportJobId);

  // Update state when CSV import job changes
  useEffect(() => {
    if (!csvImportJob) return;

    setState((s) => ({
      ...s,
      progress: csvImportJob.progress,
      importedCount: csvImportJob.imported_count,
      skippedCount: csvImportJob.skipped_count,
      skipReasons: csvImportJob.skip_reasons || null,
    }));

    if (csvImportJob.status === 'completed') {
      setStep('complete');
      toast.success(`Successfully imported ${csvImportJob.imported_count} contacts`);
    } else if (csvImportJob.status === 'failed') {
      setState((s) => ({ ...s, error: csvImportJob.error_message || 'Import failed' }));
      toast.error(`Import failed: ${csvImportJob.error_message || 'Unknown error'}`);
    }
  }, [csvImportJob]);

  // Get pre-selected list name for display
  const preSelectedList = leadLists.find((l) => l.id === preSelectedListId);

  // Initialize with URL params on mount
  useEffect(() => {
    if (preSelectedSource && IMPORT_SOURCES.some((s) => s.id === preSelectedSource && s.available)) {
      setState((s) => ({ ...s, sourceType: preSelectedSource }));
    }
    if (preSelectedListId) {
      setState((s) => ({ ...s, selectedListId: preSelectedListId }));
    }
  }, [preSelectedSource, preSelectedListId]);

  // Check for any active import jobs for this list on mount
  useEffect(() => {
    const checkActiveJobs = async () => {
      if (!preSelectedListId) return;

      // Check for active CSV import jobs first
      const { data: activeCsvJobs } = await supabase
        .from('csv_import_jobs')
        .select('id, status, progress, imported_count, skipped_count')
        .eq('target_list_id', preSelectedListId)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (activeCsvJobs && activeCsvJobs.length > 0) {
        const job = activeCsvJobs[0];
        setState((s) => ({
          ...s,
          csvImportJobId: job.id,
          sourceType: 'csv',
          progress: job.progress,
          importedCount: job.imported_count,
          skippedCount: job.skipped_count,
        }));
        setStep('importing');
        return; // Don't check LinkedIn jobs if we have an active CSV job
      }

      // Check for active Apify leads import jobs
      const { data: activeApifyJobs } = await supabase
        .from('apify_leads_import_jobs')
        .select('id, status')
        .eq('target_list_id', preSelectedListId)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (activeApifyJobs && activeApifyJobs.length > 0) {
        setState((s) => ({
          ...s,
          apifyJobId: activeApifyJobs[0].id,
          sourceType: 'apify_leads_finder',
        }));
        setStep('apify_importing');
        return;
      }

      // Check for active LinkedIn import jobs
      const { data: activeJobs } = await supabase
        .from('linkedin_import_jobs')
        .select('id, status, type')
        .eq('target_list_id', preSelectedListId)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (activeJobs && activeJobs.length > 0) {
        const job = activeJobs[0];
        setState((s) => ({
          ...s,
          linkedInJobId: job.id,
          sourceType: job.type === 'post_reactors' || job.type === 'post_commenters'
            ? 'post_reactors'
            : job.type === 'event_attendees'
            ? 'event_attendees'
            : job.type === 'search'
            ? 'linkedin_search'
            : job.type === 'sales_nav'
            ? 'sales_nav_leads'
            : job.type === 'recruiter'
            ? 'linkedin_recruiter'
            : null,
        }));
        setStep('linkedin_importing');
      }
    };

    checkActiveJobs();
  }, [preSelectedListId]);

  const handleSourceSelect = (sourceId: ImportSourceId) => {
    setState((s) => ({ ...s, sourceType: sourceId }));
  };

  const handleFileSelected = useCallback((file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const data = results.data as Record<string, string>[];

        // Auto-detect mappings from header names
        const mappings: FieldMapping[] = buildAutoFieldMappings(headers);

        setState((s) => ({
          ...s,
          file,
          headers,
          data,
          mappings,
        }));
        setStep("csv_map");
      },
      error: (error) => {
        toast.error(`Failed to parse CSV: ${error.message}`);
      },
    });
  }, []);

  const handleClearFile = () => {
    setState((s) => ({
      ...s,
      file: null,
      headers: [],
      data: [],
      mappings: [],
      pendingCustomFields: [],
    }));
    setStep("browse");
  };

  const handleCustomFieldCreate = (field: PendingCustomField) => {
    setState((s) => {
      // Avoid duplicates
      if (s.pendingCustomFields.some((f) => f.field_key === field.field_key)) return s;
      return { ...s, pendingCustomFields: [...s.pendingCustomFields, field] };
    });
  };

  const handleMappingsChange = (mappings: FieldMapping[]) => {
    setState((s) => ({ ...s, mappings }));
  };

  const handleListSelect = (listId: string | null) => {
    setState((s) => ({ ...s, selectedListId: listId }));
  };

  const handleNewListNameChange = (name: string) => {
    setState((s) => ({ ...s, newListName: name }));
  };

  // Check if required fields are mapped
  const isMappingValid = state.mappings.some((m) => m.targetField === "email");

  // Check if list selection is valid
  const isListValid = state.selectedListId || state.newListName.trim().length > 0;

  // Helper to get or create list
  const getOrCreateListId = async (overrideListName?: string): Promise<string> => {
    if (state.selectedListId) {
      return state.selectedListId;
    }

    const listName = overrideListName || state.newListName;
    if (!listName.trim()) {
      throw new Error("No list selected");
    }

    if (!currentOrganization?.id) {
      throw new Error("No organization selected");
    }

    const sourceType = state.sourceType === "csv"
      ? "csv"
      : state.sourceType === "apify_leads_finder"
      ? "apify_leads_finder"
      : state.sourceType === "linkedin_search"
      ? "linkedin_search"
      : state.sourceType === "post_reactors"
      ? "post_reactors"
      : "event";

    const { data: newList, error: listError } = await supabase
      .from("lead_lists")
      .insert([{
        name: listName.trim(),
        source_type: sourceType,
        source_config: {},
        organization_id: currentOrganization.id,
      }])
      .select()
      .single();

    if (listError) throw listError;
    return newList.id;
  };

  // Handle LinkedIn import start
  const handleLinkedInImportStart = async (config: {
    type: LinkedInImportType;
    sourceUrl: string;
    accountId: string;
    maxLeads?: number;
    searchMode?: SearchMode;
    apiType?: ApiType;
    searchParams?: SearchParams;
    includeReactors?: boolean;
    includeCommenters?: boolean;
    reactionTypes?: string[];
    listName?: string;
    keepSynced?: boolean;
    watchDays?: number;
  }) => {
    try {
      // Use provided list name or generate a default one
      const listName = config.listName || state.newListName || `Import ${new Date().toLocaleDateString()}`;
      if (!listName.trim()) {
        toast.error("No list selected");
        return;
      }
      setState((s) => ({ ...s, newListName: listName }));

      // Pass listName directly since setState is async
      const listId = await getOrCreateListId(listName);

      const job = await startLinkedInImport.mutateAsync({
        type: config.type,
        sourceUrl: config.sourceUrl,
        accountId: config.accountId,
        targetListId: listId,
        maxLeads: config.maxLeads,
        searchMode: config.searchMode,
        apiType: config.apiType,
        searchParams: config.searchParams,
        includeReactors: config.includeReactors,
        includeCommenters: config.includeCommenters,
        reactionTypes: config.reactionTypes,
      });

      // "Keep synced" attaches the post as a dynamic source: the background
      // poller keeps adding new engagers after this one-shot import finishes.
      if (config.keepSynced && config.sourceUrl) {
        try {
          await addListSources.mutateAsync({
            listId,
            sources: [{ sourceType: "linkedin_post", url: config.sourceUrl }],
            accountId: config.accountId,
            includeReactors: config.includeReactors,
            includeCommenters: config.includeCommenters,
            reactionTypes: config.reactionTypes,
            watchDays: config.watchDays,
          });
          toast.success("Auto-sync enabled — new engagement will keep flowing into this list");
        } catch (sourceError) {
          // Non-fatal: the one-shot import still runs
          console.error("Failed to enable auto-sync source:", sourceError);
          toast.error("Import started, but auto-sync could not be enabled");
        }
      }

      setState((s) => ({ ...s, linkedInJobId: job.id, selectedListId: listId }));
      setStep("linkedin_importing");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start import";
      toast.error(errorMessage);
    }
  };

  // Handle Apify Leads Finder import start
  const handleApifyImportStart = async (
    searchConfig: ApifyLeadsSearchConfig,
    totalRequested: number,
    batchSize: number
  ) => {
    try {
      if (!currentOrganization?.id) {
        toast.error("No organization selected");
        return;
      }

      const listName = state.newListName || `B2B Leads ${new Date().toLocaleDateString()}`;

      const job = await startApifyImport.mutateAsync({
        listName,
        listId: state.selectedListId || undefined,
        searchConfig,
        totalRequested,
        batchSize,
      });

      toast.success(`Importing ${totalRequested.toLocaleString()} leads in the background`);
      navigate(`/leads/lists/${job.target_list_id}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to start import";
      toast.error(errorMessage);
    }
  };

  const runCSVImport = async () => {
    setStep("importing");
    setState((s) => ({ ...s, progress: 0, importedCount: 0, skippedCount: 0, skipReasons: null, error: null, csvImportJobId: null }));

    try {
      if (!currentOrganization?.id) {
        throw new Error("No organization selected");
      }

      if (!state.file) {
        throw new Error("No file selected");
      }

      // Persist custom field definitions before starting import
      if (state.pendingCustomFields.length > 0) {
        await createCustomFieldDefs.mutateAsync(state.pendingCustomFields);
      }

      const listId = await getOrCreateListId();

      // Start the async import job (file-based)
      const job = await startCSVImport.mutateAsync({
        targetListId: listId,
        filename: state.file.name,
        fieldMappings: state.mappings,
        csvFile: state.file, // Pass the actual file for upload to storage
        totalRows: state.data.length,
      });

      // Store the job ID so we can poll for progress
      setState((s) => ({ ...s, csvImportJobId: job.id, selectedListId: listId }));

      // The useEffect watching csvImportJob will handle updating progress and completion
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setState((s) => ({ ...s, error: errorMessage }));
      toast.error(`Import failed: ${errorMessage}`);
    }
  };

  // Handle manual lead creation
  const handleManualLeadSubmit = async (data: ManualLeadData) => {
    const displayName = [data.first_name, data.last_name].filter(Boolean).join(" ");

    const contact = await createContact.mutateAsync({
      display_name: displayName,
      first_name: data.first_name,
      last_name: data.last_name || undefined,
      primary_email: data.primary_email || undefined,
      primary_linkedin_url: data.primary_linkedin_url || undefined,
      instagram_url: data.instagram_url || undefined,
      company: data.company || undefined,
      job_title: data.job_title || undefined,
      primary_phone: data.primary_phone || undefined,
      company_website: data.company_website || undefined,
      city: data.city || undefined,
      state: data.state || undefined,
      country: data.country || undefined,
      source: "manual",
    });

    // Add to the pre-selected list if one exists
    if (preSelectedListId) {
      await addLeadListMember.mutateAsync({
        list_id: preSelectedListId,
        contact_id: contact.id,
        source_data: { added_via: "manual_import" },
      });
    }
  };

  // Get the selected source info
  const selectedSource = IMPORT_SOURCES.find((s) => s.id === state.sourceType);

  // Render the detail panel content based on source type and step
  const renderDetailContent = () => {
    // Show progress states
    if (step === "importing") {
      return (
        <ImportProgress
          status={state.error ? "error" : csvImportJob?.status === 'completed' ? "complete" : "importing"}
          progress={state.progress}
          totalRows={state.data.length}
          importedCount={state.importedCount}
          skippedCount={state.skippedCount}
          skipReasons={state.skipReasons}
          errorMessage={state.error || undefined}
          targetListId={state.selectedListId}
          onNavigateAway={() => {
            if (state.selectedListId) {
              navigate(`/leads/lists/${state.selectedListId}`);
            } else {
              navigate("/leads/lists");
            }
          }}
        />
      );
    }

    if (step === "apify_importing" && state.apifyJobId) {
      return (
        <ApifyLeadsImportProgress
          jobId={state.apifyJobId}
          onComplete={(job) => {
            if (job.status === "completed") {
              setState((s) => ({
                ...s,
                importedCount: job.total_imported,
                skippedCount: job.total_skipped,
              }));
              setStep("complete");
            }
          }}
        />
      );
    }

    if (step === "linkedin_importing" && state.linkedInJobId) {
      return (
        <LinkedInImportProgress
          jobId={state.linkedInJobId}
          onComplete={(job) => {
            if (job.status === "completed") {
              setState((s) => ({
                ...s,
                importedCount: job.total_imported,
                skippedCount: job.total_skipped,
              }));
              setStep("complete");
            }
          }}
        />
      );
    }

    if (step === "complete") {
      return (
        <div className="space-y-6">
          <ImportProgress
            status="complete"
            progress={100}
            totalRows={state.data.length || state.importedCount + state.skippedCount}
            importedCount={state.importedCount}
            skippedCount={state.skippedCount}
            skipReasons={state.skipReasons}
            errorMessage={state.error || undefined}
          />
          <Button onClick={() => navigate("/leads/lists")} className="w-full">
            Go to Lists
          </Button>
        </div>
      );
    }

    // No source selected - show welcome state
    if (!state.sourceType) {
      return (
        <div className="flex flex-col items-center justify-center h-full py-16 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center mb-6">
            <img
              src="https://content.linkedin.com/content/dam/me/business/en-us/amp/brand-site/v2/bg/LI-Bug.svg.original.svg"
              alt="LinkedIn"
              className="w-10 h-10"
            />
          </div>
          <h2 className="text-xl font-semibold mb-2">Import from LinkedIn search bar</h2>
          <p className="text-muted-foreground max-w-md">
            Start a new search to find unlimited, unique leads on LinkedIn! Search and filter by position, company, industry, location and much more.
          </p>
        </div>
      );
    }

    // Coming soon sources
    if (selectedSource?.comingSoon) {
      return <ComingSoonPlaceholder source={selectedSource} />;
    }

    // CSV Import flow
    if (state.sourceType === "csv") {
      if (step === "csv_map") {
        return (
          <div className="space-y-6">
            <CSVFieldMapper
              headers={state.headers}
              mappings={state.mappings}
              onMappingsChange={handleMappingsChange}
              previewData={state.data.slice(0, 5)}
              existingCustomFields={existingCustomFields || []}
              pendingCustomFields={state.pendingCustomFields}
              onCustomFieldCreate={handleCustomFieldCreate}
            />
            <div className="flex gap-4">
              <Button variant="outline" onClick={handleClearFile}>
                Back
              </Button>
              <Button
                variant="cta"
                onClick={() => setStep("csv_preview")}
                disabled={!isMappingValid}
                className="flex-1"
              >
                Continue
              </Button>
            </div>
          </div>
        );
      }

      if (step === "csv_preview") {
        return (
          <div className="space-y-6">
            <CSVPreview
              data={state.data}
              mappings={state.mappings}
              totalRows={state.data.length}
            />
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => setStep("csv_map")}>
                Back
              </Button>
              <Button variant="cta" onClick={() => setStep("list_select")} className="flex-1">
                Continue
              </Button>
            </div>
          </div>
        );
      }

      if (step === "list_select") {
        return (
          <div className="space-y-6">
            <ListSelector
              lists={leadLists}
              selectedListId={state.selectedListId}
              newListName={state.newListName}
              onSelectList={handleListSelect}
              onNewListNameChange={handleNewListNameChange}
            />
            <div className="flex gap-4">
              <Button variant="outline" onClick={() => setStep("csv_preview")}>
                Back
              </Button>
              <Button variant="cta" onClick={runCSVImport} disabled={!isListValid} className="flex-1">
                Start Import
              </Button>
            </div>
          </div>
        );
      }

      // Default: CSV upload
      return (
        <CSVUploader
          onFileSelected={handleFileSelected}
          selectedFile={state.file}
          onClear={handleClearFile}
        />
      );
    }

    // LinkedIn Search, Sales Navigator, and Recruiter all use the same component
    if (state.sourceType === "linkedin_search" || state.sourceType === "sales_nav_leads" || state.sourceType === "linkedin_recruiter") {
      return (
        <LinkedInSearchDetail
          onStartImport={handleLinkedInImportStart}
          isStarting={startLinkedInImport.isPending}
          sourceType={state.sourceType}
          preSelectedListId={preSelectedListId}
          preSelectedListName={preSelectedList?.name}
        />
      );
    }

    // Post Reactors
    if (state.sourceType === "post_reactors") {
      return (
        <PostReactorsImport
          targetListId={state.selectedListId || ""}
          onStartImport={handleLinkedInImportStart}
          isStarting={startLinkedInImport.isPending}
        />
      );
    }

    // Event Attendees
    if (state.sourceType === "event_attendees") {
      return (
        <EventAttendeesImport
          targetListId={state.selectedListId || ""}
          onStartImport={handleLinkedInImportStart}
          isStarting={startLinkedInImport.isPending}
        />
      );
    }

    // Apify B2B Lead Finder
    if (state.sourceType === "apify_leads_finder") {
      return (
        <ApifyLeadsFinderForm
          onSubmit={handleApifyImportStart}
          isLoading={startApifyImport.isPending}
        />
      );
    }

    // Manual Lead Entry
    if (state.sourceType === "manual") {
      return (
        <ManualLeadForm
          onSubmit={handleManualLeadSubmit}
          isSubmitting={createContact.isPending || addLeadListMember.isPending}
        />
      );
    }

    return null;
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 flex flex-col h-full">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-background flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              preSelectedListId
                ? navigate(`/leads/lists/${preSelectedListId}`)
                : navigate("/leads/lists")
            }
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {preSelectedList ? preSelectedList.name : "Leads"}
          </Button>
          {preSelectedList && (
            <span className="text-sm text-muted-foreground">
              Adding to list: <strong>{preSelectedList.name}</strong>
            </span>
          )}
        </div>

        {/* Two-column layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar - Import Methods */}
          <ImportMethodsSidebar
            selectedSource={state.sourceType}
            onSelectSource={handleSourceSelect}
            hasLinkedInAccount={hasLinkedInAccount}
          />

          {/* Right panel - Detail content */}
          <div className="flex-1 flex flex-col overflow-hidden bg-background">
            {/* Source Header */}
            {selectedSource && !selectedSource.comingSoon && step === "browse" && (
              <div className="p-6 border-b">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                      selectedSource.requiresLinkedIn
                        ? "bg-blue-100 text-blue-700"
                        : "bg-green-100 text-green-600"
                    }`}
                  >
                    <selectedSource.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-semibold">{selectedSource.title}</h2>
                    <p className="text-muted-foreground">{selectedSource.description}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {renderDetailContent()}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
