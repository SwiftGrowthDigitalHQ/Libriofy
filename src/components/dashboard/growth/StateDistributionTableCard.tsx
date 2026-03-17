import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type AdoptionLevel = "High" | "Medium" | "None";

export type StateDistributionRow = {
  state: string;
  libraries: number;
  adoption: AdoptionLevel;
};

const badgeVariantForAdoption = (adoption: AdoptionLevel) => {
  if (adoption === "High") return "default";
  if (adoption === "Medium") return "secondary";
  return "outline";
};

const StateDistributionTableCard = ({ rows, isLoading }: { rows: StateDistributionRow[]; isLoading: boolean }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">State Distribution</h3>
        <p className="mt-1 text-xs text-muted-foreground">Sorted by libraries descending.</p>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No state data yet.</div>
        ) : (
          <ScrollArea className="h-[420px] rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Libraries</TableHead>
                  <TableHead className="text-right">Adoption Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.state}>
                    <TableCell className="font-medium text-foreground">{row.state}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{row.libraries}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={badgeVariantForAdoption(row.adoption)}>{row.adoption}</Badge>
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

export default StateDistributionTableCard;
