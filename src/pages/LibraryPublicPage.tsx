import { useState, FormEvent } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { BookOpen, MapPin, Clock, Users, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const LibraryPublicPage = () => {
  const { id } = useParams<{ id: string }>();
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
    queryKey: ["public-library", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_library_public", { p_identifier: id! });
      if (error) throw error;
      if (!data || (data as any[]).length === 0) return null;
      return (data as any[])[0];
    },
    enabled: !!id,
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

  // Get slot availability via secure function
  const { data: slotAvailability = [] } = useQuery({
    queryKey: ["public-slot-availability", libraryId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_slot_availability", {
        p_library_id: libraryId!,
      });
      if (error) throw error;
      return data as { slot_name: string; available_seats: number }[];
    },
    enabled: !!libraryId,
    refetchInterval: 30000,
  });

  const availabilityMap = slotAvailability.reduce((acc, s) => {
    acc[s.slot_name] = s.available_seats;
    return acc;
  }, {} as Record<string, number>);

  // Demo fallback data when no library exists yet
  const demoLibrary = {
    id: "demo",
    name: "City Study Hub",
    address: "Koramangala, 5th Block",
    city: "Bangalore",
    total_seats: 40,
  };
  const demoPlans = [
    { id: "d1", name: "4 Hour", price: 2000, duration_hours: 4, description: "Any 4-hour slot with reserved seat and Wi-Fi" },
    { id: "d2", name: "6 Hour", price: 3000, duration_hours: 6, description: "Any 6-hour slot with reserved seat, Wi-Fi and locker" },
    { id: "d3", name: "Full Day", price: 4500, duration_hours: 16, description: "6AM–10PM access with reserved seat, Wi-Fi, locker and priority support" },
  ];
  const demoSlots = [
    { id: "s1", name: "Morning", start_time: "06:00", end_time: "10:00", max_seats: 40 },
    { id: "s2", name: "Forenoon", start_time: "10:00", end_time: "14:00", max_seats: 40 },
    { id: "s3", name: "Afternoon", start_time: "14:00", end_time: "18:00", max_seats: 40 },
    { id: "s4", name: "Evening", start_time: "18:00", end_time: "22:00", max_seats: 40 },
  ];
  const demoAvailability: Record<string, number> = { Morning: 37, Forenoon: 33, Afternoon: 28, Evening: 39 };

  const isDemo = !library && id === "demo";
  const displayLibrary = library || demoLibrary;
  const displayPlans = plans.length > 0 ? plans : (isDemo ? demoPlans : []);
  const displaySlots = slots.length > 0 ? slots : (isDemo ? demoSlots : []);
  const displayAvailability = Object.keys(availabilityMap).length > 0 ? availabilityMap : (isDemo ? demoAvailability : {});

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

  // Find the most popular plan (middle or highest price)
  const popularIndex = displayPlans.length >= 3 ? 1 : displayPlans.length - 1;

  return (
    <div className="min-h-screen bg-background">
      {/* Demo banner */}
      {isDemo && (
        <div className="bg-accent/20 text-accent-foreground text-center py-2 text-sm">
          🎯 This is a demo preview. Create an account to set up your own library page.
        </div>
      )}

      {/* Header */}
      <header className="bg-hero-gradient text-primary-foreground py-16 sm:py-24">
        <div className="container mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-14 h-14 rounded-2xl bg-primary/30 flex items-center justify-center mx-auto mb-6">
              <BookOpen className="w-7 h-7 text-primary-foreground" />
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold font-display mb-4">{displayLibrary.name}</h1>
            <div className="flex items-center justify-center gap-4 text-primary-foreground/60 text-sm flex-wrap">
              {displayLibrary.address && (
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {displayLibrary.address}{displayLibrary.city ? `, ${displayLibrary.city}` : ""}</span>
              )}
              {displaySlots.length > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" /> {displaySlots[0].start_time.slice(0, 5)} – {displaySlots[displaySlots.length - 1].end_time.slice(0, 5)}
                </span>
              )}
              <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {displayLibrary.total_seats} seats</span>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Live Availability */}
      {displaySlots.length > 0 && (
        <section className="py-12">
          <div className="container mx-auto px-4 max-w-4xl">
            <h2 className="text-2xl font-bold font-display text-foreground mb-6">Live Seat Availability</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {displaySlots.map((slot) => {
                const available = displayAvailability[slot.name] ?? (slot.max_seats ?? displayLibrary.total_seats);
                return (
                  <div key={slot.id} className="bg-card rounded-xl border border-border p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-2">{slot.name}</p>
                    <p className="text-[10px] text-muted-foreground/60 mb-1">
                      {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}
                    </p>
                    <p className={`text-2xl font-bold font-display ${available <= 3 ? "text-destructive" : "text-success"}`}>
                      {available}
                    </p>
                    <p className="text-xs text-muted-foreground">seats left</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Plans */}
      {displayPlans.length > 0 && (
        <section className="py-12 bg-secondary/30">
          <div className="container mx-auto px-4 max-w-4xl">
            <h2 className="text-2xl font-bold font-display text-foreground mb-6">Plans</h2>
            <div className={`grid grid-cols-1 sm:grid-cols-${Math.min(displayPlans.length, 3)} gap-6`}>
              {displayPlans.map((plan, i) => {
                const isPopular = i === popularIndex && displayPlans.length > 1;
                return (
                  <div key={plan.id} className={`relative bg-card rounded-xl border p-6 ${isPopular ? "border-primary shadow-glow" : "border-border"}`}>
                    {isPopular && (
                      <Badge className="absolute -top-2.5 left-4 bg-accent text-accent-foreground">Popular</Badge>
                    )}
                    <h3 className="text-lg font-bold font-display text-foreground">{plan.name}</h3>
                    <p className="text-2xl font-bold font-display text-primary mt-2">
                      ₹{plan.price.toLocaleString("en-IN")}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </p>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground mt-2">{plan.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{plan.duration_hours}h daily access</p>
                    <Button
                      className="w-full mt-6 bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => setShowForm(true)}
                    >
                      Book Now <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Admission Form */}
      {showForm && (
        <section className="py-12" id="admission">
          <div className="container mx-auto px-4 max-w-lg">
            <motion.div
              className="bg-card rounded-2xl border border-border p-6 sm:p-8"
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
                  <p className="text-muted-foreground">
                    Form submission is disabled in demo mode. Create an account to enable the waiting list.
                  </p>
                  <Link to="/auth">
                    <Button className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90">
                      Get Started
                    </Button>
                  </Link>
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
                              <SelectItem key={p.id} value={p.name}>
                                {p.name} – ₹{p.price.toLocaleString("en-IN")}/mo
                              </SelectItem>
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
                              <SelectItem key={s.id} value={s.name}>
                                {s.name} ({s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <Button type="submit" disabled={submitting || !formName.trim()} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-2">
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

      {/* Footer link */}
      <div className="py-8 text-center">
        <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          Powered by <span className="font-semibold">Libriofy</span>
        </Link>
        <p className="text-xs text-muted-foreground/50 mt-1">by Sangita Group</p>
      </div>
    </div>
  );
};

export default LibraryPublicPage;
