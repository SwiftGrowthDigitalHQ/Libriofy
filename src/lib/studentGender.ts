import type { Database } from "@/integrations/supabase/types";

export type StudentGender = Database["public"]["Enums"]["student_gender"];
export type StudentGenderFilter = "all" | StudentGender;

export const STUDENT_GENDER_OPTIONS: Array<{ label: string; value: StudentGender }> = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
];

export const formatStudentGender = (gender: StudentGender | null | undefined) => {
  if (gender === "male") return "Male";
  if (gender === "female") return "Female";
  return "Not set";
};

export const normalizeStudentGender = (value: unknown): StudentGender | null => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  if (normalized === "male") return "male";
  if (normalized === "female") return "female";
  return null;
};

export const getStudentGenderBadgeClassName = (gender: StudentGender | null | undefined) => {
  if (gender === "male") return "border-sky-200 bg-sky-50 text-sky-700";
  if (gender === "female") return "border-pink-200 bg-pink-50 text-pink-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
};
