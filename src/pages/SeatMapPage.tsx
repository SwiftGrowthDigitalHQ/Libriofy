import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import SeatGrid, { type SeatItem, type SeatSlotKey, type SeatSlotStatus } from "@/components/dashboard/SeatGrid";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatTimeLabel, getTimeRangeFromSlot, isStudentCurrentlyActive, normalizeLookupText, seatSort } from "@/lib/seatUtils";
import { buildSlotOrder, buildStudentSlotIdMap, isMissingRelationError } from "@/lib/studentSlotUtils";
import { cn } from "@/lib/utils";

type TimeSlotRow = Pick<Database["public"]["Tables"]["time_slots"]["Row"], "end_time" | "id" | "is_active" | "max_seats" | "name" | "start_time">;
type SeatRow = Pick<Database["public"]["Tables"]["seats"]["Row"], "id" | "seat_index" | "seat_number">;
type StudentSeatRow = Pick<Database["public"]["Tables"]["students"]["Row"], "expiry_date" | "full_name" | "id" | "seat_id" | "slot" | "slot_id" | "status">;
type StudentSlotAssignmentRow = {
  created_at: string;
  id: string;
  library_id: string;
  slot_id: string;
  student_id: string;
  updated_at: string;
};

type SlotOverviewItem = {
  availableSeats: number;
  id: string;
  occupiedSeats: number;
  timeLabel: string;
  totalSeats: number;
  totalSeatsLabel: string;
  name: string;
};

const seatSlotAssignmentOrder: SeatSlotKey[] = ["morning", "forenoon", "afternoon", "evening"];
const seatSlotLayout = [
  { key: "forenoon", label: "Forenoon", shortLabel: "F" },
  { key: "afternoon", label: "Afternoon", shortLabel: "A" },
  { key: "morning", label: "Morning", shortLabel: "M" },
  { key: "evening", label: "Evening", shortLabel: "E" },
] as const satisfies ReadonlyArray<{ key: SeatSlotKey; label: string; shortLabel: string }>;

const slotAliases: Record<SeatSlotKey, string[]> = {
  morning: ["morning"],
  forenoon: ["forenoon"],
  afternoon: ["afternoon"],
  evening: ["evening"],
};

const summarizeValue = (values: string[]) => {
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return `${values[0]} +${values.length - 1}`;
};

const buildSlotRangeLabel = (slot: Pick<TimeSlotRow, "end_time" | "start_time">) => `${formatTimeLabel(slot.start_time)} - ${formatTimeLabel(slot.end_time)}`;

const resolveSeatSlotKey = (slot: Pick<TimeSlotRow, "end_time" | "name" | "start_time">, assignedKeys: Set<SeatSlotKey>): SeatSlotKey | null => {
  const normalizedName = normalizeLookupText(slot.name);
  const matchedByName = seatSlotAssignmentOrder.find((key) => !assignedKeys.has(key) && slotAliases[key].some((alias) => normalizedName.includes(alias)));
  if (matchedByName) return matchedByName;

  const slotRange = getTimeRangeFromSlot(slot.start_time, slot.end_time);
  if (slotRange) {
    const preferredKey: SeatSlotKey =
      slotRange.start < 10 * 60 ? "morning" : slotRange.start < 14 * 60 ? "forenoon" : slotRange.start < 18 * 60 ? "afternoon" : "evening";
    if (!assignedKeys.has(preferredKey)) {
      return preferredKey;
    }
  }

  return seatSlotAssignmentOrder.find((key) => !assignedKeys.has(key)) ?? null;
};

