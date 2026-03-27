import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ImagePlus,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Palette,
  Pencil,
  Phone,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import WebsitePreviewPanel from "@/components/dashboard/WebsitePreviewPanel";
import {
  encodeHeaderConfig,
  HEADER_CONFIG_PLACEHOLDER_IMAGE,
  HEADER_CONFIG_SORT_ORDER,
  isHeaderConfigCaption,
  parseHeaderConfig,
  type StoredHeaderConfig,
} from "@/lib/libraryHeaderConfig";
import {
  isValidHexColor,
  normalizeHexColor,
  type HeaderCtaTextStyle,
  type WebsiteBackgroundType,
} from "@/lib/libraryWebsiteTheme";

const MEDIA_BUCKET = "library-media";
const DEFAULT_BRAND_COLOR = "#14b8a6";
const DEFAULT_DARK_TEXT = "#0f172a";
const DEFAULT_HEADER_COLOR = "#0f172a";
const DEFAULT_LIGHT_TEXT = "#ffffff";
const DEFAULT_LIGHT_SUBTEXT = "#e2e8f0";

const sanitizeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();

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

const useObjectUrl = (file: File | null) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setObjectUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [file]);

  return objectUrl;
};

type LibraryRow = Database["public"]["Tables"]["libraries"]["Row"];

interface WebsiteCustomizationTabProps {
  library?: LibraryRow | null;
}

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helperText?: string;
}

const ColorField = ({ label, value, onChange, helperText }: ColorFieldProps) => {
  const previewValue = isValidHexColor(value) ? value : DEFAULT_BRAND_COLOR;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={previewValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent p-1"
        />
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder="#14b8a6" className="w-36" />
      </div>
      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
    </div>
  );
};

