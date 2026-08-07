import type {
  RawSpan,
  NormalizedSpan,
  SpansPaginatedResponse,
  ClassifiedTraces,
  MetricsFilters,
} from "@/types/bbva";
import { dateRangeToNano } from "./dateUtils";
import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "./httpClient";

const RHO_BASE = "https://rho.live-02.nextgen.igrupobbva";
const AWS_NETWORK_CONSTANT_MS = 89;
const RHO_SEARCH_TIMEOUT_MS = 45000;
const RHO_TRACE_TIMEOUT_MS = 90000;

const MAX_TRACE_IDS_PER_INVOKER = 24;
const TRACE_MATCH_MIN_TOLERANCE_MS = 250;
const TRACE_MATCH_TOLERANCE_RATIO = 0.20;
const TRACE_MATCH_MAX_FALLBACK_MS = 10000;
const TRACE_COMPLETENESS_TOLERANCE_MULTIPLIERS = [1, 2, 4, 8, 16];
const USE_ROOT_SPAN_LOOKUP = true;

const traceLimiter = createConcurrencyLimiter(2);

const traceCache = new Map<string, RawSpan>();
const rootSpanCache = new Map<string, string>();

export type TraceSpanMetadata = {
  channelCode?: string;
  aap?: string;
  typology?: string;
  site?: string;
  channels?: TraceChannelMetadata[];
};

type TraceEntry = {
  utilitytype: string;
  declaredUtilityType: string;
  invokerLibrary: string;
  name: string;
  invokedparam: string;
  databaseQuery: string;
  databaseInstance: string;
  collection: string;
  durationMs: number;
  channelCode: string;
  startOrder: number | null;
  sequence: number;
};

type SpanWithParent = RawSpan & {
  parentSpanId?: string;
  parentId?: string;
  parentSpan?: string;
};

export type TraceChannelMetadata = {
  channelCode?: string;
  aap?: string;
  typology?: string;
  site?: string;
};



type RhoSpanDetailResponse = RawSpan | Record<string, unknown>;

function getSelectedChannelCodes(filters: MetricsFilters): string[] {
  const codes = filters.channelCodes?.length
    ? filters.channelCodes
    : filters.channelCode
      ? [filters.channelCode]
      : [];

  return Array.from(
    new Set(
      codes
        .map((code) => String(code).trim())
        .filter((code) => code && code !== "all")
    )
  );
}

function extractMetadataFromSpan(
  span: RawSpan | null | undefined
): TraceChannelMetadata | null {
  const props = span?.properties ?? {};

  const channelCode =
    String(props["channel-code"] ?? "").trim() ||
    String(props.channelCode ?? "").trim();

  const aap = String(props.aap ?? "").trim();
  const typology = String(props.typology ?? "").trim();
  const site = String(props.site ?? "").trim();

  if (!channelCode && !aap && !typology && !site) {
    return null;
  }

  return {
    channelCode: channelCode || undefined,
    aap: aap || undefined,
    typology: typology || undefined,
    site: site || undefined,
  };
}

function dedupeTraceChannels(
  channels: TraceChannelMetadata[]
): TraceChannelMetadata[] {
  const seen = new Set<string>();
  const result: TraceChannelMetadata[] = [];

  for (const channel of channels) {
    const key = [
      channel.channelCode ?? "",
      channel.aap ?? "",
      channel.typology ?? "",
      channel.site ?? "",
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(channel);
  }

  return result;
}

function getCacheScope(filters: MetricsFilters, invokerTx: string): string {
  return [
    filters.site ?? "",
    getSelectedChannelCodes(filters).join(","),
    invokerTx,
  ].join("|");
}

function normalizeDuration(span: RawSpan): number {
  if (typeof span.duration === "number" && span.duration !== null) {
    const d = span.duration;

    if (d > 1_000_000) return d / 1_000_000;
    if (d > 1_000) return d / 1000;
    if (d < 1) return d * 1000;

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

function normalizeSpanStartOrder(span: RawSpan): number | null {
  const candidates: unknown[] = [
    span.startDate,
    span.startTime,
    span.recordDate,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }

    if (typeof candidate === "string" && candidate.trim()) {
      const trimmed = candidate.trim();
      const numeric = Number(trimmed);

      if (Number.isFinite(numeric)) {
        return numeric;
      }

      const parsed = Date.parse(trimmed);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function inferUtilityType(span: RawSpan): string {
  const utilityType = String(span.properties?.utilitytype ?? "").trim();

  if (utilityType) {
    return utilityType;
  }

  const source = [
    span.name,
    span.properties?.invokerLibrary,
    span.properties?.invokedparam,
    span.properties?.databaseQuery,
    span.properties?.databaseInstance,
    span.properties?.collection,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (source.includes("interbackendcics") || source.includes("cics")) {
    return "InterBackendCics";
  }

  if (
    source.includes("apiinternalconnectorimpl") ||
    source.includes("api internal connector") ||
    source.includes("api-connector") ||
    source.includes("api connector")
  ) {
    return "APIInternalConnectorImpl";
  }

  if (
    source.includes("apiexternalconnectorimpl") ||
    source.includes("api external connector") ||
    source.includes("external connector")
  ) {
    return "APIExternalConnectorImpl";
  }

  if (source.includes("jdbc")) {
    return "Jdbc";
  }

  if (source.includes("jpa")) {
    return "Jpa";
  }

  if (
    source.includes("daasmongoconnector") ||
    source.includes("mongo") ||
    source.includes("collection")
  ) {
    return "DaasMongoConnector";
  }

  if (source.includes("titanclient") || source.includes("titan client")) {
    return "TitanClient";
  }

  if (source.includes("grpcclient") || source.includes("grpc")) {
    return "GRPCClient";
  }

  return "UNKNOWN";
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
  raw: RawSpan | RawSpan[] | SpansPaginatedResponse | null | undefined
): NormalizedSpan[] {
  let allRaw: RawSpan[] = [];

  if (!raw) {
    return [];
  }

  if (Array.isArray(raw)) {
    allRaw = flattenSpans(raw);
  } else if ("data" in raw && Array.isArray(raw.data)) {
    allRaw = flattenSpans(raw.data);
  } else if (typeof raw === "object") {
    allRaw = flattenSpans([raw as RawSpan]);
  }

  const seen = new Set<string>();
  const normalized: NormalizedSpan[] = [];

  for (const span of allRaw) {
    const spanId = String(span.spanId ?? "").trim();

    if (!spanId || seen.has(spanId)) {
      continue;
    }

    seen.add(spanId);

    const properties = Object.fromEntries(
      Object.entries(span.properties ?? {}).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ])
    ) as Record<string, string>;

    const channelCode =
      String(properties["channel-code"] ?? "").trim() ||
      String(properties.channelCode ?? "").trim();

    normalized.push({
      spanId,
      traceId: String(span.traceId ?? ""),
      name: String(span.name ?? ""),
      durationMs: normalizeDuration(span),
      utilityType: inferUtilityType(span),
      channelCode,
      properties,
    } as NormalizedSpan);
  }

  return normalized;
}

export function classifySpans(spans: NormalizedSpan[]): ClassifiedTraces {
  const result: ClassifiedTraces = {
    InterBackendCics: [],
    APIInternalConnectorImpl: [],
    Jdbc: [],
    DaasMongoConnector: [],
    APIExternalConnectorImpl: [],
    TitanClient: [],
    GRPCClient: [],
    Jpa: [],
    other: [],
  };

  for (const span of spans) {
    const utilityType = String(span.utilityType ?? "").trim();

    if (utilityType === "InterBackendCics") {
      result.InterBackendCics.push(span);
    } else if (utilityType === "APIInternalConnectorImpl") {
      result.APIInternalConnectorImpl.push(span);
    } else if (utilityType === "Jdbc") {
      result.Jdbc.push(span);
    } else if (utilityType === "DaasMongoConnector") {
      result.DaasMongoConnector.push(span);
    } else if (utilityType === "APIExternalConnectorImpl") {
      result.APIExternalConnectorImpl.push(span);
    } else if (utilityType === "TitanClient") {
      result.TitanClient.push(span);
    } else if (utilityType === "GRPCClient") {
      result.GRPCClient.push(span);
    } else if (utilityType === "Jpa") {
      result.Jpa.push(span);
    } else {
      result.other.push(span);
    }
  }

  return result;
}

function buildRhoChannelCodeFilter(channelCodes: string[]): string | undefined {
  if (!channelCodes.length) return undefined;

  const clauses = channelCodes.map(
    (code) => `"properties.channel-code" == "${code}"`
  );

  if (clauses.length === 1) {
    return clauses[0];
  }

  return `(${clauses.join(" or ")})`;
}

function buildRhoSpanSearchUrl(params: {
  invokerTx?: string;
  traceId?: string;
  fromDate: string;
  toDate: string;
  site?: string;
  channelCodes?: string[];
  durationMs?: number;
  invokerLibraryHint?: string;
  invokerLibraryHints?: string[];
  includeDuration?: boolean;
}): string {
  const {
    invokerTx,
    traceId,
    fromDate,
    toDate,
    site,
    channelCodes = [],
    durationMs,
    invokerLibraryHint,
    invokerLibraryHints = [],
    includeDuration = true,
  } = params;

  const cleanHints = Array.from(
    new Set(
      [...invokerLibraryHints, invokerLibraryHint]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );

  const filters: string[] = [];

  if (cleanHints.length > 0) {
    const nameClauses = cleanHints.map(
      (library) => `name == "*${library}*"`
    );

    filters.push(
      nameClauses.length === 1
        ? nameClauses[0]
        : `(${nameClauses.join(" or ")})`
    );
  } else {
    filters.push(`name == "**"`);
  }

  if (invokerTx?.trim()) {
    filters.push(`properties.invokerTx == "${invokerTx.trim()}"`);
  }

  if (traceId?.trim()) {
    filters.push(`traceId == "${traceId.trim()}"`);
  }

  if (site?.trim()) {
    filters.push(`properties.site == "${site.trim()}"`);
  }

  const channelFilter = buildRhoChannelCodeFilter(channelCodes);

  if (channelFilter) {
    filters.push(channelFilter);
  }

  if (
    includeDuration &&
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    filters.push(`duration == "${Math.round(durationMs)}"`);
  }

  const q = filters.join(" and ");

  const url = new URL("/v1/ns/apx.online/spans", RHO_BASE);

  url.searchParams.set("q", q);
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set(
    "properties",
    [
      "channel-code",
      "channelCode",
      "environ-code",
      "env",
      "product-code",
      "returncode",
      "utilitytype",
      "invokerTx",
      "invokerLibrary",
      "invokedparam",
      "databaseInstance",
      "collection",
      "databaseQuery",
      "site",
      "aap",
      "typology",
    ].join(",")
  );
  url.searchParams.set("profile", "default");

  return url.toString();
}

function buildRhoTraceUrl(params: {
  spanId: string;
  fromDate: string;
  toDate: string;
}): string {
  const { spanId, fromDate, toDate } = params;

  const url = new URL(
    `/v1/ns/apx.online/mrs/RhoTraces/spans/${spanId}:trace`,
    RHO_BASE
  );

  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set("profile", "default");
  url.searchParams.set("crossRegion", "false");

  return url.toString();
}

function buildRhoSpanDetailUrl(params: {
  spanId: string;
  fromDate: string;
  toDate: string;
}): string {
  const { spanId, fromDate, toDate } = params;

  const url = new URL(
    `/v1/ns/apx.online/mrs/RhoTraces/spans/${spanId}`,
    RHO_BASE
  );

  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);

  return url.toString();
}

function isRawSpan(value: unknown): value is RawSpan {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RawSpan>;

  return Boolean(
    candidate.properties ||
    candidate.spanId ||
    candidate.traceId ||
    candidate.name
  );
}

function unwrapRhoSpanDetail(response: RhoSpanDetailResponse): RawSpan | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  if (isRawSpan(response)) {
    return response;
  }

  const wrapper = response as {
    data?: unknown;
    span?: unknown;
    item?: unknown;
  };

  if (isRawSpan(wrapper.data)) {
    return wrapper.data;
  }

  if (isRawSpan(wrapper.span)) {
    return wrapper.span;
  }

  if (isRawSpan(wrapper.item)) {
    return wrapper.item;
  }

  return null;
}

function collectChannelMetadataFromTrace(
  node: RawSpan | RawSpan[] | null | undefined,
  out: TraceChannelMetadata[]
): void {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((item) => collectChannelMetadataFromTrace(item, out));
    return;
  }

  const metadata = extractMetadataFromSpan(node);

  if (metadata) {
    out.push(metadata);
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) =>
      collectChannelMetadataFromTrace(child, out)
    );
  }
}

