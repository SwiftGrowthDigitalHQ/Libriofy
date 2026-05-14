import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

const AttendanceLog = ({ libraryId }: AttendanceLogProps) => {
  const queryClient = useQueryClient();
  const { data: logs = [], isLoading, error } = useQuery({
    queryKey: ["attendance-logs-today", libraryId],
    queryFn: async (): Promise<AttendanceRow[]> => {
      if (!libraryId) return [];
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("attendance_logs")
        .select("id, check_in, check_out, student_id, date, students:student_id(full_name, seat_number)")
        .eq("library_id", libraryId)
        .eq("date", today)
        .order("check_in", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as AttendanceRow[];
    },
    enabled: !!libraryId,
    refetchInterval: 5000,
  });

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
            {logs.length} entries
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
          <Table>
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
        )}
      </CardContent>
    </Card>
  );
};

export default AttendanceLog;
