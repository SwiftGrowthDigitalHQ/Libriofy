import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps";
import { geoCentroid, geoMercator } from "d3-geo";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizeGeoName } from "@/lib/growthIntelligence";

type StateMetric = {
  state: string;
  libraries: number;
};

type IndiaGrowthMapCardProps = {
  metricsByState: Record<string, StateMetric>;
  missingStateLibraries: number;
};

const INDIA_STATES_GEOJSON_URL = "/geo/india.states.geo.json";

const MAP_WIDTH = 800;
const MAP_HEIGHT = 420;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

const COLOR_NONE = "#ef4444";
const COLOR_ADOPTED = "#eab308";

const getAdoptionColor = (libraries: number) => (libraries > 0 ? COLOR_ADOPTED : COLOR_NONE);
const getAdoptionLevel = (libraries: number) => (libraries > 0 ? "High" : "None");

const getStateLabelLines = (stateName: string) => {
  const normalized = stateName.trim();
  if (!normalized) return [] as string[];

  const upper = normalized.toUpperCase();
  const words = upper.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return [words.join(" ")];

  return [words.slice(0, 2).join(" "), words.slice(2).join(" ")];
};

const IndiaGrowthMapCard = ({ metricsByState, missingStateLibraries }: IndiaGrowthMapCardProps) => {
  const [showLabels, setShowLabels] = useState(true);
  const [mapPosition, setMapPosition] = useState<{ coordinates: [number, number]; zoom: number }>({
    coordinates: [82.8, 22.5],
    zoom: 1,
  });
  const hasInitializedRef = useRef(false);

  const { data: statesGeoJson, isLoading, isError } = useQuery({
    queryKey: ["india-states-geojson"],
    queryFn: async () => {
      const res = await fetch(INDIA_STATES_GEOJSON_URL);
      if (!res.ok) throw new Error("Failed to load India map");
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  });

  const statesGeo = useMemo(() => {
    if (!statesGeoJson || statesGeoJson.type !== "FeatureCollection") return null;
    return statesGeoJson as any;
  }, [statesGeoJson]);

  const projection = useMemo(() => {
    if (!statesGeo) return null;

    const padding = 14;
    const projectionInstance = geoMercator();
    projectionInstance.fitExtent(
      [
        [padding, padding],
        [MAP_WIDTH - padding, MAP_HEIGHT - padding],
      ],
      statesGeo as any,
    );
    return projectionInstance;
  }, [statesGeo]);

  const defaultCenter = useMemo(() => {
    if (!statesGeo) return [82.8, 22.5] as [number, number];
    const centroid = geoCentroid(statesGeo as any) as [number, number];
    if (!Array.isArray(centroid) || centroid.length !== 2) return [82.8, 22.5] as [number, number];
    const [lon, lat] = centroid;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [82.8, 22.5] as [number, number];
    return [lon, lat] as [number, number];
  }, [statesGeo]);

  useEffect(() => {
    if (!statesGeo || hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    setMapPosition({ coordinates: defaultCenter, zoom: 1 });
  }, [defaultCenter, statesGeo]);

  const zoomIn = () => setMapPosition((prev) => ({ ...prev, zoom: Math.min(MAX_ZOOM, prev.zoom * 1.25) }));
  const zoomOut = () => setMapPosition((prev) => ({ ...prev, zoom: Math.max(MIN_ZOOM, prev.zoom / 1.25) }));
  const resetZoom = () => setMapPosition({ coordinates: defaultCenter, zoom: 1 });

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold font-display text-foreground">India Market Heatmap</h3>
          <p className="mt-1 text-xs text-muted-foreground">Library adoption by state.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
          {missingStateLibraries > 0 ? (
            <p className="text-xs text-muted-foreground">
              {missingStateLibraries} active libraries missing <span className="text-foreground">state</span> data
            </p>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>State labels</span>
            <Switch checked={showLabels} onCheckedChange={setShowLabels} />
          </div>
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">Loading map...</div>
        ) : isError || !statesGeo || !projection ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">Unable to load map.</div>
        ) : (
          <div className="relative h-[360px] w-full max-w-full overflow-hidden flex items-center justify-center">
            <div className="absolute right-3 top-3 z-10 flex flex-col gap-2">
              <Button variant="secondary" size="icon" onClick={zoomIn} disabled={mapPosition.zoom >= MAX_ZOOM}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="icon" onClick={zoomOut} disabled={mapPosition.zoom <= MIN_ZOOM}>
                <Minus className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="icon" onClick={resetZoom}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            <TooltipProvider delayDuration={0} skipDelayDuration={0}>
              <ComposableMap
                projection={projection as any}
                width={MAP_WIDTH}
                height={MAP_HEIGHT}
                style={{ width: "100%", height: "100%" }}
              >
                <ZoomableGroup
                  center={mapPosition.coordinates}
                  zoom={mapPosition.zoom}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                  onMoveEnd={(position) =>
                    setMapPosition({
                      coordinates: (position.coordinates ?? defaultCenter) as [number, number],
                      zoom: position.zoom ?? 1,
                    })
                  }
                >
                  <Geographies geography={statesGeo as any}>
                    {({ geographies }) => (
                      <>
                        {geographies.map((geo) => {
                          const stateName = String((geo.properties as any)?.st_nm ?? "Unknown");
                          const key = normalizeGeoName(stateName);
                          const metric = metricsByState[key] ?? { state: stateName, libraries: 0 };
                          const adoptionLevel = getAdoptionLevel(metric.libraries);

                          return (
                            <Tooltip key={geo.rsmKey}>
                              <TooltipTrigger asChild>
                                <Geography
                                  geography={geo}
                                  fill={getAdoptionColor(metric.libraries)}
                                  stroke="hsl(var(--border))"
                                  strokeWidth={0.6}
                                  style={{
                                    default: { outline: "none" },
                                    hover: { outline: "none", filter: "brightness(1.06)" },
                                    pressed: { outline: "none" },
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-1 text-xs">
                                  <div className="font-semibold text-foreground tracking-wide">{stateName.toUpperCase()}</div>
                                  <div className="text-muted-foreground">
                                    Libraries: <span className="text-foreground">{metric.libraries}</span>
                                  </div>
                                  <div className="text-muted-foreground">
                                    Adoption: <span className="text-foreground">{adoptionLevel}</span>
                                  </div>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}

                        {showLabels
                          ? geographies.map((geo) => {
                              const stateName = String((geo.properties as any)?.st_nm ?? "");
                              const lines = getStateLabelLines(stateName);
                              if (lines.length === 0) return null;

                              const centroid = geoCentroid(geo as any) as [number, number];
                              const projected = projection(centroid as any) as [number, number] | null;
                              if (!projected) return null;
                              const [x, y] = projected;
                              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

                              const yOffset = (lines.length - 1) * 5;

                              return (
                                <text
                                  key={`${geo.rsmKey}-label`}
                                  x={x}
                                  y={y - yOffset}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontSize={9}
                                  fontWeight={600}
                                  fill="hsl(var(--muted-foreground))"
                                  style={{
                                    pointerEvents: "none",
                                    paintOrder: "stroke",
                                    stroke: "hsl(var(--background))",
                                    strokeWidth: 3,
                                  }}
                                >
                                  {lines.map((line, index) => (
                                    <tspan key={index} x={x} dy={index === 0 ? 0 : 10}>
                                      {line}
                                    </tspan>
                                  ))}
                                </text>
                              );
                            })
                          : null}
                      </>
                    )}
                  </Geographies>
                </ZoomableGroup>
              </ComposableMap>
            </TooltipProvider>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_ADOPTED }} />
            High adoption
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR_NONE }} />
            No libraries yet
          </div>
        </div>
      </div>
    </div>
  );
};

export default IndiaGrowthMapCard;
