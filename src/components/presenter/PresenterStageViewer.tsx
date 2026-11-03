import { useState, lazy, Suspense } from 'react';
import { Player } from '@remotion/player';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Camera,
  Clapperboard,
  Mic,
  Film,
  Download,
  Maximize2,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { EmptyState } from '@/components/jobs/viewers/EmptyState';
import { ShotPreviewComposition } from '@/remotion/presenter/ShotPreviewComposition';
import { DEFAULT_BRAND } from '@/remotion/presenter/types';
import type { Shot, ScreenshotData } from '@/remotion/presenter/types';

// ── Types ──────────────────────────────────────────────────────────────────

interface Screenshot {
  url: string;
  label?: string;
  viewport_section?: string;
  order: number;
}

interface ShotListItem {
  shot_number: number;
  description: string;
  screenshot_index: number;
  duration_seconds: number;
  camera_move?: string;
  callout?: string;
  narration_snippet?: string;
}

interface VoiceAvatarData {
  audio_url?: string;
  avatar_video_url?: string;
  duration?: number;
  word_timestamps?: Array<{ word: string; start: number; end: number }>;
}

interface CompositionData {
  video_url?: string;
  duration?: number;
  resolution?: string;
  cost?: number;
}

interface PresenterStageViewerProps {
  /** Which stage to display */
  stageId: 'web_capture' | 'director' | 'voice_avatar' | 'composition';
  /** Stage output data (polymorphic per stage) */
  stageData: any;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function WebCaptureViewer({ screenshots }: { screenshots: Screenshot[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!screenshots || screenshots.length === 0) {
    return (
      <EmptyState
        icon={Camera}
        title="No screenshots yet"
        message="Screenshots will appear here once the web capture stage completes"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-cta" />
          <span className="text-sm font-medium">Captured Screenshots</span>
          <Badge variant="secondary" className="text-xs">
            {screenshots.length}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {screenshots
          .sort((a, b) => a.order - b.order)
          .map((screenshot, index) => (
            <button
              key={`ss-${index}`}
              onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              className={cn(
                'group relative rounded-lg overflow-hidden border-2 transition-all aspect-video bg-muted',
                expandedIndex === index
                  ? 'border-cta ring-1 ring-cta/30 col-span-2 row-span-2'
                  : 'border-border hover:border-cta/50',
              )}
            >
              <img
                src={screenshot.url}
                alt={screenshot.label || `Screenshot ${index + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[9px] text-white font-medium bg-black/50 px-1 rounded">
                  #{index + 1}
                </span>
                {screenshot.label && (
                  <span className="text-[9px] text-white bg-black/50 px-1 rounded truncate max-w-[80%]">
                    {screenshot.label}
                  </span>
                )}
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}

const PREVIEW_FPS = 30;

function ShotListViewer({ shots, rawShots, screenshots }: { shots: ShotListItem[]; rawShots?: any[]; screenshots?: Screenshot[] }) {
  const [expandedShot, setExpandedShot] = useState<number | null>(null);
  const [previewingShot, setPreviewingShot] = useState<number | null>(null);

  if (!shots || shots.length === 0) {
    return (
      <EmptyState
        icon={Clapperboard}
        title="No shot list yet"
        message="The AI director will generate a shot list after analyzing the screenshots"
      />
    );
  }

  // Build ScreenshotData[] for the Remotion composition
  const screenshotData: ScreenshotData[] = (screenshots || []).map((s) => ({
    url: s.url,
    elements: [],
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Clapperboard className="h-4 w-4 text-cta" />
        <span className="text-sm font-medium">Shot List</span>
        <Badge variant="secondary" className="text-xs">
          {shots.length} shots
        </Badge>
        <span className="text-xs text-muted-foreground">
          Total: {shots.reduce((sum, s) => sum + s.duration_seconds, 0)}s
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shots.map((shot, index) => {
          const isExpanded = expandedShot === shot.shot_number;
          const isPreviewing = previewingShot === shot.shot_number;
          const screenshot = screenshots?.find((_, i) => i === shot.screenshot_index);
          const rawShot = rawShots?.[index];
          const canPreview = !!rawShot?.layout && !!rawShot?.camera;

          return (
            <Card
              key={shot.shot_number}
              className={cn(
                'overflow-hidden transition-all',
                isExpanded && 'ring-1 ring-cta/30',
                isPreviewing && 'sm:col-span-2',
              )}
            >
              <div
                className="flex gap-2 p-2 cursor-pointer"
                onClick={() => setExpandedShot(isExpanded ? null : shot.shot_number)}
              >
                {/* Thumbnail */}
                <div className="w-16 h-10 flex-shrink-0 rounded bg-muted overflow-hidden">
                  {screenshot ? (
                    <img
                      src={screenshot.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* Shot details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">Shot {shot.shot_number}</span>
                    <Badge variant="outline" className="text-[9px] px-1">
                      {shot.duration_seconds}s
                    </Badge>
                    {shot.camera_move && (
                      <Badge variant="secondary" className="text-[9px] px-1">
                        {shot.camera_move}
                      </Badge>
                    )}
                    {rawShot?.layout && (
                      <Badge variant="secondary" className="text-[9px] px-1">
                        {rawShot.layout}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    {shot.description}
                  </p>
                </div>

                {/* Play + Expand icons */}
                <div className="flex-shrink-0 self-center flex items-center gap-1">
                  {canPreview && (
                    <button
                      type="button"
                      className={cn(
                        'h-6 w-6 rounded-full flex items-center justify-center transition-colors',
                        isPreviewing
                          ? 'bg-cta text-black'
                          : 'hover:bg-muted text-muted-foreground hover:text-foreground',
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isPreviewing) {
                          setPreviewingShot(null);
                        } else {
                          setPreviewingShot(shot.shot_number);
                          setExpandedShot(shot.shot_number);
                        }
                      }}
                    >
                      {isPreviewing ? (
                        <Pause className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                    </button>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-border space-y-2">
                  {/* Inline Remotion preview */}
                  {isPreviewing && rawShot && (
                    <div className="rounded-lg overflow-hidden border border-border bg-black mx-auto" style={{ width: 200 }}>
                      <div style={{ position: 'relative', width: '100%', paddingBottom: '177.78%' }}>
                        <Player
                          component={ShotPreviewComposition}
                          inputProps={{
                            shot: rawShot as Shot,
                            screenshots: screenshotData,
                            brand: DEFAULT_BRAND,
                          }}
                          durationInFrames={Math.max(1, Math.round((rawShot.duration || 4) * PREVIEW_FPS))}
                          fps={PREVIEW_FPS}
                          compositionWidth={1080}
                          compositionHeight={1920}
                          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                          controls
                          autoPlay
                          loop
                        />
                      </div>
                    </div>
                  )}

                  {shot.narration_snippet && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground">Narration:</span>
                      <p className="text-xs mt-0.5 italic">"{shot.narration_snippet}"</p>
                    </div>
                  )}
                  {shot.callout && (
                    <div>
                      <span className="text-[10px] font-medium text-muted-foreground">Callout:</span>
                      <p className="text-xs mt-0.5">{shot.callout}</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function VoiceAvatarViewer({ data }: { data: VoiceAvatarData }) {
  const [isPlaying, setIsPlaying] = useState(false);

  if (!data?.audio_url && !data?.avatar_video_url) {
    return (
      <EmptyState
        icon={Mic}
        title="No voice/avatar yet"
        message="Audio and avatar video will appear after the voice generation stage"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-cta" />
        <span className="text-sm font-medium">Voice & Avatar</span>
        {data.duration && (
          <span className="text-xs text-muted-foreground">
            Duration: {Math.floor(data.duration / 60)}:{String(Math.floor(data.duration % 60)).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Audio player */}
      {data.audio_url && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Voiceover Audio</span>
          <audio
            src={data.audio_url}
            controls
            className="w-full h-10"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        </div>
      )}

      {/* Avatar video preview */}
      {data.avatar_video_url && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Avatar Video</span>
          <div className="rounded-lg overflow-hidden border border-border bg-black max-w-xs">
            <video
              src={data.avatar_video_url}
              controls
              playsInline
              className="w-full h-auto"
            />
          </div>
        </div>
      )}

      {/* Word timestamps preview */}
      {data.word_timestamps && data.word_timestamps.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Word Timestamps ({data.word_timestamps.length} words)
          </span>
          <div className="flex flex-wrap gap-0.5 p-2 rounded-md bg-muted/30 max-h-24 overflow-y-auto">
            {data.word_timestamps.slice(0, 60).map((wt, i) => (
              <span
                key={i}
                className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground hover:bg-cta/20 hover:text-foreground transition-colors cursor-default"
                title={`${wt.start.toFixed(2)}s - ${wt.end.toFixed(2)}s`}
              >
                {wt.word}
              </span>
            ))}
            {data.word_timestamps.length > 60 && (
              <span className="text-[10px] text-muted-foreground">
                ...+{data.word_timestamps.length - 60} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CompositionViewer({ data }: { data: CompositionData }) {
  if (!data?.video_url) {
    return (
      <EmptyState
        icon={Film}
        title="No video yet"
        message="The final composed video will appear here after rendering"
      />
    );
  }

  const handleDownload = () => {
    const filename = 'presenter-video.mp4';
    const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(data.video_url!)}&filename=${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = proxyUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Video download started');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-cta" />
          <span className="text-sm font-medium">Final Video</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {data.duration && (
            <span>
              {Math.floor(data.duration / 60)}:{String(Math.floor(data.duration % 60)).padStart(2, '0')}
            </span>
          )}
          {data.resolution && <span>{data.resolution}</span>}
          {data.cost !== undefined && <span>${data.cost.toFixed(4)}</span>}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-border bg-black max-w-2xl mx-auto">
        <video
          src={data.video_url}
          controls
          playsInline
          className="w-full h-auto"
        />
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function PresenterStageViewer({ stageId, stageData }: PresenterStageViewerProps) {
  switch (stageId) {
    case 'web_capture':
      return <WebCaptureViewer screenshots={stageData?.screenshots || []} />;

    case 'director':
      return (
        <ShotListViewer
          shots={stageData?.shots || stageData?.shot_list || []}
          rawShots={stageData?.shots || stageData?.shot_list || []}
          screenshots={stageData?.screenshots}
        />
      );

    case 'voice_avatar':
      return <VoiceAvatarViewer data={stageData || {}} />;

    case 'composition':
      return <CompositionViewer data={stageData || {}} />;

    default:
      return (
        <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto">
          {JSON.stringify(stageData, null, 2)}
        </pre>
      );
  }
}
