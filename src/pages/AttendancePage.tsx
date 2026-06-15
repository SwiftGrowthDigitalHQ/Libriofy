import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format, startOfMonth, startOfDay } from "date-fns";
import { CalendarDays, Clock3, ShieldCheck, UserRoundCheck } from "lucide-react";

import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AttendanceLog from "@/components/dashboard/AttendanceLog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { getStoredAccessToken } from "@/lib/authSession";
import { getSafeErrorMessage } from "@/lib/errorHandling";

type MonthlyAttendanceRow = {
  absent_days: number;
  attendance_percent: number;
  full_name: string;
  last_check_in: string | null;
  last_check_out: string | null;
  membership_status: string | null;
  present_days: number;
  student_id: string;
};

type MonthlyAttendanceRpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type MonthlyAttendanceStudentRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "full_name" | "id" | "status"
>;

type MonthlyAttendanceLogRow = Pick<
  Database["public"]["Tables"]["attendance_logs"]["Row"],
  "check_in" | "check_out" | "date" | "student_id"
>;

const normalizeMonthlyAttendanceRows = (rows: MonthlyAttendanceRow[] | null | undefined): MonthlyAttendanceRow[] => {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      absent_days: Number(row.absent_days ?? 0),
      attendance_percent: Number(row.attendance_percent ?? 0),
      full_name: row.full_name || "Unknown Student",
      last_check_in: row.last_check_in ?? null,
      last_check_out: row.last_check_out ?? null,
      membership_status: row.membership_status ?? null,
      present_days: Number(row.present_days ?? 0),
      student_id: String(row.student_id ?? ""),
    }))
    .filter((row) => row.student_id.length > 0);
};

const isMonthlyAttendanceRpcMissing = (error: MonthlyAttendanceRpcError | null | undefined) => error?.code === "PGRST202";

const getScopeDateKey = (value: Date) => value.toISOString().split("T")[0];

const getMaxTimestamp = (current: string | null, next: string | null) => {
  if (!next) return current;
  if (!current) return next;
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
};