function extractSpanMetadata(
  span: RawSpan | null | undefined
): TraceSpanMetadata {
  const props = span?.properties ?? {};

  const channelCode =
    String(props["channel-code"] ?? "").trim() ||
    String(props.channelCode ?? "").trim();

  const aap = String(props.aap ?? "").trim();
  const typology = String(props.typology ?? "").trim();
  const site = String(props.site ?? "").trim();

  return {
    channelCode: channelCode || undefined,
    aap: aap || undefined,
    typology: typology || undefined,
    site: site || undefined,
  };
}

export async function fetchTraceChannelsForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string,
  invokerLibraryHints?: string[]
): Promise<TraceChannelMetadata[]> {
  const libraryTraces = await fetchTracesByLibraries({
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint,
    invokerLibraryHints,
  });

  const channels: TraceChannelMetadata[] = [];

  if (libraryTraces.length > 0) {
    for (const trace of libraryTraces) {
      collectChannelMetadataFromTrace(trace, channels);
    }

    return dedupeTraceChannels(channels);
  }

  const hintSpan = await searchBestSpan(
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint
  );

  if (!hintSpan?.spanId) {
    return [];
  }

  const trace = await fetchFullTraceByHintSpan({
    filters,
    invokerTx,
    hintSpan,
  });

  if (!trace) {
    return [];
  }

  collectChannelMetadataFromTrace(trace, channels);

  return dedupeTraceChannels(channels);
}

export async function fetchTraceSpanMetadata(
  filters: MetricsFilters,
  spanId: string
): Promise<TraceSpanMetadata> {
  if (!spanId?.trim()) {
    return {};
  }

  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

  const url = buildRhoSpanDetailUrl({
    spanId: spanId.trim(),
    fromDate: from,
    toDate: to,
  });

  console.log("[RHO span detail metadata URL]", {
    spanId,
    url,
  });

  const response = await apiRequest<RhoSpanDetailResponse>(url, {
    headers: buildAuthHeaders(filters.bearerToken),
    timeoutMs: RHO_SEARCH_TIMEOUT_MS,
  });

  const span = unwrapRhoSpanDetail(response);
  const metadata = extractSpanMetadata(span);

  console.log("[RHO span detail metadata]", {
    spanId,
    span,
    metadata,
  });

  return metadata;
}

function sortSpansByDurationTarget(
  spans: RawSpan[],
  targetDuration?: number
): RawSpan[] {
  return [...spans].sort((a, b) => {
    if (targetDuration === undefined) {
      return normalizeDuration(b) - normalizeDuration(a);
    }

    const diffA = Math.abs(normalizeDuration(a) - targetDuration);
    const diffB = Math.abs(normalizeDuration(b) - targetDuration);

    if (diffA !== diffB) return diffA - diffB;

    return normalizeDuration(b) - normalizeDuration(a);
  });
}

function validSearchSpans(items: RawSpan[]): RawSpan[] {
  return items.filter(
    (span) =>
      typeof span.spanId === "string" &&
      span.spanId.trim().length > 0 &&
      typeof span.traceId === "string" &&
      span.traceId.trim().length > 0
  );
}

function shouldUseStrictChannel(filters: MetricsFilters): boolean {
  return getSelectedChannelCodes(filters).length > 0;
}

