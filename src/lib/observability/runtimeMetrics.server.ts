type MetricTags = Record<string, string>;

type CounterMetric = {
  key: string;
  name: string;
  tags: MetricTags;
  updatedAt: string;
  value: number;
};

type GaugeMetric = {
  key: string;
  name: string;
  tags: MetricTags;
  updatedAt: string;
  value: number;
};

type LatencyMetric = {
  count: number;
  key: string;
  max: number;
  min: number;
  name: string;
  samples: number[];
  sum: number;
  tags: MetricTags;
  updatedAt: string;
};

type MetricFilters = Record<string, string | number | boolean | null | undefined>;

export type LatencyMetricSummary = {
  count: number;
  max: number;
  min: number;
  p50: number;
  p95: number;
  tags: MetricTags;
  updatedAt: string | null;
  average: number;
};

const MAX_LATENCY_SAMPLES = 250;

const counterMetrics = new Map<string, CounterMetric>();
const gaugeMetrics = new Map<string, GaugeMetric>();
const latencyMetrics = new Map<string, LatencyMetric>();

const normalizeMetricName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeTagValue = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeTags = (tags: MetricFilters = {}): MetricTags =>
  Object.fromEntries(
    Object.entries(tags)
      .map(([key, value]) => [normalizeMetricName(key), normalizeTagValue(value)] as const)
      .filter(([key, value]) => key && value),
  );

const buildMetricKey = (name: string, tags: MetricTags) => {
  const normalizedName = normalizeMetricName(name) || "unnamed_metric";
  const tagKey = Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");

  return tagKey ? `${normalizedName}|${tagKey}` : normalizedName;
};

const matchesTags = (tags: MetricTags, filters: MetricFilters = {}) =>
  Object.entries(normalizeTags(filters)).every(([key, value]) => tags[key] === value);

const calculatePercentile = (sortedValues: number[], percentile: number) => {
  if (!sortedValues.length) {
    return 0;
  }

  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.ceil((percentile / 100) * sortedValues.length) - 1));
  return Number(sortedValues[index].toFixed(2));
};

export const incrementRuntimeMetric = (
  name: string,
  delta = 1,
  tags: MetricFilters = {},
) => {
  const normalizedName = normalizeMetricName(name) || "unnamed_metric";
  const normalizedTags = normalizeTags(tags);
  const key = buildMetricKey(normalizedName, normalizedTags);
  const existing = counterMetrics.get(key);
  const nextValue = Number((existing?.value ?? 0) + delta);

  counterMetrics.set(key, {
    key,
    name: normalizedName,
    tags: normalizedTags,
    updatedAt: new Date().toISOString(),
    value: nextValue,
  });

  return nextValue;
};

export const recordRuntimeGauge = (
  name: string,
  value: number,
  tags: MetricFilters = {},
) => {
  const normalizedName = normalizeMetricName(name) || "unnamed_metric";
  const normalizedTags = normalizeTags(tags);
  const key = buildMetricKey(normalizedName, normalizedTags);

  gaugeMetrics.set(key, {
    key,
    name: normalizedName,
    tags: normalizedTags,
    updatedAt: new Date().toISOString(),
    value: Number.isFinite(value) ? Number(value) : 0,
  });
};

export const recordRuntimeLatency = (
  name: string,
  durationMs: number,
  tags: MetricFilters = {},
) => {
  const normalizedDuration = Number.isFinite(durationMs) ? Math.max(0, Number(durationMs.toFixed(2))) : 0;
  const normalizedName = normalizeMetricName(name) || "unnamed_metric";
  const normalizedTags = normalizeTags(tags);
  const key = buildMetricKey(normalizedName, normalizedTags);
  const existing = latencyMetrics.get(key);
  const nextSamples = [...(existing?.samples ?? []), normalizedDuration].slice(-MAX_LATENCY_SAMPLES);

  latencyMetrics.set(key, {
    count: (existing?.count ?? 0) + 1,
    key,
    max: existing ? Math.max(existing.max, normalizedDuration) : normalizedDuration,
    min: existing ? Math.min(existing.min, normalizedDuration) : normalizedDuration,
    name: normalizedName,
    samples: nextSamples,
    sum: (existing?.sum ?? 0) + normalizedDuration,
    tags: normalizedTags,
    updatedAt: new Date().toISOString(),
  });
};

export const getRuntimeCounterTotal = (name: string, filters: MetricFilters = {}) =>
  [...counterMetrics.values()]
    .filter((metric) => metric.name === normalizeMetricName(name) && matchesTags(metric.tags, filters))
    .reduce((sum, metric) => sum + metric.value, 0);

export const getRuntimeGaugeValue = (name: string, filters: MetricFilters = {}) => {
  const matches = [...gaugeMetrics.values()]
    .filter((metric) => metric.name === normalizeMetricName(name) && matchesTags(metric.tags, filters))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));

  return matches[0]?.value ?? null;
};

export const getRuntimeLatencySummary = (
  name: string,
  filters: MetricFilters = {},
): LatencyMetricSummary => {
  const matches = [...latencyMetrics.values()].filter(
    (metric) => metric.name === normalizeMetricName(name) && matchesTags(metric.tags, filters),
  );
  const samples = matches.flatMap((metric) => metric.samples).sort((left, right) => left - right);
  const count = matches.reduce((sum, metric) => sum + metric.count, 0);
  const sum = matches.reduce((total, metric) => total + metric.sum, 0);
  const updatedAt = matches
    .map((metric) => metric.updatedAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  if (!matches.length || !samples.length || count === 0) {
    return {
      average: 0,
      count: 0,
      max: 0,
      min: 0,
      p50: 0,
      p95: 0,
      tags: normalizeTags(filters),
      updatedAt,
    };
  }

  return {
    average: Number((sum / count).toFixed(2)),
    count,
    max: Number(Math.max(...samples).toFixed(2)),
    min: Number(Math.min(...samples).toFixed(2)),
    p50: calculatePercentile(samples, 50),
    p95: calculatePercentile(samples, 95),
    tags: normalizeTags(filters),
    updatedAt,
  };
};

export const resetRuntimeMetrics = () => {
  counterMetrics.clear();
  gaugeMetrics.clear();
  latencyMetrics.clear();
};
