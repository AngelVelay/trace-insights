// ============================================================
// Generic URL builder for MU metric endpoints
// ============================================================
import type { MetricSetName, MetricMethod, OperationType, NanoTimestamp } from '@/types/bbva';

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
  } = params;

  const url = new URL(`/api/mu/v0/ns/apx.online/metric-sets/${metricSet}:${method}`, window.location.origin);
  url.searchParams.set('fromTimestamp', fromTimestamp);
  url.searchParams.set('toTimestamp', toTimestamp);

  if (method === 'listAggregations') {
    url.searchParams.set('propertiesSize', String(propertiesSize));
  }

  if (granularity && method === 'listTimeseries') {
    url.searchParams.set('granularity', granularity);
  }

  url.searchParams.set('aggregate', `"${aggregate}"`);
  url.searchParams.set('q', q);

  operations.forEach((op) => {
    url.searchParams.append('operation', op);
  });

  return url.toString();
}

// ---- Query builders ----
export function buildSiteFilter(site: string): string {
  return `"site" == "${site}"`;
}

export function buildInvokerTxFilter(invokerTx: string): string {
  return `"invokerTx" == "${invokerTx}"`;
}

export function buildUtilityTypeFilter(utilityType: string): string {
  return `"utilitytype" == "${utilityType}"`;
}

export function buildCompoundQuery(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' AND ');
}

export function buildUtilityTypeOrQuery(types: string[]): string {
  return `(${types.map((t) => `utilitytype="${t}"`).join(' or ')})`;
}

// ---- RHO URL builder ----
export function buildRhoSpansUrl(params: {
  invokerTx: string;
  site: string;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
}): string {
  const { invokerTx, site, fromTimestamp, toTimestamp } = params;
  const q = `name == "**" and properties.invokerTx == "${invokerTx}*" and properties.site == "${site}"`;
  const url = new URL('/api/rho/v1/ns/apx.online/spans', window.location.origin);
  url.searchParams.set('q', q);
  url.searchParams.set('sort', 'ascending');
  url.searchParams.set('fromDate', fromTimestamp);
  url.searchParams.set('toDate', toTimestamp);
  url.searchParams.set('properties', 'channel-code,environ-code,env,product-code,returncode');
  url.searchParams.set('profile', 'default');
  return url.toString();
}
