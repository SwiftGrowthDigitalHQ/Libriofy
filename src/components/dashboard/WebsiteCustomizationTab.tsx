import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, MessageCircle, MessageSquareText, Pencil, Phone, Star, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const MEDIA_BUCKET = "library-media";

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
const isValidHexColor = (value: string) => /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value.trim());

const getStoragePathFromUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const marker = `/${MEDIA_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    return decodeURIComponent(parsed.pathname.slice(index + marker.length));
  } catch {
    return null;
  }
};

interface WebsiteCustomizationTabProps {
  library?: any;
}

const WebsiteCustomizationTab = ({ library }: WebsiteCustomizationTabProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#14b8a6");
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [ctaTitle, setCtaTitle] = useState("");
  const [ctaSubtitle, setCtaSubtitle] = useState("");
  const [heroBackgroundFile, setHeroBackgroundFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<FileList | null>(null);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState("5");
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!library?.id) return;
    setPhone(library.phone || "");
    setWhatsappNumber(library.whatsapp_number || "");
    setPrimaryColor(library.primary_color || "#14b8a6");
    setHeroTitle(library.hero_title || "");
    setHeroSubtitle(library.hero_subtitle || "");
    setAboutText(library.about_text || "");
    setCtaTitle(library.cta_title || "");
    setCtaSubtitle(library.cta_subtitle || "");
  }, [library]);

  const { data: gallery = [] } = useQuery({
    queryKey: ["library-gallery-images", library?.id],
    queryFn: async () => {
      if (!library?.id) return [];
      const { data, error } = await supabase
        .from("library_gallery_images" as any)
        .select("*")
        .eq("library_id", library.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!library?.id,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ["library-reviews", library?.id],
    queryFn: async () => {
      if (!library?.id) return [];
      const { data, error } = await supabase
        .from("library_reviews" as any)
        .select("*")
        .eq("library_id", library.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!library?.id,
  });

  const invalidateWebsiteQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["my-libraries"] });
    queryClient.invalidateQueries({ queryKey: ["public-library"] });
    queryClient.invalidateQueries({ queryKey: ["library-gallery-images"] });
    queryClient.invalidateQueries({ queryKey: ["library-reviews"] });
    queryClient.invalidateQueries({ queryKey: ["public-gallery"] });
    queryClient.invalidateQueries({ queryKey: ["public-reviews"] });
  };

  const saveContentMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      const normalizedColor = primaryColor.trim() || "#14b8a6";
      if (!isValidHexColor(normalizedColor)) {
        throw new Error("Brand color must be a valid hex code like #14b8a6");
      }
      const payload = {
        phone: phone.trim() || null,
        whatsapp_number: whatsappNumber.trim() || null,
        primary_color: normalizedColor,
        hero_title: heroTitle.trim() || null,
        hero_subtitle: heroSubtitle.trim() || null,
        about_text: aboutText.trim() || null,
        cta_title: ctaTitle.trim() || null,
        cta_subtitle: ctaSubtitle.trim() || null,
      };
      const { error } = await supabase.from("libraries").update(payload as any).eq("id", library.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Website content updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save content", description: error.message, variant: "destructive" });
    },
  });

  const uploadHeroBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      if (!user?.id) throw new Error("You must be signed in.");
      if (!heroBackgroundFile) throw new Error("Please choose a background image.");

      const ext = heroBackgroundFile.name.split(".").pop() || "jpg";
      const fileName = `${Date.now()}-${sanitizeFileName(heroBackgroundFile.name.replace(`.${ext}`, ""))}.${ext}`;
      const path = `${user.id}/${library.id}/hero/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, heroBackgroundFile, { upsert: true, contentType: heroBackgroundFile.type || undefined });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("libraries")
        .update({ hero_background_url: publicData.publicUrl } as any)
        .eq("id", library.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      setHeroBackgroundFile(null);
      invalidateWebsiteQueries();
      toast({ title: "Hero background uploaded" });
    },
    onError: (error: any) => {
      toast({ title: "Hero background upload failed", description: error.message, variant: "destructive" });
    },
  });

  const removeHeroBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      const existingUrl = library.hero_background_url as string | null;
      if (existingUrl) {
        const storagePath = getStoragePathFromUrl(existingUrl);
        if (storagePath) {
          const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
          if (removeError) throw removeError;
        }
      }
      const { error } = await supabase.from("libraries").update({ hero_background_url: null } as any).eq("id", library.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Hero background removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove hero background", description: error.message, variant: "destructive" });
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      if (!user?.id) throw new Error("You must be signed in.");
      if (!logoFile) throw new Error("Please choose a logo file.");

      const ext = logoFile.name.split(".").pop() || "png";
      const fileName = `${Date.now()}-${sanitizeFileName(logoFile.name.replace(`.${ext}`, ""))}.${ext}`;
      const path = `${user.id}/${library.id}/logo/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, logoFile, { upsert: true, contentType: logoFile.type || undefined });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("libraries")
        .update({ logo_url: publicData.publicUrl } as any)
        .eq("id", library.id);
      if (updateError) throw updateError;
    },
    onSuccess: () => {
      setLogoFile(null);
      invalidateWebsiteQueries();
      toast({ title: "Logo uploaded" });
    },
    onError: (error: any) => {
      toast({ title: "Logo upload failed", description: error.message, variant: "destructive" });
    },
  });

  const uploadGalleryMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      if (!user?.id) throw new Error("You must be signed in.");
      if (!galleryFiles || galleryFiles.length === 0) throw new Error("Please choose images.");

      const files = Array.from(galleryFiles);
      const baseSort = gallery.length;
      const rows: Array<{ library_id: string; image_url: string; caption: string | null; sort_order: number }> = [];

      for (const [index, file] of files.entries()) {
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `${Date.now()}-${index}-${sanitizeFileName(file.name.replace(`.${ext}`, ""))}.${ext}`;
        const path = `${user.id}/${library.id}/gallery/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from(MEDIA_BUCKET)
          .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
        rows.push({
          library_id: library.id,
          image_url: publicData.publicUrl,
          caption: file.name,
          sort_order: baseSort + index,
        });
      }

      const { error: insertError } = await supabase.from("library_gallery_images" as any).insert(rows as any);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      setGalleryFiles(null);
      invalidateWebsiteQueries();
      toast({ title: "Gallery updated" });
    },
    onError: (error: any) => {
      toast({ title: "Gallery upload failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteGalleryImageMutation = useMutation({
    mutationFn: async (image: any) => {
      const storagePath = getStoragePathFromUrl(image.image_url);
      if (storagePath) {
        const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
        if (removeError) throw removeError;
      }
      const { error } = await supabase.from("library_gallery_images" as any).delete().eq("id", image.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Image removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove image", description: error.message, variant: "destructive" });
    },
  });

  const addReviewMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      if (!reviewerName.trim() || !reviewText.trim()) throw new Error("Name and review are required.");
      const rating = Math.min(5, Math.max(1, Number(reviewRating) || 5));
      if (editingReviewId) {
        const { error } = await supabase
          .from("library_reviews" as any)
          .update({
            reviewer_name: reviewerName.trim(),
            review_text: reviewText.trim(),
            rating,
          } as any)
          .eq("id", editingReviewId);
        if (error) throw error;
        return;
      }

      const payload = {
        library_id: library.id,
        reviewer_name: reviewerName.trim(),
        review_text: reviewText.trim(),
        rating,
        is_published: true,
        sort_order: reviews.length,
      };
      const { error } = await supabase.from("library_reviews" as any).insert(payload as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setReviewerName("");
      setReviewText("");
      setReviewRating("5");
      setEditingReviewId(null);
      invalidateWebsiteQueries();
      toast({ title: editingReviewId ? "Review updated" : "Review added" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to save review", description: error.message, variant: "destructive" });
    },
  });

  const toggleReviewMutation = useMutation({
    mutationFn: async ({ id, is_published }: { id: string; is_published: boolean }) => {
      const { error } = await supabase.from("library_reviews" as any).update({ is_published }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateWebsiteQueries();
    },
    onError: (error: any) => {
      toast({ title: "Unable to update review", description: error.message, variant: "destructive" });
    },
  });

  const deleteReviewMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("library_reviews" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Review removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove review", description: error.message, variant: "destructive" });
    },
  });

  const disableUploads = useMemo(() => !library?.id || !user?.id, [library?.id, user?.id]);

  if (!library) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">No library selected.</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Website Content & Contact</CardTitle>
          <CardDescription>Customize your public page text, phone number and WhatsApp button.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-3xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><Phone className="w-4 h-4" /> Contact Mobile Number</Label>
              <Input placeholder="+91 9876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2"><MessageCircle className="w-4 h-4" /> WhatsApp Number</Label>
              <Input placeholder="919876543210" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Brand Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={isValidHexColor(primaryColor) ? primaryColor : "#14b8a6"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded border border-border cursor-pointer"
              />
              <Input placeholder="#14b8a6" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="w-36" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Hero Title</Label>
            <Input placeholder="Your Library Name" value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Hero Subtitle</Label>
            <Textarea
              placeholder="Short line shown below hero title"
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>About Text</Label>
            <Textarea
              placeholder="Describe your library in 2-3 lines"
              value={aboutText}
              onChange={(e) => setAboutText(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>CTA Title</Label>
              <Input placeholder="Book Your Seat Today" value={ctaTitle} onChange={(e) => setCtaTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>CTA Subtitle</Label>
              <Input placeholder="Join hundreds of focused students..." value={ctaSubtitle} onChange={(e) => setCtaSubtitle(e.target.value)} />
            </div>
          </div>

          <Button onClick={() => saveContentMutation.mutate()} disabled={saveContentMutation.isPending}>
            {saveContentMutation.isPending ? "Saving..." : "Save Website Content"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Hero Background Image</CardTitle>
          <CardDescription>Optional. Upload a banner image for top section overlay.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {library.hero_background_url ? (
            <img src={library.hero_background_url} alt="Hero background preview" className="w-full max-w-md h-40 object-cover rounded-xl border border-border" />
          ) : null}

          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setHeroBackgroundFile(e.target.files?.[0] || null)}
              disabled={disableUploads}
            />
            <Button
              onClick={() => uploadHeroBackgroundMutation.mutate()}
              disabled={disableUploads || !heroBackgroundFile || uploadHeroBackgroundMutation.isPending}
            >
              {uploadHeroBackgroundMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload Hero Image
            </Button>
            {library.hero_background_url ? (
              <Button
                variant="outline"
                onClick={() => removeHeroBackgroundMutation.mutate()}
                disabled={removeHeroBackgroundMutation.isPending}
              >
                Remove
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Logo Upload</CardTitle>
          <CardDescription>Upload your library logo directly from your device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {library.logo_url ? (
            <img src={library.logo_url} alt="Library logo" className="w-20 h-20 rounded-xl object-cover border border-border" />
          ) : null}
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
              disabled={disableUploads}
            />
            <Button
              onClick={() => uploadLogoMutation.mutate()}
              disabled={disableUploads || !logoFile || uploadLogoMutation.isPending}
            >
              {uploadLogoMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload Logo
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display flex items-center gap-2"><ImagePlus className="w-5 h-5" /> Gallery Images</CardTitle>
          <CardDescription>Upload and manage images that will be shown on your public page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(e) => setGalleryFiles(e.target.files)}
              disabled={disableUploads}
            />
            <Button
              onClick={() => uploadGalleryMutation.mutate()}
              disabled={disableUploads || !galleryFiles || galleryFiles.length === 0 || uploadGalleryMutation.isPending}
            >
              {uploadGalleryMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
              Upload Images
            </Button>
          </div>

          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gallery images yet.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {gallery.map((image: any) => (
                <div key={image.id} className="rounded-lg border border-border overflow-hidden bg-card">
                  <img src={image.image_url} alt={image.caption || "Library gallery"} className="w-full aspect-square object-cover" />
                  <div className="p-2 space-y-2">
                    <p className="text-xs text-muted-foreground truncate">{image.caption || "Gallery image"}</p>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => deleteGalleryImageMutation.mutate(image)}
                      disabled={deleteGalleryImageMutation.isPending}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display flex items-center gap-2"><MessageSquareText className="w-5 h-5" /> Reviews</CardTitle>
          <CardDescription>Add and control testimonials visible on your public page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-1 space-y-2">
              <Label>Name</Label>
              <Input value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} placeholder="Student name" />
            </div>
            <div className="md:col-span-1 space-y-2">
              <Label>Rating (1-5)</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={reviewRating}
                onChange={(e) => setReviewRating(e.target.value)}
                placeholder="5"
              />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label>Review</Label>
              <Textarea value={reviewText} onChange={(e) => setReviewText(e.target.value)} rows={2} placeholder="Write review text..." />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => addReviewMutation.mutate()}
              disabled={!reviewerName.trim() || !reviewText.trim() || addReviewMutation.isPending}
            >
              {addReviewMutation.isPending ? "Saving..." : editingReviewId ? "Update Review" : "Add Review"}
            </Button>
            {editingReviewId ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingReviewId(null);
                  setReviewerName("");
                  setReviewText("");
                  setReviewRating("5");
                }}
              >
                Cancel Edit
              </Button>
            ) : null}
          </div>

          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <div className="space-y-3">
              {reviews.map((review: any) => (
                <div key={review.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{review.reviewer_name}</p>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.max(1, Number(review.rating) || 5) }).map((_, index) => (
                          <Star key={`${review.id}-${index}`} className="w-3.5 h-3.5 fill-accent text-accent" />
                        ))}
                        <Badge variant={review.is_published ? "default" : "secondary"}>
                          {review.is_published ? "Published" : "Hidden"}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{review.review_text}</p>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Show</span>
                        <Switch
                          checked={review.is_published}
                          onCheckedChange={(checked) => toggleReviewMutation.mutate({ id: review.id, is_published: checked })}
                        />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingReviewId(review.id);
                          setReviewerName(review.reviewer_name || "");
                          setReviewText(review.review_text || "");
                          setReviewRating(String(review.rating || 5));
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteReviewMutation.mutate(review.id)}
                        disabled={deleteReviewMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WebsiteCustomizationTab;
