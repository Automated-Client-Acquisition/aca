import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Check, Play, Pause, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState, useRef, useEffect } from "react";
import { useCharacters, type HeyGenAvatarProfile } from "@/hooks/useCharacters";
import { useElevenLabsVoices } from "@/hooks/useElevenLabsVoices";
import { useHeyGenVoices } from "@/hooks/useHeyGenVoices";
import { useHeyGenAvatars } from "@/hooks/useHeyGenAvatars";
import { useApiKeys } from "@/hooks/useApiKeys";
import { supabase } from "@/integrations/supabase/client";
import { User, Palette, Mic2, Heart, Trash2, Sparkles, FileText, Image as ImageIcon, AlertCircle, Video, Plus } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { EditableList } from "./EditableList";

interface AddCharacterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddCharacterDialog({ open, onOpenChange }: AddCharacterDialogProps) {
  const { createCharacter, isCreating } = useCharacters();
  const { data: voices, isLoading: voicesLoading, error: voicesError } = useElevenLabsVoices();
  const { data: heygenVoices, isLoading: heygenVoicesLoading } = useHeyGenVoices();
  const { data: heygenAvatars, isLoading: heygenAvatarsLoading } = useHeyGenAvatars();
  const { data: apiKeys } = useApiKeys();
  const hasHeyGenKey = apiKeys?.some(k => k.provider === 'heygen' && k.is_valid);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [visualStyle, setVisualStyle] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [build, setBuild] = useState("");
  const [ethnicity, setEthnicity] = useState("");
  const [hairDescription, setHairDescription] = useState("");
  const [typicalClothing, setTypicalClothing] = useState("");
  const [voiceSelection, setVoiceSelection] = useState("");
  const [overallTone, setOverallTone] = useState("");
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [personality, setPersonality] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [heygenProfiles, setHeygenProfiles] = useState<HeyGenAvatarProfile[]>([]);
  const [addingProfile, setAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileAvatarId, setNewProfileAvatarId] = useState("");
  const [newProfileVoiceId, setNewProfileVoiceId] = useState("");
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Clean up audio when dialog closes
  useEffect(() => {
    if (!open) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setIsPlayingVoice(false);
    }
  }, [open]);

  const playVoicePreview = (previewUrl: string) => {
    if (isPlayingVoice && audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlayingVoice(false);
      return;
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

    audio.play();
    setIsPlayingVoice(true);
  };

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
    }
  };

  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
    setImagePreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const referenceImageUrls: string[] = [];
      
      if (imageFiles.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
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
              
            referenceImageUrls.push(publicUrl);
          }
        }
      }

      createCharacter({
        name,
        description: description || null,
        tags: tags.length > 0 ? tags : null,
        visual_style: visualStyle || null,
        gender: gender || null,
        age_range: ageRange || null,
        build: build || null,
        ethnicity: ethnicity || null,
        hair_description: hairDescription || null,
        typical_clothing: typicalClothing || null,
        voice_selection: voiceSelection || null,
        overall_tone: overallTone || null,
        speaking_style: speakingStyle || null,
        personality: personality ? { description: personality } : null,
        reference_images: referenceImageUrls.length > 0 ? referenceImageUrls : null,
        heygen_avatar_id: heygenProfiles[0]?.avatar_id || null,
        heygen_voice_id: heygenProfiles[0]?.voice_id || null,
        heygen_avatars: heygenProfiles.length > 0 ? heygenProfiles : [],
      } as any);
      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error('Error creating character:', error);
      toast.error("Failed to create character. Please try again.");
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setTags([]);
    setVisualStyle("");
    setGender("");
    setAgeRange("");
    setBuild("");
    setEthnicity("");
    setHairDescription("");
    setTypicalClothing("");
    setVoiceSelection("");
    setOverallTone("");
    setSpeakingStyle("");
    setPersonality("");
    setImageFiles([]);
    setImagePreviews([]);
    setHeygenProfiles([]);
    setAddingProfile(false);
    setNewProfileName("");
    setNewProfileAvatarId("");
    setNewProfileVoiceId("");
  };

  const resetAddProfileForm = () => {
    setAddingProfile(false);
    setNewProfileName("");
    setNewProfileAvatarId("");
    setNewProfileVoiceId("");
  };

  const addAvatarProfile = () => {
    if (!newProfileAvatarId || !newProfileVoiceId) {
      toast.error("Please select both an avatar and a voice");
      return;
    }
    const selectedAvatar = heygenAvatars?.find(a => a.avatar_id === newProfileAvatarId);
    const selectedVoice = heygenVoices?.find(v => v.voice_id === newProfileVoiceId);
    const profileName = newProfileName || `${selectedAvatar?.name || 'Avatar'} + ${selectedVoice?.name || 'Voice'}`;

    const newProfile: HeyGenAvatarProfile = {
      id: crypto.randomUUID(),
      name: profileName,
      avatar_id: newProfileAvatarId,
      avatar_type: 'prebuilt',
      voice_id: newProfileVoiceId,
      voice_name: selectedVoice?.name,
      avatar_name: selectedAvatar?.name,
    };

    setHeygenProfiles(prev => [...prev, newProfile]);
    resetAddProfileForm();
    toast.success(`Avatar profile "${profileName}" added`);
  };

  const removeAvatarProfile = (profileId: string) => {
    setHeygenProfiles(prev => prev.filter(p => p.id !== profileId));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-4xl p-0">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* Header with gradient background */}
          <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent relative">
            <div className="absolute top-4 right-8">
              <Badge className="bg-gradient-aca text-white border-0">
                <User className="w-3 h-3 mr-1" />
                New Character
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-aca flex items-center justify-center shadow-lg">
                <User className="w-6 h-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Create Character</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Define your character's appearance, voice, and personality
                </p>
              </div>
            </div>
          </div>
          
          <Tabs defaultValue="basic" className="flex flex-col flex-1 min-h-0">
            <TabsList className="shrink-0 grid w-full grid-cols-5 h-12 bg-muted/50 mx-6 mt-4">
              <TabsTrigger value="basic" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary/10 data-[state=active]:to-primary/5">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">Basic</span>
              </TabsTrigger>
              <TabsTrigger value="visual" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary/10 data-[state=active]:to-primary/5">
                <Palette className="w-4 h-4" />
                <span className="hidden sm:inline">Visual</span>
              </TabsTrigger>
              <TabsTrigger value="voice" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary/10 data-[state=active]:to-primary/5">
                <Mic2 className="w-4 h-4" />
                <span className="hidden sm:inline">Voice</span>
              </TabsTrigger>
              <TabsTrigger value="heygen" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary/10 data-[state=active]:to-primary/5">
                <Video className="w-4 h-4" />
                <span className="hidden sm:inline">HeyGen</span>
              </TabsTrigger>
              <TabsTrigger value="personality" className="gap-2 data-[state=active]:bg-gradient-to-r data-[state=active]:from-primary/10 data-[state=active]:to-primary/5">
                <Heart className="w-4 h-4" />
                <span className="hidden sm:inline">Personality</span>
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1 min-h-0">
              <div className="px-8 py-6">
                <TabsContent value="basic" className="space-y-5 mt-0">
                  <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                    <div className="h-1.5 bg-gradient-aca" />
                    <CardContent className="pt-6 space-y-5">
                      <div className="space-y-2">
                        <Label htmlFor="name" className="text-base font-semibold flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-primary" />
                          Character Name *
                        </Label>
                        <Input
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="e.g., Sarah the Tech Entrepreneur"
                          required
                          className="h-11 text-base focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description" className="text-base font-semibold flex items-center gap-2">
                          <FileText className="w-4 h-4 text-primary" />
                          Description
                        </Label>
                        <Textarea
                          id="description"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Brief description of the character's role and background..."
                          className="min-h-[100px] max-h-[250px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-base font-semibold">Tags</Label>
                        <EditableList
                          items={tags}
                          onChange={setTags}
                          placeholder="Add tags such as founder, customer, or spokesperson..."
                        />
                        <p className="text-sm text-muted-foreground">
                          Tags help you find this face in manual generation and Autopilot.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="visual" className="space-y-5 mt-0">
                  <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                  <CardContent className="pt-6 space-y-4">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <ImageIcon className="w-4 h-4 text-primary" />
                      Reference Images
                    </Label>
                    <div className="space-y-3">
                      <Input
                        id="reference-image"
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleImageChange}
                        className="cursor-pointer h-11"
                      />
                      {imagePreviews.length > 0 && (
                        <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                          {imagePreviews.map((preview, index) => (
                            <div key={index} className="relative group">
                              <div className="relative w-full h-48 rounded-lg overflow-hidden border-2 border-primary/20 shadow-sm">
                                <img 
                                  src={preview} 
                                  alt={`Preview ${index + 1}`} 
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                />
                              </div>
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                onClick={() => removeImage(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Upload reference images for consistent character generation
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-2">
                  <Label htmlFor="visual-style" className="text-base font-semibold">Visual Style</Label>
                  <Textarea
                    id="visual-style"
                    value={visualStyle}
                    onChange={(e) => setVisualStyle(e.target.value)}
                    placeholder="e.g., Photorealistic, Cartoon, Anime"
                    className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gender">Gender</Label>
                  <Select value={gender} onValueChange={setGender}>
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
                    <Label htmlFor="age-range">Age Range</Label>
                    <Input
                      id="age-range"
                      value={ageRange}
                      onChange={(e) => setAgeRange(e.target.value)}
                      placeholder="e.g., 25-35"
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="build">Build</Label>
                    <Input
                      id="build"
                      value={build}
                      onChange={(e) => setBuild(e.target.value)}
                      placeholder="e.g., Athletic, Average"
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ethnicity">Ethnicity</Label>
                    <Input
                      id="ethnicity"
                      value={ethnicity}
                      onChange={(e) => setEthnicity(e.target.value)}
                      placeholder="e.g., Caucasian, Asian"
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hair">Hair Description</Label>
                  <Textarea
                    id="hair"
                    value={hairDescription}
                    onChange={(e) => setHairDescription(e.target.value)}
                    placeholder="Describe hair color, style, length"
                    className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clothing">Typical Clothing</Label>
                  <Textarea
                    id="clothing"
                    value={typicalClothing}
                    onChange={(e) => setTypicalClothing(e.target.value)}
                    placeholder="Describe typical clothing style"
                    className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </TabsContent>

              <TabsContent value="voice" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label htmlFor="voice-selection">Voice Selection</Label>
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
                    <div className="flex gap-2">
                      <Select value={voiceSelection} onValueChange={setVoiceSelection} disabled={voicesLoading}>
                        <SelectTrigger id="voice-selection" className="flex-1">
                          <SelectValue placeholder={voicesLoading ? "Loading voices..." : "Select a voice"} />
                        </SelectTrigger>
                        <SelectContent>
                          {voices?.map((voice) => (
                            <SelectItem key={voice.voice_id} value={voice.voice_id}>
                              {voice.name} {voice.labels?.accent && `(${voice.labels.accent})`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {voiceSelection && (() => {
                        const selectedVoice = voices?.find(v => v.voice_id === voiceSelection);
                        return selectedVoice?.preview_url ? (
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
                        ) : null;
                      })()}
                    </div>
                    {voiceSelection ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Volume2 className="h-3.5 w-3.5" />
                        <span>{voices?.find(v => v.voice_id === voiceSelection)?.name || voiceSelection}</span>
                        {isPlayingVoice && <span className="text-primary animate-pulse">Playing...</span>}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Select from ElevenLabs voices configured in your settings
                      </p>
                    )}
                  </>
                )}
              </div>

                <div className="space-y-2">
                  <Label htmlFor="tone">Overall Tone</Label>
                  <Input
                    id="tone"
                    value={overallTone}
                    onChange={(e) => setOverallTone(e.target.value)}
                    placeholder="e.g., Professional, Friendly, Authoritative"
                    className="focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="speaking-style">Speaking Style</Label>
                  <Textarea
                    id="speaking-style"
                    value={speakingStyle}
                    onChange={(e) => setSpeakingStyle(e.target.value)}
                    placeholder="Describe how the character speaks"
                    className="min-h-[100px] max-h-[250px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </TabsContent>

              <TabsContent value="heygen" className="space-y-5 mt-0">
                {!hasHeyGenKey ? (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      HeyGen API key not configured.{" "}
                      <Link to="/settings?tab=integrations" className="text-primary underline">
                        Add it in Settings
                      </Link>
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-base">Avatar Profiles</Label>
                      <Badge variant="outline" className="text-xs">
                        {heygenProfiles.length} profile{heygenProfiles.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Each profile is an avatar + voice combo. When generating, select which profiles to use. Multiple profiles = one video per profile.
                    </p>

                    {heygenProfiles.length > 0 && (
                      <div className="space-y-2">
                        {heygenProfiles.map((profile) => (
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAvatarProfile(profile.id)}
                              className="text-destructive hover:text-destructive shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {addingProfile ? (
                      <div className="space-y-3 p-4 rounded-lg border border-border bg-muted/10">
                        <div className="space-y-2">
                          <Label className="text-sm">Profile Name</Label>
                          <Input
                            value={newProfileName}
                            onChange={(e) => setNewProfileName(e.target.value)}
                            placeholder="e.g., Casual Look, Professional"
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Avatar</Label>
                          <Select value={newProfileAvatarId} onValueChange={setNewProfileAvatarId}>
                            <SelectTrigger>
                              <SelectValue placeholder={heygenAvatarsLoading ? "Loading avatars..." : "Select an avatar"} />
                            </SelectTrigger>
                            <SelectContent>
                              {heygenAvatars?.map((avatar) => (
                                <SelectItem key={avatar.avatar_id} value={avatar.avatar_id}>
                                  {avatar.name} {avatar.gender && `(${avatar.gender})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm">Voice</Label>
                          <Select value={newProfileVoiceId} onValueChange={setNewProfileVoiceId}>
                            <SelectTrigger>
                              <SelectValue placeholder={heygenVoicesLoading ? "Loading voices..." : "Select a voice"} />
                            </SelectTrigger>
                            <SelectContent>
                              {heygenVoices?.map((voice) => (
                                <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                  {voice.name} {voice.language && `(${voice.language})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                )}
              </TabsContent>

              <TabsContent value="personality" className="space-y-4 mt-0">
                <div className="space-y-2">
                  <Label htmlFor="personality">Personality Description</Label>
                  <Textarea
                    id="personality"
                    value={personality}
                    onChange={(e) => setPersonality(e.target.value)}
                    placeholder="Describe the character's personality, traits, and behavior"
                    className="min-h-[120px] max-h-[300px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {name.trim() ? "Ready to create" : "Fill in character details"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !name.trim()}
                variant="cta"
                className="min-w-[160px]"
              >
                {isCreating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Create Character
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
