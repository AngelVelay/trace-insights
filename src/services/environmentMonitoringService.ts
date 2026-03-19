import { addDays, format, subDays } from "date-fns";
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

export type InstallationRangeMode = "before" | "after" | "complete";
export type EnvironmentPhase = "before" | "installation" | "after";

export interface EnvironmentDailyFilters {
  environment: EnvironmentOption;
  installationDay: Date;
  rangeMode: InstallationRangeMode;
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

export interface EnvironmentMonitoringDailyRow {
  date: string;
  label: string;
  phase: EnvironmentPhase;
  offset: number;
  technicalErrors: number;
  executions: number;
  meanSpanDuration: number;
}

export interface EnvironmentMonitoringDailyResult {
  environment: EnvironmentOption;
  mode: InstallationRangeMode;
  installationDay: string;
  rows: EnvironmentMonitoringDailyRow[];
  totals: {
    technicalErrors: number;
    executions: number;
    meanSpanDuration: number;
  };
}

const MU_LIVE_BASE = "https://mu.live-02.nextgen.igrupobbva";
const MU_WORK_BASE = "https://mu.work-02.nextgen.igrupobbva";

function getEnvironmentConfig(environment: EnvironmentOption): {
  baseUrl: string;
  granularity: string;
  q?: string;
} {
  if (environment === "LIVE-02") {
    return {
      baseUrl: MU_LIVE_BASE,
      granularity: "30s",
    };
  }

  if (environment === "PRZ") {
    return {
      baseUrl: MU_LIVE_BASE,
      granularity: "43200s",
      q: `"env" == "PRZ"`,
    };
  }

  return {
    baseUrl: MU_WORK_BASE,
    granularity: "43200s",
    q: `"env" == "${environment}"`,
  };
}

function buildTimeseriesUrl(params: {
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  operation: "sum:technical_error" | "sum:num_executions" | "mean:span_duration";
  environment: EnvironmentOption;
}): string {
  const { fromTimestamp, toTimestamp, operation, environment } = params;
  const config = getEnvironmentConfig(environment);

  const url = new URL(
    "/v0/ns/apx.online/metric-sets/technical-dashboard:listTimeseries",
    config.baseUrl
  );

  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("toTimestamp", toTimestamp);
  url.searchParams.set("granularity", config.granularity);

  if (config.q) {
    url.searchParams.set("q", config.q);
  }

  url.searchParams.append("operation", operation);

  return url.toString();
}

function extractMetricPoints(payload: TimeseriesApiResponse): TimeseriesMetricPoint[] {
  if (Array.isArray(payload.data)) return payload.data;
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
  return points.reduce((sum, point) => sum + Number(point.values?.[key] ?? 0), 0);
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

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function buildDailyDates(
  installationDay: Date,
  mode: InstallationRangeMode
): Array<{ date: Date; label: string; phase: EnvironmentPhase; offset: number }> {
  const base = cloneDate(installationDay);

  const dates: Array<{
    date: Date;
    label: string;
    phase: EnvironmentPhase;
    offset: number;
  }> = [];

  if (mode === "before") {
    for (let i = 7; i >= 1; i--) {
      const date = subDays(base, i);
      dates.push({
        date,
        label: format(date, "dd/MM/yyyy HH:mm"),
        phase: "before",
        offset: -i,
      });
    }
    return dates;
  }

  if (mode === "after") {
    for (let i = 1; i <= 7; i++) {
      const date = addDays(base, i);
      dates.push({
        date,
        label: format(date, "dd/MM/yyyy HH:mm"),
        phase: "after",
        offset: i,
      });
    }
    return dates;
  }

  for (let i = 7; i >= 1; i--) {
    const date = subDays(base, i);
    dates.push({
      date,
      label: format(date, "dd/MM/yyyy HH:mm"),
      phase: "before",
      offset: -i,
    });
  }

  dates.push({
    date: base,
    label: format(base, "dd/MM/yyyy HH:mm"),
    phase: "installation",
    offset: 0,
  });

  for (let i = 1; i <= 7; i++) {
    const date = addDays(base, i);
    dates.push({
      date,
      label: format(date, "dd/MM/yyyy HH:mm"),
      phase: "after",
      offset: i,
    });
  }

  return dates;
}

export async function fetchEnvironmentMonitoringDaily(
  filters: EnvironmentDailyFilters
): Promise<EnvironmentMonitoringDailyResult> {
  const days = buildDailyDates(filters.installationDay, filters.rangeMode);

  const rows = await Promise.all(
    days.map(async ({ date, label, phase, offset }) => {
      const fromDate = new Date(date);
      const toDate = new Date(date);
      toDate.setDate(toDate.getDate() + 1);
      toDate.setMilliseconds(toDate.getMilliseconds() - 1);

      const summary = await fetchEnvironmentMonitoringSummary({
        environment: filters.environment,
        fromDate,
        toDate,
        bearerToken: filters.bearerToken,
      });

      return {
        date: format(date, "dd/MM/yyyy HH:mm"),
        label,
        phase,
        offset,
        technicalErrors: summary.technicalErrors,
        executions: summary.executions,
        meanSpanDuration: summary.meanSpanDuration,
      };
    })
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.technicalErrors += row.technicalErrors;
      acc.executions += row.executions;
      acc.meanSpanDuration += row.meanSpanDuration;
      return acc;
    },
    {
      technicalErrors: 0,
      executions: 0,
      meanSpanDuration: 0,
    }
  );

  return {
    environment: filters.environment,
    mode: filters.rangeMode,
    installationDay: format(filters.installationDay, "dd/MM/yyyy HH:mm"),
    rows,
    totals,
  };
}