const WebsiteCustomizationTab = ({ library }: WebsiteCustomizationTabProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phone, setPhone] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_BRAND_COLOR);
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [aboutText, setAboutText] = useState("");
  const [ctaTitle, setCtaTitle] = useState("");
  const [ctaSubtitle, setCtaSubtitle] = useState("");

  const [headerBackgroundType, setHeaderBackgroundType] = useState<"color" | "image">("color");
  const [headerBackgroundColor, setHeaderBackgroundColor] = useState(DEFAULT_HEADER_COLOR);
  const [headerOverlayOpacity, setHeaderOverlayOpacity] = useState(72);
  const [headerTextColor, setHeaderTextColor] = useState(DEFAULT_LIGHT_TEXT);
  const [headerCtaButtonColor, setHeaderCtaButtonColor] = useState(DEFAULT_BRAND_COLOR);
  const [headerCtaButtonTextColor, setHeaderCtaButtonTextColor] = useState(DEFAULT_LIGHT_TEXT);
  const [headerCtaTextStyle, setHeaderCtaTextStyle] = useState<HeaderCtaTextStyle>("bold");
  const [persistedHeaderBackgroundUrl, setPersistedHeaderBackgroundUrl] = useState<string | null>(null);

  const [heroOverlayColor, setHeroOverlayColor] = useState(DEFAULT_BRAND_COLOR);
  const [heroOverlayOpacity, setHeroOverlayOpacity] = useState(70);
  const [heroNoFill, setHeroNoFill] = useState(false);

  const [heroTitleColor, setHeroTitleColor] = useState(DEFAULT_LIGHT_TEXT);
  const [heroSubtitleColor, setHeroSubtitleColor] = useState(DEFAULT_LIGHT_SUBTEXT);
  const [ctaTextColor, setCtaTextColor] = useState(DEFAULT_LIGHT_TEXT);
  const [sectionHeadingColor, setSectionHeadingColor] = useState(DEFAULT_DARK_TEXT);

  const [ctaBackgroundType, setCtaBackgroundType] = useState<WebsiteBackgroundType>("color");
  const [ctaBackgroundColor, setCtaBackgroundColor] = useState(DEFAULT_BRAND_COLOR);
  const [ctaGradientFrom, setCtaGradientFrom] = useState(DEFAULT_BRAND_COLOR);
  const [ctaGradientTo, setCtaGradientTo] = useState("#0f766e");
  const [ctaTitleColor, setCtaTitleColor] = useState(DEFAULT_LIGHT_TEXT);
  const [ctaSubtitleColor, setCtaSubtitleColor] = useState(DEFAULT_LIGHT_TEXT);
  const [ctaButtonColor, setCtaButtonColor] = useState(DEFAULT_LIGHT_TEXT);
  const [ctaButtonTextColor, setCtaButtonTextColor] = useState(DEFAULT_DARK_TEXT);

  const [headerBackgroundFile, setHeaderBackgroundFile] = useState<File | null>(null);
  const [heroBackgroundFile, setHeroBackgroundFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [ctaBackgroundFile, setCtaBackgroundFile] = useState<File | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<FileList | null>(null);

  const [reviewerName, setReviewerName] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [reviewRating, setReviewRating] = useState("5");
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);

  const headerBackgroundPreviewUrl = useObjectUrl(headerBackgroundFile);
  const heroPreviewUrl = useObjectUrl(heroBackgroundFile);
  const logoPreviewUrl = useObjectUrl(logoFile);
  const ctaBackgroundPreviewUrl = useObjectUrl(ctaBackgroundFile);

  useEffect(() => {
    if (!library?.id) return;

    setPhone(library.phone || "");
    setWhatsappNumber(library.whatsapp_number || "");
    setPrimaryColor(library.primary_color || DEFAULT_BRAND_COLOR);
    setHeroTitle(library.hero_title || "");
    setHeroSubtitle(library.hero_subtitle || "");
    setAboutText(library.about_text || "");
    setCtaTitle(library.cta_title || "");
    setCtaSubtitle(library.cta_subtitle || "");
    setHeroOverlayColor(library.hero_overlay_color || library.primary_color || DEFAULT_BRAND_COLOR);
    setHeroOverlayOpacity(
      typeof library.hero_overlay_opacity === "number" ? Math.min(Math.max(library.hero_overlay_opacity, 0), 100) : 70,
    );
    setHeroNoFill(Boolean(library.hero_overlay_disabled));
    setHeroTitleColor(library.hero_title_color || DEFAULT_LIGHT_TEXT);
    setHeroSubtitleColor(library.hero_subtitle_color || DEFAULT_LIGHT_SUBTEXT);
    setCtaTextColor(library.cta_text_color || DEFAULT_LIGHT_TEXT);
    setSectionHeadingColor(library.section_heading_color || DEFAULT_DARK_TEXT);
    setCtaBackgroundType((library.cta_background_type as WebsiteBackgroundType) || "color");
    setCtaBackgroundColor(library.cta_background_color || library.primary_color || DEFAULT_BRAND_COLOR);
    setCtaGradientFrom(library.cta_gradient_from || library.primary_color || DEFAULT_BRAND_COLOR);
    setCtaGradientTo(library.cta_gradient_to || "#0f766e");
    setCtaTitleColor(library.cta_title_color || library.cta_text_color || DEFAULT_LIGHT_TEXT);
    setCtaSubtitleColor(library.cta_subtitle_color || library.cta_text_color || DEFAULT_LIGHT_TEXT);
    setCtaButtonColor(library.cta_button_color || DEFAULT_LIGHT_TEXT);
    setCtaButtonTextColor(library.cta_button_text_color || DEFAULT_DARK_TEXT);
    setPersistedHeaderBackgroundUrl(library.header_background_url || null);
    setHeaderBackgroundFile(null);
    setHeroBackgroundFile(null);
    setLogoFile(null);
    setCtaBackgroundFile(null);
  }, [library]);

  const { data: gallery = [] } = useQuery({
    queryKey: ["library-gallery-images", library?.id],
    queryFn: async () => {
      if (!library?.id) return [];
      const { data, error } = await supabase
        .from("library_gallery_images" as never)
        .select("*")
        .eq("library_id", library.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!library?.id,
  });

  const headerConfigRow = useMemo(
    () => gallery.find((image: any) => isHeaderConfigCaption(image.caption)) ?? null,
    [gallery],
  );

  const visibleGallery = useMemo(
    () => gallery.filter((image: any) => !isHeaderConfigCaption(image.caption)),
    [gallery],
  );

  const storedHeaderConfig = useMemo(
    () => parseHeaderConfig(headerConfigRow?.caption),
    [headerConfigRow?.caption],
  );

  useEffect(() => {
    if (!library?.id) return;

    const resolvedHeaderConfig = storedHeaderConfig ?? {
      backgroundType: library.header_background_type === "image" ? "image" : "color",
      backgroundColor: library.header_background_color || DEFAULT_HEADER_COLOR,
      overlayOpacity:
        typeof library.header_overlay_opacity === "number" ? Math.min(Math.max(library.header_overlay_opacity, 0), 100) : 72,
      textColor: library.header_text_color || DEFAULT_LIGHT_TEXT,
      ctaButtonColor: null,
      ctaButtonTextColor: null,
      ctaTextStyle: null,
      backgroundUrl: library.header_background_url || null,
    };

    setHeaderBackgroundType(resolvedHeaderConfig.backgroundType);
    setHeaderBackgroundColor(resolvedHeaderConfig.backgroundColor);
    setHeaderOverlayOpacity(resolvedHeaderConfig.overlayOpacity);
    setHeaderTextColor(resolvedHeaderConfig.textColor);
    setHeaderCtaButtonColor(resolvedHeaderConfig.ctaButtonColor || library.primary_color || DEFAULT_BRAND_COLOR);
    setHeaderCtaButtonTextColor(resolvedHeaderConfig.ctaButtonTextColor || DEFAULT_LIGHT_TEXT);
    setHeaderCtaTextStyle(resolvedHeaderConfig.ctaTextStyle || "bold");
    setPersistedHeaderBackgroundUrl(resolvedHeaderConfig.backgroundUrl);
  }, [
    library?.header_background_color,
    library?.header_background_type,
    library?.header_background_url,
    library?.header_overlay_opacity,
    library?.header_text_color,
    library?.id,
    library?.primary_color,
    storedHeaderConfig,
  ]);

  const { data: reviews = [] } = useQuery({
    queryKey: ["library-reviews", library?.id],
    queryFn: async () => {
      if (!library?.id) return [];
      const { data, error } = await supabase
        .from("library_reviews" as never)
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
    queryClient.invalidateQueries({ queryKey: ["settings-library", library?.id] });
    queryClient.invalidateQueries({ queryKey: ["my-libraries"] });
    queryClient.invalidateQueries({ queryKey: ["public-library"] });
    queryClient.invalidateQueries({ queryKey: ["domain-library"] });
    queryClient.invalidateQueries({ queryKey: ["library-gallery-images"] });
    queryClient.invalidateQueries({ queryKey: ["library-reviews"] });
    queryClient.invalidateQueries({ queryKey: ["public-gallery"] });
    queryClient.invalidateQueries({ queryKey: ["public-reviews"] });
  };

  const validateColorFields = (fields: Array<{ label: string; value: string }>) => {
    for (const field of fields) {
      if (!isValidHexColor(field.value)) {
        throw new Error(`${field.label} must be a valid hex code like #14b8a6`);
      }
    }
  };

  const uploadLibraryMediaFile = async ({
    existingUrl,
    file,
    folder,
  }: {
    existingUrl?: string | null;
    file: File;
    folder: "header" | "hero" | "logo" | "cta" | "gallery";
  }) => {
    if (!library?.id) throw new Error("No library selected.");
    if (!user?.id) throw new Error("You must be signed in.");

    const ext = file.name.split(".").pop() || "png";
    const baseName = file.name.endsWith(`.${ext}`) ? file.name.slice(0, -ext.length - 1) : file.name;
    const fileName = `${Date.now()}-${sanitizeFileName(baseName)}.${ext}`;
    const path = `${user.id}/${library.id}/${folder}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    const previousStoragePath = existingUrl ? getStoragePathFromUrl(existingUrl) : null;

    if (previousStoragePath && previousStoragePath !== path) {
      const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove([previousStoragePath]);
      if (removeError) throw removeError;
    }

    return publicData.publicUrl;
  };

  const removeLibraryMediaFile = async (existingUrl?: string | null) => {
    const storagePath = existingUrl ? getStoragePathFromUrl(existingUrl) : null;
    if (!storagePath) return;

    const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
    if (removeError) throw removeError;
  };

  const buildHeaderConfig = (backgroundUrl = persistedHeaderBackgroundUrl): StoredHeaderConfig => ({
    backgroundColor: normalizeHexColor(headerBackgroundColor, DEFAULT_HEADER_COLOR),
    backgroundType: headerBackgroundType,
    backgroundUrl: backgroundUrl || null,
    ctaButtonColor: normalizeHexColor(headerCtaButtonColor, primaryColor || DEFAULT_BRAND_COLOR),
    ctaButtonTextColor: normalizeHexColor(headerCtaButtonTextColor, DEFAULT_LIGHT_TEXT),
    ctaTextStyle: headerCtaTextStyle,
    overlayOpacity: Math.min(Math.max(headerOverlayOpacity, 0), 100),
    textColor: normalizeHexColor(headerTextColor, DEFAULT_LIGHT_TEXT),
  });

  const persistHeaderConfig = async (config: StoredHeaderConfig) => {
    if (!library?.id) throw new Error("No library selected.");

    const payload = {
      caption: encodeHeaderConfig(config),
      image_url: HEADER_CONFIG_PLACEHOLDER_IMAGE,
      library_id: library.id,
      sort_order: HEADER_CONFIG_SORT_ORDER,
    };

    if (headerConfigRow?.id) {
      const { error } = await supabase.from("library_gallery_images" as never).update(payload as never).eq("id", headerConfigRow.id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from("library_gallery_images" as never).insert(payload as never);
    if (error) throw error;
  };

  const replaceLibraryAsset = async ({
    field,
    folder,
    file,
    existingUrl,
  }: {
    field: "header_background_url" | "hero_background_url" | "logo_url" | "cta_background_image_url";
    folder: "header" | "hero" | "logo" | "cta";
    file: File;
    existingUrl?: string | null;
  }) => {
    if (!library?.id) throw new Error("No library selected.");
    const publicUrl = await uploadLibraryMediaFile({ existingUrl, file, folder });

    const { error: updateError } = await supabase
      .from("libraries")
      .update({ [field]: publicUrl } as never)
      .eq("id", library.id);
    if (updateError) throw updateError;
  };

  const clearLibraryAsset = async ({
    field,
    existingUrl,
  }: {
    field: "header_background_url" | "hero_background_url" | "logo_url" | "cta_background_image_url";
    existingUrl?: string | null;
  }) => {
    if (!library?.id) throw new Error("No library selected.");
    await removeLibraryMediaFile(existingUrl);

    const { error } = await supabase
      .from("libraries")
      .update({ [field]: null } as never)
      .eq("id", library.id);
    if (error) throw error;
  };

  const saveContentMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");

      validateColorFields([
        { label: "Brand color", value: primaryColor },
        { label: "Header background color", value: headerBackgroundColor },
        { label: "Header text color", value: headerTextColor },
        { label: "Header CTA button color", value: headerCtaButtonColor },
        { label: "Header CTA text color", value: headerCtaButtonTextColor },
        { label: "Hero overlay color", value: heroOverlayColor },
        { label: "Hero title color", value: heroTitleColor },
        { label: "Hero subtitle color", value: heroSubtitleColor },
        { label: "CTA text color", value: ctaTextColor },
        { label: "CTA title color", value: ctaTitleColor },
        { label: "CTA subtitle color", value: ctaSubtitleColor },
        { label: "CTA background color", value: ctaBackgroundColor },
        { label: "CTA gradient start color", value: ctaGradientFrom },
        { label: "CTA gradient end color", value: ctaGradientTo },
        { label: "CTA button color", value: ctaButtonColor },
        { label: "CTA button text color", value: ctaButtonTextColor },
        { label: "Section heading color", value: sectionHeadingColor },
      ]);

      const basePayload: Database["public"]["Tables"]["libraries"]["Update"] = {
        phone: phone.trim() || null,
        whatsapp_number: whatsappNumber.trim() || null,
        primary_color: normalizeHexColor(primaryColor, DEFAULT_BRAND_COLOR),
        hero_title: heroTitle.trim() || null,
        hero_subtitle: heroSubtitle.trim() || null,
        about_text: aboutText.trim() || null,
        cta_title: ctaTitle.trim() || null,
        cta_subtitle: ctaSubtitle.trim() || null,
        hero_overlay_color: normalizeHexColor(heroOverlayColor, primaryColor),
        hero_overlay_opacity: heroOverlayOpacity,
        hero_overlay_disabled: heroNoFill,
        hero_title_color: normalizeHexColor(heroTitleColor, DEFAULT_LIGHT_TEXT),
        hero_subtitle_color: normalizeHexColor(heroSubtitleColor, DEFAULT_LIGHT_SUBTEXT),
        cta_background_type: ctaBackgroundType,
        cta_background_color: normalizeHexColor(ctaBackgroundColor, primaryColor),
        cta_gradient_from: normalizeHexColor(ctaGradientFrom, primaryColor),
        cta_gradient_to: normalizeHexColor(ctaGradientTo, "#0f766e"),
        cta_text_color: normalizeHexColor(ctaTextColor, DEFAULT_LIGHT_TEXT),
        cta_title_color: normalizeHexColor(ctaTitleColor, ctaTextColor),
        cta_subtitle_color: normalizeHexColor(ctaSubtitleColor, ctaTextColor),
        cta_button_color: normalizeHexColor(ctaButtonColor, DEFAULT_LIGHT_TEXT),
        cta_button_text_color: normalizeHexColor(ctaButtonTextColor, DEFAULT_DARK_TEXT),
        section_heading_color: normalizeHexColor(sectionHeadingColor, DEFAULT_DARK_TEXT),
      };

      const { error } = await supabase.from("libraries").update(basePayload).eq("id", library.id);
      if (error) throw error;

      await persistHeaderConfig(buildHeaderConfig());
    },
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Website settings updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to save website settings", description: error.message, variant: "destructive" });
    },
  });

  const uploadHeroBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!heroBackgroundFile) throw new Error("Please choose a hero image.");
      await replaceLibraryAsset({
        field: "hero_background_url",
        folder: "hero",
        file: heroBackgroundFile,
        existingUrl: library?.hero_background_url,
      });
    },
    onSuccess: () => {
      setHeroBackgroundFile(null);
      invalidateWebsiteQueries();
      toast({ title: "Hero background updated" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to upload hero image", description: error.message, variant: "destructive" });
    },
  });

  const uploadHeaderBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!headerBackgroundFile) throw new Error("Please choose a header image.");
      const publicUrl = await uploadLibraryMediaFile({
        folder: "header",
        file: headerBackgroundFile,
        existingUrl: persistedHeaderBackgroundUrl,
      });
      await persistHeaderConfig(buildHeaderConfig(publicUrl));
      return publicUrl;
    },
    onSuccess: (publicUrl) => {
      setHeaderBackgroundFile(null);
      setPersistedHeaderBackgroundUrl(publicUrl);
      invalidateWebsiteQueries();
      toast({ title: "Header background updated" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to upload header image", description: error.message, variant: "destructive" });
    },
  });

  const removeHeaderBackgroundMutation = useMutation({
    mutationFn: async () => {
      await removeLibraryMediaFile(persistedHeaderBackgroundUrl);
      await persistHeaderConfig(buildHeaderConfig(null));
    },
    onSuccess: () => {
      setPersistedHeaderBackgroundUrl(null);
      invalidateWebsiteQueries();
      toast({ title: "Header background removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove header image", description: error.message, variant: "destructive" });
    },
  });

  const removeHeroBackgroundMutation = useMutation({
    mutationFn: async () =>
      clearLibraryAsset({
        field: "hero_background_url",
        existingUrl: library?.hero_background_url,
      }),
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Hero background removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove hero image", description: error.message, variant: "destructive" });
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async () => {
      if (!logoFile) throw new Error("Please choose a logo file.");
      await replaceLibraryAsset({
        field: "logo_url",
        folder: "logo",
        file: logoFile,
        existingUrl: library?.logo_url,
      });
    },
    onSuccess: () => {
      setLogoFile(null);
      invalidateWebsiteQueries();
      toast({ title: "Logo updated" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to upload logo", description: error.message, variant: "destructive" });
    },
  });

  const removeLogoMutation = useMutation({
    mutationFn: async () =>
      clearLibraryAsset({
        field: "logo_url",
        existingUrl: library?.logo_url,
      }),
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "Logo removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove logo", description: error.message, variant: "destructive" });
    },
  });

  const uploadCtaBackgroundMutation = useMutation({
    mutationFn: async () => {
      if (!ctaBackgroundFile) throw new Error("Please choose a CTA background image.");
      await replaceLibraryAsset({
        field: "cta_background_image_url",
        folder: "cta",
        file: ctaBackgroundFile,
        existingUrl: library?.cta_background_image_url,
      });
    },
    onSuccess: () => {
      setCtaBackgroundFile(null);
      invalidateWebsiteQueries();
      toast({ title: "CTA background updated" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to upload CTA background", description: error.message, variant: "destructive" });
    },
  });

  const removeCtaBackgroundMutation = useMutation({
    mutationFn: async () =>
      clearLibraryAsset({
        field: "cta_background_image_url",
        existingUrl: library?.cta_background_image_url,
      }),
    onSuccess: () => {
      invalidateWebsiteQueries();
      toast({ title: "CTA background removed" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to remove CTA image", description: error.message, variant: "destructive" });
    },
  });

  const uploadGalleryMutation = useMutation({
    mutationFn: async () => {
      if (!library?.id) throw new Error("No library selected.");
      if (!user?.id) throw new Error("You must be signed in.");
      if (!galleryFiles || galleryFiles.length === 0) throw new Error("Please choose images.");

      const files = Array.from(galleryFiles);
      const baseSort = visibleGallery.length;
      const rows: Array<{ library_id: string; image_url: string; caption: string | null; sort_order: number }> = [];

      for (const [index, file] of files.entries()) {
        rows.push({
          library_id: library.id,
          image_url: await uploadLibraryMediaFile({ file, folder: "gallery" }),
          caption: file.name,
          sort_order: baseSort + index,
        });
      }

      const { error: insertError } = await supabase.from("library_gallery_images" as never).insert(rows as never);
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
      const { error } = await supabase.from("library_gallery_images" as never).delete().eq("id", image.id);
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
          .from("library_reviews" as never)
          .update({
            reviewer_name: reviewerName.trim(),
            review_text: reviewText.trim(),
            rating,
          } as never)
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
      const { error } = await supabase.from("library_reviews" as never).insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      const wasEditing = Boolean(editingReviewId);
      setReviewerName("");
      setReviewText("");
      setReviewRating("5");
      setEditingReviewId(null);
      invalidateWebsiteQueries();
      toast({ title: wasEditing ? "Review updated" : "Review added" });
    },
    onError: (error: any) => {
      toast({ title: "Unable to save review", description: error.message, variant: "destructive" });
    },
  });

  const toggleReviewMutation = useMutation({
    mutationFn: async ({ id, is_published }: { id: string; is_published: boolean }) => {
      const { error } = await supabase.from("library_reviews" as never).update({ is_published } as never).eq("id", id);
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
      const { error } = await supabase.from("library_reviews" as never).delete().eq("id", id);
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
  const headerBackgroundDisplayUrl = headerBackgroundPreviewUrl || persistedHeaderBackgroundUrl || null;
  const logoDisplayUrl = logoPreviewUrl || library?.logo_url || null;
  const heroDisplayUrl = heroPreviewUrl || library?.hero_background_url || null;
  const ctaBackgroundDisplayUrl = ctaBackgroundPreviewUrl || library?.cta_background_image_url || null;

  const previewState = useMemo(
    () => ({
      name: library?.name,
      address: library?.address,
      city: library?.city,
      phone,
      primary_color: primaryColor,
      header_background_type: headerBackgroundType,
      header_background_url: headerBackgroundDisplayUrl,
      header_background_color: headerBackgroundColor,
      header_cta_button_color: headerCtaButtonColor,
      header_cta_button_text_color: headerCtaButtonTextColor,
      header_cta_text_style: headerCtaTextStyle,
      header_overlay_opacity: headerOverlayOpacity,
      header_text_color: headerTextColor,
      logo_url: logoDisplayUrl,
      hero_background_url: heroDisplayUrl,
      hero_title: heroTitle,
      hero_subtitle: heroSubtitle,
      hero_overlay_color: heroOverlayColor,
      hero_overlay_opacity: heroOverlayOpacity,
      hero_overlay_disabled: heroNoFill,
      hero_title_color: heroTitleColor,
      hero_subtitle_color: heroSubtitleColor,
      cta_title: ctaTitle,
      cta_subtitle: ctaSubtitle,
      cta_background_type: ctaBackgroundType,
      cta_background_image_url: ctaBackgroundDisplayUrl,
      cta_background_color: ctaBackgroundColor,
      cta_gradient_from: ctaGradientFrom,
      cta_gradient_to: ctaGradientTo,
      cta_text_color: ctaTextColor,
      cta_title_color: ctaTitleColor,
      cta_subtitle_color: ctaSubtitleColor,
      cta_button_color: ctaButtonColor,
      cta_button_text_color: ctaButtonTextColor,
      section_heading_color: sectionHeadingColor,
    }),
    [
      library?.address,
      library?.city,
      library?.name,
      phone,
      primaryColor,
      headerBackgroundType,
      headerBackgroundDisplayUrl,
      headerBackgroundColor,
      headerCtaButtonColor,
      headerCtaButtonTextColor,
      headerCtaTextStyle,
      headerOverlayOpacity,
      headerTextColor,
      logoDisplayUrl,
      heroDisplayUrl,
      heroTitle,
      heroSubtitle,
      heroOverlayColor,
      heroOverlayOpacity,
      heroNoFill,
      heroTitleColor,
      heroSubtitleColor,
      ctaTitle,
      ctaSubtitle,
      ctaBackgroundType,
      ctaBackgroundDisplayUrl,
      ctaBackgroundColor,
      ctaGradientFrom,
      ctaGradientTo,
      ctaTextColor,
      ctaTitleColor,
      ctaSubtitleColor,
      ctaButtonColor,
      ctaButtonTextColor,
      sectionHeadingColor,
    ],
  );

  if (!library) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">No library selected.</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Website Builder</CardTitle>
            <CardDescription>Preview changes live on the right, then save text and colors when ready.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm text-foreground">Fallbacks stay in place automatically.</p>
              <p className="text-xs text-muted-foreground">No logo stays hidden. No hero or CTA image falls back to your brand color.</p>
            </div>
            <Button onClick={() => saveContentMutation.mutate()} disabled={saveContentMutation.isPending}>
              {saveContentMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Palette className="mr-2 h-4 w-4" />}
              Save Website Settings
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Website Content & Contact</CardTitle>
            <CardDescription>Control the core text and brand color on your public page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Contact Mobile Number
                </Label>
                <Input placeholder="+91 9876543210" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp Number
                </Label>
                <Input placeholder="919876543210" value={whatsappNumber} onChange={(event) => setWhatsappNumber(event.target.value)} />
              </div>
            </div>

            <ColorField label="Brand Color" value={primaryColor} onChange={setPrimaryColor} />

            <div className="space-y-2">
              <Label>Hero Title</Label>
              <Input placeholder="Your Library Name" value={heroTitle} onChange={(event) => setHeroTitle(event.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Hero Subtitle</Label>
              <Textarea
                placeholder="Short line shown below your hero title"
                value={heroSubtitle}
                onChange={(event) => setHeroSubtitle(event.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label>About Text</Label>
              <Textarea
                placeholder="Describe your library in 2-3 lines"
                value={aboutText}
                onChange={(event) => setAboutText(event.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>CTA Title</Label>
                <Input placeholder="Book Your Seat Today" value={ctaTitle} onChange={(event) => setCtaTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>CTA Subtitle</Label>
                <Input
                  placeholder="Join hundreds of focused students..."
                  value={ctaSubtitle}
                  onChange={(event) => setCtaSubtitle(event.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Logo Management</CardTitle>
            <CardDescription>Upload, replace, or remove your library logo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              {logoDisplayUrl ? (
                <img src={logoDisplayUrl} alt="Library logo preview" className="h-20 w-20 rounded-2xl border border-border object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-dashed border-border bg-secondary/20 text-center text-xs text-muted-foreground">
                  No logo
                </div>
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Logo preview</p>
                <p className="text-xs text-muted-foreground">If no logo is uploaded, nothing will be shown on the website.</p>
              </div>
            </div>

            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
              disabled={disableUploads}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => uploadLogoMutation.mutate()} disabled={disableUploads || !logoFile || uploadLogoMutation.isPending}>
                {uploadLogoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {library.logo_url ? "Replace Logo" : "Upload Logo"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (logoFile) {
                    setLogoFile(null);
                    return;
                  }
                  removeLogoMutation.mutate();
                }}
                disabled={removeLogoMutation.isPending || (!library.logo_url && !logoFile)}
              >
                {removeLogoMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Remove Logo
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Header / Navbar Style</CardTitle>
            <CardDescription>Keep the top header separate from your hero so color and image can be controlled independently.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <Label>Header Background Type</Label>
              <RadioGroup
                value={headerBackgroundType}
                onValueChange={(value) => setHeaderBackgroundType(value as "color" | "image")}
                className="grid gap-3 md:grid-cols-2"
              >
                <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <RadioGroupItem value="color" />
                  <span className="text-sm font-medium">Solid Color</span>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <RadioGroupItem value="image" />
                  <span className="text-sm font-medium">Background Image</span>
                </label>
              </RadioGroup>
            </div>

            {headerBackgroundType === "image" ? (
              <div className="space-y-4 rounded-2xl border border-border p-4">
                {headerBackgroundDisplayUrl ? (
                  <img src={headerBackgroundDisplayUrl} alt="Header background preview" className="h-32 w-full rounded-xl object-cover" />
                ) : (
                  <div
                    className="flex h-32 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
                    style={{ backgroundColor: normalizeHexColor(headerBackgroundColor, DEFAULT_HEADER_COLOR) }}
                  >
                    Upload a separate image for the header bar
                  </div>
                )}

                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setHeaderBackgroundFile(event.target.files?.[0] || null)}
                  disabled={disableUploads}
                />

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    onClick={() => uploadHeaderBackgroundMutation.mutate()}
                    disabled={disableUploads || !headerBackgroundFile || uploadHeaderBackgroundMutation.isPending}
                  >
                    {uploadHeaderBackgroundMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {persistedHeaderBackgroundUrl ? "Replace Header Image" : "Upload Header Image"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (headerBackgroundFile) {
                        setHeaderBackgroundFile(null);
                        return;
                      }
                      removeHeaderBackgroundMutation.mutate();
                    }}
                    disabled={removeHeaderBackgroundMutation.isPending || (!persistedHeaderBackgroundUrl && !headerBackgroundFile)}
                  >
                    {removeHeaderBackgroundMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Remove Image
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <ColorField
                label="Header Background Color"
                value={headerBackgroundColor}
                onChange={setHeaderBackgroundColor}
                helperText="This color controls the navbar background. It stays separate from hero overlay color."
              />
              <ColorField
                label="Header Text Color"
                value={headerTextColor}
                onChange={setHeaderTextColor}
                helperText="Used for menu labels, logo text, and icons inside the navbar."
              />
            </div>

            <div className="rounded-2xl border border-border p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <ColorField
                  label="Book Seat Button Background"
                  value={headerCtaButtonColor}
                  onChange={setHeaderCtaButtonColor}
                  helperText="Controls the background color of the navbar Book Seat button."
                />
                <ColorField
                  label="Book Seat Text Color"
                  value={headerCtaButtonTextColor}
                  onChange={setHeaderCtaButtonTextColor}
                  helperText="Controls the text and icon color inside the Book Seat button."
                />
              </div>

              <div className="mt-5 space-y-3">
                <Label>Book Seat Text Style</Label>
                <RadioGroup
                  value={headerCtaTextStyle}
                  onValueChange={(value) => setHeaderCtaTextStyle(value as HeaderCtaTextStyle)}
                  className="grid gap-3 md:grid-cols-3"
                >
                  <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <RadioGroupItem value="default" />
                    <span className="text-sm font-medium">Regular</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <RadioGroupItem value="bold" />
                    <span className="text-sm font-medium">Bold</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                    <RadioGroupItem value="uppercase" />
                    <span className="text-sm font-medium">Uppercase</span>
                  </label>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">Choose how the Book Seat text appears in the header CTA.</p>
              </div>
            </div>

            {headerBackgroundType === "image" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Header Image Overlay</Label>
                  <span className="text-sm text-muted-foreground">{headerOverlayOpacity}%</span>
                </div>
                <Slider
                  value={[headerOverlayOpacity]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => setHeaderOverlayOpacity(value[0] || 0)}
                />
                <p className="text-xs text-muted-foreground">Adds readable color overlay on top of the header image.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Hero Background Image Settings</CardTitle>
            <CardDescription>Control the hero image, overlay color, and no-fill mode.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {heroDisplayUrl ? (
              <img src={heroDisplayUrl} alt="Hero background preview" className="h-48 w-full rounded-2xl border border-border object-cover" />
            ) : (
              <div
                className="flex h-48 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground"
                style={{ backgroundColor: normalizeHexColor(heroOverlayColor, primaryColor) }}
              >
                Brand color fallback preview
              </div>
            )}

            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => setHeroBackgroundFile(event.target.files?.[0] || null)}
              disabled={disableUploads}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={() => uploadHeroBackgroundMutation.mutate()}
                disabled={disableUploads || !heroBackgroundFile || uploadHeroBackgroundMutation.isPending}
              >
                {uploadHeroBackgroundMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {library.hero_background_url ? "Replace Hero Image" : "Upload Hero Image"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (heroBackgroundFile) {
                    setHeroBackgroundFile(null);
                    return;
                  }
                  removeHeroBackgroundMutation.mutate();
                }}
                disabled={removeHeroBackgroundMutation.isPending || (!library.hero_background_url && !heroBackgroundFile)}
              >
                {removeHeroBackgroundMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Remove Image
              </Button>
            </div>

            <Separator />

            <div className="grid gap-4 md:grid-cols-2">
              <ColorField
                label="Hero Overlay Color"
                value={heroOverlayColor}
                onChange={setHeroOverlayColor}
                helperText="This color is used as the overlay and as the fallback hero background when no image is uploaded."
              />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Overlay Opacity</Label>
                  <span className="text-sm text-muted-foreground">{heroOverlayOpacity}%</span>
                </div>
                <Slider value={[heroOverlayOpacity]} min={0} max={100} step={1} onValueChange={(value) => setHeroOverlayOpacity(value[0] || 0)} />
                <p className="text-xs text-muted-foreground">Used only when a hero image is present and fill color is enabled.</p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border p-4">
              <div className="space-y-1">
                <Label className="text-base">No Fill Color</Label>
                <p className="text-sm text-muted-foreground">
                  Disable the overlay so the hero image is shown directly. If no image exists, the selected hero color is still used.
                </p>
              </div>
              <Switch checked={heroNoFill} onCheckedChange={setHeroNoFill} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">CTA Section Customization</CardTitle>
            <CardDescription>Customize the “Book Your Seat Today” section background, text, and button styles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <Label>CTA Background Type</Label>
              <RadioGroup
                value={ctaBackgroundType}
                onValueChange={(value) => setCtaBackgroundType(value as WebsiteBackgroundType)}
                className="grid gap-3 md:grid-cols-3"
              >
                <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <RadioGroupItem value="color" />
                  <span className="text-sm font-medium">Solid Color</span>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <RadioGroupItem value="image" />
                  <span className="text-sm font-medium">Background Image</span>
                </label>
                <label className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <RadioGroupItem value="gradient" />
                  <span className="text-sm font-medium">Gradient</span>
                </label>
              </RadioGroup>
            </div>

            {ctaBackgroundType === "image" ? (
              <div className="space-y-4 rounded-2xl border border-border p-4">
                {ctaBackgroundDisplayUrl ? (
                  <img src={ctaBackgroundDisplayUrl} alt="CTA background preview" className="h-40 w-full rounded-xl object-cover" />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
                    Brand color fallback is used until an image is uploaded.
                  </div>
                )}

                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setCtaBackgroundFile(event.target.files?.[0] || null)}
                  disabled={disableUploads}
                />

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    onClick={() => uploadCtaBackgroundMutation.mutate()}
                    disabled={disableUploads || !ctaBackgroundFile || uploadCtaBackgroundMutation.isPending}
                  >
                    {uploadCtaBackgroundMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {library.cta_background_image_url ? "Replace CTA Image" : "Upload CTA Image"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (ctaBackgroundFile) {
                        setCtaBackgroundFile(null);
                        return;
                      }
                      removeCtaBackgroundMutation.mutate();
                    }}
                    disabled={removeCtaBackgroundMutation.isPending || (!library.cta_background_image_url && !ctaBackgroundFile)}
                  >
                    {removeCtaBackgroundMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Remove Image
                  </Button>
                </div>
              </div>
            ) : null}

            {ctaBackgroundType === "color" ? (
              <ColorField
                label="CTA Background Color"
                value={ctaBackgroundColor}
                onChange={setCtaBackgroundColor}
                helperText="If no CTA background image is used, this color is used. It falls back to the brand color."
              />
            ) : null}

            {ctaBackgroundType === "gradient" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <ColorField label="CTA Gradient Start" value={ctaGradientFrom} onChange={setCtaGradientFrom} />
                <ColorField label="CTA Gradient End" value={ctaGradientTo} onChange={setCtaGradientTo} />
              </div>
            ) : null}

            <Separator />

            <div className="grid gap-4 md:grid-cols-2">
              <ColorField label="CTA Title Color" value={ctaTitleColor} onChange={setCtaTitleColor} />
              <ColorField label="CTA Subtitle Color" value={ctaSubtitleColor} onChange={setCtaSubtitleColor} />
              <ColorField label="CTA Button Color" value={ctaButtonColor} onChange={setCtaButtonColor} />
              <ColorField label="CTA Button Text Color" value={ctaButtonTextColor} onChange={setCtaButtonTextColor} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Global Text Color Controls</CardTitle>
            <CardDescription>Set defaults for hero, CTA, and section heading typography.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <ColorField label="Hero Title Color" value={heroTitleColor} onChange={setHeroTitleColor} />
            <ColorField label="Hero Subtitle Color" value={heroSubtitleColor} onChange={setHeroSubtitleColor} />
            <ColorField label="CTA Text Color" value={ctaTextColor} onChange={setCtaTextColor} />
            <ColorField label="Section Heading Color" value={sectionHeadingColor} onChange={setSectionHeadingColor} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <ImagePlus className="h-5 w-5" />
              Gallery Images
            </CardTitle>
            <CardDescription>Upload and manage images shown on your public page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => setGalleryFiles(event.target.files)}
                disabled={disableUploads}
              />
              <Button
                onClick={() => uploadGalleryMutation.mutate()}
                disabled={disableUploads || !galleryFiles || galleryFiles.length === 0 || uploadGalleryMutation.isPending}
              >
                {uploadGalleryMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                Upload Images
              </Button>
            </div>

            {visibleGallery.length === 0 ? (
              <p className="text-sm text-muted-foreground">No gallery images yet.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-4">
                {visibleGallery.map((image: any) => (
                  <div key={image.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <img src={image.image_url} alt={image.caption || "Library gallery"} className="aspect-square w-full object-cover" />
                    <div className="space-y-2 p-2">
                      <p className="truncate text-xs text-muted-foreground">{image.caption || "Gallery image"}</p>
                      <Button
                        variant="destructive"
                        size="sm"
                        className="w-full"
                        onClick={() => deleteGalleryImageMutation.mutate(image)}
                        disabled={deleteGalleryImageMutation.isPending}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
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
            <CardTitle className="text-lg font-display flex items-center gap-2">
              <MessageSquareText className="h-5 w-5" />
              Reviews
            </CardTitle>
            <CardDescription>Add and control testimonials visible on your public page.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2 md:col-span-1">
                <Label>Name</Label>
                <Input value={reviewerName} onChange={(event) => setReviewerName(event.target.value)} placeholder="Student name" />
              </div>
              <div className="space-y-2 md:col-span-1">
                <Label>Rating (1-5)</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={reviewRating}
                  onChange={(event) => setReviewRating(event.target.value)}
                  placeholder="5"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Review</Label>
                <Textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} rows={2} placeholder="Write review text..." />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => addReviewMutation.mutate()} disabled={!reviewerName.trim() || !reviewText.trim() || addReviewMutation.isPending}>
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
                            <Star key={`${review.id}-${index}`} className="h-3.5 w-3.5 fill-accent text-accent" />
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
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteReviewMutation.mutate(review.id)}
                          disabled={deleteReviewMutation.isPending}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
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

      <div className="space-y-6">
        <WebsitePreviewPanel preview={previewState} />
      </div>
    </div>
  );
};

export default WebsiteCustomizationTab;
