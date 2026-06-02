import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Edit2, Plus, Trash2 } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { isStudentCurrentlyActive } from "@/lib/studentMembership";

type PlanRow = Database["public"]["Tables"]["plans"]["Row"];
type SlotRow = Database["public"]["Tables"]["time_slots"]["Row"];
type PlanInsert = Database["public"]["Tables"]["plans"]["Insert"];
type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];
type SlotInsert = Database["public"]["Tables"]["time_slots"]["Insert"];
type SlotUpdate = Database["public"]["Tables"]["time_slots"]["Update"];

type StudentPlanRow = Pick<Database["public"]["Tables"]["students"]["Row"], "expiry_date" | "plan" | "status">;

const initialPlanForm = {
  name: "",
  duration_hours: "",
  price: "",
  description: "",
};

const initialSlotForm = {
  name: "",
  start_time: "",
  end_time: "",
  max_seats: "",
};

const getErrorMessage = (error: unknown): string => getSafeErrorMessage(error);

const normalize = (value: string | null | undefined) => (value || "").trim().toLowerCase();

const formatTime = (value: string) => {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw || "0");
  if (Number.isNaN(hour)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const PlansPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRow | null>(null);
  const [planForm, setPlanForm] = useState(initialPlanForm);

  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<SlotRow | null>(null);
  const [slotForm, setSlotForm] = useState(initialSlotForm);

  const { data: fallbackLibraries = [], isLoading: fallbackLoading } = useQuery({
    queryKey: ["my-libraries-fallback", user?.id],
    queryFn: async (): Promise<Array<{ id: string }>> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("libraries")
        .select("id")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !libraryId,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  const {
    data: plans = [],
    isLoading: plansLoading,
    isError: plansError,
    error: plansQueryError,
  } = useQuery({
    queryKey: ["plans-page-plans", resolvedLibraryId],
    queryFn: async (): Promise<PlanRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("library_id", resolvedLibraryId)
        .order("price", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const {
    data: slots = [],
    isLoading: slotsLoading,
    isError: slotsError,
    error: slotsQueryError,
  } = useQuery({
    queryKey: ["plans-page-slots", resolvedLibraryId],
    queryFn: async (): Promise<SlotRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("time_slots")
        .select("*")
        .eq("library_id", resolvedLibraryId)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const { data: studentPlans = [] } = useQuery({
    queryKey: ["plans-page-student-count", resolvedLibraryId],
    queryFn: async (): Promise<StudentPlanRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("students")
        .select("plan, status, expiry_date")
        .eq("library_id", resolvedLibraryId)
        .in("status", ["active", "expired"]);
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const activeStudentByPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of studentPlans) {
      if (!isStudentCurrentlyActive(item)) continue;
      const key = normalize(item.plan);
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return map;
  }, [studentPlans]);

  const savePlanMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      if (!planForm.name.trim()) throw new Error("Plan name is required.");
      const duration = Number(planForm.duration_hours);
      const price = Number(planForm.price);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Duration must be greater than 0.");
      if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be greater than 0.");

      const payload: PlanInsert = {
        library_id: resolvedLibraryId,
        name: planForm.name.trim(),
        duration_hours: duration,
        price,
        description: planForm.description.trim() || null,
        is_active: true,
      };

      if (editingPlan) {
        const updatePayload: PlanUpdate = {
          name: payload.name,
          duration_hours: payload.duration_hours,
          price: payload.price,
          description: payload.description,
        };
        const { error } = await supabase.from("plans").update(updatePayload).eq("id", editingPlan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("plans").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setPlanDialogOpen(false);
      setEditingPlan(null);
      setPlanForm(initialPlanForm);
      queryClient.invalidateQueries({ queryKey: ["plans-page-plans", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-plans", resolvedLibraryId] });
      toast({ title: editingPlan ? "Plan updated" : "Plan added" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to save plan", description: error.message, variant: "destructive" });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.from("plans").delete().eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans-page-plans", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-plans", resolvedLibraryId] });
      toast({ title: "Plan deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to delete plan", description: error.message, variant: "destructive" });
    },
  });

  const togglePlanMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("plans").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans-page-plans", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-plans", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update plan status", description: error.message, variant: "destructive" });
    },
  });

  const saveSlotMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not linked for this account.");
      if (!slotForm.name.trim() || !slotForm.start_time || !slotForm.end_time) {
        throw new Error("Name, start time and end time are required.");
      }

      const payload: SlotInsert = {
        library_id: resolvedLibraryId,
        name: slotForm.name.trim(),
        start_time: slotForm.start_time,
        end_time: slotForm.end_time,
        max_seats: slotForm.max_seats ? Number(slotForm.max_seats) : null,
        is_active: true,
      };

      if (editingSlot) {
        const updatePayload: SlotUpdate = {
          name: payload.name,
          start_time: payload.start_time,
          end_time: payload.end_time,
          max_seats: payload.max_seats,
        };
        const { error } = await supabase.from("time_slots").update(updatePayload).eq("id", editingSlot.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("time_slots").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setSlotDialogOpen(false);
      setEditingSlot(null);
      setSlotForm(initialSlotForm);
      queryClient.invalidateQueries({ queryKey: ["plans-page-slots", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-slots", resolvedLibraryId] });
      toast({ title: editingSlot ? "Slot updated" : "Slot added" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to save slot", description: error.message, variant: "destructive" });
    },
  });

  const deleteSlotMutation = useMutation({
    mutationFn: async (slotId: string) => {
      const { error } = await supabase.from("time_slots").delete().eq("id", slotId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans-page-slots", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-slots", resolvedLibraryId] });
      toast({ title: "Slot deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to delete slot", description: error.message, variant: "destructive" });
    },
  });

  const toggleSlotMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("time_slots").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plans-page-slots", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["waiting-list-slots", resolvedLibraryId] });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update slot status", description: error.message, variant: "destructive" });
    },
  });

  const openCreatePlan = () => {
    setEditingPlan(null);
    setPlanForm(initialPlanForm);
    setPlanDialogOpen(true);
  };

  const openEditPlan = (plan: PlanRow) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name,
      duration_hours: String(plan.duration_hours),
      price: String(plan.price),
      description: plan.description || "",
    });
    setPlanDialogOpen(true);
  };

  const openCreateSlot = () => {
    setEditingSlot(null);
    setSlotForm(initialSlotForm);
    setSlotDialogOpen(true);
  };

  const openEditSlot = (slot: SlotRow) => {
    setEditingSlot(slot);
    setSlotForm({
      name: slot.name,
      start_time: slot.start_time,
      end_time: slot.end_time,
      max_seats: slot.max_seats ? String(slot.max_seats) : "",
    });
    setSlotDialogOpen(true);
  };

  const loading = roleLibraryLoading || fallbackLoading;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Plans & Slots</h2>
          <p className="text-sm text-muted-foreground mt-1">Configure pricing plans and time slots</p>
        </div>

        {!resolvedLibraryId && !loading && (
          <Card>
            <CardContent className="py-8 text-center text-destructive">
              Library not linked to your account. Please check user role setup.
            </CardContent>
          </Card>
        )}

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold font-display text-foreground">Plans</h3>
            <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={!resolvedLibraryId} onClick={openCreatePlan}>
                  <Plus className="w-4 h-4 mr-1" /> Add Plan
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">{editingPlan ? "Edit Plan" : "Add Plan"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Plan Name</Label>
                    <Input value={planForm.name} onChange={(e) => setPlanForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Full Day" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Duration (hours)</Label>
                      <Input type="number" value={planForm.duration_hours} onChange={(e) => setPlanForm((prev) => ({ ...prev, duration_hours: e.target.value }))} placeholder="8" />
                    </div>
                    <div className="space-y-2">
                      <Label>Price (INR)</Label>
                      <Input type="number" value={planForm.price} onChange={(e) => setPlanForm((prev) => ({ ...prev, price: e.target.value }))} placeholder="3500" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={planForm.description} onChange={(e) => setPlanForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Short plan details" rows={3} />
                  </div>
                  <Button className="w-full" onClick={() => savePlanMutation.mutate()} disabled={savePlanMutation.isPending}>
                    {savePlanMutation.isPending ? "Saving..." : editingPlan ? "Update Plan" : "Create Plan"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {plansLoading ? (
            <p className="text-sm text-muted-foreground py-6">Loading plans...</p>
          ) : plansError ? (
            <p className="text-sm text-destructive py-6">Unable to load plans: {getErrorMessage(plansQueryError)}</p>
          ) : plans.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">No plans found. Add your first plan.</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {plans.map((plan) => {
                const activeCount = activeStudentByPlan.get(normalize(plan.name)) || 0;
                return (
                  <Card key={plan.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-bold font-display text-foreground">{plan.name}</h4>
                        <p className="text-2xl font-bold text-primary mt-1">
                          Rs {Number(plan.price).toLocaleString("en-IN")}
                          <span className="text-sm text-muted-foreground font-normal">/mo</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEditPlan(plan)}>
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => deletePlanMutation.mutate(plan.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">{plan.duration_hours} hours/day</p>
                    <p className="text-xs text-muted-foreground mt-1">{activeCount} active students</p>
                    {plan.description && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{plan.description}</p>}
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                      <Badge variant={plan.is_active ? "default" : "secondary"}>{plan.is_active ? "Active" : "Inactive"}</Badge>
                      <Switch checked={plan.is_active} onCheckedChange={(checked) => togglePlanMutation.mutate({ id: plan.id, is_active: checked })} />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold font-display text-foreground">Time Slots</h3>
            <Dialog open={slotDialogOpen} onOpenChange={setSlotDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={!resolvedLibraryId} onClick={openCreateSlot}>
                  <Plus className="w-4 h-4 mr-1" /> Add Slot
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="font-display">{editingSlot ? "Edit Slot" : "Add Slot"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Slot Name</Label>
                    <Input value={slotForm.name} onChange={(e) => setSlotForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="e.g. Morning" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Time</Label>
                      <Input type="time" value={slotForm.start_time} onChange={(e) => setSlotForm((prev) => ({ ...prev, start_time: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>End Time</Label>
                      <Input type="time" value={slotForm.end_time} onChange={(e) => setSlotForm((prev) => ({ ...prev, end_time: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Capacity (optional)</Label>
                    <Input type="number" value={slotForm.max_seats} onChange={(e) => setSlotForm((prev) => ({ ...prev, max_seats: e.target.value }))} placeholder="40" />
                  </div>
                  <Button className="w-full" onClick={() => saveSlotMutation.mutate()} disabled={saveSlotMutation.isPending}>
                    {saveSlotMutation.isPending ? "Saving..." : editingSlot ? "Update Slot" : "Create Slot"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {slotsLoading ? (
            <p className="text-sm text-muted-foreground py-6">Loading slots...</p>
          ) : slotsError ? (
            <p className="text-sm text-destructive py-6">Unable to load slots: {getErrorMessage(slotsQueryError)}</p>
          ) : slots.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">No time slots found. Add your first slot.</CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {slots.map((slot) => (
                <Card key={slot.id} className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-primary" />
                      <h4 className="font-semibold font-display text-foreground">{slot.name}</h4>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" onClick={() => openEditSlot(slot)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => deleteSlotMutation.mutate(slot.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Capacity: {slot.max_seats || "Unlimited"} seats</p>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                    <Badge variant={slot.is_active ? "default" : "secondary"}>{slot.is_active ? "Active" : "Inactive"}</Badge>
                    <Switch checked={slot.is_active} onCheckedChange={(checked) => toggleSlotMutation.mutate({ id: slot.id, is_active: checked })} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default PlansPage;
