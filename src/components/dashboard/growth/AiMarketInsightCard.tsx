import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { getSafeErrorMessage } from "@/lib/errorHandling";

export type AiMarketInsightContext = {
  totalLibraries: number;
  activeCities: number;
  statesCovered: number;
  topStates: Array<{ state: string; libraries: number }>;
  topCities: Array<{ city: string; state: string; libraries: number }>;
  libraryGrowth: Array<{ month: string; libraries: number }>;
};

type AiMarketInsightResponse = {
  insight: string;
  generated_at: string;
  model?: string;
  error?: string;
  hint?: string;
};

const AiMarketInsightCard = ({
  context,
  contextKey,
  disabled,
}: {
  context: AiMarketInsightContext;
  contextKey: string;
  disabled?: boolean;
}) => {
  const {
    data,
    error,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-ai-growth-insight", contextKey],
    enabled: false,
    staleTime: 6 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async (): Promise<AiMarketInsightResponse> => {
      const { data, error } = await supabase.functions.invoke("ai-growth-insights", { body: { context } });
      if (error) throw error;
      return data as AiMarketInsightResponse;
    },
  });

  const canGenerate = !disabled && !isFetching;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold font-display text-foreground">AI Market Insight</h3>
          <p className="mt-1 text-xs text-muted-foreground">AI-generated insights from your growth data.</p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => refetch()}
          disabled={!canGenerate}
        >
          <Sparkles className="mr-2 h-4 w-4" />
          {data?.insight ? "Regenerate" : "Generate"}
        </Button>
      </div>

      <div className="mt-4">
        {disabled ? (
          <div className="py-6 text-sm text-muted-foreground">Add libraries and analytics data to generate insights.</div>
        ) : isFetching ? (
          <div className="py-6 text-sm text-muted-foreground">Generating insight...</div>
        ) : error ? (
          <div className="space-y-2 py-2">
            <div className="text-sm text-muted-foreground">AI insight unavailable.</div>
            <div className="text-xs text-muted-foreground">
              {getSafeErrorMessage(error, "Unable to generate insight right now.")}
            </div>
          </div>
        ) : data?.insight ? (
          <div className="space-y-2">
            <div className="whitespace-pre-line text-sm text-foreground">{data.insight}</div>
            <div className="text-xs text-muted-foreground">
              Generated {new Date(data.generated_at).toLocaleString("en-IN")} {data.model ? `• ${data.model}` : ""}
            </div>
          </div>
        ) : (
          <div className="py-6 text-sm text-muted-foreground">Click Generate to get AI growth insights.</div>
        )}
      </div>
    </div>
  );
};

export default AiMarketInsightCard;
