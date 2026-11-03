import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAutosave } from "@/hooks/useAutosave";
import { useElevenLabsVoices } from "@/hooks/useElevenLabsVoices";
import { useHeyGenVoices } from "@/hooks/useHeyGenVoices";
import { useHeyGenAvatars } from "@/hooks/useHeyGenAvatars";
import { useCreateHeyGenAvatar, useCheckHeyGenTraining } from "@/hooks/useCreateHeyGenAvatar";
import { useApiKeys } from "@/hooks/useApiKeys";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { User, Calendar, Trash2, Sparkles, Palette, Mic2, Heart, AlertCircle, Settings, Play, Pause, Volume2, Video, Loader2, CheckCircle, Check, XCircle, Plus, Search } from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Lightbox } from "@/components/ui/lightbox";
import { Link } from "react-router-dom";
import type { HeyGenAvatarProfile } from "@/hooks/useCharacters";
import { EditableList } from "./EditableList";

interface Character {
  id: string;
  name: string;
  description: string | null;
  visual_style: string | null;
  gender: string | null;
  age_range: string | null;
  build: string | null;
  ethnicity: string | null;
  hair_description: string | null;
  typical_clothing: string | null;
  voice_selection: string | null;
  overall_tone: string | null;
  speaking_style: string | null;
  personality: any;
  reference_images: string[] | null;
  tags: string[] | null;
  usage_count: number | null;
  created_at: string | null;
  heygen_avatar_id: string | null;
  heygen_avatar_group_id: string | null;
  heygen_avatar_status: 'none' | 'training' | 'ready' | 'failed' | null;
  heygen_voice_id: string | null;
  heygen_config: Record<string, any> | null;
  heygen_avatars: HeyGenAvatarProfile[];
}

interface CharacterDetailsDialogProps {
  character: Character | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<Character>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}

