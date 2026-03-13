// ============================================================
// RHO Traces Service
// ============================================================
import type {
  RawSpan,
  NormalizedSpan,
  SpansPaginatedResponse,
  ClassifiedTraces,
  MetricsFilters,
} from "@/types/bbva";
import { dateRangeToNano } from "./dateUtils";
import { buildRhoSpanSearchUrl, buildRhoTraceUrl } from "./urlBuilder";
import { apiRequest, buildAuthHeaders } from "./httpClient";

function normalizeDuration(span: RawSpan): number {
  if (typeof span.duration === "number" && span.duration !== null) {
    const d = span.duration;

    if (d < 1) {
      return d * 1000;
    }

    if (d > 1_000_000) {
      return d / 1_000_000;
    }

    if (d > 1_000) {
      return d / 1000;
    }

    return d;
  }

  if (
    typeof span.startDate === "number" &&
    typeof span.finishDate === "number" &&
    span.finishDate >= span.startDate
  ) {
    return (span.finishDate - span.startDate) / 1_000_000;
  }

  return 0;
}

function inferUtilityType(span: RawSpan): string {
  const ut = span.properties?.utilitytype;
  if (ut) return ut;

  const name = (span.name ?? "").toLowerCase();

  if (name.includes("jdbc")) return "Jdbc";
  if (name.includes("mongo") || name.includes("daas")) return "DaasMongoConnector";
  if (name.includes("cics") || name.includes("interbackend")) return "InterBackendCics";
  if (name.includes("apiinternalconnector")) return "APIInternalConnectorImpl";

  return "other";
}

function flattenSpans(spans: RawSpan[]): RawSpan[] {
  const flat: RawSpan[] = [];

  const walk = (span: RawSpan) => {
    flat.push(span);
    if (Array.isArray(span.children)) {
      span.children.forEach(walk);
    }
  };

  spans.forEach(walk);
  return flat;
}

export function normalizeSpans(
  raw: RawSpan | RawSpan[] | SpansPaginatedResponse
): NormalizedSpan[] {
  let allRaw: RawSpan[] = [];

  if (Array.isArray(raw)) {
    allRaw = flattenSpans(raw);
  } else if ("data" in raw && Array.isArray(raw.data)) {
    allRaw = flattenSpans(raw.data);
  } else if (raw && typeof raw === "object") {
    allRaw = flattenSpans([raw as RawSpan]);
  }

  const seen = new Set<string>();
  const normalized: NormalizedSpan[] = [];

  for (const span of allRaw) {
    const spanId = span.spanId ?? "";
    if (!spanId || seen.has(spanId)) continue;
    seen.add(spanId);

    normalized.push({
      spanId,
      traceId: span.traceId ?? "",
      name: span.name ?? "",
      durationMs: normalizeDuration(span),
      utilityType: inferUtilityType(span),
      properties: span.properties ?? {},
    });
  }

  return normalized;
}

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

async function searchSpanIds(
  filters: MetricsFilters,
  invokerTx: string
): Promise<string[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  let nextUrl: string | null = buildRhoSpanSearchUrl({
    invokerTx,
    fromDate: from,
    toDate: to,
  });

  const spanIds: string[] = [];

  while (nextUrl) {
    console.debug("[RHO search] Request:", nextUrl);

    const res = await apiRequest<SpansPaginatedResponse>(nextUrl, { headers });

    for (const span of res.data ?? []) {
      if (span.spanId) spanIds.push(span.spanId);
    }

    nextUrl = res.pagination?.links?.next ?? null;
  }

  return [...new Set(spanIds)];
}

export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string
): Promise<NormalizedSpan[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const spanIds = await searchSpanIds(filters, invokerTx);
  console.debug("[RHO search] spanIds =", spanIds);

  const allNormalized: NormalizedSpan[] = [];

  for (const spanId of spanIds) {
    const url = buildRhoTraceUrl({
      spanId,
      fromDate: from,
      toDate: to,
    });

    console.debug("[RHO trace] Request:", url);

    const trace = await apiRequest<RawSpan>(url, { headers });
    const normalized = normalizeSpans(trace);
    allNormalized.push(...normalized);
  }

  const dedup = new Map<string, NormalizedSpan>();
  for (const span of allNormalized) {
    dedup.set(span.spanId, span);
  }

  return [...dedup.values()];
}