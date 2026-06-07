import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarDays, Clock3, ShieldCheck, UserRoundCheck } from "lucide-react";

import DashboardLayout from "@/components/dashboard/DashboardLayout";
import AttendanceLog from "@/components/dashboard/AttendanceLog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
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

  const {
    data: monthlyAttendance = [],
    isLoading: monthlyLoading,
    error: monthlyError,
  } = useQuery({
    queryKey: ["monthly-attendance-analytics", resolvedLibraryId],
    queryFn: async (): Promise<MonthlyAttendanceRow[]> => {
      if (!resolvedLibraryId) return [];

      const { data, error } = await supabase.rpc("get_monthly_attendance_analytics", {
        p_library_id: resolvedLibraryId,
      });

      if (error) throw error;
      return (data ?? []) as MonthlyAttendanceRow[];
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