const SeatMapPage = () => {
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();
  const [selectedSlot, setSelectedSlot] = useState("all");
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

  const { data: slots = [], isLoading: slotsLoading } = useQuery({
    queryKey: ["seat-map-slots", resolvedLibraryId],
    queryFn: async (): Promise<TimeSlotRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("time_slots")
        .select("id, name, start_time, end_time, max_seats, is_active")
        .eq("library_id", resolvedLibraryId)
        .eq("is_active", true)
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 30000,
  });

  const { data: seats = [], isLoading: seatsLoading } = useQuery({
    queryKey: ["seat-map-seats", resolvedLibraryId],
    queryFn: async (): Promise<SeatRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("seats")
        .select("id, seat_number, seat_index")
        .eq("library_id", resolvedLibraryId)
        .order("seat_index", { ascending: true })
        .order("seat_number", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 30000,
  });

  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ["seat-map-students", resolvedLibraryId],
    queryFn: async (): Promise<StudentSeatRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, seat_id, slot, slot_id, status, expiry_date")
        .eq("library_id", resolvedLibraryId)
        .not("seat_id", "is", null)
        .not("slot_id", "is", null);
      if (error) throw error;
      return (data ?? []) as StudentSeatRow[];
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 10000,
  });

  const { data: slotAssignments = [], isLoading: slotAssignmentsLoading } = useQuery({
    queryKey: ["seat-map-slot-assignments", resolvedLibraryId],
    queryFn: async (): Promise<StudentSlotAssignmentRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error } = await supabase
        .from("student_slot_assignments")
        .select("*")
        .eq("library_id", resolvedLibraryId)
        .returns<StudentSlotAssignmentRow[]>();
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
    refetchInterval: 10000,
  });

  const selectedSlotMeta = useMemo(() => slots.find((slot) => slot.id === selectedSlot) ?? null, [selectedSlot, slots]);
  const orderedSeats = useMemo(() => [...seats].sort((a, b) => seatSort(a.seat_number, b.seat_number)), [seats]);
  const totalSeatCount = orderedSeats.length;
  const slotOrder = useMemo(() => buildSlotOrder(slots), [slots]);
  const slotBySeatPosition = useMemo(() => {
    const assignments = new Map<SeatSlotKey, TimeSlotRow>();
    const assignedKeys = new Set<SeatSlotKey>();

    for (const slot of slots) {
      const slotKey = resolveSeatSlotKey(slot, assignedKeys);
      if (!slotKey) continue;
      assignments.set(slotKey, slot);
      assignedKeys.add(slotKey);
    }

    return assignments;
  }, [slots]);

  const slotPositionById = useMemo(
    () => new Map<string, SeatSlotKey>(Array.from(slotBySeatPosition.entries()).map(([slotKey, slot]) => [slot.id, slotKey])),
    [slotBySeatPosition],
  );

  const studentSlotIdsById = useMemo(
    () => buildStudentSlotIdMap(students, slotAssignments, (student) => student.slot_id || null, slotOrder),
    [slotAssignments, slotOrder, students],
  );
  const slotAssignmentsTableMissing = slotAssignmentsTableAvailable === false;

  const slotOverview = useMemo((): SlotOverviewItem[] => {
    return slots.map((slot) => {
      const occupiedSeatIds = new Set<string>();

      for (const student of students) {
        if (!student.seat_id || !isStudentCurrentlyActive(student)) continue;
        if (!(studentSlotIdsById.get(student.id) ?? []).includes(slot.id)) continue;
        occupiedSeatIds.add(student.seat_id);
      }

      const occupiedSeats = occupiedSeatIds.size;
      const totalSeats = totalSeatCount || slot.max_seats || 0;
      return {
        availableSeats: Math.max(totalSeats - occupiedSeats, 0),
        id: slot.id,
        name: slot.name,
        occupiedSeats,
        timeLabel: buildSlotRangeLabel(slot),
        totalSeats,
        totalSeatsLabel: totalSeats === 1 ? "seat" : "seats",
      };
    });
  }, [slots, students, totalSeatCount]);

  const seatItems = useMemo((): SeatItem[] => {
    const bookingsBySeatAndSlot = new Map<string, string[]>();

    for (const student of students) {
      if (!student.seat_id || !isStudentCurrentlyActive(student)) continue;
      for (const slotId of studentSlotIdsById.get(student.id) ?? []) {
        const slotKey = slotPositionById.get(slotId);
        if (!slotKey) continue;

        const bookingKey = `${student.seat_id}:${slotKey}`;
        const existingNames = bookingsBySeatAndSlot.get(bookingKey) ?? [];
        if (student.full_name && !existingNames.includes(student.full_name)) {
          existingNames.push(student.full_name);
        }
        bookingsBySeatAndSlot.set(bookingKey, existingNames);
      }
    }

    return orderedSeats.map((seat) => {
      const slotStates = seatSlotLayout.map((slotLayout) => {
        const assignedSlot = slotBySeatPosition.get(slotLayout.key) ?? null;
        const bookingKey = `${seat.id}:${slotLayout.key}`;
        const studentNames = bookingsBySeatAndSlot.get(bookingKey) ?? [];
        const status: SeatSlotStatus = studentNames.length > 0 ? "booked" : "available";

        return {
          key: slotLayout.key,
          label: slotLayout.label,
          shortLabel: slotLayout.shortLabel,
          slotId: assignedSlot?.id ?? null,
          slotName: assignedSlot?.name ?? slotLayout.label,
          status,
          student: summarizeValue(studentNames),
          timeLabel: assignedSlot ? buildSlotRangeLabel(assignedSlot) : undefined,
        };
      });

      return {
        id: seat.seat_number,
        bookedCount: slotStates.filter((slotState) => slotState.status === "booked").length,
        slotStates,
      };
    });
  }, [orderedSeats, slotBySeatPosition, slotPositionById, studentSlotIdsById, students]);

  const loading = roleLibraryLoading || fallbackLoading || slotsLoading || seatsLoading || studentsLoading || slotAssignmentsLoading;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 rounded-[28px] border border-[#e7ece6] bg-[radial-gradient(circle_at_top_left,rgba(230,247,238,0.8),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,247,0.96))] p-6 shadow-[0_22px_55px_-30px_rgba(15,23,42,0.22)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b7d70]">Library Floor View</p>
            <h2 className="mt-2 text-2xl font-bold font-display text-[#1f2f26]">Seat Map</h2>
            <p className="mt-2 text-sm text-[#6a7a70]">Visual overview of every seat and every time slot in one place.</p>
          </div>
          <Select value={selectedSlot} onValueChange={setSelectedSlot}>
            <SelectTrigger className="w-full rounded-2xl border-[#e1e9de] bg-white/90 px-4 py-3 text-[#24362b] shadow-[0_16px_34px_-24px_rgba(15,23,42,0.28)] transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[#cfe0d3] hover:shadow-[0_22px_42px_-28px_rgba(15,23,42,0.32)] sm:w-64">
              <SelectValue placeholder="Highlight slot" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Slots</SelectItem>
              {slots.map((slot) => (
                <SelectItem key={slot.id} value={slot.id}>
                  {slot.name} ({formatTimeLabel(slot.start_time)} - {formatTimeLabel(slot.end_time)})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-[28px] border border-[#e7ece6] bg-[radial-gradient(circle_at_top_right,rgba(255,248,219,0.7),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,248,0.98))] p-6 shadow-[0_22px_55px_-32px_rgba(15,23,42,0.24)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#7f7056]">Overview</p>
              <h3 className="mt-2 text-lg font-semibold font-display text-[#1f2f26]">Slot Overview</h3>
              <p className="mt-2 text-sm text-[#6a7a70]">Morning, Forenoon, Afternoon and Evening stay visible here so admins can scan availability before checking the seat matrix below.</p>
            </div>
            {selectedSlot !== "all" ? (
              <button
                type="button"
                onClick={() => setSelectedSlot("all")}
                className="inline-flex items-center justify-center rounded-2xl border border-[#dfe7db] bg-white/80 px-4 py-2.5 text-sm font-medium text-[#55665b] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.28)] transition-[border-color,transform,box-shadow,color] duration-300 hover:-translate-y-0.5 hover:border-[#22c55e]/40 hover:text-[#1f2f26] hover:shadow-[0_18px_36px_-24px_rgba(15,23,42,0.32)]"
              >
                Clear highlight
              </button>
            ) : null}
          </div>

          {!resolvedLibraryId && !loading ? (
            <p className="py-8 text-center text-sm text-destructive">Library not linked to your account. Please check user role setup.</p>
          ) : loading ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: Math.max(slots.length, 4) || 4 }).map((_, index) => (
                <div key={index} className="h-48 animate-pulse rounded-[24px] border border-[#e7ece6] bg-white/75" />
              ))}
            </div>
          ) : slotOverview.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Create active slots in Plans & Slots to see the overview here.</p>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {slotOverview.map((slot) => {
                const isSelected = selectedSlot === slot.id;
                const occupancyPercent = slot.totalSeats > 0 ? Math.min((slot.occupiedSeats / slot.totalSeats) * 100, 100) : 0;

                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setSelectedSlot((current) => (current === slot.id ? "all" : slot.id))}
                    className={cn(
                      "group rounded-[24px] border p-5 text-left shadow-[0_18px_40px_-28px_rgba(15,23,42,0.3)] transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_28px_56px_-30px_rgba(15,23,42,0.32)]",
                      isSelected
                        ? "border-[#22c55e]/45 bg-[linear-gradient(180deg,rgba(230,247,238,0.72),rgba(255,255,255,0.96))] ring-1 ring-[#22c55e]/20"
                        : "border-[#e3e9df] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(250,252,249,0.96))] hover:border-[#d3ddd0]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-[#1f2f26]">{slot.name}</p>
                        <p className="mt-1 text-xs text-[#738378]">{slot.timeLabel}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1 text-[11px] font-medium shadow-[0_10px_20px_-18px_rgba(15,23,42,0.35)] transition-colors duration-300",
                          isSelected
                            ? "border-[#b8e7c7] bg-white/90 text-[#166534]"
                            : "border-[#ebefea] bg-white/85 text-[#6a7a70] group-hover:border-[#dbe7df] group-hover:text-[#24362b]",
                        )}
                      >
                        {isSelected ? "Highlighted" : "Highlight"}
                      </span>
                    </div>

                    <div className="mt-6 flex items-end gap-2">
                      <span className="text-3xl font-semibold text-[#7c5a0a]">{slot.occupiedSeats}</span>
                      <span className="pb-1 text-sm text-[#6a7a70]">/ {slot.totalSeats} Booked</span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl border border-[#cfe9d8] bg-[#e6f7ee] px-3 py-3 shadow-[0_12px_28px_-24px_rgba(34,197,94,0.45)]">
                        <p className="text-xs text-[#5d6d63]">Available</p>
                        <p className="mt-1 text-lg font-semibold text-[#166534]">{slot.availableSeats}</p>
                      </div>
                      <div className="rounded-2xl border border-[#e7ece6] bg-white px-3 py-3 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.3)]">
                        <p className="text-xs text-[#5d6d63]">Total seats</p>
                        <p className="mt-1 text-lg font-semibold text-[#1f2f26]">{slot.totalSeats}</p>
                      </div>
                    </div>

                    <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#eef2eb]">
                      <div
                        className={cn(
                          "h-full rounded-full bg-[linear-gradient(90deg,#facc15,#fde68a)] transition-[width,background-color] duration-300",
                          isSelected && "bg-[linear-gradient(90deg,#22c55e,#86efac)]",
                        )}
                        style={{ width: `${occupancyPercent}%` }}
                      />
                    </div>

                    <p className="mt-3 text-xs text-[#6f7f74]">
                      {slot.availableSeats} available of {slot.totalSeats} {slot.totalSeatsLabel}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-[#e7ece6] bg-[radial-gradient(circle_at_bottom_left,rgba(230,247,238,0.5),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(249,251,248,0.98))] p-6 shadow-[0_22px_55px_-32px_rgba(15,23,42,0.24)]">
          {!resolvedLibraryId && !loading ? (
            <p className="text-sm text-destructive py-8 text-center">Library not linked to your account. Please check user role setup.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6b7d70]">Seat Matrix</p>
                  <h3 className="mt-2 text-lg font-semibold font-display text-[#1f2f26]">Live Slot Status</h3>
                  <p className="mt-2 text-sm text-[#6a7a70]">Each seat shows Morning, Forenoon, Afternoon and Evening together, so admins can spot bookings instantly without switching filters.</p>
                </div>
                <div className="rounded-2xl border border-[#edf2eb] bg-white/80 px-4 py-3 text-sm text-[#617067] shadow-[0_12px_28px_-24px_rgba(15,23,42,0.28)]">
                  Soft green = available, soft yellow = booked
                </div>
              </div>

              {slotAssignmentsTableMissing ? (
                <div className="rounded-2xl border border-[#f4da75] bg-[#fff8db] px-4 py-3 text-sm text-[#7c5a0a]">
                  Multi-slot allocation is not active yet because the latest database migration has not been applied. The seat map is currently using legacy single-slot data.
                </div>
              ) : null}

              <SeatGrid
                seats={seatItems}
                isLoading={loading}
                emptyMessage="No seats configured yet. Set total seats in Settings > Seats."
                highlightedSlotId={selectedSlot !== "all" ? selectedSlot : null}
                highlightedSlotName={selectedSlotMeta?.name ?? null}
              />
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
};

export default SeatMapPage;
