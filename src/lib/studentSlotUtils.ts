import { normalizeLookupText } from "@/lib/seatUtils";

export type SlotSelectionMode = "single" | "multiple" | "all";

export type SlotAssignmentLike = {
  student_id: string;
  slot_id: string;
};

export type SlotLookupLike = {
  id: string;
};

export type StudentSlotLike = {
  id: string;
  slot: string | null;
  slot_id: string | null;
};

export type PlanLike = {
  duration_hours: number;
  name: string | null;
};

export type PlanSlotRule = {
  autoAssignedSlotIds: string[];
  maxSelectableCount: number;
  mode: SlotSelectionMode;
  requiredSelectionCount: number;
};

type PostgrestErrorLike = {
  code?: string | null;
  details?: string | null;
  message?: string | null;
};

export const dedupeStringArray = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

export const areStringArraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const buildSlotOrder = <T extends SlotLookupLike>(slots: T[]) =>
  new Map(slots.map((slot, index) => [slot.id, index]));

export const sortSlotIds = (slotIds: string[], slotOrder: Map<string, number>) =>
  dedupeStringArray(slotIds).sort((a, b) => (slotOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (slotOrder.get(b) ?? Number.MAX_SAFE_INTEGER));

export const buildStudentSlotIdMap = <T extends StudentSlotLike>(
  students: T[],
  assignments: SlotAssignmentLike[],
  resolveSlotId: (student: Pick<T, "slot" | "slot_id">) => string | null,
  slotOrder: Map<string, number>,
) => {
  const map = new Map<string, string[]>();

  for (const assignment of assignments) {
    const current = map.get(assignment.student_id) ?? [];
    current.push(assignment.slot_id);
    map.set(assignment.student_id, current);
  }

  for (const student of students) {
    if (map.has(student.id)) continue;
    const fallbackSlotId = resolveSlotId(student);
    if (fallbackSlotId) {
      map.set(student.id, [fallbackSlotId]);
    }
  }

  for (const [studentId, slotIds] of map.entries()) {
    map.set(studentId, sortSlotIds(slotIds, slotOrder));
  }

  return map;
};

export const getPlanSlotRule = <TSlot extends SlotLookupLike>(
  plan: PlanLike | null,
  activeSlots: TSlot[],
): PlanSlotRule => {
  if (!plan) {
    return {
      autoAssignedSlotIds: [],
      maxSelectableCount: 1,
      mode: "single",
      requiredSelectionCount: 0,
    };
  }

  const totalActiveSlots = activeSlots.length;
  const normalizedPlanName = normalizeLookupText(plan.name);
  const isFullDay =
    normalizedPlanName.includes("fullday") ||
    normalizedPlanName.includes("allday") ||
    (totalActiveSlots > 0 && plan.duration_hours >= totalActiveSlots * 4);

  if (isFullDay) {
    return {
      autoAssignedSlotIds: activeSlots.map((slot) => slot.id),
      maxSelectableCount: totalActiveSlots,
      mode: "all",
      requiredSelectionCount: totalActiveSlots,
    };
  }

  if (plan.duration_hours >= 8) {
    const slotCount = Math.min(2, totalActiveSlots);
    return {
      autoAssignedSlotIds: [],
      maxSelectableCount: slotCount,
      mode: "multiple",
      requiredSelectionCount: slotCount,
    };
  }

  const slotCount = Math.min(1, totalActiveSlots);
  return {
    autoAssignedSlotIds: [],
    maxSelectableCount: slotCount,
    mode: "single",
    requiredSelectionCount: slotCount,
  };
};

export const normalizeSelectedSlotIds = (
  slotIds: string[],
  slotOrder: Map<string, number>,
  rule: PlanSlotRule,
) => {
  if (rule.mode === "all") {
    return sortSlotIds(rule.autoAssignedSlotIds, slotOrder);
  }

  return sortSlotIds(slotIds.filter((slotId) => slotOrder.has(slotId)), slotOrder).slice(0, rule.maxSelectableCount || 0);
};

export const isMissingRelationError = (error: unknown, relationName: string) => {
  if (!error || typeof error !== "object") return false;

  const { code, details, message } = error as PostgrestErrorLike;
  const haystack = `${message || ""} ${details || ""}`.toLowerCase();
  const normalizedRelation = relationName.toLowerCase();

  return code === "PGRST205" || haystack.includes(normalizedRelation) || haystack.includes("schema cache");
};
