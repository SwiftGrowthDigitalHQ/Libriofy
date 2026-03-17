export type CityRecommendation = {
  city: string;
  state: string;
  libraries: number;
};

const NextCitiesToTargetCard = ({
  cities,
  isLoading,
  threshold,
}: {
  cities: CityRecommendation[];
  isLoading: boolean;
  threshold: number;
}) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">Next Cities To Target</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Cities where libraries &lt; {threshold} (top 10 expansion opportunities).
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
        ) : cities.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No recommendations yet.</div>
        ) : (
          cities.slice(0, 10).map((rec) => (
            <div key={`${rec.city}-${rec.state}`} className="flex items-start justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{rec.city}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{rec.state}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {rec.libraries} {rec.libraries === 1 ? "library" : "libraries"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default NextCitiesToTargetCard;
