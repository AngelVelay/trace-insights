import type {
  AggregateField,
  MetricMethod,
  MetricSetName,
  OperationType,
} from "@/types/bbva";

function resolveBaseUrl(baseUrl?: string): string {
  if (!baseUrl?.trim()) {
    return `${window.location.origin}/`;
  }

  const trimmed = baseUrl.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }

  const resolved = new URL(trimmed, window.location.origin).toString();
  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

export function buildSiteFilter(site?: string): string | undefined {
  if (!site?.trim()) return undefined;
  return `("site" == "${site.trim()}")`;
}

export function buildInvokerTxFilter(invokerTx?: string): string | undefined {
  if (!invokerTx?.trim()) return undefined;
  return `("invokerTx" == "${invokerTx.trim()}")`;
}

export function buildInvokerLibraryFilter(
  invokerLibrary?: string
): string | undefined {
  if (!invokerLibrary?.trim()) return undefined;
  return `("invokerLibrary" == "${invokerLibrary.trim()}")`;
}

export function buildUtilityTypeFilter(utilityType?: string): string | undefined {
  const cleanUtilityType = utilityType?.trim();

  if (!cleanUtilityType || cleanUtilityType === "all") {
    return undefined;
  }

  return `("utilitytype" == "${cleanUtilityType}")`;
}

export function buildChannelCodeFilter(
  channelCode?: string | string[]
): string | undefined {
  const rawCodes = Array.isArray(channelCode)
    ? channelCode
    : channelCode
      ? [channelCode]
      : [];

  const codes = Array.from(
    new Set(
      rawCodes
        .map((code) => String(code).trim())
        .filter((code) => code && code !== "all")
    )
  );

  if (!codes.length) {
    return undefined;
  }

  const clauses = codes.map(
    (code) => `("properties.channel-code" == "${code}")`
  );

  if (clauses.length === 1) {
    return clauses[0];
  }

  return `(${clauses.join(" or ")})`;
}

export function buildCompoundQuery(
  ...parts: Array<string | undefined | null | false>
): string {
  return parts.filter(Boolean).join(" AND ");
}

export function buildMetricsUrl(params: {
  metricSet: MetricSetName;
  method: MetricMethod;
  fromTimestamp: string;
  toTimestamp: string;
  propertiesSize?: number;
  aggregate?: AggregateField;
  q?: string;
  operations: OperationType[];
  baseUrl: string;
  granularity?: string;
}): string {
  const {
    metricSet,
    method,
    fromTimestamp,
    toTimestamp,
    propertiesSize,
    aggregate,
    q,
    operations,
    baseUrl,
    granularity,
  } = params;

  const resolvedBase = resolveBaseUrl(baseUrl);

  const url = new URL(
    `v0/ns/apx.online/metric-sets/${metricSet}:${method}`,
    resolvedBase
  );

  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("toTimestamp", toTimestamp);

  if (typeof propertiesSize === "number") {
    url.searchParams.set("propertiesSize", String(propertiesSize));
  }

  if (aggregate) {
    url.searchParams.set("aggregate", `"${aggregate}"`);
  }

  if (q?.trim()) {
    url.searchParams.set("q", q.trim());
  }

  if (granularity?.trim()) {
    url.searchParams.set("granularity", granularity.trim());
  }

  for (const operation of operations) {
    url.searchParams.append("operation", operation);
  }

  return url.toString();
}