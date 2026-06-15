import { useEffect, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { format } from "date-fns";
import { Clock, LogIn, LogOut } from "lucide-react";
import { getSafeErrorMessage } from "@/lib/errorHandling";

interface AttendanceLogProps {
  libraryId?: string | null;
}

type AttendanceRow = Pick<
  Database["public"]["Tables"]["attendance_logs"]["Row"],
  "id" | "check_in" | "check_out" | "student_id" | "date"
> & {
  students: {
    full_name: string | null;
    seat_number: string | null;
  } | null;
};

const PAGE_SIZE = 10;

const AttendanceLog = ({ libraryId }: AttendanceLogProps) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [libraryId]);

  const {
    data: attendancePage,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["attendance-logs-today", libraryId, page],
    queryFn: async (): Promise<{ logs: AttendanceRow[]; totalCount: number }> => {
      if (!libraryId) return { logs: [], totalCount: 0 };
      const today = new Date().toISOString().split("T")[0];
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count, error } = await supabase
        .from("attendance_logs")
        .select("id, check_in, check_out, student_id, date, students:student_id(full_name, seat_number)")
        .select("id, check_in, check_out, student_id, date, students:student_id(full_name, seat_number)", {
          count: "exact",
        })
        .eq("library_id", libraryId)
        .eq("date", today)
        .order("check_in", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return {
        logs: (data ?? []) as AttendanceRow[],
        totalCount: count ?? 0,
      };
    },
    enabled: !!libraryId,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });

  const logs = attendancePage?.logs ?? [];
  const totalCount = attendancePage?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const showPagination = totalCount > PAGE_SIZE;
  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  useEffect(() => {
    if (!showPagination) {
      if (page !== 1) {
        setPage(1);
      }
      return;
    }

    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, showPagination, totalPages]);

  // Realtime subscription for instant updates
  useEffect(() => {
    if (!libraryId) return;
    const channel = supabase
      .channel(`attendance-logs-${libraryId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "attendance_logs", filter: `library_id=eq.${libraryId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["attendance-logs-today", libraryId] });
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [libraryId, queryClient]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          Today's Attendance
          <Badge variant="outline" className="ml-auto">
            {totalCount} entries
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : error ? (
          <p className="text-sm text-destructive py-8 text-center">
            Unable to load attendance logs: {getSafeErrorMessage(error)}
          </p>
        ) : !libraryId ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Library not linked for this account.</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No attendance logs yet today.</p>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Seat</TableHead>
                    <TableHead>Check In</TableHead>
                    <TableHead>Check Out</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium text-foreground">{log.students?.full_name || "Unknown"}</TableCell>
                      <TableCell className="text-muted-foreground">{log.students?.seat_number || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <LogIn className="w-3.5 h-3.5 text-success" />
                          {format(new Date(log.check_in), "hh:mm a")}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {log.check_out ? (
                          <div className="flex items-center gap-1.5">
                            <LogOut className="w-3.5 h-3.5 text-info" />
                            {format(new Date(log.check_out), "hh:mm a")}
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.check_out ? "secondary" : "default"}>
                          {log.check_out ? "Completed" : "In Library"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {showPagination ? (
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing {Math.min((page - 1) * PAGE_SIZE + 1, totalCount)}-{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Page {page} of {totalPages}
                  </Badge>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={!canGoPrevious}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={!canGoNext}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AttendanceLog;