const buildMonthlyAttendanceFallback = async (libraryId: string, monthStart: Date): Promise<MonthlyAttendanceRow[]> => {
  const scopeStart = startOfMonth(monthStart);
  const scopeEnd = startOfDay(new Date());
  const daysInScope = Math.max(1, differenceInCalendarDays(scopeEnd, scopeStart) + 1);

  const [studentsRes, attendanceRes] = await Promise.all([
    supabase
      .from("students")
      .select("full_name, id, status")
      .eq("library_id", libraryId)
      .order("full_name", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("attendance_logs")
      .select("check_in, check_out, date, student_id")
      .eq("library_id", libraryId)
      .gte("date", getScopeDateKey(scopeStart))
      .lte("date", getScopeDateKey(scopeEnd))
      .order("date", { ascending: true })
      .order("check_in", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (studentsRes.error) throw studentsRes.error;
  if (attendanceRes.error) throw attendanceRes.error;

  const students = (studentsRes.data ?? []) as MonthlyAttendanceStudentRow[];
  const attendance = (attendanceRes.data ?? []) as MonthlyAttendanceLogRow[];

  const attendanceMap = new Map<
    string,
    {
      lastCheckIn: string | null;
      lastCheckOut: string | null;
      presentDates: Set<string>;
    }
  >();

  for (const row of attendance) {
    const dateKey = typeof row.date === "string" ? row.date : null;
    if (!dateKey || !row.student_id) continue;

    const current = attendanceMap.get(row.student_id) ?? {
      lastCheckIn: null,
      lastCheckOut: null,
      presentDates: new Set<string>(),
    };

    current.presentDates.add(dateKey);
    current.lastCheckIn = getMaxTimestamp(current.lastCheckIn, row.check_in ?? null);
    current.lastCheckOut = getMaxTimestamp(current.lastCheckOut, row.check_out ?? null);
    attendanceMap.set(row.student_id, current);
  }

  return students.map((student) => {
    const studentAttendance = attendanceMap.get(student.id);
    const presentDays = studentAttendance?.presentDates.size ?? 0;
    const absentDays = Math.max(daysInScope - presentDays, 0);
    const attendancePercent = Math.round((presentDays / daysInScope) * 10000) / 100;

    return {
      absent_days: absentDays,
      attendance_percent: attendancePercent,
      full_name: student.full_name || "Unknown Student",
      last_check_in: studentAttendance?.lastCheckIn ?? null,
      last_check_out: studentAttendance?.lastCheckOut ?? null,
      membership_status: student.status?.trim() || "unknown",
      present_days: presentDays,
      student_id: student.id,
    };
  });
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return format(date, "dd MMM, hh:mm a");
};

const membershipBadgeVariant = (status: string | null) => {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "active") {
    return "default" as const;
  }
  if (normalized === "expired") {
    return "secondary" as const;
  }

  return "outline" as const;
};

const AttendancePage = () => {
  const { user } = useAuth();
  const { libraryId, isLoading: roleLibraryLoading } = useCurrentLibraryId();

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
  const currentMonthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const {
    data: monthlyAttendance = [],
    isLoading: monthlyLoading,
    error: monthlyError,
  } = useQuery({
    queryKey: ["monthly-attendance-analytics", resolvedLibraryId],
    queryFn: async (): Promise<MonthlyAttendanceRow[]> => {
      if (!resolvedLibraryId) return [];

      const accessToken = await getStoredAccessToken();
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_monthly_attendance_analytics`, {
        method: "POST",
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: accessToken ? `Bearer ${accessToken}` : `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_library_id: resolvedLibraryId,
          p_month: currentMonthStart,
        }),
      });

      const payload = (await response.json().catch(() => null)) as MonthlyAttendanceRpcError | MonthlyAttendanceRow[] | null;

      if (!response.ok) {
        if (isMonthlyAttendanceRpcMissing(payload as MonthlyAttendanceRpcError | null)) {
          return normalizeMonthlyAttendanceRows(await buildMonthlyAttendanceFallback(resolvedLibraryId, new Date()));
        }

        throw Object.assign(new Error(payload?.message || `Monthly attendance RPC failed with status ${response.status}`), payload ?? {});
      }

      return normalizeMonthlyAttendanceRows(payload as MonthlyAttendanceRow[] | null | undefined);
    },
    enabled: !!resolvedLibraryId,
  });

  const currentMonthLabel = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date());

  const averageAttendance =
    monthlyAttendance.length > 0
      ? (
          monthlyAttendance.reduce((sum, row) => sum + Number(row.attendance_percent || 0), 0) /
          monthlyAttendance.length
        ).toFixed(1)
      : "0.0";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Attendance</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Read-only analytics and daily logs. Attendance writes only happen through <span className="font-medium">/scan</span>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              {currentMonthLabel}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Scan-only write path
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader className="space-y-2">
              <CardTitle className="text-lg font-display flex items-center gap-2">
                <UserRoundCheck className="w-5 h-5 text-primary" />
                Monthly Attendance Analytics
              </CardTitle>
              <CardDescription>
                Present and absent day totals for the current month, grouped by student.
              </CardDescription>
              <div className="flex flex-wrap gap-2 pt-1 text-xs text-muted-foreground">
                <span>{monthlyAttendance.length} students</span>
                <span>Average attendance {averageAttendance}%</span>
              </div>
            </CardHeader>
            <CardContent>
              {monthlyLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">Loading monthly attendance...</p>
              ) : monthlyError ? (
                <p className="text-sm text-destructive py-8 text-center">
                  Unable to load monthly attendance analytics: {getSafeErrorMessage(monthlyError)}
                </p>
              ) : !resolvedLibraryId && !roleLibraryLoading && !fallbackLoading ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Library not linked for this account.
                </p>
              ) : monthlyAttendance.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No monthly attendance data is available yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Student Name</TableHead>
                        <TableHead className="text-right">Present Days</TableHead>
                        <TableHead className="text-right">Absent Days</TableHead>
                        <TableHead className="text-right">Attendance %</TableHead>
                        <TableHead>Last Check-In</TableHead>
                        <TableHead>Last Check-Out</TableHead>
                        <TableHead>Membership Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthlyAttendance.map((row) => (
                        <TableRow key={row.student_id}>
                          <TableCell className="font-medium text-foreground">{row.full_name || "Unknown Student"}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{row.present_days}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{row.absent_days}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {Number(row.attendance_percent || 0).toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Clock3 className="h-3.5 w-3.5 text-success" />
                              {formatDateTime(row.last_check_in)}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              <Clock3 className="h-3.5 w-3.5 text-info" />
                              {formatDateTime(row.last_check_out)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={membershipBadgeVariant(row.membership_status)}>
                              {row.membership_status || "Unknown"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="xl:col-span-1">
            <AttendanceLog libraryId={resolvedLibraryId} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AttendancePage;
