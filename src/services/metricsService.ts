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
} from "./urlBuilder";
import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "./httpClient";
import { fetchTraceSummaryForInvokerTx } from "./tracesService";

const limiter = createConcurrencyLimiter(5);

type InvokerTxBucket = AggregationBucket & {
  bucket?: AggregationBucket["bucket"] & {
    name?: string;
  };
  values?: AggregationBucket["values"] & {
    sum_num_executions?: number;
    mean_span_duration?: number;
    sum_functional_error?: number;
    sum_technical_error?: number;
  };
};

function extractBuckets(
  res: AggregationResponse & { buckets?: AggregationBucket[] }
): AggregationBucket[] {
  return res.buckets ?? res.data ?? res.aggregations ?? [];
}

async function fetchAggregation(
  filters: MetricsFilters,
  metricSet: "technical-dashboard" | "utility-metric-set",
  aggregate: "name" | "invokerLibrary" | "utilitytype" | "invokedparam",
  operations: OperationType[],
  q: string
): Promise<AggregationBucket[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

  const url = buildMetricsUrl({
    metricSet,
    method: "listAggregations",
    fromTimestamp: from,
    toTimestamp: to,
    propertiesSize: 20000,
    aggregate,
    q,
    operations,
  });

  const headers = buildAuthHeaders(filters.bearerToken);

  console.debug("[MU] Request:", url);

  const res = await limiter(() =>
    apiRequest<AggregationResponse & { buckets?: AggregationBucket[] }>(url, {
      headers,
    })
  );

  return extractBuckets(res);
}

export async function fetchInvokerTxBuckets(
  filters: MetricsFilters
): Promise<InvokerTxBucket[]> {
  const q = buildCompoundQuery(
    filters.site ? buildSiteFilter(filters.site) : undefined,
    filters.invokerTx ? `("name" == "${filters.invokerTx.trim()}")` : undefined
  );

  return (await fetchAggregation(
    filters,
    "technical-dashboard",
    "name",
    [
      "sum:num_executions",
      "mean:span_duration",
      "sum:technical_error",
      "sum:functional_error",
    ],
    q
  )) as InvokerTxBucket[];
}

export async function fetchInvokerLibraryBuckets(
  filters: MetricsFilters,
  invokerTx: string
): Promise<AggregationBucket[]> {
  const q = buildCompoundQuery(
    filters.site ? buildSiteFilter(filters.site) : undefined,
    buildInvokerTxFilter(invokerTx)
  );

  return fetchAggregation(
    filters,
    "utility-metric-set",
    "invokerLibrary",
    ["count:utility_count"],
    q
  );
}

export async function fetchUtilityTypeBuckets(
  filters: MetricsFilters,
  invokerTx: string,
  invokerLibrary: string
): Promise<AggregationBucket[]> {
  const q = buildCompoundQuery(
    filters.site ? buildSiteFilter(filters.site) : undefined,
    buildInvokerTxFilter(invokerTx),
    buildInvokerLibraryFilter(invokerLibrary),
    filters.utilityType ? buildUtilityTypeFilter(filters.utilityType) : undefined
  );

  return fetchAggregation(
    filters,
    "utility-metric-set",
    "utilitytype",
    ["count:utility_count"],
    q
  );
}

