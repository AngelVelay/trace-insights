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
  aap: string[];
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
  { channelCode: "MG", aap: ["10000033","10000045","10000085","10000088","10000094","10000173","10000180","10000187","10000196","10000201","10000253","10000261","30000043","30000073","30000105"],  executions: 19456326731 },
  { channelCode: "70", aap: ["10000057","10000081","10000194"], executions: 3245706000 },
  { channelCode: "CC", aap: ["10000160"], executions: 382440858 },
  { channelCode: "6G", aap: ["10000133","10000168","10000174","10000219","10000227","10000231","10000255"], executions: 349252808 },
  { channelCode: "LE", aap: [], executions: 197896209 },
  { channelCode: "03", aap: ["10000025","10000095","10000125"], executions: 144851208 },
  { channelCode: "SN", aap: ["1000018610000223","10000224"], executions: 107364425 },
  { channelCode: "60", aap: ["10000061","10000100","10000177","10000192","10000193","10000208","10000211","10000215"], executions: 74897218 },
  { channelCode: "29", aap: ["10000207"], executions: 61052770 },
  { channelCode: "TF", aap: ["10000044"], executions: 52288566 },
  { channelCode: "6Z", aap: ["10000008","10000011","10000130","10000131","10000163","10000182","10000235"], executions: 35018524 },
  { channelCode: "R3", aap: ["10000036"], executions: 34140120 },
  { channelCode: "26", aap: ["10000071","10000072","10000152","10000153"], executions: 21158618 },
  { channelCode: "9G", aap: ["10000066","10000077"], executions: 18111378 },
  { channelCode: "9I", aap: [], executions: 17026305 },
  { channelCode: "20", aap: ["10000056","10000188","10000248"], executions: 10867032 },
  { channelCode: "9D", aap: ["10000064","10000236"], executions: 10441815 },
  { channelCode: "LP", aap: ["10000176","10000183","10000184","10000228","10000230","10000251"], executions: 7501486 },
  { channelCode: "AX", aap: ["10000003","10000225","10000229","10000234","10990003","30000079","30000080"], executions: 7029209 },
  { channelCode: "SA", aap: ["10000059","10000169","10000172","10000209","10000259","30000026"], executions: 5586877 },
  { channelCode: "8A", aap: ["10000028","10000250"], executions: 4225708 },
  { channelCode: "8B", aap: ["10000074","10000075","10000111","10000112","10000162","10000217"], executions: 3222676 },
  { channelCode: "AP", aap: ["10000080","10000220","30000030","30000057"], executions: 3212832 },
  { channelCode: "54", aap: ["10000118"], executions: 3210478 },
  { channelCode: "CA", aap: [], executions: 3150573 },
  { channelCode: "H2", aap: ["10000055","10000067","10000070","10000118","10000155"], executions: 1878288 },
  { channelCode: "51", aap: ["10000008"], executions: 1637809 },
  { channelCode: "IG", aap: ["10000170","10000199"], executions: 1441346 },
  { channelCode: "28", aap: ["10000156","10000254"], executions: 1105873 },
  { channelCode: "15", aap: ["10000051"], executions: 546421 },
  { channelCode: "AM", aap: ["10000116","10000136","10000137"], executions: 519426 },
  { channelCode: "MZ", aap: ["10000117","10000154","10000216","10000243"], executions: 460113 },
  { channelCode: "H3", aap: ["20000055","30000075"], executions: 314553 },
  { channelCode: "9B", aap: ["10000062","10000068","10000134","10000135"], executions: 317135 },
  { channelCode: "FR", aap: ["30000072"], executions: 320617 },
  { channelCode: "9C", aap: ["10000063"], executions: 211374 },
  { channelCode: "AR", aap: ["30000016","30000041"], executions: 184292 },
  { channelCode: "6B", aap: ["10000093"], executions: 174936 },
  { channelCode: "GC", aap: ["10000237"], executions: 165922 },
  { channelCode: "S1", aap: ["10000120","10000147","10000210","10000222"], executions: 146619 },
  { channelCode: "VB", aap: ["10000050"], executions: 81677 },
  { channelCode: "L1", aap: ["10000226"], executions: 52903 },
  { channelCode: "S2", aap: ["10000119","10000121","10000146"], executions: 30443 },
  { channelCode: "LB", aap: ["10000041","10000042","10000053","10000058","10000065","10000126"], executions: 24812 },
  { channelCode: "EC", aap: [], executions: 23757 },
  { channelCode: "7P", aap: ["10000007","10000079","10000084","10000129","10000132","10000139"], executions: 21368 },
  { channelCode: "9X", aap: ["10000164","10000189","10000206"], executions: 17549 },
  { channelCode: "F2", aap: ["10000017","10000038"], executions: 12658 },
  { channelCode: "W1", aap: ["10000143","10000144","10000158","10000166","10000167","10000190","10000191"], executions: 10076 },
  { channelCode: "FB", aap: ["10000179","10000185"], executions: 9809 },
  { channelCode: "GG", aap: ["10000110"], executions: 7311 },
  { channelCode: "SP", aap: ["10000200"], executions: 5793 },
  { channelCode: "TM", aap: ["10000233"], executions: 2457 },
  { channelCode: "9W", aap: ["10000178","10000202","10000203","10000249","30000078"], executions: 2112 },
  { channelCode: "CL", aap: ["30000008","30000009"], executions: 1997 },
  { channelCode: "9H", aap: ["10000128","10000181"], executions: 1485 },
  { channelCode: "9E", aap: ["10000083","10000106"], executions: 1030 },
  { channelCode: "9A", aap: ["10000043"], executions: 814 },
  { channelCode: "2B", aap: ["10000054"], executions: 609 },
  { channelCode: "27", aap: ["00000033"], executions: 490 },
  { channelCode: "24", aap: ["10000157","30000031","30000042","30000055","30000059"], executions: 300 },
  { channelCode: "01", aap: ["30000038","30000052","30000095"], executions: 201 },
  { channelCode: "BN", aap: ["10000239"], executions: 199 },
  { channelCode: "SC", aap: ["10000240","10000241"], executions: 179 },
  { channelCode: "14", aap: ["30000018","30000019"], executions: 58 },
  { channelCode: "12", aap: ["30000069"], executions: 34 },
  { channelCode: "DC", aap: ["10000256"], executions: 15 },

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