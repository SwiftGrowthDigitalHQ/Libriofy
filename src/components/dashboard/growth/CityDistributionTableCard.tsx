import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type CityDistributionRow = {
  city: string;
  state: string;
  libraries: number;
};

const CityDistributionTableCard = ({ rows, isLoading }: { rows: CityDistributionRow[]; isLoading: boolean }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">City Distribution</h3>
        <p className="mt-1 text-xs text-muted-foreground">Sorted by libraries descending.</p>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No city data yet.</div>
        ) : (
          <ScrollArea className="h-[420px] rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>City</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Libraries</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.state}-${row.city}`}>
                    <TableCell className="font-medium text-foreground">{row.city}</TableCell>
                    <TableCell className="text-muted-foreground">{row.state}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.libraries}</TableCell>
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

export default CityDistributionTableCard;

