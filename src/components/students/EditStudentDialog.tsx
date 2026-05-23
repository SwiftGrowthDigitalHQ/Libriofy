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

const fieldClassName =
  "h-11 rounded-xl border-border/60 bg-background shadow-none transition-colors hover:border-border focus-visible:ring-1 focus-visible:ring-ring";
const fieldLabelClassName = "text-[13px] font-medium text-foreground";
const fieldErrorClassName = "text-xs font-medium text-destructive";
const textAreaClassName =
  "min-h-[96px] rounded-xl border-border/60 bg-background px-3 py-2 shadow-none transition-colors hover:border-border focus-visible:ring-1 focus-visible:ring-ring";

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
  <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-2">
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[76px] rounded-2xl" />
    <Skeleton className="h-[120px] rounded-2xl lg:col-span-2" />
    <Skeleton className="h-[132px] rounded-2xl lg:col-span-2" />
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
    <div className="flex-1 overflow-y-auto">
      {studentDetailQuery.isLoading && !studentDetailQuery.data ? (
        <DialogBodySkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 px-6 py-5 lg:grid-cols-2">
          {studentDetailQuery.isError ? (
            <Alert variant="destructive" className="rounded-2xl border-destructive/30 lg:col-span-2">
              <AlertTitle>Saved student details could not be loaded</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{studentDetailQuery.error instanceof Error ? studentDetailQuery.error.message : "Try again in a moment."}</span>
                <Button type="button" size="sm" variant="outline" className="w-fit rounded-xl" onClick={() => studentDetailQuery.refetch()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="edit-student-name" className={fieldLabelClassName}>
              Student Name *
            </Label>
            <Input
              id="edit-student-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Student full name"
              className={fieldClassName}
            />
            {validationErrors.name ? <p className={fieldErrorClassName}>{validationErrors.name}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-student-phone" className={fieldLabelClassName}>
              Phone *
            </Label>
            <Input
              id="edit-student-phone"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              placeholder="9876543210"
              className={fieldClassName}
            />
            {validationErrors.phone ? <p className={fieldErrorClassName}>{validationErrors.phone}</p> : null}
          </div>

          <div className="space-y-2">
            <Label className={fieldLabelClassName}>Gender</Label>
            <RadioGroup
              value={form.gender}
              onValueChange={(value) => setForm((current) => ({ ...current, gender: value as StudentGender }))}
              className="grid grid-cols-2 gap-2"
            >
              {STUDENT_GENDER_OPTIONS.map((option) => {
                const inputId = `edit-student-gender-${option.value}`;

                return (
                  <label
                    key={option.value}
                    htmlFor={inputId}
                    className={cn(
                      "flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border/60 px-3 text-sm font-medium transition-colors",
                      form.gender === option.value ? "border-primary bg-primary/5 text-foreground" : "hover:bg-muted/40",
                    )}
                  >
                    <RadioGroupItem id={inputId} value={option.value} />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-student-seat" className={fieldLabelClassName}>
              Seat Number
            </Label>
            <Input
              id="edit-student-seat"
              value={form.seatNumber}
              onChange={(event) => setForm((current) => ({ ...current, seatNumber: event.target.value }))}
              placeholder="A1"
              className={fieldClassName}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-student-plan" className={fieldLabelClassName}>
              Plan
            </Label>
            <Input
              id="edit-student-plan"
              list={planSuggestionsId}
              value={form.planName}
              onChange={(event) => setForm((current) => ({ ...current, planName: event.target.value }))}
              placeholder={plansQuery.isLoading ? "Loading plans..." : "Starter"}
              className={fieldClassName}
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
          </div>

          <div className="space-y-2">
            <Label className={fieldLabelClassName}>Payment Status</Label>
            <Select
              value={form.paymentStatus}
              onValueChange={(value) => setForm((current) => ({ ...current, paymentStatus: value as StudentPaymentStatus }))}
            >
              <SelectTrigger className={cn(fieldClassName, "justify-between")}>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Paid">Paid</SelectItem>
                <SelectItem value="Unpaid">Unpaid</SelectItem>
                <SelectItem value="Overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
            {validationErrors.paymentStatus ? <p className={fieldErrorClassName}>{validationErrors.paymentStatus}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-student-due-date" className={fieldLabelClassName}>
              Due Date
            </Label>
            <Input
              id="edit-student-due-date"
              type="date"
              value={form.dueDate}
              onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
              className={fieldClassName}
            />
            {validationErrors.dueDate ? <p className={fieldErrorClassName}>{validationErrors.dueDate}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-student-aadhaar-number" className={fieldLabelClassName}>
              Aadhaar Number
            </Label>
            <Input
              id="edit-student-aadhaar-number"
              value={form.aadhaarNumber}
              onChange={(event) => setForm((current) => ({ ...current, aadhaarNumber: event.target.value }))}
              placeholder="1234 5678 9012"
              className={fieldClassName}
            />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="edit-student-address" className={fieldLabelClassName}>
              Address
            </Label>
            <Textarea
              id="edit-student-address"
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="Current address"
              className={textAreaClassName}
            />
          </div>

          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="edit-student-notes" className={fieldLabelClassName}>
              Notes
            </Label>
            <Textarea
              id="edit-student-notes"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Operational notes"
              className={cn(textAreaClassName, "min-h-[120px]")}
            />
          </div>
        </div>
      )}
    </div>
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
        <DrawerContent className="flex max-h-[90vh] flex-col overflow-hidden rounded-t-[28px] border-border/60 bg-background">
          <DrawerHeader className="border-b border-border/60 px-6 py-4 text-left">
            <DrawerTitle className="font-display text-[1.35rem] font-semibold tracking-tight">Edit Student</DrawerTitle>
            <DrawerDescription className="text-sm">Update profile, billing, and seat details.</DrawerDescription>
          </DrawerHeader>
          {contentBody}
          <DrawerFooter className="sticky bottom-0 border-t border-border/60 bg-background px-6 py-4">{footerContent}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-[920px] flex-col gap-0 overflow-hidden rounded-[24px] border border-border/60 bg-background p-0 shadow-xl sm:max-w-[920px]">
        <DialogHeader className="border-b border-border/60 px-7 py-5 text-left">
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">Edit Student</DialogTitle>
          <DialogDescription className="text-sm">Update profile, billing, and seat details.</DialogDescription>
        </DialogHeader>
        {contentBody}
        <DialogFooter className="sticky bottom-0 border-t border-border/60 bg-background px-7 py-4">{footerContent}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EditStudentDialog;
