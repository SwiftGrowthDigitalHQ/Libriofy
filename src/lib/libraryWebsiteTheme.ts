import type { CSSProperties } from "react";

const DEFAULT_BRAND_COLOR = "#14b8a6";
const DEFAULT_DARK_TEXT = "#0f172a";
const DEFAULT_LIGHT_TEXT = "#ffffff";
const DEFAULT_LIGHT_SUBTEXT = "#e2e8f0";

export type WebsiteBackgroundType = "color" | "image" | "gradient";

export interface WebsiteThemeInput {
  name?: string | null;
  hero_background_url?: string | null;
  hero_overlay_color?: string | null;
  hero_overlay_disabled?: boolean | null;
  hero_overlay_opacity?: number | null;
  logo_url?: string | null;
  primary_color?: string | null;
  hero_title?: string | null;
  hero_subtitle?: string | null;
  hero_title_color?: string | null;
  hero_subtitle_color?: string | null;
  about_text?: string | null;
  cta_title?: string | null;
  cta_subtitle?: string | null;
  cta_background_type?: string | null;
  cta_background_image_url?: string | null;
  cta_background_color?: string | null;
  cta_gradient_from?: string | null;
  cta_gradient_to?: string | null;
  cta_text_color?: string | null;
  cta_title_color?: string | null;
  cta_subtitle_color?: string | null;
  cta_button_color?: string | null;
  cta_button_text_color?: string | null;
  section_heading_color?: string | null;
}

export interface ResolvedWebsiteTheme {
  brandColor: string;
  heroTitle: string;
  heroSubtitle: string;
  heroTitleColor: string;
  heroSubtitleColor: string;
  heroBackgroundStyle: CSSProperties;
  ctaTitle: string;
  ctaSubtitle: string;
  ctaBackgroundType: WebsiteBackgroundType;
  ctaBackgroundStyle: CSSProperties;
  ctaTextColor: string;
  ctaTitleColor: string;
  ctaSubtitleColor: string;
  ctaButtonColor: string;
  ctaButtonTextColor: string;
  sectionHeadingColor: string;
}

export const isValidHexColor = (value?: string | null): boolean =>
  !!value && /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value.trim());

export const normalizeHexColor = (value: string | null | undefined, fallback: string): string =>
  isValidHexColor(value) ? value!.trim() : fallback;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string) => {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => char + char)
          .join("")
      : normalized;

  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
};

export const hexToRgba = (hex: string, opacity: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1)})`;
};

const shiftHexColor = (hex: string, amount: number) => {
  const { r, g, b } = hexToRgb(hex);
  const shift = (channel: number) => clamp(channel + amount, 0, 255);
  return `#${[shift(r), shift(g), shift(b)]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
};

export const resolveWebsiteTheme = (input?: WebsiteThemeInput | null): ResolvedWebsiteTheme => {
  const brandColor = normalizeHexColor(input?.primary_color, DEFAULT_BRAND_COLOR);
  const heroBackgroundColor = normalizeHexColor(input?.hero_overlay_color, brandColor);
  const heroOverlayOpacity = clamp(Number(input?.hero_overlay_opacity ?? 70), 0, 100) / 100;
  const heroHasImage = !!input?.hero_background_url;
  const heroBackgroundStyle: CSSProperties = heroHasImage
    ? input?.hero_overlay_disabled
      ? {
          backgroundImage: `url(${input.hero_background_url})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }
      : {
          backgroundImage: `linear-gradient(135deg, ${hexToRgba(heroBackgroundColor, heroOverlayOpacity)}, ${hexToRgba(heroBackgroundColor, Math.max(heroOverlayOpacity * 0.65, 0.18))}), url(${input.hero_background_url})`,
          backgroundPosition: "center",
          backgroundSize: "cover",
        }
    : {
        background: heroBackgroundColor,
      };

  const ctaBackgroundType = (["color", "image", "gradient"].includes(input?.cta_background_type || "")
    ? input?.cta_background_type
    : "color") as WebsiteBackgroundType;
  const ctaBackgroundColor = normalizeHexColor(input?.cta_background_color, brandColor);
  const ctaGradientFrom = normalizeHexColor(input?.cta_gradient_from, brandColor);
  const ctaGradientTo = normalizeHexColor(input?.cta_gradient_to, shiftHexColor(brandColor, -36));

  let ctaBackgroundStyle: CSSProperties;
  if (ctaBackgroundType === "image" && input?.cta_background_image_url) {
    ctaBackgroundStyle = {
      backgroundImage: `url(${input.cta_background_image_url})`,
      backgroundPosition: "center",
      backgroundSize: "cover",
      backgroundColor: brandColor,
    };
  } else if (ctaBackgroundType === "gradient") {
    ctaBackgroundStyle = {
      background: `linear-gradient(135deg, ${ctaGradientFrom}, ${ctaGradientTo})`,
    };
  } else {
    ctaBackgroundStyle = {
      background: ctaBackgroundColor,
    };
  }

  const ctaTextColor = normalizeHexColor(input?.cta_text_color, DEFAULT_LIGHT_TEXT);

  return {
    brandColor,
    heroTitle: input?.hero_title?.trim() || input?.name?.trim() || "Your Library Name",
    heroSubtitle: input?.hero_subtitle?.trim() || "Premium Study Space for Focused Learning",
    heroTitleColor: normalizeHexColor(input?.hero_title_color, DEFAULT_LIGHT_TEXT),
    heroSubtitleColor: normalizeHexColor(input?.hero_subtitle_color, DEFAULT_LIGHT_SUBTEXT),
    heroBackgroundStyle,
    ctaTitle: input?.cta_title?.trim() || "Book Your Seat Today",
    ctaSubtitle: input?.cta_subtitle?.trim() || "Join hundreds of focused students. Limited seats available - reserve yours now.",
    ctaBackgroundType,
    ctaBackgroundStyle,
    ctaTextColor,
    ctaTitleColor: normalizeHexColor(input?.cta_title_color, ctaTextColor),
    ctaSubtitleColor: normalizeHexColor(input?.cta_subtitle_color, ctaTextColor),
    ctaButtonColor: normalizeHexColor(input?.cta_button_color, DEFAULT_LIGHT_TEXT),
    ctaButtonTextColor: normalizeHexColor(input?.cta_button_text_color, DEFAULT_DARK_TEXT),
    sectionHeadingColor: normalizeHexColor(input?.section_heading_color, DEFAULT_DARK_TEXT),
  };
};
