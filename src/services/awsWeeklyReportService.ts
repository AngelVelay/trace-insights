import { endOfDay, format, startOfDay, subDays } from "date-fns";
import type { AggregationBucket, AggregationResponse, OperationType } from "@/types/bbva";
import { apiRequest, buildAuthHeaders, createConcurrencyLimiter } from "@/services/httpClient";
import { dateRangeToNano } from "@/services/dateUtils";
import { buildCompoundQuery, buildMetricsUrl, buildSiteFilter } from "@/services/urlBuilder";

export type AwsWeeklyMetric = "executions" | "responseTime" | "errors";
export type AwsWeeklyPreset = "day" | "week" | "fortnight" | "month" | "custom";

export interface AwsWeeklyQuery {
  fromDate: Date;
  toDate: Date;
  bearerToken: string;
  site?: string;
  transactions?: string[];
  discoverTransactions?: boolean;
  onProgress?: (message: string, percent: number) => void;
}

export interface AwsWeeklyCell {
  executions: number;
  responseTime: number;
  errors: number;
}

export interface AwsWeeklyRow {
  trx: string;
  byDate: Record<string, AwsWeeklyCell>;
}

export interface AwsWeeklyResult {
  referenceDate: string;
  dates: string[];
  rows: AwsWeeklyRow[];
  discoveredTransactions: string[];
}

type UnknownRecord = Record<string, unknown>;
type TechnicalBucket = AggregationBucket & UnknownRecord;

const BASE_URL = "https://mu.live-02.nextgen.igrupobbva";
const limiter = createConcurrencyLimiter(4);

function normalizeTrx(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();
  return raw.split("(")[0].trim().replace(/-/g, "");
}

function cleanTransactions(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeTrx).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function parseAwsWeeklyTransactions(value: string): string[] {
  return cleanTransactions(value.split(/[\n,;\t ]+/g));
}

function extractBuckets(payload: AggregationResponse): TechnicalBucket[] {
  return (payload.buckets ?? payload.data ?? payload.aggregations ?? []) as TechnicalBucket[];
}

function readPath(source: unknown, path: string[]): unknown {
  let cursor = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as UnknownRecord)[key];
  }
  return cursor;
}

