import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight, Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  DEFAULT_STUDENT_ROWS_PER_PAGE,
  STUDENT_ROWS_PER_PAGE_OPTIONS,
  buildStudentsSummaryFromPage,
  fetchStudentsPage,
  markStudentPaid,
  updateStudent,
  type StudentListItem,
  type StudentEditPayload,
  type StudentPaymentStatusFilter,
  type StudentsListParams,
  type StudentsListResponse,
} from "@/api/students";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AddStudentDialog from "@/components/students/AddStudentDialog";
import EditStudentDialog from "@/components/students/EditStudentDialog";
import StudentSummaryCards from "@/components/students/StudentSummaryCards";
import StudentsFilters from "@/components/students/StudentsFilters";
import StudentsPagination from "@/components/students/StudentsPagination";
import StudentsTable from "@/components/students/StudentsTable";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useToast } from "@/hooks/use-toast";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";
import { buildAadhaarDocumentPath, getStudentAadhaarValidationError, STUDENT_DOCUMENTS_BUCKET } from "@/lib/studentDocuments";
import { type StudentGenderFilter } from "@/lib/studentGender";
import { finalizeStudentPhotoUpload, getStudentPhotoValidationError, uploadStudentPhotoDraftAssets } from "@/lib/studentPhotos";

type StudentTableState = {
  gender: StudentGenderFilter;
  limit: number;
  page: number;
  paymentStatus: StudentPaymentStatusFilter;
  search: string;
  seatNumber: string;
};

type StudentPhotoJob = {
  error: string | null;
  file: File;
  progress: number;
  previewUrl: string;
  status: "failed" | "processing" | "success" | "uploading";
};

type StudentAadhaarJob = {
  status: "opening" | "uploading";
};

const getPhotoUploadErrorMessage = (error: unknown) => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? String((error as { message: string }).message)
        : "Try again in a moment.";

  if (/bucket not found/i.test(rawMessage)) {
    return "Student photo storage bucket is missing. Apply the latest Supabase migrations.";
  }

  if (/row-level security/i.test(rawMessage) || /forbidden/i.test(rawMessage)) {
    return "Photo upload permission is blocked for this account. Apply the latest photo RLS migration and retry.";
  }

  if (/newer photo upload already completed/i.test(rawMessage) || /stale/i.test(rawMessage)) {
    return "A newer photo upload finished first. Retry if you still want to replace this student's photo.";
  }

  if (/temporary files must belong to the signed-in user/i.test(rawMessage)) {
    return "This upload session expired. Please retry the photo upload.";
  }

  if (/too many uploads, please wait/i.test(rawMessage)) {
    return "Too many uploads, please wait a minute before trying again.";
  }

  return getSafeErrorMessage(error, "Photo upload could not be completed. Try again in a moment.");
};

const getAadhaarUploadErrorMessage = (error: unknown) => {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown } | null)?.message === "string"
        ? String((error as { message: string }).message)
        : "Try again in a moment.";

  if (/bucket not found/i.test(rawMessage)) {
    return "Student document storage bucket is missing. Apply the latest Supabase migrations.";
  }

  if (/mime type|invalid file type|not supported/i.test(rawMessage)) {
    return "Please upload a JPG, PNG, or WEBP image for the Aadhaar card.";
  }

  if (/file size|payload too large|entity too large/i.test(rawMessage)) {
    return "Aadhaar image must be 5 MB or smaller.";
  }

  if (/row-level security/i.test(rawMessage) || /forbidden/i.test(rawMessage)) {
    return "Aadhaar upload permission is blocked for this account. Apply the latest student document storage migration and retry.";
  }

  return getSafeErrorMessage(error, "Aadhaar upload could not be completed. Try again in a moment.");
};

const DEFAULT_TABLE_STATE: StudentTableState = {
  gender: "all",
  limit: DEFAULT_STUDENT_ROWS_PER_PAGE,
  page: 1,
  paymentStatus: "all",
  search: "",
  seatNumber: "",
};

const allowedPageSizes = new Set<number>(STUDENT_ROWS_PER_PAGE_OPTIONS);
const allowedPaymentStatuses = new Set<StudentPaymentStatusFilter>(["all", "Paid", "Unpaid", "Overdue"]);
const allowedGenderFilters = new Set<StudentGenderFilter>(["all", "male", "female"]);

