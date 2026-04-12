import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatCompactTimeLabel, formatTimeLabel, isStudentCurrentlyActive, normalizeLookupText, normalizeSeatId, seatSort } from "@/lib/seatUtils";
import { STUDENT_GENDER_OPTIONS, type StudentGender } from "@/lib/studentGender";
import { getStudentPhotoValidationError } from "@/lib/studentPhotos";
import {
  areStringArraysEqual,
  buildSlotOrder,
  buildStudentSlotIdMap,
  getPlanSlotRule,
  isMissingRelationError,
  normalizeSelectedSlotIds,
} from "@/lib/studentSlotUtils";
import { cn } from "@/lib/utils";

type AddStudentDialogProps = {
  disabled?: boolean;
  libraryId: string | null;
  onPhotoUploadRequest?: (payload: { file: File; studentId: string }) => void;
};

type StudentRow = Database["public"]["Tables"]["students"]["Row"];
type StudentInsert = Database["public"]["Tables"]["students"]["Insert"];
type PlanRow = Database["public"]["Tables"]["plans"]["Row"];
type SlotRow = Database["public"]["Tables"]["time_slots"]["Row"];
type SeatRow = Database["public"]["Tables"]["seats"]["Row"];
type StudentSeatValidationRow = Pick<StudentRow, "expiry_date" | "id" | "seat_id" | "seat_number" | "slot_id" | "slot" | "status">;
type StudentSlotAssignmentRow = {
  created_at: string;
  id: string;
  library_id: string;
  slot_id: string;
  student_id: string;
  updated_at: string;
};
type StudentSlotAssignmentInsert = Pick<StudentSlotAssignmentRow, "library_id" | "slot_id" | "student_id">;
type StudentFormState = {
  email: string;
  expiry_date: string;
  full_name: string;
  gender: StudentGender | "";
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
  gender: "",
  phone: "",
  plan_id: "",
  seat_id: "",
  slot_ids: [],
  start_date: new Date().toISOString().slice(0, 10),
});

const buildPlanLabel = (plan: Pick<PlanRow, "id" | "name" | "price">) => `${plan.name} - Rs ${Number(plan.price).toLocaleString("en-IN")}`;

const buildSlotLabel = (slot: Pick<SlotRow, "end_time" | "name" | "start_time">) =>
  `${slot.name} (${formatTimeLabel(slot.start_time)} - ${formatTimeLabel(slot.end_time)})`;