export function CharacterDetailsDialog({ character, open, onOpenChange, onSave, onDelete, isUpdating }: CharacterDetailsDialogProps) {
  const [edited, setEdited] = useState<Partial<Character>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { data: voices, isLoading: voicesLoading, error: voicesError } = useElevenLabsVoices();
  const isElevenLabsConnected = !voicesError && voices && voices.length > 0;
  const { data: heygenVoices, isLoading: heygenVoicesLoading, error: heygenVoicesError } = useHeyGenVoices();
  const { data: heygenAvatars, isLoading: heygenAvatarsLoading, error: heygenAvatarsError } = useHeyGenAvatars();
  const { data: apiKeys } = useApiKeys();
  const hasHeyGenKey = apiKeys?.some(k => k.provider === 'heygen' && k.is_valid);
  const createHeyGenAvatar = useCreateHeyGenAvatar();
  const checkHeyGenTraining = useCheckHeyGenTraining();
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileAvatarId, setNewProfileAvatarId] = useState("");
  const [newProfileVoiceId, setNewProfileVoiceId] = useState("");
  const [avatarSearch, setAvatarSearch] = useState("");
  const [voiceSearch, setVoiceSearch] = useState("");

  useEffect(() => {
    if (!open || !character) {
      setEdited({});
      setImageFiles([]);
      setImagePreviews([]);
      setExistingImages([]);
      // Stop any playing audio when dialog closes
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlayingVoice(false);
      setAddingProfile(false);
      setNewProfileName("");
      setNewProfileAvatarId("");
      setNewProfileVoiceId("");
    } else {
      setExistingImages(character.reference_images || []);
    }
  }, [open, character?.id]);

  const playVoicePreview = (previewUrl: string) => {
    // If same audio is playing, stop it (toggle)
    if (isPlayingVoice && audioRef.current?.src === previewUrl) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlayingVoice(false);
      return;
    }

    // Stop any currently playing audio first
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    const audio = new Audio(previewUrl);
    audioRef.current = audio;

    audio.onended = () => {
      setIsPlayingVoice(false);
      audioRef.current = null;
    };

    audio.onerror = () => {
      toast.error("Failed to play voice preview");
      setIsPlayingVoice(false);
      audioRef.current = null;
    };

    audio.play().catch(() => {
      setIsPlayingVoice(false);
      audioRef.current = null;
    });
    setIsPlayingVoice(true);
  };

  const { isSaving } = useAutosave(
    async (updates) => {
      if (character && Object.keys(updates).length > 0) {
        // Remove the _trigger field before saving (it's only used to trigger autosave)
        const { _trigger, ...finalUpdates } = updates as any;

        // Handle new image uploads
        if (imageFiles.length > 0) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const newImageUrls: string[] = [];

            for (const imageFile of imageFiles) {
              const fileExt = imageFile.name.split('.').pop();
              const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

              const { error: uploadError } = await supabase.storage
                .from('character-images')
                .upload(fileName, imageFile);

              if (uploadError) {
                toast.error(`Failed to upload image: ${imageFile.name}`);
                throw uploadError;
              }

              const { data: { publicUrl } } = supabase.storage
                .from('character-images')
                .getPublicUrl(fileName);

              newImageUrls.push(publicUrl);
            }

            // Combine existing and new images
            (finalUpdates as any).reference_images = [...existingImages, ...newImageUrls];
            setExistingImages((finalUpdates as any).reference_images);
            setImageFiles([]);
            setImagePreviews([]);
          }
        } else {
          // Check if existing images have actually changed (compare array contents, not reference)
          const originalImages = character.reference_images || [];
          const imagesChanged = existingImages.length !== originalImages.length ||
            existingImages.some((img, i) => img !== originalImages[i]);

          if (imagesChanged) {
            // Only existing images changed (deleted some)
            (finalUpdates as any).reference_images = existingImages.length > 0 ? existingImages : null;
          }
        }

        onSave(character.id, finalUpdates);
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating
  );

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setImageFiles(prev => [...prev, ...files]);

      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreviews(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file);
      });

      // Trigger save
      setEdited(prev => ({ ...prev, _trigger: Date.now() }));
    }
  };

  const removeNewImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const removeExistingImage = (imageUrl: string) => {
    setExistingImages(prev => prev.filter(url => url !== imageUrl));
    setEdited(prev => ({ ...prev, _trigger: Date.now() }));
  };

  const handleDelete = () => {
    if (character) {
      onDelete(character.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  if (!character) return null;

  const currentName = edited.name ?? character.name;
  const currentDescription = edited.description ?? character.description ?? "";
  const currentTags = edited.tags ?? character.tags ?? [];
  const currentVisualStyle = edited.visual_style ?? character.visual_style ?? "";
  const currentGender = edited.gender ?? character.gender ?? "";
  const currentAgeRange = edited.age_range ?? character.age_range ?? "";
  const currentBuild = edited.build ?? character.build ?? "";
  const currentEthnicity = edited.ethnicity ?? character.ethnicity ?? "";
  const currentHairDescription = edited.hair_description ?? character.hair_description ?? "";
  const currentTypicalClothing = edited.typical_clothing ?? character.typical_clothing ?? "";
  const currentVoiceSelection = edited.voice_selection ?? character.voice_selection ?? "";
  const currentOverallTone = edited.overall_tone ?? character.overall_tone ?? "";
  const currentSpeakingStyle = edited.speaking_style ?? character.speaking_style ?? "";
  const currentPersonality = edited.personality ?? character.personality;
  const currentHeygenAvatarId = edited.heygen_avatar_id ?? character.heygen_avatar_id ?? "";
  const currentHeygenVoiceId = edited.heygen_voice_id ?? character.heygen_voice_id ?? "";
  const currentHeygenAvatarStatus = edited.heygen_avatar_status ?? character.heygen_avatar_status ?? "none";
  const currentHeygenAvatars: HeyGenAvatarProfile[] = (edited as any).heygen_avatars ?? character.heygen_avatars ?? [];

  const resetAddProfileForm = () => {
    setAddingProfile(false);
    setNewProfileName("");
    setNewProfileAvatarId("");
    setNewProfileVoiceId("");
    setAvatarSearch("");
    setVoiceSearch("");
  };

  const addAvatarProfile = () => {
    if (!newProfileAvatarId) {
      toast.error("Please select an avatar");
      return;
    }
    if (!newProfileVoiceId) {
      toast.error("Please select a voice");
      return;
    }
    const selectedAvatar = heygenAvatars?.find(a => a.avatar_id === newProfileAvatarId);
    const voiceId = newProfileVoiceId;
    const selectedVoice = voiceId ? heygenVoices?.find(v => v.voice_id === voiceId) : null;
    const profileName = newProfileName || selectedAvatar?.name || 'Avatar';

    const newProfile: HeyGenAvatarProfile = {
      id: crypto.randomUUID(),
      name: profileName,
      avatar_id: newProfileAvatarId,
      avatar_type: 'prebuilt',
      voice_id: voiceId,
      voice_name: selectedVoice?.name,
      avatar_name: selectedAvatar?.name,
      preview_image_url: selectedAvatar?.preview_image_url,
    };

    const updated = [...currentHeygenAvatars, newProfile];
    setEdited({ ...edited, heygen_avatars: updated } as any);

    // Also set the legacy fields to the first profile for backward compat
    if (updated.length === 1) {
      setEdited(prev => ({
        ...prev,
        heygen_avatars: updated,
        heygen_avatar_id: newProfileAvatarId,
        heygen_voice_id: newProfileVoiceId,
      } as any));
    }

    resetAddProfileForm();
    toast.success(`Avatar profile "${profileName}" added`);
  };

  const removeAvatarProfile = (profileId: string) => {
    const updated = currentHeygenAvatars.filter(p => p.id !== profileId);
    const edits: any = { ...edited, heygen_avatars: updated };
    // Update legacy fields to first remaining profile
    if (updated.length > 0) {
      edits.heygen_avatar_id = updated[0].avatar_id;
      edits.heygen_voice_id = updated[0].voice_id;
    } else {
      edits.heygen_avatar_id = null;
      edits.heygen_voice_id = null;
    }
    setEdited(edits);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-4xl p-0" aria-describedby={undefined}>
          <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); }}>
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <User className="w-5 h-5 text-foreground" />
                  </div>
                  <DialogTitle className="text-xl">{currentName}</DialogTitle>
                </div>
                <div className="flex items-center gap-3">
                  <AutosaveIndicator isSaving={isSaving} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteDialogOpen(true)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <Tabs defaultValue="basic" className="flex flex-col flex-1 min-h-0">
              <TabsList className="shrink-0 flex w-auto mx-6 mt-2">
                <TabsTrigger value="basic" className="flex-1 gap-1.5">
                  <User className="w-4 h-4" />
                  Basic
                </TabsTrigger>
                <TabsTrigger value="visual" className="flex-1 gap-1.5">
                  <Palette className="w-4 h-4" />
                  Visual
                </TabsTrigger>
                <TabsTrigger value="voice" className="flex-1 gap-1.5">
                  <Mic2 className="w-4 h-4" />
                  Voice
                </TabsTrigger>
                <TabsTrigger value="heygen" className="flex-1 gap-1.5">
                  <Video className="w-4 h-4" />
                  HeyGen
                </TabsTrigger>
                <TabsTrigger value="personality" className="flex-1 gap-1.5">
                  <Heart className="w-4 h-4" />
                  Personality
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 py-4">
                  <TabsContent value="basic" className="space-y-4 mt-0">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={currentName}
                        onChange={(e) => setEdited({ ...edited, name: e.target.value })}
                        placeholder="Character name"
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={currentDescription}
                        onChange={(e) => setEdited({ ...edited, description: e.target.value })}
                        placeholder="Character description"
                        className="min-h-[100px] max-h-[250px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Tags</Label>
                      <EditableList
                        items={currentTags}
                        onChange={(tags) => setEdited({ ...edited, tags })}
                        placeholder="Add tags such as founder, customer, or spokesperson..."
                      />
                      <p className="text-xs text-muted-foreground">
                        Tags help you find this face; selecting it remains explicit.
                      </p>
                    </div>

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        <span>Created {formatDate(character.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Sparkles className="w-4 h-4" />
                        <span>Used {character.usage_count || 0} times</span>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="visual" className="space-y-4 mt-0">
                    <div className="space-y-2">
                      <Label>Reference Images</Label>
                      <div className="space-y-2">
                        <Input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageChange}
                          className="cursor-pointer"
                        />

                        {/* Display existing images */}
                        {existingImages.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Current Images</p>
                            <div className="grid grid-cols-2 gap-3">
                              {existingImages.map((imageUrl, index) => (
                                <div
                                  key={`existing-${index}`}
                                  className="relative group cursor-pointer"
                                  onClick={() => setPreviewImage(imageUrl)}
                                >
                                  <div className="relative rounded-md overflow-hidden border border-border bg-muted/30">
                                    <img
                                      src={imageUrl}
                                      alt={`Reference ${index + 1}`}
                                      className="w-full h-auto object-contain transition-transform group-hover:scale-105"
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeExistingImage(imageUrl);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Display new image previews */}
                        {imagePreviews.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">New Images (not saved yet)</p>
                            <div className="grid grid-cols-2 gap-3">
                              {imagePreviews.map((preview, index) => (
                                <div
                                  key={`new-${index}`}
                                  className="relative group cursor-pointer"
                                  onClick={() => setPreviewImage(preview)}
                                >
                                  <div className="relative rounded-md overflow-hidden border border-border border-dashed bg-muted/30">
                                    <img
                                      src={preview}
                                      alt={`New ${index + 1}`}
                                      className="w-full h-auto object-contain transition-transform group-hover:scale-105"
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeNewImage(index);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <p className="text-sm text-muted-foreground">
                          Upload reference images for consistent character generation. You can select multiple images.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Visual Style</Label>
                      <Textarea
                        value={currentVisualStyle}
                        onChange={(e) => setEdited({ ...edited, visual_style: e.target.value })}
                        placeholder="e.g., Photorealistic, Cartoon, Anime"
                        className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Gender</Label>
                        <Select
                          value={currentGender}
                          onValueChange={(value) => setEdited({ ...edited, gender: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="non-binary">Non-binary</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label>Age Range</Label>
                        <Input
                          value={currentAgeRange}
                          onChange={(e) => setEdited({ ...edited, age_range: e.target.value })}
                          placeholder="e.g., 25-35"
                          className="focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Build</Label>
                        <Input
                          value={currentBuild}
                          onChange={(e) => setEdited({ ...edited, build: e.target.value })}
                          placeholder="e.g., Athletic, Average"
                          className="focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Ethnicity</Label>
                        <Input
                          value={currentEthnicity}
                          onChange={(e) => setEdited({ ...edited, ethnicity: e.target.value })}
                          placeholder="e.g., Caucasian, Asian"
                          className="focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Hair Description</Label>
                      <Textarea
                        value={currentHairDescription}
                        onChange={(e) => setEdited({ ...edited, hair_description: e.target.value })}
                        placeholder="Describe hair color, style, length"
                        className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Typical Clothing</Label>
                      <Textarea
                        value={currentTypicalClothing}
                        onChange={(e) => setEdited({ ...edited, typical_clothing: e.target.value })}
                        placeholder="Describe typical clothing style"
                        className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="voice" className="space-y-4 mt-0">
                    <div className="space-y-2">
                      <Label>Voice Selection</Label>
                      {voicesError || (!voicesLoading && (!voices || voices.length === 0)) ? (
                        <Alert className="border-amber-500/50 bg-amber-500/10">
                          <AlertCircle className="h-4 w-4 text-amber-500" />
                          <AlertDescription className="text-sm">
                            <span className="font-medium">ElevenLabs not connected.</span>{" "}
                            Add your ElevenLabs API key in{" "}
                            <Link to="/settings?tab=integrations" className="font-medium underline underline-offset-2 hover:text-primary">
                              Settings
                            </Link>{" "}
                            to enable voice selection.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <>
                          {(() => {
                            const selectedVoice = voices?.find(v => v.voice_id === currentVoiceSelection);
                            const voiceName = selectedVoice?.name || (currentVoiceSelection ? "Unknown Voice" : null);

                            return (
                              <>
                                <div className="flex gap-2">
                                  <Select
                                    value={currentVoiceSelection}
                                    onValueChange={(value) => setEdited({ ...edited, voice_selection: value })}
                                    disabled={voicesLoading}
                                  >
                                    <SelectTrigger className="flex-1">
                                      <SelectValue placeholder={voicesLoading ? "Loading voices..." : "Select a voice"}>
                                        {voiceName && (
                                          <span>
                                            {selectedVoice?.name || "Unknown Voice"}
                                            {selectedVoice?.labels?.accent && ` (${selectedVoice.labels.accent})`}
                                          </span>
                                        )}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent>
                                      {voices?.map((voice) => (
                                        <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                          {voice.name} {voice.labels?.accent && `(${voice.labels.accent})`}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {selectedVoice?.preview_url && (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="icon"
                                      onClick={() => playVoicePreview(selectedVoice.preview_url!)}
                                      title={isPlayingVoice ? "Stop preview" : "Play voice preview"}
                                    >
                                      {isPlayingVoice ? (
                                        <Pause className="h-4 w-4" />
                                      ) : (
                                        <Play className="h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                </div>
                                {currentVoiceSelection && (
                                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Volume2 className="h-3.5 w-3.5" />
                                    <span>{selectedVoice?.name || currentVoiceSelection}</span>
                                    {isPlayingVoice && <span className="text-primary animate-pulse">Playing...</span>}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>Overall Tone</Label>
                      <Input
                        value={currentOverallTone}
                        onChange={(e) => setEdited({ ...edited, overall_tone: e.target.value })}
                        placeholder="e.g., Professional, Friendly"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Speaking Style</Label>
                      <Textarea
                        value={currentSpeakingStyle}
                        onChange={(e) => setEdited({ ...edited, speaking_style: e.target.value })}
                        placeholder="Describe how the character speaks"
                        className="min-h-[100px] max-h-[250px] resize-y"
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="heygen" className="space-y-4 mt-0">
                    {!hasHeyGenKey ? (
                      <Alert className="border-amber-500/50 bg-amber-500/10">
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="text-sm">
                          HeyGen API key not configured.{" "}
                          <Link to="/settings?tab=integrations" className="font-medium underline underline-offset-2 hover:text-primary">
                            Add it in Settings
                          </Link>
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        {/* API connection error */}
                        {(heygenAvatarsError || heygenVoicesError) && (
                          <Alert className="border-red-500/50 bg-red-500/10">
                            <AlertCircle className="h-4 w-4 text-red-500" />
                            <AlertDescription className="text-sm">
                              Failed to connect to HeyGen API: {(heygenAvatarsError as Error)?.message || (heygenVoicesError as Error)?.message || 'Unknown error'}
                            </AlertDescription>
                          </Alert>
                        )}

                        {/* Avatar training status */}
                        {currentHeygenAvatarStatus === 'training' && (
                          <Alert className="border-blue-500/50 bg-blue-500/10">
                            <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                            <AlertDescription className="text-sm flex items-center justify-between">
                              <span>Custom avatar is being trained...</span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => checkHeyGenTraining.mutate(character.id)}
                                disabled={checkHeyGenTraining.isPending}
                              >
                                Check Status
                              </Button>
                            </AlertDescription>
                          </Alert>
                        )}

                        {currentHeygenAvatarStatus === 'ready' && character.heygen_avatar_group_id && (
                          <Alert className="border-green-500/50 bg-green-500/10">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <AlertDescription className="text-sm">
                              Custom avatar trained and ready. Add it as a profile below.
                            </AlertDescription>
                          </Alert>
                        )}

                        {currentHeygenAvatarStatus === 'failed' && (
                          <Alert className="border-red-500/50 bg-red-500/10">
                            <XCircle className="h-4 w-4 text-red-500" />
                            <AlertDescription className="text-sm">
                              Avatar training failed. Try creating a new one.
                            </AlertDescription>
                          </Alert>
                        )}

                        {/* Create from reference image */}
                        {currentHeygenAvatarStatus !== 'training' && existingImages.length > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => createHeyGenAvatar.mutate(character.id)}
                            disabled={createHeyGenAvatar.isPending}
                            className="w-full"
                          >
                            {createHeyGenAvatar.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4 mr-2" />
                            )}
                            Train Custom Avatar from Reference Image
                          </Button>
                        )}

                        {/* Saved avatar profiles */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <Label className="text-base">Avatar Profiles</Label>
                            <Badge variant="outline" className="text-xs">
                              {currentHeygenAvatars.length} profile{currentHeygenAvatars.length !== 1 ? 's' : ''}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Each profile is an avatar + voice combo. When generating, select which profiles to use. Multiple profiles = one video per profile.
                          </p>

                          {currentHeygenAvatars.length > 0 && (
                            <div className="space-y-2">
                              {currentHeygenAvatars.map((profile) => {
                                const profileVoice = profile.voice_id
                                  ? heygenVoices?.find(v => v.voice_id === profile.voice_id)
                                  : null;
                                const voicePreviewUrl = profileVoice?.preview_audio;
                                return (
                                  <div
                                    key={profile.id}
                                    className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{profile.name}</p>
                                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                          <Video className="h-3 w-3" />
                                          {profile.avatar_name || profile.avatar_id}
                                        </span>
                                        <span className="flex items-center gap-1">
                                          <Mic2 className="h-3 w-3" />
                                          {profile.voice_name || profile.voice_id}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {voicePreviewUrl && (
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => playVoicePreview(voicePreviewUrl)}
                                          title="Play voice preview"
                                          className="text-muted-foreground hover:text-foreground"
                                        >
                                          {isPlayingVoice && audioRef.current?.src === voicePreviewUrl ? (
                                            <Pause className="h-4 w-4" />
                                          ) : (
                                            <Volume2 className="h-4 w-4" />
                                          )}
                                        </Button>
                                      )}
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => removeAvatarProfile(profile.id)}
                                        className="text-destructive hover:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Add profile form */}
                          {addingProfile ? (
                            <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/10">
                              <div className="space-y-2">
                                <Label className="text-sm">Profile Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                                <Input
                                  value={newProfileName}
                                  onChange={(e) => setNewProfileName(e.target.value)}
                                  placeholder="Defaults to avatar name"
                                  className="h-9"
                                />
                              </div>

                              {/* Avatar selector */}
                              <div className="space-y-1.5">
                                <Label className="text-sm">Avatar</Label>
                                <div className="relative">
                                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                  <Input
                                    value={avatarSearch}
                                    onChange={(e) => setAvatarSearch(e.target.value)}
                                    placeholder="Filter avatars..."
                                    className="h-9 pl-8 text-sm"
                                  />
                                </div>
                                <div className="border rounded-md max-h-[180px] overflow-y-auto">
                                  {heygenAvatarsLoading ? (
                                    <div className="p-3 text-sm text-muted-foreground text-center">Loading avatars...</div>
                                  ) : (() => {
                                    const search = avatarSearch.toLowerCase();
                                    // Dedup by avatar_id
                                    const seen = new Set<string>();
                                    const deduped = (heygenAvatars || []).filter(a => {
                                      if (seen.has(a.avatar_id)) return false;
                                      seen.add(a.avatar_id);
                                      return true;
                                    });
                                    const filtered = search
                                      ? deduped.filter(a => a.name.toLowerCase().includes(search) || a.gender?.toLowerCase().includes(search) || a.language?.toLowerCase().includes(search))
                                      : deduped;
                                    const privateAvatars = filtered.filter(a => a.avatar_type !== 'public');
                                    const publicAvatars = filtered.filter(a => a.avatar_type === 'public');

                                    if (filtered.length === 0) {
                                      return <div className="p-3 text-sm text-muted-foreground text-center">No avatars found</div>;
                                    }

                                    return (
                                      <div className="divide-y divide-border/50">
                                        {privateAvatars.length > 0 && (
                                          <div>
                                            <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">Your Avatars</div>
                                            {privateAvatars.map((avatar) => {
                                              const isSelected = newProfileAvatarId === avatar.avatar_id;
                                              return (
                                              <button
                                                key={avatar.avatar_id}
                                                type="button"
                                                onClick={() => {
                                                  setNewProfileAvatarId(avatar.avatar_id);
                                                  if (avatar.default_voice_id) setNewProfileVoiceId(avatar.default_voice_id);
                                                }}
                                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-accent/50'}`}
                                              >
                                                {avatar.preview_image_url ? (
                                                  <>
                                                    <img src={avatar.preview_image_url} alt="" className={`h-8 w-8 rounded object-cover shrink-0 ${isSelected ? 'ring-2 ring-primary' : ''}`} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; const fallback = e.currentTarget.nextElementSibling as HTMLElement; if (fallback) fallback.style.display = ''; }} />
                                                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0" style={{ display: 'none' }}>
                                                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </div>
                                                  </>
                                                ) : (
                                                  <div className={`h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0 ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                                                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                  </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                  <p className={`text-sm truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>{avatar.name}</p>
                                                  <p className="text-[11px] text-muted-foreground">{avatar.avatar_type === 'talking_photo' ? 'Photo Avatar' : 'Custom'}</p>
                                                </div>
                                                {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                              </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                        {publicAvatars.length > 0 && (
                                          <div>
                                            {privateAvatars.length > 0 && (
                                              <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">Public Avatars</div>
                                            )}
                                            {publicAvatars.map((avatar) => {
                                              const isSelected = newProfileAvatarId === avatar.avatar_id;
                                              return (
                                              <button
                                                key={avatar.avatar_id}
                                                type="button"
                                                onClick={() => {
                                                  setNewProfileAvatarId(avatar.avatar_id);
                                                  if (avatar.default_voice_id) setNewProfileVoiceId(avatar.default_voice_id);
                                                }}
                                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-accent/50'}`}
                                              >
                                                {avatar.preview_image_url ? (
                                                  <>
                                                    <img src={avatar.preview_image_url} alt="" className={`h-8 w-8 rounded object-cover shrink-0 ${isSelected ? 'ring-2 ring-primary' : ''}`} loading="lazy" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; const fallback = e.currentTarget.nextElementSibling as HTMLElement; if (fallback) fallback.style.display = ''; }} />
                                                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0" style={{ display: 'none' }}>
                                                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </div>
                                                  </>
                                                ) : (
                                                  <div className={`h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0 ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                                                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                  </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                  <p className={`text-sm truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>{avatar.name}</p>
                                                  <p className="text-[11px] text-muted-foreground">
                                                    {[avatar.gender, avatar.language].filter(v => v && v.toLowerCase() !== 'unknown').join(' · ') || ''}
                                                  </p>
                                                </div>
                                                {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                              </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </div>
                              </div>

                              {/* Voice selector */}
                              <div className="space-y-1.5">
                                <Label className="text-sm">Voice</Label>
                                <div className="relative">
                                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                  <Input
                                    value={voiceSearch}
                                    onChange={(e) => setVoiceSearch(e.target.value)}
                                    placeholder="Filter voices..."
                                    className="h-9 pl-8 text-sm"
                                  />
                                </div>
                                <div className="border rounded-md max-h-[160px] overflow-y-auto">
                                  {heygenVoicesLoading ? (
                                    <div className="p-3 text-sm text-muted-foreground text-center">Loading voices...</div>
                                  ) : (() => {
                                    const search = voiceSearch.toLowerCase();
                                    const filtered = search
                                      ? (heygenVoices || []).filter(v => v.name.toLowerCase().includes(search) || v.language?.toLowerCase().includes(search) || v.gender?.toLowerCase().includes(search))
                                      : (heygenVoices || []);
                                    if (filtered.length === 0) {
                                      return <div className="p-3 text-sm text-muted-foreground text-center">No voices found</div>;
                                    }
                                    return filtered.map((voice) => {
                                      const meta = [voice.language, voice.gender].filter(v => v && v.toLowerCase() !== 'unknown').join(' · ');
                                      const isSelected = newProfileVoiceId === voice.voice_id;
                                      return (
                                        <button
                                          key={voice.voice_id}
                                          type="button"
                                          onClick={() => setNewProfileVoiceId(voice.voice_id)}
                                          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${isSelected ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-accent/50'}`}
                                        >
                                          <Mic2 className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                                          <span className={`text-sm truncate flex-1 ${isSelected ? 'font-semibold' : ''}`}>{voice.name}</span>
                                          {meta && <span className="text-[11px] text-muted-foreground shrink-0">{meta}</span>}
                                          {voice.preview_audio && (
                                            <div
                                              role="button"
                                              tabIndex={0}
                                              className="h-6 w-6 p-0 shrink-0 flex items-center justify-center rounded-sm hover:bg-accent cursor-pointer"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                playVoicePreview(voice.preview_audio!);
                                              }}
                                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); playVoicePreview(voice.preview_audio!); } }}
                                            >
                                              {isPlayingVoice && audioRef.current?.src === voice.preview_audio ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                                            </div>
                                          )}
                                          {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                        </button>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="cta"
                                  size="sm"
                                  onClick={addAvatarProfile}
                                  disabled={!newProfileAvatarId || !newProfileVoiceId}
                                  className="flex-1"
                                >
                                  Save Profile
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={resetAddProfileForm}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setAddingProfile(true)}
                              className="w-full"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Add Avatar Profile
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="personality" className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label>Personality</Label>
                      <Textarea
                        value={typeof currentPersonality === 'string' ? currentPersonality : currentPersonality?.description || ""}
                        onChange={(e) => setEdited({ ...edited, personality: { description: e.target.value } })}
                        placeholder="Describe the character's personality"
                        className="min-h-[120px] max-h-[300px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </TabsContent>
                </div>
              </ScrollArea>

              <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </div>
            </Tabs>
          </form>
        </DialogContent>
      </Dialog>

      <Lightbox
        open={!!previewImage}
        onOpenChange={(open) => !open && setPreviewImage(null)}
        src={previewImage}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Character</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{character.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
