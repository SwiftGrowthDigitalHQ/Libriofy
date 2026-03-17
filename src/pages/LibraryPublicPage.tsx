import { useState, useEffect, FormEvent } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { MapPin, Clock, Users, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import ImageSlider from "@/components/library-public/ImageSlider";
import FacilitiesSection from "@/components/library-public/FacilitiesSection";
import GallerySection from "@/components/library-public/GallerySection";
import TestimonialsSection from "@/components/library-public/TestimonialsSection";
import AboutSection from "@/components/library-public/AboutSection";
import CTASection from "@/components/library-public/CTASection";
import ContactSection from "@/components/library-public/ContactSection";
import LibraryFooter from "@/components/library-public/LibraryFooter";
import WhatsAppButton from "@/components/library-public/WhatsAppButton";
import { resolveWebsiteTheme } from "@/lib/libraryWebsiteTheme";

interface LibraryPublicPageProps {
  domainLibrary?: any;
}

type SlotAvailabilityRow = {
  available_seats: number;
  occupied_seats: number;
  slot_id: string;
  slot_name: string;
  total_seats: number;
};

const normalizeWhatsAppNumber = (raw?: string | null): string => {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const LibraryPublicPage = ({ domainLibrary }: LibraryPublicPageProps = {}) => {
  const { slug } = useParams<{ slug: string }>();
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPlan, setFormPlan] = useState("");
  const [formSlot, setFormSlot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !library?.id) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("add_to_waiting_list", {
        p_library_id: library.id,
        p_student_name: formName.trim(),
        p_phone: formPhone.trim() || undefined,
        p_email: formEmail.trim() || undefined,
        p_preferred_plan: formPlan || undefined,
        p_preferred_slot: formSlot || undefined,
      });
      if (error) throw error;
      const result = data as unknown as { success: boolean; position: number };
      if (result.success) {
        setQueuePosition(result.position);
        setSubmitted(true);
        toast.success("You've been added to the waiting list!");
      }
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const { data: library, isLoading: libLoading } = useQuery({
    queryKey: ["public-library", domainLibrary?.id || slug],
    queryFn: async () => {
      if (domainLibrary) return domainLibrary;
      const { data, error } = await supabase.rpc("get_library_public", { p_identifier: slug! });
      if (error) throw error;
      if (!data || (data as any[]).length === 0) return null;
      return (data as any[])[0];
    },
    enabled: !!domainLibrary || !!slug,
    initialData: domainLibrary || undefined,
  });

  const libraryId = library?.id;

  const { data: plans = [] } = useQuery({
    queryKey: ["public-plans", libraryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("library_id", libraryId!)
        .eq("is_active", true)
        .order("price", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!libraryId,
  });

  const { data: slots = [] } = useQuery({
    queryKey: ["public-slots", libraryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_slots")
        .select("*")
        .eq("library_id", libraryId!)
        .eq("is_active", true)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!libraryId,
  });

  const { data: galleryImages = [] } = useQuery({
    queryKey: ["public-gallery", libraryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_gallery_images" as any)
        .select("id, image_url, caption, sort_order")
        .eq("library_id", libraryId!)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Array<{ id: string; image_url: string; caption: string | null; sort_order: number }>;
    },
    enabled: !!libraryId,
  });

  const { data: publishedReviews = [] } = useQuery({
    queryKey: ["public-reviews", libraryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_reviews" as any)
        .select("id, reviewer_name, review_text, rating, sort_order")
        .eq("library_id", libraryId!)
        .eq("is_published", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Array<{ id: string; reviewer_name: string; review_text: string; rating: number; sort_order: number }>;
    },
    enabled: !!libraryId,
  });

  const { data: slotAvailability = [] } = useQuery({
    queryKey: ["public-slot-availability", libraryId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_slot_availability", { p_library_id: libraryId! });
      if (error) throw error;
      return (data ?? []) as SlotAvailabilityRow[];
    },
    enabled: !!libraryId,
    refetchInterval: 30000,
  });

  const availabilityMap = slotAvailability.reduce((acc, s) => {
    acc[s.slot_id] = {
      availableSeats: s.available_seats,
      occupiedSeats: s.occupied_seats,
      totalSeats: s.total_seats,
    };
    return acc;
  }, {} as Record<string, { availableSeats: number; occupiedSeats: number; totalSeats: number }>);

  // Demo fallback
  const demoLibrary = {
    id: "demo",
    name: "City Study Hub",
    address: "Koramangala, 5th Block",
    city: "Bangalore",
    total_seats: 40,
    phone: "+91 98765 43210",
    whatsapp_number: "919876543210",
    hero_title: "City Study Hub",
    hero_subtitle: "Premium Study Space for Focused Learning",
    about_text: "A premium, distraction-free study space designed for serious learners who value discipline, focus, and results.",
    cta_title: "Book Your Seat Today",
    cta_subtitle: "Join hundreds of focused students. Limited seats available - reserve yours now.",
  };
  const demoPlans = [
    { id: "d1", name: "4 Hour", price: 2000, duration_hours: 4, description: "Any 4-hour slot with reserved seat and Wi-Fi" },
    { id: "d2", name: "6 Hour", price: 3000, duration_hours: 6, description: "Any 6-hour slot with reserved seat, Wi-Fi and locker" },
    { id: "d3", name: "Full Day", price: 4500, duration_hours: 16, description: "6AM-10PM access with reserved seat, Wi-Fi, locker and priority support" },
  ];
  const demoSlots = [
    { id: "s1", name: "Morning", start_time: "06:00", end_time: "10:00", max_seats: 40 },
    { id: "s2", name: "Forenoon", start_time: "10:00", end_time: "14:00", max_seats: 40 },
    { id: "s3", name: "Afternoon", start_time: "14:00", end_time: "18:00", max_seats: 40 },
    { id: "s4", name: "Evening", start_time: "18:00", end_time: "22:00", max_seats: 40 },
  ];
  const demoAvailability: Record<string, { availableSeats: number; occupiedSeats: number; totalSeats: number }> = {
    s1: { availableSeats: 37, occupiedSeats: 3, totalSeats: 40 },
    s2: { availableSeats: 33, occupiedSeats: 7, totalSeats: 40 },
    s3: { availableSeats: 8, occupiedSeats: 32, totalSeats: 40 },
    s4: { availableSeats: 3, occupiedSeats: 37, totalSeats: 40 },
  };
  const demoGalleryImages = [
    { src: "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1200&q=80", alt: "Library desks" },
    { src: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=80", alt: "Reading hall" },
    { src: "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80", alt: "Bookshelves" },
  ];
  const demoTestimonials = [
    { name: "Priya Sharma", text: "Best library for deep focus. The silent zone is incredible.", rating: 5 },
    { name: "Rahul Verma", text: "Very silent environment with excellent facilities and support.", rating: 5 },
    { name: "Sneha Patel", text: "Comfortable seating and convenient location.", rating: 5 },
  ];

  const isDemo = !library && slug === "demo";
  const displayLibrary = library || demoLibrary;
  const displayPlans = plans.length > 0 ? plans : (isDemo ? demoPlans : []);
  const displaySlots = slots.length > 0 ? slots : (isDemo ? demoSlots : []);
  const displayAvailability = Object.keys(availabilityMap).length > 0 ? availabilityMap : (isDemo ? demoAvailability : {});
  const galleryForSections =
    galleryImages.length > 0
      ? galleryImages.map((image) => ({ src: image.image_url, alt: image.caption || displayLibrary.name }))
      : (isDemo ? demoGalleryImages : []);
  const testimonialsForSection =
    publishedReviews.length > 0
      ? publishedReviews.map((review) => ({ name: review.reviewer_name, text: review.review_text, rating: review.rating }))
      : (isDemo ? demoTestimonials : []);
  const websiteTheme = resolveWebsiteTheme(displayLibrary);
  const brandColor = websiteTheme.brandColor;
  const heroTitle = websiteTheme.heroTitle;
  const heroSubtitle = websiteTheme.heroSubtitle;
  const aboutText = displayLibrary.about_text || "";
  const ctaTitle = websiteTheme.ctaTitle;
  const ctaSubtitle = websiteTheme.ctaSubtitle;
  const whatsappNumber = normalizeWhatsAppNumber(displayLibrary.whatsapp_number || displayLibrary.phone);
  const heroBackgroundStyle = websiteTheme.heroBackgroundStyle;
  const sectionHeadingStyle = { color: websiteTheme.sectionHeadingColor };
  const popularIndex = displayPlans.length >= 3 ? 1 : displayPlans.length - 1;

  const planFeatures = ["High Speed WiFi", "Power Backup", "Silent Zone", "CCTV Security"];

  useEffect(() => {
    if (displayLibrary?.name) document.title = `${displayLibrary.name} | Libriofy`;
    return () => { document.title = "Libriofy - Automate Your Library"; };
  }, [displayLibrary?.name]);

  const scrollToForm = () => {
    setShowForm(true);
    setTimeout(() => document.getElementById("admission")?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  if (libLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!library && !isDemo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Library not found.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {isDemo && (
        <div className="bg-accent/20 text-accent-foreground text-center py-2 text-sm">
          Demo preview: Create an account to set up your own library page.
        </div>
      )}

      {/* Hero */}
      <header
        className="relative text-primary-foreground py-20 sm:py-32 overflow-hidden"
        style={heroBackgroundStyle}
      >
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
        <div className="container mx-auto px-4 text-center relative z-10">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            {displayLibrary.logo_url ? (
              <img src={displayLibrary.logo_url} alt={displayLibrary.name} className="w-16 h-16 rounded-2xl mx-auto mb-6 object-cover shadow-lg" />
            ) : null}
            <h1 className="text-4xl sm:text-6xl font-bold font-display mb-4" style={{ color: websiteTheme.heroTitleColor }}>
              {heroTitle}
            </h1>
            <p className="text-lg sm:text-xl mb-6 max-w-lg mx-auto" style={{ color: websiteTheme.heroSubtitleColor }}>
              {heroSubtitle}
            </p>
            <div className="flex items-center justify-center gap-4 text-primary-foreground/70 text-sm flex-wrap mb-8">
              {displayLibrary.address && (
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {displayLibrary.address}{displayLibrary.city ? `, ${displayLibrary.city}` : ""}</span>
              )}
              {displayLibrary.opening_hours ? (
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {displayLibrary.opening_hours}</span>
              ) : displaySlots.length > 0 ? (
                <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> {displaySlots[0].start_time.slice(0, 5)} - {displaySlots[displaySlots.length - 1].end_time.slice(0, 5)}</span>
              ) : null}
              <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {displayLibrary.total_seats} seats</span>
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button size="lg" onClick={scrollToForm} className="bg-background text-foreground hover:bg-background/90 font-semibold text-base px-8">
                Book Seat <ChevronRight className="w-5 h-5 ml-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/70 bg-black/30 text-white hover:bg-black/45 hover:text-white font-semibold text-base px-8 backdrop-blur-sm"
                onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}
              >
                View Plans
              </Button>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Image Slider */}
      <ImageSlider images={galleryForSections} />

      {/* Live Seat Availability */}
      {displaySlots.length > 0 && (
        <section className="py-16">
          <div className="container mx-auto px-4 max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-bold font-display text-center mb-2" style={sectionHeadingStyle}>Live Seat Availability</h2>
            <p className="text-muted-foreground text-center mb-8">Real-time updates every 30 seconds</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {displaySlots.map((slot) => {
                const slotAvailabilityEntry = displayAvailability[slot.id];
                const max = slotAvailabilityEntry?.totalSeats ?? slot.max_seats ?? displayLibrary.total_seats;
                const available = slotAvailabilityEntry?.availableSeats ?? max;
                const pct = max > 0 ? available / max : 1;
                const colorClass = pct <= 0.1 ? "text-destructive" : pct <= 0.3 ? "text-accent" : "text-success";
                const borderClass = pct <= 0.1 ? "border-destructive/30" : pct <= 0.3 ? "border-accent/30" : "border-border";
                return (
                  <motion.div
                    key={slot.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className={`bg-card rounded-xl border ${borderClass} p-5 text-center`}
                  >
                    <p className="text-sm font-semibold text-foreground mb-1">{slot.name}</p>
                    <p className="text-xs text-muted-foreground mb-3">{slot.start_time.slice(0, 5)} - {slot.end_time.slice(0, 5)}</p>
                    <p className={`text-4xl font-bold font-display ${colorClass}`}>{available}</p>
                    <p className="text-xs text-muted-foreground mt-1">seats left</p>
                    <div className="w-full h-1.5 bg-secondary rounded-full mt-3 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pct <= 0.1 ? "bg-destructive" : pct <= 0.3 ? "bg-accent" : "bg-success"}`}
                        style={{ width: `${Math.max(pct * 100, 5)}%` }}
                      />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Plans */}
      {displayPlans.length > 0 && (
        <section className="py-16 bg-secondary/30" id="plans">
          <div className="container mx-auto px-4 max-w-5xl">
            <h2 className="text-2xl sm:text-3xl font-bold font-display text-center mb-2" style={sectionHeadingStyle}>Choose Your Plan</h2>
            <p className="text-muted-foreground text-center mb-10">Flexible plans to suit your study schedule</p>
            <div className={`grid grid-cols-1 sm:grid-cols-${Math.min(displayPlans.length, 3)} gap-6`}>
              {displayPlans.map((plan, i) => {
                const isPopular = i === popularIndex && displayPlans.length > 1;
                return (
                  <motion.div
                    key={plan.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className={`relative bg-card rounded-2xl border p-6 sm:p-8 ${isPopular ? "border-primary shadow-glow scale-[1.02]" : "border-border"}`}
                  >
                    {isPopular && (
                      <Badge className="absolute -top-3 left-4 bg-accent text-accent-foreground px-3 py-1">Best Value</Badge>
                    )}
                    <h3 className="text-lg font-bold font-display text-foreground">{plan.name}</h3>
                    <p className="text-3xl font-bold font-display text-primary mt-3">
                      Rs {plan.price.toLocaleString("en-IN")}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </p>
                    {plan.description && <p className="text-sm text-muted-foreground mt-3">{plan.description}</p>}
                    <p className="text-xs text-muted-foreground mt-1">{plan.duration_hours}h daily access</p>
                    <ul className="mt-5 space-y-2">
                      {planFeatures.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Check className="w-4 h-4 text-success shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button className="w-full mt-6" onClick={scrollToForm}>
                      Book Now <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Facilities */}
      <FacilitiesSection headingColor={websiteTheme.sectionHeadingColor} />

      {/* Gallery */}
      <GallerySection images={galleryForSections} headingColor={websiteTheme.sectionHeadingColor} />

      {/* About */}
      <AboutSection libraryName={displayLibrary.name} aboutText={aboutText} headingColor={websiteTheme.sectionHeadingColor} />

      {/* Testimonials */}
      <TestimonialsSection testimonials={testimonialsForSection} headingColor={websiteTheme.sectionHeadingColor} />

      {/* CTA */}
      <CTASection
        brandColor={brandColor}
        onBookSeat={scrollToForm}
        title={ctaTitle}
        subtitle={ctaSubtitle}
        backgroundStyle={websiteTheme.ctaBackgroundStyle}
        backgroundType={websiteTheme.ctaBackgroundType}
        titleColor={websiteTheme.ctaTitleColor}
        subtitleColor={websiteTheme.ctaSubtitleColor}
        buttonColor={websiteTheme.ctaButtonColor}
        buttonTextColor={websiteTheme.ctaButtonTextColor}
      />

      {/* Contact */}
      <div id="contact">
        <ContactSection library={displayLibrary} headingColor={websiteTheme.sectionHeadingColor} />
      </div>

      {/* Admission Form */}
      {showForm && (
        <section className="py-16 bg-secondary/30" id="admission">
          <div className="container mx-auto px-4 max-w-lg">
            <motion.div
              className="bg-card rounded-2xl border border-border p-6 sm:p-8 shadow-lg"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {submitted ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                    <Check className="w-8 h-8 text-success" />
                  </div>
                  <h2 className="text-xl font-bold font-display text-foreground mb-2">You're on the list!</h2>
                  <p className="text-muted-foreground">
                    Your queue position is <span className="font-bold text-primary">#{queuePosition}</span>.
                    You'll be notified when a seat becomes available.
                  </p>
                </div>
              ) : isDemo ? (
                <div className="text-center py-8">
                  <h2 className="text-xl font-bold font-display text-foreground mb-2">Demo Mode</h2>
                  <p className="text-muted-foreground">Form submission is disabled in demo mode. Create an account to enable the waiting list.</p>
                  <Link to="/auth"><Button className="mt-4">Get Started</Button></Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit}>
                  <h2 className="text-xl font-bold font-display text-foreground mb-6">Join Waiting List</h2>
                  <div className="space-y-4">
                    <div>
                      <Label>Full Name *</Label>
                      <Input placeholder="Enter your name" className="mt-1" value={formName} onChange={(e) => setFormName(e.target.value)} required />
                    </div>
                    <div>
                      <Label>Phone Number</Label>
                      <Input placeholder="10-digit number" className="mt-1" value={formPhone} onChange={(e) => setFormPhone(e.target.value)} />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input type="email" placeholder="your@email.com" className="mt-1" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} />
                    </div>
                    {displayPlans.length > 0 && (
                      <div>
                        <Label>Preferred Plan</Label>
                        <Select value={formPlan} onValueChange={setFormPlan}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select a plan" /></SelectTrigger>
                          <SelectContent>
                            {displayPlans.map((p) => (
                              <SelectItem key={p.id} value={p.name}>{p.name} - Rs {p.price.toLocaleString("en-IN")}/mo</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {displaySlots.length > 0 && (
                      <div>
                        <Label>Preferred Slot</Label>
                        <Select value={formSlot} onValueChange={setFormSlot}>
                          <SelectTrigger className="mt-1"><SelectValue placeholder="Select time slot" /></SelectTrigger>
                          <SelectContent>
                            {displaySlots.map((s) => (
                              <SelectItem key={s.id} value={s.name}>{s.name} ({s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button type="submit" disabled={submitting || !formName.trim()} className="w-full mt-2">
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      {submitting ? "Submitting..." : "Join Waiting List"}
                    </Button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        </section>
      )}

      {/* Footer */}
      <LibraryFooter library={displayLibrary} />

      {/* WhatsApp */}
      <WhatsAppButton whatsappNumber={whatsappNumber} />
    </div>
  );
};

export default LibraryPublicPage;
