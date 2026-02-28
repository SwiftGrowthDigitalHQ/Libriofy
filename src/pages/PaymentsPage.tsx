import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const payments = [
  { id: "PAY-001", student: "Aarav Sharma", amount: "₹4,500", plan: "Full Day", date: "Feb 25, 2026", status: "Paid" },
  { id: "PAY-002", student: "Priya Mehta", amount: "₹2,000", plan: "4 Hour", date: "Feb 24, 2026", status: "Paid" },
  { id: "PAY-003", student: "Rahul Kumar", amount: "₹3,000", plan: "6 Hour", date: "Feb 23, 2026", status: "Pending" },
  { id: "PAY-004", student: "Sneha Tiwari", amount: "₹4,500", plan: "Full Day", date: "Feb 22, 2026", status: "Paid" },
  { id: "PAY-005", student: "Vikram Patel", amount: "₹2,000", plan: "4 Hour", date: "Feb 20, 2026", status: "Failed" },
];

const PaymentsPage = () => (
  <DashboardLayout>
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-display text-foreground">Payments</h2>
        <p className="text-sm text-muted-foreground mt-1">Track all payment transactions</p>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.id}</TableCell>
                  <TableCell className="font-medium text-foreground">{p.student}</TableCell>
                  <TableCell className="font-semibold text-foreground">{p.amount}</TableCell>
                  <TableCell className="text-muted-foreground">{p.plan}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{p.date}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === "Paid" ? "default" : p.status === "Pending" ? "secondary" : "destructive"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  </DashboardLayout>
);

export default PaymentsPage;