async function searchBestSpan(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string
): Promise<RawSpan | null> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);
  const channelCodes = getSelectedChannelCodes(filters);

  const targetDuration =
    typeof responseTimeMs === "number" &&
      Number.isFinite(responseTimeMs) &&
      responseTimeMs > 0
      ? Math.round(responseTimeMs)
      : undefined;

  const search = async (params: {
    useLibraryHint: boolean;
    useSiteFilter: boolean;
    useChannelFilter: boolean;
    useDurationFilter: boolean;
    durationTargetMs?: number;
  }): Promise<RawSpan | null> => {
    const url = buildRhoSpanSearchUrl({
      invokerTx,
      fromDate: from,
      toDate: to,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      durationMs:
        params.useDurationFilter && params.durationTargetMs !== undefined
          ? params.durationTargetMs
          : undefined,
      invokerLibraryHint: params.useLibraryHint
        ? invokerLibraryHint
        : undefined,
      includeDuration: params.useDurationFilter,
    });

    console.log("[RHO span search URL]", {
      invokerTx,
      site: params.useSiteFilter ? filters.site : undefined,
      invokerLibraryHint: params.useLibraryHint
        ? invokerLibraryHint
        : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      targetDuration: params.durationTargetMs ?? targetDuration,
      useDurationFilter: params.useDurationFilter,
      url,
    });

    const res = await apiRequest<SpansPaginatedResponse>(url, {
      headers,
      timeoutMs: RHO_SEARCH_TIMEOUT_MS,
    });
    const items = Array.isArray(res.data) ? res.data : [];

    const best = sortSpansByDurationTarget(
      validSearchSpans(items),
      params.durationTargetMs ?? targetDuration
    )[0];

    if (best) {
      console.log("[RHO selected span]", {
        invokerTx,
        invokerLibraryHint,
        selectedSpanId: best.spanId,
        selectedTraceId: best.traceId,
        selectedDuration: normalizeDuration(best),
        targetDuration: params.durationTargetMs ?? targetDuration,
      });
    }

    return best ?? null;
  };

  const attempts = [
    {
      useLibraryHint: Boolean(invokerLibraryHint),
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: Boolean(invokerLibraryHint),
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: false,
    },
    {
      useLibraryHint: Boolean(invokerLibraryHint),
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: false,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: Boolean(invokerLibraryHint),
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: false,
      useDurationFilter: false,
    },
    {
      useLibraryHint: false,
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: false,
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: false,
    },
    {
      useLibraryHint: false,
      useSiteFilter: false,
      useChannelFilter: false,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: false,
      useSiteFilter: false,
      useChannelFilter: false,
      useDurationFilter: false,
    },
  ];

const strictChannel = shouldUseStrictChannel(filters);

const filteredAttempts = strictChannel
  ? attempts.filter((attempt) => attempt.useChannelFilter)
  : attempts;

const expandedTargets = getExpandedResponseTimeTargets(targetDuration);

for (const attempt of filteredAttempts) {
  if (attempt.useDurationFilter && expandedTargets.length > 0) {
    for (const durationTargetMs of expandedTargets) {
      const span = await search({ ...attempt, durationTargetMs });
      if (span) return span;
    }
    continue;
  }

  const span = await search(attempt);
  if (span) return span;
}

return null;
}

async function searchSpansByLibraries(
  filters: MetricsFilters,
  invokerTx: string,
  invokerLibraryHints: string[],
  responseTimeMs?: number
): Promise<RawSpan[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);
  const channelCodes = getSelectedChannelCodes(filters);

  const cleanHints = Array.from(
    new Set(
      invokerLibraryHints
        .map((item) => String(item).trim())
        .filter(Boolean)
    )
  );

  if (!cleanHints.length) return [];

  const targetDuration =
    typeof responseTimeMs === "number" &&
    Number.isFinite(responseTimeMs) &&
    responseTimeMs > 0
      ? Math.round(responseTimeMs)
      : undefined;

  const collected = new Map<string, RawSpan>();

  const appendItems = (items: RawSpan[]) => {
    for (const span of validSearchSpans(items)) {
      const key = String(span.traceId ?? span.spanId ?? "").trim();
      if (key && !collected.has(key)) collected.set(key, span);
    }
  };

  const search = async (params: {
    useSiteFilter: boolean;
    useChannelFilter: boolean;
    durationTargetMs?: number;
  }): Promise<void> => {
    const useDurationFilter = params.durationTargetMs !== undefined;
    const url = buildRhoSpanSearchUrl({
      invokerTx,
      fromDate: from,
      toDate: to,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      durationMs: params.durationTargetMs,
      invokerLibraryHints: cleanHints,
      includeDuration: useDurationFilter,
    });

    try {
      const res = await apiRequest<SpansPaginatedResponse>(url, {
        headers,
        timeoutMs: RHO_SEARCH_TIMEOUT_MS,
      });
      appendItems(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.warn("[RHO] Falló un intento de búsqueda de candidatos", {
        invokerTx,
        durationTargetMs: params.durationTargetMs,
        useSiteFilter: params.useSiteFilter,
        useChannelFilter: params.useChannelFilter,
        error,
      });
    }
  };

  const expandedTargets = getExpandedResponseTimeTargets(targetDuration);
  const strictChannel = shouldUseStrictChannel(filters);
  const scopes = strictChannel
    ? [
        { useSiteFilter: Boolean(filters.site), useChannelFilter: true },
        { useSiteFilter: false, useChannelFilter: true },
        { useSiteFilter: Boolean(filters.site), useChannelFilter: false },
        { useSiteFilter: false, useChannelFilter: false },
      ]
    : [
        { useSiteFilter: Boolean(filters.site), useChannelFilter: false },
        { useSiteFilter: false, useChannelFilter: false },
      ];

  // Reunimos candidatos de varios rangos. No regresamos en el primer resultado,
  // porque ese span puede pertenecer a una traza pequeña o incompleta.
  for (const scope of scopes) {
    for (const durationTargetMs of expandedTargets) {
      await search({ ...scope, durationTargetMs });
      if (collected.size >= MAX_TRACE_IDS_PER_INVOKER) break;
    }

    // La consulta sin duración permite recuperar trazas completas aunque la
    // medición de invokerTX y la duración almacenada tengan desfase.
    await search(scope);

    if (collected.size >= MAX_TRACE_IDS_PER_INVOKER) break;
  }

  return sortSpansByDurationTarget(
    Array.from(collected.values()),
    targetDuration
  ).slice(0, MAX_TRACE_IDS_PER_INVOKER);
}

function getSpanProperty(span: RawSpan | null | undefined, key: string): string {
  return String(span?.properties?.[key] ?? "").trim();
}

function isTransactionSpan(span: RawSpan, invokerTx: string): boolean {
  const type = getSpanProperty(span, "type");
  const name = String(span.name ?? "").trim();
  const spanInvokerTx = getSpanProperty(span, "invokerTx");

  return (
    type === "Transaction" ||
    name === invokerTx ||
    spanInvokerTx === invokerTx
  );
}

function hasChannelMetadata(span: RawSpan): boolean {
  const props = span.properties ?? {};

  return Boolean(
    String(props["channel-code"] ?? "").trim() ||
    String(props.channelCode ?? "").trim() ||
    String(props.aap ?? "").trim()
  );
}

function isLikelyRootSpan(span: SpanWithParent): boolean {
  const parentSpanId = String(span.parentSpanId ?? span.parentId ?? "").trim();
  const parentSpan = String(span.parentSpan ?? "").trim();

  if (!parentSpanId && !parentSpan) {
    return true;
  }


  if (parentSpan.includes("/spans/")) {
    return false;
  }

  return !parentSpanId;
}

async function searchTransactionSpanIdByTraceId(params: {
  filters: MetricsFilters;
  traceId: string;
  invokerTx: string;
  fallbackSpanId: string;
}): Promise<string> {
  const { filters, traceId, invokerTx, fallbackSpanId } = params;

  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const url = buildRhoSpanSearchUrl({
    traceId,
    invokerTx,
    fromDate: from,
    toDate: to,
    site: filters.site,
    includeDuration: false,
  });

  /**
   * IMPORTANTE:
   * buildRhoSpanSearchUrl usa name == "**" por default.
   * Para encontrar el transaction span, forzamos name == "{invokerTx}".
   */
  const rawUrl = new URL(url);
  const q = [
    `name == "${invokerTx}"`,
    `traceId == "${traceId}"`,
    filters.site ? `properties.site == "${filters.site}"` : undefined,
    `properties.invokerTx == "${invokerTx}"`,
  ]
    .filter(Boolean)
    .join(" and ");

  rawUrl.searchParams.set("q", q);

  console.log("[RHO transaction span search URL]", {
    invokerTx,
    traceId,
    url: rawUrl.toString(),
  });

  try {
    const res = await apiRequest<SpansPaginatedResponse>(rawUrl.toString(), {
      headers,
      timeoutMs: RHO_SEARCH_TIMEOUT_MS,
    });

    const items = Array.isArray(res.data) ? res.data : [];

    const transaction =
      items.find((span) => {
        const type = String(span.properties?.type ?? "").trim();
        const name = String(span.name ?? "").trim();
        const channelCode =
          String(span.properties?.["channel-code"] ?? "").trim() ||
          String(span.properties?.channelCode ?? "").trim();

        return (
          type === "Transaction" ||
          name === invokerTx ||
          Boolean(channelCode)
        );
      }) ?? items[0];

    const spanId = String(transaction?.spanId ?? "").trim();

    console.log("[RHO selected transaction span]", {
      invokerTx,
      traceId,
      spanId,
      name: transaction?.name,
      type: transaction?.properties?.type,
      channelCode:
        transaction?.properties?.["channel-code"] ??
        transaction?.properties?.channelCode,
      aap: transaction?.properties?.aap,
      typology: transaction?.properties?.typology,
      fallbackSpanId,
    });

    return spanId || fallbackSpanId;
  } catch (error) {
    console.warn("[RHO] Error buscando transaction span", {
      invokerTx,
      traceId,
      fallbackSpanId,
      error,
    });

    return fallbackSpanId;
  }
}

