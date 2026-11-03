import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  RefreshCw,
  Edit2,
  Check,
  X,
  Copy,
  ChevronDown,
  ChevronUp,
  Clock,
  Camera,
  Type,
  Image as ImageIcon,
  Play,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type I2VMotionType = 'static' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down' | 'parallax';

interface EnhancedScene {
  scene_number: number;
  narration: string;
  image_prompt: string;
  i2v_prompt: string;
  i2v_motion_type: I2VMotionType;
  duration_seconds: number;
  status?: 'pending' | 'generating' | 'completed' | 'approved' | 'rejected' | 'excluded' | 'failed';
}

interface EnhancedSceneViewerProps {
  scenes: EnhancedScene[];
  voiceoverUrl?: string;
  wordTimestamps?: Array<{ word: string; start: number; end: number }>;
  onExclude: (sceneNumber: number) => void;
  onEdit: (sceneNumber: number, updates: Partial<EnhancedScene>) => void;
  onRegenerate: (sceneNumber: number) => void;
  isRegeneratingScene?: number | null;
}

const MOTION_TYPES: { value: I2VMotionType; label: string; description: string }[] = [
  { value: 'static', label: 'Static', description: 'Minimal movement' },
  { value: 'zoom_in', label: 'Zoom In', description: 'Draws attention inward' },
  { value: 'zoom_out', label: 'Zoom Out', description: 'Reveals context' },
  { value: 'pan_left', label: 'Pan Left', description: 'Horizontal sweep left' },
  { value: 'pan_right', label: 'Pan Right', description: 'Horizontal sweep right' },
  { value: 'pan_up', label: 'Pan Up', description: 'Vertical reveal upward' },
  { value: 'pan_down', label: 'Pan Down', description: 'Vertical reveal downward' },
  { value: 'parallax', label: 'Parallax', description: '2.5D depth effect' },
];

