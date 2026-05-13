import {
  CHANNEL_CODES,
  type AggregationBucket,
  type AggregationResponse,
  type MetricsFilters,
  type MetricRow,
  type OperationType,
} from "@/types/bbva";
import { dateRangeToNano } from "./dateUtils";
import {
  buildMetricsUrl,
  buildCompoundQuery,
  buildSiteFilter,
  buildInvokerTxFilter,
  buildInvokerLibraryFilter,
  buildUtilityTypeFilter,
  buildChannelCodeFilter,
} from "./urlBuilder";
import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "./httpClient";
import { fetchTraceSummaryForInvokerTx } from "./tracesService";

const limiter = createConcurrencyLimiter(5);
const awsInformLimiter = createConcurrencyLimiter(2);

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

type ChannelCodeBucket = AggregationBucket & {
  bucket?: AggregationBucket["bucket"] & {
    "channel-code"?: string;
  };
  values?: AggregationBucket["values"] & {
    sum_num_executions?: number;
  };
};

export type AwsInformSiteName = "LIVE-02" | "LIVE-04";

export interface AwsInformChannelCodeOption {
  channelCode: string;
  executionsLive02: number;
  executionsLive04: number;
  totalExecutions: number;
}

export interface AwsInformSiteMetrics {
  site: AwsInformSiteName;
  invokerTx: string;
  executions: number;
  technicalErrors: number;
  functionalErrors: number;
  meanDurationMs: number;
  jumps: number;
  trace: string;
}

export interface AwsInformComparisonRow {
  invokerTx: string;
  live02: AwsInformSiteMetrics;
  live04: AwsInformSiteMetrics;
  deltaExecutions: number;
  deltaTechnicalErrors: number;
  deltaMeanDurationMs: number;
  deltaJumps: number;
}

export interface AwsInformComparisonResult {
  channelCode?: string;
  rows: AwsInformComparisonRow[];
  summary: {
    totalInvokerTx: number;
    totalExecutionsLive02: number;
    totalExecutionsLive04: number;
    totalErrorsLive02: number;
    totalErrorsLive04: number;
    totalJumpsLive02: number;
    totalJumpsLive04: number;
    avgDurationLive02: number;
    avgDurationLive04: number;
  };
}

function extractBuckets(
  res: AggregationResponse & { buckets?: AggregationBucket[] }
): AggregationBucket[] {
  return res.buckets ?? res.data ?? res.aggregations ?? [];
}

async function fetchAggregation(
  filters: MetricsFilters,
  metricSet:
    | "technical-dashboard"
    | "utility-metric-set"
    | "functional-dashboard",
  aggregate:
    | "name"
    | "invokerLibrary"
    | "utilitytype"
    | "invokedparam"
    | "channel-code",
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
    baseUrl: "https://mu.live-02.nextgen.igrupobbva",
  });

  console.log("[MU aggregation URL]", {
    metricSet,
    aggregate,
    operations,
    q,
    url,
  });

  const res = await limiter(() =>
    apiRequest<AggregationResponse & { buckets?: AggregationBucket[] }>(url, {
      headers: buildAuthHeaders(filters.bearerToken),
    })
  );

  return extractBuckets(res);
}

function getSelectedChannelCodes(filters: MetricsFilters): string[] {
  const codes = filters.channelCodes?.length
    ? filters.channelCodes
    : filters.channelCode
      ? [filters.channelCode]
      : [];

  return Array.from(
    new Set(
      codes
        .map((code) => String(code).trim())
        .filter((code) => code && code !== "all")
    )
  );
}

function getChannelCodeFilter(filters: MetricsFilters): string | undefined {
  const codes = getSelectedChannelCodes(filters);
  return buildChannelCodeFilter(codes);
}

function getChannelCodeLabel(filters: MetricsFilters): string {
  const codes = getSelectedChannelCodes(filters);
  return codes.length ? codes.join(", ") : "-";
}

function buildSingleChannelFilters(
  filters: MetricsFilters,
  channelCode: string
): MetricsFilters {
  return {
    ...filters,
    channelCode,
    channelCodes: undefined,
  };
}

function removeChannelCodeFilter(filters: MetricsFilters): MetricsFilters {
  return {
    ...filters,
    channelCode: undefined,
    channelCodes: undefined,
  };
}

