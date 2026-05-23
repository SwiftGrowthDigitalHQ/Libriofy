import { memo, useState, type ChangeEvent } from "react";
import { format } from "date-fns";
import { Camera, CheckCircle2, Eye, Loader2, Pencil, RefreshCcw, RotateCcw, Upload } from "lucide-react";

import type { StudentListItem } from "@/api/students";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatStudentGender, getStudentGenderBadgeClassName } from "@/lib/studentGender";
import { cn } from "@/lib/utils";

type StudentsTableProps = {
  aadhaarJobs: Record<string, { status: "opening" | "uploading" }>;
  actionStudentId: string | null;
  canEditStudents: boolean;
  isFetching: boolean;
  isLoading: boolean;
  onEditStudent: (student: StudentListItem) => void;
  onMarkPaid: (student: StudentListItem) => void;
  onReplacePhoto: (student: StudentListItem, file: File) => void;
  onResetFilters: () => void;
  onRetryPhotoUpload: (student: StudentListItem) => void;
  onUploadAadhaar: (student: StudentListItem, file: File) => void;
  onViewAadhaar: (student: StudentListItem) => void;
  photoJobs: Record<string, { error: string | null; previewUrl: string; progress: number; status: "failed" | "processing" | "success" | "uploading" }>;
  students: StudentListItem[];
};

const formatDate = (value: string | null) => {
  if (!value) return "No due date";

  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  return format(parsed, "dd MMM yyyy");
};

const getInitial = (value: string) => value.trim().charAt(0).toUpperCase() || "?";

const getStatusBadgeClassName = (status: StudentListItem["status"]) => {
  if (status === "Paid") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "Overdue") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
};

const getRowClassName = (status: StudentListItem["status"]) => {
  if (status === "Overdue") return "bg-rose-50/80 hover:bg-rose-50";
  if (status === "Unpaid") return "bg-rose-50/40 hover:bg-rose-50/70";
  return "bg-white/70 hover:bg-slate-50";
};

const getPhotoStateBadgeClassName = (status: "failed" | "processing" | "success" | "uploading" | "idle") => {
  if (status === "uploading") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "processing") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
};

const getPhotoStateLabel = (status: "failed" | "processing" | "success" | "uploading" | "idle", progress = 0) => {
  if (status === "uploading") return `Uploading ${progress}%`;
  if (status === "processing") return "Processing";
  if (status === "success") return "Success";
  if (status === "failed") return "Failed";
  return "Idle";
};

const StudentsTableSkeleton = () => (
  <div className="space-y-3 p-5">
    {Array.from({ length: 8 }).map((_, index) => (
      <div key={index} className="grid grid-cols-[1.4fr_0.75fr_0.7fr_1fr_0.9fr_0.8fr_0.9fr_1.2fr] gap-3">
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
      </div>
    ))}
  </div>
);

const EmptyState = ({ onResetFilters }: { onResetFilters: () => void }) => (
  <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-muted/60">
      <RefreshCcw className="h-6 w-6 text-muted-foreground" />
    </div>
    <div className="space-y-2">
      <h3 className="text-xl font-semibold tracking-tight text-foreground">No students match these filters</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        Try a broader name search, remove the seat or gender filter, or switch the payment status back to all students.
      </p>
    </div>
    <Button type="button" variant="outline" className="rounded-xl" onClick={onResetFilters}>
      Clear filters
    </Button>
  </div>
);

