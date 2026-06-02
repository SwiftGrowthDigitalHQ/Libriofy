type StudentMembershipLike = {
  expiry_date: string | null;
  status: string | null;
};

const trimText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const parseDateOnly = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const candidate = new Date(`${value}T00:00:00`);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const startOfDay = (value: Date | number | string = new Date()) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  date.setHours(0, 0, 0, 0);
  return date;
};

export const getEffectiveStudentStatus = (student: StudentMembershipLike, now: Date | number | string = new Date()) => {
  const normalizedStatus = trimText(student.status).toLowerCase();
  const expiryDate = parseDateOnly(student.expiry_date);
  const today = startOfDay(now);

  if (expiryDate) {
    if (expiryDate < today) {
      return "expired";
    }

    if (normalizedStatus === "inactive" || normalizedStatus === "waiting") {
      return normalizedStatus;
    }

    return "active";
  }

  return normalizedStatus || "inactive";
};

export const isStudentMembershipActiveOnDate = (student: StudentMembershipLike, date: Date | number | string) => {
  const normalizedStatus = trimText(student.status).toLowerCase();
  if (normalizedStatus === "inactive" || normalizedStatus === "waiting") {
    return false;
  }

  const expiryDate = parseDateOnly(student.expiry_date);
  if (expiryDate) {
    return expiryDate >= startOfDay(date);
  }

  return normalizedStatus === "active";
};

export const isStudentCurrentlyActive = (student: StudentMembershipLike, now: Date | number | string = new Date()) =>
  isStudentMembershipActiveOnDate(student, now);
