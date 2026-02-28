import { useState } from "react";
import { useParams } from "react-router-dom";
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

  const { data: library, isLoading: libLoading } = useQuery({
    queryKey: ["public-library", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("libraries")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["public-plans", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("library_id", id!)
        .eq("is_active", true)
        .order("price", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: slots = [] } = useQuery({
    queryKey: ["public-slots", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("time_slots")
        .select("*")
        .eq("library_id", id!)
        .eq("is_active", true)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Get slot availability via secure function
  const { data: slotAvailability = [] } = useQuery({
    queryKey: ["public-slot-availability", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_slot_availability", {
        p_library_id: id!,
      });
      if (error) throw error;
      return data as { slot_name: string; available_seats: number }[];
    },
    enabled: !!id,
    refetchInterval: 30000, // refresh every 30s
  });

  const availabilityMap = slotAvailability.reduce((acc, s) => {
    acc[s.slot_name] = s.available_seats;
    return acc;
  }, {} as Record<string, number>);

  if (libLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!library) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Library not found.</p>
      </div>
    );
  }

  // Find the most popular plan (middle or highest price)
  const popularIndex = plans.length >= 3 ? 1 : plans.length - 1;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-hero-gradient text-primary-foreground py-16 sm:py-24">
        <div className="container mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-14 h-14 rounded-2xl bg-primary/30 flex items-center justify-center mx-auto mb-6">
              <BookOpen className="w-7 h-7 text-primary-foreground" />
            </div>
            <h1 className="text-3xl sm:text-5xl font-bold font-display mb-4">{library.name}</h1>
            <div className="flex items-center justify-center gap-4 text-primary-foreground/60 text-sm flex-wrap">
              {library.address && (
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {library.address}{library.city ? `, ${library.city}` : ""}</span>
              )}
              {slots.length > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" /> {slots[0].start_time.slice(0, 5)} – {slots[slots.length - 1].end_time.slice(0, 5)}
                </span>
              )}
              <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {library.total_seats} seats</span>
            </div>
          </motion.div>
        </div>
      </header>

      {/* Live Availability */}
      {slots.length > 0 && (
        <section className="py-12">
          <div className="container mx-auto px-4 max-w-4xl">
            <h2 className="text-2xl font-bold font-display text-foreground mb-6">Live Seat Availability</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {slots.map((slot) => {
                const available = availabilityMap[slot.name] ?? (slot.max_seats ?? library.total_seats);
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
      {plans.length > 0 && (
        <section className="py-12 bg-secondary/30">
          <div className="container mx-auto px-4 max-w-4xl">
            <h2 className="text-2xl font-bold font-display text-foreground mb-6">Plans</h2>
            <div className={`grid grid-cols-1 sm:grid-cols-${Math.min(plans.length, 3)} gap-6`}>
              {plans.map((plan, i) => {
                const isPopular = i === popularIndex && plans.length > 1;
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
              <h2 className="text-xl font-bold font-display text-foreground mb-6">Admission Form</h2>
              <div className="space-y-4">
                <div>
                  <Label>Full Name</Label>
                  <Input placeholder="Enter your name" className="mt-1" />
                </div>
                <div>
                  <Label>Phone Number</Label>
                  <Input placeholder="10-digit number" className="mt-1" />
                </div>
                {plans.length > 0 && (
                  <div>
                    <Label>Preferred Plan</Label>
                    <Select>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select a plan" /></SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} – ₹{p.price.toLocaleString("en-IN")}/mo
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {slots.length > 0 && (
                  <div>
                    <Label>Preferred Slot</Label>
                    <Select>
                      <SelectTrigger className="mt-1"><SelectValue placeholder="Select time slot" /></SelectTrigger>
                      <SelectContent>
                        {slots.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} ({s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label>Start Date</Label>
                  <Input type="date" className="mt-1" />
                </div>
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 mt-2">
                  Submit & Proceed to Payment
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Footer link */}
      <div className="py-8 text-center">
        <Link to="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          Powered by <span className="font-semibold">SwiftGrowth</span>
        </Link>
      </div>
    </div>
  );
};

export default LibraryPublicPage;