const StudentTableRow = memo(
  ({
    aadhaarJob,
    actionStudentId,
    canEditStudents,
    onEditStudent,
    onMarkPaid,
    onReplacePhoto,
    onRetryPhotoUpload,
    onUploadAadhaar,
    onViewAadhaar,
    photoJob,
    student,
  }: {
    aadhaarJob?: { status: "opening" | "uploading" };
    actionStudentId: string | null;
    canEditStudents: boolean;
    onEditStudent: (student: StudentListItem) => void;
    onMarkPaid: (student: StudentListItem) => void;
    onReplacePhoto: (student: StudentListItem, file: File) => void;
    onRetryPhotoUpload: (student: StudentListItem) => void;
    onUploadAadhaar: (student: StudentListItem, file: File) => void;
    onViewAadhaar: (student: StudentListItem) => void;
    photoJob?: { error: string | null; previewUrl: string; progress: number; status: "failed" | "processing" | "success" | "uploading" };
    student: StudentListItem;
  }) => {
    const [aadhaarInputKey, setAadhaarInputKey] = useState(0);
    const [fileInputKey, setFileInputKey] = useState(0);
    const avatarSrc = photoJob?.previewUrl || student.photoUrl;
    const hasAadhaarDocument = Boolean(student.aadhaarPhotoPath);
    const aadhaarState = aadhaarJob?.status ?? "idle";
    const isAadhaarUploading = aadhaarState === "uploading";
    const isAadhaarOpening = aadhaarState === "opening";
    const isAadhaarBusy = isAadhaarUploading || isAadhaarOpening;
    const photoState = photoJob?.status ?? "idle";
    const isPhotoBusy = photoState === "uploading" || photoState === "processing";
    const helperText =
      photoState === "uploading"
        ? `Uploading photo... ${photoJob?.progress ?? 0}%`
        : photoState === "processing"
          ? "Generating thumbnail and finalizing..."
          : photoState === "success"
            ? "Photo updated successfully."
            : photoState === "failed"
              ? photoJob?.error || "Photo upload failed"
              : student.phone || "Phone unavailable";

    const handlePhotoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      onReplacePhoto(student, file);
      setFileInputKey((current) => current + 1);
    };

    const handleAadhaarInputChange = (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      onUploadAadhaar(student, file);
      setAadhaarInputKey((current) => current + 1);
    };

    return (
      <TableRow className={cn("border-border/60 transition-colors", getRowClassName(student.status))}>
        <TableCell className="min-w-[220px]">
          <div className="flex items-center gap-3">
            <div className="relative">
              {avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt={student.name}
                  className={cn(
                    "h-10 w-10 rounded-full object-cover ring-1 ring-border/70 transition-all",
                    photoState === "processing" && "scale-[1.03] blur-[1px] saturate-75",
                  )}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
                  {getInitial(student.name)}
                </div>
              )}
              {photoState === "uploading" ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/55 text-white">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : null}
              {photoState === "processing" ? (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-950/45 text-white backdrop-blur-[1px]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : null}
              {photoState === "success" ? (
                <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
              ) : null}
              {photoState === "failed" ? (
                <div className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white">
                  !
                </div>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold text-foreground">{student.name}</span>
              <span className="text-xs text-muted-foreground">{helperText}</span>
              {photoState === "uploading" ? <Progress className="mt-2 h-1.5 max-w-[170px]" value={photoJob?.progress ?? 0} /> : null}
            </div>
          </div>
        </TableCell>
        <TableCell className="min-w-[120px]">
          <Badge variant="outline" className={cn("rounded-full px-3 py-1", getStudentGenderBadgeClassName(student.gender))}>
            {formatStudentGender(student.gender)}
          </Badge>
        </TableCell>
        <TableCell className="min-w-[100px] font-medium text-foreground">{student.seatNo || "-"}</TableCell>
        <TableCell className="min-w-[150px] text-muted-foreground">{student.phone || "-"}</TableCell>
        <TableCell className="min-w-[150px] text-muted-foreground">{student.plan || "Plan not set"}</TableCell>
        <TableCell className="min-w-[140px]">
          <Badge variant="outline" className={cn("rounded-full px-3 py-1", getStatusBadgeClassName(student.status))}>
            {student.status}
          </Badge>
        </TableCell>
        <TableCell className="min-w-[140px] text-muted-foreground">{formatDate(student.dueDate)}</TableCell>
        <TableCell className="min-w-[240px]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn("rounded-full px-2.5 py-0.5 text-[11px]", getPhotoStateBadgeClassName(photoState))}>
                {getPhotoStateLabel(photoState, photoJob?.progress ?? 0)}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className={cn("inline-flex", isPhotoBusy && "cursor-not-allowed opacity-70")}>
                <input
                  key={fileInputKey}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  disabled={isPhotoBusy}
                  onChange={handlePhotoInputChange}
                />
                <span
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors",
                    isPhotoBusy ? "text-muted-foreground" : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {isPhotoBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  {photoState === "uploading"
                    ? `${photoJob?.progress ?? 0}% uploaded`
                    : photoState === "processing"
                      ? "Processing..."
                      : student.photoUrl
                        ? "Replace Photo"
                        : "Upload Photo"}
                </span>
              </label>
              {photoState === "failed" ? (
                <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => onRetryPhotoUpload(student)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Retry Upload
                </Button>
              ) : null}
              <label className={cn("inline-flex", isAadhaarBusy && "cursor-not-allowed opacity-70")}>
                <input
                  key={aadhaarInputKey}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={isAadhaarBusy}
                  onChange={handleAadhaarInputChange}
                />
                <span
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium shadow-sm transition-colors",
                    isAadhaarBusy
                      ? "border-amber-200 bg-amber-50 text-amber-400"
                      : "cursor-pointer border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900",
                  )}
                >
                  {isAadhaarUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {isAadhaarUploading ? "Uploading..." : hasAadhaarDocument ? "Replace Aadhaar" : "Upload Aadhaar"}
                </span>
              </label>
              <Button
                type="button"
                size="sm"
                className={cn(
                  "rounded-xl bg-amber-500 text-white shadow-[0_8px_20px_-12px_rgba(217,119,6,0.9)] hover:bg-amber-600",
                  !hasAadhaarDocument && "bg-amber-100 text-amber-700 hover:bg-amber-100",
                )}
                disabled={!hasAadhaarDocument || isAadhaarBusy}
                onClick={() => onViewAadhaar(student)}
              >
                {isAadhaarOpening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                View
              </Button>
              {canEditStudents ? (
                <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => onEditStudent(student)}>
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                className="rounded-xl"
                disabled={student.status === "Paid" || actionStudentId === student.id}
                onClick={() => onMarkPaid(student)}
              >
                {actionStudentId === student.id ? "Marking..." : "Mark Paid"}
              </Button>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  },
);
StudentTableRow.displayName = "StudentTableRow";

const StudentsTable = ({
  aadhaarJobs,
  actionStudentId,
  canEditStudents,
  isFetching,
  isLoading,
  onEditStudent,
  onMarkPaid,
  onReplacePhoto,
  onResetFilters,
  onRetryPhotoUpload,
  onUploadAadhaar,
  onViewAadhaar,
  photoJobs,
  students,
}: StudentsTableProps) => {
  if (isLoading) {
    return <StudentsTableSkeleton />;
  }

  if (students.length === 0) {
    return <EmptyState onResetFilters={onResetFilters} />;
  }

  return (
    <div className="relative overflow-hidden">
      {isFetching ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20 rounded-full border border-border/70 bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
          Updating table...
        </div>
      ) : null}
      <div className="max-h-[65vh] overflow-auto">
        <table className="w-full min-w-[1220px] caption-bottom text-sm">
          <TableHeader>
            <TableRow className="border-border/70 bg-card hover:bg-card">
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Name</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Gender</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Seat No</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Phone</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Plan</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Status</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Due Date</TableHead>
              <TableHead className="sticky top-0 z-10 bg-card/95 backdrop-blur">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.map((student) => (
              <StudentTableRow
                aadhaarJob={aadhaarJobs[student.id]}
                key={student.id}
                actionStudentId={actionStudentId}
                canEditStudents={canEditStudents}
                onEditStudent={onEditStudent}
                onMarkPaid={onMarkPaid}
                onReplacePhoto={onReplacePhoto}
                onRetryPhotoUpload={onRetryPhotoUpload}
                onUploadAadhaar={onUploadAadhaar}
                onViewAadhaar={onViewAadhaar}
                photoJob={photoJobs[student.id]}
                student={student}
              />
            ))}
          </TableBody>
        </table>
      </div>
    </div>
  );
};

export default StudentsTable;