async function searchRootSpanIdByTraceId(params: {
  filters: MetricsFilters;
  traceId: string;
  invokerTx: string;
  fallbackSpanId: string;
}): Promise<string> {
  const { filters, traceId, invokerTx, fallbackSpanId } = params;
  const channelCodes = getSelectedChannelCodes(filters);

  const cacheKey = [
    getCacheScope(filters, invokerTx),
    traceId,
    fallbackSpanId,
  ].join("|");

  const cachedRoot = rootSpanCache.get(cacheKey);

  if (cachedRoot) {
    return cachedRoot;
  }

  if (!USE_ROOT_SPAN_LOOKUP) {
    rootSpanCache.set(cacheKey, fallbackSpanId);
    return fallbackSpanId;
  }

  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const search = async (params: {
    useSiteFilter: boolean;
    useChannelFilter: boolean;
    useInvokerTxFilter: boolean;
  }): Promise<string | null> => {
    const url = buildRhoSpanSearchUrl({
      traceId,
      invokerTx: params.useInvokerTxFilter ? invokerTx : undefined,
      fromDate: from,
      toDate: to,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      includeDuration: false,
    });

    console.log("[RHO root span search URL]", {
      invokerTx: params.useInvokerTxFilter ? invokerTx : undefined,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      traceId,
      fallbackSpanId,
      url,
    });

    const res = await apiRequest<SpansPaginatedResponse>(url, {
      headers,
      timeoutMs: RHO_SEARCH_TIMEOUT_MS,
    });
    const items = Array.isArray(res.data) ? (res.data as SpanWithParent[]) : [];

    if (!items.length) {
      return null;
    }

    const transactionWithChannel = items.find((span) => {
      return isTransactionSpan(span, invokerTx) && hasChannelMetadata(span);
    });

    const transactionSpan = items.find((span) => {
      return isTransactionSpan(span, invokerTx);
    });

    const rootLikeSpan = items.find((span) => {
      return isLikelyRootSpan(span);
    });

    const spanWithChannel = items.find((span) => {
      return hasChannelMetadata(span);
    });

    // Para descargar la traza completa debemos usar el root global real.
    // El span Transaction de invokerTX puede ser un hijo y devolver solo un subárbol.
    const root =
      rootLikeSpan ??
      transactionWithChannel ??
      transactionSpan ??
      spanWithChannel ??
      items.sort((a, b) => normalizeDuration(b) - normalizeDuration(a))[0];

    const rootSpanId = String(root?.spanId ?? "").trim();

    console.log("[RHO selected root span]", {
      invokerTx,
      traceId,
      rootSpanId,
      rootName: root?.name,
      rootType: root?.properties?.type,
      rootChannelCode:
        root?.properties?.["channel-code"] ?? root?.properties?.channelCode,
      rootAap: root?.properties?.aap,
      rootTypology: root?.properties?.typology,
      fallbackSpanId,
    });

    console.log("[RHO selected root span]", {
      traceId,
      rootSpanId,
      rootDuration: root ? normalizeDuration(root) : undefined,
      fallbackSpanId,
    });

    return rootSpanId || null;
  };

  const attempts = [
    // Primero buscamos todos los spans del traceId, sin limitar al invokerTX,
    // para poder localizar el root global y descargar el árbol completo.
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: false,
      useInvokerTxFilter: false,
    },
    {
      useSiteFilter: false,
      useChannelFilter: false,
      useInvokerTxFilter: false,
    },
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useInvokerTxFilter: true,
    },
    {
      useSiteFilter: false,
      useChannelFilter: false,
      useInvokerTxFilter: true,
    },
  ];

  for (const attempt of attempts) {
    try {
      const rootSpanId = await search(attempt);

      if (rootSpanId) {
        rootSpanCache.set(cacheKey, rootSpanId);
        return rootSpanId;
      }
    } catch (error) {
      console.warn("[RHO] Error buscando root span, reintentando", {
        traceId,
        invokerTx,
        attempt,
        error,
      });
    }
  }

  rootSpanCache.set(cacheKey, fallbackSpanId);
  return fallbackSpanId;
}

async function fetchFullTraceByHintSpan(params: {
  filters: MetricsFilters;
  invokerTx: string;
  hintSpan: RawSpan;
}): Promise<RawSpan | null> {
  const { filters, invokerTx, hintSpan } = params;

  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const traceId = String(hintSpan.traceId ?? "").trim();
  const hintSpanId = String(hintSpan.spanId ?? "").trim();

  if (!hintSpanId) return null;

  const traceCacheKey = [
    getCacheScope(filters, invokerTx),
    traceId || hintSpanId,
  ].join("|");

  const cachedTrace = traceCache.get(traceCacheKey);

  if (cachedTrace) {
    return cachedTrace;
  }

  const rootSpanId = traceId
    ? await searchRootSpanIdByTraceId({
      filters,
      traceId,
      invokerTx,
      fallbackSpanId: hintSpanId,
    })
    : hintSpanId;

  const url = buildRhoTraceUrl({
    spanId: rootSpanId,
    fromDate: from,
    toDate: to,
  });

  console.log("[RHO full trace by library span URL]", {
    invokerTx,
    site: filters.site,
    channelCodes: getSelectedChannelCodes(filters),
    traceId,
    hintSpanId,
    rootSpanId,
    url,
  });

  const trace = await apiRequest<RawSpan>(url, {
    headers,
    timeoutMs: RHO_TRACE_TIMEOUT_MS,
  });

  traceCache.set(traceCacheKey, trace);

  return trace;
}


function getSpanParentId(span: RawSpan): string {
  const candidate = span as SpanWithParent;
  return String(
    candidate.parentSpanId ?? candidate.parentId ?? candidate.parentSpan ?? ""
  ).trim();
}

function spanMatchesInvokerTx(span: RawSpan, invokerTx: string): boolean {
  const expected = invokerTx.trim().toLowerCase();
  if (!expected) return false;

  const props = span.properties ?? {};
  const values = [
    span.name,
    props.invokerTx,
    props.invokertx,
    props.transaction,
    props.transactionName,
    props.operation,
    props.invokerLibrary,
  ];

  return values.some((value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === expected || normalized.includes(expected);
  });
}

/**
 * Encuentra dentro de la traza completa el span transaccional que representa
 * a invokerTX. La duración a comparar es la de este span ancla, no la del root
 * global de la traza ni la suma de utilities hijas.
 */
function getTraceDurationMs(trace: RawSpan, invokerTx: string): number {
  const spans = flattenSpans([trace]);
  if (!spans.length) return 0;

  const matching = spans.filter((span) => spanMatchesInvokerTx(span, invokerTx));
  const transactionMatching = matching.filter((span) =>
    isTransactionSpan(span, invokerTx)
  );
  const candidates = transactionMatching.length ? transactionMatching : matching;

  if (!candidates.length) return 0;

  // Cuando hay varios spans del mismo invokerTX, el de mayor duración suele ser
  // el contenedor transaccional y no una utility hija.
  return candidates.reduce(
    (maxDuration, span) => Math.max(maxDuration, normalizeDuration(span)),
    0
  );
}

function getTraceMatchToleranceMs(responseTimeMs: number): number {
  return Math.max(
    TRACE_MATCH_MIN_TOLERANCE_MS,
    Math.round(responseTimeMs * TRACE_MATCH_TOLERANCE_RATIO)
  );
}

/**
 * RHO compara duration por igualdad exacta. Para no perder trazas por pequeñas
 * diferencias entre invokerTX y el span almacenado, probamos duraciones cada vez
 * mayores y finalmente hacemos una búsqueda sin filtro de duración.
 */
