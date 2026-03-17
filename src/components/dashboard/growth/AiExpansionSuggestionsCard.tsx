import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type AiExpansionSuggestionRow = {
  city: string;
  state: string;
  libraries: number;
  score: number;
  level: "High Opportunity" | "Medium Opportunity" | "Low Opportunity";
  reason: string;
};

const badgeVariantForLevel = (level: AiExpansionSuggestionRow["level"]): "default" | "secondary" | "outline" => {
  if (level === "High Opportunity") return "default";
  if (level === "Medium Opportunity") return "secondary";
  return "outline";
};

const AiExpansionSuggestionsCard = ({ rows, isLoading }: { rows: AiExpansionSuggestionRow[]; isLoading: boolean }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">AI Expansion Suggestions</h3>
        <p className="mt-1 text-xs text-muted-foreground">Ranked by opportunity score (adoption + market signals).</p>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No suggestions yet.</div>
        ) : (
          <ScrollArea className="h-[420px] rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>City</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Opportunity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.city}-${row.state}`}>
                    <TableCell className="min-w-0">
                      <div className="font-medium text-foreground">{row.city}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">{row.reason}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.state}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm font-semibold text-foreground">{row.score}%</span>
                        <Badge variant={badgeVariantForLevel(row.level)}>{row.level.replace(" Opportunity", "")}</Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{row.libraries} libraries</div>
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

export default AiExpansionSuggestionsCard;

