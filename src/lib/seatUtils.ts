import { isStudentCurrentlyActive as isStudentMembershipCurrentlyActive } from "@/lib/studentMembership";

export type TimeRange = {
  start: number;
  end: number;
};

type StudentActivityLike = {
  status: string | null;
  expiry_date: string | null;
};

export const normalizeSeatId = (value: string | null | undefined): string => (value || "").trim().toUpperCase();

export const normalizeText = (value: string | null | undefined): string => (value || "").replace(/\s+/g, "").toLowerCase();

export const normalizeLookupText = (value: string | null | undefined): string => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const rowLabelFromIndex = (index: number): string => {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
};

const rowIndexFromLabel = (label: string): number => {
  let result = 0;
  for (let i = 0; i < label.length; i += 1) {
    result = result * 26 + (label.charCodeAt(i) - 64);
  }
  return result - 1;
};

export const seatSort = (a: string, b: string) => {
  const ma = a.match(/^([A-Z]+)(\d+)$/);
  const mb = b.match(/^([A-Z]+)(\d+)$/);
  if (!ma || !mb) return a.localeCompare(b, undefined, { numeric: true });

  const rowDiff = rowIndexFromLabel(ma[1]) - rowIndexFromLabel(mb[1]);
  if (rowDiff !== 0) return rowDiff;
  return Number(ma[2]) - Number(mb[2]);
};

export const generateSeatIds = (totalSeats: number, columns = 8): string[] => {
  if (totalSeats <= 0) return [];
  const seats: string[] = [];
  for (let i = 0; i < totalSeats; i += 1) {
    const row = rowLabelFromIndex(Math.floor(i / columns));
    const col = (i % columns) + 1;
    seats.push(`${row}${col}`);
  }
  return seats;
};

export const formatTimeLabel = (value: string | null): string => {
  if (!value) return "";
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw || "0");
  if (Number.isNaN(h)) return value;
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
};

export const formatCompactTimeLabel = (value: string | null): string => {
  if (!value) return "";
  const [hRaw, mRaw] = value.split(":");
  const h = Number(hRaw);
  const m = Number(mRaw || "0");
  if (Number.isNaN(h)) return value;
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}${String(m).padStart(2, "0")}${suffix}`;
};

export const parseStudentRange = (slot: string): TimeRange | null => {
  const match = slot
    .trim()
    .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;

  const toMinutes = (hourText: string, minuteText: string | undefined, ampm: string | undefined): number => {
    let hour = Number(hourText);
    const minute = Number(minuteText || "0");
    const meridiem = (ampm || "").toLowerCase();

    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return hour * 60 + minute;
  };

  return {
    start: toMinutes(match[1], match[2], match[3]),
    end: toMinutes(match[4], match[5], match[6]),
  };
};

export const getTimeRangeFromSlot = (startTime: string | null | undefined, endTime: string | null | undefined): TimeRange | null => {
  if (!startTime || !endTime) return null;

  const startParts = startTime.split(":");
  const endParts = endTime.split(":");
  const start = Number(startParts[0]) * 60 + Number(startParts[1] || "0");
  const end = Number(endParts[0]) * 60 + Number(endParts[1] || "0");

  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start, end };
};

export const rangesOverlap = (a: TimeRange, b: TimeRange) => a.start < b.end && b.start < a.end;

export const slotMatches = (
  studentSlot: string | null,
  selectedSlotName: string,
  selectedRange: TimeRange | null,
): boolean => {
  if (selectedSlotName === "all") return true;
  if (!studentSlot) return true;

  const studentNorm = normalizeLookupText(studentSlot);
  const selectedNorm = normalizeLookupText(selectedSlotName);

  if (studentNorm.includes(selectedNorm) || selectedNorm.includes(studentNorm)) return true;

  if (selectedRange) {
    const studentRange = parseStudentRange(studentSlot);
    if (studentRange && rangesOverlap(studentRange, selectedRange)) return true;
  }

  return false;
};

export const isStudentCurrentlyActive = (student: StudentActivityLike): boolean => {
  return isStudentMembershipCurrentlyActive(student);
};
