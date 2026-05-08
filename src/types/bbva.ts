export type NanoTimestamp = string;

export type SearchMode =
  | "pipeline"
  | "utility"
  | "rho"
  | "versioning-env"
  | "versioning-incidents";

  

export type AggregateField =
  | "name"
  | "invokerTx"
  | "utilitytype"
  | "invokerLibrary"
  | "invokedparam"
  | "channel-code"
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

export type MetricSetName =
  | "functional-dashboard"
  | "utility-metric-set"
  | "technical-dashboard";

export type MetricMethod = "listAggregations" | "listTimeseries";

export interface AggregationBucket {
  bucket: Record<string, string>;
  values: Record<string, number>;
}

export interface AggregationResponse {
  buckets?: AggregationBucket[];
  data?: AggregationBucket[];
  aggregations?: AggregationBucket[];
}

export interface ChannelCodeOption {
  channelCode: string;
  executions: number;
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
  recordDate?: number;
  parentSpan?: string;
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
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  durationMs: number;
  utilityType: string;
  channelCode?: string;
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

export const CHANNEL_CODES: ChannelCodeOption[] = [
  { channelCode: "MG", executions: 19456326731 },
  { channelCode: "70", executions: 3245706000 },
  { channelCode: "CC", executions: 382440858 },
  { channelCode: "6G", executions: 349252808 },
  { channelCode: "LE", executions: 197896209 },
  { channelCode: "03", executions: 144851208 },
  { channelCode: "SN", executions: 107364425 },
  { channelCode: "60", executions: 74897218 },
  { channelCode: "29", executions: 61052770 },
  { channelCode: "TF", executions: 52288566 },
  { channelCode: "6Z", executions: 35018524 },
  { channelCode: "R3", executions: 34140120 },
  { channelCode: "26", executions: 21158618 },
  { channelCode: "9G", executions: 18111378 },
  { channelCode: "9I", executions: 17026305 },
  { channelCode: "20", executions: 10867032 },
  { channelCode: "9D", executions: 10441815 },
  { channelCode: "LP", executions: 7501486 },
  { channelCode: "AX", executions: 7029209 },
  { channelCode: "SA", executions: 5586877 },
  { channelCode: "8A", executions: 4225708 },
  { channelCode: "8B", executions: 3222676 },
  { channelCode: "AP", executions: 3212832 },
  { channelCode: "54", executions: 3210478 },
  { channelCode: "CA", executions: 3150573 },
  { channelCode: "H2", executions: 1878288 },
  { channelCode: "51", executions: 1637809 },
  { channelCode: "IG", executions: 1441346 },
  { channelCode: "28", executions: 1105873 },
  { channelCode: "15", executions: 546421 },
  { channelCode: "AM", executions: 519426 },
  { channelCode: "MZ", executions: 460113 },
  { channelCode: "H3", executions: 314553 },
  { channelCode: "9B", executions: 317135 },
  { channelCode: "FR", executions: 320617 },
  { channelCode: "9C", executions: 211374 },
  { channelCode: "AR", executions: 184292 },
  { channelCode: "6B", executions: 174936 },
  { channelCode: "GC", executions: 165922 },
  { channelCode: "S1", executions: 146619 },
  { channelCode: "VB", executions: 81677 },
  { channelCode: "L1", executions: 52903 },
  { channelCode: "S2", executions: 30443 },
  { channelCode: "LB", executions: 24812 },
  { channelCode: "EC", executions: 23757 },
  { channelCode: "7P", executions: 21368 },
  { channelCode: "9X", executions: 17549 },
  { channelCode: "F2", executions: 12658 },
  { channelCode: "W1", executions: 10076 },
  { channelCode: "FB", executions: 9809 },
  { channelCode: "GG", executions: 7311 },
  { channelCode: "SP", executions: 5793 },
  { channelCode: "TM", executions: 2457 },
  { channelCode: "9W", executions: 2112 },
  { channelCode: "CL", executions: 1997 },
  { channelCode: "9H", executions: 1485 },
  { channelCode: "9E", executions: 1030 },
  { channelCode: "9A", executions: 814 },
  { channelCode: "2B", executions: 609 },
  { channelCode: "27", executions: 490 },
  { channelCode: "24", executions: 300 },
  { channelCode: "01", executions: 201 },
  { channelCode: "BN", executions: 199 },
  { channelCode: "SC", executions: 179 },
  { channelCode: "14", executions: 58 },
  { channelCode: "12", executions: 34 },
  { channelCode: "DC", executions: 15 },
  { channelCode: "7p", executions: 2 },
];

export type UtilityType = (typeof UTILITY_TYPES)[number];

export interface MetricRow {
  site: string;
  invokerTx: string;
  invokerLibrary: string;
  utilitytype: string;
  invokedparam: string;
  trace: string;
  utility_count: number;
  min_utility_duration: number;
  mean_utility_duration: number;
  max_utility_duration: number;
  channelCode?: string;
}

export interface KPISummary {
  totalInvokerTx: number;
  totalUtilityTypes: number;
  totalInvokedParams: number;
  totalExecutions: number;
  totalJumps: number;
  totalDurationMs: number;
  avgDurationMs: number;
  traceApiConnectors: number;
  traceCics: number;
  traceJdbc: number;
  traceMongo: number;
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

export interface MetricsFilters {
  fromDate: Date;
  toDate: Date;
  site?: string;
  invokerTx?: string;
  utilityType?: string;
  invokerLibrary?: string;
  channelCode?: string;
  channelCodes?: string[];
  limit?: number;
  bearerToken?: string;
  searchMode?: SearchMode;
  iterateAllInvokerTx?: boolean;
}