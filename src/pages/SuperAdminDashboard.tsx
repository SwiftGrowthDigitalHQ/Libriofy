import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, CheckCircle, CreditCard, TrendingUp, Users, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import RevenueChart from "@/components/dashboard/RevenueChart";
import StatsCard from "@/components/dashboard/StatsCard";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import IndiaGrowthMapCard from "@/components/dashboard/growth/IndiaGrowthMapCard";
import PlatformCoverageCard from "@/components/dashboard/growth/PlatformCoverageCard";
import NextCitiesToTargetCard from "@/components/dashboard/growth/NextCitiesToTargetCard";
import StateDistributionTableCard from "@/components/dashboard/growth/StateDistributionTableCard";
import DistrictDistributionTableCard from "@/components/dashboard/growth/DistrictDistributionTableCard";
import CityDistributionTableCard from "@/components/dashboard/growth/CityDistributionTableCard";
import LibraryGrowthChartCard from "@/components/dashboard/growth/LibraryGrowthChartCard";
import TopPerformingLibrariesCard from "@/components/dashboard/growth/TopPerformingLibrariesCard";
import PlatformHealthCard from "@/components/dashboard/growth/PlatformHealthCard";
import type { AdoptionLevel } from "@/components/dashboard/growth/StateDistributionTableCard";
import CoverageGoalTrackerCard from "@/components/dashboard/growth/CoverageGoalTrackerCard";
import AiMarketInsightCard from "@/components/dashboard/growth/AiMarketInsightCard";
import AiLeadFinderCard from "@/components/dashboard/growth/AiLeadFinderCard";
import AiExpansionSuggestionsCard from "@/components/dashboard/growth/AiExpansionSuggestionsCard";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { INDIA_TARGET_CITIES, calculateOpportunityScore, getStateSignals, normalizeGeoName } from "@/lib/growthIntelligence";

type AdminLibraryRow = Pick<
  Database["public"]["Tables"]["libraries"]["Row"],
  "id" | "name" | "city" | "enabled" | "monthly_revenue" | "active_students" | "total_seats" | "created_at"
>;

type AdminSubscriptionStatRow = Pick<
  Database["public"]["Tables"]["library_subscriptions"]["Row"],
  "status" | "price"
>;

type StateAnalyticsRow = Database["public"]["Views"]["admin_state_analytics"]["Row"];
type DistrictAnalyticsRow = Database["public"]["Views"]["admin_district_analytics"]["Row"];
type CityAnalyticsRow = Database["public"]["Views"]["admin_city_analytics"]["Row"];

const formatInr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);

