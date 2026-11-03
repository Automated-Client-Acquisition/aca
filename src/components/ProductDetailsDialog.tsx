import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect } from "react";
import { ShoppingBag, Calendar, Trash2, ChevronDown, ChevronRight, Plus, X, ImageIcon, Tag, Link, MessageSquareQuote, HelpCircle } from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EditableList } from "./EditableList";
import { Lightbox } from "@/components/ui/lightbox";

interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  brand: string | null;
  logo: string | null;
  sku: string | null;
  images: string[] | null;
  videos: string[] | null;
  features: string[] | null;
  tags: string[] | null;
  analysis_questions: string[] | null;
  booking_url: string | null;
  testimonial_embed: string | null;
  created_at: string | null;
}

interface ProductDetailsDialogProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<Product>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}

export function ProductDetailsDialog({ product, open, onOpenChange, onSave, onDelete, isUpdating }: ProductDetailsDialogProps) {
  const [edited, setEdited] = useState<Partial<Product>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEdited({});
      setNewImageUrl("");
      setPreviewImage(null);
    }
  }, [product?.id, open]);

  const handleSave = () => {
    if (product) {
      onSave(product.id, edited);
      setEdited({});
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (product) {
      onDelete(product.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  if (!product) return null;

  const currentName = edited.name ?? product.name;
  const currentDescription = edited.description ?? product.description ?? "";
  const currentBrand = edited.brand ?? product.brand ?? "";
  const currentLogo = edited.logo ?? product.logo ?? "";
  const currentSku = edited.sku ?? product.sku ?? "";
  const currentCategory = edited.category ?? product.category ?? "";
  const currentPrice = edited.price ?? product.price ?? "";
  const currentCurrency = edited.currency ?? product.currency ?? "USD";
  const currentImages = edited.images ?? product.images ?? [];
  const currentVideos = edited.videos ?? product.videos ?? [];
  const currentFeatures = edited.features ?? product.features ?? [];
  const currentTags = edited.tags ?? product.tags ?? [];
  const currentAnalysisQuestions = edited.analysis_questions ?? product.analysis_questions ?? [];
  const currentBookingUrl = edited.booking_url ?? product.booking_url ?? "";
  const currentTestimonialEmbed = edited.testimonial_embed ?? product.testimonial_embed ?? "";

  const handleAddImage = () => {
    if (newImageUrl.trim()) {
      const updatedImages = [...currentImages, newImageUrl.trim()];
      setEdited({ ...edited, images: updatedImages });
      setNewImageUrl("");
    }
  };

  const handleDeleteImage = (index: number) => {
    const updatedImages = currentImages.filter((_, idx) => idx !== index);
    setEdited({ ...edited, images: updatedImages });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-3xl p-0">
          <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5 text-foreground" />
                </div>
                <div>
                  <DialogTitle className="text-xl">Edit Product</DialogTitle>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(product.created_at)}
                    </span>
                    {product.category && <Badge variant="secondary" className="text-xs">{product.category}</Badge>}
                    {product.brand && <Badge variant="secondary" className="text-xs">{product.brand}</Badge>}
                    {product.price && <Badge variant="secondary" className="text-xs">{product.currency || "USD"} {product.price.toFixed(2)}</Badge>}
                  </div>
                </div>
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-6 py-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-medium">Name</Label>
                    <Input
                      id="name"
                      value={currentName}
                      onChange={(e) => setEdited({ ...edited, name: e.target.value })}
                      className="font-medium focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="brand">Brand</Label>
                      <Input
                        id="brand"
                        value={currentBrand}
                        onChange={(e) => setEdited({ ...edited, brand: e.target.value })}
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Input
                        id="category"
                        value={currentCategory}
                        onChange={(e) => setEdited({ ...edited, category: e.target.value })}
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="logo">Logo URL</Label>
                    <Input
                      id="logo"
                      value={currentLogo}
                      onChange={(e) => setEdited({ ...edited, logo: e.target.value })}
                      placeholder="https://example.com/logo.png"
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {currentLogo && (
                      <div className="mt-2 p-2 border rounded-lg bg-muted/30">
                        <img src={currentLogo} alt="Logo preview" className="h-12 w-auto object-contain" />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="sku">SKU</Label>
                      <Input
                        id="sku"
                        value={currentSku}
                        onChange={(e) => setEdited({ ...edited, sku: e.target.value })}
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="price">Price</Label>
                      <Input
                        id="price"
                        type="number"
                        step="0.01"
                        value={currentPrice}
                        onChange={(e) => setEdited({ ...edited, price: parseFloat(e.target.value) || 0 })}
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency</Label>
                      <Select value={currentCurrency} onValueChange={(value) => setEdited({ ...edited, currency: value })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                          <SelectItem value="CAD">CAD</SelectItem>
                          <SelectItem value="AUD">AUD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={currentDescription}
                      onChange={(e) => setEdited({ ...edited, description: e.target.value })}
                      className="min-h-[100px] max-h-[250px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Describe the product..."
                    />
                  </div>
                </div>

                <Collapsible open={featuresOpen} onOpenChange={setFeaturesOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border p-4 hover:bg-accent transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">Features</span>
                          {currentFeatures.length > 0 && <Badge variant="secondary">{currentFeatures.length}</Badge>}
                        </div>
                        {featuresOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-lg p-4 mt-2">
                      <EditableList
                        items={currentFeatures}
                        onChange={(items) => setEdited({ ...edited, features: items })}
                        placeholder="Add a feature..."
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={tagsOpen} onOpenChange={setTagsOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border p-4 hover:bg-accent transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Tag className="w-5 h-5" />
                          <span className="font-semibold">Tags</span>
                          {currentTags.length > 0 && <Badge variant="secondary">{currentTags.length}</Badge>}
                        </div>
                        {tagsOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-lg p-4 mt-2">
                      <EditableList
                        items={currentTags}
                        onChange={(items) => setEdited({ ...edited, tags: items })}
                        placeholder="Add a tag..."
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={questionsOpen} onOpenChange={setQuestionsOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border p-4 hover:bg-accent transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <HelpCircle className="w-5 h-5" />
                          <span className="font-semibold">Custom Analysis Questions</span>
                          {currentAnalysisQuestions.length > 0 && <Badge variant="secondary">{currentAnalysisQuestions.length}</Badge>}
                        </div>
                        {questionsOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-lg p-4 mt-2 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Questions the AI answers about each lead during company analysis when this product is selected. Answers appear on the contact's AI Company Analysis.
                      </p>
                      <EditableList
                        items={currentAnalysisQuestions}
                        onChange={(items) => setEdited({ ...edited, analysis_questions: items })}
                        placeholder="e.g. Do they run paid ads? Do they have an in-house design team?"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={outreachOpen} onOpenChange={setOutreachOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border p-4 hover:bg-accent transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Link className="w-5 h-5" />
                          <span className="font-semibold">Outreach Settings</span>
                          {(currentBookingUrl || currentTestimonialEmbed) && <Badge variant="secondary">Configured</Badge>}
                        </div>
                        {outreachOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-lg p-4 mt-2 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="booking_url">Booking URL</Label>
                        <Input
                          id="booking_url"
                          value={currentBookingUrl}
                          onChange={(e) => setEdited({ ...edited, booking_url: e.target.value })}
                          placeholder="https://your-calendar.com/book"
                          className="focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <p className="text-xs text-muted-foreground">Calendar/booking link included in Notion docs (GHL, Calendly, etc.)</p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="testimonial_embed">Testimonial Embed</Label>
                        <Textarea
                          id="testimonial_embed"
                          value={currentTestimonialEmbed}
                          onChange={(e) => setEdited({ ...edited, testimonial_embed: e.target.value })}
                          placeholder="https://embed-v2.testimonial.to/w/your-wall or iframe code"
                          className="min-h-[60px] max-h-[120px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <p className="text-xs text-muted-foreground">Testimonial wall URL or embed code — linked in Notion docs as social proof</p>
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible open={mediaOpen} onOpenChange={setMediaOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border p-4 hover:bg-accent transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-5 h-5" />
                          <span className="font-semibold">Images</span>
                          {currentImages.length > 0 && <Badge variant="secondary">{currentImages.length}</Badge>}
                        </div>
                        {mediaOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border rounded-lg p-4 mt-2 space-y-4">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter image URL..."
                          value={newImageUrl}
                          onChange={(e) => setNewImageUrl(e.target.value)}
                          className="focus-visible:ring-2 focus-visible:ring-ring"
                        />
                        <Button onClick={handleAddImage} variant="secondary" size="icon">
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {currentImages.length > 0 && (
                        <div className="grid grid-cols-3 gap-3">
                          {currentImages.map((url, idx) => (
                            <div
                              key={idx}
                              className="relative group cursor-pointer"
                              onClick={() => setPreviewImage(url)}
                            >
                              <img src={url} alt={`Product ${idx + 1}`} className="w-full h-32 object-cover rounded shadow-sm hover:shadow-md transition-all" />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded" />
                              <Button
                                variant="destructive"
                                size="icon"
                                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteImage(idx);
                                }}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ScrollArea>

            <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-t">
              <Button
                type="submit"
                variant="cta"
                disabled={isUpdating || Object.keys(edited).length === 0}
                className="flex-1"
              >
                {isUpdating ? "Saving..." : "Save Changes"}
              </Button>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="icon"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
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
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{product.name}"? This action cannot be undone.
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
