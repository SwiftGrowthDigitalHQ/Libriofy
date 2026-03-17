import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type TopPerformingLibraryRow = {
  id: string;
  name: string;
  city: string | null;
  occupancy: number;
};

const badgeVariantForOccupancy = (occupancy: number): "default" | "secondary" | "outline" | "destructive" => {
  if (occupancy >= 90) return "destructive";
  if (occupancy >= 70) return "default";
  if (occupancy >= 40) return "secondary";
  return "outline";
};

const TopPerformingLibrariesCard = ({ rows, isLoading }: { rows: TopPerformingLibraryRow[]; isLoading: boolean }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">Top Performing Libraries</h3>
        <p className="mt-1 text-xs text-muted-foreground">Sorted by seat occupancy.</p>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No libraries yet.</div>
        ) : (
          <ScrollArea className="h-[420px] rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Library Name</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-right">Seat Occupancy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium text-foreground">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.city || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={badgeVariantForOccupancy(row.occupancy)}>{row.occupancy}%</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};

export default TopPerformingLibrariesCard;

