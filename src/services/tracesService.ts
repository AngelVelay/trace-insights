// ============================================================
// RHO Traces Service
// ============================================================
import type {
  RawSpan,
  NormalizedSpan,
  SpansPaginatedResponse,
  ClassifiedTraces,
  MetricsFilters,
} from '@/types/bbva';
import { dateRangeToNano } from './dateUtils';
import { buildRhoSpansUrl } from './urlBuilder';
import { apiRequest, buildAuthHeaders } from './httpClient';

// ---- Normalize duration to ms ----
function normalizeDuration(span: RawSpan): number {
  if (span.duration != null) {
    if (span.duration > 1e12) return span.duration / 1e6;
    if (span.duration > 1e9) return span.duration / 1e3;
    return span.duration;
  }

  if (span.startTime && span.endTime) {
    const start = typeof span.startTime === 'string' ? Number(span.startTime) : span.startTime;
    const end = typeof span.endTime === 'string' ? Number(span.endTime) : span.endTime;
    const diff = end - start;
    if (diff > 1e12) return diff / 1e6;
    if (diff > 1e9) return diff / 1e3;
    return diff;
  }

  return 0;
}

// ---- Infer utility type from span name ----
function inferUtilityType(span: RawSpan): string {
  const ut = span.properties?.utilitytype;
  if (ut) return ut;

  const name = (span.name ?? '').toLowerCase();
  if (name.includes('cics') || name.includes('interbackend')) return 'InterBackendCics';
  if (name.includes('apiinternalconnector') || name.includes('impl')) return 'APIInternalConnectorImpl';
  if (name.includes('jdbc') || name.includes('jpa')) return 'Jdbc';
  if (name.includes('mongo') || name.includes('daas')) return 'DaasMongoConnector';
  if (name.includes('grpc')) return 'GRPCClient';
  if (name.includes('titan')) return 'TitanClient';
  if (name.includes('elastic')) return 'APIInternalConnectorImpl';
  if (name.includes('couchbase')) return 'APIInternalConnectorImpl';

  return 'other';
}

// ---- Flatten hierarchical spans ----
function flattenSpans(spans: RawSpan[]): RawSpan[] {
  const flat: RawSpan[] = [];

  function recurse(span: RawSpan) {
    flat.push(span);
    if (span.children) {
      span.children.forEach(recurse);
    }
  }

  spans.forEach(recurse);
  return flat;
}

// ---- Normalize spans ----
export function normalizeSpans(raw: RawSpan[] | SpansPaginatedResponse): NormalizedSpan[] {
  let allRaw: RawSpan[];

  if (Array.isArray(raw)) {
    allRaw = flattenSpans(raw);
  } else if (raw.data) {
    allRaw = flattenSpans(raw.data);
  } else {
    allRaw = [];
  }

  const seen = new Set<string>();
  const normalized: NormalizedSpan[] = [];

  for (const span of allRaw) {
    const spanId = span.spanId ?? '';
    if (!spanId || seen.has(spanId)) continue;
    seen.add(spanId);

    normalized.push({
      spanId,
      traceId: span.traceId ?? '',
      name: span.name ?? '',
      durationMs: normalizeDuration(span),
      utilityType: inferUtilityType(span),
      properties: span.properties ?? {},
    });
  }

  return normalized;
}

// ---- Classify normalized spans ----
export function classifySpans(spans: NormalizedSpan[]): ClassifiedTraces {
  const result: ClassifiedTraces = {
    InterBackendCics: [],
    APIInternalConnectorImpl: [],
    Jdbc: [],
    DaasMongoConnector: [],
    other: [],
  };

  for (const span of spans) {
    const key = span.utilityType as keyof ClassifiedTraces;
    if (key in result) {
      result[key].push(span);
    } else {
      result.other.push(span);
    }
  }

  return result;
}

// ---- Fetch spans with pagination ----
export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string
): Promise<NormalizedSpan[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const site = filters.site ?? 'LIVE-04';
  const headers = buildAuthHeaders(filters.bearerToken);

  let url: string | null = buildRhoSpansUrl({ invokerTx, site, fromTimestamp: from, toTimestamp: to });
  const allRaw: RawSpan[] = [];

  while (url) {
    const res = await apiRequest<SpansPaginatedResponse>(url, { headers });

    if (res.data) {
      allRaw.push(...res.data);
    }

    url = res.pagination?.links?.next ?? null;
  }

  return normalizeSpans(allRaw);
}