const buildSlotLookupKeys = (slot: Pick<SlotRow, "end_time" | "name" | "start_time">) => {
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

const isStudentSchemaShapeError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /could not find the '.*' column|column .* does not exist|schema cache/i.test(String(error?.message ?? ""));

const AddStudentDialog = ({ disabled, libraryId, onPhotoUploadRequest }: AddStudentDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StudentFormState>(createInitialForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [slotAssignmentsTableAvailable, setSlotAssignmentsTableAvailable] = useState<boolean | null>(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(
    () => () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    },
    [photoPreviewUrl],
  );

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ["students-form-plans", libraryId],
    queryFn: async (): Promise<PlanRow[]> => {
      if (!libraryId) return [];

      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("library_id", libraryId)
        .order("price", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!libraryId,
    staleTime: 60_000,
  });

  const { data: slots = [], isLoading: slotsLoading } = useQuery({
    queryKey: ["students-form-slots", libraryId],
    queryFn: async (): Promise<SlotRow[]> => {
      if (!libraryId) return [];

      const { data, error } = await supabase
        .from("time_slots")
        .select("*")
        .eq("library_id", libraryId)
        .order("start_time", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!libraryId,
    staleTime: 60_000,
  });

  const { data: seats = [], isLoading: seatsLoading } = useQuery({
    queryKey: ["students-form-seats", libraryId],
    queryFn: async (): Promise<SeatRow[]> => {
      if (!libraryId) return [];

      const { data, error } = await supabase
        .from("seats")
        .select("*")
        .eq("library_id", libraryId)
        .order("seat_index", { ascending: true })
        .order("seat_number", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!libraryId,
    staleTime: 60_000,
  });

  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ["students-form-students", libraryId],
    queryFn: async (): Promise<StudentSeatValidationRow[]> => {
      if (!libraryId) return [];

      const { data, error } = await supabase
        .from("students")
        .select("expiry_date, id, seat_id, seat_number, slot_id, slot, status")
        .eq("library_id", libraryId);

      if (error) throw error;
      return (data ?? []) as StudentSeatValidationRow[];
    },
    enabled: open && !!libraryId,
    staleTime: 15_000,
  });

  const { data: slotAssignments = [], isLoading: slotAssignmentsLoading } = useQuery({
    queryKey: ["students-form-slot-assignments", libraryId],
    queryFn: async (): Promise<StudentSlotAssignmentRow[]> => {
      if (!libraryId) return [];

      const { data, error } = await supabase
        .from("student_slot_assignments" as never)
        .select("*")
        .eq("library_id", libraryId);

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
    enabled: open && !!libraryId,
    staleTime: 15_000,
  });

  const activePlans = useMemo(() => plans.filter((plan) => plan.is_active), [plans]);
  const activeSlots = useMemo(() => slots.filter((slot) => slot.is_active), [slots]);
  const sortedSeats = useMemo(() => [...seats].sort((a, b) => seatSort(a.seat_number, b.seat_number)), [seats]);

  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots]);
  const slotOrder = useMemo(() => buildSlotOrder(slots), [slots]);
  const seatById = useMemo(() => new Map(sortedSeats.map((seat) => [seat.id, seat])), [sortedSeats]);
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

  const resolveSlotId = useCallback(
    (student: Pick<StudentRow, "slot" | "slot_id">) => student.slot_id || slotIdByLookup.get(normalizeLookupText(student.slot)) || null,
    [slotIdByLookup],
  );

  const resolveSeatId = useCallback(
    (student: Pick<StudentRow, "seat_id" | "seat_number">) => student.seat_id || seatIdByLookup.get(normalizeSeatId(student.seat_number)) || null,
    [seatIdByLookup],
  );

  const studentSlotIdsById = useMemo(
    () => buildStudentSlotIdMap(students, slotAssignments, resolveSlotId, slotOrder),
    [resolveSlotId, slotAssignments, slotOrder, students],
  );

  const getStudentSlotIds = useCallback(
    (student: Pick<StudentRow, "id" | "slot" | "slot_id">) => studentSlotIdsById.get(student.id) ?? [],
    [studentSlotIdsById],
  );

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

    setForm((previous) => {
      if (areStringArraysEqual(previous.slot_ids, selectedSlotIds)) return previous;
      return {
        ...previous,
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

  const slotAssignedSummaries = useMemo(
    () =>
      selectedSlotIds.map((slotId) => {
        const slotMeta = slotById.get(slotId) ?? null;
        const assignedStudents = students.filter((student) => {
          const studentSeatId = resolveSeatId(student);
          return !!studentSeatId && getStudentSlotIds(student).includes(slotId) && isStudentCurrentlyActive(student);
        });

        const occupiedSeatIds = new Set<string>();
        for (const student of assignedStudents) {
          const studentSeatId = resolveSeatId(student);
          if (studentSeatId) {
            occupiedSeatIds.add(studentSeatId);
          }
        }

        const occupiedSeatList = Array.from(occupiedSeatIds)
          .map((seatId) => seatById.get(seatId)?.seat_number)
          .filter((value): value is string => !!value)
          .sort(seatSort);

        const slotCapacity = slotMeta?.max_seats ?? (sortedSeats.length || null);
        const remainingCapacity =
          typeof slotCapacity === "number" && slotCapacity > 0 ? Math.max(slotCapacity - assignedStudents.length, 0) : null;

        return {
          assignedStudents,
          occupiedSeatIds,
          occupiedSeatList,
          remainingCapacity,
          slotId,
          slotMeta,
        };
      }),
    [getStudentSlotIds, resolveSeatId, seatById, selectedSlotIds, slotById, sortedSeats.length, students],
  );

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

  const slotSelectSummary =
    selectedSlotsMeta.length === 0
      ? planSlotRule.mode === "multiple"
        ? `Select ${planSlotRule.requiredSelectionCount} slots`
        : "Select slot"
      : selectedSlotsMeta.length === 1
        ? buildSlotLabel(selectedSlotsMeta[0])
        : `${selectedSlotsMeta.length} slots selected`;

  const resetDialogState = () => {
    setForm(createInitialForm());
    setPhotoFile(null);
    setPhotoPreviewUrl("");
    setPhotoInputKey((current) => current + 1);
    setSubmitAttempted(false);
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      resetDialogState();
    }
  };

  const syncStudentSlotAssignments = async (studentId: string, nextSlotIds: string[]) => {
    if (!libraryId) throw new Error("Library not found for your account.");
    if (slotAssignmentsTableMissing) return;

    const normalizedNextSlotIds = Array.from(new Set(nextSlotIds));
    const { data: currentAssignments, error: currentAssignmentsError } = await supabase
      .from("student_slot_assignments" as never)
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
        library_id: libraryId,
        slot_id: slotId,
        student_id: studentId,
      }));

    if (assignmentsToInsert.length > 0) {
      const { error: insertAssignmentsError } = await supabase.from("student_slot_assignments" as never).insert(assignmentsToInsert as never);
      if (insertAssignmentsError) throw insertAssignmentsError;
    }

    const assignmentIdsToDelete = existingAssignments
      .filter((assignment) => !normalizedNextSlotIds.includes(assignment.slot_id))
      .map((assignment) => assignment.id);

    if (assignmentIdsToDelete.length > 0) {
      const { error: deleteAssignmentsError } = await supabase
        .from("student_slot_assignments" as never)
        .delete()
        .in("id", assignmentIdsToDelete);
      if (deleteAssignmentsError) throw deleteAssignmentsError;
    }
  };

  const validateSeatAssignment = async () => {
    if (!libraryId) throw new Error("Library not found for your account.");
    if (!form.seat_id) return;
    if (selectedSlotIds.length === 0) {
      throw new Error("Select the required slot allocation for this plan before choosing a seat.");
    }

    const [{ data: studentsData, error: studentsError }, { data: assignmentsData, error: assignmentsError }] = await Promise.all([
      supabase
        .from("students")
        .select("expiry_date, id, seat_id, seat_number, slot_id, slot, status")
        .eq("library_id", libraryId),
      supabase
        .from("student_slot_assignments" as never)
        .select("student_id, slot_id")
        .eq("library_id", libraryId),
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

  const addStudentMutation = useMutation({
    mutationFn: async (): Promise<{ id: string; usedLegacySchema: boolean }> => {
      if (!libraryId) throw new Error("Library not found for your account.");
      if (!form.gender) throw new Error("Select a gender before saving this student.");

      const today = new Date().toISOString().slice(0, 10);
      await validateSeatAssignment();

      const payload: StudentInsert = {
        email: form.email.trim() || null,
        expiry_date: form.expiry_date || null,
        full_name: form.full_name.trim(),
        gender: form.gender || null,
        library_id: libraryId,
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

      let usedLegacySchema = false;
      let data: { id: string } | null = null;

      const createResult = await supabase.from("students").insert(payload).select("id").single();

      if (createResult.error) {
        if (!isStudentSchemaShapeError(createResult.error)) {
          throw createResult.error;
        }

        usedLegacySchema = true;
        const { gender: _gender, ...legacyPayload } = payload;
        const legacyResult = await supabase.from("students").insert(legacyPayload).select("id").single();
        if (legacyResult.error) throw legacyResult.error;
        data = legacyResult.data;
      } else {
        data = createResult.data;
      }

      try {
        await syncStudentSlotAssignments(data.id, selectedSlotIds);
      } catch (assignmentError) {
        await supabase.from("students").delete().eq("id", data.id);
        throw assignmentError;
      }

      return { id: data.id, usedLegacySchema };
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to add student",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: ({ id, usedLegacySchema }) => {
      const queuedPhoto = photoFile;

      setOpen(false);
      resetDialogState();
      queryClient.invalidateQueries({ queryKey: ["students-dashboard-table"] });
      queryClient.invalidateQueries({ queryKey: ["students-form-students", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-form-slot-assignments", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-students", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-assignments", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["seat-map-slot-overview", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["students-qr", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-overview", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["analytics-overview", libraryId] });
      queryClient.invalidateQueries({ queryKey: ["plans-page-student-count", libraryId] });

      if (queuedPhoto && onPhotoUploadRequest) {
        onPhotoUploadRequest({
          file: queuedPhoto,
          studentId: id,
        });
      }

      toast({
        title: queuedPhoto ? "Student added, photo uploading in background" : "Student added successfully",
        description: usedLegacySchema ? "This database is on an older student schema, so some new fields will stay disabled until migrations are applied." : undefined,
      });
    },
  });

  const saveDisabled =
    !form.full_name.trim() ||
    addStudentMutation.isPending ||
    (planOptions.length > 0 && !form.plan_id) ||
    multiSlotFeatureBlocked ||
    (!!selectedPlanMeta && activeSlots.length === 0) ||
    (!!selectedPlanMeta && activeSlots.length > 0 && !hasRequiredSlotSelection) ||
    (selectedSlotIds.length > 0 && !form.seat_id);

  const genderError = submitAttempted && !form.gender;

  const handlePlanChange = (value: string) => {
    setForm((previous) => ({
      ...previous,
      plan_id: value,
      seat_id: "",
      slot_ids: [],
    }));
  };

  const handleSingleSlotChange = (value: string) => {
    setForm((previous) => ({
      ...previous,
      seat_id: previous.slot_ids[0] === value ? previous.seat_id : "",
      slot_ids: value ? [value] : [],
    }));
  };

  const handleToggleMultiSlot = (slotId: string) => {
    setForm((previous) => {
      const isSelected = previous.slot_ids.includes(slotId);
      if (isSelected) {
        return {
          ...previous,
          seat_id: "",
          slot_ids: previous.slot_ids.filter((value) => value !== slotId),
        };
      }

      const nextSlotIds = normalizeSelectedSlotIds([...previous.slot_ids, slotId], slotOrder, planSlotRule);
      if (nextSlotIds.length === previous.slot_ids.length) {
        toast({
          title: `Only ${planSlotRule.maxSelectableCount} slot${planSlotRule.maxSelectableCount === 1 ? "" : "s"} allowed`,
          description: "8 Hour plans can use a maximum of 2 slots.",
          variant: "destructive",
        });
        return previous;
      }

      return {
        ...previous,
        seat_id: "",
        slot_ids: nextSlotIds,
      };
    });
  };

  const handlePhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validationError = getStudentPhotoValidationError(file);
    if (validationError) {
      toast({
        title: "Invalid photo",
        description: validationError,
        variant: "destructive",
      });
      setPhotoInputKey((current) => current + 1);
      return;
    }

    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }

    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const removeSelectedPhoto = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(null);
    setPhotoPreviewUrl("");
    setPhotoInputKey((current) => current + 1);
  };

  const handleSave = () => {
    setSubmitAttempted(true);
    if (!form.gender) return;
    addStudentMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" className="rounded-2xl" disabled={disabled || !libraryId}>
          <Plus className="h-4 w-4" />
          Add Student
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="font-display">Add Student</DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(90vh-7rem)] space-y-4 overflow-y-auto pr-1 pt-2">
          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input
              value={form.full_name}
              onChange={(event) => setForm((previous) => ({ ...previous, full_name: event.target.value }))}
              placeholder="Student full name"
            />
          </div>

          <div className="space-y-3">
            <Label>Gender *</Label>
            <RadioGroup
              value={form.gender}
              onValueChange={(value) => {
                setSubmitAttempted(false);
                setForm((previous) => ({ ...previous, gender: value as StudentGender }));
              }}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {STUDENT_GENDER_OPTIONS.map((option) => {
                const inputId = `student-gender-${option.value}`;

                return (
                  <label
                    key={option.value}
                    htmlFor={inputId}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                      form.gender === option.value ? "border-primary bg-primary/5" : "border-border/70 hover:bg-muted/40",
                      genderError && "border-destructive/60",
                    )}
                  >
                    <RadioGroupItem id={inputId} value={option.value} />
                    <span className="text-sm font-medium text-foreground">{option.label}</span>
                  </label>
                );
              })}
            </RadioGroup>
            {genderError ? <p className="text-xs font-medium text-destructive">Please select a gender before saving this student.</p> : null}
          </div>

          <div className="space-y-3">
            <Label htmlFor="student-photo-upload">Student Photo</Label>
            <Input key={photoInputKey} id="student-photo-upload" type="file" accept="image/*" onChange={handlePhotoChange} />
            <p className="text-xs text-muted-foreground">Upload a JPG or PNG up to 2MB. We compress it automatically for fast table loading.</p>
            {photoPreviewUrl ? (
              <div className="flex items-center gap-4 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
                <img
                  src={photoPreviewUrl}
                  alt="Student preview"
                  className="h-20 w-20 rounded-2xl object-cover ring-1 ring-border/70"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{photoFile?.name || "Selected photo"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {photoFile ? `${(photoFile.size / 1024 / 1024).toFixed(2)} MB before compression` : "Preview ready"}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={removeSelectedPhoto}>
                  Remove
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))}
                placeholder="9876543210"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
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
              {!plansLoading && planOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Create an active plan in Plans & Slots first.</p>
              ) : null}
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
                  <Select
                    value={selectedSlotIds[0] || undefined}
                    onValueChange={handleSingleSlotChange}
                    disabled={slotsLoading || slotOptions.length === 0 || multiSlotFeatureBlocked}
                  >
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
                {!slotsLoading && slotOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Create an active slot in Plans & Slots first.</p>
                ) : null}
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
                onValueChange={(value) => setForm((previous) => ({ ...previous, seat_id: value }))}
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
                Full Day Plan <span className="font-normal text-emerald-900">-</span>{" "}
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
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
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
              <Input type="date" value={form.start_date} onChange={(event) => setForm((previous) => ({ ...previous, start_date: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Expiry Date</Label>
              <Input type="date" value={form.expiry_date} onChange={(event) => setForm((previous) => ({ ...previous, expiry_date: event.target.value }))} />
            </div>
          </div>

          <Button className="w-full" disabled={saveDisabled} onClick={handleSave}>
            {addStudentMutation.isPending ? "Saving..." : "Save Student"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddStudentDialog;
