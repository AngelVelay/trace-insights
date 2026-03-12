// ============================================================
// MU Metrics Service
// ============================================================
import type {
  AggregationBucket,
  AggregationResponse,
  MetricsFilters,
  MetricRow,
  OperationType,
} from '@/types/bbva';
import { dateRangeToNano } from './dateUtils';
import {
  buildMetricsUrl,
  buildCompoundQuery,
  buildSiteFilter,
  buildInvokerTxFilter,
  buildUtilityTypeFilter,
} from './urlBuilder';
import { apiRequest, createConcurrencyLimiter } from './httpClient';

const limiter = createConcurrencyLimiter(5);

function extractBuckets(res: AggregationResponse): AggregationBucket[] {
  return res.data ?? res.aggregations ?? [];
}

// ---- Generic aggregation fetch ----
async function fetchAggregation(
  filters: MetricsFilters,
  aggregate: string,
  operations: OperationType[],
  extraQ?: string
): Promise<AggregationBucket[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

  const qParts = [
    filters.site ? buildSiteFilter(filters.site) : undefined,
    filters.invokerTx ? buildInvokerTxFilter(filters.invokerTx) : undefined,
    filters.utilityType ? buildUtilityTypeFilter(filters.utilityType) : undefined,
    extraQ,
  ];

  const url = buildMetricsUrl({
    metricSet: 'utility-metric-set',
    method: 'listAggregations',
    fromTimestamp: from,
    toTimestamp: to,
    aggregate,
    q: buildCompoundQuery(...qParts),
    operations,
  });

  const res = await limiter(() => apiRequest<AggregationResponse>(url));
  return extractBuckets(res);
}

// ---- Functional dashboard ----
export async function fetchFunctionalDashboard(filters: MetricsFilters): Promise<AggregationBucket[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const q = filters.site ? `"properties.site" == "${filters.site}"` : '';

  const url = buildMetricsUrl({
    metricSet: 'functional-dashboard',
    method: 'listAggregations',
    fromTimestamp: from,
    toTimestamp: to,
    aggregate: 'name',
    q,
    operations: [
      'sum:num_executions',
      'mean:span_duration',
      'sum:technical_error',
      'sum:functional_error',
    ],
  });

  const res = await limiter(() => apiRequest<AggregationResponse>(url));
  return extractBuckets(res);
}

// ---- Get invokerTx list ----
export async function fetchInvokerTxList(filters: MetricsFilters): Promise<string[]> {
  const buckets = await fetchAggregation(filters, 'invokerTx', ['count:utility_count']);
  return buckets.map((b) => b.bucket.invokerTx).filter(Boolean);
}

// ---- Get utility types for an invokerTx ----
export async function fetchUtilityTypes(filters: MetricsFilters): Promise<string[]> {
  const buckets = await fetchAggregation(filters, 'utilitytype', ['count:utility_count']);
  return buckets.map((b) => b.bucket.utilitytype).filter(Boolean);
}

// ---- Get invoker libraries ----
export async function fetchInvokerLibraries(filters: MetricsFilters): Promise<string[]> {
  const buckets = await fetchAggregation(filters, 'invokerLibrary', ['count:utility_count']);
  return buckets.map((b) => b.bucket.invokerLibrary).filter(Boolean);
}

// ---- Get invoked params with durations ----
export async function fetchInvokedParams(filters: MetricsFilters): Promise<AggregationBucket[]> {
  return fetchAggregation(filters, 'invokedparam', [
    'count:utility_count',
    'min:utility_duration',
    'mean:utility_duration',
    'max:utility_duration',
  ]);
}

// ---- Full iteration: build MetricRows ----
export async function fetchFullMetrics(
  baseFilters: MetricsFilters,
  onProgress?: (msg: string) => void
): Promise<MetricRow[]> {
  const rows: MetricRow[] = [];
  const site = baseFilters.site ?? '';

  onProgress?.('Obteniendo invokerTx...');
  let invokerTxList = await fetchInvokerTxList(baseFilters);

  if (baseFilters.limit && baseFilters.limit > 0) {
    invokerTxList = invokerTxList.slice(0, baseFilters.limit);
  }

  onProgress?.(`Encontrados ${invokerTxList.length} invokerTx`);

  for (const invokerTx of invokerTxList) {
    const txFilters = { ...baseFilters, invokerTx };

    onProgress?.(`Procesando ${invokerTx}...`);
    const utilityTypes = await fetchUtilityTypes(txFilters);

    for (const utilitytype of utilityTypes) {
      const utFilters = { ...txFilters, utilityType: utilitytype };
      const libraries = await fetchInvokerLibraries(utFilters);
      const params = await fetchInvokedParams(utFilters);

      const lib = libraries[0] ?? '';

      for (const p of params) {
        rows.push({
          site,
          invokerTx,
          invokerLibrary: lib,
          utilitytype,
          invokedparam: p.bucket.invokedparam ?? '',
          utility_count: p.values.count_utility_count ?? 0,
          min_utility_duration: p.values.min_utility_duration ?? 0,
          mean_utility_duration: p.values.mean_utility_duration ?? 0,
          max_utility_duration: p.values.max_utility_duration ?? 0,
        });
      }
    }
  }

  return rows;
}
