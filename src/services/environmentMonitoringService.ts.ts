import type { NanoTimestamp } from "@/types/bbva";
import { apiRequest, buildAuthHeaders } from "./httpClient";
import { dateRangeToNano } from "./dateUtils";

export type EnvironmentOption =
  | "DEV"
  | "INT"
  | "AUS"
  | "OCT"
  | "PRZ"
  | "LIVE-02";

export interface EnvironmentMonitoringFilters {
  environment: EnvironmentOption;
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
}

interface TimeseriesMetricPoint {
  timestamp: number;
  values: Record<string, number>;
}

interface TimeseriesGroup {
  metrics?: TimeseriesMetricPoint[];
}

interface TimeseriesApiResponse {
  timeseries?: TimeseriesGroup[];
  data?: TimeseriesMetricPoint[];
}

export interface EnvironmentMonitoringSummary {
  environment: EnvironmentOption;
  technicalErrors: number;
  executions: number;
  meanSpanDuration: number;
}

const MU_BASE = "https://mu.live-02.nextgen.igrupobbva";

function buildTimeseriesUrl(params: {
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  operation: "sum:technical_error" | "sum:num_executions" | "mean:span_duration";
  environment: EnvironmentOption;
}): string {
  const { fromTimestamp, toTimestamp, operation, environment } = params;

  const url = new URL(
    "/v0/ns/apx.online/metric-sets/technical-dashboard:listTimeseries",
    MU_BASE
  );

  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("toTimestamp", toTimestamp);
  url.searchParams.set("granularity", "30s");

  // Si el campo real no es env, aquí solo cambias esta línea.
  url.searchParams.set("q", `"env" == "${environment}"`);

  url.searchParams.append("operation", operation);

  return url.toString();
}

function extractMetricPoints(payload: TimeseriesApiResponse): TimeseriesMetricPoint[] {
  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (Array.isArray(payload.timeseries)) {
    return payload.timeseries.flatMap((group) => group.metrics ?? []);
  }

  return [];
}

function sumMetricValues(
  payload: TimeseriesApiResponse,
  key: "sum_technical_error" | "sum_num_executions" | "mean_span_duration"
): number {
  const points = extractMetricPoints(payload);

  return points.reduce((sum, point) => {
    return sum + Number(point.values?.[key] ?? 0);
  }, 0);
}

async function fetchTimeseriesSum(
  filters: EnvironmentMonitoringFilters,
  operation: "sum:technical_error" | "sum:num_executions" | "mean:span_duration",
  responseKey: "sum_technical_error" | "sum_num_executions" | "mean_span_duration"
): Promise<number> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

  const url = buildTimeseriesUrl({
    fromTimestamp: from,
    toTimestamp: to,
    operation,
    environment: filters.environment,
  });

  const headers = buildAuthHeaders(filters.bearerToken);

  const res = await apiRequest<TimeseriesApiResponse>(url, { headers });
  return sumMetricValues(res, responseKey);
}

export async function fetchEnvironmentMonitoringSummary(
  filters: EnvironmentMonitoringFilters
): Promise<EnvironmentMonitoringSummary> {
  const [technicalErrors, executions, meanSpanDuration] = await Promise.all([
    fetchTimeseriesSum(filters, "sum:technical_error", "sum_technical_error"),
    fetchTimeseriesSum(filters, "sum:num_executions", "sum_num_executions"),
    fetchTimeseriesSum(filters, "mean:span_duration", "mean_span_duration"),
  ]);

  return {
    environment: filters.environment,
    technicalErrors,
    executions,
    meanSpanDuration,
  };
}