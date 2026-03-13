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
  buildInvokerLibraryFilter,
  buildUtilityTypeFilter,
  buildInvokedParamQuery,
} from "./urlBuilder";
import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "./httpClient";

const limiter = createConcurrencyLimiter(5);

function extractBuckets(res: AggregationResponse): AggregationBucket[] {
  return res.data ?? res.aggregations ?? [];
}

async function fetchAggregation(
  filters: MetricsFilters,
  aggregate: "invokerTx" | "utilitytype" | "invokerLibrary" | "invokedparam" | "name",
  operations: OperationType[],
  q: string
): Promise<AggregationBucket[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

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

  console.debug("[MU] Request:", url);

  const res = await limiter(() =>
    apiRequest<AggregationResponse>(url, { headers })
  );

  const buckets = extractBuckets(res);
  console.debug("[MU] Buckets:", aggregate, buckets.length);

  return buckets;
}

export async function fetchInvokerTxList(filters: MetricsFilters): Promise<string[]> {
  const q = filters.site ? buildSiteFilter(filters.site) : "";
  const buckets = await fetchAggregation(filters, "invokerTx", ["count:utility_count"], q);

  return buckets
    .map((b) => b.bucket?.invokerTx)
    .filter((v): v is string => Boolean(v?.trim()));
}

export async function fetchUtilityTypes(
  filters: MetricsFilters,
  invokerTx: string
): Promise<string[]> {
  const q = buildInvokerTxFilter(invokerTx);
  const buckets = await fetchAggregation(filters, "utilitytype", ["count:utility_count"], q);

  return buckets
    .map((b) => b.bucket?.utilitytype)
    .filter((v): v is string => Boolean(v?.trim()));
}

export async function fetchInvokerLibraries(
  filters: MetricsFilters,
  invokerTx: string,
  utilityType?: string
): Promise<string[]> {
  const q = buildCompoundQuery(
    buildInvokerTxFilter(invokerTx),
    utilityType ? buildUtilityTypeFilter(utilityType) : undefined
  );

  const buckets = await fetchAggregation(filters, "invokerLibrary", ["count:utility_count"], q);

  return buckets
    .map((b) => b.bucket?.invokerLibrary)
    .filter((v): v is string => Boolean(v?.trim()));
}

export async function fetchInvokedParams(
  filters: MetricsFilters,
  invokerTx: string,
  invokerLibrary: string,
  utilityTypes: string[]
): Promise<AggregationBucket[]> {
  const q = buildInvokedParamQuery({
    invokerTx,
    invokerLibrary,
    utilityTypes,
  });

  return fetchAggregation(
    filters,
    "invokedparam",
    [
      "count:utility_count",
      "min:utility_duration",
      "mean:utility_duration",
      "max:utility_duration",
    ],
    q
  );
}

export async function fetchFullMetrics(
  baseFilters: MetricsFilters,
  onProgress?: (msg: string) => void
): Promise<MetricRow[]> {
  const rows: MetricRow[] = [];
  const site = baseFilters.site ?? "";

  let invokerTxList: string[] = [];

  if (baseFilters.iterateAllInvokerTx || baseFilters.searchMode === "pipeline") {
    onProgress?.("Obteniendo invokerTx desde MU...");
    invokerTxList = await fetchInvokerTxList(baseFilters);
  } else if (baseFilters.invokerTx?.trim()) {
    invokerTxList = [baseFilters.invokerTx.trim()];
  }

  if (baseFilters.limit && baseFilters.limit > 0) {
    invokerTxList = invokerTxList.slice(0, baseFilters.limit);
  }

  onProgress?.(`InvokerTx encontrados: ${invokerTxList.length}`);
  console.debug("[Pipeline] invokerTxList =", invokerTxList);

  for (const invokerTx of invokerTxList) {
    onProgress?.(`Procesando invokerTx: ${invokerTx}`);

    const utilityTypes =
      baseFilters.utilityType?.trim()
        ? [baseFilters.utilityType.trim()]
        : await fetchUtilityTypes(baseFilters, invokerTx);

    console.debug(`[Pipeline] ${invokerTx} utilityTypes =`, utilityTypes);

    for (const utilityType of utilityTypes) {
      const libraries = await fetchInvokerLibraries(
        baseFilters,
        invokerTx,
        utilityType
      );

      console.debug(
        `[Pipeline] ${invokerTx} ${utilityType} libraries =`,
        libraries
      );

      for (const invokerLibrary of libraries) {
        const params = await fetchInvokedParams(
          baseFilters,
          invokerTx,
          invokerLibrary,
          [utilityType]
        );

        console.debug(
          `[Pipeline] ${invokerTx} ${utilityType} ${invokerLibrary} params =`,
          params.length
        );

        for (const p of params) {
          rows.push({
            site,
            invokerTx,
            invokerLibrary,
            utilitytype: utilityType,
            invokedparam: p.bucket?.invokedparam ?? "",
            utility_count: p.values?.count_utility_count ?? 0,
            min_utility_duration: p.values?.min_utility_duration ?? 0,
            mean_utility_duration: p.values?.mean_utility_duration ?? 0,
            max_utility_duration: p.values?.max_utility_duration ?? 0,
          });
        }
      }
    }
  }

  console.debug("[Pipeline] rows =", rows.length, rows);
  return rows;
}