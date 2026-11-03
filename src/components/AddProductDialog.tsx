import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { useScrapeProduct } from "@/hooks/useScrapeProduct";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { Zap, Loader2, Sparkles, Edit3, Package, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

interface AddProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ProductData {
  name: string;
  description: string;
  category: string;
  brand: string;
  logo: string;
  sku: string;
  price: string;
  currency: string;
  images: string[];
  videos: string[];
  features: string[];
  specifications: Record<string, string>;
  tags: string[];
  key_benefits: string[];
  affiliate_links: Record<string, string>;
  booking_url: string;
  testimonial_embed: string;
}

export function AddProductDialog({ open, onOpenChange }: AddProductDialogProps) {
  const { createProduct, isCreating } = useProducts();
  const { mutateAsync: scrapeProduct, isPending: isScraping } = useScrapeProduct();
  const { data: orgSettings, isLoading: isLoadingSettings } = useOrganizationSettings();
  const hasDefaultModel = !!(orgSettings as { default_llm_model?: string } | null)?.default_llm_model;
  
  const [mode, setMode] = useState<"scrape" | "manual" | "review">("scrape");
  const [url, setUrl] = useState("");
  const [scrapeStatus, setScrapeStatus] = useState("");
  const [scrapeMessage, setScrapeMessage] = useState("");
  
  const [productData, setProductData] = useState<ProductData>({
    name: "",
    description: "",
    category: "",
    brand: "",
    logo: "",
    sku: "",
    price: "",
    currency: "USD",
    images: [],
    videos: [],
    features: [],
    specifications: {},
    tags: [],
    key_benefits: [],
    affiliate_links: {},
    booking_url: "",
    testimonial_embed: "",
  });

  const handleScrape = async () => {
    if (!url.trim()) {
      toast.error("Please enter a URL");
      return;
    }

    try {
      const data = await scrapeProduct({
        url,
        onProgress: (status, message) => {
          setScrapeStatus(status);
          setScrapeMessage(message);
        },
      });

      setProductData({
        name: data.name || "",
        description: data.description || "",
        category: data.category || "",
        brand: data.brand || "",
        logo: (data as any).logo || "",
        sku: data.sku || "",
        price: data.price?.toString() || "",
        currency: data.currency || "USD",
        images: data.images || [],
        videos: data.videos || [],
        features: data.features || [],
        specifications: data.specifications || {},
        tags: data.tags || [],
        key_benefits: [],
        affiliate_links: {},
      });

      setMode("review");
      toast.success("Product analyzed successfully!");
    } catch (error) {
      console.error("Scrape error:", error);
      toast.error("Failed to analyze product. Please check the URL and try again.");
    }
  };

  const handleSubmit = async () => {
    try {
      await createProduct({
        name: productData.name,
        description: productData.description || null,
        category: productData.category || null,
        brand: productData.brand || null,
        logo: productData.logo || null,
        sku: productData.sku || null,
        price: productData.price ? parseFloat(productData.price) : null,
        currency: productData.currency || null,
        images: productData.images.length > 0 ? productData.images : null,
        videos: productData.videos.length > 0 ? productData.videos : null,
        features: productData.features.length > 0 ? productData.features : null,
        specifications: Object.keys(productData.specifications).length > 0 ? productData.specifications : null,
        tags: productData.tags.length > 0 ? productData.tags : null,
        key_benefits: productData.key_benefits.length > 0 ? productData.key_benefits : null,
        affiliate_links: Object.keys(productData.affiliate_links).length > 0 ? productData.affiliate_links : null,
        booking_url: productData.booking_url || null,
        testimonial_embed: productData.testimonial_embed || null,
      } as any);
      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error("Create product error:", error);
    }
  };

  const resetForm = () => {
    setMode("scrape");
    setUrl("");
    setScrapeStatus("");
    setScrapeMessage("");
    setProductData({
      name: "",
      description: "",
      category: "",
      brand: "",
      logo: "",
      sku: "",
      price: "",
      currency: "USD",
      images: [],
      videos: [],
      features: [],
      specifications: {},
      tags: [],
      key_benefits: [],
      affiliate_links: {},
    });
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-6xl p-0">
        {/* Header with gradient background */}
        <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-green-500/10 via-emerald-500/5 to-transparent relative">
          <div className="absolute top-4 right-8">
            <Badge className="bg-gradient-to-r from-green-500 to-emerald-500 text-white border-0">
              <Package className="w-3 h-3 mr-1" />
              New Product
            </Badge>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center shadow-lg">
              <Package className="w-6 h-6 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Add Product</DialogTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Scrape product details from URL or add manually
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-8 py-6">
            {mode === "scrape" && (
              <div className="space-y-6">
                <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center space-y-6">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-10 h-10 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold mb-2">Scrape & Analyze with AI</h3>
                    <p className="text-sm text-muted-foreground max-w-2xl">
                      Enter a product URL and our AI will extract all product details including name, description, features, images, and more.
                    </p>
                  </div>
                  
                  <div className="w-full max-w-2xl space-y-4">
                    {!isLoadingSettings && !hasDefaultModel && (
                      <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-left">
                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <div className="font-medium text-amber-600 dark:text-amber-400">
                            No default AI model selected
                          </div>
                          <div className="text-muted-foreground mt-0.5">
                            Scraping will use a fallback model. For better results,{" "}
                            <Link
                              to="/settings?tab=models"
                              className="font-medium underline text-amber-600 dark:text-amber-400 hover:opacity-80"
                              onClick={() => onOpenChange(false)}
                            >
                              choose your default model in Settings → Models
                            </Link>
                            .
                          </div>
                        </div>
                      </div>
                    )}
                    <Input
                      placeholder="https://example.com/product"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      disabled={isScraping}
                      className="text-center h-12 text-lg focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    
                    {isScraping && (
                      <div className="flex flex-col items-center gap-3 py-6">
                        <Loader2 className="w-10 h-10 animate-spin text-primary" />
                        <div className="text-base font-medium">{scrapeMessage}</div>
                        <div className="text-sm text-muted-foreground">This may take a few moments...</div>
                      </div>
                    )}
                    
                    <Button
                      onClick={handleScrape}
                      disabled={isScraping || !url.trim()}
                      variant="cta"
                    className="w-full h-12 text-base"
                      size="lg"
                    >
                      {isScraping ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <Zap className="w-5 h-5 mr-2" />
                          Scrape & Analyze
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full h-12"
              onClick={() => setMode("manual")}
            >
              <Edit3 className="w-5 h-5 mr-2" />
              Add Product Manually
            </Button>
              </div>
            )}

            {mode === "manual" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-green-500" />
                  <h3 className="text-lg font-semibold">Manual Product Entry</h3>
                </div>
                <div className="space-y-2">
                  <Label>Product Name *</Label>
                  <Input
                    value={productData.name}
                    onChange={(e) => setProductData({ ...productData, name: e.target.value })}
                    placeholder="Enter product name"
                    className="focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={productData.description}
                    onChange={(e) => setProductData({ ...productData, description: e.target.value })}
                    placeholder="Enter product description..."
                    className="min-h-[100px] max-h-[250px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex gap-2 pt-4">
                  <Button variant="outline" onClick={() => setMode("scrape")}>Back</Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={isCreating || !productData.name.trim()}
                    variant="cta"
                  >
                    {isCreating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Save Product
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {mode === "review" && (
              <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Review & Save Product</h3>
              <Button variant="ghost" size="sm" onClick={() => setMode("scrape")}>
                <Sparkles className="w-4 h-4 mr-2" />
                Scrape Again
              </Button>
            </div>

            {/* Basic Information */}
            <Card>
              <CardContent className="pt-6 space-y-4">
                <h4 className="font-medium flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Basic Information
                </h4>
                <div className="grid gap-4">
                  <div>
                    <Label>Product Name *</Label>
                    <Input 
                      value={productData.name} 
                      onChange={(e) => setProductData({ ...productData, name: e.target.value })} 
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea 
                      value={productData.description} 
                      onChange={(e) => setProductData({ ...productData, description: e.target.value })} 
                      className="min-h-[80px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label>Category</Label>
                      <Input 
                        value={productData.category} 
                        onChange={(e) => setProductData({ ...productData, category: e.target.value })} 
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div>
                      <Label>Brand</Label>
                      <Input 
                        value={productData.brand} 
                        onChange={(e) => setProductData({ ...productData, brand: e.target.value })} 
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div>
                      <Label>SKU</Label>
                      <Input 
                        value={productData.sku} 
                        onChange={(e) => setProductData({ ...productData, sku: e.target.value })} 
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Logo URL</Label>
                    <Input 
                      value={productData.logo} 
                      onChange={(e) => setProductData({ ...productData, logo: e.target.value })} 
                      placeholder="https://example.com/logo.png"
                      className="focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    {productData.logo && (
                      <div className="mt-2">
                        <img src={productData.logo} alt="Logo preview" className="h-12 w-auto object-contain border rounded p-1" />
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Price</Label>
                      <Input 
                        type="number" 
                        value={productData.price} 
                        onChange={(e) => setProductData({ ...productData, price: e.target.value })} 
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div>
                      <Label>Currency</Label>
                      <Input 
                        value={productData.currency} 
                        onChange={(e) => setProductData({ ...productData, currency: e.target.value })} 
                        className="focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                  {productData.tags.length > 0 && (
                    <div>
                      <Label>Tags</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {productData.tags.map((tag, idx) => (
                          <span key={idx} className="px-2 py-1 bg-muted rounded text-xs">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>


            {/* Product Details Section */}
            {(productData.features?.length > 0 || productData.images?.length > 0) && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h4 className="font-medium flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Product Details
                  </h4>
                  <div className="grid gap-4">
                    {productData.features?.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Features</Label>
                        <ul className="list-disc pl-5 space-y-1 mt-2 text-sm">
                          {productData.features.map((feature, idx) => (
                            <li key={idx}>{feature}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {Object.keys(productData.specifications || {}).length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Specifications</Label>
                        <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                          {Object.entries(productData.specifications).map(([key, value]) => (
                            <div key={key}>
                              <span className="text-muted-foreground">{key}:</span> {String(value)}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {productData.images?.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Images ({productData.images.length})</Label>
                        <div className="grid grid-cols-4 gap-2 mt-2">
                          {productData.images.slice(0, 8).map((img, idx) => (
                            <div key={idx} className="relative w-full h-20 rounded border bg-muted flex items-center justify-center overflow-hidden">
                              <img 
                                src={img} 
                                alt={`${productData.name} - Image ${idx + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                          ))}
                        </div>
                        {productData.images.length > 8 && (
                          <p className="text-xs text-muted-foreground mt-2">
                            +{productData.images.length - 8} more images
                          </p>
                        )}
                      </div>
                    )}
                    {productData.videos?.length > 0 && (
                      <div>
                        <Label className="text-xs text-muted-foreground">Videos</Label>
                        <div className="text-sm mt-1">{productData.videos.length} video(s) available</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer - only show in review mode */}
        {mode === "review" && (
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {productData.name.trim() ? "Ready to save product" : "Review product details"}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isCreating || !productData.name.trim()}
                variant="cta"
                className="min-w-[150px]"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Save Product
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
