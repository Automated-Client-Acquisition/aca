import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OutputDetailPanel } from "@/components/jobs/OutputDetailPanel";
import { PushToGHLDialog } from "@/components/jobs/PushToGHLDialog";
import { useReviewActions } from "@/hooks/useReviewActions";
import { downloadImage, pieceCopyText, type Piece } from "@/lib/piece";
import { PiecePreview, type PieceAuthor } from "./PiecePreview";
import { RewriteBar } from "./RewriteBar";
import { ReviewSidebar, type MadeWith, type PublishInfo } from "./ReviewSidebar";
import { pieceLookOf } from "@/lib/image-looks";

interface PieceReviewProps {
  output: any;
  piece: Piece;
  job: any;
  organizationName?: string;
  publish?: PublishInfo;
  onPrevious: () => void;
  onNext: () => void;
  onDelete: () => void;
  index: number;
  count: number;
}

const ELEMENT_LABELS: [string[], string][] = [
  [["brand", "library_brand_voices"], "Brand"],
  [["icp", "library_icps"], "Audience"],
  [["product", "library_products"], "Product"],
  [["character", "library_characters"], "Person"],
];

function element(lib: Record<string, any>, keys: string[]): Record<string, any> | null {
  for (const k of keys) {
    const v = lib?.[k];
    const el = Array.isArray(v) ? v[0] : v;
    if (el && typeof el === "object" && el.name) return el;
  }
  return null;
}

export function PieceReview({ output, piece, job, organizationName, publish, onPrevious, onNext, onDelete, index, count }: PieceReviewProps) {
  const actions = useReviewActions(output, piece);
  const [publishOpen, setPublishOpen] = useState(false);
  const [behindOpen, setBehindOpen] = useState(false);

  const params = output?.generation_params ?? {};
  const lib: Record<string, any> = params.library_elements ?? {};

  const author: PieceAuthor = useMemo(() => {
    const person = element(lib, ["character", "library_characters"]);
    if (person) return { name: person.name, avatarUrl: person.reference_images?.[0] ?? null };
    const brand = element(lib, ["brand", "library_brand_voices"]);
    if (brand) return { name: brand.name, avatarUrl: brand.logo ?? brand.logos?.[0] ?? null };
    return { name: organizationName || "Your page" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output?.id, organizationName]);

  const madeWith: MadeWith = useMemo(() => {
    const cfg = job?.configuration ?? {};
    const blueprintId = job?.blueprint_id ?? cfg.blueprint_id ?? cfg.blueprint?.id;
    const blueprintName = cfg.blueprint_name ?? cfg.blueprint?.name;
    const elements: MadeWith["elements"] = [];
    for (const [keys, label] of ELEMENT_LABELS) {
      const el = element(lib, keys);
      if (el) elements.push({ label, name: String(el.name) });
    }
    const look = pieceLookOf(params);
    if (look) elements.push({ label: "Look", name: look.label });
    return {
      blueprint: blueprintId && blueprintName ? { id: blueprintId, name: blueprintName } : null,
      idea: output?.content_ideas?.title ?? params.slot_values?.topic ?? null,
      elements,
      cost: output?.generation_cost != null ? Number(output.generation_cost) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output?.id, job?.id]);

  const editable = piece.state !== "generating" && piece.state !== "discarded";
  const imageBusy = actions.newImage.isPending || actions.replaceImage.isPending;

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
      <div className="min-w-0 space-y-4">
        <PiecePreview
          piece={piece}
          author={author}
          editable={editable}
          savingText={actions.saveText.isPending}
          onSaveText={(t) => actions.saveText.mutateAsync(t)}
          imageBusy={imageBusy}
          onNewImage={(instructions) => actions.newImage.mutate(instructions)}
          onReplaceImage={(file) => actions.replaceImage.mutate(file)}
        />
        {editable && piece.textTarget && piece.text && (
          <RewriteBar
            key={output.id}
            text={piece.text}
            rewrite={(instruction) => actions.rewrite.mutateAsync({ text: piece.text, instruction })}
            onUse={(t) => actions.saveText.mutateAsync(t)}
            saving={actions.saveText.isPending}
          />
        )}
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <ReviewSidebar
          piece={piece}
          publish={publish}
          madeWith={madeWith}
          busy={{ continue: actions.continueRun.isPending, retry: actions.retry.isPending, status: actions.setStatus.isPending }}
          onPublish={() => setPublishOpen(true)}
          onCopy={async () => {
            try {
              await navigator.clipboard.writeText(pieceCopyText(piece));
              toast.success("Copied");
            } catch {
              toast.error("Your browser blocked copying");
            }
          }}
          onDownloadImage={piece.image ? () => downloadImage(piece, piece.image!) : undefined}
          onContinue={(stageId) => actions.continueRun.mutate(stageId)}
          onRetry={(stageId) => actions.retry.mutate(stageId)}
          onSetStatus={(s) => actions.setStatus.mutate(s)}
          onBehindTheScenes={() => setBehindOpen(true)}
        />
      </aside>

      <PushToGHLDialog key={output.id} open={publishOpen} onOpenChange={setPublishOpen} outputId={output.id} outputTitle={piece.title} outputData={output} />

      <Sheet open={behindOpen} onOpenChange={setBehindOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-5xl">
          <SheetHeader className="border-b px-5 py-3 text-left">
            <SheetTitle className="text-base">Behind the scenes</SheetTitle>
            <SheetDescription className="text-xs">Each step of this run: what it was asked, which model answered, and what came back. Changes here apply to this piece.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {behindOpen && (
              <OutputDetailPanel
                output={output}
                currentIndex={index}
                totalCount={count}
                onPrevious={onPrevious}
                onNext={onNext}
                onApprove={() => actions.setStatus.mutate("approved")}
                onReject={() => actions.setStatus.mutate("rejected")}
                onDelete={() => {
                  setBehindOpen(false);
                  onDelete();
                }}
                onCopy={() => navigator.clipboard.writeText(pieceCopyText(piece))}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