function toNumber(value: unknown): number | undefined {
  if (value && typeof value === "object" && "value" in (value as UnknownRecord)) {
    return toNumber((value as UnknownRecord).value);
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeResponseTimeMs(value: number): number {
  const absoluteValue = Math.abs(value);

  // Decimal dañado al copiar/interpretar 143.9999534774160 como
  // 1.439.999.534.774.160. Recupera aproximadamente 144 ms.
  if (absoluteValue >= 1e12) {
    return value / 1e13;
  }

  // span_duration puede llegar en nanosegundos.
  if (absoluteValue >= 1e6) {
    return value / 1e6;
  }

  // Atenea ya puede devolver el promedio directamente en ms.
  return value;
}

function getNumericValue(bucket: TechnicalBucket, aliases: string[]): number | undefined {
  const containers: unknown[] = [
    readPath(bucket, ["values"]),
    readPath(bucket, ["metrics"]),
    readPath(bucket, ["value"]),
    bucket,
  ];

  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    for (const alias of aliases) {
      const candidate = toNumber((container as UnknownRecord)[alias]);
      if (candidate !== undefined) return candidate;
    }
  }

  return undefined;
}

function getBucketTrx(bucket: TechnicalBucket): string {
  const candidates = [
    readPath(bucket, ["bucket", "name"]),
    readPath(bucket, ["bucket", "invokerTx"]),
    readPath(bucket, ["bucket", "value"]),
    readPath(bucket, ["name"]),
    readPath(bucket, ["invokerTx"]),
    readPath(bucket, ["label"]),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeTrx(candidate);
    if (normalized) return normalized;
  }

  return "";
}

async function fetchAggregation(params: {
  fromDate: Date;
  toDate: Date;
  bearerToken: string;
  site?: string;
  operations: OperationType[];
}): Promise<TechnicalBucket[]> {
  const { from, to } = dateRangeToNano(params.fromDate, params.toDate);
  const q = buildCompoundQuery(buildSiteFilter(params.site || "LIVE-04"));

  const url = buildMetricsUrl({
    metricSet: "technical-dashboard",
    method: "listAggregations",
    fromTimestamp: from,
    toTimestamp: to,
    propertiesSize: 20000,
    aggregate: "name",
    q,
    operations: params.operations,
    baseUrl: BASE_URL,
  });

  const response = await apiRequest<AggregationResponse>(url, {
    headers: buildAuthHeaders(params.bearerToken),
    timeoutMs: 90000,
  });

  const buckets = extractBuckets(response);
  console.log("[AWS Reporte Semanal] agregación", {
    operations: params.operations,
    from: params.fromDate,
    to: params.toDate,
    site: params.site || "LIVE-04",
    bucketCount: buckets.length,
    sample: buckets.slice(0, 3),
  });

  return buckets;
}

function buildDayRanges(fromDate: Date, toDate: Date): Array<{ key: string; from: Date; to: Date }> {
  const ranges: Array<{ key: string; from: Date; to: Date }> = [];
  const cursor = startOfDay(fromDate);
  const last = startOfDay(toDate);

  while (cursor.getTime() <= last.getTime()) {
    const date = new Date(cursor);
    ranges.push({
      key: format(date, "yyyy-MM-dd"),
      from: startOfDay(date),
      to: endOfDay(date),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return ranges;
}

function buildDailyCells(params: {
  transactions: string[];
  metricBuckets: TechnicalBucket[];
  responseTimeBuckets: TechnicalBucket[];
}): Map<string, AwsWeeklyCell> {
  const result = new Map<string, AwsWeeklyCell>();
  const weightedTime = new Map<string, { sum: number; weight: number }>();

  for (const trx of params.transactions) {
    result.set(trx, { executions: 0, responseTime: 0, errors: 0 });
  }

  for (const bucket of params.metricBuckets) {
    const trx = getBucketTrx(bucket);
    const current = result.get(trx);
    if (!current) continue;

    const executions = getNumericValue(bucket, ["sum_num_executions", "sum:num_executions", "num_executions"]) ?? 0;
    const technicalErrors = getNumericValue(bucket, ["sum_technical_error", "sum:technical_error", "technical_error"]) ?? 0;
    const functionalErrors = getNumericValue(bucket, ["sum_functional_error", "sum:functional_error", "functional_error"]) ?? 0;

    current.executions += executions;
    current.errors += technicalErrors + functionalErrors;
  }

  for (const bucket of params.responseTimeBuckets) {
    const trx = getBucketTrx(bucket);
    const current = result.get(trx);
    if (!current) continue;

    const responseTime = getNumericValue(bucket, [
      "mean_span_duration",
      "mean:span_duration",
      "span_duration",
      "meanSpanDuration",
      "avg_span_duration",
    ]);

    if (responseTime === undefined) continue;

    const executions = Math.max(
      1,
      getNumericValue(bucket, ["sum_num_executions", "sum:num_executions", "num_executions"]) ?? current.executions,
    );

    const aggregate = weightedTime.get(trx) ?? { sum: 0, weight: 0 };
    aggregate.sum += normalizeResponseTimeMs(responseTime) * executions;
    aggregate.weight += executions;
    weightedTime.set(trx, aggregate);
  }

  for (const [trx, aggregate] of weightedTime) {
    const current = result.get(trx);
    if (current && aggregate.weight > 0) {
      current.responseTime = aggregate.sum / aggregate.weight;
    }
  }

  return result;
}

export async function fetchAwsWeeklyReport(query: AwsWeeklyQuery): Promise<AwsWeeklyResult> {
  if (!query.bearerToken.trim()) throw new Error("Bearer Token es requerido.");
  if (query.fromDate.getTime() > query.toDate.getTime()) {
    throw new Error("La fecha inicial no puede ser mayor que la fecha final.");
  }

  let discoveredTransactions: string[] = [];
  let transactions = cleanTransactions(query.transactions ?? []);

  if (query.discoverTransactions || !transactions.length) {
    query.onProgress?.("Descubriendo TRX ejecutadas en el último mes...", 4);
    const discoveryTo = new Date();
    const discoveryFrom = new Date(discoveryTo);
    discoveryFrom.setMonth(discoveryFrom.getMonth() - 1);

    const buckets = await fetchAggregation({
      fromDate: discoveryFrom,
      toDate: discoveryTo,
      bearerToken: query.bearerToken,
      site: query.site,
      operations: ["sum:num_executions"],
    });

    discoveredTransactions = cleanTransactions(buckets.map(getBucketTrx));
    if (!transactions.length) transactions = discoveredTransactions;
  }

  if (!transactions.length) {
    return { referenceDate: format(subDays(startOfDay(query.fromDate), 1), "yyyy-MM-dd"), dates: [], rows: [], discoveredTransactions };
  }

  const referenceDate = subDays(startOfDay(query.fromDate), 1);
  const visibleDayRanges = buildDayRanges(query.fromDate, query.toDate);
  const dayRanges = buildDayRanges(referenceDate, query.toDate);
  const rowMap = new Map<string, AwsWeeklyRow>(
    transactions.map((trx) => [trx, { trx, byDate: {} }]),
  );

  let completed = 0;
  await Promise.all(
    dayRanges.map((day) =>
      limiter(async () => {
        const [metricBuckets, responseTimeBuckets] = await Promise.all([
          fetchAggregation({
            fromDate: day.from,
            toDate: day.to,
            bearerToken: query.bearerToken,
            site: query.site,
            operations: [
              "sum:num_executions",
              "sum:technical_error",
              "sum:functional_error",
            ],
          }),
          fetchAggregation({
            fromDate: day.from,
            toDate: day.to,
            bearerToken: query.bearerToken,
            site: query.site,
            operations: ["mean:span_duration", "sum:num_executions"],
          }),
        ]);

        const cells = buildDailyCells({ transactions, metricBuckets, responseTimeBuckets });
        for (const [trx, cell] of cells) {
          rowMap.get(trx)!.byDate[day.key] = cell;
        }

        completed += 1;
        query.onProgress?.(
          `Consultando ${day.key} (${completed}/${dayRanges.length})...`,
          Math.round(8 + (completed / Math.max(dayRanges.length, 1)) * 92),
        );
      }),
    ),
  );

  const rows = Array.from(rowMap.values()).sort((a, b) => a.trx.localeCompare(b.trx));

  return {
    referenceDate: format(referenceDate, "yyyy-MM-dd"),
    dates: visibleDayRanges.map((item) => item.key),
    rows,
    discoveredTransactions,
  };
}
