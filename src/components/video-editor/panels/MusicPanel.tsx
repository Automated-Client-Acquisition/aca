import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Music, Play, Pause, Upload, Trash2, Search, Loader2, Sparkles } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MusicTrackResult {
  id: string;
  title: string;
  url: string;
  duration: number;
  tags?: string;
  user?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MusicPanel() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MusicTrackResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state, setMusic } = useVideoEditor();
  const { currentOrganization } = useAuth();

  const currentMusic = state.project.music;

  // AI music generation state
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicDuration, setMusicDuration] = useState(30);
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<{ url: string; title: string } | null>(null);
  const [isPreviewingGenerated, setIsPreviewingGenerated] = useState(false);
  const generatedAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleGenerateMusic = useCallback(async () => {
    if (!musicPrompt.trim() || !currentOrganization?.id) return;
    setIsGeneratingMusic(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-music", {
        body: {
          prompt: musicPrompt.trim(),
          duration_ms: musicDuration * 1000,
          organization_id: currentOrganization.id,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setGeneratedPreview({ url: data.audio_url, title: data.title });
      toast.success("Music generated - preview it below");
    } catch (err: any) {
      toast.error("Music generation failed", { description: err.message });
    } finally {
      setIsGeneratingMusic(false);
    }
  }, [musicPrompt, musicDuration, currentOrganization]);

  const handlePreviewGenerated = useCallback(() => {
    if (!generatedPreview) return;
    if (isPreviewingGenerated) {
      generatedAudioRef.current?.pause();
      generatedAudioRef.current = null;
      setIsPreviewingGenerated(false);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlayingId(null);
    }
    const audio = new Audio(generatedPreview.url);
    audio.volume = 0.5;
    audio.play().catch(() => {});
    audio.onended = () => setIsPreviewingGenerated(false);
    generatedAudioRef.current = audio;
    setIsPreviewingGenerated(true);
  }, [generatedPreview, isPreviewingGenerated]);

  const handleUseGenerated = useCallback(() => {
    if (!generatedPreview) return;
    if (generatedAudioRef.current) {
      generatedAudioRef.current.pause();
      generatedAudioRef.current = null;
      setIsPreviewingGenerated(false);
    }
    setMusic({
      url: generatedPreview.url,
      title: generatedPreview.title,
      volume: currentMusic?.volume ?? 0.15,
      source: "ai",
    });
    setGeneratedPreview(null);
  }, [generatedPreview, setMusic, currentMusic?.volume]);

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !currentOrganization?.id) return;
    setIsSearching(true);
    try {
      // Search Supabase storage for previously uploaded music
      const { data: files, error } = await supabase.storage
        .from("content-media")
        .list(`video-editor/${currentOrganization.id}`, {
          search: query.trim(),
        });
      if (error) throw error;

      const musicFiles = (files || [])
        .filter((f) => f.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i))
        .map((f) => {
          const { data: { publicUrl } } = supabase.storage
            .from("content-media")
            .getPublicUrl(`video-editor/${currentOrganization.id}/${f.name}`);
          return {
            id: f.id || f.name,
            title: f.name.replace(/\.[^.]+$/, "").replace(/music_\d+_?/, ""),
            url: publicUrl,
            duration: 0,
          };
        });

      setResults(musicFiles);
      if (musicFiles.length === 0) {
        toast.info("No music found. Upload audio files first.");
      }
    } catch (err: any) {
      toast.error("Music search failed", { description: err.message });
    } finally {
      setIsSearching(false);
    }
  }, [query, currentOrganization]);

  const handleSelectTrack = useCallback(
    (track: MusicTrackResult) => {
      setMusic({
        url: track.url,
        title: track.title,
        volume: currentMusic?.volume ?? 0.15,
        source: "library",
      });
      // Stop preview
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPlayingId(null);
    },
    [setMusic, currentMusic?.volume]
  );

  const handlePreview = useCallback(
    (track: MusicTrackResult) => {
      if (playingId === track.id) {
        audioRef.current?.pause();
        audioRef.current = null;
        setPlayingId(null);
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(track.url);
      audio.volume = 0.5;
      audio.play().catch(() => {});
      audio.onended = () => setPlayingId(null);
      audioRef.current = audio;
      setPlayingId(track.id);
    },
    [playingId]
  );

  const handleUpload = useCallback(
    async (file: File) => {
      if (!currentOrganization?.id) return;

      const ext = file.name.split(".").pop() || "mp3";
      const path = `video-editor/${currentOrganization.id}/music_${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("content-media")
        .upload(path, file, { contentType: file.type });

      if (error) {
        toast.error("Upload failed", { description: error.message });
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("content-media").getPublicUrl(path);

      setMusic({
        url: publicUrl,
        title: file.name.replace(/\.[^.]+$/, ""),
        volume: currentMusic?.volume ?? 0.15,
        source: "uploaded",
      });
      toast.success("Music uploaded");
    },
    [currentOrganization, setMusic, currentMusic?.volume]
  );

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Background Music</span>
      </div>

      <div className="p-3 space-y-4">
        {/* Current music */}
        {currentMusic?.url && (
          <div className="rounded-md bg-purple-500/10 border border-purple-500/20 p-2 space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (playingId === "__current__") {
                    audioRef.current?.pause();
                    audioRef.current = null;
                    setPlayingId(null);
                    return;
                  }
                  if (audioRef.current) audioRef.current.pause();
                  const audio = new Audio(currentMusic.url);
                  audio.volume = 0.5;
                  audio.play().catch(() => {});
                  audio.onended = () => setPlayingId(null);
                  audioRef.current = audio;
                  setPlayingId("__current__");
                }}
                className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 hover:bg-purple-500/20 transition-colors"
              >
                {playingId === "__current__" ? (
                  <Pause className="h-3 w-3 text-purple-400" />
                ) : (
                  <Play className="h-3 w-3 text-muted-foreground ml-0.5" />
                )}
              </button>
              <span className="text-xs text-purple-400 truncate flex-1">
                {currentMusic.title || "Custom Music"}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => setMusic(undefined)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Volume: {Math.round(currentMusic.volume * 100)}%
              </Label>
              <Slider
                value={[currentMusic.volume]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([val]) =>
                  setMusic({ ...currentMusic, volume: val })
                }
              />
            </div>
          </div>
        )}

        {/* AI Generate */}
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            AI Generate
          </span>
          <Textarea
            placeholder="Describe the music style... (e.g. upbeat lo-fi hip hop, cinematic orchestral, chill ambient)"
            value={musicPrompt}
            onChange={(e) => setMusicPrompt(e.target.value)}
            className="text-xs min-h-[60px] resize-none"
            rows={2}
          />
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">
              Duration: {musicDuration}s
            </Label>
            <Slider
              value={[musicDuration]}
              min={15}
              max={120}
              step={5}
              onValueChange={([val]) => setMusicDuration(val)}
            />
          </div>
          <Button
            variant="cta"
            size="sm"
            className="w-full"
            onClick={handleGenerateMusic}
            disabled={isGeneratingMusic || !musicPrompt.trim() || !currentOrganization?.id}
          >
            {isGeneratingMusic ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating... (up to 60s)
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                Generate Music
              </>
            )}
          </Button>

          {/* Generated preview */}
          {generatedPreview && (
            <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePreviewGenerated}
                  className="h-6 w-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 hover:bg-emerald-500/20 transition-colors"
                >
                  {isPreviewingGenerated ? (
                    <Pause className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Play className="h-3 w-3 text-muted-foreground ml-0.5" />
                  )}
                </button>
                <span className="text-xs flex-1 truncate text-emerald-400">
                  {generatedPreview.title}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleUseGenerated}
              >
                <Music className="h-3.5 w-3.5 mr-1.5" />
                Use as Background Music
              </Button>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-[10px]">
            <span className="bg-card px-2 text-muted-foreground">or search uploaded</span>
          </div>
        </div>

        {/* Search */}
        <div className="flex gap-1.5">
          <Input
            placeholder="Search music (e.g. upbeat, cinematic)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="h-8 text-xs"
          />
          <Button
            variant="cta"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleSearch}
            disabled={isSearching || !query.trim()}
          >
            {isSearching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-1">
            {results.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 cursor-pointer group"
                onClick={() => handleSelectTrack(track)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(track);
                  }}
                  className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 hover:bg-purple-500/20 transition-colors"
                >
                  {playingId === track.id ? (
                    <Pause className="h-3 w-3 text-purple-400" />
                  ) : (
                    <Play className="h-3 w-3 text-muted-foreground ml-0.5" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{track.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {formatDuration(track.duration)}
                    {track.user && ` - ${track.user}`}
                  </div>
                </div>
                {currentMusic?.url === track.url && (
                  <Music className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !isSearching && (
          <div className="text-center py-4">
            <Music className="h-6 w-6 mx-auto text-muted-foreground/20 mb-2" />
            <p className="text-[10px] text-muted-foreground">
              Upload music or search your uploaded files
            </p>
          </div>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-[10px]">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        {/* Upload */}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5 mr-1.5" />
          Upload Music
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
      </div>
    </div>
  );
}
