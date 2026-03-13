// ============================================================
// BBVA Metrics & Traces - Type Definitions
// ============================================================

export type NanoTimestamp = string;

export type SearchMode = "pipeline" | "utility" | "rho";

export interface MetricsFilters {
  fromDate: Date;
  toDate: Date;
  site?: string;
  invokerTx?: string;
  utilityType?: string;
  invokerLibrary?: string;
  limit?: number;
  bearerToken?: string;
  searchMode?: SearchMode;
  iterateAllInvokerTx?: boolean;
}

export type AggregateField =
  | "name"
  | "invokerTx"
  | "utilitytype"
  | "invokerLibrary"
  | "invokedparam"
  | "typology"
  | "invokedHostTx"
  | "databaseInstance"
  | "site"
  | "env";

export type OperationType =
  | "sum:num_executions"
  | "mean:span_duration"
  | "sum:technical_error"
  | "sum:functional_error"
  | "count:utility_count"
  | "min:utility_duration"
  | "mean:utility_duration"
  | "max:utility_duration";

export type MetricSetName = "functional-dashboard" | "utility-metric-set";
export type MetricMethod = "listAggregations" | "listTimeseries";

export interface AggregationBucket {
  bucket: Record<string, string>;
  values: Record<string, number>;
}

export interface AggregationResponse {
  data?: AggregationBucket[];
  aggregations?: AggregationBucket[];
}

export interface TimeseriesPoint {
  timestamp: string;
  values: Record<string, number>;
}

export interface TimeseriesResponse {
  data?: TimeseriesPoint[];
  timeseries?: TimeseriesPoint[];
}

export interface RawSpan {
  spanId?: string;
  traceId?: string;
  name?: string;
  duration?: number | null;
  startTime?: string | number;
  endTime?: string | number;
  startDate?: number;
  finishDate?: number;
  properties?: Record<string, string>;
  children?: RawSpan[];
}

export interface SpansPaginatedResponse {
  data?: RawSpan[];
  pagination?: {
    totalElements?: number;
    links?: {
      first?: string;
      next?: string;
    };
  };
}

export interface NormalizedSpan {
  spanId: string;
  traceId: string;
  name: string;
  durationMs: number;
  utilityType: UtilityType | string;
  properties: Record<string, string>;
}

export const UTILITY_TYPES = [
  "InterBackendCics",
  "APIInternalConnectorImpl",
  "Jdbc",
  "DaasMongoConnector",
  "APIExternalConnectorImpl",
  "TitanClient",
  "GRPCClient",
  "Jpa",
] as const;

export type UtilityType = (typeof UTILITY_TYPES)[number];

export interface MetricRow {
  site: string;
  invokerTx: string;
  invokerLibrary: string;
  utilitytype: string;
  invokedparam: string;
  utility_count: number;
  min_utility_duration: number;
  mean_utility_duration: number;
  max_utility_duration: number;
}

export interface KPISummary {
  totalInvokerTx: number;
  totalUtilityTypes: number;
  totalInvokedParams: number;
  totalJumps: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface ClassifiedTraces {
  InterBackendCics: NormalizedSpan[];
  APIInternalConnectorImpl: NormalizedSpan[];
  Jdbc: NormalizedSpan[];
  DaasMongoConnector: NormalizedSpan[];
  other: NormalizedSpan[];
}

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
}