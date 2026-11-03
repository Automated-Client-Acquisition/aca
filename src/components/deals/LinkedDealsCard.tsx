import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Handshake, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type CrmDeal, formatMoney, useDealPipelines, useLinkedDeals } from "@/hooks/crm/useDeals";
import { DealDialog } from "./DealDialog";
import type { PickedCompany, PickedContact } from "./DealLinkPickers";

/** Deals linked to a contact or a company, with a quick "add deal". */
export function LinkedDealsCard({ contact, company }: { contact?: PickedContact | null; company?: PickedCompany | null }) {
  const { data: pipelines = [] } = useDealPipelines();
  const { data: deals = [], isLoading } = useLinkedDeals({ contactId: contact?.id, companyId: contact ? undefined : company?.id });
  const [dialog, setDialog] = useState<{ deal?: CrmDeal | null } | null>(null);

  const stageById = useMemo(
    () => Object.fromEntries(pipelines.flatMap((p) => p.stages).map((s) => [s.id, s])),
    [pipelines],
  );
  const openValue = deals.filter((d) => d.status === "open").reduce((s, d) => s + Number(d.value || 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Handshake className="h-4 w-4" /> Deals
          {deals.length > 0 && <span className="font-normal text-muted-foreground">{formatMoney(openValue, deals[0]?.currency, true)} open</span>}
        </CardTitle>
        <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => setDialog({})} disabled={pipelines.length === 0}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? null : deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deals yet.</p>
        ) : (
          deals.map((d) => {
            const stage = stageById[d.stage_id];
            return (
              <button
                key={d.id}
                onClick={() => setDialog({ deal: d })}
                className="w-full rounded-md border p-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{d.name}</span>
                  <span className="shrink-0 text-sm tabular-nums">{formatMoney(Number(d.value), d.currency)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage?.color }} />
                    {stage?.name ?? "Stage"}
                  </span>
                  {d.status !== "open" && (
                    <Badge variant={d.status === "won" ? "default" : "secondary"} className="h-4 px-1.5 text-[10px] capitalize">
                      {d.status}
                    </Badge>
                  )}
                  {d.status === "open" && d.expected_close_date && <span>Close {format(parseISO(d.expected_close_date), "MMM d")}</span>}
                </div>
              </button>
            );
          })
        )}
        {deals.length > 0 && (
          <Link to="/deals" className="block pt-1 text-xs text-muted-foreground hover:text-foreground">
            Open pipeline board
          </Link>
        )}
      </CardContent>

      <DealDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        pipelines={pipelines}
        deal={dialog?.deal}
        defaultContact={contact}
        defaultCompany={company}
      />
    </Card>
  );
}
