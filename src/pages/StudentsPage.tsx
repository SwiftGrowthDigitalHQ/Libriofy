import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Download, Plus } from "lucide-react";
import { exportToCsv } from "@/lib/exportCsv";

const students = [
  { name: "Aarav Sharma", phone: "98765xxxxx", seat: "A1", plan: "Full Day", slot: "6AM–10PM", expiry: "Mar 15, 2026", status: "Active" },
  { name: "Priya Mehta", phone: "98764xxxxx", seat: "A5", plan: "4 Hour", slot: "10AM–2PM", expiry: "Mar 20, 2026", status: "Active" },
  { name: "Rahul Kumar", phone: "98763xxxxx", seat: "B2", plan: "6 Hour", slot: "6AM–12PM", expiry: "Feb 28, 2026", status: "Expiring" },
  { name: "Sneha Tiwari", phone: "98762xxxxx", seat: "C4", plan: "Full Day", slot: "6AM–10PM", expiry: "Mar 25, 2026", status: "Active" },
  { name: "Vikram Patel", phone: "98761xxxxx", seat: "—", plan: "4 Hour", slot: "2PM–6PM", expiry: "Feb 25, 2026", status: "Expired" },
  { name: "Neha Gupta", phone: "98760xxxxx", seat: "D1", plan: "6 Hour", slot: "10AM–4PM", expiry: "Apr 01, 2026", status: "Active" },
];

const statusVariant = (status: string) => {
  if (status === "Active") return "default";
  if (status === "Expiring") return "secondary";
  return "destructive";
};

const StudentsPage = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold font-display text-foreground">Students</h2>
            <p className="text-sm text-muted-foreground mt-1">Manage all enrolled students</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportToCsv("students", students)}><Download className="w-4 h-4 mr-1" /> Export</Button>
            <Button size="sm" className="bg-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Add Student</Button>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search students..." className="pl-9" />
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Seat</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((s) => (
                  <TableRow key={s.name} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium text-foreground">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.phone}</TableCell>
                    <TableCell><span className="font-mono text-xs bg-secondary px-2 py-0.5 rounded">{s.seat}</span></TableCell>
                    <TableCell className="text-muted-foreground">{s.plan}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.slot}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.expiry}</TableCell>
                    <TableCell><Badge variant={statusVariant(s.status)}>{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentsPage;
