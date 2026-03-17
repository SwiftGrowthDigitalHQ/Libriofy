import { Progress } from "@/components/ui/progress";

export type CoverageGoals = {
  librariesGoal: number;
  citiesGoal: number;
  statesGoal: number;
};

export type CoverageProgressMetrics = {
  libraries: number;
  cities: number;
  states: number;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

const percentOfGoal = (current: number, goal: number) => {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  return clampPercent((Math.max(0, current) / goal) * 100);
};

const CoverageGoalTrackerCard = ({
  metrics,
  goals,
  isLoading,
}: {
  metrics: CoverageProgressMetrics | null;
  goals: CoverageGoals;
  isLoading: boolean;
}) => {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="text-sm font-semibold font-display text-foreground">Coverage Goal Tracker</h3>
        <p className="mt-1 text-xs text-muted-foreground">Progress towards India coverage goals.</p>
      </div>

      <div className="mt-4 space-y-4">
        {isLoading || !metrics ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Libraries</span>
                <span className="text-foreground">
                  {metrics.libraries} / {goals.librariesGoal}
                </span>
              </div>
              <Progress value={percentOfGoal(metrics.libraries, goals.librariesGoal)} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Cities</span>
                <span className="text-foreground">
                  {metrics.cities} / {goals.citiesGoal}
                </span>
              </div>
              <Progress value={percentOfGoal(metrics.cities, goals.citiesGoal)} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">States</span>
                <span className="text-foreground">
                  {metrics.states} / {goals.statesGoal}
                </span>
              </div>
              <Progress value={percentOfGoal(metrics.states, goals.statesGoal)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CoverageGoalTrackerCard;

