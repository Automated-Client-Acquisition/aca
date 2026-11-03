import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Volume2, Plus, Trash2, Sparkles, Loader2, Play, Pause, FolderOpen } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { SoundEffect } from "@/types/videoEditor";
import { ACA_ASSETS_URL } from "@/config/site";

const SFX_BASE_URL = `${ACA_ASSETS_URL}/content-media/sfx`;

const SFX_LIBRARY = [
  { name: "Whoosh", file: "whoosh.wav", duration: 0.5 },
  { name: "Pop", file: "pop.wav", duration: 0.2 },
  { name: "Click", file: "click.wav", duration: 0.3 },
  { name: "Ding", file: "ding.wav", duration: 0.8 },
  { name: "Boom", file: "boom.wav", duration: 1.0 },
  { name: "Record Scratch", file: "record_scratch.wav", duration: 0.8 },
  { name: "Cash Register", file: "cash_register.wav", duration: 0.6 },
  { name: "Typing", file: "typing.wav", duration: 1.5 },
];

export function SoundEffectsPanel() {
  const { state, addSoundEffect, removeSoundEffect } = useVideoEditor();
  const { currentOrganization } = useAuth();
  const currentEffects = state.project.sound_effects ?? [];

  // AI generation state
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(2);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string; duration: number } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingLibraryFile, setPlayingLibraryFile] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const libraryAudioRef = useRef<HTMLAudioElement | null>(null);

  // Saved SFX from storage
  const [savedSfx, setSavedSfx] = useState<Array<{ name: string; url: string }>>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [playingSavedUrl, setPlayingSavedUrl] = useState<string | null>(null);
  const savedAudioRef = useRef<HTMLAudioElement | null>(null);

  // Load saved SFX on mount
  useEffect(() => {
    if (!currentOrganization?.id) return;
    setIsLoadingSaved(true);
    supabase.storage
      .from("content-media")
      .list(`video-editor/${currentOrganization.id}`, { limit: 50, sortBy: { column: "created_at", order: "desc" } })
      .then(({ data: files }) => {
        const sfxFiles = (files || [])
          .filter((f) => f.name.startsWith("sfx_ai_") && f.name.match(/\.(mp3|wav)$/i))
          .map((f) => {
            const { data: { publicUrl } } = supabase.storage
              .from("content-media")
              .getPublicUrl(`video-editor/${currentOrganization.id}/${f.name}`);
            return { name: f.name.replace(/^sfx_ai_\d+\./, "").replace(/\.(mp3|wav)$/i, "") || f.name, url: publicUrl };
          });
        setSavedSfx(sfxFiles);
      })
      .finally(() => setIsLoadingSaved(false));
  }, [currentOrganization?.id, preview]); // re-fetch when a new SFX is generated

  const handlePlaySaved = useCallback((url: string) => {
    if (playingSavedUrl === url) {
      savedAudioRef.current?.pause();
      savedAudioRef.current = null;
      setPlayingSavedUrl(null);
      return;
    }
    if (savedAudioRef.current) savedAudioRef.current.pause();
    const audio = new Audio(url);
    audio.volume = 0.7;
    audio.play().catch(() => {});
    audio.onended = () => setPlayingSavedUrl(null);
    savedAudioRef.current = audio;
    setPlayingSavedUrl(url);
  }, [playingSavedUrl]);

  const handleAddSaved = useCallback((item: { name: string; url: string }) => {
    const effect: SoundEffect = {
      id: `sfx_saved_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      url: item.url,
      name: item.name,
      timestamp: 0,
      duration: 2,
      volume: 0.8,
    };
    addSoundEffect(effect);
  }, [addSoundEffect]);

  const handleAdd = useCallback(
    (sfx: (typeof SFX_LIBRARY)[0]) => {
      const effect: SoundEffect = {
        id: `sfx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        url: `${SFX_BASE_URL}/${sfx.file}`,
        name: sfx.name,
        timestamp: 0,
        duration: sfx.duration,
        volume: 0.8,
      };
      addSoundEffect(effect);
    },
    [addSoundEffect]
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || !currentOrganization?.id) return;
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-sound-effect", {
        body: {
          text: prompt.trim(),
          duration_seconds: duration,
          organization_id: currentOrganization.id,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPreview({ url: data.audio_url, name: prompt.trim(), duration: data.duration });
      toast.success("Sound effect generated");
    } catch (err: any) {
      toast.error("Generation failed", { description: err.message });
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, duration, currentOrganization]);

  const handlePreviewPlay = useCallback(() => {
    if (!preview) return;
    if (isPlaying) {
      audioRef.current?.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }
    const audio = new Audio(preview.url);
    audio.volume = 0.7;
    audio.play().catch(() => {});
    audio.onended = () => setIsPlaying(false);
    audioRef.current = audio;
    setIsPlaying(true);
  }, [preview, isPlaying]);

  const handleLibraryPreview = useCallback((sfx: (typeof SFX_LIBRARY)[0]) => {
    if (playingLibraryFile === sfx.file) {
      libraryAudioRef.current?.pause();
      libraryAudioRef.current = null;
      setPlayingLibraryFile(null);
      return;
    }
    if (libraryAudioRef.current) {
      libraryAudioRef.current.pause();
    }
    const audio = new Audio(`${SFX_BASE_URL}/${sfx.file}`);
    audio.volume = 0.7;
    audio.play().catch(() => {});
    audio.onended = () => setPlayingLibraryFile(null);
    libraryAudioRef.current = audio;
    setPlayingLibraryFile(sfx.file);
  }, [playingLibraryFile]);

  const handleAddGenerated = useCallback(() => {
    if (!preview) return;
    const effect: SoundEffect = {
      id: `sfx_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      url: preview.url,
      name: preview.name.length > 30 ? preview.name.substring(0, 27) + "..." : preview.name,
      timestamp: 0,
      duration: preview.duration,
      volume: 0.8,
    };
    addSoundEffect(effect);
    setPreview(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }
  }, [preview, addSoundEffect]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Sound Effects</span>
      </div>

      <div className="p-3 space-y-4">
        {/* Active effects */}
        {currentEffects.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Active Effects
            </span>
            {currentEffects.map((effect) => (
              <div
                key={effect.id}
                className="flex items-center gap-2 p-1.5 rounded bg-amber-500/10 border border-amber-500/20"
              >
                <Volume2 className="h-3 w-3 text-amber-400 flex-shrink-0" />
                <span className="text-xs flex-1 truncate">{effect.name}</span>
                <span className="text-[10px] text-muted-foreground">
                  @{effect.timestamp.toFixed(1)}s
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => removeSoundEffect(effect.id)}
                >
                  <Trash2 className="h-2.5 w-2.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* AI Generate */}
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            AI Generate
          </span>
          <Textarea
            placeholder="Describe the sound effect... (e.g. cinematic whoosh, cash register ding, dramatic boom)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="text-xs min-h-[60px] resize-none"
            rows={2}
          />
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              Duration: {duration}s
            </Label>
            <Slider
              value={[duration]}
              min={0.5}
              max={10}
              step={0.5}
              onValueChange={([val]) => setDuration(val)}
            />
          </div>
          <Button
            variant="cta"
            size="sm"
            className="w-full"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim() || !currentOrganization?.id}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Generate Sound Effect
              </>
            )}
          </Button>

          {/* Preview */}
          {preview && (
            <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePreviewPlay}
                  className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 hover:bg-emerald-500/20 transition-colors"
                >
                  {isPlaying ? (
                    <Pause className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Play className="h-3 w-3 text-muted-foreground ml-0.5" />
                  )}
                </button>
                <span className="text-xs flex-1 truncate text-emerald-400">
                  {preview.name}
                </span>
                <span className="text-[10px] text-muted-foreground">{preview.duration}s</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleAddGenerated}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add to Timeline
              </Button>
            </div>
          )}
        </div>

        {/* Saved AI SFX */}
        {savedSfx.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              Generated ({savedSfx.length})
            </span>
            {savedSfx.map((item) => (
              <div
                key={item.url}
                className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent/50 group"
              >
                <button
                  onClick={() => handlePlaySaved(item.url)}
                  className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 hover:bg-emerald-500/20 transition-colors"
                >
                  {playingSavedUrl === item.url ? (
                    <Pause className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Play className="h-3 w-3 text-muted-foreground ml-0.5" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">{item.name}</div>
                </div>
                <button
                  onClick={() => handleAddSaved(item)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Add to timeline"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-[10px]">
            <span className="bg-card px-2 text-muted-foreground">or pick from library</span>
          </div>
        </div>

        {/* Library */}
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Library
          </span>
          {SFX_LIBRARY.map((sfx) => (
            <div
              key={sfx.file}
              className="flex items-center gap-2 p-1.5 rounded-md hover:bg-accent/50 group"
            >
              <button
                onClick={() => handleLibraryPreview(sfx)}
                className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 hover:bg-amber-500/20 transition-colors"
              >
                {playingLibraryFile === sfx.file ? (
                  <Pause className="h-3 w-3 text-amber-400" />
                ) : (
                  <Play className="h-3 w-3 text-muted-foreground ml-0.5" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-xs">{sfx.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {sfx.duration}s
                </div>
              </div>
              <button
                onClick={() => handleAdd(sfx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title="Add to timeline"
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
