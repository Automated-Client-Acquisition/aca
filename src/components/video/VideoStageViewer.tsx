/**
 * VideoStageViewer — Unified stage output viewer for the `video` pipeline.
 *
 * Renders appropriate UI for each stage output:
 * - web_capture: Screenshot grid
 * - video_ingest: Video frame grid + metadata
 * - transcribe: Transcript text + segments
 * - outline/rewrite: Editable narration text
 * - voiceover: Audio player + word timestamps
 * - director: Shot list with inline Remotion previews
 * - b_roll: B-roll clip grid
 * - images: AI-generated image grid
 * - composition: Final video player
 */

import { useState, lazy, Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Camera, FileText, Mic, Film, Image as ImageIcon, Video,
  ChevronDown, ChevronRight, Play, Clock, Layers, RefreshCw,
  Edit2, Check, X, Copy, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Lazy-load Remotion player to avoid bundle bloat
const ShotPreviewPlayer = lazy(() =>
  import('./ShotPreviewPlayer').then(m => ({ default: m.ShotPreviewPlayer }))
);

interface VideoStageViewerProps {
  stageId: string;
  stageData: Record<string, any>;
  allStageData: Record<string, any>;
  pipeline: string;
  onOpenEditor?: () => void;
}

export function VideoStageViewer({
  stageId,
  stageData,
  allStageData,
  pipeline,
  onOpenEditor,
}: VideoStageViewerProps) {
  // Common state
  const [expandedShot, setExpandedShot] = useState<number | null>(null);

  const currentData = stageData || {};

  // Determine which viewer to show based on stageId
  switch (stageId) {
    case 'web_capture': {
      const screenshots = currentData.screenshots || [];
      const pageMeta = currentData.page_metadata;
      return (
        <div className="space-y-4">
          {pageMeta && (
            <div className="p-3 bg-muted/50 rounded-lg space-y-1">
              <p className="text-sm font-medium">{pageMeta.title}</p>
              {pageMeta.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{pageMeta.description}</p>
              )}
              {pageMeta.url && (
                <p className="text-xs text-muted-foreground truncate">{pageMeta.url}</p>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {screenshots.map((s: any, i: number) => (
              <div key={i} className="space-y-1">
                <img
                  src={s.url}
                  alt={s.narration_hint || `Screenshot ${i + 1}`}
                  className="w-full rounded-md border"
                />
                {s.narration_hint && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{s.narration_hint}</p>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''} captured
          </p>
        </div>
      );
    }

    case 'video_ingest': {
      const screenshots = currentData.screenshots || [];
      const videoUrl = currentData.video_url;
      const duration = currentData.video_duration_seconds || currentData.duration_seconds;
      return (
        <div className="space-y-4">
          {videoUrl && (
            <video
              src={videoUrl}
              controls
              className="w-full rounded-md border max-h-64"
            />
          )}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {duration && (
              <Badge variant="secondary">
                <Clock className="h-3 w-3 mr-1" />
                {Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, '0')}
              </Badge>
            )}
            {currentData.resolution && (
              <Badge variant="outline">{currentData.resolution}</Badge>
            )}
            {screenshots.length > 0 && (
              <span>{screenshots.length} frames extracted</span>
            )}
          </div>
          {screenshots.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {screenshots.slice(0, 9).map((s: any, i: number) => (
                <img
                  key={i}
                  src={s.url}
                  alt={`Frame ${i + 1}`}
                  className="w-full rounded-md border"
                />
              ))}
              {screenshots.length > 9 && (
                <div className="flex items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
                  +{screenshots.length - 9} more
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    case 'transcribe': {
      const transcript = currentData.transcript;
      const segments = currentData.segments || [];
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {currentData.language && <span>Language: {currentData.language}</span>}
            {currentData.word_count && <span>{currentData.word_count} words</span>}
            {currentData.duration_seconds && (
              <span>Duration: {Math.floor(currentData.duration_seconds / 60)}:{String(Math.round(currentData.duration_seconds % 60)).padStart(2, '0')}</span>
            )}
          </div>
          {transcript && (
            <div className="p-4 bg-muted/30 rounded-lg text-sm whitespace-pre-wrap">
              {transcript}
            </div>
          )}
          {segments.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">Segments</h4>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {segments.map((seg: any, i: number) => (
                  <div key={i} className="flex gap-2 text-xs">
                    <span className="text-muted-foreground font-mono shrink-0">
                      {Math.floor(seg.start / 60)}:{String(Math.round(seg.start % 60)).padStart(2, '0')}
                    </span>
                    <span>{seg.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    case 'outline':
    case 'rewrite': {
      const content = currentData.content || currentData.text || currentData.script;
      const sections = currentData.sections;
      return (
        <div className="space-y-4">
          {sections && Array.isArray(sections) ? (
            <div className="space-y-3">
              {sections.map((section: any, i: number) => (
                <div key={i} className="space-y-1">
                  {section.title && (
                    <h4 className="text-sm font-medium">{section.title}</h4>
                  )}
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {section.narration || section.content || section.text}
                  </p>
                  {section.duration_seconds && (
                    <span className="text-xs text-muted-foreground">~{section.duration_seconds}s</span>
                  )}
                </div>
              ))}
            </div>
          ) : content ? (
            <div className="p-4 bg-muted/30 rounded-lg text-sm whitespace-pre-wrap">
              {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No content generated yet</p>
          )}
        </div>
      );
    }

    case 'voiceover': {
      const audioUrl = currentData.audio_url || currentData.url;
      const duration = currentData.duration_seconds || currentData.duration;
      const wordTimestamps = currentData.word_timestamps || currentData.words || [];
      const avatarUrl = currentData.avatar_video_url;
      return (
        <div className="space-y-4">
          {audioUrl && (
            <audio src={audioUrl} controls className="w-full" />
          )}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {duration && (
              <Badge variant="secondary">
                <Mic className="h-3 w-3 mr-1" />
                {Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, '0')}
              </Badge>
            )}
            {currentData.voice_id && (
              <Badge variant="outline">Voice: {currentData.voice_name || currentData.voice_id.slice(0, 8)}</Badge>
            )}
            {wordTimestamps.length > 0 && (
              <span>{wordTimestamps.length} word timestamps</span>
            )}
          </div>
          {avatarUrl && (
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-muted-foreground">Avatar Video</h4>
              <video src={avatarUrl} controls className="w-full rounded-md border max-h-48" />
            </div>
          )}
        </div>
      );
    }

    case 'director': {
      // Shot list — the most complex viewer
      const shots = currentData.shots || currentData.segments || [];
      const allScreenshots = allStageData?.web_capture?.screenshots || allStageData?.video_ingest?.screenshots || [];
      const sourceVideoUrl = allStageData?.video_ingest?.video_url || null;
      const totalDuration = currentData.total_duration || shots.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);

      return (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="secondary">{shots.length} shots</Badge>
              <span>{Math.round(totalDuration)}s total</span>
            </div>
            {onOpenEditor && (
              <Button variant="outline" size="sm" onClick={onOpenEditor}>
                <Wand2 className="h-4 w-4 mr-2" />
                Open Editor
              </Button>
            )}
          </div>

          {/* Shot cards */}
          <div className="space-y-2">
            {shots.map((shot: any, i: number) => {
              const isExpanded = expandedShot === i;
              const screenshotUrl = shot.screenshot_index != null
                ? allScreenshots[shot.screenshot_index]?.url
                : shot.scene_image_url || null;
              const isVideoClip = shot.layout === 'video_clip' || shot.source_start !== undefined;
              const layoutLabel = shot.layout?.replace(/_/g, ' ') || (isVideoClip ? 'video clip' : 'shot');

              return (
                <Collapsible key={i} open={isExpanded} onOpenChange={() => setExpandedShot(isExpanded ? null : i)}>
                  <CollapsibleTrigger className="w-full">
                    <div className={cn(
                      "flex items-center gap-3 p-3 rounded-lg border text-left hover:bg-muted/50 transition-colors",
                      isExpanded && "bg-muted/50"
                    )}>
                      {/* Thumbnail */}
                      <div className="w-16 h-10 rounded overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                        {screenshotUrl ? (
                          <img src={screenshotUrl} alt="" className="w-full h-full object-cover" />
                        ) : isVideoClip ? (
                          <Film className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Layers className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Shot {i + 1}</span>
                          <Badge variant="outline" className="text-[10px]">{layoutLabel}</Badge>
                          <span className="text-xs text-muted-foreground">{shot.duration || 0}s</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {shot.narration || shot.text || '—'}
                        </p>
                      </div>

                      {/* Expand icon */}
                      {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 ml-[76px] space-y-3 pb-2">
                      {/* Shot details */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {shot.camera && <div><span className="text-muted-foreground">Camera:</span> {shot.camera}</div>}
                        {shot.transition_in && <div><span className="text-muted-foreground">Transition:</span> {shot.transition_in}</div>}
                        {isVideoClip && shot.source_start !== undefined && (
                          <div><span className="text-muted-foreground">Source:</span> {shot.source_start}s &rarr; {shot.source_end}s</div>
                        )}
                        {shot.speed && shot.speed !== 1 && (
                          <div><span className="text-muted-foreground">Speed:</span> {shot.speed}x</div>
                        )}
                        {shot.text_animation && <div><span className="text-muted-foreground">Text FX:</span> {shot.text_animation}</div>}
                        {shot.sound_effect && <div><span className="text-muted-foreground">SFX:</span> {shot.sound_effect}</div>}
                      </div>

                      {/* Narration */}
                      {shot.narration && (
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">Narration</span>
                          <p className="text-sm bg-muted/30 p-2 rounded">{shot.narration}</p>
                        </div>
                      )}

                      {/* Image prompt (for AI-generated images) */}
                      {shot.image_prompt && (
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">Image prompt</span>
                          <p className="text-xs bg-muted/30 p-2 rounded italic">{shot.image_prompt}</p>
                        </div>
                      )}

                      {/* Text overlay content */}
                      {shot.text_overlay && (
                        <div className="space-y-1">
                          <span className="text-xs text-muted-foreground">Text overlay</span>
                          <p className="text-sm font-medium">{shot.text_overlay}</p>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </div>
      );
    }

    case 'b_roll': {
      const bRollByShot = currentData.b_roll_by_shot || {};
      const allClips = Object.values(bRollByShot).flatMap((group: any) => group.clips || []);
      return (
        <div className="space-y-4">
          <Badge variant="secondary">{allClips.length} B-roll clips</Badge>
          <div className="grid grid-cols-2 gap-2">
            {allClips.map((clip: any, i: number) => (
              <div key={i} className="space-y-1">
                {clip.type === 'video' ? (
                  <video src={clip.url} className="w-full rounded-md border max-h-32" muted />
                ) : (
                  <img src={clip.url} alt="" className="w-full rounded-md border" />
                )}
                <p className="text-xs text-muted-foreground truncate">
                  {clip.label || clip.keywords?.join(', ') || `Clip ${i + 1}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'images': {
      const scenes = currentData.scenes || [];
      return (
        <div className="space-y-4">
          <Badge variant="secondary">{scenes.length} images generated</Badge>
          <div className="grid grid-cols-2 gap-2">
            {scenes.map((scene: any, i: number) => (
              <div key={i} className="space-y-1">
                {scene.image_url ? (
                  <img src={scene.image_url} alt="" className="w-full rounded-md border" />
                ) : (
                  <div className="w-full h-32 rounded-md border bg-muted/30 flex items-center justify-center">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                {scene.prompt && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{scene.prompt}</p>
                )}
                {scene.status && scene.status !== 'completed' && (
                  <Badge variant={scene.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
                    {scene.status}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'composition': {
      const videoUrl = currentData.video_url;
      const duration = currentData.duration_seconds;
      const status = currentData.status;
      return (
        <div className="space-y-4">
          {status === 'generating' ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cta" />
              <p className="text-sm text-muted-foreground">Rendering video...</p>
              {currentData.progress != null && (
                <div className="w-48 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-cta transition-all" style={{ width: `${currentData.progress}%` }} />
                </div>
              )}
            </div>
          ) : videoUrl ? (
            <div className="space-y-3">
              <video src={videoUrl} controls className="w-full rounded-lg border" />
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {duration && (
                  <Badge variant="secondary">
                    <Clock className="h-3 w-3 mr-1" />
                    {Math.floor(duration / 60)}:{String(Math.round(duration % 60)).padStart(2, '0')}
                  </Badge>
                )}
                {currentData.resolution && (
                  <Badge variant="outline">{currentData.resolution}</Badge>
                )}
                {currentData.file_size_mb && (
                  <span>{currentData.file_size_mb.toFixed(1)} MB</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 space-y-2 text-muted-foreground">
              <Video className="h-8 w-8" />
              <p className="text-sm">Video will appear here after composition completes</p>
            </div>
          )}
        </div>
      );
    }

    default:
      // Fallback for unknown stages
      return (
        <div className="p-4 bg-muted/30 rounded-lg text-sm">
          <pre className="whitespace-pre-wrap text-xs">
            {JSON.stringify(currentData, null, 2)}
          </pre>
        </div>
      );
  }
}
