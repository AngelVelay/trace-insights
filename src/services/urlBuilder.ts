// ============================================================
// Generic URL builders for MU and RHO endpoints
// ============================================================
import type {
  MetricSetName,
  MetricMethod,
  OperationType,
  NanoTimestamp,
} from "@/types/bbva";

const MU_REAL_BASE = "https://mu.live-02.platform.bbva.com";
const MU_PROXY_BASE = "http://localhost:8080/api/mu";

const RHO_REAL_BASE = "https://rho.live-02.nextgen.igrupobbva";
const RHO_PROXY_BASE = "http://localhost:8080/api/rho";

export interface MetricsUrlParams {
  metricSet: MetricSetName;
  method: MetricMethod;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  propertiesSize?: number;
  granularity?: string;
  aggregate: string;
  q: string;
  operations: OperationType[];
  useProxy?: boolean; // false = real BBVA endpoint
}

function ensureQuoted(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

function escapeQueryValue(value: string): string {
  return String(value).replace(/"/g, '\\"').trim();
}

export function buildMetricsUrl(params: MetricsUrlParams): string {
  const {
    metricSet,
    method,
    fromTimestamp,
    toTimestamp,
    propertiesSize = 20000,
    granularity,
    aggregate,
    q,
    operations,
    useProxy = false,
  } = params;

  if (!fromTimestamp) {
    throw new Error("fromTimestamp es requerido");
  }

  if (!toTimestamp) {
    throw new Error("toTimestamp es requerido");
  }

  if (!aggregate?.trim()) {
    throw new Error("aggregate es requerido");
  }

  if (!q?.trim()) {
    throw new Error("q es requerido");
  }

  if (!operations?.length) {
    throw new Error("Debe existir al menos una operation");
  }

  const base = useProxy ? MU_PROXY_BASE : MU_REAL_BASE;

  const url = new URL(
    `${base}/v0/ns/apx.online/metric-sets/${metricSet}:${method}`
  );

  url.searchParams.set("fromTimestamp", String(fromTimestamp));
  url.searchParams.set("toTimestamp", String(toTimestamp));

  if (method === "listAggregations") {
    url.searchParams.set("propertiesSize", String(propertiesSize));
  }

  if (method === "listTimeseries") {
    if (!granularity?.trim()) {
      throw new Error("granularity es requerida para listTimeseries");
    }
    url.searchParams.set("granularity", granularity);
  }

  url.searchParams.set("aggregate", ensureQuoted(aggregate));
  url.searchParams.set("q", q.trim());

  for (const op of operations) {
    if (op?.trim()) {
      url.searchParams.append("operation", op.trim());
    }
  }

  return url.toString();
}

// ============================================================
// Query builders
// ============================================================

export function buildEqFilter(field: string, value: string): string {
  return `${ensureQuoted(field)} == ${ensureQuoted(escapeQueryValue(value))}`;
}

export function buildSiteFilter(site: string, field = "site"): string {
  return buildEqFilter(field, site);
}

export function buildInvokerTxFilter(
  invokerTx: string,
  field = "invokerTx"
): string {
  return buildEqFilter(field, invokerTx);
}

export function buildUtilityTypeFilter(
  utilityType: string,
  field = "utilitytype"
): string {
  return buildEqFilter(field, utilityType);
}

export function buildStartsWithFilter(field: string, value: string): string {
  return `${ensureQuoted(field)} == ${ensureQuoted(
    `${escapeQueryValue(value)}*`
  )}`;
}

export function buildCompoundQuery(
  ...parts: Array<string | undefined | null>
): string {
  const clean = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return clean.join(" AND ");
}

export function wrapQuery(query: string): string {
  const clean = query.trim();
  if (!clean) return clean;
  if (clean.startsWith("(") && clean.endsWith(")")) {
    return clean;
  }
  return `(${clean})`;
}

export function buildOrQuery(field: string, values: string[]): string {
  const cleanValues = values
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));

  if (!cleanValues.length) {
    throw new Error(`No hay valores para construir OR en ${field}`);
  }

  return wrapQuery(
    cleanValues.map((v) => buildEqFilter(field, v)).join(" OR ")
  );
}

export function buildUtilityTypeOrQuery(types: string[]): string {
  return buildOrQuery("utilitytype", types);
}

// ============================================================
// RHO URL builder
// ============================================================

export interface RhoSpansUrlParams {
  invokerTx: string;
  site: string;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  useProxy?: boolean; // false = real BBVA endpoint
  sort?: "ascending" | "descending";
  profile?: string;
  properties?: string[];
}

export function buildRhoSpansUrl(params: RhoSpansUrlParams): string {
  const {
    invokerTx,
    site,
    fromTimestamp,
    toTimestamp,
    useProxy = false,
    sort = "ascending",
    profile = "default",
    properties = ["channel-code", "environ-code", "env", "product-code", "returncode"],
  } = params;

  if (!invokerTx?.trim()) {
    throw new Error("invokerTx es requerido");
  }

  if (!site?.trim()) {
    throw new Error("site es requerido");
  }

  if (!fromTimestamp) {
    throw new Error("fromTimestamp es requerido");
  }

  if (!toTimestamp) {
    throw new Error("toTimestamp es requerido");
  }

  const q = buildCompoundQuery(
    buildEqFilter("name", "**"),
    buildStartsWithFilter("properties.invokerTx", invokerTx),
    buildEqFilter("properties.site", site)
  );

  const base = useProxy ? RHO_PROXY_BASE : RHO_REAL_BASE;

  const url = new URL(`${base}/v1/ns/apx.online/spans`);
  url.searchParams.set("q", q);
  url.searchParams.set("sort", sort);
  url.searchParams.set("fromDate", String(fromTimestamp));
  url.searchParams.set("toDate", String(toTimestamp));
  url.searchParams.set("properties", properties.join(","));
  url.searchParams.set("profile", profile);

  return url.toString();
}