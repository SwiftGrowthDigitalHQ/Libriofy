import { normalizeHexColor } from "@/lib/libraryWebsiteTheme";

const HEADER_CONFIG_PREFIX = "__libriofy_header_config__:";
const DEFAULT_HEADER_COLOR = "#0f172a";
const DEFAULT_HEADER_TEXT_COLOR = "#ffffff";
const DEFAULT_HEADER_OVERLAY_OPACITY = 72;
const DEFAULT_HEADER_CTA_STYLE = "bold";

export const HEADER_CONFIG_PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
export const HEADER_CONFIG_SORT_ORDER = 999999;

export type StoredHeaderConfig = {
  backgroundColor: string;
  backgroundType: "color" | "image";
  backgroundUrl: string | null;
  ctaButtonColor: string | null;
  ctaButtonTextColor: string | null;
  ctaTextStyle: "default" | "bold" | "uppercase" | null;
  overlayOpacity: number;
  textColor: string;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const isHeaderConfigCaption = (caption?: string | null) => caption?.startsWith(HEADER_CONFIG_PREFIX) ?? false;

export const encodeHeaderConfig = (config: StoredHeaderConfig) => `${HEADER_CONFIG_PREFIX}${JSON.stringify(config)}`;

export const parseHeaderConfig = (caption?: string | null): StoredHeaderConfig | null => {
  if (!isHeaderConfigCaption(caption)) return null;

  try {
    const parsed = JSON.parse(caption!.slice(HEADER_CONFIG_PREFIX.length)) as Partial<StoredHeaderConfig>;
    return {
      backgroundColor: normalizeHexColor(parsed.backgroundColor, DEFAULT_HEADER_COLOR),
      backgroundType: parsed.backgroundType === "image" ? "image" : "color",
      backgroundUrl: typeof parsed.backgroundUrl === "string" && parsed.backgroundUrl.trim() ? parsed.backgroundUrl : null,
      ctaButtonColor: typeof parsed.ctaButtonColor === "string" && parsed.ctaButtonColor.trim() ? parsed.ctaButtonColor : null,
      ctaButtonTextColor:
        typeof parsed.ctaButtonTextColor === "string" && parsed.ctaButtonTextColor.trim() ? parsed.ctaButtonTextColor : null,
      ctaTextStyle: parsed.ctaTextStyle === "uppercase" || parsed.ctaTextStyle === "default" || parsed.ctaTextStyle === "bold"
        ? parsed.ctaTextStyle
        : null,
      overlayOpacity: clamp(Number(parsed.overlayOpacity ?? DEFAULT_HEADER_OVERLAY_OPACITY), 0, 100),
      textColor: normalizeHexColor(parsed.textColor, DEFAULT_HEADER_TEXT_COLOR),
    };
  } catch {
    return null;
  }
};

export const toHeaderThemeInput = (config: StoredHeaderConfig) => ({
  header_background_color: config.backgroundColor,
  header_background_type: config.backgroundType,
  header_background_url: config.backgroundUrl,
  header_cta_button_color: config.ctaButtonColor,
  header_cta_button_text_color: config.ctaButtonTextColor,
  header_cta_text_style: config.ctaTextStyle || DEFAULT_HEADER_CTA_STYLE,
  header_overlay_opacity: config.overlayOpacity,
  header_text_color: config.textColor,
});
