import { useState, useCallback, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Mic, Loader2, Play, Pause, Upload, Trash2 } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const AI_VOICES = [
  { id: "rachel", name: "Rachel", accent: "American", gender: "Female" },
  { id: "drew", name: "Drew", accent: "American", gender: "Male" },
  { id: "clyde", name: "Clyde", accent: "American", gender: "Male" },
  { id: "paul", name: "Paul", accent: "American", gender: "Male" },
  { id: "domi", name: "Domi", accent: "American", gender: "Female" },
  { id: "dave", name: "Dave", accent: "British-Essex", gender: "Male" },
  { id: "fin", name: "Fin", accent: "Irish", gender: "Male" },
  { id: "sarah", name: "Sarah", accent: "American (Soft)", gender: "Female" },
  { id: "antoni", name: "Antoni", accent: "American", gender: "Male" },
  { id: "elli", name: "Elli", accent: "American", gender: "Female" },
];

export function VoiceoverPanel() {
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState("rachel");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state, setVoiceover } = useVideoEditor();
  const { currentOrganization } = useAuth();

  const handleGenerate = useCallback(async () => {
    if (!script.trim() || !currentOrganization?.id) return;
    setIsGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke("execute-stage", {
        body: {
          action: "generate_tts",
          text: script.trim(),
          voice_id: voiceId,
          organization_id: currentOrganization.id,
          with_timestamps: true,
        },
      });

      if (error) throw error;

      setVoiceover({
        url: data.audio_url,
        word_timestamps: data.word_timestamps,
        voice_id: voiceId,
        source: "ai",
        script: script.trim(),
      });
    } catch (err) {
      console.error("TTS generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  }, [script, voiceId, currentOrganization, setVoiceover]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (!currentOrganization?.id) return;
      setIsGenerating(true);

      const ext = file.name.split(".").pop() || "mp3";
      const path = `video-editor/${currentOrganization.id}/voiceover_${Date.now()}.${ext}`;

      const { error } = await supabase.storage
        .from("content-media")
        .upload(path, file, { contentType: file.type });

      if (error) {
        console.error("Upload failed:", error);
        setIsGenerating(false);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("content-media").getPublicUrl(path);

      setVoiceover({
        url: publicUrl,
        source: "uploaded",
      });
      setIsGenerating(false);
    },
    [currentOrganization, setVoiceover]
  );

  const togglePlayback = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Voiceover</span>
      </div>

      <div className="p-3 space-y-4">
        {/* Current voiceover */}
        {state.project.voiceover?.url && (
          <div className="rounded-md bg-blue-500/10 border border-blue-500/20 p-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-blue-400">
                Active Voiceover ({state.project.voiceover.source})
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setVoiceover(undefined)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={togglePlayback}
              >
                {isPlaying ? (
                  <Pause className="h-3 w-3" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
              </Button>
              <audio
                ref={audioRef}
                src={state.project.voiceover.url}
                onEnded={() => setIsPlaying(false)}
              />
              <span className="text-[10px] text-muted-foreground truncate">
                {state.project.voiceover.word_timestamps
                  ? `${state.project.voiceover.word_timestamps.length} words`
                  : "Audio uploaded"}
              </span>
            </div>
          </div>
        )}

        {/* AI Generation */}
        <div className="space-y-2">
          <Label className="text-xs">Script</Label>
          <Textarea
            placeholder="Type or paste your voiceover script..."
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="text-xs min-h-[100px] resize-none"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Voice</Label>
          <Select value={voiceId} onValueChange={setVoiceId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_VOICES.map((v) => (
                <SelectItem key={v.id} value={v.id} className="text-xs">
                  {v.name} ({v.accent}, {v.gender})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="cta"
          size="sm"
          className="w-full"
          onClick={handleGenerate}
          disabled={isGenerating || !script.trim()}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Mic className="h-3.5 w-3.5 mr-1.5" />
              Generate Voiceover
            </>
          )}
        </Button>

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
          Upload Audio File
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