export function EnhancedSceneViewer({
  scenes,
  voiceoverUrl,
  wordTimestamps,
  onExclude,
  onEdit,
  onRegenerate,
  isRegeneratingScene = null,
}: EnhancedSceneViewerProps) {
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editBuffer, setEditBuffer] = useState<Partial<EnhancedScene>>({});

  const excludedCount = scenes.filter(s => s.status === 'excluded' || s.status === 'rejected' || s.status === 'failed').length;
  const activeCount = scenes.length - excludedCount;
  const totalCount = scenes.length;
  const activeScenes = scenes.filter(s => s.status !== 'excluded' && s.status !== 'rejected' && s.status !== 'failed');
  const totalDuration = activeScenes.reduce((sum, s) => sum + (s.duration_seconds || 8), 0);
  const totalWords = activeScenes.reduce((sum, s) => sum + (s.narration?.split(/\s+/).length || 0), 0);

  const handleStartEdit = (scene: EnhancedScene) => {
    setEditingScene(scene.scene_number);
    setEditBuffer({
      narration: scene.narration,
      image_prompt: scene.image_prompt,
      i2v_prompt: scene.i2v_prompt,
      i2v_motion_type: scene.i2v_motion_type,
      duration_seconds: scene.duration_seconds,
    });
  };

  const handleSaveEdit = (sceneNumber: number) => {
    onEdit(sceneNumber, editBuffer);
    setEditingScene(null);
    setEditBuffer({});
  };

  const handleCancelEdit = () => {
    setEditingScene(null);
    setEditBuffer({});
  };

  const handleCopyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-lg">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Scene Breakdown</span>
            <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-sm">
              {activeCount} / {totalCount} Active
            </Badge>
            {excludedCount > 0 && (
              <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm text-muted-foreground">
                <EyeOff className="h-3 w-3" />
                {excludedCount} Excluded
              </Badge>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(totalDuration)} total
            </span>
            <span className="flex items-center gap-1">
              <Type className="h-3.5 w-3.5" />
              {totalWords} words
            </span>
          </div>
        </div>

        {/* Preview & Edit available in Editor Studio when composition stage completes */}
      </div>

      {/* Scene Cards */}
      <div className="space-y-3">
        {scenes.map((scene, index) => {
          const isExpanded = expandedScene === scene.scene_number;
          const isEditing = editingScene === scene.scene_number;
          const isExcluded = scene.status === 'excluded' || scene.status === 'rejected';
          const isRegenerating = isRegeneratingScene === scene.scene_number;
          const motionLabel = MOTION_TYPES.find(m => m.value === scene.i2v_motion_type)?.label || scene.i2v_motion_type;

          return (
            <Card
              key={`scene-${scene.scene_number}-${index}`}
              className={cn(
                "border-l-4 transition-all duration-300",
                isExcluded && "border-l-muted-foreground/30 bg-muted/30 opacity-60",
                !isExcluded && "border-l-primary/50 hover:border-l-primary"
              )}
            >
              <Collapsible open={isExpanded} onOpenChange={() => setExpandedScene(isExpanded ? null : scene.scene_number)}>
                {/* Collapsed Header */}
                <CollapsibleTrigger asChild>
                  <div className="p-3 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">Scene {scene.scene_number}</span>
                        {isExcluded && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            <EyeOff className="h-3 w-3 mr-1" />
                            Excluded
                          </Badge>
                        )}
                        {isRegenerating && <RefreshCw className="h-4 w-4 animate-spin text-primary" />}
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs gap-1">
                          <Clock className="h-3 w-3" />
                          {scene.duration_seconds}s
                        </Badge>
                        <Badge variant="outline" className="text-xs gap-1">
                          <Camera className="h-3 w-3" />
                          {motionLabel}
                        </Badge>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Preview text when collapsed */}
                    {!isExpanded && (
                      <p className="text-xs text-muted-foreground mt-2 line-clamp-1">
                        {scene.narration}
                      </p>
                    )}
                  </div>
                </CollapsibleTrigger>

                {/* Expanded Content */}
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-4 px-4 space-y-4 border-t">
                    {/* Narration */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                          <Type className="h-3.5 w-3.5" /> Narration
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); handleCopyText(scene.narration, 'Narration'); }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      {isEditing ? (
                        <Textarea
                          value={editBuffer.narration ?? scene.narration}
                          onChange={(e) => setEditBuffer(prev => ({ ...prev, narration: e.target.value }))}
                          className="min-h-[80px] text-sm"
                          placeholder="Voiceover narration text..."
                        />
                      ) : (
                        <p className="text-sm bg-muted/30 p-3 rounded-md leading-relaxed">{scene.narration}</p>
                      )}
                    </div>

                    {/* Image Prompt */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                          <ImageIcon className="h-3.5 w-3.5" /> Image Prompt
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); handleCopyText(scene.image_prompt, 'Image prompt'); }}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                      {isEditing ? (
                        <Textarea
                          value={editBuffer.image_prompt ?? scene.image_prompt}
                          onChange={(e) => setEditBuffer(prev => ({ ...prev, image_prompt: e.target.value }))}
                          className="min-h-[60px] text-sm font-mono"
                          placeholder="Detailed visual description..."
                        />
                      ) : (
                        <p className="text-sm bg-muted/30 p-3 rounded-md text-muted-foreground font-mono">{scene.image_prompt}</p>
                      )}
                    </div>

                    {/* I2V Settings Row */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Motion Type */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                          <Camera className="h-3.5 w-3.5" /> Motion Type
                        </label>
                        {isEditing ? (
                          <Select
                            value={editBuffer.i2v_motion_type ?? scene.i2v_motion_type}
                            onValueChange={(v) => setEditBuffer(prev => ({ ...prev, i2v_motion_type: v as I2VMotionType }))}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MOTION_TYPES.map(m => (
                                <SelectItem key={m.value} value={m.value}>
                                  <span className="flex flex-col">
                                    <span>{m.label}</span>
                                    <span className="text-xs text-muted-foreground">{m.description}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-sm bg-muted/30 p-2 rounded-md">{motionLabel}</p>
                        )}
                      </div>

                      {/* Duration */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" /> Duration ({isEditing ? (editBuffer.duration_seconds ?? scene.duration_seconds) : scene.duration_seconds}s)
                        </label>
                        {isEditing ? (
                          <Slider
                            value={[editBuffer.duration_seconds ?? scene.duration_seconds]}
                            onValueChange={([v]) => setEditBuffer(prev => ({ ...prev, duration_seconds: v }))}
                            min={6}
                            max={12}
                            step={1}
                            className="mt-3"
                          />
                        ) : (
                          <p className="text-sm bg-muted/30 p-2 rounded-md">{scene.duration_seconds} seconds</p>
                        )}
                      </div>

                      {/* I2V Prompt */}
                      <div className="space-y-2">
                        <label className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
                          <Play className="h-3.5 w-3.5" /> Motion Description
                        </label>
                        {isEditing ? (
                          <Textarea
                            value={editBuffer.i2v_prompt ?? scene.i2v_prompt}
                            onChange={(e) => setEditBuffer(prev => ({ ...prev, i2v_prompt: e.target.value }))}
                            placeholder="e.g., slow zoom in on subject"
                            className="min-h-[40px] text-sm"
                          />
                        ) : (
                          <p className="text-sm bg-muted/30 p-2 rounded-md">{scene.i2v_prompt}</p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-2 border-t">
                      {isEditing ? (
                        <>
                          <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                            <X className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                          <Button size="sm" onClick={() => handleSaveEdit(scene.scene_number)}>
                            <Check className="h-4 w-4 mr-1" /> Save Changes
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartEdit(scene)}
                          >
                            <Edit2 className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRegenerate(scene.scene_number)}
                            disabled={isRegenerating}
                          >
                            <RefreshCw className={cn("h-4 w-4 mr-1", isRegenerating && "animate-spin")} />
                            Regenerate
                          </Button>
                          {!isExcluded && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onExclude(scene.scene_number)}
                            >
                              <EyeOff className="h-4 w-4 mr-1" /> Exclude
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Info message about excluded scenes */}
      {excludedCount > 0 && (
        <div className="p-3 bg-muted/30 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">
            {excludedCount} scene{excludedCount !== 1 ? 's' : ''} excluded. Excluded scenes will be skipped during generation.
          </p>
        </div>
      )}

    </div>
  );
}
