import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Check, ChevronDown, Download, Edit2, Plus, Search } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { exportToCsv } from "@/lib/exportCsv";
import { formatCompactTimeLabel, formatTimeLabel, isStudentCurrentlyActive, normalizeLookupText, normalizeSeatId, seatSort } from "@/lib/seatUtils";
import {
  areStringArraysEqual,
  buildSlotOrder,
  buildStudentSlotIdMap,
  getPlanSlotRule,
  isMissingRelationError,
  normalizeSelectedSlotIds,
} from "@/lib/studentSlotUtils";
import { cn } from "@/lib/utils";

type StudentRow = Database["public"]["Tables"]["students"]["Row"];
type StudentInsert = Database["public"]["Tables"]["students"]["Insert"];
type StudentUpdate = Database["public"]["Tables"]["students"]["Update"];
type PlanRow = Database["public"]["Tables"]["plans"]["Row"];
type SlotRow = Database["public"]["Tables"]["time_slots"]["Row"];
type SeatRow = Database["public"]["Tables"]["seats"]["Row"];
type StudentSeatValidationRow = Pick<StudentRow, "id" | "seat_id" | "seat_number" | "slot_id" | "slot" | "status" | "expiry_date">;
type StudentSlotAssignmentRow = {
  created_at: string;
  id: string;
  library_id: string;
  slot_id: string;
  student_id: string;
  updated_at: string;
};
type StudentSlotAssignmentInsert = Pick<StudentSlotAssignmentRow, "library_id" | "slot_id" | "student_id">;

type StudentRecord = StudentRow & {
  plan_ref: Pick<PlanRow, "id" | "name" | "price"> | null;
  seat_ref: Pick<SeatRow, "id" | "seat_number" | "seat_index"> | null;
  slot_ref: Pick<SlotRow, "id" | "name" | "start_time" | "end_time" | "max_seats"> | null;
};

type StudentFormState = {
  email: string;
  expiry_date: string;
  full_name: string;
  phone: string;
  plan_id: string;
  seat_id: string;
  slot_ids: string[];
  start_date: string;
};

type SelectOption = {
  label: string;
  value: string;
};

const createInitialForm = (): StudentFormState => ({
  email: "",
  expiry_date: "",
  full_name: "",
  phone: "",
  plan_id: "",
  seat_id: "",
  slot_ids: [],
  start_date: new Date().toISOString().slice(0, 10),
});

