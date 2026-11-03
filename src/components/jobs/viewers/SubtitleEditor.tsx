import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Subtitles, RotateCcw, Wand2, Pencil, Save, X, Check, ChevronDown } from "lucide-react";
import { CAPTION_STYLE_TEMPLATES } from "@/data/captionStyleTemplates";
import { useRenderSubtitles, useTranscribeAudio, useSaveSubtitleEdits } from "@/hooks/useSubtitleRender";

interface SubtitleTranscription {
  status: 'generating' | 'completed' | 'failed';
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{
    id: number;
    text: string;
    start: number;
    end: number;
    words: Array<{ word: string; start: number; end: number }>;
  }>;
  source_audio_url?: string;
  source?: string;
  edited?: boolean;
  completed_at?: string;
  error?: string;
}

interface SubtitleRender {
  status: 'generating' | 'completed' | 'failed';
  video_url?: string;
  source_video_url?: string;
  template_id?: string;
  error?: string;
}

interface SubtitleEditorProps {
  outputId: string;
  transcription?: SubtitleTranscription;
  render?: SubtitleRender;
  defaultTemplateId?: string;
  originalVideoUrl?: string;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export function SubtitleEditor({
  outputId,
  transcription,
  render,
  defaultTemplateId,
}: SubtitleEditorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState(
    render?.template_id || defaultTemplateId || 'clean_white'
  );
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [expanded, setExpanded] = useState(false);

  const renderSubtitles = useRenderSubtitles();
  const transcribeAudio = useTranscribeAudio();
  const saveEdits = useSaveSubtitleEdits();

  const isTranscribing = transcription?.status === 'generating';
  const isRendering = render?.status === 'generating';
  const isCompleted = render?.status === 'completed';
  const hasTranscription = transcription?.status === 'completed' && !!transcription.segments;
  const isInProgress = isTranscribing || isRendering;

  const handleRender = () => {
    renderSubtitles.mutate({ outputId, templateId: selectedTemplate });
  };

  const handleRetranscribe = () => {
    transcribeAudio.mutate({ outputId });
  };

  const handleStartEdit = (segment: { id: number; text: string }) => {
    setEditingSegmentId(segment.id);
    setEditText(segment.text);
  };

  const handleSaveEdit = () => {
    if (editingSegmentId === null || !transcription?.segments) return;

    const updatedSegments = transcription.segments.map(seg => {
      if (seg.id !== editingSegmentId) return seg;

      const newWords = editText.split(/\s+/).filter(Boolean);
      const originalWords = seg.words;
      const updatedWords = newWords.map((word, i) => ({
        word,
        start: originalWords[Math.min(i, originalWords.length - 1)]?.start ?? seg.start,
        end: originalWords[Math.min(i, originalWords.length - 1)]?.end ?? seg.end,
      }));

      return { ...seg, text: editText, words: updatedWords };
    });

    const allWords = updatedSegments.flatMap(seg => seg.words);
    saveEdits.mutate({ outputId, transcription: { words: allWords, segments: updatedSegments } });
    setEditingSegmentId(null);
  };

  const handleCancelEdit = () => {
    setEditingSegmentId(null);
    setEditText('');
  };

  const selectedTemplateInfo = CAPTION_STYLE_TEMPLATES.find(t => t.id === selectedTemplate);

  // Compact status badge for header
  const statusBadge = isTranscribing ? (
    <Badge variant="outline" className="gap-1 text-[10px] h-5 px-1.5">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      Transcribing
    </Badge>
  ) : isRendering ? (
    <Badge variant="outline" className="gap-1 text-[10px] h-5 px-1.5 border-cta/30 text-cta">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      Burning in
    </Badge>
  ) : isCompleted ? (
    <Badge className="gap-1 text-[10px] h-5 px-1.5 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800">
      <Check className="h-2.5 w-2.5" />
      Burnt in
    </Badge>
  ) : null;

  // --- Compact view: burnt in or in-progress ---
  if (isCompleted || isInProgress) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-cta/10 flex items-center justify-center">
              <Subtitles className="h-4 w-4 text-cta" />
            </div>
            <Label className="text-sm font-semibold">Subtitles</Label>
            {statusBadge}
            {transcription?.edited && (
              <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1">
                <Pencil className="h-2.5 w-2.5" />
                Edited
              </Badge>
            )}
          </div>
          {isCompleted && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setExpanded(!expanded)}
              >
                Edit
                <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", expanded && "rotate-180")} />
              </Button>
            </div>
          )}
        </div>

        {/* Render failed inline */}
        {render?.status === 'failed' && (
          <div className="mx-4 mb-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive font-medium">Rendering failed</p>
            <p className="text-xs text-destructive/80 mt-0.5">{render.error || 'Unknown error'}</p>
            <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={handleRender}>
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        )}

        {/* Expanded edit panel (only when burnt in and user clicks Edit) */}
        {expanded && isCompleted && hasTranscription && transcription.segments && (
          <div className="border-t border-border/50 space-y-3 pb-4">
            {/* Template selector */}
            <div className="flex items-center gap-3 px-4 pt-3">
              <Label className="text-xs font-medium text-muted-foreground shrink-0 uppercase tracking-wider">Style</Label>
              <TemplateSelector
                value={selectedTemplate}
                onChange={setSelectedTemplate}
                templateInfo={selectedTemplateInfo}
              />
            </div>

            {/* Segments */}
            <SegmentList
              segments={transcription.segments}
              editingSegmentId={editingSegmentId}
              editText={editText}
              onStartEdit={handleStartEdit}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={handleCancelEdit}
              onEditTextChange={setEditText}
              saveIsPending={saveEdits.isPending}
            />

            {/* Actions */}
            <div className="flex items-center gap-2 px-4">
              <Button variant="cta" size="sm" className="gap-1.5" onClick={handleRender} disabled={renderSubtitles.isPending}>
                {renderSubtitles.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Re-render Subtitles
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRetranscribe} disabled={transcribeAudio.isPending}>
                {transcribeAudio.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Re-transcribe
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Full view: no subtitles yet or transcription ready ---
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <div className="h-8 w-8 rounded-lg bg-cta/10 flex items-center justify-center">
          <Subtitles className="h-4 w-4 text-cta" />
        </div>
        <div>
          <Label className="text-sm font-semibold">Subtitles</Label>
          {transcription?.edited && (
            <Badge variant="outline" className="text-[10px] h-5 px-1.5 gap-1 ml-2">
              <Pencil className="h-2.5 w-2.5" />
              Edited
            </Badge>
          )}
        </div>
      </div>

      {/* No transcription — manual trigger */}
      {!transcription && !transcribeAudio.isPending && (
        <div className="mx-4 mb-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Add animated burnt-in captions to this video.
          </p>
          <div className="flex items-center gap-3">
            <Label className="text-xs font-medium text-muted-foreground shrink-0 uppercase tracking-wider">Style</Label>
            <TemplateSelector value={selectedTemplate} onChange={setSelectedTemplate} templateInfo={selectedTemplateInfo} />
          </div>
          <Button variant="cta" size="sm" className="gap-1.5" onClick={handleRetranscribe} disabled={transcribeAudio.isPending}>
            <Wand2 className="h-3.5 w-3.5" />
            Add Subtitles
          </Button>
        </div>
      )}

      {/* Transcription starting */}
      {!transcription && transcribeAudio.isPending && (
        <div className="mx-4 mb-4 flex items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border/50">
          <Loader2 className="h-4 w-4 animate-spin text-cta shrink-0" />
          <p className="text-sm text-muted-foreground">Starting transcription...</p>
        </div>
      )}

      {/* Transcription failed */}
      {transcription?.status === 'failed' && (
        <div className="mx-4 mb-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive font-medium">Transcription failed</p>
          <p className="text-xs text-destructive/80 mt-0.5">{transcription.error || 'Unknown error'}</p>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={handleRetranscribe} disabled={transcribeAudio.isPending}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Transcription complete, not yet rendered — show editor + burn-in button */}
      {hasTranscription && !isCompleted && !isRendering && transcription.segments && (
        <>
          <div className="flex items-center gap-3 px-4">
            <Label className="text-xs font-medium text-muted-foreground shrink-0 uppercase tracking-wider">Style</Label>
            <TemplateSelector value={selectedTemplate} onChange={setSelectedTemplate} templateInfo={selectedTemplateInfo} />
          </div>

          <SegmentList
            segments={transcription.segments}
            editingSegmentId={editingSegmentId}
            editText={editText}
            onStartEdit={handleStartEdit}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onEditTextChange={setEditText}
            saveIsPending={saveEdits.isPending}
          />

          {render?.status === 'failed' && (
            <div className="mx-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive font-medium">Rendering failed</p>
              <p className="text-xs text-destructive/80 mt-0.5">{render.error || 'Unknown error'}</p>
            </div>
          )}

          <div className="flex items-center gap-2 px-4 pb-4">
            <Button variant="cta" size="sm" className="gap-1.5" onClick={handleRender} disabled={renderSubtitles.isPending}>
              {renderSubtitles.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Burn In Subtitles
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleRetranscribe} disabled={transcribeAudio.isPending}>
              {transcribeAudio.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Re-transcribe
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Sub-components ---

function TemplateSelector({
  value,
  onChange,
  templateInfo,
}: {
  value: string;
  onChange: (v: string) => void;
  templateInfo?: { description: string } & Record<string, any>;
}) {
  return (
    <>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[220px] h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CAPTION_STYLE_TEMPLATES.map(tmpl => (
            <SelectItem key={tmpl.id} value={tmpl.id}>
              <div className="flex items-center gap-2.5">
                <div
                  className="w-4 h-4 rounded-md border border-border/50 shrink-0"
                  style={{ background: tmpl.preview.previewBg }}
                >
                  <div className="w-full h-full flex items-end justify-center pb-[2px]">
                    <div className="w-2.5 h-[2px] rounded-full" style={{ background: tmpl.preview.highlightColor }} />
                  </div>
                </div>
                <span className="text-sm">{tmpl.name}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{tmpl.preview.animationLabel}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {templateInfo && (
        <span className="text-[10px] text-muted-foreground hidden sm:inline">
          {templateInfo.description}
        </span>
      )}
    </>
  );
}

function SegmentList({
  segments,
  editingSegmentId,
  editText,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditTextChange,
  saveIsPending,
}: {
  segments: Array<{ id: number; text: string; start: number; end: number; words: any[] }>;
  editingSegmentId: number | null;
  editText: string;
  onStartEdit: (seg: { id: number; text: string }) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditTextChange: (v: string) => void;
  saveIsPending: boolean;
}) {
  return (
    <div className="space-y-px max-h-[280px] overflow-y-auto mx-4 rounded-lg border border-border/50 bg-muted/20">
      {segments.map((segment, idx) => (
        <div
          key={segment.id}
          className={cn(
            "group flex items-start gap-3 px-3 py-2 transition-colors",
            editingSegmentId === segment.id ? "bg-cta/5" : "hover:bg-muted/50",
            idx !== 0 && "border-t border-border/30"
          )}
        >
          <span className="text-[10px] font-mono text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 mt-0.5 shrink-0 tabular-nums">
            {formatTimestamp(segment.start)}
          </span>

          {editingSegmentId === segment.id ? (
            <div className="flex-1 flex items-center gap-1.5">
              <Textarea
                value={editText}
                onChange={(e) => onEditTextChange(e.target.value)}
                className="text-sm min-h-[32px] h-8 py-1 resize-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
                  else if (e.key === 'Escape') { onCancelEdit(); }
                }}
              />
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" onClick={onSaveEdit} disabled={saveIsPending}>
                <Save className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onCancelEdit}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              className="flex-1 text-left text-sm leading-relaxed cursor-pointer text-foreground/80 group-hover:text-foreground transition-colors"
              onClick={() => onStartEdit(segment)}
            >
              {segment.text}
              <Pencil className="inline-block h-3 w-3 ml-1.5 opacity-0 group-hover:opacity-30 transition-opacity -translate-y-px" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