export async function fetchInvokedParamBuckets(
  filters: MetricsFilters,
  invokerTx: string,
  invokerLibrary: string,
  utilitytype: string
): Promise<AggregationBucket[]> {
  const q = buildCompoundQuery(
    filters.site ? buildSiteFilter(filters.site) : undefined,
    buildInvokerTxFilter(invokerTx),
    buildInvokerLibraryFilter(invokerLibrary),
    buildUtilityTypeFilter(utilitytype)
  );

  return fetchAggregation(
    filters,
    "utility-metric-set",
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

export async function fetchInvokerTxList(
  filters: MetricsFilters
): Promise<string[]> {
  const buckets = await fetchInvokerTxBuckets(filters);

  return buckets
    .map((b) => b.bucket?.name ?? "")
    .filter((v): v is string => Boolean(v?.trim()));
}

export async function fetchFullMetrics(
  baseFilters: MetricsFilters,
  onProgress?: (msg: string) => void
): Promise<MetricRow[]> {
  onProgress?.("Obteniendo invokerTx desde MU...");

  const invokerTxBuckets = await fetchInvokerTxBuckets(baseFilters);

  const txMetaRows = invokerTxBuckets
    .map((b) => ({
      site: baseFilters.site ?? "",
      meta: {
        invokerTx: b.bucket?.name ?? "",
        sum_num_executions: Number(b.values?.sum_num_executions ?? 0),
        mean_span_duration: Number(b.values?.mean_span_duration ?? 0),
        sum_functional_error: Number(b.values?.sum_functional_error ?? 0),
        sum_technical_error: Number(b.values?.sum_technical_error ?? 0),
      },
    }))
    .filter((row) => row.meta.invokerTx.trim().length > 0);

  const uniqueTxMetaRows: typeof txMetaRows = [];
  const seenInvokerTx = new Set<string>();

  for (const row of txMetaRows) {
    if (seenInvokerTx.has(row.meta.invokerTx)) continue;
    seenInvokerTx.add(row.meta.invokerTx);
    uniqueTxMetaRows.push(row);
  }

  let finalTxMetaRows = uniqueTxMetaRows;

  if (baseFilters.invokerTx?.trim()) {
    finalTxMetaRows = finalTxMetaRows.filter(
      (row) => row.meta.invokerTx === baseFilters.invokerTx?.trim()
    );
  }

  if (!baseFilters.iterateAllInvokerTx && baseFilters.limit && baseFilters.limit > 0) {
    finalTxMetaRows = finalTxMetaRows.slice(0, baseFilters.limit);
  }

  const rows: MetricRow[] = [];

  for (const txRow of finalTxMetaRows) {
    const txMeta = txRow.meta;

    onProgress?.(`Obteniendo library de ${txMeta.invokerTx}...`);

    const libraryBuckets = await fetchInvokerLibraryBuckets(
      baseFilters,
      txMeta.invokerTx
    );

    const libraries = libraryBuckets
      .map((lb) => ({
        invokerLibrary: lb.bucket?.invokerLibrary ?? lb.bucket?.name ?? "",
        count: Number(lb.values?.count_utility_count ?? 0),
      }))
      .filter((x) => x.invokerLibrary.trim().length > 0);

    const utilityTypeBlocks: Array<{
      invokerLibrary: string;
      utilitytype: string;
      count: number;
    }> = [];

    const invokedParamBlocks: Array<{
      invokerLibrary: string;
      utilitytype: string;
      invokedparam: string;
      count: number;
      maxDuration: number;
    }> = [];

    for (const library of libraries) {
      const utilityTypeBuckets = await fetchUtilityTypeBuckets(
        baseFilters,
        txMeta.invokerTx,
        library.invokerLibrary
      );

      let utilityTypes = utilityTypeBuckets
        .map((ub) => ({
          invokerLibrary: library.invokerLibrary,
          utilitytype: ub.bucket?.utilitytype ?? ub.bucket?.name ?? "",
          count: Number(ub.values?.count_utility_count ?? 0),
        }))
        .filter((x) => x.utilitytype.trim().length > 0);

      if (baseFilters.utilityType) {
        utilityTypes = utilityTypes.filter(
          (item) => item.utilitytype === baseFilters.utilityType
        );
      }

      utilityTypeBlocks.push(...utilityTypes);

      for (const utility of utilityTypes) {
        const invokedParamBuckets = await fetchInvokedParamBuckets(
          baseFilters,
          txMeta.invokerTx,
          library.invokerLibrary,
          utility.utilitytype
        );

        const invokedParams = invokedParamBuckets
          .map((ip) => ({
            invokerLibrary: library.invokerLibrary,
            utilitytype: utility.utilitytype,
            invokedparam: ip.bucket?.invokedparam ?? ip.bucket?.name ?? "",
            count: Number(ip.values?.count_utility_count ?? 0),
            maxDuration: Number(ip.values?.max_utility_duration ?? 0),
          }))
          .filter((x) => x.invokedparam.trim().length > 0);

        invokedParamBlocks.push(...invokedParams);
      }
    }

    onProgress?.(`Obteniendo trace de ${txMeta.invokerTx}...`);
    const trace = await fetchTraceSummaryForInvokerTx(
      baseFilters,
      txMeta.invokerTx
    );

    rows.push({
      site: txRow.site,
      invokerTx: JSON.stringify(txMeta),
      invokerLibrary: libraries.length ? JSON.stringify(libraries) : "-",
      utilitytype: utilityTypeBlocks.length
        ? JSON.stringify(utilityTypeBlocks)
        : "-",
      invokedparam: invokedParamBlocks.length
        ? JSON.stringify(invokedParamBlocks)
        : "-",
      trace,
      utility_count: txMeta.sum_num_executions,
      min_utility_duration: 0,
      mean_utility_duration: txMeta.mean_span_duration,
      max_utility_duration: 0,
    });
  }

  return rows;
}

export async function fetchUtilityTypes(): Promise<string[]> {
  return [];
}

export async function fetchInvokerLibraries(): Promise<string[]> {
  return [];
}

export async function fetchInvokedParams(): Promise<AggregationBucket[]> {
  return [];
}