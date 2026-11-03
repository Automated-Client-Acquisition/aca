import { useRef, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Captions, Pencil } from 'lucide-react';
import type { WordTimestamp } from '@/hooks/useVideoEditor';

interface CaptionEditorProps {
  words: WordTimestamp[];
  onWordsChange: (words: WordTimestamp[]) => void;
  style: string;
  onStyleChange: (style: string) => void;
  currentFrame: number;
  fps: number;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
}

const CAPTION_STYLES = [
  { value: 'clean_white', label: 'Clean White' },
  { value: 'karaoke_bold', label: 'Karaoke Bold' },
  { value: 'boxed_yellow', label: 'Boxed Yellow' },
  { value: 'bounce_pop', label: 'Bounce Pop' },
  { value: 'cinematic_lower', label: 'Cinematic Lower' },
];

function frameToTime(frame: number, fps: number): string {
  const sec = frame / fps;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export function CaptionEditor({
  words,
  onWordsChange,
  style,
  onStyleChange,
  currentFrame,
  fps,
  enabled = true,
  onEnabledChange,
}: CaptionEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [draggingBoundary, setDraggingBoundary] = useState<number | null>(null);

  const handleWordClick = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setEditValue(words[index].word);
    },
    [words],
  );

  const handleEditSubmit = useCallback(() => {
    if (editingIndex === null) return;
    const updated = words.map((w, i) =>
      i === editingIndex ? { ...w, word: editValue } : w,
    );
    onWordsChange(updated);
    setEditingIndex(null);
  }, [editingIndex, editValue, words, onWordsChange]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleEditSubmit();
      } else if (e.key === 'Escape') {
        setEditingIndex(null);
      }
    },
    [handleEditSubmit],
  );

  const handleBoundaryMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingBoundary(index);

      const startX = e.clientX;
      const container = scrollRef.current;
      if (!container) return;
      const containerWidth = container.scrollWidth;

      const totalDuration =
        words.length > 0 ? words[words.length - 1].end - words[0].start : 1;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dFrame = Math.round((dx / containerWidth) * totalDuration);
        if (dFrame === 0) return;

        const updated = [...words];
        const current = updated[index];
        const next = updated[index + 1];

        if (next) {
          const newEnd = current.end + dFrame;
          // Ensure at least 1 frame per word
          if (newEnd > current.start + 1 && newEnd < next.end - 1) {
            updated[index] = { ...current, end: newEnd };
            updated[index + 1] = { ...next, start: newEnd };
            onWordsChange(updated);
          }
        }
      };

      const handleMouseUp = () => {
        setDraggingBoundary(null);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [words, onWordsChange],
  );

  // Find which word is active at the current frame
  const activeWordIndex = words.findIndex(
    (w) => currentFrame >= w.start && currentFrame < w.end,
  );

  return (
    <div className="space-y-2 px-4 py-2.5 border-t border-border bg-muted/10">
      {/* Controls row */}
      <div className="flex items-center gap-3">
        <Captions className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <Select value={style} onValueChange={onStyleChange}>
          <SelectTrigger className="h-7 text-[10px] w-36">
            <SelectValue placeholder="Caption style" />
          </SelectTrigger>
          <SelectContent>
            {CAPTION_STYLES.map((cs) => (
              <SelectItem key={cs.value} value={cs.value}>
                {cs.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {onEnabledChange && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Label className="text-[10px] text-muted-foreground">Captions</Label>
            <Switch
              checked={enabled}
              onCheckedChange={onEnabledChange}
              className="scale-75"
            />
          </div>
        )}
      </div>

      {/* Word strip */}
      {enabled && words.length > 0 && (
        <div
          ref={scrollRef}
          className="flex items-center gap-0 overflow-x-auto scrollbar-thin pb-1"
        >
          {words.map((w, idx) => {
            const isActive = idx === activeWordIndex;
            const isEditing = idx === editingIndex;

            return (
              <div key={idx} className="flex items-stretch flex-shrink-0">
                {/* Word chip */}
                <button
                  className={cn(
                    'px-1.5 py-1 text-xs font-mono transition-colors rounded-sm relative',
                    isActive
                      ? 'bg-cta/20 text-cta font-semibold'
                      : 'text-foreground hover:bg-muted/40',
                    w.highlighted && 'underline decoration-cta decoration-2',
                  )}
                  onClick={() => handleWordClick(idx)}
                  title={`${frameToTime(w.start, fps)} - ${frameToTime(w.end, fps)}`}
                >
                  {isEditing ? (
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleEditSubmit}
                      onKeyDown={handleEditKeyDown}
                      className="bg-transparent border-b border-cta outline-none text-xs font-mono w-16 text-center"
                      autoFocus
                    />
                  ) : (
                    <span className="flex items-center gap-0.5">
                      {w.word}
                      <Pencil className="h-2 w-2 opacity-0 group-hover:opacity-50" />
                    </span>
                  )}
                  {/* Timing underneath */}
                  <span className="block text-[8px] text-muted-foreground tabular-nums mt-0.5">
                    {frameToTime(w.start, fps)}
                  </span>
                </button>

                {/* Draggable boundary */}
                {idx < words.length - 1 && (
                  <div
                    className={cn(
                      'w-px bg-border hover:bg-cta hover:w-0.5 cursor-col-resize flex-shrink-0 self-stretch transition-colors',
                      draggingBoundary === idx && 'bg-cta w-0.5',
                    )}
                    onMouseDown={(e) => handleBoundaryMouseDown(e, idx)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {enabled && words.length === 0 && (
        <p className="text-xs text-muted-foreground py-1">
          No caption data available for this scene.
        </p>
      )}
    </div>
  );
}
