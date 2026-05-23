import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import type { StudentEditPayload, StudentPaymentStatus, StudentListItem } from "@/api/students";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { STUDENT_GENDER_OPTIONS, type StudentGender } from "@/lib/studentGender";
import { cn } from "@/lib/utils";

type EditStudentDialogProps = {
  isOpen: boolean;
  isSaving: boolean;
  libraryId: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (
    payload: StudentEditPayload,
    optimisticPatch: Partial<Pick<StudentListItem, "dueDate" | "gender" | "name" | "phone" | "plan" | "seatNo" | "status">>,
  ) => Promise<void>;
  student: StudentListItem | null;
};

type StudentEditDetail = {
  aadhaar_number?: string | null;
  address?: string | null;
  expiry_date?: string | null;
  full_name?: string | null;
  gender?: StudentGender | null;
  id: string;
  notes?: string | null;
  phone?: string | null;
  plan?: string | null;
  seat_number?: string | null;
};

type PlanSuggestionRow = {
  id: string;
  is_active: boolean | null;
  name: string;
  price: number | string | null;
};

type StudentEditFormState = {
  aadhaarNumber: string;
  address: string;
  dueDate: string;
  gender: StudentGender | "";
  name: string;
  notes: string;
  paymentStatus: StudentPaymentStatus;
  phone: string;
  planName: string;
  seatNumber: string;
};

const EMPTY_FORM: StudentEditFormState = {
  aadhaarNumber: "",
  address: "",
  dueDate: "",
  gender: "",
  name: "",
  notes: "",
  paymentStatus: "Unpaid",
  phone: "",
  planName: "",
  seatNumber: "",
};

const toNullableText = (value: string) => {
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const isStudentSchemaShapeError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /could not find the '.*' column|column .* does not exist|schema cache/i.test(String(error?.message ?? ""));

const isValidDateOnly = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);

const isPastDate = (value: string) => {
  if (!value) return false;

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parsed.getTime() < todayStart.getTime();
};

const buildFormState = (student: StudentListItem, detail?: StudentEditDetail | null): StudentEditFormState => ({
  aadhaarNumber: detail?.aadhaar_number ?? "",
  address: detail?.address ?? "",
  dueDate: student.dueDate ?? detail?.expiry_date ?? "",
  gender: detail?.gender ?? student.gender ?? "",
  name: detail?.full_name ?? student.name,
  notes: detail?.notes ?? "",
  paymentStatus: student.status,
  phone: detail?.phone ?? student.phone ?? "",
  planName: detail?.plan ?? student.plan ?? "",
  seatNumber: detail?.seat_number ?? student.seatNo ?? "",
});

const getValidationErrors = (form: StudentEditFormState) => {
  const errors: Partial<Record<keyof StudentEditFormState, string>> = {};

  if (!form.name.trim()) {
    errors.name = "Student name is required.";
  }

  if (!form.phone.trim()) {
    errors.phone = "Phone is required.";
  }

  if (!isValidDateOnly(form.dueDate)) {
    errors.dueDate = "Due date must be valid.";
  }

  if (form.paymentStatus !== "Paid" && !form.dueDate) {
    errors.dueDate = "Due date is required for unpaid or overdue students.";
  }

  if (form.paymentStatus === "Overdue" && form.dueDate && !isPastDate(form.dueDate)) {
    errors.paymentStatus = "Overdue students need a past due date.";
  }

  if (form.paymentStatus === "Unpaid" && form.dueDate && isPastDate(form.dueDate)) {
    errors.paymentStatus = "Move the due date to today or later to keep this student unpaid.";
  }

  return errors;
};

const DialogBodySkeleton = () => (
  <div className="space-y-5 px-6 pb-6 pt-2">
    <Skeleton className="h-20 rounded-3xl" />
    <div className="grid gap-4 sm:grid-cols-2">
      <Skeleton className="h-24 rounded-3xl" />
      <Skeleton className="h-24 rounded-3xl" />
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <Skeleton className="h-24 rounded-3xl" />
      <Skeleton className="h-24 rounded-3xl" />
    </div>
    <Skeleton className="h-32 rounded-3xl" />
    <Skeleton className="h-28 rounded-3xl" />
  </div>
);

