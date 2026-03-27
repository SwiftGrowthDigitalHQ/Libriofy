import { ChevronRight, MapPin, Phone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getHeaderCtaTextClassName, hexToRgba, resolveWebsiteTheme, type WebsiteThemeInput } from "@/lib/libraryWebsiteTheme";

interface WebsitePreviewPanelProps {
  preview: WebsiteThemeInput & {
    address?: string | null;
    city?: string | null;
    phone?: string | null;
  };
}

const WebsitePreviewPanel = ({ preview }: WebsitePreviewPanelProps) => {
  const theme = resolveWebsiteTheme(preview);
  const locationText = [preview.address, preview.city].filter(Boolean).join(", ") || "Your library location";
  const phoneText = preview.phone || "+91 98765 43210";
  const heroContentClass =
    theme.heroBackgroundStyle.backgroundImage && preview.hero_background_url
      ? "bg-black/20 backdrop-blur-[1px]"
      : "bg-white/10";
  const ctaContentClass = theme.ctaBackgroundType === "image" ? "bg-black/25 backdrop-blur-sm" : "";

  return (
    <Card className="sticky top-6 overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-display">Live Preview</CardTitle>
        <CardDescription>Updates instantly as you customize your website.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-border overflow-hidden bg-background shadow-sm">
          <div className="border-b border-white/10 px-5 py-4" style={theme.headerBackgroundStyle}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {preview.logo_url ? (
                  <img src={preview.logo_url} alt={theme.heroTitle} className="h-11 w-11 rounded-2xl object-cover shadow-md" />
                ) : (
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold shadow-sm"
                    style={{ backgroundColor: "rgba(255,255,255,0.12)", color: theme.headerTextColor }}
                  >
                    {theme.heroTitle.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="font-semibold font-display" style={{ color: theme.headerTextColor }}>
                    {theme.heroTitle}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.18em]" style={{ color: hexToRgba(theme.headerTextColor, 0.7) }}>
                    Premium Header Preview
                  </p>
                </div>
              </div>

              <div className="hidden items-center gap-2 sm:flex">
                {["Home", "Plans", "Facilities", "Contact"].map((item) => (
                  <span
                    key={item}
                    className="rounded-full px-3 py-1.5 text-xs font-medium"
                    style={{ color: hexToRgba(theme.headerTextColor, 0.82), backgroundColor: "rgba(255,255,255,0.08)" }}
                  >
                    {item}
                  </span>
                ))}
                <Button
                  type="button"
                  size="sm"
                  className={`rounded-full px-4 shadow-sm ${getHeaderCtaTextClassName(theme.headerCtaTextStyle)}`}
                  style={{ backgroundColor: theme.headerCtaButtonColor, color: theme.headerCtaButtonTextColor }}
                >
                  Book Seat
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="p-6 sm:p-7" style={theme.heroBackgroundStyle}>
            <div className={`rounded-2xl p-5 ${heroContentClass}`}>
              {preview.logo_url ? (
                <img src={preview.logo_url} alt={theme.heroTitle} className="mb-4 h-14 w-14 rounded-2xl object-cover shadow-md" />
              ) : null}
              <h3 className="text-2xl font-bold font-display" style={{ color: theme.heroTitleColor }}>
                {theme.heroTitle}
              </h3>
              <p className="mt-2 max-w-md text-sm" style={{ color: theme.heroSubtitleColor }}>
                {theme.heroSubtitle}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/85">
                <Badge variant="secondary" className="bg-white/15 text-white hover:bg-white/15">
                  <MapPin className="mr-1 h-3 w-3" />
                  {locationText}
                </Badge>
                <Badge variant="secondary" className="bg-white/15 text-white hover:bg-white/15">
                  <Phone className="mr-1 h-3 w-3" />
                  {phoneText}
                </Badge>
              </div>
            </div>
          </div>

          <div className="border-t border-border p-6">
            <h4 className="text-lg font-semibold font-display" style={{ color: theme.sectionHeadingColor }}>
              Section Heading Preview
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">
              This color is used for your landing page section titles like gallery, facilities, testimonials, and contact.
            </p>
          </div>

          <div className="border-t border-border p-6" style={theme.ctaBackgroundStyle}>
            <div className={`rounded-2xl p-5 text-center ${ctaContentClass}`}>
              <h4 className="text-2xl font-bold font-display" style={{ color: theme.ctaTitleColor }}>
                {theme.ctaTitle}
              </h4>
              <p className="mt-2 text-sm" style={{ color: theme.ctaSubtitleColor }}>
                {theme.ctaSubtitle}
              </p>
              <button
                type="button"
                className="mt-5 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm"
                style={{ backgroundColor: theme.ctaButtonColor, color: theme.ctaButtonTextColor }}
              >
                Book Now
                <ChevronRight className="ml-1 h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WebsitePreviewPanel;
