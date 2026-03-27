import { type CSSProperties, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHeaderCtaTextClassName, hexToRgba, type HeaderCtaTextStyle } from "@/lib/libraryWebsiteTheme";
import { cn } from "@/lib/utils";

const navItems = [
  { id: "home", label: "Home" },
  { id: "plans", label: "Plans" },
  { id: "facilities", label: "Facilities" },
  { id: "contact", label: "Contact" },
] as const;

interface LibraryNavbarProps {
  brandColor: string;
  libraryName: string;
  logoUrl?: string | null;
  headerBackgroundType: "color" | "image";
  headerBackgroundColor: string;
  headerBackgroundUrl?: string | null;
  headerOverlayOpacity: number;
  headerTextColor: string;
  headerCtaButtonColor: string;
  headerCtaButtonTextColor: string;
  headerCtaTextStyle: HeaderCtaTextStyle;
  onBookSeat: () => void;
}

const scrollToSection = (sectionId: string) => {
  const target = document.getElementById(sectionId);
  if (!target) return;

  const offset = 92;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(top, 0), behavior: "smooth" });
};

const LibraryNavbar = ({
  brandColor,
  libraryName,
  logoUrl,
  headerBackgroundType,
  headerBackgroundColor,
  headerBackgroundUrl,
  headerOverlayOpacity,
  headerTextColor,
  headerCtaButtonColor,
  headerCtaButtonTextColor,
  headerCtaTextStyle,
  onBookSeat,
}: LibraryNavbarProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("home");

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 24);

      let currentSection = "home";
      for (const item of navItems) {
        const section = document.getElementById(item.id);
        if (!section) continue;
        const threshold = section.offsetTop - 140;
        if (window.scrollY >= threshold) {
          currentSection = item.id;
        }
      }

      setActiveSection(currentSection);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  const handleNavClick = (sectionId: string) => {
    setIsMenuOpen(false);
    window.setTimeout(() => scrollToSection(sectionId), 60);
  };

  const handleBookSeat = () => {
    setIsMenuOpen(false);
    window.setTimeout(() => onBookSeat(), 60);
  };

  const mutedTextColor = hexToRgba(headerTextColor, 0.72);
  const softTextColor = hexToRgba(headerTextColor, 0.82);
  const borderColor = hexToRgba(headerTextColor, isScrolled ? 0.16 : 0.1);
  const tileBackground = hexToRgba(headerTextColor, 0.08);
  const activeTileBackground = hexToRgba(headerTextColor, 0.16);
  const tileBorder = hexToRgba(headerTextColor, 0.12);

  const createSurfaceStyle = (stronger: boolean): CSSProperties => {
    if (headerBackgroundType === "image" && headerBackgroundUrl) {
      const startOpacity = stronger
        ? Math.min(Math.max(headerOverlayOpacity + 0.14, 0.8), 0.98)
        : Math.max(headerOverlayOpacity * 0.72, 0.48);
      const endOpacity = stronger
        ? Math.min(Math.max(headerOverlayOpacity + 0.22, 0.88), 0.99)
        : Math.max(headerOverlayOpacity * 0.56, 0.32);

      return {
        backgroundImage: `linear-gradient(135deg, ${hexToRgba(headerBackgroundColor, startOpacity)}, ${hexToRgba(
          headerBackgroundColor,
          endOpacity,
        )}), url(${headerBackgroundUrl})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        borderColor,
        boxShadow: stronger
          ? `0 22px 46px ${hexToRgba(headerBackgroundColor, 0.28)}`
          : `0 16px 36px ${hexToRgba(headerBackgroundColor, 0.18)}`,
      };
    }

    return {
      background: `linear-gradient(135deg, ${hexToRgba(headerBackgroundColor, stronger ? 0.96 : 0.84)}, ${hexToRgba(
        headerBackgroundColor,
        stronger ? 0.88 : 0.68,
      )})`,
      borderColor,
      boxShadow: stronger
        ? `0 22px 46px ${hexToRgba(headerBackgroundColor, 0.26)}`
        : `0 16px 36px ${hexToRgba(headerBackgroundColor, 0.16)}`,
    };
  };

  const headerSurfaceStyle = createSurfaceStyle(isScrolled);
  const menuSurfaceStyle = createSurfaceStyle(true);

  const ctaStyle = {
    backgroundColor: headerCtaButtonColor || brandColor,
    boxShadow: `0 16px 40px ${hexToRgba(headerCtaButtonColor || brandColor, 0.25)}`,
    color: headerCtaButtonTextColor,
  };

  const linkButtonStyle = (isActive: boolean): CSSProperties => ({
    color: isActive ? headerTextColor : softTextColor,
    backgroundColor: isActive ? activeTileBackground : "transparent",
  });

  const panelButtonStyle = (isActive: boolean): CSSProperties => ({
    color: isActive ? headerTextColor : softTextColor,
    backgroundColor: isActive ? activeTileBackground : tileBackground,
    borderColor: isActive ? hexToRgba(headerTextColor, 0.2) : tileBorder,
  });

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-50 border-b backdrop-blur-2xl transition-all duration-300"
        style={headerSurfaceStyle}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <button
            type="button"
            className="flex items-center gap-3 text-left"
            onClick={() => handleNavClick("home")}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={libraryName}
                className="h-10 w-10 rounded-2xl object-cover shadow-lg"
                style={{ border: `1px solid ${tileBorder}` }}
              />
            ) : (
              <div
                className="flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold shadow-lg"
                style={{ border: `1px solid ${tileBorder}`, backgroundColor: tileBackground, color: headerTextColor }}
              >
                {libraryName.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div>
              <p className="font-semibold font-display" style={{ color: headerTextColor }}>
                {libraryName}
              </p>
              <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: mutedTextColor }}>
                Focused Learning Space
              </p>
            </div>
          </button>

          <div className="hidden items-center gap-2 lg:flex">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 hover:scale-[1.02]",
                  activeSection === item.id && "shadow-inner",
                )}
                style={linkButtonStyle(activeSection === item.id)}
              >
                {item.label}
              </button>
            ))}

            <Button
              type="button"
              onClick={handleBookSeat}
              className={cn(
                "ml-2 rounded-full px-5 transition-transform duration-200 hover:scale-[1.03]",
                getHeaderCtaTextClassName(headerCtaTextStyle),
              )}
              style={ctaStyle}
            >
              Book Seat <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-3 lg:hidden">
            <Button
              type="button"
              size="sm"
              onClick={handleBookSeat}
              className={cn(
                "rounded-full px-4 transition-transform duration-200 hover:scale-[1.03]",
                getHeaderCtaTextClassName(headerCtaTextStyle),
              )}
              style={ctaStyle}
            >
              Book Seat
            </Button>

            <button
              type="button"
              aria-label="Open navigation menu"
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors"
              style={{ border: `1px solid ${tileBorder}`, backgroundColor: tileBackground, color: headerTextColor }}
              onClick={() => setIsMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {isMenuOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close mobile menu overlay"
              className="fixed inset-0 z-[60] bg-slate-950/74 backdrop-blur-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMenuOpen(false)}
            />

            <motion.aside
              className="fixed inset-0 z-[70] flex justify-end"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="flex h-full w-full flex-col border-l px-6 py-6 backdrop-blur-2xl sm:max-w-sm"
                style={menuSurfaceStyle}
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={libraryName}
                        className="h-10 w-10 rounded-2xl object-cover"
                        style={{ border: `1px solid ${tileBorder}` }}
                      />
                    ) : (
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-bold"
                        style={{ border: `1px solid ${tileBorder}`, backgroundColor: tileBackground, color: headerTextColor }}
                      >
                        {libraryName.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="font-semibold font-display" style={{ color: headerTextColor }}>
                        {libraryName}
                      </p>
                      <p className="text-[11px] uppercase tracking-[0.2em]" style={{ color: mutedTextColor }}>
                        Premium Study Space
                      </p>
                    </div>
                  </div>

                  <motion.button
                    type="button"
                    aria-label="Close mobile menu"
                    className="flex h-11 w-11 items-center justify-center rounded-full"
                    style={{ border: `1px solid ${tileBorder}`, backgroundColor: tileBackground, color: headerTextColor }}
                    whileTap={{ scale: 0.94, rotate: -6 }}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    <X className="h-5 w-5" />
                  </motion.button>
                </div>

                <nav className="mt-16 space-y-3">
                  {navItems.map((item) => (
                    <motion.button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left text-lg font-semibold transition-colors"
                      style={panelButtonStyle(activeSection === item.id)}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleNavClick(item.id)}
                    >
                      <span>{item.label}</span>
                      <ChevronRight className="h-4 w-4" />
                    </motion.button>
                  ))}
                </nav>

                <div className="mt-auto space-y-4">
                  <p className="text-sm" style={{ color: mutedTextColor }}>
                    Reserve a seat now and move directly to the admission form.
                  </p>
                  <Button
                    type="button"
                    onClick={handleBookSeat}
                    className={cn(
                      "h-12 w-full rounded-2xl text-base transition-transform duration-200 hover:scale-[1.02]",
                      getHeaderCtaTextClassName(headerCtaTextStyle),
                    )}
                    style={ctaStyle}
                  >
                    Book Seat <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
};

export default LibraryNavbar;