const EditStudentDialog = ({
  isOpen,
  isSaving,
  libraryId,
  onOpenChange,
  onSave,
  student,
}: EditStudentDialogProps) => {
  const isMobile = useIsMobile();
  const [form, setForm] = useState<StudentEditFormState>(EMPTY_FORM);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const planSuggestionsId = useId();

  const studentDetailQuery = useQuery({
    queryKey: ["students-edit-detail", student?.id],
    queryFn: async (): Promise<StudentEditDetail | null> => {
      if (!student?.id) return null;

      const query = supabase
        .from("students")
        .select("id, full_name, phone, gender, seat_number, plan, expiry_date, aadhaar_number, address, notes")
        .eq("id", student.id)
        .maybeSingle();
      const { data, error } = await query;

      if (error && isStudentSchemaShapeError(error)) {
        const fallback = await supabase
          .from("students")
          .select("id, full_name, phone, gender, seat_number, plan, expiry_date")
          .eq("id", student.id)
          .maybeSingle();

        if (fallback.error) throw fallback.error;

        return fallback.data
          ? {
              ...(fallback.data as StudentEditDetail),
              aadhaar_number: null,
              address: null,
              notes: null,
            }
          : null;
      }

      if (error) throw error;
      return (data ?? null) as StudentEditDetail | null;
    },
    enabled: isOpen && !!student?.id,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const plansQuery = useQuery({
    queryKey: ["students-form-plans", libraryId],
    queryFn: async (): Promise<PlanSuggestionRow[]> => {
      if (!libraryId) return [];

      const { data, error } = await supabase
        .from("plans")
        .select("id, name, price, is_active")
        .eq("library_id", libraryId)
        .order("price", { ascending: true });

      if (error) throw error;
      return (data ?? []) as PlanSuggestionRow[];
    },
    enabled: isOpen && !!libraryId,
    staleTime: 60_000,
  });

  const activePlans = useMemo(
    () => plansQuery.data?.filter((plan) => plan.is_active !== false) ?? [],
    [plansQuery.data],
  );

  const validationErrors = useMemo(
    () => (submitAttempted ? getValidationErrors(form) : {}),
    [form, submitAttempted],
  );

  useEffect(() => {
    if (!isOpen || !student) return;
    if (studentDetailQuery.isLoading && !studentDetailQuery.data) return;

    setForm(buildFormState(student, studentDetailQuery.data));
    setSubmitAttempted(false);
  }, [isOpen, student, studentDetailQuery.data, studentDetailQuery.isLoading]);

  useEffect(() => {
    if (isOpen) return;
    setForm(EMPTY_FORM);
    setSubmitAttempted(false);
  }, [isOpen]);

  const handleSave = async () => {
    if (!student) return;

    setSubmitAttempted(true);
    const errors = getValidationErrors(form);
    if (Object.keys(errors).length > 0) return;

    await onSave(
      {
        aadhaarNumber: toNullableText(form.aadhaarNumber),
        address: toNullableText(form.address),
        dueDate: toNullableText(form.dueDate),
        gender: form.gender || null,
        name: form.name.trim(),
        notes: toNullableText(form.notes),
        paymentStatus: form.paymentStatus,
        phone: form.phone.trim(),
        planName: toNullableText(form.planName),
        seatNumber: toNullableText(form.seatNumber),
      },
      {
        dueDate: toNullableText(form.dueDate),
        gender: form.gender || null,
        name: form.name.trim(),
        phone: form.phone.trim(),
        plan: toNullableText(form.planName),
        seatNo: toNullableText(form.seatNumber),
        status: form.paymentStatus,
      },
    );
  };

  const contentBody = (
    <>
      <div className="space-y-1 px-6 pt-1">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Student Ledger Editor</p>
      </div>

      {studentDetailQuery.isLoading && !studentDetailQuery.data ? (
        <DialogBodySkeleton />
      ) : (
        <div className="space-y-5 overflow-y-auto px-6 pb-6 pt-2">
          {studentDetailQuery.isError ? (
            <Alert variant="destructive" className="rounded-3xl">
              <AlertTitle>Saved student details could not be loaded</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{studentDetailQuery.error instanceof Error ? studentDetailQuery.error.message : "Try again in a moment."}</span>
                <Button type="button" size="sm" variant="outline" className="w-fit rounded-xl" onClick={() => studentDetailQuery.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-student-name">Student Name *</Label>
                <Input
                  id="edit-student-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Student full name"
                />
                {validationErrors.name ? <p className="text-xs font-medium text-destructive">{validationErrors.name}</p> : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-student-phone">Phone *</Label>
                <Input
                  id="edit-student-phone"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="9876543210"
                />
                {validationErrors.phone ? <p className="text-xs font-medium text-destructive">{validationErrors.phone}</p> : null}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
            <div className="space-y-3">
              <Label>Gender</Label>
              <RadioGroup
                value={form.gender}
                onValueChange={(value) => setForm((current) => ({ ...current, gender: value as StudentGender }))}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                {STUDENT_GENDER_OPTIONS.map((option) => {
                  const inputId = `edit-student-gender-${option.value}`;

                  return (
                    <label
                      key={option.value}
                      htmlFor={inputId}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-colors",
                        form.gender === option.value ? "border-primary bg-primary/5" : "border-border/70 hover:bg-muted/40",
                      )}
                    >
                      <RadioGroupItem id={inputId} value={option.value} />
                      <span className="text-sm font-medium text-foreground">{option.label}</span>
                    </label>
                  );
                })}
              </RadioGroup>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="edit-student-seat">Seat Number</Label>
                <Input
                  id="edit-student-seat"
                  value={form.seatNumber}
                  onChange={(event) => setForm((current) => ({ ...current, seatNumber: event.target.value }))}
                  placeholder="A1"
                />
                <p className="text-xs text-muted-foreground">Seat availability stays validated on save so we do not disturb existing slot rules.</p>
              </div>
            </div>

            <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="edit-student-plan">Plan</Label>
                <Input
                  id="edit-student-plan"
                  list={planSuggestionsId}
                  value={form.planName}
                  onChange={(event) => setForm((current) => ({ ...current, planName: event.target.value }))}
                  placeholder={plansQuery.isLoading ? "Loading plans..." : "Starter"}
                />
                <datalist id={planSuggestionsId}>
                  {activePlans.map((plan) => (
                    <option
                      key={plan.id}
                      value={plan.name}
                      label={`${plan.name}${Number(plan.price || 0) > 0 ? ` - Rs ${Number(plan.price).toLocaleString("en-IN")}` : ""}`}
                    />
                  ))}
                </datalist>
                <p className="text-xs text-muted-foreground">
                  {activePlans.length > 0
                    ? "Choose an existing plan name or keep the saved value."
                    : "No active plans are available for quick suggestions yet."}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="edit-student-due-date">Due Date</Label>
                <Input
                  id="edit-student-due-date"
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
                />
                {validationErrors.dueDate ? <p className="text-xs font-medium text-destructive">{validationErrors.dueDate}</p> : null}
              </div>
            </div>

            <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <div className="space-y-2">
                <Label>Payment Status</Label>
                <Select
                  value={form.paymentStatus}
                  onValueChange={(value) => setForm((current) => ({ ...current, paymentStatus: value as StudentPaymentStatus }))}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Paid">Paid</SelectItem>
                    <SelectItem value="Unpaid">Unpaid</SelectItem>
                    <SelectItem value="Overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Saving as paid records any outstanding balance without forcing a page reload.
                </p>
                {validationErrors.paymentStatus ? <p className="text-xs font-medium text-destructive">{validationErrors.paymentStatus}</p> : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="edit-student-aadhaar-number">Aadhaar Number</Label>
                <Input
                  id="edit-student-aadhaar-number"
                  value={form.aadhaarNumber}
                  onChange={(event) => setForm((current) => ({ ...current, aadhaarNumber: event.target.value }))}
                  placeholder="1234 5678 9012"
                />
              </div>
            </div>

            <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="edit-student-address">Address</Label>
                <Textarea
                  id="edit-student-address"
                  value={form.address}
                  onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                  placeholder="Current address"
                  className="min-h-[110px] rounded-2xl"
                />
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm">
            <div className="space-y-2">
              <Label htmlFor="edit-student-notes">Notes</Label>
              <Textarea
                id="edit-student-notes"
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Operational notes, parent follow-ups, or membership context"
                className="min-h-[130px] rounded-2xl"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );

  const footerContent = (
    <>
      <Button type="button" variant="outline" className="rounded-xl" disabled={isSaving} onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button type="button" className="rounded-xl" disabled={isSaving || !student} onClick={handleSave}>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isSaving ? "Saving..." : "Save Changes"}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92vh] rounded-t-[28px] border-border/70 bg-background">
          <DrawerHeader className="px-6 pt-4 text-left">
            <DrawerTitle className="font-display text-xl">Edit Student</DrawerTitle>
            <DrawerDescription>Update the student profile and ledger fields while keeping the current table view intact.</DrawerDescription>
          </DrawerHeader>
          {contentBody}
          <DrawerFooter className="border-t border-border/70 px-6 py-4">{footerContent}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-[28px] border border-border/70 bg-background p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 text-left">
          <DialogTitle className="font-display text-xl">Edit Student</DialogTitle>
          <DialogDescription>Update the student profile and ledger fields while keeping the current table view intact.</DialogDescription>
        </DialogHeader>
        {contentBody}
        <DialogFooter className="border-t border-border/70 px-6 py-4">{footerContent}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditStudentDialog;
