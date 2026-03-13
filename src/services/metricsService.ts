// ============================================================
// MU Metrics Service
// ============================================================
import type {
  AggregationBucket,
  AggregationResponse,
  MetricsFilters,
  MetricRow,
  OperationType,
} from "@/types/bbva";
import { dateRangeToNano } from "./dateUtils";
import {
  buildMetricsUrl,
  buildCompoundQuery,
  buildSiteFilter,
  buildInvokerTxFilter,
  buildUtilityTypeFilter,
} from "./urlBuilder";
import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "./httpClient";

const limiter = createConcurrencyLimiter(4);

function extractBuckets(res: AggregationResponse): AggregationBucket[] {
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.aggregations)) return res.aggregations;
  return [];
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
    )
  );
}

function buildEqFilter(field: string, value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  return `"${field}" == "${value.trim().replace(/"/g, '\\"')}"`;
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
    filters.invokerLibrary
      ? buildEqFilter("invokerLibrary", filters.invokerLibrary)
      : undefined,
    extraQ,
  ];

  const q = buildCompoundQuery(...qParts);

  const url = buildMetricsUrl({
    metricSet: "utility-metric-set",
    method: "listAggregations",
    fromTimestamp: from,
    toTimestamp: to,
    aggregate,
    q,
    operations,
  });

  const headers = buildAuthHeaders(filters.bearerToken);
  const res = await limiter(() =>
    apiRequest<AggregationResponse>(url, { headers })
  );

  return extractBuckets(res);
}

// ---- Functional dashboard ----
export async function fetchFunctionalDashboard(
  filters: MetricsFilters
): Promise<AggregationBucket[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const q = filters.site ? `"properties.site" == "${filters.site}"` : "";

  const url = buildMetricsUrl({
    metricSet: "functional-dashboard",
    method: "listAggregations",
    fromTimestamp: from,
    toTimestamp: to,
    aggregate: "name",
    q,
    operations: [
      "sum:num_executions",
      "mean:span_duration",
      "sum:technical_error",
      "sum:functional_error",
    ],
  });

  const headers = buildAuthHeaders(filters.bearerToken);
  const res = await limiter(() =>
    apiRequest<AggregationResponse>(url, { headers })
  );

  return extractBuckets(res);
}

// ---- Get invokerTx list ----
export async function fetchInvokerTxList(
  filters: MetricsFilters
): Promise<string[]> {
  const buckets = await fetchAggregation(filters, "invokerTx", [
    "count:utility_count",
  ]);

  return uniqueStrings(buckets.map((b) => b.bucket?.invokerTx));
}

// ---- Get utility types for an invokerTx ----
export async function fetchUtilityTypes(
  filters: MetricsFilters
): Promise<string[]> {
  const buckets = await fetchAggregation(filters, "utilitytype", [
    "count:utility_count",
  ]);

  return uniqueStrings(buckets.map((b) => b.bucket?.utilitytype));
}

// ---- Get invoker libraries ----
export async function fetchInvokerLibraries(
  filters: MetricsFilters
): Promise<string[]> {
  const buckets = await fetchAggregation(filters, "invokerLibrary", [
    "count:utility_count",
  ]);

  return uniqueStrings(buckets.map((b) => b.bucket?.invokerLibrary));
}

// ---- Get invoked params with durations ----
export async function fetchInvokedParams(
  filters: MetricsFilters
): Promise<AggregationBucket[]> {
  return fetchAggregation(filters, "invokedparam", [
    "count:utility_count",
    "min:utility_duration",
    "mean:utility_duration",
    "max:utility_duration",
  ]);
}

// ---- Full iteration: build MetricRows ----
export async function fetchFullMetrics(
  baseFilters: MetricsFilters,
  onProgress?: (msg: string) => void
): Promise<MetricRow[]> {
  const rows: MetricRow[] = [];
  const rowKeys = new Set<string>();

  onProgress?.("Obteniendo invokerTx...");

  let invokerTxList: string[] = [];

  // Si viene invokerTx específico, usar solo ese
  if (baseFilters.invokerTx?.trim()) {
    invokerTxList = [baseFilters.invokerTx.trim()];
  } else {
    invokerTxList = await fetchInvokerTxList(baseFilters);
  }

  if (baseFilters.limit && baseFilters.limit > 0) {
    invokerTxList = invokerTxList.slice(0, baseFilters.limit);
  }

  onProgress?.(`Encontrados ${invokerTxList.length} invokerTx`);

  let txIndex = 0;

  for (const invokerTx of invokerTxList) {
    txIndex += 1;

    const txFilters: MetricsFilters = {
      ...baseFilters,
      invokerTx,
    };

    onProgress?.(
      `Procesando invokerTx ${txIndex}/${invokerTxList.length}: ${invokerTx}`
    );

    const utilityTypes = await fetchUtilityTypes(txFilters);

    for (const utilitytype of utilityTypes) {
      const utFilters: MetricsFilters = {
        ...txFilters,
        utilityType: utilitytype,
      };

      const libraries = await fetchInvokerLibraries(utFilters);

      // Si no hay librerías, intentamos aún así con invokedparam
      if (!libraries.length) {
        const params = await fetchInvokedParams(utFilters);

        for (const p of params) {
          const key = [
            baseFilters.site ?? "",
            invokerTx,
            utilitytype,
            "",
            p.bucket?.invokedparam ?? "",
          ].join("|");

          if (rowKeys.has(key)) continue;
          rowKeys.add(key);

          rows.push({
            site: baseFilters.site ?? "",
            invokerTx,
            invokerLibrary: "",
            utilitytype,
            invokedparam: p.bucket?.invokedparam ?? "",
            utility_count: p.values?.count_utility_count ?? 0,
            min_utility_duration: p.values?.min_utility_duration ?? 0,
            mean_utility_duration: p.values?.mean_utility_duration ?? 0,
            max_utility_duration: p.values?.max_utility_duration ?? 0,
          });
        }

        continue;
      }

      for (const invokerLibrary of libraries) {
        const libFilters: MetricsFilters = {
          ...utFilters,
          invokerLibrary,
        };

        const params = await fetchInvokedParams(libFilters);

        for (const p of params) {
          const invokedparam = p.bucket?.invokedparam ?? "";

          const key = [
            baseFilters.site ?? "",
            invokerTx,
            utilitytype,
            invokerLibrary,
            invokedparam,
          ].join("|");

          if (rowKeys.has(key)) continue;
          rowKeys.add(key);

          rows.push({
            site: baseFilters.site ?? "",
            invokerTx,
            invokerLibrary,
            utilitytype,
            invokedparam,
            utility_count: p.values?.count_utility_count ?? 0,
            min_utility_duration: p.values?.min_utility_duration ?? 0,
            mean_utility_duration: p.values?.mean_utility_duration ?? 0,
            max_utility_duration: p.values?.max_utility_duration ?? 0,
          });
        }
      }
    }
  }

  return rows;
}