const getStatusLabel = (student: Pick<StudentRow, "status" | "expiry_date">): "Active" | "Expiring" | "Expired" | "Inactive" | "Waiting" => {
  if (student.status === "inactive") return "Inactive";
  if (student.status === "waiting") return "Waiting";
  if (student.status === "expired") return "Expired";

  if (!student.expiry_date) return "Active";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${student.expiry_date}T00:00:00`);
  if (expiry < today) return "Expired";
  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return "Expiring";
  return "Active";
};

const statusVariant = (status: ReturnType<typeof getStatusLabel>) => {
  if (status === "Active") return "default";
  if (status === "Expiring" || status === "Waiting") return "secondary";
  if (status === "Inactive") return "outline";
  return "destructive";
};

const buildPlanLabel = (plan: Pick<PlanRow, "name" | "price">) => `${plan.name} - Rs ${Number(plan.price).toLocaleString("en-IN")}`;

const buildSlotLabel = (slot: Pick<SlotRow, "name" | "start_time" | "end_time">) =>
  `${slot.name} (${formatTimeLabel(slot.start_time)} - ${formatTimeLabel(slot.end_time)})`;

const buildSlotLookupKeys = (slot: Pick<SlotRow, "name" | "start_time" | "end_time">) => {
  const compactRange = `${formatCompactTimeLabel(slot.start_time)}-${formatCompactTimeLabel(slot.end_time)}`;
  const displayRange = `${formatTimeLabel(slot.start_time)}-${formatTimeLabel(slot.end_time)}`;
  return [
    normalizeLookupText(slot.name),
    normalizeLookupText(compactRange),
    normalizeLookupText(displayRange),
    normalizeLookupText(`${slot.name}${compactRange}`),
    normalizeLookupText(`${slot.name}${displayRange}`),
  ].filter(Boolean);
};

const StudentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: currentLibraryLoading } = useCurrentLibraryId();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<StudentRecord | null>(null);
  const [form, setForm] = useState<StudentFormState>(createInitialForm);
  const [slotAssignmentsTableAvailable, setSlotAssignmentsTableAvailable] = useState<boolean | null>(null);

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

  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ["students", resolvedLibraryId],
    queryFn: async (): Promise<StudentRecord[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("students")
        .select(`
          *,
          plan_ref:plans!students_plan_id_fkey(id, name, price),
          seat_ref:seats!students_seat_id_fkey(id, seat_number, seat_index),
          slot_ref:time_slots!students_slot_id_fkey(id, name, start_time, end_time, max_seats)
        `)
        .eq("library_id", resolvedLibraryId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as StudentRecord[];
    },
    enabled: !!resolvedLibraryId,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery({
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

  const { data: slots = [], isLoading: slotsLoading } = useQuery({
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

  const { data: seats = [], isLoading: seatsLoading } = useQuery({
    queryKey: ["library-seats", resolvedLibraryId],
    queryFn: async (): Promise<SeatRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("seats")
        .select("*")
        .eq("library_id", resolvedLibraryId)
        .order("seat_index", { ascending: true })
        .order("seat_number", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
  });

  const { data: slotAssignments = [], isLoading: slotAssignmentsLoading } = useQuery({
    queryKey: ["student-slot-assignments", resolvedLibraryId],
    queryFn: async (): Promise<StudentSlotAssignmentRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("student_slot_assignments" as any)
        .select("*")
        .eq("library_id", resolvedLibraryId);
      if (error) {
        if (isMissingRelationError(error, "student_slot_assignments")) {
          setSlotAssignmentsTableAvailable(false);
          return [];
        }
        throw error;
      }
      setSlotAssignmentsTableAvailable(true);
      return (data ?? []) as StudentSlotAssignmentRow[];
    },
    enabled: !!resolvedLibraryId,
  });

  const activePlans = useMemo(() => plans.filter((plan) => plan.is_active), [plans]);
  const activeSlots = useMemo(() => slots.filter((slot) => slot.is_active), [slots]);
  const sortedSeats = useMemo(() => [...seats].sort((a, b) => seatSort(a.seat_number, b.seat_number)), [seats]);

  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots]);
  const slotOrder = useMemo(() => buildSlotOrder(slots), [slots]);
  const seatById = useMemo(() => new Map(sortedSeats.map((seat) => [seat.id, seat])), [sortedSeats]);
  const planIdByLookup = useMemo(() => new Map(plans.map((plan) => [normalizeLookupText(plan.name), plan.id])), [plans]);
  const seatIdByLookup = useMemo(
    () => new Map(sortedSeats.map((seat) => [normalizeSeatId(seat.seat_number), seat.id])),
    [sortedSeats],
  );
  const slotIdByLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of slots) {
      for (const key of buildSlotLookupKeys(slot)) {
        if (!map.has(key)) {
          map.set(key, slot.id);
        }
      }
    }
    return map;
  }, [slots]);

  const resolvePlanId = (student: Pick<StudentRow, "plan" | "plan_id">) =>
    student.plan_id || planIdByLookup.get(normalizeLookupText(student.plan)) || null;

  const resolveSlotId = (student: Pick<StudentRow, "slot" | "slot_id">) =>
    student.slot_id || slotIdByLookup.get(normalizeLookupText(student.slot)) || null;

  const resolveSeatId = (student: Pick<StudentRow, "seat_id" | "seat_number">) =>
    student.seat_id || seatIdByLookup.get(normalizeSeatId(student.seat_number)) || null;

  const studentSlotIdsById = useMemo(
    () => buildStudentSlotIdMap(students, slotAssignments, resolveSlotId, slotOrder),
    [slotAssignments, slotOrder, students, slotIdByLookup],
  );

  const getStudentSlotIds = (student: Pick<StudentRow, "id" | "slot" | "slot_id">) => studentSlotIdsById.get(student.id) ?? [];

  const getPlanName = (student: StudentRecord) => {
    const planId = resolvePlanId(student);
    return student.plan_ref?.name || (planId ? planById.get(planId)?.name : undefined) || student.plan || "";
  };

  const getSeatNumber = (student: StudentRecord) => {
    const seatId = resolveSeatId(student);
    return student.seat_ref?.seat_number || (seatId ? seatById.get(seatId)?.seat_number : undefined) || student.seat_number || "";
  };

  const getSlotLabel = (student: StudentRecord) => {
    const slotIds = getStudentSlotIds(student);
    const labels = slotIds
      .map((slotId) => slotById.get(slotId))
      .filter((slot): slot is SlotRow => !!slot)
      .map((slot) => buildSlotLabel(slot));

    if (labels.length > 0) return labels.join(", ");
    const slotId = resolveSlotId(student);
    const slot = student.slot_ref || (slotId ? slotById.get(slotId) : null);
    return slot ? buildSlotLabel(slot) : student.slot || "";
  };

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;

    return students.filter((student) =>
      [
        student.full_name,
        student.phone ?? "",
        student.email ?? "",
        getPlanName(student),
        getSlotLabel(student),
        getSeatNumber(student),
      ].some((field) => field.toLowerCase().includes(q)),
    );
  }, [search, students, planById, seatById, slotById, studentSlotIdsById]);

  const ensureSelectedOption = <T extends { id: string }>(
    options: SelectOption[],
    currentId: string,
    source: Map<string, T>,
    labelBuilder: (item: T) => string,
  ) => {
    if (!currentId || options.some((option) => option.value === currentId)) return options;
    const item = source.get(currentId);
    return item ? [{ value: item.id, label: `${labelBuilder(item)} (saved)` }, ...options] : options;
  };

  const planOptions = useMemo(
    () =>
      ensureSelectedOption(
        activePlans.map((plan) => ({ value: plan.id, label: buildPlanLabel(plan) })),
        form.plan_id,
        planById,
        buildPlanLabel,
      ),
    [activePlans, form.plan_id, planById],
  );

  const selectedPlanMeta = form.plan_id ? planById.get(form.plan_id) ?? null : null;
  const planSlotRule = useMemo(() => getPlanSlotRule(selectedPlanMeta, activeSlots), [activeSlots, selectedPlanMeta]);

  const selectedSlotIds = useMemo(
    () => normalizeSelectedSlotIds(form.slot_ids, slotOrder, planSlotRule),
    [form.slot_ids, planSlotRule, slotOrder],
  );

  useEffect(() => {
    if (areStringArraysEqual(form.slot_ids, selectedSlotIds)) return;
    setForm((prev) => {
      if (areStringArraysEqual(prev.slot_ids, selectedSlotIds)) return prev;
      return {
        ...prev,
        seat_id: "",
        slot_ids: selectedSlotIds,
      };
    });
  }, [form.slot_ids, selectedSlotIds]);

  const slotOptions = useMemo(() => {
    const baseOptions = activeSlots.map((slot) => ({ value: slot.id, label: buildSlotLabel(slot) }));
    const optionMap = new Map(baseOptions.map((option) => [option.value, option]));
    const savedOptions = selectedSlotIds
      .filter((slotId) => !optionMap.has(slotId))
      .map((slotId) => slotById.get(slotId))
      .filter((slot): slot is SlotRow => !!slot)
      .map((slot) => ({ value: slot.id, label: `${buildSlotLabel(slot)} (saved)` }));

    return [...savedOptions, ...baseOptions];
  }, [activeSlots, selectedSlotIds, slotById]);

  const selectedSlotsMeta = useMemo(
    () => selectedSlotIds.map((slotId) => slotById.get(slotId)).filter((slot): slot is SlotRow => !!slot),
    [selectedSlotIds, slotById],
  );

  const slotAssignedSummaries = useMemo(() => {
    return selectedSlotIds.map((slotId) => {
      const slotMeta = slotById.get(slotId) ?? null;
      const assignedStudents = students.filter((student) => {
        if (editingStudent && student.id === editingStudent.id) return false;
        const studentSeatId = resolveSeatId(student);
        return !!studentSeatId && getStudentSlotIds(student).includes(slotId) && isStudentCurrentlyActive(student);
      });

      const occupiedSeatIdsForSlot = new Set<string>();
      for (const student of assignedStudents) {
        const studentSeatId = resolveSeatId(student);
        if (studentSeatId) {
          occupiedSeatIdsForSlot.add(studentSeatId);
        }
      }

      const occupiedSeatList = Array.from(occupiedSeatIdsForSlot)
        .map((seatId) => seatById.get(seatId)?.seat_number)
        .filter((value): value is string => !!value)
        .sort(seatSort);

      const slotCapacity = slotMeta?.max_seats ?? (sortedSeats.length || null);
      const remainingCapacity =
        typeof slotCapacity === "number" && slotCapacity > 0 ? Math.max(slotCapacity - assignedStudents.length, 0) : null;

      return {
        assignedStudents,
        occupiedSeatIds: occupiedSeatIdsForSlot,
        occupiedSeatList,
        remainingCapacity,
        slotCapacity,
        slotId,
        slotMeta,
      };
    });
  }, [editingStudent, seatById, sortedSeats.length, selectedSlotIds, slotById, studentSlotIdsById, students]);

  const occupiedSeatIds = useMemo(() => {
    const seatSet = new Set<string>();
    for (const summary of slotAssignedSummaries) {
      for (const seatId of summary.occupiedSeatIds) {
        seatSet.add(seatId);
      }
    }
    return seatSet;
  }, [slotAssignedSummaries]);

  const availableSeats = useMemo(() => {
    if (selectedSlotIds.length === 0) return [];
    return sortedSeats.filter((seat) => !occupiedSeatIds.has(seat.id) || seat.id === form.seat_id);
  }, [form.seat_id, occupiedSeatIds, selectedSlotIds.length, sortedSeats]);

  const seatOptions = useMemo(
    () =>
      ensureSelectedOption(
        availableSeats.map((seat) => ({ value: seat.id, label: seat.seat_number })),
        form.seat_id,
        seatById,
        (seat) => seat.seat_number,
      ),
    [availableSeats, form.seat_id, seatById],
  );

  const occupiedSeatList = useMemo(
    () =>
      Array.from(occupiedSeatIds)
        .map((seatId) => seatById.get(seatId)?.seat_number)
        .filter((value): value is string => !!value)
        .sort(seatSort),
    [occupiedSeatIds, seatById],
  );

  const hasRequiredSlotSelection =
    !!selectedPlanMeta &&
    activeSlots.length > 0 &&
    (planSlotRule.mode === "all"
      ? selectedSlotIds.length === activeSlots.length
      : selectedSlotIds.length >= planSlotRule.requiredSelectionCount && planSlotRule.requiredSelectionCount > 0);

  const slotAssignmentsTableMissing = slotAssignmentsTableAvailable === false;
  const multiSlotPersistenceRequired = planSlotRule.mode !== "single";
  const multiSlotFeatureBlocked = multiSlotPersistenceRequired && slotAssignmentsTableMissing;

  const slotRequirementHint = !selectedPlanMeta
    ? "Select a plan first."
    : multiSlotFeatureBlocked
      ? "Apply the latest database migration to enable multi-slot and full-day seat allocation."
    : activeSlots.length === 0
      ? "Create active slots in Plans & Slots first."
      : planSlotRule.mode === "all"
        ? "All active slots will be assigned automatically for this plan."
        : planSlotRule.mode === "multiple"
          ? `Select ${planSlotRule.requiredSelectionCount} slots for this plan.`
          : "Select 1 slot for this plan.";
  const showSlotSelector = !!selectedPlanMeta && planSlotRule.mode !== "all";
  const showFullDayNotice = !!selectedPlanMeta && planSlotRule.mode === "all";
  const showSeatAvailabilityDetails = selectedSlotIds.length > 0 && planSlotRule.mode !== "all";
  const topFieldGridClass = showSlotSelector ? "grid-cols-1 gap-4 sm:grid-cols-3" : "grid-cols-1 gap-4 sm:grid-cols-2";

  const seatSelectionLoading = studentsLoading || seatsLoading || slotsLoading || slotAssignmentsLoading;

  const syncStudentSlotAssignments = async (studentId: string, nextSlotIds: string[]) => {
    if (!resolvedLibraryId) throw new Error("Library not found for your account.");
    if (slotAssignmentsTableMissing) return;

    const normalizedNextSlotIds = Array.from(new Set(nextSlotIds));
    const { data: currentAssignments, error: currentAssignmentsError } = await supabase
      .from("student_slot_assignments" as any)
      .select("*")
      .eq("student_id", studentId);

    if (currentAssignmentsError) {
      if (isMissingRelationError(currentAssignmentsError, "student_slot_assignments")) {
        setSlotAssignmentsTableAvailable(false);
        return;
      }
      throw currentAssignmentsError;
    }

    const existingAssignments = (currentAssignments ?? []) as StudentSlotAssignmentRow[];
    const existingSlotIds = new Set(existingAssignments.map((assignment) => assignment.slot_id));
    const assignmentsToInsert: StudentSlotAssignmentInsert[] = normalizedNextSlotIds
      .filter((slotId) => !existingSlotIds.has(slotId))
      .map((slotId) => ({
        library_id: resolvedLibraryId,
        slot_id: slotId,
        student_id: studentId,
      }));

    if (assignmentsToInsert.length > 0) {
      const { error: insertAssignmentsError } = await supabase.from("student_slot_assignments" as any).insert(assignmentsToInsert);
      if (insertAssignmentsError) throw insertAssignmentsError;
    }

    const assignmentIdsToDelete = existingAssignments
      .filter((assignment) => !normalizedNextSlotIds.includes(assignment.slot_id))
      .map((assignment) => assignment.id);

    if (assignmentIdsToDelete.length > 0) {
      const { error: deleteAssignmentsError } = await supabase
        .from("student_slot_assignments" as any)
        .delete()
        .in("id", assignmentIdsToDelete);
      if (deleteAssignmentsError) throw deleteAssignmentsError;
    }
  };

  const validateSeatAssignment = async (currentStudentId?: string) => {
    if (!resolvedLibraryId) throw new Error("Library not found for your account.");
    if (!form.seat_id) return;
    if (selectedSlotIds.length === 0) {
      throw new Error("Select the required slot allocation for this plan before choosing a seat.");
    }

    const [{ data: studentsData, error: studentsError }, { data: assignmentsData, error: assignmentsError }] = await Promise.all([
      supabase
        .from("students")
        .select("id, seat_id, seat_number, slot_id, slot, status, expiry_date")
        .eq("library_id", resolvedLibraryId),
      supabase
        .from("student_slot_assignments" as any)
        .select("student_id, slot_id")
        .eq("library_id", resolvedLibraryId),
    ]);

    if (studentsError) throw studentsError;
    if (assignmentsError && !isMissingRelationError(assignmentsError, "student_slot_assignments")) throw assignmentsError;
    if (assignmentsError && isMissingRelationError(assignmentsError, "student_slot_assignments")) {
      setSlotAssignmentsTableAvailable(false);
    }

    const validationStudents = (studentsData ?? []) as StudentSeatValidationRow[];
    const validationAssignments = (assignmentsData ?? []) as Array<Pick<StudentSlotAssignmentRow, "slot_id" | "student_id">>;
    const validationSlotIdsByStudentId = buildStudentSlotIdMap(validationStudents, validationAssignments, resolveSlotId, slotOrder);
    const seatNumber = seatById.get(form.seat_id)?.seat_number || "Selected seat";

    for (const slotId of selectedSlotIds) {
      const slotMeta = slotById.get(slotId) ?? null;
      const slotStudents = validationStudents.filter((student) => {
        if (currentStudentId && student.id === currentStudentId) return false;
        const studentSeatId = resolveSeatId(student);
        return !!studentSeatId && (validationSlotIdsByStudentId.get(student.id) ?? []).includes(slotId) && isStudentCurrentlyActive(student);
      });

      if (slotStudents.some((student) => resolveSeatId(student) === form.seat_id)) {
        throw new Error(`${seatNumber} is already assigned in the ${slotMeta?.name || "selected"} slot.`);
      }

      const slotCapacity = slotMeta?.max_seats ?? (sortedSeats.length || null);
      if (typeof slotCapacity === "number" && slotCapacity > 0 && slotStudents.length + 1 > slotCapacity) {
        throw new Error(`${slotMeta?.name || "Selected"} slot is already full.`);
      }
    }
  };

  const resetDialogState = () => {
    setEditingStudent(null);
    setForm(createInitialForm());
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      resetDialogState();
    }
  };

  const addStudentMutation = useMutation({
    mutationFn: async () => {
      if (!resolvedLibraryId) throw new Error("Library not found for your account.");
      const today = new Date().toISOString().slice(0, 10);
      await validateSeatAssignment();

      const payload: StudentInsert = {
        email: form.email.trim() || null,
        expiry_date: form.expiry_date || null,
        full_name: form.full_name.trim(),
        library_id: resolvedLibraryId,
        phone: form.phone.trim() || null,
        plan: null,
        plan_id: form.plan_id || null,
        seat_id: form.seat_id || null,
        seat_number: null,
        slot: null,
        slot_id: selectedSlotIds[0] || null,
        start_date: form.start_date || today,
        status: form.expiry_date && form.expiry_date < today ? "expired" : "active",
      };

      const { data, error } = await supabase.from("students").insert(payload).select("id").single();
      if (error) throw error;

      try {
        await syncStudentSlotAssignments(data.id, selectedSlotIds);
      } catch (assignmentError) {
        await supabase.from("students").delete().eq("id", data.id);
        throw assignmentError;
      }
    },
    onSuccess: () => {
      setDialogOpen(false);
      resetDialogState();
      queryClient.invalidateQueries({ queryKey: ["students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["student-slot-assignments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-assignments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-qr", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["plans-page-student-count", resolvedLibraryId] });
      toast({ title: "Student added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to add student", description: error.message, variant: "destructive" });
    },
  });

  const updateStudentMutation = useMutation({
    mutationFn: async () => {
      if (!editingStudent) throw new Error("Student context missing.");
      const today = new Date().toISOString().slice(0, 10);
      await validateSeatAssignment(editingStudent.id);

      const payload: StudentUpdate = {
        email: form.email.trim() || null,
        expiry_date: form.expiry_date || null,
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        plan: null,
        plan_id: form.plan_id || null,
        seat_id: form.seat_id || null,
        seat_number: null,
        slot: null,
        slot_id: selectedSlotIds[0] || null,
        start_date: form.start_date || today,
        status: form.expiry_date && form.expiry_date < today ? "expired" : "active",
      };

      const { error } = await supabase.from("students").update(payload).eq("id", editingStudent.id);
      if (error) throw error;
      await syncStudentSlotAssignments(editingStudent.id, selectedSlotIds);
    },
    onSuccess: () => {
      setDialogOpen(false);
      resetDialogState();
      queryClient.invalidateQueries({ queryKey: ["students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["student-slot-assignments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-students", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-assignments", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-qr", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
      queryClient.invalidateQueries({ queryKey: ["plans-page-student-count", resolvedLibraryId] });
      toast({ title: "Student updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Unable to update student", description: error.message, variant: "destructive" });
    },
  });

  const savePending = addStudentMutation.isPending || updateStudentMutation.isPending;
  const saveDisabled =
    !form.full_name.trim() ||
    savePending ||
    (planOptions.length > 0 && !form.plan_id) ||
    multiSlotFeatureBlocked ||
    (!!selectedPlanMeta && activeSlots.length === 0) ||
    (!!selectedPlanMeta && activeSlots.length > 0 && !hasRequiredSlotSelection) ||
    (selectedSlotIds.length > 0 && !form.seat_id);

  const openAddStudent = () => {
    setEditingStudent(null);
    setForm(createInitialForm());
    setDialogOpen(true);
  };

  const handlePlanChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      plan_id: value,
      seat_id: "",
      slot_ids: [],
    }));
  };

  const handleSingleSlotChange = (value: string) => {
    setForm((prev) => ({
      ...prev,
      seat_id: prev.slot_ids[0] === value ? prev.seat_id : "",
      slot_ids: value ? [value] : [],
    }));
  };

  const handleToggleMultiSlot = (slotId: string) => {
    setForm((prev) => {
      const isSelected = prev.slot_ids.includes(slotId);
      if (isSelected) {
        return {
          ...prev,
          seat_id: "",
          slot_ids: prev.slot_ids.filter((value) => value !== slotId),
        };
      }

      const nextSlotIds = normalizeSelectedSlotIds([...prev.slot_ids, slotId], slotOrder, planSlotRule);
      if (nextSlotIds.length === prev.slot_ids.length) {
        toast({
          title: `Only ${planSlotRule.maxSelectableCount} slot${planSlotRule.maxSelectableCount === 1 ? "" : "s"} allowed`,
          description: "8 Hour plans can use a maximum of 2 slots.",
          variant: "destructive",
        });
        return prev;
      }

      return {
        ...prev,
        seat_id: "",
        slot_ids: nextSlotIds,
      };
    });
  };

  const openEditStudent = (student: StudentRecord) => {
    setEditingStudent(student);
    setForm({
      email: student.email || "",
      expiry_date: student.expiry_date || "",
      full_name: student.full_name || "",
      phone: student.phone || "",
      plan_id: resolvePlanId(student) || "",
      seat_id: resolveSeatId(student) || "",
      slot_ids: getStudentSlotIds(student),
      start_date: student.start_date || new Date().toISOString().slice(0, 10),
    });
    setDialogOpen(true);
  };

  const handleExport = () => {
    if (filteredStudents.length === 0) {
      toast({ title: "No students to export", variant: "destructive" });
      return;
    }

    exportToCsv(
      "students",
      filteredStudents.map((student) => ({
        email: student.email ?? "",
        expiry_date: student.expiry_date ?? "",
        name: student.full_name,
        phone: student.phone ?? "",
        plan: getPlanName(student) || "",
        seat: getSeatNumber(student) || "",
        slot: getSlotLabel(student) || "",
        start_date: student.start_date ?? "",
        status: getStatusLabel(student),
      })),
    );
    toast({ title: "Export started" });
  };

  const slotSelectSummary =
    selectedSlotsMeta.length === 0
      ? planSlotRule.mode === "multiple"
        ? `Select ${planSlotRule.requiredSelectionCount} slots`
        : "Select slot"
      : selectedSlotsMeta.length === 1
        ? buildSlotLabel(selectedSlotsMeta[0])
        : `${selectedSlotsMeta.length} slots selected`;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Students</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage all enrolled students</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-primary text-primary-foreground" disabled={!resolvedLibraryId} onClick={openAddStudent}>
                  <Plus className="w-4 h-4 mr-1" /> Add Student
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[560px]">
                <DialogHeader>
                  <DialogTitle className="font-display">{editingStudent ? "Edit Student" : "Add Student"}</DialogTitle>
                </DialogHeader>
                <div className="max-h-[calc(90vh-7rem)] space-y-4 overflow-y-auto pr-1 pt-2">
                  <div className="space-y-2">
                    <Label>Full Name *</Label>
                    <Input
                      value={form.full_name}
                      onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
                      placeholder="Student full name"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phone</Label>
                      <Input
                        value={form.phone}
                        onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                        placeholder="9876543210"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="student@email.com"
                      />
                    </div>
                  </div>
                  <div className={cn("grid", topFieldGridClass)}>
                    <div className="space-y-2">
                      <Label>Plan</Label>
                      <Select value={form.plan_id || undefined} onValueChange={handlePlanChange} disabled={plansLoading || planOptions.length === 0}>
                        <SelectTrigger>
                          <SelectValue placeholder={plansLoading ? "Loading plans..." : "Select plan"} />
                        </SelectTrigger>
                        <SelectContent>
                          {planOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!plansLoading && planOptions.length === 0 ? <p className="text-xs text-muted-foreground">Create an active plan in Plans & Slots first.</p> : null}
                    </div>
                    {showSlotSelector ? (
                      <div className="space-y-2">
                        <Label>{planSlotRule.mode === "multiple" ? "Slots" : "Slot"}</Label>
                        {planSlotRule.mode === "multiple" ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full justify-between font-normal"
                                disabled={slotsLoading || slotOptions.length === 0 || multiSlotFeatureBlocked}
                              >
                                <span className="truncate text-left">{slotsLoading ? "Loading slots..." : slotSelectSummary}</span>
                                <ChevronDown className="h-4 w-4 opacity-60" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] space-y-3">
                              <div>
                                <p className="text-sm font-medium text-foreground">Select 2 slots</p>
                                <p className="text-xs text-muted-foreground">8 Hour plans can use any 2 active slots.</p>
                              </div>
                              <div className="space-y-2">
                                {slotOptions.map((option) => {
                                  const checked = selectedSlotIds.includes(option.value);
                                  const disableUnchecked = !checked && selectedSlotIds.length >= planSlotRule.maxSelectableCount;
                                  return (
                                    <label
                                      key={option.value}
                                      className={cn(
                                        "flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 transition-colors",
                                        checked ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40",
                                        disableUnchecked && "cursor-not-allowed opacity-60",
                                      )}
                                    >
                                      <Checkbox checked={checked} disabled={disableUnchecked} onCheckedChange={() => handleToggleMultiSlot(option.value)} />
                                      <span className="text-sm text-foreground">{option.label}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <Select value={selectedSlotIds[0] || undefined} onValueChange={handleSingleSlotChange} disabled={slotsLoading || slotOptions.length === 0 || multiSlotFeatureBlocked}>
                            <SelectTrigger>
                              <SelectValue placeholder={slotsLoading ? "Loading slots..." : "Select slot"} />
                            </SelectTrigger>
                            <SelectContent>
                              {slotOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <p className="text-xs text-muted-foreground">{slotRequirementHint}</p>
                        {!slotsLoading && slotOptions.length === 0 ? <p className="text-xs text-muted-foreground">Create an active slot in Plans & Slots first.</p> : null}
                        {planSlotRule.mode === "multiple" && selectedSlotsMeta.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedSlotsMeta.map((slot) => (
                              <span key={slot.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
                                <Check className="h-3 w-3" />
                                {slot.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      <Label>Available Seat</Label>
                      <Select
                        value={form.seat_id || undefined}
                        onValueChange={(value) => setForm((prev) => ({ ...prev, seat_id: value }))}
                        disabled={multiSlotFeatureBlocked || !hasRequiredSlotSelection || seatSelectionLoading || seatOptions.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              !selectedPlanMeta
                                ? "Select plan first"
                                : multiSlotFeatureBlocked
                                  ? "Apply latest DB migration first"
                                : !hasRequiredSlotSelection
                                  ? activeSlots.length === 0
                                    ? "No active slots available"
                                    : planSlotRule.mode === "multiple"
                                    ? `Select ${planSlotRule.requiredSelectionCount} slots first`
                                    : planSlotRule.mode === "all"
                                      ? "Slots auto-assigned"
                                      : "Select slot first"
                                : seatSelectionLoading
                                  ? "Loading seats..."
                                  : seatOptions.length === 0
                                    ? "No seats available"
                                    : "Choose seat"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {seatOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {!selectedPlanMeta ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                      Select a plan first to load slot allocation rules.
                    </div>
                  ) : null}

                  {showFullDayNotice ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
                      <p className="text-sm font-medium text-emerald-950">
                        Full Day Plan{" "}
                        <span className="font-normal text-emerald-900">-</span>{" "}
                        {multiSlotFeatureBlocked
                          ? "apply the latest database migration to enable all-slot assignment."
                          : activeSlots.length > 0
                            ? "all active slots will be assigned automatically."
                            : "no active slots available."}
                      </p>
                      {activeSlots.length > 0 && !multiSlotFeatureBlocked ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {activeSlots.map((slot) => (
                            <Badge key={slot.id} variant="secondary" className="rounded-full border border-emerald-200 bg-white/80 text-emerald-900">
                              {slot.name}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {showSeatAvailabilityDetails ? (
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground space-y-3">
                      {slotAssignedSummaries.map((summary) => (
                        <div key={summary.slotId} className="space-y-1">
                          <p className="font-medium text-foreground">{summary.slotMeta ? buildSlotLabel(summary.slotMeta) : "Selected slot"}</p>
                          <p>
                            Seats already assigned in this slot: {summary.assignedStudents.length}
                            {typeof summary.remainingCapacity === "number" ? ` | Remaining capacity: ${summary.remainingCapacity}` : ""}
                          </p>
                          {summary.occupiedSeatList.length > 0 ? (
                            <p>
                              Occupied seats: {summary.occupiedSeatList.slice(0, 10).join(", ")}
                              {summary.occupiedSeatList.length > 10 ? ` +${summary.occupiedSeatList.length - 10} more` : ""}
                            </p>
                          ) : (
                            <p>Occupied seats: None</p>
                          )}
                        </div>
                      ))}
                      <p>
                        {seatOptions.length > 0
                          ? `${seatOptions.length} free seat option${seatOptions.length === 1 ? "" : "s"} ready for selection across the selected slot allocation.`
                          : "No free seats are available across the selected slot allocation."}
                      </p>
                      {occupiedSeatList.length > 0 ? (
                        <p>
                          Combined occupied seats: {occupiedSeatList.slice(0, 12).join(", ")}
                          {occupiedSeatList.length > 12 ? ` +${occupiedSeatList.length - 12} more` : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Start Date</Label>
                      <Input type="date" value={form.start_date} onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Expiry Date</Label>
                      <Input type="date" value={form.expiry_date} onChange={(e) => setForm((prev) => ({ ...prev, expiry_date: e.target.value }))} />
                    </div>
                  </div>
                  <Button className="w-full" disabled={saveDisabled} onClick={() => (editingStudent ? updateStudentMutation.mutate() : addStudentMutation.mutate())}>
                    {savePending ? "Saving..." : editingStudent ? "Update Student" : "Save Student"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search students..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Seat</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentLibraryLoading || fallbackLoading || studentsLoading || slotAssignmentsLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Loading students...
                    </TableCell>
                  </TableRow>
                ) : !resolvedLibraryId ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      Library not linked to this user. Please check `user_roles` setup.
                    </TableCell>
                  </TableRow>
                ) : filteredStudents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No students found.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredStudents.map((student) => {
                    const status = getStatusLabel(student);
                    const seatNumber = getSeatNumber(student);
                    const planName = getPlanName(student);
                    const slotLabel = getSlotLabel(student);

                    return (
                      <TableRow key={student.id} className="hover:bg-muted/50">
                        <TableCell className="font-medium text-foreground">{student.full_name}</TableCell>
                        <TableCell className="text-muted-foreground">{student.phone || "-"}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded">{seatNumber || "-"}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{planName || "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{slotLabel || "-"}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {student.expiry_date ? format(new Date(`${student.expiry_date}T00:00:00`), "MMM dd, yyyy") : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(status)}>{status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => openEditStudent(student)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentsPage;
