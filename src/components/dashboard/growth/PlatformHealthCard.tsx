export type PlatformHealthMetrics = {
  activeLibraries: number;
  trialLibraries: number;
  expiredLibraries: number;
};

const PlatformHealthCard = ({ metrics, isLoading }: { metrics: PlatformHealthMetrics | null; isLoading: boolean }) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">Platform Health</h3>
        <p className="mt-1 text-xs text-muted-foreground">Subscription status across libraries.</p>
      </div>

      <div className="mt-4">
        {isLoading || !metrics ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{metrics.activeLibraries}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Trial</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{metrics.trialLibraries}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Expired</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{metrics.expiredLibraries}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlatformHealthCard;

