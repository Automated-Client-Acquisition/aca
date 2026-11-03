import { useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Search, Upload, Clock, ImageIcon, Film, Loader2, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface MediaLibraryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (url: string, type: 'video' | 'image') => void;
}

interface MediaItem {
  id: string;
  url: string;
  thumbnailUrl: string;
  type: 'video' | 'image';
  label?: string;
}

const RECENT_MEDIA_KEY = 'aca-recent-broll';
const MAX_RECENT = 20;

function getRecentMedia(): MediaItem[] {
  try {
    const stored = localStorage.getItem(RECENT_MEDIA_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveToRecent(item: MediaItem) {
  const recent = getRecentMedia().filter((r) => r.url !== item.url);
  recent.unshift(item);
  localStorage.setItem(RECENT_MEDIA_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function MediaLibrary({ open, onOpenChange, onSelect }: MediaLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState('stock');

  const recentMedia = getRecentMedia();

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setResults([]);

    try {
      const { data, error } = await supabase.functions.invoke('search-stock-media', {
        body: { query: searchQuery.trim(), per_page: 24 },
      });

      if (error) throw error;

      const items: MediaItem[] = (data?.results || []).map(
        (r: { id: string; url: string; thumbnail: string; type: string; description?: string }) => ({
          id: String(r.id),
          url: r.url,
          thumbnailUrl: r.thumbnail,
          type: r.type === 'video' ? 'video' : 'image',
          label: r.description,
        }),
      );

      setResults(items);
    } catch (err) {
      console.error('Stock search failed:', err);
      toast.error('Failed to search stock media');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      try {
        const isVideo = file.type.startsWith('video/');
        const mediaType = isVideo ? 'video' : 'image';

        // Step 1: Get presigned upload URL from edge function (lightweight JSON call)
        const response = await supabase.functions.invoke('upload-media', {
          body: {
            fileName: file.name,
            contentType: file.type,
            mediaType,
            folder: 'broll',
          },
        });

        if (response.error) throw new Error(response.error.message || 'Failed to get upload URL');
        const result = response.data as {
          uploadUrl?: string;
          publicUrl?: string;
          headers?: Record<string, string>;
          error?: string;
        };
        if (result.error) throw new Error(result.error);
        if (!result.uploadUrl || !result.publicUrl) throw new Error('No upload URL returned');

        // Step 2: Upload file directly to storage provider
        const uploadResponse = await fetch(result.uploadUrl, {
          method: 'PUT',
          headers: result.headers || {},
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.status}`);
        }

        const item: MediaItem = {
          id: `upload-${Date.now()}`,
          url: result.publicUrl,
          thumbnailUrl: result.publicUrl,
          type: isVideo ? 'video' : 'image',
          label: file.name,
        };

        saveToRecent(item);
        setSelectedItem(item);
        toast.success('File uploaded');
      } catch (err) {
        console.error('Upload failed:', err);
        toast.error(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    if (!selectedItem) return;
    saveToRecent(selectedItem);
    onSelect(selectedItem.url, selectedItem.type);
    onOpenChange(false);
    setSelectedItem(null);
    setResults([]);
    setSearchQuery('');
  }, [selectedItem, onSelect, onOpenChange]);

  const renderGrid = (items: MediaItem[]) => (
    <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
      {items.map((item) => {
        const isSelected = selectedItem?.url === item.url;
        return (
          <button
            key={item.id}
            onClick={() => setSelectedItem(item)}
            className={cn(
              'relative aspect-video rounded-md overflow-hidden border-2 transition-all',
              isSelected
                ? 'border-cta bg-cta/5 ring-1 ring-cta'
                : 'border-border hover:border-cta/50',
            )}
          >
            <img
              src={item.thumbnailUrl}
              alt={item.label || 'Media'}
              className="w-full h-full object-cover"
            />
            {/* Type badge */}
            <div className="absolute top-1 right-1">
              {item.type === 'video' ? (
                <Film className="h-3 w-3 text-white drop-shadow" />
              ) : (
                <ImageIcon className="h-3 w-3 text-white drop-shadow" />
              )}
            </div>
            {/* Selected check */}
            {isSelected && (
              <div className="absolute inset-0 bg-cta/20 flex items-center justify-center">
                <Check className="h-5 w-5 text-cta" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Media Library</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start h-8">
            <TabsTrigger value="stock" className="text-xs gap-1.5">
              <Search className="h-3 w-3" />
              Stock
            </TabsTrigger>
            <TabsTrigger value="upload" className="text-xs gap-1.5">
              <Upload className="h-3 w-3" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="recent" className="text-xs gap-1.5">
              <Clock className="h-3 w-3" />
              Recent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stock" className="mt-3 space-y-3">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search stock media..."
                className="h-8 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <Button
                variant="cta"
                size="sm"
                className="h-8"
                onClick={handleSearch}
                disabled={isSearching || !searchQuery.trim()}
              >
                {isSearching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {results.length > 0 && renderGrid(results)}

            {results.length === 0 && !isSearching && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Search className="h-6 w-6 mb-2" />
                <p className="text-sm">Search for stock photos and videos</p>
              </div>
            )}

            {isSearching && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </TabsContent>

          <TabsContent value="upload" className="mt-3">
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center gap-3 transition-colors cursor-pointer',
                'border-border hover:border-cta/50 text-muted-foreground hover:text-foreground',
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <Upload className="h-8 w-8" />
              )}
              <div className="text-center">
                <p className="text-sm font-medium">
                  {isUploading ? 'Uploading...' : 'Click or drag to upload'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Images and videos up to 50MB
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </TabsContent>

          <TabsContent value="recent" className="mt-3">
            {recentMedia.length > 0 ? (
              renderGrid(recentMedia)
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Clock className="h-6 w-6 mb-2" />
                <p className="text-sm">No recent media</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="cta"
            size="sm"
            onClick={handleConfirm}
            disabled={!selectedItem}
          >
            Add Selected
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
