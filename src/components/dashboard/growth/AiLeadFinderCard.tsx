import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";

type LeadFinderLead = {
  name: string;
  address: string | null;
  phone: string | null;
  maps_url: string;
};

type LeadFinderResponse = {
  city: string;
  query: string;
  places_found: number;
  phones_found: number;
  leads: LeadFinderLead[];
  note?: string;
  error?: string;
  hint?: string;
};

const AiLeadFinderCard = () => {
  const [cityInput, setCityInput] = useState("");
  const [submittedCity, setSubmittedCity] = useState("");

  const trimmedCity = useMemo(() => cityInput.trim(), [cityInput]);

  const { data, error, isFetching } = useQuery({
    queryKey: ["admin-ai-lead-finder", submittedCity],
    enabled: submittedCity.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<LeadFinderResponse> => {
      const { data, error } = await supabase.functions.invoke("ai-lead-finder", { body: { city: submittedCity } });
      if (error) throw error;
      return data as LeadFinderResponse;
    },
  });

  const leads = data?.leads ?? [];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">AI Lead Discovery</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Uses official Google Places APIs (no scraping) to discover study libraries in a city.
        </p>
      </div>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!trimmedCity) return;
          setSubmittedCity(trimmedCity);
        }}
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="ai-lead-city" className="text-xs text-muted-foreground">
            Enter City Name
          </Label>
          <Input
            id="ai-lead-city"
            placeholder="e.g., Varanasi"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={!trimmedCity || isFetching} className="sm:w-auto">
          <Search className="mr-2 h-4 w-4" />
          {isFetching ? "Searching..." : "Find Leads"}
        </Button>
      </form>

      <div className="mt-4">
        {error ? (
          <div className="space-y-2 py-2">
            <div className="text-sm text-muted-foreground">Lead finder unavailable.</div>
            <div className="text-xs text-muted-foreground">
              {getSafeErrorMessage(error, "Lead discovery is unavailable right now.")}
            </div>
          </div>
        ) : !submittedCity ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Search a city to discover leads.</div>
        ) : isFetching ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Searching...</div>
        ) : leads.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No leads found.</div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Libraries Found: <span className="text-foreground">{data?.places_found ?? leads.length}</span>
              </span>
              <span>
                Phone Numbers: <span className="text-foreground">{data?.phones_found ?? 0}</span>
              </span>
              {data?.note ? <span className="text-muted-foreground">{data.note}</span> : null}
            </div>

            <ScrollArea className="h-[420px] rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Library Name</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Maps</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leads.map((lead) => (
                    <TableRow key={`${lead.name}-${lead.maps_url}`}>
                      <TableCell className="font-medium text-foreground">{lead.name}</TableCell>
                      <TableCell className="text-muted-foreground">{lead.address || "-"}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">{lead.phone || "-"}</TableCell>
                      <TableCell className="text-right">
                        <a
                          href={lead.maps_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          Open
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
};

export default AiLeadFinderCard;