async function fetchAggregationWithChannelFallback(
  filters: MetricsFilters,
  metricSet:
    | "technical-dashboard"
    | "utility-metric-set"
    | "functional-dashboard",
  aggregate:
    | "name"
    | "invokerLibrary"
    | "utilitytype"
    | "invokedparam"
    | "channel-code",
  operations: OperationType[],
  buildQuery: (filters: MetricsFilters) => string
): Promise<AggregationBucket[]> {
  const result = await fetchAggregation(
    filters,
    metricSet,
    aggregate,
    operations,
    buildQuery(filters)
  );

  if (result.length > 0 || !getSelectedChannelCodes(filters).length) {
    return result;
  }

  console.warn(
    `[metricsService] ${metricSet}/${aggregate} vino vacío con channel-code=${getSelectedChannelCodes(
      filters
    ).join(", ")}. Reintentando sin channel-code.`
  );

  const fallbackFilters = removeChannelCodeFilter(filters);

  return fetchAggregation(
    fallbackFilters,
    metricSet,
    aggregate,
    operations,
    buildQuery(fallbackFilters)
  );
}

export async function fetchInvokerTxBuckets(
  filters: MetricsFilters
): Promise<InvokerTxBucket[]> {
  const q = buildCompoundQuery(
    filters.site ? buildSiteFilter(filters.site) : undefined,
    filters.invokerTx ? `("name" == "${filters.invokerTx.trim()}")` : undefined,
    getChannelCodeFilter(filters)
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
  return fetchAggregationWithChannelFallback(
    filters,
    "utility-metric-set",
    "invokerLibrary",
    ["count:utility_count"],
    (currentFilters) =>
      buildCompoundQuery(
        currentFilters.site ? buildSiteFilter(currentFilters.site) : undefined,
        buildInvokerTxFilter(invokerTx),
        getChannelCodeFilter(currentFilters)
      )
  );
}

export async function fetchUtilityTypeBuckets(
  filters: MetricsFilters,
  invokerTx: string,
  invokerLibrary: string
): Promise<AggregationBucket[]> {
  return fetchAggregationWithChannelFallback(
    filters,
    "utility-metric-set",
    "utilitytype",
    ["count:utility_count"],
    (currentFilters) =>
      buildCompoundQuery(
        currentFilters.site ? buildSiteFilter(currentFilters.site) : undefined,
        buildInvokerTxFilter(invokerTx),
        buildInvokerLibraryFilter(invokerLibrary),
        currentFilters.utilityType
          ? buildUtilityTypeFilter(currentFilters.utilityType)
          : undefined,
        getChannelCodeFilter(currentFilters)
      )
  );
}

export async function fetchInvokedParamBuckets(
  filters: MetricsFilters,
  invokerTx: string,
  invokerLibrary: string,
  utilitytype: string
): Promise<AggregationBucket[]> {
  const selectedUtilityType = filters.utilityType || utilitytype;

  return fetchAggregationWithChannelFallback(
    filters,
    "utility-metric-set",
    "invokedparam",
    [
      "count:utility_count",
      "min:utility_duration",
      "mean:utility_duration",
      "max:utility_duration",
    ],
    (currentFilters) =>
      buildCompoundQuery(
        currentFilters.site ? buildSiteFilter(currentFilters.site) : undefined,
        buildInvokerTxFilter(invokerTx),
        buildInvokerLibraryFilter(invokerLibrary),
        selectedUtilityType
          ? buildUtilityTypeFilter(selectedUtilityType)
          : undefined,
        getChannelCodeFilter(currentFilters)
      )
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

/**
 * Catálogo local de channel-code.
 * Ahora se toma desde CHANNEL_CODES en bbva.ts.
 */
export async function fetchAwsInformChannelCodes(_params?: {
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
}): Promise<AwsInformChannelCodeOption[]> {
  return CHANNEL_CODES.map((item) => ({
    channelCode: item.channelCode,
    executionsLive02: 0,
    executionsLive04: 0,
    totalExecutions: item.applications?.length ?? 0,
  })).sort((a, b) => {
    if (b.totalExecutions !== a.totalExecutions) {
      return b.totalExecutions - a.totalExecutions;
    }

    return a.channelCode.localeCompare(b.channelCode);
  });
}

async function fetchAwsChannelCodeBucketsForSite(
  filters: Pick<MetricsFilters, "fromDate" | "toDate" | "bearerToken">,
  site: AwsInformSiteName
): Promise<ChannelCodeBucket[]> {
  const baseFilters: MetricsFilters = {
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    bearerToken: filters.bearerToken,
    searchMode: "pipeline",
  };

  const q = buildCompoundQuery(buildSiteFilter(site));

  return (await fetchAggregation(
    baseFilters,
    "functional-dashboard",
    "channel-code",
    ["sum:num_executions"],
    q
  )) as ChannelCodeBucket[];
}

function parseTraceJumps(trace: string): number {
  const match = String(trace ?? "").match(/Total de saltos encontrados:\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function emptyAwsSiteMetrics(
  site: AwsInformSiteName,
  invokerTx: string,
  trace = "-"
): AwsInformSiteMetrics {
  return {
    site,
    invokerTx,
    executions: 0,
    technicalErrors: 0,
    functionalErrors: 0,
    meanDurationMs: 0,
    jumps: 0,
    trace,
  };
}

async function fetchAwsSiteMetricsForInvokerTx(
  baseFilters: MetricsFilters,
  site: AwsInformSiteName,
  invokerTx: string
): Promise<AwsInformSiteMetrics> {
  const scopedFilters: MetricsFilters = {
    ...baseFilters,
    site,
    invokerTx,
    limit: 1,
    iterateAllInvokerTx: true,
  };

  try {
    const buckets = await fetchInvokerTxBuckets(scopedFilters);

    const bucket = buckets.find(
      (item) => String(item.bucket?.name ?? "").trim() === invokerTx
    );

    if (!bucket) {
      return emptyAwsSiteMetrics(site, invokerTx);
    }

    const meanDurationMs = Number(bucket.values?.mean_span_duration ?? 0);
    let trace = "-";

    try {
      trace = await fetchTraceSummaryForInvokerTx(
        scopedFilters,
        invokerTx,
        meanDurationMs
      );
    } catch (err) {
      console.warn("[AWS Inform] Error obteniendo trace", {
        site,
        invokerTx,
        err,
      });
      trace = "-";
    }

    return {
      site,
      invokerTx,
      executions: Number(bucket.values?.sum_num_executions ?? 0),
      technicalErrors: Number(bucket.values?.sum_technical_error ?? 0),
      functionalErrors: Number(bucket.values?.sum_functional_error ?? 0),
      meanDurationMs,
      jumps: parseTraceJumps(trace),
      trace,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? `Error consultando ${site}: ${error.message}`
        : `Error consultando ${site}`;

    return emptyAwsSiteMetrics(site, invokerTx, message);
  }
}

export async function fetchAwsInformComparison(params: {
  invokerTxList: string[];
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
  channelCode?: string;
  onProgress?: (message: string) => void;
  onProgressValue?: (value: number) => void;
}): Promise<AwsInformComparisonResult> {
  const {
    invokerTxList,
    fromDate,
    toDate,
    bearerToken,
    channelCode,
    onProgress,
    onProgressValue,
  } = params;

  const cleanChannelCode =
    channelCode && channelCode !== "all"
      ? channelCode.trim()
      : undefined;

  const uniqueInvokerTx = Array.from(
    new Set(
      invokerTxList
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (!uniqueInvokerTx.length) {
    return {
      channelCode: cleanChannelCode?.toUpperCase(),
      rows: [],
      summary: {
        totalInvokerTx: 0,
        totalExecutionsLive02: 0,
        totalExecutionsLive04: 0,
        totalErrorsLive02: 0,
        totalErrorsLive04: 0,
        totalJumpsLive02: 0,
        totalJumpsLive04: 0,
        avgDurationLive02: 0,
        avgDurationLive04: 0,
      },
    };
  }

  const baseFilters: MetricsFilters = {
    fromDate,
    toDate,
    bearerToken,
    channelCode: cleanChannelCode,
    channelCodes: cleanChannelCode ? [cleanChannelCode] : undefined,
    searchMode: "pipeline",
    iterateAllInvokerTx: true,
  };

  const totalTasks = uniqueInvokerTx.length * 2;
  let doneTasks = 0;

  const advanceProgress = (message: string) => {
    doneTasks += 1;
    onProgress?.(message);
    onProgressValue?.(
      Math.max(1, Math.min(100, Math.round((doneTasks / totalTasks) * 100)))
    );
  };

  onProgress?.(
    cleanChannelCode
      ? `Preparando informe AWS para canal ${cleanChannelCode}...`
      : "Preparando informe AWS..."
  );
  onProgressValue?.(3);

  const rows = await Promise.all(
    uniqueInvokerTx.map(async (invokerTx) => {
      const [live02, live04] = await Promise.all([
        awsInformLimiter(async () => {
          const data = await fetchAwsSiteMetricsForInvokerTx(
            baseFilters,
            "LIVE-02",
            invokerTx
          );
          advanceProgress(`${invokerTx} · LIVE-02 listo`);
          return data;
        }),
        awsInformLimiter(async () => {
          const data = await fetchAwsSiteMetricsForInvokerTx(
            baseFilters,
            "LIVE-04",
            invokerTx
          );
          advanceProgress(`${invokerTx} · LIVE-04 listo`);
          return data;
        }),
      ]);

      return {
        invokerTx,
        live02,
        live04,
        deltaExecutions: live04.executions - live02.executions,
        deltaTechnicalErrors: live04.technicalErrors - live02.technicalErrors,
        deltaMeanDurationMs: live04.meanDurationMs - live02.meanDurationMs,
        deltaJumps: live04.jumps - live02.jumps,
      } satisfies AwsInformComparisonRow;
    })
  );

  rows.sort((a, b) => {
    const totalA = a.live02.executions + a.live04.executions;
    const totalB = b.live02.executions + b.live04.executions;
    return totalB - totalA;
  });

  const totalExecutionsLive02 = rows.reduce(
    (sum, row) => sum + row.live02.executions,
    0
  );

  const totalExecutionsLive04 = rows.reduce(
    (sum, row) => sum + row.live04.executions,
    0
  );

  const totalErrorsLive02 = rows.reduce(
    (sum, row) => sum + row.live02.technicalErrors,
    0
  );

  const totalErrorsLive04 = rows.reduce(
    (sum, row) => sum + row.live04.technicalErrors,
    0
  );

  const totalJumpsLive02 = rows.reduce(
    (sum, row) => sum + row.live02.jumps,
    0
  );

  const totalJumpsLive04 = rows.reduce(
    (sum, row) => sum + row.live04.jumps,
    0
  );

  const avgDurationLive02 =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + row.live02.meanDurationMs, 0) /
        rows.length
      : 0;

  const avgDurationLive04 =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + row.live04.meanDurationMs, 0) /
        rows.length
      : 0;

  onProgress?.("Informe AWS generado");
  onProgressValue?.(100);

  return {
    channelCode: cleanChannelCode?.toUpperCase(),
    rows,
    summary: {
      totalInvokerTx: rows.length,
      totalExecutionsLive02,
      totalExecutionsLive04,
      totalErrorsLive02,
      totalErrorsLive04,
      totalJumpsLive02,
      totalJumpsLive04,
      avgDurationLive02,
      avgDurationLive04,
    },
  };
}

/**
 * Consulta principal.
 *
 * Si el usuario selecciona varios canales, se ejecuta una consulta por canal
 * para que la tabla muestre una fila separada:
 *
 * TX + MG
 * TX + 70
 * TX + LE
 */
export async function fetchFullMetrics(
  baseFilters: MetricsFilters,
  onProgress?: (msg: string) => void
): Promise<MetricRow[]> {
  const selectedChannelCodes = getSelectedChannelCodes(baseFilters);

  if (selectedChannelCodes.length > 1) {
    const allRows: MetricRow[] = [];

    for (const channelCode of selectedChannelCodes) {
      const channelFilters = buildSingleChannelFilters(
        baseFilters,
        channelCode
      );

      onProgress?.(`Consultando canal ${channelCode}...`);

      const channelRows = await fetchFullMetricsSingleChannel(
        channelFilters,
        onProgress
      );

      allRows.push(...channelRows);
    }

    return allRows;
  }

  return fetchFullMetricsSingleChannel(baseFilters, onProgress);
}

async function fetchFullMetricsSingleChannel(
  baseFilters: MetricsFilters,
  onProgress?: (msg: string) => void
): Promise<MetricRow[]> {
  const channelLabel = getChannelCodeLabel(baseFilters);

  onProgress?.(
    channelLabel !== "-"
      ? `Obteniendo invokerTx desde MU para canal ${channelLabel}...`
      : "Obteniendo invokerTx desde MU..."
  );

  const invokerTxBuckets = await fetchInvokerTxBuckets(baseFilters);

  const txMetaRows = invokerTxBuckets
    .map((b) => ({
      site: baseFilters.site ?? "",
      channelCode: channelLabel,
      meta: {
        invokerTx: String(b.bucket?.name ?? "").trim(),
        sum_num_executions: Number(b.values?.sum_num_executions ?? 0),
        mean_span_duration: Number(b.values?.mean_span_duration ?? 0),
        sum_functional_error: Number(b.values?.sum_functional_error ?? 0),
        sum_technical_error: Number(b.values?.sum_technical_error ?? 0),
      },
    }))
    .filter((row) => row.meta.invokerTx.length > 0);

  const uniqueTxMetaRows: typeof txMetaRows = [];
  const seenInvokerTx = new Set<string>();

  for (const row of txMetaRows) {
    const key = `${row.channelCode}-${row.meta.invokerTx}`;

    if (seenInvokerTx.has(key)) continue;

    seenInvokerTx.add(key);
    uniqueTxMetaRows.push(row);
  }

  let finalTxMetaRows = uniqueTxMetaRows;

  if (baseFilters.invokerTx?.trim()) {
    finalTxMetaRows = finalTxMetaRows.filter(
      (row) => row.meta.invokerTx === baseFilters.invokerTx?.trim()
    );
  }

  if (
    !baseFilters.iterateAllInvokerTx &&
    baseFilters.limit &&
    baseFilters.limit > 0
  ) {
    finalTxMetaRows = finalTxMetaRows.slice(0, baseFilters.limit);
  }

  const rows: MetricRow[] = [];

  for (const txRow of finalTxMetaRows) {
    const txMeta = txRow.meta;

    onProgress?.(
      `Obteniendo library de ${txMeta.invokerTx} · canal ${txRow.channelCode}...`
    );

    const libraryBuckets = await fetchInvokerLibraryBuckets(
      baseFilters,
      txMeta.invokerTx
    );

    const libraries = libraryBuckets
      .map((lb) => ({
        invokerLibrary: String(
          lb.bucket?.invokerLibrary ??
            lb.bucket?.["invokerLibrary"] ??
            lb.bucket?.name ??
            ""
        ).trim(),
        count: Number(lb.values?.count_utility_count ?? 0),
      }))
      .filter((x) => x.invokerLibrary.length > 0);

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
          utilitytype: String(
            ub.bucket?.utilitytype ??
              ub.bucket?.["utilitytype"] ??
              ub.bucket?.name ??
              ""
          ).trim(),
          count: Number(ub.values?.count_utility_count ?? 0),
        }))
        .filter((x) => x.utilitytype.length > 0);

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
            invokedparam: String(
              ip.bucket?.invokedparam ??
                ip.bucket?.["invokedparam"] ??
                ip.bucket?.name ??
                ""
            ).trim(),
            count: Number(ip.values?.count_utility_count ?? 0),
            maxDuration: Number(ip.values?.max_utility_duration ?? 0),
          }))
          .filter((x) => x.invokedparam.length > 0);

        invokedParamBlocks.push(...invokedParams);
      }
    }

    onProgress?.(
      `Obteniendo trace de ${txMeta.invokerTx} · canal ${txRow.channelCode}...`
    );

    const responseTimeMs = Number(txMeta.mean_span_duration ?? 0);

    console.log("[metricsService trace lookup]", {
      invokerTx: txMeta.invokerTx,
      channelCode: txRow.channelCode,
      responseTimeMs,
    });

    const trace = await fetchTraceSummaryForInvokerTx(
      baseFilters,
      txMeta.invokerTx,
      responseTimeMs
    );

    rows.push({
      site: txRow.site,
      channelCode: txRow.channelCode,
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