function getExpandedResponseTimeTargets(responseTimeMs?: number): number[] {
  const target = Number(responseTimeMs);
  if (!Number.isFinite(target) || target <= 0) return [];

  const base = Math.max(1, Math.round(target));
  const candidates = [
    base,
    base + 25,
    base + 50,
    base + 100,
    base + 250,
    base + 500,
    base + 1000,
    base + 2000,
    Math.round(base * 1.5),
    Math.round(base * 2),
    Math.round(base * 3),
    Math.round(base * 5),
    Math.round(base * 10),
  ];

  return Array.from(new Set(candidates.filter((value) => value > 0))).sort(
    (a, b) => a - b
  );
}

function getTraceCompleteness(trace: RawSpan): {
  spanCount: number;
  utilityCount: number;
  positiveDurationCount: number;
} {
  const spans = flattenSpans([trace]);
  const entries: TraceEntry[] = [];
  collectTraceEntries(trace, entries);
  const uniqueEntries = dedupeTraceEntries(entries);

  return {
    spanCount: spans.length,
    utilityCount: uniqueEntries.length,
    positiveDurationCount: uniqueEntries.filter(
      (entry) => Number(entry.durationMs) > 0
    ).length,
  };
}

function selectConcordantTrace(
  traces: RawSpan[],
  invokerTx: string,
  responseTimeMs?: number
): RawSpan | null {
  if (!traces.length) return null;

  const target = Number(responseTimeMs);
  const ranked = traces
    .map((trace) => {
      const traceDurationMs = getTraceDurationMs(trace, invokerTx);
      const completeness = getTraceCompleteness(trace);
      return {
        trace,
        traceDurationMs,
        differenceMs:
          Number.isFinite(target) && target > 0 && traceDurationMs > 0
            ? Math.abs(traceDurationMs - target)
            : Number.POSITIVE_INFINITY,
        ...completeness,
      };
    })
    .filter((candidate) => candidate.spanCount > 0);

  if (!ranked.length) return null;

  const compareCompleteness = (
    a: (typeof ranked)[number],
    b: (typeof ranked)[number]
  ) => {
    if (a.utilityCount !== b.utilityCount) {
      return b.utilityCount - a.utilityCount;
    }
    if (a.spanCount !== b.spanCount) {
      return b.spanCount - a.spanCount;
    }
    if (a.positiveDurationCount !== b.positiveDurationCount) {
      return b.positiveDurationCount - a.positiveDurationCount;
    }
    return a.differenceMs - b.differenceMs;
  };

  if (!Number.isFinite(target) || target <= 0) {
    return [...ranked].sort(compareCompleteness)[0].trace;
  }

  const baseTolerance = getTraceMatchToleranceMs(target);

  // Ampliamos el tiempo de respuesta por niveles. En el primer nivel que tenga
  // candidatos, elegimos la traza más completa, no simplemente la más cercana.
  for (const multiplier of TRACE_COMPLETENESS_TOLERANCE_MULTIPLIERS) {
    const toleranceMs = Math.min(
      TRACE_MATCH_MAX_FALLBACK_MS,
      Math.max(baseTolerance, Math.round(baseTolerance * multiplier))
    );
    const candidates = ranked.filter(
      (candidate) =>
        candidate.traceDurationMs > 0 &&
        candidate.differenceMs <= toleranceMs
    );

    if (candidates.length > 0) {
      const selected = [...candidates].sort(compareCompleteness)[0];
      console.log("[RHO selected complete trace]", {
        invokerTx,
        responseTimeMs: target,
        toleranceMs,
        traceId: String(selected.trace.traceId ?? ""),
        invokerSpanDurationMs: selected.traceDurationMs,
        differenceMs: selected.differenceMs,
        utilityCount: selected.utilityCount,
        spanCount: selected.spanCount,
      });
      return selected.trace;
    }
  }

  // Último recurso: elegimos la traza más completa de las recuperadas. Así no
  // se pierde el detalle por imponer una concordancia temporal imposible.
  const fallback = [...ranked].sort(compareCompleteness)[0];
  console.warn("[RHO] Se amplió la tolerancia para conservar la traza más completa", {
    invokerTx,
    responseTimeMs: target,
    traceId: String(fallback.trace.traceId ?? ""),
    invokerSpanDurationMs: fallback.traceDurationMs,
    differenceMs: fallback.differenceMs,
    utilityCount: fallback.utilityCount,
    spanCount: fallback.spanCount,
  });

  return fallback.trace;
}

function getLimitedUniqueHintSpans(spans: RawSpan[]): RawSpan[] {
  const uniqueHintSpans: RawSpan[] = [];
  const seenTraceIds = new Set<string>();

  for (const span of spans) {
    const traceId = String(span.traceId ?? "").trim();
    const spanId = String(span.spanId ?? "").trim();
    const traceKey = traceId || spanId;

    if (!traceKey || seenTraceIds.has(traceKey)) {
      continue;
    }

    seenTraceIds.add(traceKey);
    uniqueHintSpans.push(span);

    if (uniqueHintSpans.length >= MAX_TRACE_IDS_PER_INVOKER) {
      break;
    }
  }

  return uniqueHintSpans;
}

export async function fetchMetadataForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string,
  invokerLibraryHints?: string[]
): Promise<TraceSpanMetadata> {
  const cleanHints = Array.from(
    new Set(
      [...(invokerLibraryHints ?? []), invokerLibraryHint]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );

  let hintSpan: RawSpan | null = null;

  if (cleanHints.length > 0) {
    const spans = await searchSpansByLibraries(
      filters,
      invokerTx,
      cleanHints,
      responseTimeMs
    );

    hintSpan = getLimitedUniqueHintSpans(spans)[0] ?? null;
  }

  if (!hintSpan) {
    hintSpan = await searchBestSpan(
      filters,
      invokerTx,
      responseTimeMs,
      invokerLibraryHint
    );
  }

  const hintSpanId = String(hintSpan?.spanId ?? "").trim();
  const traceId = String(hintSpan?.traceId ?? "").trim();

  if (!hintSpanId) {
    console.warn("[RHO metadata] No se encontró spanId", {
      invokerTx,
      responseTimeMs,
      invokerLibraryHint,
      invokerLibraryHints: cleanHints,
    });

    return {};
  }

  const rootSpanId = traceId
    ? await searchRootSpanIdByTraceId({
      filters,
      traceId,
      invokerTx,
      fallbackSpanId: hintSpanId,
    })
    : hintSpanId;

  let rootMetadata = await fetchTraceSpanMetadata(filters, rootSpanId);

  /**
   * Si el root encontrado no trae channel-code, probablemente seguimos en un span hijo
   * tipo JDBC/Library. Entonces buscamos explícitamente el span Transaction.
   */
  if (traceId && !rootMetadata.channelCode) {
    const transactionSpanId = await searchTransactionSpanIdByTraceId({
      filters,
      traceId,
      invokerTx,
      fallbackSpanId: rootSpanId,
    });

    const transactionMetadata = await fetchTraceSpanMetadata(
      filters,
      transactionSpanId
    );

    rootMetadata = {
      ...rootMetadata,
      ...transactionMetadata,
      channelCode: transactionMetadata.channelCode || rootMetadata.channelCode,
      aap: transactionMetadata.aap || rootMetadata.aap,
      typology: transactionMetadata.typology || rootMetadata.typology,
      site: transactionMetadata.site || rootMetadata.site,
    };
  }

  if (
    rootMetadata.channelCode ||
    rootMetadata.aap ||
    rootMetadata.typology ||
    rootMetadata.site
  ) {
    return rootMetadata;
  }

  return fetchTraceSpanMetadata(filters, hintSpanId);
}

function getSqlMethod(databaseQuery: string): string {
  const q = databaseQuery.trim();

  if (!q) return "";

  const first = q.split(/\s+/)[0].toUpperCase();

  return ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(first)
    ? first
    : "DESCONOCIDO";
}

function sortTraceEntriesByExecutionOrder(entries: TraceEntry[]): TraceEntry[] {
  return [...entries].sort((a, b) => {
    const aHasTime = Number.isFinite(a.startOrder);
    const bHasTime = Number.isFinite(b.startOrder);

    if (aHasTime && bHasTime && a.startOrder !== b.startOrder) {
      return (a.startOrder ?? 0) - (b.startOrder ?? 0);
    }

    if (aHasTime !== bHasTime) {
      return aHasTime ? -1 : 1;
    }

    return a.sequence - b.sequence;
  });
}

function isGrpcEntry(entry: TraceEntry): boolean {
  const fingerprint = [
    entry.utilitytype,
    entry.invokerLibrary,
    entry.invokedparam,
    entry.name,
  ]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .join(" ");

  return fingerprint.includes("GRPC");
}

function isJdbcEntry(entry: TraceEntry): boolean {
  return String(entry.utilitytype ?? "").trim().toLowerCase() === "jdbc";
}

const JDBC_WRITE_METHODS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

/**
 * Las escrituras JDBC habilitan que los SELECT posteriores del mismo flujo
 * sean clasificados como salto.
 */
const JDBC_SELECT_AFTER_WRITE_METHODS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
]);