const parsePositiveInteger = (value: string | null, fallback: number) => {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseTableState = (params: URLSearchParams): StudentTableState => {
  const parsedLimit = parsePositiveInteger(params.get("limit"), DEFAULT_TABLE_STATE.limit);
  const rawPaymentStatus = (params.get("status") || DEFAULT_TABLE_STATE.paymentStatus) as StudentPaymentStatusFilter;
  const rawGender = (params.get("gender") || DEFAULT_TABLE_STATE.gender) as StudentGenderFilter;

  return {
    gender: allowedGenderFilters.has(rawGender) ? rawGender : DEFAULT_TABLE_STATE.gender,
    limit: allowedPageSizes.has(parsedLimit) ? parsedLimit : DEFAULT_TABLE_STATE.limit,
    page: parsePositiveInteger(params.get("page"), DEFAULT_TABLE_STATE.page),
    paymentStatus: allowedPaymentStatuses.has(rawPaymentStatus) ? rawPaymentStatus : DEFAULT_TABLE_STATE.paymentStatus,
    search: (params.get("search") || "").trim(),
    seatNumber: (params.get("seat") || "").trim(),
  };
};

const isSameTableState = (left: StudentTableState, right: StudentTableState) =>
  left.gender === right.gender &&
  left.limit === right.limit &&
  left.page === right.page &&
  left.paymentStatus === right.paymentStatus &&
  left.search === right.search &&
  left.seatNumber === right.seatNumber;

const createTableSearchParams = (state: StudentTableState) => {
  const params = new URLSearchParams();
  params.set("page", String(state.page));
  params.set("limit", String(state.limit));

  if (state.gender !== "all") params.set("gender", state.gender);
  if (state.search) params.set("search", state.search);
  if (state.paymentStatus !== "all") params.set("status", state.paymentStatus);
  if (state.seatNumber) params.set("seat", state.seatNumber);

  return params;
};

const StudentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { libraryId, isLoading: currentLibraryLoading } = useCurrentLibraryId();
  const { data: userRoles = [] } = useUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialState = useMemo(() => parseTableState(searchParams), [searchParams]);
  const [tableState, setTableState] = useState<StudentTableState>(initialState);
  const [searchValue, setSearchValue] = useState(initialState.search);
  const [aadhaarJobs, setAadhaarJobs] = useState<Record<string, StudentAadhaarJob>>({});
  const [editingStudent, setEditingStudent] = useState<StudentListItem | null>(null);
  const [photoJobs, setPhotoJobs] = useState<Record<string, StudentPhotoJob>>({});
  const photoJobsRef = useRef<Record<string, StudentPhotoJob>>({});
  const photoJobTimeoutsRef = useRef<Record<string, number>>({});
  const deferredSearchValue = useDeferredValue(searchValue);
  const debouncedSearchValue = useDebouncedValue(deferredSearchValue, 300);

  useEffect(() => {
    photoJobsRef.current = photoJobs;
  }, [photoJobs]);

  useEffect(
    () => () => {
      Object.values(photoJobsRef.current).forEach((job) => {
        if (job.previewUrl) {
          URL.revokeObjectURL(job.previewUrl);
        }
      });
      Object.values(photoJobTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
    },
    [],
  );

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
      return data ?? [];
    },
    enabled: !!user?.id && !libraryId,
    staleTime: 60_000,
  });

  const resolvedLibraryId = libraryId ?? fallbackLibraries[0]?.id ?? null;

  useEffect(() => {
    const nextState = parseTableState(searchParams);

    setTableState((current) => (isSameTableState(current, nextState) ? current : nextState));
    setSearchValue((current) => (current === nextState.search ? current : nextState.search));
  }, [searchParams]);

  useEffect(() => {
    setTableState((current) => {
      if (current.search === debouncedSearchValue) return current;

      return {
        ...current,
        page: 1,
        search: debouncedSearchValue.trim(),
      };
    });
  }, [debouncedSearchValue]);

  useEffect(() => {
    const nextParams = createTableSearchParams(tableState);
    const nextValue = nextParams.toString();

    if (nextValue !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams, tableState]);

  const studentsParams = useMemo<StudentsListParams>(
    () => ({
      gender: tableState.gender,
      libraryId: resolvedLibraryId,
      limit: tableState.limit,
      page: tableState.page,
      paymentStatus: tableState.paymentStatus,
      search: tableState.search,
      seatNumber: tableState.seatNumber,
    }),
    [resolvedLibraryId, tableState],
  );

  const studentsQuery = useQuery({
    queryKey: ["students-dashboard-table", studentsParams],
    queryFn: () => fetchStudentsPage(studentsParams),
    enabled: !!resolvedLibraryId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!resolvedLibraryId || !studentsQuery.data) return;
    if (tableState.page >= studentsQuery.data.totalPages) return;

    const nextPageParams = {
      ...studentsParams,
      page: tableState.page + 1,
    };

    queryClient.prefetchQuery({
      queryKey: ["students-dashboard-table", nextPageParams],
      queryFn: () => fetchStudentsPage(nextPageParams),
      staleTime: 30_000,
    });
  }, [queryClient, resolvedLibraryId, studentsParams, studentsQuery.data, tableState.page]);

  useEffect(() => {
    if (!studentsQuery.data?.totalPages) return;
    if (tableState.page <= studentsQuery.data.totalPages) return;

    setTableState((current) => ({
      ...current,
      page: studentsQuery.data?.totalPages ?? 1,
    }));
  }, [studentsQuery.data?.totalPages, tableState.page]);

  const students = studentsQuery.data?.data ?? [];
  const summary = studentsQuery.data?.summary ?? buildStudentsSummaryFromPage(students);
  const isSummaryApproximate = !studentsQuery.data?.summary;
  const loading = currentLibraryLoading || fallbackLoading;
  const isEmpty = !studentsQuery.isLoading && students.length === 0;
  const canEditStudents = userRoles.some((role) => role.role === "super_admin" || role.role === "library_owner");
  const hasActiveFilters =
    tableState.gender !== "all" || tableState.search.length > 0 || tableState.paymentStatus !== "all" || tableState.seatNumber.length > 0;

  const updateTableState = (updater: (current: StudentTableState) => StudentTableState) => {
    setTableState((current) => updater(current));
  };

  const patchStudentAcrossCaches = useCallback(
    (studentId: string, updater: (student: StudentListItem) => StudentListItem) => {
      queryClient.setQueriesData({ queryKey: ["students-dashboard-table"] }, (current: StudentsListResponse | undefined) => {
        if (!current) return current;

        let changed = false;
        const nextData = current.data.map((student) => {
          if (student.id !== studentId) return student;
          changed = true;
          return updater(student);
        });

        return changed ? { ...current, data: nextData } : current;
      });
    },
    [queryClient],
  );

  const restoreStudentTableSnapshots = useCallback(
    (snapshots: Array<[readonly unknown[], StudentsListResponse | undefined]>) => {
      snapshots.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    [queryClient],
  );

  const invalidateStudentRelatedQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["students-dashboard-table"] });
    queryClient.invalidateQueries({ queryKey: ["students-form-students", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["seat-map-students", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-overview", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["analytics-overview", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["finance-dashboard", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["recovery-queue", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["payments-ledger", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["payments-ledger-summary", resolvedLibraryId] });
    queryClient.invalidateQueries({ queryKey: ["students-payment-tracking", resolvedLibraryId] });
  }, [queryClient, resolvedLibraryId]);

  const upsertPhotoJob = useCallback((studentId: string, nextJob: StudentPhotoJob) => {
    const timeoutId = photoJobTimeoutsRef.current[studentId];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete photoJobTimeoutsRef.current[studentId];
    }

    const previousJob = photoJobsRef.current[studentId];
    if (previousJob?.previewUrl && previousJob.previewUrl !== nextJob.previewUrl) {
      URL.revokeObjectURL(previousJob.previewUrl);
    }

    setPhotoJobs((current) => ({
      ...current,
      [studentId]: nextJob,
    }));
    photoJobsRef.current = {
      ...photoJobsRef.current,
      [studentId]: nextJob,
    };
  }, []);

  const clearPhotoJob = useCallback((studentId: string) => {
    const timeoutId = photoJobTimeoutsRef.current[studentId];
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      delete photoJobTimeoutsRef.current[studentId];
    }

    const previousJob = photoJobsRef.current[studentId];
    if (previousJob?.previewUrl) {
      URL.revokeObjectURL(previousJob.previewUrl);
    }

    setPhotoJobs((current) => {
      if (!current[studentId]) return current;
      const next = { ...current };
      delete next[studentId];
      photoJobsRef.current = next;
      return next;
    });
  }, []);

  const schedulePhotoJobClear = useCallback(
    (studentId: string, delayMs = 1600) => {
      const timeoutId = window.setTimeout(() => {
        delete photoJobTimeoutsRef.current[studentId];
        clearPhotoJob(studentId);
      }, delayMs);

      photoJobTimeoutsRef.current[studentId] = timeoutId;
    },
    [clearPhotoJob],
  );

  const isStudentPhotoBusy = useCallback((studentId: string) => {
    const status = photoJobsRef.current[studentId]?.status;
    return status === "uploading" || status === "processing";
  }, []);

  const setAadhaarJobStatus = useCallback((studentId: string, status: StudentAadhaarJob["status"]) => {
    setAadhaarJobs((current) => ({
      ...current,
      [studentId]: { status },
    }));
  }, []);

  const clearAadhaarJob = useCallback((studentId: string) => {
    setAadhaarJobs((current) => {
      if (!current[studentId]) return current;
      const next = { ...current };
      delete next[studentId];
      return next;
    });
  }, []);

  const isStudentAadhaarBusy = useCallback(
    (studentId: string) => {
      const status = aadhaarJobs[studentId]?.status;
      return status === "opening" || status === "uploading";
    },
    [aadhaarJobs],
  );

  const uploadStudentPhotoInBackground = useCallback(
    async ({
      file,
      previewUrl,
      studentId,
    }: {
      file: File;
      previewUrl: string;
      studentId: string;
    }) => {
      if (!user?.id) {
        toast({
          title: "Photo upload failed",
          description: "Your session is missing the account context needed for this upload.",
          variant: "destructive",
        });
        return;
      }

      if (isStudentPhotoBusy(studentId)) {
        toast({
          title: "Photo upload already in progress",
          description: "Please wait for the current upload to finish before trying again.",
        });
        return;
      }

      upsertPhotoJob(studentId, {
        error: null,
        file,
        progress: 0,
        previewUrl,
        status: "uploading",
      });

      try {
        const draftUpload = await uploadStudentPhotoDraftAssets({
          file,
          libraryId: resolvedLibraryId,
          onProgress: (progress) => {
            setPhotoJobs((current) => {
              const existingJob = current[studentId];
              if (!existingJob || existingJob.status !== "uploading") return current;

              return {
                ...current,
                [studentId]: {
                  ...existingJob,
                  progress,
                },
              };
            });
          },
          studentId,
          userId: user.id,
        });

        setPhotoJobs((current) => {
          const existingJob = current[studentId];
          if (!existingJob) return current;

          return {
            ...current,
            [studentId]: {
              ...existingJob,
              progress: 100,
              status: "processing",
            },
          };
        });

        const uploadResult = await finalizeStudentPhotoUpload({
          file,
          libraryId: resolvedLibraryId,
          preferClientFinalization: draftUpload.bypassedTempUpload,
          studentId,
          tempOriginalPath: draftUpload.tempOriginalPath,
          userId: user.id,
        });

        patchStudentAcrossCaches(studentId, (student) => ({
          ...student,
          photoUrl: uploadResult.thumbnailUrl || uploadResult.originalUrl,
        }));

        upsertPhotoJob(studentId, {
          error: null,
          file,
          progress: 100,
          previewUrl,
          status: "success",
        });
        schedulePhotoJobClear(studentId);
        queryClient.invalidateQueries({ queryKey: ["students-dashboard-table"] });
      } catch (error) {
        const message = getPhotoUploadErrorMessage(error);
        setPhotoJobs((current) => ({
          ...current,
          [studentId]: {
            ...(current[studentId] ?? {
              file,
              progress: 0,
              previewUrl,
            }),
            error: message,
            file,
            progress: current[studentId]?.progress ?? 0,
            previewUrl,
            status: "failed",
          },
        }));

        toast({
          title: "Photo upload failed",
          description: message,
          variant: "destructive",
        });

        if (/newer photo upload already completed/i.test(message)) {
          queryClient.invalidateQueries({ queryKey: ["students-dashboard-table"] });
        }
      }
    },
    [isStudentPhotoBusy, patchStudentAcrossCaches, queryClient, resolvedLibraryId, schedulePhotoJobClear, toast, upsertPhotoJob, user?.id],
  );

  const resetFilters = () => {
    setSearchValue("");
    setTableState((current) => ({
      ...current,
      gender: "all",
      page: 1,
      paymentStatus: "all",
      search: "",
      seatNumber: "",
    }));
  };

  const markPaidMutation = useMutation({
    mutationFn: async (student: StudentListItem) => {
      if (!resolvedLibraryId) {
        throw new Error("Library not linked for this account.");
      }

      await markStudentPaid({
        libraryId: resolvedLibraryId,
        student,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to mark student as paid",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({ title: "Payment status updated" });
      queryClient.invalidateQueries({ queryKey: ["students-dashboard-table"] });
    },
  });

  const editStudentMutation = useMutation({
    mutationFn: async ({
      optimisticPatch,
      payload,
      student,
    }: {
      optimisticPatch: Partial<Pick<StudentListItem, "dueDate" | "gender" | "name" | "phone" | "plan" | "seatNo" | "status">>;
      payload: StudentEditPayload;
      student: StudentListItem;
    }) =>
      updateStudent({
        payload,
        studentId: student.id,
      }),
    onMutate: async ({ optimisticPatch, student }) => {
      await queryClient.cancelQueries({ queryKey: ["students-dashboard-table"] });

      const snapshots = queryClient.getQueriesData<StudentsListResponse>({
        queryKey: ["students-dashboard-table"],
      });
      const savingToast = toast({
        title: "Saving student changes...",
        description: `Updating ${optimisticPatch.name ?? student.name}.`,
      });

      patchStudentAcrossCaches(student.id, (current) => ({
        ...current,
        ...optimisticPatch,
      }));

      return {
        savingToast,
        snapshots,
      };
    },
    onError: (error: Error, _variables, context) => {
      if (context?.snapshots) {
        restoreStudentTableSnapshots(context.snapshots);
      }

      context?.savingToast.update({
        title: "Unable to update student",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: (response, variables, context) => {
      patchStudentAcrossCaches(variables.student.id, (current) => ({
        ...current,
        amountDue: response.student.amountDue,
        amountPaid: response.student.amountPaid,
        dueDate: response.student.dueDate,
        gender: response.student.gender,
        name: response.student.name,
        phone: response.student.phone,
        plan: response.student.plan,
        seatNo: response.student.seatNo,
        status: response.student.status,
      }));

      context?.savingToast.update({
        title: "Student updated",
        description: `${response.student.name}'s ledger row has been refreshed.`,
      });
      setEditingStudent(null);
      invalidateStudentRelatedQueries();
    },
  });

  const handleMarkPaid = (student: StudentListItem) => {
    markPaidMutation.mutate(student);
  };

  const handleOpenEditStudent = useCallback(
    (student: StudentListItem) => {
      if (!canEditStudents) {
        toast({
          title: "Editing is restricted",
          description: "Only admins or superadmins can edit student records.",
          variant: "destructive",
        });
        return;
      }

      setEditingStudent(student);
    },
    [canEditStudents, toast],
  );

  const handleSaveStudent = useCallback(
    async (
      payload: StudentEditPayload,
      optimisticPatch: Partial<Pick<StudentListItem, "dueDate" | "gender" | "name" | "phone" | "plan" | "seatNo" | "status">>,
    ) => {
      if (!editingStudent) {
        throw new Error("Select a student before saving edits.");
      }

      await editStudentMutation.mutateAsync({
        optimisticPatch,
        payload,
        student: editingStudent,
      });
    },
    [editStudentMutation, editingStudent],
  );

  const handleQueuedPhotoUpload = useCallback(
    ({ file, studentId }: { file: File; studentId: string }) => {
      if (isStudentPhotoBusy(studentId)) return;

      const previewUrl = URL.createObjectURL(file);
      void uploadStudentPhotoInBackground({
        file,
        previewUrl,
        studentId,
      });
    },
    [isStudentPhotoBusy, uploadStudentPhotoInBackground],
  );

  const handleReplacePhoto = useCallback(
    (student: StudentListItem, file: File) => {
      const validationError = getStudentPhotoValidationError(file);
      if (validationError) {
        toast({
          title: "Invalid photo",
          description: validationError,
          variant: "destructive",
        });
        return;
      }

      if (isStudentPhotoBusy(student.id)) {
        toast({
          title: "Photo upload already in progress",
          description: "Please wait for the current upload to finish before replacing this photo again.",
        });
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      void uploadStudentPhotoInBackground({
        file,
        previewUrl,
        studentId: student.id,
      });
    },
    [isStudentPhotoBusy, toast, uploadStudentPhotoInBackground],
  );

  const handleRetryPhotoUpload = useCallback(
    (student: StudentListItem) => {
      const job = photoJobsRef.current[student.id];
      if (!job) return;
      if (job.status === "uploading" || job.status === "processing") return;

      void uploadStudentPhotoInBackground({
        file: job.file,
        previewUrl: job.previewUrl,
        studentId: student.id,
      });
    },
    [uploadStudentPhotoInBackground],
  );

  const handleUploadAadhaar = useCallback(
    async (student: StudentListItem, file: File) => {
      if (!resolvedLibraryId) {
        toast({
          title: "Aadhaar upload failed",
          description: "Library not linked for this account.",
          variant: "destructive",
        });
        return;
      }

      const validationError = getStudentAadhaarValidationError(file);
      if (validationError) {
        toast({
          title: "Invalid Aadhaar file",
          description: validationError,
          variant: "destructive",
        });
        return;
      }

      if (isStudentAadhaarBusy(student.id)) {
        toast({
          title: "Aadhaar action already in progress",
          description: "Please wait for the current Aadhaar action to finish before trying again.",
        });
        return;
      }

      const nextAadhaarPath = buildAadhaarDocumentPath({
        fileName: file.name,
        libraryId: resolvedLibraryId,
      });

      setAadhaarJobStatus(student.id, "uploading");

      try {
        const { error: uploadError } = await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).upload(nextAadhaarPath, file, {
          cacheControl: "3600",
          contentType: file.type || "image/png",
          upsert: false,
        });

        if (uploadError) throw uploadError;

        const { data: updatedStudent, error: updateError } = await supabase
          .from("students")
          .update({
            aadhaar_photo_path: nextAadhaarPath,
          })
          .eq("id", student.id)
          .eq("library_id", resolvedLibraryId)
          .select("id")
          .maybeSingle();

        if (updateError || !updatedStudent) {
          await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).remove([nextAadhaarPath]);
          throw updateError ?? new Error("Unable to save the Aadhaar document for this student.");
        }

        patchStudentAcrossCaches(student.id, (current) => ({
          ...current,
          aadhaarPhotoPath: nextAadhaarPath,
        }));

        if (student.aadhaarPhotoPath && student.aadhaarPhotoPath !== nextAadhaarPath) {
          await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).remove([student.aadhaarPhotoPath]);
        }

        toast({
          title: student.aadhaarPhotoPath ? "Aadhaar updated" : "Aadhaar uploaded",
          description: `${student.name}'s Aadhaar image is ready to view from the ledger.`,
        });
        queryClient.invalidateQueries({ queryKey: ["students-dashboard-table"] });
      } catch (error) {
        toast({
          title: "Aadhaar upload failed",
          description: getAadhaarUploadErrorMessage(error),
          variant: "destructive",
        });
      } finally {
        clearAadhaarJob(student.id);
      }
    },
    [clearAadhaarJob, isStudentAadhaarBusy, patchStudentAcrossCaches, queryClient, resolvedLibraryId, setAadhaarJobStatus, toast],
  );

  const handleViewAadhaar = useCallback(
    async (student: StudentListItem) => {
      if (!student.aadhaarPhotoPath) {
        toast({
          title: "Aadhaar unavailable",
          description: "Upload the Aadhaar image first to view it from the ledger.",
        });
        return;
      }

      if (isStudentAadhaarBusy(student.id)) {
        return;
      }

      setAadhaarJobStatus(student.id, "opening");

      try {
        const { data, error } = await supabase.storage.from(STUDENT_DOCUMENTS_BUCKET).createSignedUrl(student.aadhaarPhotoPath, 600);
        if (error) throw error;

        window.open(data.signedUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        toast({
          title: "Unable to open Aadhaar",
          description:
            error instanceof Error
              ? error.message
              : "Try again in a moment.",
          variant: "destructive",
        });
      } finally {
        clearAadhaarJob(student.id);
      }
    },
    [clearAadhaarJob, isStudentAadhaarBusy, setAadhaarJobStatus, toast],
  );

  const errorMessage = getSafeErrorMessage(studentsQuery.error, "Unable to load students right now.");

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="space-y-4">
          <div className="space-y-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                    Server Pagination
                  </Badge>
                  <Badge variant="outline" className="rounded-full px-3 py-1">
                    10,000+ records ready
                  </Badge>
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground">Students</h1>
                  <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                    A fast, API-backed roster for seat allocations, payment follow-ups, and day-to-day student operations. Search,
                    filter, and page through the list without loading the full dataset into the browser.
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 xl:max-w-[32rem] xl:items-end">
                <AddStudentDialog disabled={loading} libraryId={resolvedLibraryId} onPhotoUploadRequest={handleQueuedPhotoUpload} />
                <div className="w-full rounded-3xl border border-border/70 bg-card/80 px-4 py-3 shadow-sm backdrop-blur">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Dashboard View</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {loading
                          ? "Resolving library access..."
                          : studentsQuery.isFetching
                            ? "Refreshing current result set."
                            : "Sticky filters, sticky table headers, and page-safe filters are active."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <StudentSummaryCards
              isLoading={loading || studentsQuery.isLoading}
              isSummaryApproximate={isSummaryApproximate}
              summary={summary}
            />
          </div>
        </section>

        {!resolvedLibraryId && !loading ? (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No library is linked to this account</AlertTitle>
            <AlertDescription>
              Connect a library first so the students dashboard knows which roster to fetch.
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="sticky top-0 z-20 bg-background/95 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/85">
          <StudentsFilters
            isFetching={studentsQuery.isFetching}
            onClearFilters={resetFilters}
            onLimitChange={(value) =>
              updateTableState((current) => ({
                ...current,
                limit: value,
                page: 1,
              }))
            }
            onGenderChange={(value) =>
              updateTableState((current) => ({
                ...current,
                gender: value,
                page: 1,
              }))
            }
            onPaymentStatusChange={(value) =>
              updateTableState((current) => ({
                ...current,
                page: 1,
                paymentStatus: value,
              }))
            }
            onSearchChange={setSearchValue}
            onSeatNumberChange={(value) =>
              updateTableState((current) => ({
                ...current,
                page: 1,
                seatNumber: value.trimStart(),
              }))
            }
            gender={tableState.gender}
            paymentStatus={tableState.paymentStatus}
            rowsPerPage={tableState.limit}
            searchValue={searchValue}
            seatNumber={tableState.seatNumber}
            showClearFilters={hasActiveFilters}
          />
        </section>

        {studentsQuery.isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Students API request failed</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{errorMessage}</span>
              <Button type="button" size="sm" variant="outline" className="w-fit rounded-xl" onClick={() => studentsQuery.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card/95 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border/70 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">Student Ledger</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Payment follow-up states stay intact while you move between pages, change page size, or refine filters.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasActiveFilters ? (
                <Badge variant="outline" className="rounded-full px-3 py-1">
                  Filtered view
                </Badge>
              ) : null}
              {isEmpty ? (
                <Badge variant="outline" className="rounded-full border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
                  No matching students
                </Badge>
              ) : null}
              <Button type="button" variant="ghost" className="rounded-xl text-sm" onClick={() => studentsQuery.refetch()}>
                Refresh
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <StudentsTable
            aadhaarJobs={aadhaarJobs}
            actionStudentId={markPaidMutation.isPending ? markPaidMutation.variables?.id ?? null : null}
            canEditStudents={canEditStudents}
            isFetching={studentsQuery.isFetching && !studentsQuery.isLoading}
            isLoading={loading || studentsQuery.isLoading}
            onEditStudent={handleOpenEditStudent}
            onMarkPaid={handleMarkPaid}
            onReplacePhoto={handleReplacePhoto}
            onResetFilters={resetFilters}
            onRetryPhotoUpload={handleRetryPhotoUpload}
            onUploadAadhaar={handleUploadAadhaar}
            onViewAadhaar={handleViewAadhaar}
            photoJobs={photoJobs}
            students={students}
          />

          {!studentsQuery.isLoading && !studentsQuery.isError ? (
            <StudentsPagination
              onPageChange={(page) =>
                updateTableState((current) => ({
                  ...current,
                  page,
                }))
              }
              page={studentsQuery.data?.page ?? tableState.page}
              pageSize={tableState.limit}
              total={studentsQuery.data?.total ?? 0}
              totalPages={studentsQuery.data?.totalPages ?? 1}
            />
          ) : null}
        </section>

        <EditStudentDialog
          isOpen={!!editingStudent}
          isSaving={editStudentMutation.isPending}
          libraryId={resolvedLibraryId}
          onOpenChange={(open) => {
            if (!open && !editStudentMutation.isPending) {
              setEditingStudent(null);
            }
          }}
          onSave={handleSaveStudent}
          student={editingStudent}
        />
      </div>
    </DashboardLayout>
  );
};

export default StudentsPage;
