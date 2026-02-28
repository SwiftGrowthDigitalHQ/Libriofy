import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { format } from "date-fns";
import { Clock, LogIn, LogOut } from "lucide-react";

const AttendanceLog = () => {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["attendance-logs-today"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("attendance_logs" as any)
        .select("*, students:student_id(full_name, seat_number)")
        .eq("date", today)
        .order("check_in", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 10000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" />
          Today's Attendance
          <Badge variant="outline" className="ml-auto">{logs.length} entries</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
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
              {logs.map((log: any) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium text-foreground">
                    {log.students?.full_name || "Unknown"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.students?.seat_number || "—"}
                  </TableCell>
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
                    ) : "—"}
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
