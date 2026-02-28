import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StudentQRCard from "@/components/dashboard/StudentQRCard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Search, QrCode, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatsCard from "@/components/dashboard/StatsCard";

const QRCodesPage = () => {
  const [search, setSearch] = useState("");

  const { data: students = [], isLoading } = useQuery({
    queryKey: ["students-qr"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students" as any)
        .select("*")
        .order("full_name");
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = students.filter((s: any) =>
    s.full_name.toLowerCase().includes(search.toLowerCase()) ||
    s.qr_code.toLowerCase().includes(search.toLowerCase())
  );

  const activeCount = students.filter((s: any) => s.status === "active").length;
  const inactiveCount = students.filter((s: any) => s.status === "inactive").length;
  const noShowCount = students.filter((s: any) => s.no_show_days >= 2).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">QR Passes</h2>
          <p className="text-sm text-muted-foreground mt-1">Student digital seat passes with QR codes</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatsCard icon={QrCode} title="Total Students" value={String(students.length)} trend="up" />
          <StatsCard icon={QrCode} title="Active" value={String(activeCount)} trend="up" iconColor="text-success" />
          <StatsCard icon={AlertTriangle} title="At Risk (2+ days)" value={String(noShowCount)} trend="down" iconColor="text-warning" />
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search students..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No students found. Add students from the Students page.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((student: any) => (
              <StudentQRCard
                key={student.id}
                studentName={student.full_name}
                qrCode={student.qr_code}
                seatNumber={student.seat_number}
                plan={student.plan}
                status={student.status}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default QRCodesPage;
