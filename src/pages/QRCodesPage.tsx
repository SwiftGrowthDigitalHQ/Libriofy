import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, QrCode, AlertTriangle } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import StudentQRCard from "@/components/dashboard/StudentQRCard";
import StatsCard from "@/components/dashboard/StatsCard";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentLibraryId } from "@/hooks/useCurrentLibraryId";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type StudentQrRow = Pick<
  Database["public"]["Tables"]["students"]["Row"],
  "id" | "full_name" | "qr_code" | "seat_number" | "plan" | "status" | "no_show_days"
>;

const QRCodesPage = () => {
  const [search, setSearch] = useState("");
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
    data: students = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["students-qr", resolvedLibraryId],
    queryFn: async (): Promise<StudentQrRow[]> => {
      if (!resolvedLibraryId) return [];
      const { data, error: queryError } = await supabase
        .from("students")
        .select("id, full_name, qr_code, seat_number, plan, status, no_show_days")
        .eq("library_id", resolvedLibraryId)
        .order("full_name", { ascending: true });
      if (queryError) throw queryError;
      return data;
    },
    enabled: !!resolvedLibraryId,
    refetchInterval: 10000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((student) =>
      [student.full_name, student.qr_code, student.seat_number || ""].some((value) => value.toLowerCase().includes(q)),
    );
  }, [search, students]);

  const activeCount = students.filter((student) => student.status === "active").length;
  const noShowCount = students.filter((student) => (student.no_show_days || 0) >= 2).length;
  const loading = roleLibraryLoading || fallbackLoading || isLoading;

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

        {!resolvedLibraryId && !loading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-destructive">Library not linked to your account. Please check user role setup.</p>
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-destructive">Unable to load QR passes: {error.message}</p>
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <QrCode className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground">No students found. Add students from the Students page.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((student) => (
              <StudentQRCard
                key={student.id}
                studentName={student.full_name}
                qrCode={student.qr_code}
                seatNumber={student.seat_number || undefined}
                plan={student.plan || undefined}
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
