// ============================================================
// URL Builders for MU and RHO
// ============================================================
import type {
  AggregateField,
  MetricMethod,
  MetricSetName,
  NanoTimestamp,
  OperationType,
} from "@/types/bbva";

const DEFAULT_MU_BASE =
  import.meta.env.VITE_MU_BASE_URL ||
  "https://mu.live-02.nextgen.igrupobbva";

const DEFAULT_RHO_BASE =
  import.meta.env.VITE_RHO_BASE_URL ||
  "https://rho.live-02.nextgen.igrupobbva";

function ensureQuoted(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed;
  return `"${trimmed}"`;
}

function clean(value: string): string {
  return String(value ?? "").trim();
}

// -------------------------
// Query builders
// -------------------------
export function buildSiteFilter(site: string): string {
  return `"site" == "${clean(site)}"`;
}

export function buildInvokerTxFilter(invokerTx: string): string {
  return `"invokerTx" == "${clean(invokerTx)}"`;
}

export function buildInvokerLibraryFilter(invokerLibrary: string): string {
  return `"invokerLibrary" == "${clean(invokerLibrary)}"`;
}

export function buildUtilityTypeFilter(utilityType: string): string {
  return `utilitytype="${clean(utilityType)}"`;
}

export function buildUtilityTypeOrQuery(types: string[]): string {
  const valid = types.map(clean).filter(Boolean);
  return `(${valid.map((t) => `utilitytype="${t}"`).join(" or ")})`;
}

export function buildCompoundQuery(
  ...parts: Array<string | undefined | null | false>
): string {
  return parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" AND ");
}

export function buildInvokedParamQuery(params: {
  invokerTx: string;
  invokerLibrary: string;
  utilityTypes: string[];
}): string {
  const left = `("invokerTx" == "${clean(params.invokerTx)}" AND "invokerLibrary" == "${clean(
    params.invokerLibrary
  )}")`;
  const right = buildUtilityTypeOrQuery(params.utilityTypes);
  return `${left} AND ${right}`;
}

// -------------------------
// MU builders
// -------------------------
export function buildMetricsUrl(params: {
  metricSet: MetricSetName;
  method: MetricMethod;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  propertiesSize?: number;
  aggregate: AggregateField;
  q: string;
  operations: OperationType[];
  baseUrl?: string;
}): string {
  const {
    metricSet,
    method,
    fromTimestamp,
    toTimestamp,
    propertiesSize = 20000,
    aggregate,
    q,
    operations,
    baseUrl = DEFAULT_MU_BASE,
  } = params;

  const url = new URL(
    `/v0/ns/apx.online/metric-sets/${metricSet}:${method}`,
    baseUrl
  );

  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("toTimestamp", toTimestamp);
  url.searchParams.set("propertiesSize", String(propertiesSize));
  url.searchParams.set("aggregate", ensureQuoted(aggregate));
  url.searchParams.set("q", q);

  for (const op of operations) {
    url.searchParams.append("operation", op);
  }

  return url.toString();
}

// -------------------------
// RHO builders
// -------------------------
export function buildRhoSpanSearchUrl(params: {
  invokerTx: string;
  fromDate: NanoTimestamp;
  toDate: NanoTimestamp;
  baseUrl?: string;
}): string {
  const {
    invokerTx,
    fromDate,
    toDate,
    baseUrl = DEFAULT_RHO_BASE,
  } = params;

  const url = new URL("/v1/ns/apx.online/spans", baseUrl);
  url.searchParams.set("q", `name == "${clean(invokerTx)}"`);
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set(
    "properties",
    "channel-code,environ-code,env,product-code,returncode"
  );
  url.searchParams.set("profile", "default");

  return url.toString();
}

export function buildRhoTraceUrl(params: {
  spanId: string;
  fromDate: NanoTimestamp;
  toDate: NanoTimestamp;
  baseUrl?: string;
}): string {
  const {
    spanId,
    fromDate,
    toDate,
    baseUrl = DEFAULT_RHO_BASE,
  } = params;

  const url = new URL(
    `/v1/ns/apx.online/mrs/RhoTraces/spans/${clean(spanId)}:trace`,
    baseUrl
  );

  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set("profile", "default");
  url.searchParams.set("crossRegion", "false");

  return url.toString();
}