const AWS_UTILITY_JUMP_TYPES = new Set([
  "InterBackendCics",
  "APIInternalConnectorImpl",
  "APIExternalConnectorImpl",
  "Jpa",
  "DaasMongoConnector",
  "TitanClient",
]);

function isAwsUtilityJumpEntry(entry: TraceEntry): boolean {
  if (isGrpcEntry(entry) || isJdbcEntry(entry)) {
    return false;
  }

  const inferredType = String(entry.utilitytype ?? "").trim();
  return AWS_UTILITY_JUMP_TYPES.has(inferredType);
}

function getJdbcSqlMethod(entry: TraceEntry): string {
  const candidates = [entry.databaseQuery, entry.invokedparam, entry.name];

  for (const candidate of candidates) {
    const method = getSqlMethod(String(candidate ?? ""));

    if (method && method !== "DESCONOCIDO") {
      return method;
    }
  }

  return getSqlMethod(String(entry.databaseQuery ?? "")) || "DESCONOCIDO";
}

function getTraceEntryJumpFlags(entries: TraceEntry[]): boolean[] {
  return entries.map((entry) => {
    if (isGrpcEntry(entry)) {
      return false;
    }

    if (!isJdbcEntry(entry)) {
      return isAwsUtilityJumpEntry(entry);
    }

    // JDBC SELECT es una consulta, no un salto. Solo las escrituras JDBC
    // se contabilizan como salto para el cálculo esperado en AWS.
    return JDBC_WRITE_METHODS.has(getJdbcSqlMethod(entry));
  });
}

function getMongoOperation(item: TraceEntry): string {
  const source = `${item.invokedparam} ${item.name}`.toUpperCase();

  if (source.includes("FIND")) return "FIND";
  if (source.includes("INSERT")) return "INSERT";
  if (source.includes("UPDATE_MANY")) return "UPDATE_MANY";
  if (source.includes("UPDATE_ONE")) return "UPDATE_ONE";
  if (source.includes("UPDATE")) return "UPDATE";
  if (source.includes("DELETE")) return "DELETE";
  if (source.includes("AGGREGATE")) return "AGGREGATE";

  return item.invokedparam || item.name || "OPERACION";
}

function formatTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";

  const totalMs = Math.round(ms);
  const seconds = Math.floor(totalMs / 1000);
  const restMs = totalMs % 1000;

  if (seconds === 0) {
    return `${restMs}ms`;
  }

  if (restMs === 0) {
    return `${seconds}s`;
  }

  return `${seconds}s ${restMs}ms`;
}

function collectTraceEntries(
  node: RawSpan | RawSpan[] | null | undefined,
  out: TraceEntry[]
): void {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((item) => collectTraceEntries(item, out));
    return;
  }

  const properties = node.properties ?? {};
  const utilitytype = inferUtilityType(node);
  const declaredUtilityType = String(properties.utilitytype ?? "").trim();

  const invokerLibrary = String(properties.invokerLibrary ?? "").trim();
  const invokedparam = String(properties.invokedparam ?? "").trim();
  const databaseQuery = String(properties.databaseQuery ?? "").trim();
  const databaseInstance = String(properties.databaseInstance ?? "").trim();
  const collection = String(properties.collection ?? "").trim();
  const name = String(node.name ?? "").trim();

  const channelCode =
    String(properties["channel-code"] ?? "").trim() ||
    String(properties.channelCode ?? "").trim();

  const durationMs = normalizeDuration(node);

  if (
    utilitytype !== "UNKNOWN" ||
    invokerLibrary ||
    invokedparam ||
    databaseQuery ||
    databaseInstance ||
    collection
  ) {
    out.push({
      utilitytype,
      declaredUtilityType,
      invokerLibrary,
      name,
      invokedparam,
      databaseQuery,
      databaseInstance,
      collection,
      durationMs,
      channelCode,
      startOrder: normalizeSpanStartOrder(node),
      sequence: out.length,
    });
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => collectTraceEntries(child, out));
  }
}

function filterEntriesByChannel(
  entries: TraceEntry[],
  channelCodes: string[]
): TraceEntry[] {
  if (!channelCodes.length) {
    return entries;
  }

  const selected = new Set(channelCodes);

  const exactMatches = entries.filter((entry) =>
    selected.has(String(entry.channelCode ?? "").trim())
  );

  return exactMatches.length ? exactMatches : entries;
}

function dedupeTraceEntries(entries: TraceEntry[]): TraceEntry[] {
  const seen = new Set<string>();
  const result: TraceEntry[] = [];

  for (const entry of sortTraceEntriesByExecutionOrder(entries)) {
    // La duración no forma parte de la identidad. El mismo span puede llegar
    // repetido con una duración distinta o redondeada y no debe sumarse otra vez.
    const key = [
      entry.utilitytype,
      entry.invokerLibrary,
      entry.invokedparam,
      entry.databaseInstance,
      entry.collection,
      entry.databaseQuery,
      entry.name,
      entry.channelCode,
    ]
      .map((value) => String(value ?? "").trim().toUpperCase())
      .join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function dedupeNormalizedSpans(spans: NormalizedSpan[]): NormalizedSpan[] {
  const seen = new Set<string>();
  const result: NormalizedSpan[] = [];

  for (const span of spans) {
    const key = [
      span.traceId,
      span.spanId,
      span.name,
      span.utilityType,
      span.durationMs,
      span.channelCode,
      span.properties?.invokerLibrary,
      span.properties?.invokedparam,
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(span);
  }

  return result;
}

function getEntryLibrary(item: TraceEntry): string {
  return String(item.invokerLibrary || item.name || "-").trim();
}

function getEntryInvokedParam(item: TraceEntry): string {
  return String(
    item.invokedparam ||
    item.databaseQuery ||
    item.collection ||
    item.name ||
    ""
  ).trim();
}

function getEntryDatabaseOrCollection(item: TraceEntry): string {
  return String(
    item.databaseInstance || item.collection || item.databaseQuery || ""
  ).trim();
}

function getTotalDuration(entries: TraceEntry[]): number {
  if (!entries.length) return 0;

  return (
    entries.reduce((sum, item) => sum + Number(item.durationMs ?? 0), 0)
  );
}

function groupBy<T>(
  items: T[],
  getKey: (item: T) => string
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = getKey(item) || "-";

    if (!acc[key]) {
      acc[key] = [];
    }

    acc[key].push(item);

    return acc;
  }, {});
}

function buildCicsTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("CICS");

  const avg = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(avg)}`);

  entries.forEach((item, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "    └──" : "    ├──";
    const secondBranch = isLast ? "        └──" : "    │   └──";
    const thirdBranch = isLast ? "            └──" : "    │       └──";

    const library = getEntryLibrary(item);
    const label = getEntryInvokedParam(item);

    lines.push(`${branch} ${library} (${formatTraceDuration(item.durationMs)})`);
    lines.push(`${secondBranch} InterBackendCics[${label || library}]`);
    lines.push(`${thirdBranch} ${label}`);
  });

  lines.push("");
}

function buildJdbcTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("JDBC");

  const orderedEntries = sortTraceEntriesByExecutionOrder(entries);
  const jumpFlags = getTraceEntryJumpFlags(orderedEntries);
  const jumpByEntry = new Map<TraceEntry, boolean>();

  orderedEntries.forEach((entry, index) => {
    jumpByEntry.set(entry, jumpFlags[index] ?? false);
  });

  const byLibrary = groupBy(orderedEntries, (item) => getEntryLibrary(item));

  Object.entries(byLibrary).forEach(([library, libraryEntries]) => {
    const avg = getTotalDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo total: ${formatTraceDuration(avg)})`);

    const byMethod = groupBy(libraryEntries, (item) => {
      return getJdbcSqlMethod(item) || "DESCONOCIDO";
    });

    Object.entries(byMethod).forEach(([method, methodEntries]) => {
      lines.push(`    ├── ${method}: ${methodEntries.length}`);

      methodEntries.forEach((item, index) => {
        const isLast = index === methodEntries.length - 1;
        const branch = isLast ? "    │   └──" : "    │   ├──";
        const classification = jumpByEntry.get(item) === true ? "Salto" : "Consulta";

        const invokedParam = getEntryInvokedParam(item);
        const database = getEntryDatabaseOrCollection(item);

        lines.push(
          `${branch} ${classification} · Jdbc[${invokedParam}] (${formatTraceDuration(
            item.durationMs
          )})`
        );

        if (database) {
          lines.push(`    │   │   └── ${database}`);
        } else {
          lines.push("    │   │   └──");
        }

        lines.push(`    │   │   └── ${invokedParam}`);
      });
    });

    lines.push("");
  });
}

function buildJpaTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("JPA");

  const byLibrary = groupBy(entries, (item) => getEntryLibrary(item));

  Object.entries(byLibrary).forEach(([library, libraryEntries]) => {
    const avg = getTotalDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo total: ${formatTraceDuration(avg)})`);

    libraryEntries.forEach((item, index) => {
      const isLast = index === libraryEntries.length - 1;
      const branch = isLast ? "    └──" : "    ├──";

      const invokedParam = getEntryInvokedParam(item);
      const database = getEntryDatabaseOrCollection(item);

      lines.push(
        `${branch} Jpa[${invokedParam}] (${formatTraceDuration(
          item.durationMs
        )})`
      );

      if (database) {
        lines.push(`        └── ${database}`);
      } else {
        lines.push("        └──");
      }

      lines.push(`        └── ${invokedParam}`);
    });

    lines.push("");
  });
}

function buildMongoTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("MONGO CONNECTOR");

  const avg = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(avg)}`);

  entries.forEach((item, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "    └──" : "    ├──";

    const library = getEntryLibrary(item);
    const operation = getMongoOperation(item);
    const collection = item.collection || item.databaseInstance || "-";

    lines.push(`${branch} ${library} (${formatTraceDuration(item.durationMs)})`);
    lines.push(`    │   ├── ${collection}`);
    lines.push(`    │   └── ${operation}`);
  });

  lines.push("");
}

function buildApiConnectorTreeSection(
  title: string,
  utilityType: string,
  entries: TraceEntry[],
  lines: string[]
) {
  if (!entries.length) return;

  lines.push(title);

  const avg = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(avg)}`);

  entries.forEach((item, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "    └──" : "    ├──";
    const secondBranch = isLast ? "        └──" : "    │   └──";
    const thirdBranch = isLast ? "            └──" : "    │       └──";

    const library = getEntryLibrary(item);
    const invokedParam = getEntryInvokedParam(item);

    lines.push(
      `${branch} ${invokedParam || library} (${formatTraceDuration(
        item.durationMs
      )})`
    );
    lines.push(`${secondBranch} ${utilityType}[${library}]`);
    lines.push(`${thirdBranch} ${invokedParam}`);
  });

  lines.push("");
}

function buildGenericClientTreeSection(
  title: string,
  utilityType: string,
  entries: TraceEntry[],
  lines: string[]
) {
  if (!entries.length) return;

  lines.push(title);

  const byLibrary = groupBy(entries, (item) => getEntryLibrary(item));

  Object.entries(byLibrary).forEach(([library, libraryEntries]) => {
    const avg = getTotalDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo total: ${formatTraceDuration(avg)})`);

    libraryEntries.forEach((item, index) => {
      const isLast = index === libraryEntries.length - 1;
      const branch = isLast ? "    └──" : "    ├──";

      const invokedParam = getEntryInvokedParam(item);

      lines.push(
        `${branch} ${utilityType}[${invokedParam || library}] (${formatTraceDuration(
          item.durationMs
        )})`
      );
      lines.push(`        └── ${invokedParam}`);
    });

    lines.push("");
  });
}

function buildOtherTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("OTROS");

  const avg = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(avg)}`);

  entries.forEach((item, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "    └──" : "    ├──";
    const secondBranch = isLast ? "        └──" : "    │   └──";
    const thirdBranch = isLast ? "            └──" : "    │       └──";

    const library = getEntryLibrary(item);
    const invokedParam = getEntryInvokedParam(item);
    const type = item.utilitytype || "UNKNOWN";

    lines.push(
      `${branch} ${invokedParam || library} (${formatTraceDuration(
        item.durationMs
      )})`
    );
    lines.push(`${secondBranch} ${type}[${library}]`);
    lines.push(`${thirdBranch} ${invokedParam}`);
  });

  lines.push("");
}

type TraceFlowSummary = {
  label: string;
  entries: TraceEntry[];
  totalSaltos: number;
  tiempoTotalSaltos: number;
  totalTiempoEsperadoAws: number;
};

type AwsTraceCalculation = {
  totalSaltos: number;
  tiempoTotal: number;
  totalTiempoEsperadoAws: number;
};

function getExpectedAwsTimeForEntries(entries: TraceEntry[]): number {
  const metrics = calculateAwsTraceMetrics(entries);
  return metrics.totalTiempoEsperadoAws;
}

function calculateAwsTraceMetrics(
  entries: TraceEntry[],
  _responseTimeMs = 0
): AwsTraceCalculation {
  const visibleEntries = dedupeTraceEntries(
    entries.filter((entry) => !isGrpcEntry(entry))
  );
  const jumpFlags = getTraceEntryJumpFlags(visibleEntries);

  const totalSaltos = jumpFlags.reduce(
    (total, isJump) => total + (isJump ? 1 : 0),
    0
  );

  // El tiempo total del resumen siempre es la suma de las duraciones
  // mostradas en el detalle de la traza. responseTimeMs de invokerTX se usa
  // solamente para buscar y ordenar trazas candidatas, nunca para sustituir
  // esta medicion.
  const tiempoTotal = visibleEntries.reduce((total, entry) => {
    const durationMs = Number(entry.durationMs);

    return (
      total +
      (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0)
    );
  }, 0);

  return {
    totalSaltos,
    tiempoTotal,
    totalTiempoEsperadoAws:
      tiempoTotal + AWS_NETWORK_CONSTANT_MS * totalSaltos,
  };
}

function buildTraceFlowSummary(
  entries: TraceEntry[],
  index: number,
  responseTimeMs = 0
): TraceFlowSummary {
  const uniqueEntries = dedupeTraceEntries(
    entries.filter((entry) => !isGrpcEntry(entry))
  );
  const calculation = calculateAwsTraceMetrics(uniqueEntries, responseTimeMs);

  return {
    label: `Flujo ${index + 1}`,
    entries: uniqueEntries,
    totalSaltos: calculation.totalSaltos,
    tiempoTotalSaltos: calculation.tiempoTotal,
    totalTiempoEsperadoAws: calculation.totalTiempoEsperadoAws,
  };
}

function appendTraceSummaryHeader(
  lines: string[],
  summary: TraceFlowSummary
): void {
  lines.push(`Total de saltos encontrados: ${summary.totalSaltos}`);
  lines.push(`Tiempo total: ${formatTraceDuration(summary.tiempoTotalSaltos)}`);
  lines.push(
    `Total de Tiempo Esperado en AWS: ${formatTraceDuration(
      summary.totalTiempoEsperadoAws
    )}`
  );
}

function appendTraceDetail(entries: TraceEntry[], lines: string[]): void {
  const visibleEntries = entries.filter((entry) => !isGrpcEntry(entry));

  const cicsEntries = visibleEntries.filter(
    (entry) => entry.utilitytype === "InterBackendCics"
  );

  const jdbcEntries = visibleEntries.filter((entry) => entry.utilitytype === "Jdbc");

  const jpaEntries = visibleEntries.filter((entry) => entry.utilitytype === "Jpa");

  const mongoEntries = visibleEntries.filter(
    (entry) => entry.utilitytype === "DaasMongoConnector"
  );

  const apiInternalEntries = visibleEntries.filter(
    (entry) => entry.utilitytype === "APIInternalConnectorImpl"
  );

  const apiExternalEntries = visibleEntries.filter(
    (entry) => entry.utilitytype === "APIExternalConnectorImpl"
  );

  const titanEntries = visibleEntries.filter(
    (entry) => entry.utilitytype === "TitanClient"
  );

  const knownTypes = new Set([
    "InterBackendCics",
    "APIInternalConnectorImpl",
    "APIExternalConnectorImpl",
    "Jdbc",
    "Jpa",
    "DaasMongoConnector",
    "TitanClient",
  ]);

  const otherEntries = visibleEntries.filter(
    (entry) => !knownTypes.has(entry.utilitytype)
  );

  buildCicsTreeSection(cicsEntries, lines);
  buildJdbcTreeSection(jdbcEntries, lines);
  buildJpaTreeSection(jpaEntries, lines);
  buildMongoTreeSection(mongoEntries, lines);

  buildApiConnectorTreeSection(
    "API-CONNECTOR INTERNO",
    "APIInternalConnectorImpl",
    apiInternalEntries,
    lines
  );

  buildApiConnectorTreeSection(
    "API-CONNECTOR EXTERNO",
    "APIExternalConnectorImpl",
    apiExternalEntries,
    lines
  );

  buildGenericClientTreeSection(
    "TITAN CLIENT",
    "TitanClient",
    titanEntries,
    lines
  );

  buildOtherTreeSection(otherEntries, lines);
}

function appendMultiFlowTotals(
  lines: string[],
  flowSummaries: TraceFlowSummary[]
): void {
  const totalSaltos = flowSummaries.reduce(
    (sum, flow) => sum + flow.totalSaltos,
    0
  );

  const tiempoTotalSaltos = flowSummaries.reduce(
    (sum, flow) => sum + flow.tiempoTotalSaltos,
    0
  );

  const totalTiempoEsperadoAws = flowSummaries.reduce(
    (sum, flow) => sum + flow.totalTiempoEsperadoAws,
    0
  );

  lines.push("============================================================");
  lines.push("");
  lines.push(
    `Total de saltos encontrados: ${totalSaltos} - Suma de saltos de todos los flujos`
  );

  for (const flow of flowSummaries) {
    lines.push(`❏ ${flow.label} - ${flow.totalSaltos} saltos`);
  }

  lines.push("");
  lines.push(`Tiempo total: ${formatTraceDuration(tiempoTotalSaltos)}`);

  for (const flow of flowSummaries) {
    lines.push(`❏ ${flow.label} - ${formatTraceDuration(flow.tiempoTotalSaltos)}`);
  }

  lines.push("");
  lines.push(
    `Total de Tiempo Esperado en AWS: ${formatTraceDuration(
      totalTiempoEsperadoAws
    )}`
  );

  for (const flow of flowSummaries) {
    lines.push(
      `❏ ${flow.label} - ${formatTraceDuration(flow.totalTiempoEsperadoAws)}`
    );
  }
}

function appendTraceReport(
  lines: string[],
  summary: TraceFlowSummary
): void {
  lines.push("RESUMEN DE SALTOS Y TIEMPOS DE RESPUESTA");
  appendTraceSummaryHeader(lines, summary);
  lines.push("");
  lines.push("============================================================");
  lines.push("");
  lines.push("=== DETALLE DE TRAZAS ===");
  lines.push("");
  appendTraceDetail(summary.entries, lines);
}

function buildTraceSummary(entries: TraceEntry[], responseTimeMs = 0): string {
  const visibleEntries = dedupeTraceEntries(
    entries.filter((entry) => !isGrpcEntry(entry))
  );

  if (!visibleEntries.length) return "Sin trazas encontradas";

  const summary = buildTraceFlowSummary(visibleEntries, 0, responseTimeMs);
  const lines: string[] = [];

  appendTraceReport(lines, summary);

  return lines.join("\n").trim();
}

function buildTraceSummaryByFlows(
  flows: TraceEntry[][],
  responseTimeMs = 0
): string {
  const uniqueEntries = dedupeTraceEntries(
    flows
      .flat()
      .filter((entry) => !isGrpcEntry(entry))
  );

  if (!uniqueEntries.length) return "Sin trazas encontradas";

  const summary = buildTraceFlowSummary(uniqueEntries, 0, responseTimeMs);
  const lines: string[] = [];

  appendTraceReport(lines, summary);

  return lines.join("\n").trim();
}

async function fetchTracesByLibraries(params: {
  filters: MetricsFilters;
  invokerTx: string;
  responseTimeMs?: number;
  invokerLibraryHint?: string;
  invokerLibraryHints?: string[];
}): Promise<RawSpan[]> {
  const {
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint,
    invokerLibraryHints = [],
  } = params;

  const cleanHints = Array.from(
    new Set(
      [...invokerLibraryHints, invokerLibraryHint]
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );

  if (!cleanHints.length) {
    return [];
  }

  const hintSpans = await searchSpansByLibraries(
    filters,
    invokerTx,
    cleanHints,
    responseTimeMs
  );

  const uniqueHintSpans = getLimitedUniqueHintSpans(hintSpans);

  if (!uniqueHintSpans.length) {
    return [];
  }

  const traces = await Promise.all(
    uniqueHintSpans.map((span) =>
      traceLimiter(() =>
        fetchFullTraceByHintSpan({
          filters,
          invokerTx,
          hintSpan: span,
        })
      )
    )
  );

  const validTraces = traces.filter((trace): trace is RawSpan => Boolean(trace));
  const selectedTrace = selectConcordantTrace(
    validTraces,
    invokerTx,
    responseTimeMs
  );

  return selectedTrace ? [selectedTrace] : [];
}

export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string,
  invokerLibraryHints?: string[]
): Promise<NormalizedSpan[]> {
  const libraryTraces = await fetchTracesByLibraries({
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint,
    invokerLibraryHints,
  });

  if (libraryTraces.length > 0) {
    const normalized = dedupeNormalizedSpans(
      libraryTraces.flatMap((trace) => normalizeSpans(trace))
    );

    // El canal se usa para elegir la traza candidata, no para recortar sus hijos.
    // Muchas utilities JDBC/API/Mongo no traen channel-code propio.
    return normalized;
  }

  const hintSpan = await searchBestSpan(
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint
  );

  if (!hintSpan?.spanId) {
    console.warn(`[RHO] No se encontró span para invokerTx=${invokerTx}`);
    return [];
  }

  const trace = await fetchFullTraceByHintSpan({
    filters,
    invokerTx,
    hintSpan,
  });

  if (!trace) {
    return [];
  }

  const normalized = normalizeSpans(trace);

  // No filtrar los spans hijos por channel-code: eso sesga y deja incompleta
  // la traza porque el canal suele existir únicamente en el span padre.
  return normalized;
}

export async function fetchTraceSummaryForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string,
  invokerLibraryHints?: string[]
): Promise<string> {
  const libraryTraces = await fetchTracesByLibraries({
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint,
    invokerLibraryHints,
  });

  if (libraryTraces.length > 0) {
    const flowEntries = libraryTraces
      .map((trace) => {
        const entries: TraceEntry[] = [];
        collectTraceEntries(trace, entries);

        // La traza ya fue seleccionada usando canal/site. No recortamos
        // utilities hijas que no tengan channel-code propio.
        return dedupeTraceEntries(entries);
      })
      .filter((entries) => entries.length > 0);

    if (flowEntries.length > 0) {
      const selectedTraceDurationMs = getTraceDurationMs(
        libraryTraces[0],
        invokerTx
      );
      return buildTraceSummaryByFlows(
        flowEntries,
        selectedTraceDurationMs
      );
    }
  }

  const hintSpan = await searchBestSpan(
    filters,
    invokerTx,
    responseTimeMs,
    invokerLibraryHint
  );

  if (!hintSpan?.spanId) {
    console.warn(`[RHO] No se encontró span para resumen invokerTx=${invokerTx}`);
    return "Sin trazas encontradas";
  }

  const trace = await fetchFullTraceByHintSpan({
    filters,
    invokerTx,
    hintSpan,
  });

  if (!trace) {
    return "Sin trazas encontradas";
  }

  const concordantTrace = selectConcordantTrace(
    [trace],
    invokerTx,
    responseTimeMs
  );

  if (!concordantTrace) {
    console.warn("[RHO] No fue posible medir concordancia; se utilizará la traza recuperada", {
      invokerTx,
      responseTimeMs,
      traceDurationMs: getTraceDurationMs(trace, invokerTx),
    });
  }

  const selectedTrace = concordantTrace ?? trace;
  const entries: TraceEntry[] = [];

  collectTraceEntries(selectedTrace, entries);

  const completeEntries = dedupeTraceEntries(entries);

  return buildTraceSummary(
    completeEntries,
    getTraceDurationMs(selectedTrace, invokerTx)
  );
}