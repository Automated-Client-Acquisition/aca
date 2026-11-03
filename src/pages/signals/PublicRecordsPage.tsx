import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Eye, EyeOff, ListPlus, Loader2, Search, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type PublicSignalRecord = {
  id: string;
  company_name: string;
  domain: string | null;
  signal_type: string;
  title: string | null;
  signal_date: string;
  source_label: string | null;
  source_url: string;
  verified: boolean;
  published: boolean;
  quality_score: number;
  created_at: string;
};

type PublicSignalResponse = {
  ok: boolean;
  error?: string;
  total_count: number;
  signals: PublicSignalRecord[];
};

const PAGE_SIZE = 50;

function signalLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function PublicRecordsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [includeUnpublished, setIncludeUnpublished] = useState(true);
  const [offset, setOffset] = useState(0);
  const [targetListId, setTargetListId] = useState("");
  const listsQuery = useQuery({ queryKey: ["public-signal-target-lists"], queryFn: async () => {
    const { data, error } = await supabase.from("lead_lists").select("id,name").eq("status", "active").order("name");
    if (error) throw error; return data ?? [];
  }});

  const recordsQuery = useQuery({
    queryKey: ["public-signal-records", search, includeUnpublished, offset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_public_signals", {
        p_limit: PAGE_SIZE,
        p_offset: offset,
        p_search: search.trim() || undefined,
        p_include_unpublished: includeUnpublished,
      });
      if (error) throw error;
      return data as unknown as PublicSignalResponse;
    },
  });

  const togglePublished = useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const { data, error } = await supabase.rpc("admin_set_public_signal_published", {
        p_id: id,
        p_published: published,
      });
      if (error) throw error;
      const result = data as unknown as { ok: boolean; error?: string };
      if (!result.ok) throw new Error(result.error ?? "Unable to update the public record");
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["public-signal-records"] });
      toast.success("Public visibility updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to update public visibility"),
  });
  const addToList = useMutation({ mutationFn: async (signalId: string) => {
    if (!targetListId) throw new Error("Choose a destination list first");
    // @ts-expect-error generated database types update with the migration
    const { data, error } = await supabase.rpc("add_public_signal_to_list", { p_signal_id: signalId, p_list_id: targetListId });
    if (error) throw error;
    const result = data as { ok: boolean; added?: number; already_in_list?: number; error?: string };
    if (!result.ok) throw new Error(result.error ?? "Unable to add this signal"); return result;
  }, onSuccess: (result) => toast.success(`${result.added ?? 0} vetted contact(s) added${result.already_in_list ? ` · ${result.already_in_list} already in list` : ""}`), onError: (e) => toast.error(e instanceof Error ? e.message : "Unable to add to list") });

  const result = recordsQuery.data;
  const records = result?.signals ?? [];
  const publishedCount = useMemo(() => records.filter((record) => record.published).length, [records]);
  const forbidden = result?.ok === false && result.error === "forbidden";

  const updateSearch = (value: string) => {
    setSearch(value);
    setOffset(0);
  };

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="container mx-auto py-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Button variant="ghost" size="sm" className="-ml-2 mb-2" asChild>
              <Link to="/signals/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Signals</Link>
            </Button>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-bold">Public records</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Review the curated Hermes signal feed before it appears on the public Signals page. Private customer SignalBase packs never appear here.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/signals" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4 mr-2" /> View public page</a>
          </Button>
        </div>

        {forbidden ? (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-8 text-center">
              <h2 className="font-semibold">Public-record access required</h2>
              <p className="text-sm text-muted-foreground mt-1">Only members of the ACA public-signals workspace can review or publish these records.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card><CardContent className="py-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Matching records</p><p className="mt-1 text-2xl font-bold">{result?.total_count ?? "—"}</p></CardContent></Card>
              <Card><CardContent className="py-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Published on this page</p><p className="mt-1 text-2xl font-bold text-emerald-600">{recordsQuery.isLoading ? "—" : publishedCount}</p></CardContent></Card>
              <Card><CardContent className="py-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Source contract</p><p className="mt-1 text-sm font-medium">Hermes verified web</p></CardContent></Card>
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-[16rem]"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search company, domain, or summary…" /></div>
              <Button variant={includeUnpublished ? "secondary" : "outline"} size="sm" onClick={() => { setIncludeUnpublished((value) => !value); setOffset(0); }}>
                {includeUnpublished ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />} {includeUnpublished ? "Showing staged" : "Published only"}
              </Button>
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={targetListId} onChange={(event) => setTargetListId(event.target.value)}>
                <option value="">Choose a destination list…</option>{(listsQuery.data ?? []).map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
              </select>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base">Feed records</CardTitle></CardHeader>
              <CardContent className="p-0">
                {recordsQuery.isLoading ? <div className="space-y-3 p-6"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : (
                  <div className="divide-y">
                    {records.map((record) => (
                      <div key={record.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{record.company_name}</p><Badge variant="outline" className="capitalize">{signalLabel(record.signal_type)}</Badge>{record.verified && <Badge className="bg-emerald-600 hover:bg-emerald-600">Verified</Badge>}</div>
                          <p className="mt-1 truncate text-sm text-muted-foreground">{record.title || record.domain || "No title"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{record.source_label || "Source"} · {format(new Date(record.signal_date), "MMM d, yyyy")} · quality {Math.round(Number(record.quality_score || 0) * 100)}%</p>
                        </div>
                        <a href={record.source_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="Open source"><ExternalLink className="h-4 w-4" /></a>
                        <Button variant="outline" size="sm" disabled={!targetListId || addToList.isPending || !record.published} onClick={() => addToList.mutate(record.id)}><ListPlus className="mr-2 h-4 w-4" /> Add to list</Button>
                        <div className="flex items-center gap-2"><Switch checked={record.published} disabled={togglePublished.isPending} onCheckedChange={(published) => togglePublished.mutate({ id: record.id, published })} /><span className="text-sm w-16">{record.published ? "Public" : "Staged"}</span></div>
                      </div>
                    ))}
                    {records.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No public signal records match this view.</p>}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-between"><Button variant="outline" size="sm" disabled={offset === 0 || recordsQuery.isFetching} onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}>Previous</Button><Button variant="outline" size="sm" disabled={records.length < PAGE_SIZE || recordsQuery.isFetching} onClick={() => setOffset((value) => value + PAGE_SIZE)}>Next</Button></div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
