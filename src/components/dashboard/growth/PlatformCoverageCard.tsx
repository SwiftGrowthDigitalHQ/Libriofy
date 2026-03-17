export type PlatformCoverageMetrics = {
  totalLibraries: number;
  activeCities: number;
  activeDistricts: number;
  statesCovered: number;
  indiaMarketPenetrationPercent: number;
};

const PlatformCoverageCard = ({ metrics, isLoading }: { metrics: PlatformCoverageMetrics | null; isLoading: boolean }) => {
  const penetration =
    metrics && Number.isFinite(metrics.indiaMarketPenetrationPercent) ? metrics.indiaMarketPenetrationPercent : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">Platform Coverage</h3>
        <p className="mt-1 text-xs text-muted-foreground">How much of the India market is currently active.</p>
      </div>

      <div className="mt-4">
        {isLoading || !metrics ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Total Libraries</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{metrics.totalLibraries}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Active Cities</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{metrics.activeCities}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Active Districts</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{metrics.activeDistricts}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">States Covered</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{metrics.statesCovered}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">India Market Penetration</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{penetration.toFixed(1)}%</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PlatformCoverageCard;