const SuperAdminDashboard = () => {
  const { data: libraries = [], isLoading: librariesLoading } = useQuery({
    queryKey: ["admin-libraries"],
    queryFn: async (): Promise<AdminLibraryRow[]> => {
      const { data, error } = await supabase
        .from("libraries")
        .select("id, name, city, enabled, monthly_revenue, active_students, total_seats, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AdminLibraryRow[];
    },
    staleTime: 60 * 1000,
  });

  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery({
    queryKey: ["admin-subscriptions-stats"],
    queryFn: async (): Promise<AdminSubscriptionStatRow[]> => {
      const { data, error } = await supabase.from("library_subscriptions").select("status, price");
      if (error) throw error;
      return data as AdminSubscriptionStatRow[];
    },
    staleTime: 60 * 1000,
  });

  const { data: stateAnalytics = [], isLoading: statesLoading, isError: statesError } = useQuery({
    queryKey: ["admin-state-analytics"],
    queryFn: async (): Promise<StateAnalyticsRow[]> => {
      const { data, error } = await supabase.from("admin_state_analytics").select("state, libraries");
      if (error) throw error;
      return data as StateAnalyticsRow[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: districtAnalytics = [], isLoading: districtsLoading, isError: districtsError } = useQuery({
    queryKey: ["admin-district-analytics"],
    queryFn: async (): Promise<DistrictAnalyticsRow[]> => {
      const { data, error } = await supabase.from("admin_district_analytics").select("state, district, libraries");
      if (error) throw error;
      return data as DistrictAnalyticsRow[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { data: cityAnalytics = [], isLoading: citiesLoading, isError: citiesError } = useQuery({
    queryKey: ["admin-city-analytics"],
    queryFn: async (): Promise<CityAnalyticsRow[]> => {
      const { data, error } = await supabase.from("admin_city_analytics").select("state, city, libraries");
      if (error) throw error;
      return data as CityAnalyticsRow[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const totalStudents = libraries.reduce((sum, library) => sum + (library.active_students || 0), 0);
  const activeLibraries = libraries.filter((library) => library.enabled).length;
  const expiredSubscriptions = subscriptions.filter((subscription) => subscription.status === "expired").length;
  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status === "active" || subscription.status === "trial").length;
  const subscriptionRevenue = subscriptions.reduce((sum, subscription) => sum + Number(subscription.price || 0), 0);

  const insights = [
    totalStudents > 100 && { text: `Platform growing steadily - ${totalStudents} students across all libraries`, type: "success" },
    expiredSubscriptions > 0 && { text: `${expiredSubscriptions} library subscriptions expired - follow up for renewal`, type: "warning" },
    activeLibraries < libraries.length && { text: `${libraries.length - activeLibraries} libraries currently disabled`, type: "warning" },
  ].filter(Boolean) as Array<{ text: string; type: string }>;

  const topRevenueLibraries = [...libraries]
    .sort((left, right) => Number(right.monthly_revenue || 0) - Number(left.monthly_revenue || 0))
    .slice(0, 5);

  const topPerformingLibraries = useMemo(
    () =>
      libraries
        .map((library) => ({
          id: library.id,
          name: library.name,
          city: library.city,
          occupancy: library.total_seats > 0 ? Math.round((library.active_students / library.total_seats) * 100) : 0,
        }))
        .sort((a, b) => b.occupancy - a.occupancy || a.name.localeCompare(b.name))
        .slice(0, 10),
    [libraries],
  );

  const occupancyLibraries = libraries
    .map((library) => ({
      ...library,
      occupancy: library.total_seats > 0 ? Math.round((library.active_students / library.total_seats) * 100) : 0,
    }))
    .sort((left, right) => right.occupancy - left.occupancy)
    .slice(0, 5);

  const libraryGrowthPoints = useMemo(() => {
    const monthKey = (date: Date) => date.toISOString().slice(0, 7);

    const countsByMonth = new Map<string, number>();
    libraries.forEach((library) => {
      const createdAt = library.created_at ? new Date(library.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return;
      const key = monthKey(createdAt);
      countsByMonth.set(key, (countsByMonth.get(key) ?? 0) + 1);
    });

    const monthsToShow = 7;
    const now = new Date();
    const points = Array.from({ length: monthsToShow }, (_, index) => {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsToShow - 1 - index), 1));
      const key = monthKey(monthStart);
      return {
        month: monthStart.toLocaleString("en-IN", { month: "short" }),
        monthStart: monthStart.toISOString(),
        libraries: countsByMonth.get(key) ?? 0,
      };
    });

    return points;
  }, [libraries]);

  const knownStates = useMemo(() => stateAnalytics.filter((row) => row.state !== "Unknown"), [stateAnalytics]);

  const missingStateLibraries = useMemo(
    () => Number(stateAnalytics.find((row) => row.state === "Unknown")?.libraries || 0),
    [stateAnalytics],
  );

  const metricsByState = useMemo(
    () =>
      Object.fromEntries(
        knownStates.map((row) => [
          normalizeGeoName(row.state),
          { state: row.state, libraries: Number(row.libraries || 0) },
        ]),
      ),
    [knownStates],
  );

  const stateDistributionRows = useMemo(() => {
    const rows = stateAnalytics.map((row) => {
      const librariesCount = Number(row.libraries || 0);
      const adoption: AdoptionLevel = librariesCount >= 4 ? "High" : librariesCount >= 1 ? "Medium" : "None";
      return { state: row.state, libraries: librariesCount, adoption };
    });
    return rows.sort((a, b) => b.libraries - a.libraries || a.state.localeCompare(b.state));
  }, [stateAnalytics]);

  const districtDistributionRows = useMemo(
    () =>
      districtAnalytics
        .filter((row) => row.district !== "Unknown")
        .map((row) => ({ district: row.district, state: row.state, libraries: Number(row.libraries || 0) }))
        .sort((a, b) => a.libraries - b.libraries || a.district.localeCompare(b.district)),
    [districtAnalytics],
  );

  const cityDistributionRows = useMemo(() => {
    const cityKey = (city: string, state: string) => `${normalizeGeoName(city)}|${normalizeGeoName(state)}`;

    const fromAnalytics = cityAnalytics
      .filter((row) => row.city !== "Unknown")
      .map((row) => ({ city: row.city, state: row.state, libraries: Number(row.libraries || 0) }));

    const analyticsByKey = new Map(fromAnalytics.map((row) => [cityKey(row.city, row.state), row]));

    const merged: Array<{ city: string; state: string; libraries: number }> = [...fromAnalytics];
    INDIA_TARGET_CITIES.forEach((signal) => {
      const key = cityKey(signal.city, signal.state);
      if (analyticsByKey.has(key)) return;
      merged.push({ city: signal.city, state: signal.state, libraries: 0 });
    });

    return merged.sort((a, b) => b.libraries - a.libraries || a.city.localeCompare(b.city));
  }, [cityAnalytics]);

  const cityThreshold = 2;

  const cityOpportunityRows = useMemo(() => {
    const cityKey = (city: string, state: string) => `${normalizeGeoName(city)}|${normalizeGeoName(state)}`;

    const analyticsRows = cityAnalytics
      .filter((row) => row.city !== "Unknown")
      .map((row) => ({ city: row.city, state: row.state, libraries: Number(row.libraries || 0) }));

    const librariesByKey = new Map(analyticsRows.map((row) => [cityKey(row.city, row.state), row.libraries]));
    const signalByKey = new Map(INDIA_TARGET_CITIES.map((signal) => [cityKey(signal.city, signal.state), signal] as const));

    const mergedByKey = new Map<string, { city: string; state: string; libraries: number }>();
    analyticsRows.forEach((row) => mergedByKey.set(cityKey(row.city, row.state), row));
    INDIA_TARGET_CITIES.forEach((signal) => {
      const key = cityKey(signal.city, signal.state);
      if (mergedByKey.has(key)) return;
      mergedByKey.set(key, { city: signal.city, state: signal.state, libraries: librariesByKey.get(key) ?? 0 });
    });

    const scored = Array.from(mergedByKey.values()).map((row) => {
      const key = cityKey(row.city, row.state);
      const citySignal = signalByKey.get(key);
      const signals = citySignal
        ? { studentPotential: citySignal.studentPotential, coachingDensity: citySignal.coachingDensity }
        : getStateSignals(row.state);
      const result = calculateOpportunityScore({ librariesCount: row.libraries, signals, adoptionSaturation: 3 });
      return { ...row, score: result.score, level: result.level, reason: result.reason };
    });

    return scored.sort((a, b) => b.score - a.score || a.libraries - b.libraries || a.city.localeCompare(b.city));
  }, [cityAnalytics]);

  const nextCitiesToTarget = useMemo(
    () =>
      cityOpportunityRows
        .filter((row) => row.libraries < cityThreshold)
        .sort((a, b) => b.score - a.score || a.libraries - b.libraries || a.city.localeCompare(b.city))
        .slice(0, 10)
        .map((row) => ({ city: row.city, state: row.state, libraries: row.libraries })),
    [cityOpportunityRows],
  );

  const aiExpansionSuggestions = useMemo(() => cityOpportunityRows.slice(0, 10), [cityOpportunityRows]);

  const coverageMetrics = useMemo(() => {
    const totalLibraries = stateAnalytics.reduce((sum, row) => sum + Number(row.libraries || 0), 0);
    const activeCities = new Set(
      cityAnalytics.filter((row) => row.city !== "Unknown").map((row) => normalizeGeoName(row.city)),
    ).size;
    const activeDistricts = new Set(
      districtAnalytics.filter((row) => row.district !== "Unknown").map((row) => normalizeGeoName(row.district)),
    ).size;
    const statesCovered = knownStates.length;
    const indiaMarketPenetrationPercent = Math.max(0, Math.min(100, (statesCovered / 28) * 100));

    return { totalLibraries, activeCities, activeDistricts, statesCovered, indiaMarketPenetrationPercent };
  }, [cityAnalytics, districtAnalytics, knownStates, stateAnalytics]);

  const aiInsightContext = useMemo(
    () => ({
      totalLibraries: coverageMetrics.totalLibraries,
      activeCities: coverageMetrics.activeCities,
      statesCovered: coverageMetrics.statesCovered,
      topStates: [...stateAnalytics]
        .filter((row) => row.state !== "Unknown")
        .map((row) => ({ state: row.state, libraries: Number(row.libraries || 0) }))
        .sort((a, b) => b.libraries - a.libraries)
        .slice(0, 10),
      topCities: [...cityAnalytics]
        .filter((row) => row.city !== "Unknown")
        .map((row) => ({ city: row.city, state: row.state, libraries: Number(row.libraries || 0) }))
        .sort((a, b) => b.libraries - a.libraries)
        .slice(0, 10),
      libraryGrowth: libraryGrowthPoints.map((point) => ({ month: point.month, libraries: point.libraries })),
    }),
    [cityAnalytics, coverageMetrics.activeCities, coverageMetrics.statesCovered, coverageMetrics.totalLibraries, libraryGrowthPoints, stateAnalytics],
  );

  const aiInsightContextKey = useMemo(() => JSON.stringify(aiInsightContext), [aiInsightContext]);

  const platformHealthMetrics = useMemo(
    () => ({
      activeLibraries: subscriptions.filter((subscription) => subscription.status === "active").length,
      trialLibraries: subscriptions.filter((subscription) => subscription.status === "trial").length,
      expiredLibraries: subscriptions.filter((subscription) => subscription.status === "expired").length,
    }),
    [subscriptions],
  );

  const growthLoading = statesLoading || districtsLoading || citiesLoading;
  const growthError = statesError || districtsError || citiesError;
  const noAnalyticsData =
    !growthLoading &&
    !growthError &&
    stateAnalytics.length === 0 &&
    districtAnalytics.length === 0 &&
    cityAnalytics.length === 0;

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold font-display text-foreground">Platform Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Monitor all libraries and platform metrics.</p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatsCard icon={Building2} title="Total Libraries" value={String(libraries.length)} change={`${activeLibraries} active`} trend="up" />
          <StatsCard icon={Users} title="Total Students" value={String(totalStudents)} trend="up" iconColor="text-info" />
          <StatsCard icon={CreditCard} title="Subscription MRR" value={formatInr(subscriptionRevenue)} trend="up" iconColor="text-success" />
          <StatsCard
            icon={TrendingUp}
            title="Active Plans"
            value={String(activeSubscriptions)}
            change={`${expiredSubscriptions} expired`}
            trend={expiredSubscriptions > 0 ? "down" : "up"}
            iconColor="text-warning"
          />
        </div>

        {insights.length > 0 ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold font-display text-foreground">
              <Zap className="h-4 w-4 text-primary" />
              Smart Insights
            </h3>
            <div className="space-y-2">
              {insights.map((insight, index) => (
                <div key={index} className="flex items-center gap-2 text-sm">
                  {insight.type === "success" ? (
                    <CheckCircle className="h-4 w-4 flex-shrink-0 text-success" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 text-warning" />
                  )}
                  <span className="text-muted-foreground">{insight.text}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Top Libraries by Revenue</h3>
            <div className="space-y-3">
              {topRevenueLibraries.map((library, index) => (
                <div key={library.id} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-xs text-muted-foreground">#{index + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{library.name}</p>
                      <p className="text-xs text-muted-foreground">{library.city || "-"} - {library.active_students} students</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{formatInr(Number(library.monthly_revenue || 0))}</span>
                </div>
              ))}
              {libraries.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No libraries yet.</p> : null}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold font-display text-foreground">Top Libraries by Seat Occupancy</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {occupancyLibraries.map((library) => (
              <div key={library.id} className="rounded-lg border border-border p-3">
                <p className="truncate text-sm font-medium text-foreground">{library.name}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{library.active_students}/{library.total_seats} seats</span>
                  <Badge variant={library.occupancy >= 90 ? "destructive" : library.occupancy >= 70 ? "default" : "secondary"}>
                    {library.occupancy}%
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2">
          <h2 className="text-2xl font-bold font-display text-foreground">Growth Intelligence</h2>
          <p className="mt-1 text-sm text-muted-foreground">Geographic adoption, platform coverage, and expansion opportunities.</p>
        </div>

        {growthError ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold font-display text-foreground">Growth analytics unavailable</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Apply the latest Supabase migrations (run <span className="font-mono">npx supabase db push</span>) to enable Growth Intelligence views, then refresh.
            </p>
          </div>
        ) : noAnalyticsData ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold font-display text-foreground">No analytics data yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">Add libraries to see growth insights.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <IndiaGrowthMapCard metricsByState={metricsByState} missingStateLibraries={Number(missingStateLibraries || 0)} />
              </div>
              <div className="space-y-6">
                <PlatformCoverageCard metrics={coverageMetrics} isLoading={growthLoading} />
                <NextCitiesToTargetCard cities={nextCitiesToTarget} isLoading={growthLoading} threshold={cityThreshold} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <StateDistributionTableCard rows={stateDistributionRows} isLoading={statesLoading} />
              <DistrictDistributionTableCard rows={districtDistributionRows} isLoading={districtsLoading} />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <CityDistributionTableCard rows={cityDistributionRows} isLoading={citiesLoading} />
              <LibraryGrowthChartCard data={libraryGrowthPoints} isLoading={librariesLoading} />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2">
                <TopPerformingLibrariesCard rows={topPerformingLibraries} isLoading={librariesLoading} />
              </div>
              <div className="space-y-6">
                <PlatformHealthCard metrics={platformHealthMetrics} isLoading={subscriptionsLoading} />
                <CoverageGoalTrackerCard
                  metrics={{
                    libraries: coverageMetrics.totalLibraries,
                    cities: coverageMetrics.activeCities,
                    states: coverageMetrics.statesCovered,
                  }}
                  goals={{ librariesGoal: 1000, citiesGoal: 100, statesGoal: 28 }}
                  isLoading={growthLoading}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <AiMarketInsightCard context={aiInsightContext} contextKey={aiInsightContextKey} disabled={growthLoading} />
              <AiExpansionSuggestionsCard rows={aiExpansionSuggestions} isLoading={growthLoading} />
            </div>

            <div className="grid grid-cols-1 gap-6">
              <AiLeadFinderCard />
            </div>
          </>
        )}
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminDashboard;
