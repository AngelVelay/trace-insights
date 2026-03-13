// ============================================================
// BBVA Metrics & Traces - Type Definitions
// ============================================================

// ---- Date helpers ----
export type NanoTimestamp = string;

// ---- Search mode ----
export type SearchMode = "pipeline" | "utility" | "rho";

// ---- Filter / Query types ----
export interface MetricsFilters {
  fromDate: Date;
  toDate: Date;
  site?: string;
  invokerTx?: string;
  utilityType?: string;
  invokerLibrary?: string;
  limit?: number;
  bearerToken?: string;

  // Extensiones para frontend
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

// ---- API Response types ----
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

// ---- MU response for invokerTx aggregation ----
export interface MuInvokerTxBucket {
  bucket?: {
    invokerTx?: string;
    [key: string]: string | undefined;
  };
  values?: {
    count_utility_count?: number;
    [key: string]: number | undefined;
  };
}

export type MuInvokerTxResponse = MuInvokerTxBucket[] | AggregationResponse;

// ---- InvokerTx aggregated row ----
export interface InvokerTxMetricRow {
  invokerTx: string;
  utilityCount: number;
}

// ---- Span / Trace types ----
export interface RawSpan {
  spanId?: string;
  traceId?: string;
  name?: string;
  duration?: number;
  startTime?: string | number;
  endTime?: string | number;
  properties?: Record<string, string>;
  children?: RawSpan[];
}

export interface SpansPaginatedResponse {
  data: RawSpan[];
  pagination?: {
    totalElements: number;
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

// ---- Utility types ----
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

// ---- Consolidated metric row ----
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

// ---- Pipeline row for rendered table ----
export interface PipelineRow {
  invokerTx: string;
  utilityCount: number;

  interBackendCicsCount: number;
  apiInternalConnectorCount: number;
  jdbcCount: number;
  daasMongoConnectorCount: number;
  otherCount: number;

  totalSpans: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

// ---- KPI summary ----
export interface KPISummary {
  totalInvokerTx: number;
  totalUtilityTypes: number;
  totalInvokedParams: number;
  totalJumps: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

// ---- Trace classification ----
export interface ClassifiedTraces {
  InterBackendCics: NormalizedSpan[];
  APIInternalConnectorImpl: NormalizedSpan[];
  Jdbc: NormalizedSpan[];
  DaasMongoConnector: NormalizedSpan[];
  other: NormalizedSpan[];
}

// ---- API config ----
export interface ApiConfig {
  baseUrl: string; // Our own backend proxy
  timeout: number;
  maxRetries: number;
}