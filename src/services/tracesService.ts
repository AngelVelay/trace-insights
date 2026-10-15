import type {
  RawSpan,
  NormalizedSpan,
  SpansPaginatedResponse,
  ClassifiedTraces,
  MetricsFilters,
} from "@/types/bbva";
import { dateRangeToNano } from "./dateUtils";
import { readTraceSpanDurationMs, readTraceTransactionDurationMs } from "./traceDuration";
import {
  apiRequestWithRetry,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "./httpClient";

const RHO_LIVE_BASE = "https://rho.live-02.nextgen.igrupobbva";
const RHO_LIVE_04_BASE = "https://rho.live-04.nextgen.igrupobbva";
const RHO_WORK_BASE = "https://rho.work-02.nextgen.igrupobbva";

function isWorkSite(site?: string): boolean {
  return String(site ?? "").trim().toUpperCase().startsWith("WORK-");
}

function getRhoBaseUrl(site?: string): string {
  if (isWorkSite(site)) return RHO_WORK_BASE;
  return String(site ?? "").trim().toUpperCase() === "LIVE-04" ? RHO_LIVE_04_BASE : RHO_LIVE_BASE;
}

/**
 * En Vite usamos el mismo proxy RHO que Monitoreo Logs Omega. Las peticiones
 * cross-origin directas pueden fallar por CORS aunque el token sea correcto.
 * En despliegues que no sean localhost se conserva el host RHO original.
 */
function buildRhoUrl(path: string, site?: string): URL {
  if (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) {
    const normalizedSite = String(site ?? "").trim().toUpperCase();
    const prefix = isWorkSite(site) ? "/rho-work-02" : normalizedSite === "LIVE-04" ? "/rho-live-04" : "/rho-live-02";
    return new URL(`${prefix}${path}`, window.location.origin);
  }
  return new URL(path, getRhoBaseUrl(site));
}

function normalizeRhoEnvironment(value?: string): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized === "OCT" ? "OCTA" : normalized;
}

function buildRhoScopeFilter(filters: MetricsFilters): string | undefined {
  if (isWorkSite(filters.site)) {
    const environment = normalizeRhoEnvironment(filters.environment);
    return environment ? `properties.env == "${environment}"` : undefined;
  }

  return filters.site?.trim()
    ? `properties.site == "${filters.site.trim()}"`
    : undefined;
}
const AWS_NETWORK_CONSTANT_MS = 89; // Milisegundos por salto a AWS.

const MAX_TRACE_IDS_PER_INVOKER = 1;
const MAX_TRACE_IDS_PER_LIBRARY = 1;
const USE_ROOT_SPAN_LOOKUP = true;

const traceLimiter = createConcurrencyLimiter(3);

const traceCache = new Map<string, RawSpan>();
const rootSpanCache = new Map<string, string>();

function putBoundedCache<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export type TraceSpanMetadata = {
  channelCode?: string;
  aap?: string;
  typology?: string;
  site?: string;
  channels?: TraceChannelMetadata[];
};

type TraceEntry = {
  spanId: string;
  traceId: string;
  utilitytype: string;
  declaredUtilityType: string;
  invokerLibrary: string;
  name: string;
  invokedparam: string;
  databaseQuery: string;
  databaseInstance: string;
  collection: string;
  durationMs: number | null;
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

/** 1 y 01 representan el mismo canal; no alterar el valor enviado a la API. */
function canonicalChannelCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  return /^\d{1,2}$/.test(code) ? code.padStart(2, "0") : code;
}

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
  // Sin fechas ni sesión en la clave se devolvían traces antiguos al cambiar
  // de rango o credenciales. Solo guardamos una huella del token, nunca el token.
  const token = filters.bearerToken ?? "";
  let authHash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    authHash = Math.imul(authHash ^ token.charCodeAt(i), 16777619);
  }
  return [
    filters.site ?? "",
    filters.environment ?? "",
    filters.fromDate instanceof Date ? filters.fromDate.getTime() : String(filters.fromDate),
    filters.toDate instanceof Date ? filters.toDate.getTime() : String(filters.toDate),
    authHash >>> 0,
    getSelectedChannelCodes(filters).join(","),
    invokerTx,
  ].join("|");
}

function normalizeDuration(span: RawSpan): number {
  // Se conserva un número para las clasificaciones/ordenaciones existentes.
  // En el resumen de AWS se usa readTraceSpanDurationMs para distinguir N/D de 0.
  return readTraceSpanDurationMs(span) ?? 0;
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

    const utilityType = inferUtilityType(span);

    // GRPC no forma parte de la traza funcional ni del cálculo AWS.
    if (utilityType === "GRPCClient") {
      continue;
    }

    normalized.push({
      spanId,
      traceId: String(span.traceId ?? ""),
      name: String(span.name ?? ""),
      durationMs: normalizeDuration(span),
      utilityType,
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
  baseSite?: string;
  environment?: string;
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
    baseSite,
    environment,
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

  const selectedSite = String(baseSite ?? site ?? "").trim().toUpperCase();
  const useWorkEnvironment = selectedSite.startsWith("WORK-");

  if (!useWorkEnvironment && site?.trim()) {
    filters.push(`properties.site == "${site.trim()}"`);
  }

  if (useWorkEnvironment && environment?.trim()) {
    filters.push(`properties.env == "${environment.trim().toUpperCase()}"`);
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

  const url = buildRhoUrl("/v1/ns/apx.online/spans", baseSite ?? site);

  url.searchParams.set("q", q);
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set(
    "properties",
    [
      "channel-code",
      "channelCode",
      "type",
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
  site?: string;
}): string {
  const { spanId, fromDate, toDate, site } = params;

  const url = buildRhoUrl(
    `/v1/ns/apx.online/mrs/RhoTraces/spans/${encodeURIComponent(spanId)}:trace`,
    site
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
  site?: string;
}): string {
  const { spanId, fromDate, toDate, site } = params;

  const url = buildRhoUrl(
    `/v1/ns/apx.online/mrs/RhoTraces/spans/${encodeURIComponent(spanId)}`,
    site
  );

  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);

  return url.toString();
}

function unwrapRhoSpanDetail(response: RhoSpanDetailResponse): RawSpan | null {
  const visit = (value: unknown, depth: number): RawSpan | null => {
    if (!value || typeof value !== "object" || depth > 5) return null;
    if (Array.isArray(value)) {
      const roots = value.map((row) => visit(row, depth + 1)).filter((root): root is RawSpan => root !== null);
      if (roots.length === 1) return roots[0];
      // Algunas versiones de Rho devuelven data[] con varios nodos raíz.
      // No descartar todos menos el primero: perdíamos Transaction y utilidades.
      return roots.length ? { children: roots } : null;
    }
    const row = value as Record<string, unknown>;
    const identity = [row.spanId, row.traceId, row.name].some(
      (v) => typeof v === "string" && v.trim(),
    );
    if (identity || Array.isArray(row.children)) return row as RawSpan;
    for (const key of ["data", "span", "item", "trace", "root", "result", "spans", "items", "content"]) {
      if (key in row) {
        const candidate = visit(row[key], depth + 1);
        if (candidate) return candidate;
      }
    }
    return null;
  };
  return visit(response, 0);
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
  // El mismo snapshot que usa Dashboard; evita búsquedas RHO adicionales con
  // filtros de canal/sitio que no existen en cada nodo de la traza.
  const snapshot = await fetchDashboardRhoSnapshot(
    filters, invokerTx, responseTimeMs,
    [invokerLibraryHint, ...(invokerLibraryHints ?? [])].filter((hint): hint is string => Boolean(hint)),
  );
  return snapshot.channels;
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
    site: filters.site,
  });

  console.log("[RHO span detail metadata URL]", {
    spanId,
    url,
  });

  const response = await apiRequestWithRetry<RhoSpanDetailResponse>(url, {
    headers: buildAuthHeaders(filters.bearerToken),
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
  }): Promise<RawSpan | null> => {
    const url = buildRhoSpanSearchUrl({
      baseSite: filters.site,
      environment: filters.environment,
      invokerTx,
      fromDate: from,
      toDate: to,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      durationMs:
        params.useDurationFilter && targetDuration !== undefined
          ? targetDuration
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
      targetDuration,
      useDurationFilter: params.useDurationFilter,
      url,
    });

    const res = await apiRequestWithRetry<SpansPaginatedResponse>(url, { headers });
    const items = Array.isArray(res.data) ? res.data : [];

    const best = sortSpansByDurationTarget(
      validSearchSpans(items),
      targetDuration
    )[0];

    if (best) {
      console.log("[RHO selected span]", {
        invokerTx,
        invokerLibraryHint,
        selectedSpanId: best.spanId,
        selectedTraceId: best.traceId,
        selectedDuration: normalizeDuration(best),
        targetDuration,
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

const strictSite = Boolean(filters.site) && !isWorkSite(filters.site);
const filteredAttempts = attempts.filter(
  (attempt) => (!strictChannel || attempt.useChannelFilter) && (!strictSite || attempt.useSiteFilter)
);

for (const attempt of filteredAttempts) {
  const span = await search(attempt);

  if (span) {
    return span;
  }
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

  if (!cleanHints.length) {
    return [];
  }

  const targetDuration =
    typeof responseTimeMs === "number" &&
      Number.isFinite(responseTimeMs) &&
      responseTimeMs > 0
      ? Math.round(responseTimeMs)
      : undefined;

  const search = async (params: {
    useSiteFilter: boolean;
    useChannelFilter: boolean;
    useDurationFilter: boolean;
  }): Promise<RawSpan[]> => {
    const url = buildRhoSpanSearchUrl({
      baseSite: filters.site,
      environment: filters.environment,
      invokerTx,
      fromDate: from,
      toDate: to,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      durationMs:
        params.useDurationFilter && targetDuration !== undefined
          ? targetDuration
          : undefined,
      invokerLibraryHints: cleanHints,
      includeDuration: params.useDurationFilter,
    });

    console.log("[RHO multi-library span search URL]", {
      invokerTx,
      site: params.useSiteFilter ? filters.site : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      invokerLibraryHints: cleanHints,
      targetDuration,
      useDurationFilter: params.useDurationFilter,
      url,
    });

    const res = await apiRequestWithRetry<SpansPaginatedResponse>(url, { headers });
    const items = Array.isArray(res.data) ? res.data : [];

    return sortSpansByDurationTarget(
      validSearchSpans(items),
      targetDuration
    );
  };

  const attempts = [
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: false,
    },
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: false,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: false,
      useDurationFilter: false,
    },
    {
      useSiteFilter: false,
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useSiteFilter: false,
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: false,
    },
    {
      useSiteFilter: false,
      useChannelFilter: false,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useSiteFilter: false,
      useChannelFilter: false,
      useDurationFilter: false,
    },
  ];

  const strictSite = Boolean(filters.site) && !isWorkSite(filters.site);
  const strictChannel = channelCodes.length > 0;
  for (const attempt of attempts.filter((item) =>
    (!strictSite || item.useSiteFilter) && (!strictChannel || item.useChannelFilter)
  )) {
    const spans = await search(attempt);

    if (spans.length > 0) {
      return spans;
    }
  }

  return [];
}

function getSpanProperty(span: RawSpan | null | undefined, key: string): string {
  return String(span?.properties?.[key] ?? "").trim();
}

function isTransactionSpan(span: RawSpan, invokerTx: string): boolean {
  const type = getSpanProperty(span, "type").toUpperCase();
  const name = String(span.name ?? "").trim().toUpperCase();
  // Una utilidad también contiene properties.invokerTx. Esa propiedad NO
  // convierte al hijo Jdbc/Mongo en la raíz Transaction/Job del trace.
  return ["TRANSACTION", "TRX", "JOB", "BATCH"].includes(type) ||
    name === invokerTx.trim().toUpperCase();
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
    baseSite: filters.site,
    environment: filters.environment,
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
    buildRhoScopeFilter(filters),
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
    const res = await apiRequestWithRetry<SpansPaginatedResponse>(rawUrl.toString(), {
      headers,
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
  signal?: AbortSignal;
  quick?: boolean;
}): Promise<string> {
  const { filters, traceId, invokerTx, fallbackSpanId, signal, quick = false } = params;
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
    putBoundedCache(rootSpanCache, cacheKey, fallbackSpanId, 250);
    return fallbackSpanId;
  }

  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  if (quick) {
    // Un nodo Utility no garantiza name = TRX ni channel-code; el traceId sí
    // identifica el árbol. Buscar primero el root sin imponer propiedades.
    const rootUrl = buildRhoUrl("/v1/ns/apx.online/spans", filters.site);
    rootUrl.searchParams.set("q", `traceId == "${escapeRhoQueryValue(traceId)}"`);
    rootUrl.searchParams.set("fromDate", from);
    rootUrl.searchParams.set("toDate", to);
    rootUrl.searchParams.set("profile", "default");
    rootUrl.searchParams.set("size", "50");
    rootUrl.searchParams.set("sort", "ascending");
    try {
      const response = await apiRequestWithRetry<SpansPaginatedResponse>(
        rootUrl.toString(),
        { headers, signal, timeoutMs: 5_000 },
        1,
      );
      const spans = readDashboardSearchSpans(response);
      const transaction = spans.find((span) => isTransactionSpan(span, invokerTx));
      const root = transaction ?? (spans as SpanWithParent[]).find(isLikelyRootSpan);
      const rootSpanId = String(root?.spanId ?? "").trim();
      if (rootSpanId) {
        putBoundedCache(rootSpanCache, cacheKey, rootSpanId, 250);
        return rootSpanId;
      }
    } catch (error) {
      if (signal?.aborted || isRhoAuthenticationError(error)) throw error;
    }
    // No prolongar por varios minutos una búsqueda rápida del Dashboard.
    return fallbackSpanId;
  }

  const search = async (params: {
    useSiteFilter: boolean;
    useChannelFilter: boolean;
    useInvokerTxFilter: boolean;
  }): Promise<string | null> => {
    const url = buildRhoSpanSearchUrl({
      baseSite: filters.site,
      environment: filters.environment,
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

    const res = await apiRequestWithRetry<SpansPaginatedResponse>(
      url,
      { headers, signal, timeoutMs: quick ? 8_000 : 20_000 },
      quick ? 1 : 2,
    );
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

    const root =
      transactionWithChannel ??
      transactionSpan ??
      rootLikeSpan ??
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
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: channelCodes.length > 0,
      useInvokerTxFilter: true,
    },
    {
      useSiteFilter: Boolean(filters.site),
      useChannelFilter: false,
      useInvokerTxFilter: true,
    },
    {
      useSiteFilter: false,
      useChannelFilter: channelCodes.length > 0,
      useInvokerTxFilter: true,
    },
    {
      useSiteFilter: false,
      useChannelFilter: false,
      useInvokerTxFilter: true,
    },
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
  ];

  const strictSite = Boolean(filters.site) && !isWorkSite(filters.site);
  const permittedAttempts = attempts.filter((item) => !strictSite || item.useSiteFilter);
  // El nodo raíz puede no tener invokerTx ni channel-code: buscarlo por traceId.
  const quickAttempts = [{
    useSiteFilter: Boolean(filters.site),
    useChannelFilter: false,
    useInvokerTxFilter: false,
  }];
  for (const attempt of (quick ? quickAttempts : permittedAttempts)) {
    if (signal?.aborted) throw new DOMException("Petición cancelada", "AbortError");
    try {
      const rootSpanId = await search(attempt);

      if (rootSpanId) {
        putBoundedCache(rootSpanCache, cacheKey, rootSpanId, 250);
        return rootSpanId;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      console.warn("[RHO] Error buscando root span, reintentando", {
        traceId,
        invokerTx,
        attempt,
        error,
      });
    }
  }

  // No cachear un fallback no verificado: la búsqueda pudo fallar por 503
  // temporal y el próximo intento debe poder encontrar el root real.
  return fallbackSpanId;
}

/**
 * Primero :trace sobre el span que Rho ya encontró. Es la misma estrategia
 * funcional de Securización Live y evita buscar de nuevo la raíz antes de
 * descargar. Solo en un resultado huérfano intentamos resolver el root.
 */
async function fetchFullTraceByHintSpan(params: {
  filters: MetricsFilters;
  invokerTx: string;
  hintSpan: RawSpan;
  signal?: AbortSignal;
  quick?: boolean;
}): Promise<RawSpan | null> {
  const { filters, invokerTx, hintSpan, signal, quick = false } = params;
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);
  const traceId = String(hintSpan.traceId ?? "").trim();
  const hintSpanId = String(hintSpan.spanId ?? "").trim();
  if (!hintSpanId) return null;

  const traceCacheKey = [getCacheScope(filters, invokerTx), traceId || hintSpanId].join("|");
  const cachedTrace = traceCache.get(traceCacheKey);
  if (cachedTrace) return cachedTrace;

  const downloadTrace = async (spanId: string): Promise<RawSpan | null> => {
    const url = buildRhoTraceUrl({ spanId, fromDate: from, toDate: to, site: filters.site });
    const response = await apiRequestWithRetry<RhoSpanDetailResponse>(
      url,
      { headers, signal, timeoutMs: quick ? 11_000 : 20_000 },
      quick ? 1 : 2,
    );
    return unwrapRhoSpanDetail(response);
  };

  if (quick) {
    let direct: RawSpan | null = null;
    let directError: unknown;
    try {
      direct = await downloadTrace(hintSpanId);
    } catch (error) {
      if (signal?.aborted || isRhoAuthenticationError(error)) throw error;
      directError = error;
    }
    // Si :trace entrega un Transaction/Job o el root con utilidades, no se
    // necesita la búsqueda costosa /spans?traceId=... adicional.
    const nodes = direct ? flattenSpans([direct]) : [];
    const containsTransaction = nodes.some((node) => isTransactionSpan(node, invokerTx));
    if (direct && (containsTransaction || !traceId || isTransactionSpan(hintSpan, invokerTx))) return direct;

    // El primer intento puede devolver solo el hijo Mongo/Jdbc. Buscar el
    // padre por traceId y volver a usar :trace con el span raíz.
    if (traceId) {
      const rootSpanId = await searchRootSpanIdByTraceId({
        filters, traceId, invokerTx, fallbackSpanId: hintSpanId, signal, quick: true,
      });
      if (rootSpanId && rootSpanId !== hintSpanId) {
        try {
          const root = await downloadTrace(rootSpanId);
          if (root) return root;
        } catch (error) {
          if (signal?.aborted || isRhoAuthenticationError(error)) throw error;
          if (!direct) throw error;
        }
      }
    }
    if (direct) return direct;
    if (directError) throw directError;
    return null;
  }

  const rootSpanId = traceId && !isTransactionSpan(hintSpan, invokerTx)
    ? await searchRootSpanIdByTraceId({
      filters, traceId, invokerTx, fallbackSpanId: hintSpanId, signal,
    })
    : hintSpanId;
  const trace = await downloadTrace(rootSpanId);
  if (!trace) throw new Error(`RHO devolvió :trace vacío para ${rootSpanId}`);
  putBoundedCache(traceCache, traceCacheKey, trace, 100);
  return trace;
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
  // Los SQL de RHO pueden empezar por comentarios o hints; esos prefijos no
  // cambian la operación real que determina si es Consulta o Salto.
  let q = databaseQuery.trim();
  while (q) {
    if (q.startsWith("--")) {
      const newline = q.indexOf("\n");
      q = newline >= 0 ? q.slice(newline + 1).trimStart() : "";
    } else if (q.startsWith("/*")) {
      const end = q.indexOf("*/", 2);
      q = end >= 0 ? q.slice(end + 2).trimStart() : "";
    } else {
      break;
    }
  }
  const first = q.split(/\s+/)[0].toUpperCase();
  return ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"].includes(first)
    ? first
    : "DESCONOCIDO";
}

const JDBC_WRITE_METHODS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);

function isJdbcEntry(entry: TraceEntry): boolean {
  return String(entry.utilitytype ?? "").trim().toLowerCase() === "jdbc";
}

function getJdbcSqlMethod(entry: TraceEntry): string {
  const candidates = [
    entry.databaseQuery,
    entry.invokedparam,
    entry.name,
  ];

  for (const candidate of candidates) {
    const method = getSqlMethod(String(candidate ?? ""));

    if (method && method !== "DESCONOCIDO") {
      return method;
    }
  }

  return getSqlMethod(String(entry.databaseQuery ?? "")) || "DESCONOCIDO";
}

function isJdbcSelectEntry(entry: TraceEntry): boolean {
  return isJdbcEntry(entry) && getJdbcSqlMethod(entry) === "SELECT";
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

  /*
   * Solo las utilidades reales que reconoce y muestra el reporte cuentan como
   * salto. No usamos declaredUtilityType como fallback porque algunos spans
   * contenedores o técnicos traen valores que no representan una llamada real
   * de utilidad y provocaban falsos saltos.
   */
  const inferredType = String(entry.utilitytype ?? "").trim();
  return AWS_UTILITY_JUMP_TYPES.has(inferredType);
}

/**
 * Clasificación definitiva para Métricas AWS Monitoreo.
 *
 * Regla de negocio:
 * - JDBC SELECT siempre es Consulta. Nunca incrementa Saltos a Lago Esmeralda.
 * - JDBC INSERT/UPDATE/DELETE son Saltos.
 * - Las utilidades no JDBC reconocidas (CICS, API Connector, JPA, Mongo y Titan)
 *   son Saltos.
 * - GRPC se excluye por completo.
 * - UNKNOWN y spans técnicos no cuentan como salto.
 *
 * Importante: no se conserva estado global entre entradas. La versión anterior
 * activaba una bandera al encontrar MONGO/API/CICS y convertía todos los SELECT
 * posteriores del árbol a Salto, aunque fueran simples lecturas JDBC.
 */
function getAwsJumpFlags(entries: TraceEntry[]): boolean[] {
  return entries.map((entry) => {
    if (isGrpcEntry(entry)) {
      return false;
    }

    if (isJdbcEntry(entry)) {
      const method = getJdbcSqlMethod(entry);

      if (method === "SELECT") {
        return false;
      }

      return JDBC_WRITE_METHODS.has(method);
    }

    return isAwsUtilityJumpEntry(entry);
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

function formatTraceDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "N/D";
  if (ms <= 0) return "0ms";

  const seconds = Math.floor(ms / 1000);
  const remainingMs = Math.max(0, ms - seconds * 1000);
  const roundedMs = Math.round(remainingMs * 100) / 100;
  const msText = Number.isInteger(roundedMs)
    ? String(roundedMs)
    : roundedMs.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  if (seconds <= 0) return `${msText}ms`;
  if (roundedMs === 0) return `${seconds}s`;

  return `${seconds}s ${msText}ms`;
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

  const durationMs = readTraceSpanDurationMs(node);

  const rawFingerprint = [
    utilitytype,
    invokerLibrary,
    invokedparam,
    name,
  ]
    .map((value) => String(value ?? "").trim().toUpperCase())
    .join(" ");

  if (
    !rawFingerprint.includes("GRPC") &&
    (
      utilitytype !== "UNKNOWN" ||
      invokerLibrary ||
      invokedparam ||
      databaseQuery ||
      databaseInstance ||
      collection
    )
  ) {
    out.push({
      spanId: String(node.spanId ?? "").trim(),
      traceId: String(node.traceId ?? "").trim(),
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

  const selected = new Set(channelCodes.map(canonicalChannelCode));

  const identified = entries.filter((entry) => String(entry.channelCode ?? "").trim());
  if (!identified.length) return entries;

  const hasSelectedChannel = identified.some((entry) => selected.has(canonicalChannelCode(entry.channelCode)));
  if (!hasSelectedChannel) return [];

  // Los hijos sin channel-code son parte del trace seleccionado; no los borres.
  return entries.filter((entry) => !entry.channelCode.trim() || selected.has(canonicalChannelCode(entry.channelCode)));
}

function dedupeTraceEntries(entries: TraceEntry[]): TraceEntry[] {
  const seen = new Set<string>();
  const result: TraceEntry[] = [];

  for (const entry of entries) {
    // Dos SELECT con el mismo texto y duración pueden ser ejecuciones reales
    // distintas. Solo fusionar si RHO certifica la misma identidad spanId.
    const key = entry.spanId
      ? `${entry.traceId}:${entry.spanId}`
      : `sin-span-id:${entry.sequence}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entry);
  }

  return result;
}

function buildTraceEntriesSignature(entries: TraceEntry[]): string {
  return entries
    .map((entry) =>
      [
        entry.utilitytype,
        entry.declaredUtilityType,
        entry.invokerLibrary,
        entry.invokedparam,
        entry.databaseInstance,
        entry.collection,
        entry.databaseQuery,
        entry.name,
        entry.channelCode,
      ]
        .map((value) => String(value ?? "").trim())
        .join("|")
    )
    .sort()
    .join("||");
}

function dedupeTraceEntryFlows(flows: TraceEntry[][]): TraceEntry[][] {
  const seen = new Set<string>();
  const result: TraceEntry[][] = [];

  for (const entries of flows) {
    const signature = buildTraceEntriesSignature(entries);

    if (!signature || seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    result.push(entries);
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

function getTotalDuration(entries: TraceEntry[]): number | null {
  // Un total de sección es desconocido cuando falta el tiempo de algún span.
  if (entries.some((entry) => entry.durationMs === null)) return null;
  return entries.reduce((sum, item) => {
    const durationMs = Number(item.durationMs ?? 0);
    return sum + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0);
  }, 0);
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

  const total = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(total)}`);

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

function buildJdbcTreeSection(
  entries: TraceEntry[],
  lines: string[],
  completeFlowEntries: TraceEntry[] = entries
) {
  if (!entries.length) return;

  lines.push("JDBC");

  const jumpFlags = getAwsJumpFlags(completeFlowEntries);
  const jumpByEntry = new Map<TraceEntry, boolean>();

  completeFlowEntries.forEach((entry, index) => {
    jumpByEntry.set(entry, jumpFlags[index] ?? false);
  });

  const byLibrary = groupBy(entries, (item) => getEntryLibrary(item));

  Object.entries(byLibrary).forEach(([library, libraryEntries]) => {
    const total = getTotalDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo total: ${formatTraceDuration(total)})`);

    const byMethod = groupBy(libraryEntries, (item) => {
      return getJdbcSqlMethod(item);
    });

    Object.entries(byMethod).forEach(([method, methodEntries]) => {
      lines.push(`    ├── ${method}: ${methodEntries.length}`);

      methodEntries.forEach((item, index) => {
        const isLast = index === methodEntries.length - 1;
        const branch = isLast ? "    │   └──" : "    │   ├──";
        const classification = getJdbcSqlMethod(item) === "SELECT"
          ? "Consulta"
          : jumpByEntry.get(item) === true
            ? "Salto"
            : "Sin clasificar";

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
    const total = getTotalDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo total: ${formatTraceDuration(total)})`);

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

  const total = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(total)}`);

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

  const total = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(total)}`);

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
    const total = getTotalDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo total: ${formatTraceDuration(total)})`);

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

  const total = getTotalDuration(entries);

  lines.push(`└── Tiempo total sección: ${formatTraceDuration(total)}`);

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
  consultasJdbcSelect: number;
  traceResponseMs: number | null;
  tiempoTotal: number;
  totalTiempoEsperadoAws: number;
  missingDurations: number;
  timedEntries: number;
  muAverageMs: number;
};

type AwsTraceCalculation = {
  totalSaltos: number;
  consultasJdbcSelect: number;
  tiempoTotal: number;
  totalTiempoEsperadoAws: number;
  missingDurations: number;
  timedEntries: number;
};

/**
 * Reglas para el cálculo de AWS:
 *
 * 1. JDBC INSERT, UPDATE, DELETE y MERGE cuentan como salto.
 * 2. JDBC SELECT siempre es consulta: aporta duración, pero no añade salto.
 * 3. Las utilidades distintas de JDBC reconocidas cuentan como salto.
 * 4. GRPC se excluye del detalle, del tiempo y del número de saltos.
 * 5. Si RHO omite duraciones, el total es parcial y no se informa como 0.
 *
 * Fórmula:
 *   Tiempo total = suma de consultas + suma de saltos, sin GRPC.
 *   Tiempo esperado AWS = Tiempo total + (constante de red x total de saltos).
 */
function calculateAwsTraceMetrics(entries: TraceEntry[]): AwsTraceCalculation {
  const effectiveEntries = entries.filter((entry) => !isGrpcEntry(entry));
  const jumpFlags = getAwsJumpFlags(effectiveEntries);

  let totalSaltos = 0;
  let consultasJdbcSelect = 0;
  let tiempoTotal = 0;
  let timedEntries = 0;

  effectiveEntries.forEach((entry, index) => {
    if (entry.durationMs !== null) timedEntries += 1;
    const durationMs = Number(entry.durationMs ?? 0);
    const safeDurationMs =
      Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;

    /*
     * El Tiempo total incluye consultas y saltos. De esta forma, un SELECT
     * siempre conserva el tiempo real recuperado de RHO aunque sea Consulta.
     */
    tiempoTotal += safeDurationMs;

    if (jumpFlags[index] === true) {
      totalSaltos += 1;
    }
    if (isJdbcSelectEntry(entry)) consultasJdbcSelect += 1;
  });

  return {
    totalSaltos,
    consultasJdbcSelect,
    tiempoTotal,
    timedEntries,
    missingDurations: effectiveEntries.length - timedEntries,
    totalTiempoEsperadoAws:
      tiempoTotal + AWS_NETWORK_CONSTANT_MS * totalSaltos,
  };
}

function getExpectedAwsTimeForEntries(entries: TraceEntry[]): number {
  return calculateAwsTraceMetrics(entries).totalTiempoEsperadoAws;
}

function buildTraceFlowSummary(
  entries: TraceEntry[],
  index: number,
  responseTimeMs = 0,
  traceResponseMs: number | null = null,
): TraceFlowSummary {
  const calculation = calculateAwsTraceMetrics(entries);

  return {
    label: `Flujo ${index + 1}`,
    entries,
    ...calculation,
    traceResponseMs,
    muAverageMs: Number.isFinite(responseTimeMs) && responseTimeMs > 0 ? responseTimeMs : 0,
  };
}

function appendTraceSummaryHeader(
  lines: string[],
  summary: TraceFlowSummary
): void {
  lines.push("RESUMEN DE SALTOS Y TIEMPOS DE RESPUESTA");
  lines.push(`Total de saltos encontrados: ${summary.totalSaltos}`);
  lines.push(`Consultas JDBC SELECT: ${summary.consultasJdbcSelect}`);
  lines.push(`Tiempo de respuesta promedio (MU/InvokeTx): ${summary.muAverageMs > 0 ? formatTraceDuration(summary.muAverageMs) : "N/D"}`);
  lines.push(`Tiempo de respuesta de la traza (RHO): ${summary.traceResponseMs === null ? "N/D (sin duración de Transaction/Job)" : formatTraceDuration(summary.traceResponseMs)}`);
  if (summary.missingDurations) {
    const detail = summary.timedEntries
      ? `suma parcial: ${formatTraceDuration(summary.tiempoTotal)}`
      : "ninguna duración disponible";
    lines.push(
      `Tiempo total: N/D (${summary.timedEntries}/${summary.entries.length} spans con duración RHO; ${detail})`
    );
    lines.push(
      `Total de Tiempo Esperado en AWS: ≥${formatTraceDuration(summary.totalTiempoEsperadoAws)} (mínimo estimado; faltan ${summary.missingDurations} duraciones RHO)`
    );
  } else {
    lines.push(`Tiempo total: ${formatTraceDuration(summary.tiempoTotal)}`);
    lines.push(
      `Total de Tiempo Esperado en AWS: ${formatTraceDuration(summary.totalTiempoEsperadoAws)}`
    );
  }
  lines.push("");
  lines.push("=== DETALLE DE TRAZAS ===");
  lines.push("");
}

function appendTraceDetail(entries: TraceEntry[], lines: string[]): void {
  // Protección final: ningún elemento GRPC puede llegar al detalle visual.
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
    "GRPCClient",
  ]);

  const otherEntries = visibleEntries.filter(
    (entry) => !knownTypes.has(entry.utilitytype) && !isGrpcEntry(entry)
  );

  buildCicsTreeSection(cicsEntries, lines);
  buildJdbcTreeSection(jdbcEntries, lines, visibleEntries);
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

function buildCombinedFlowSummary(
  flowSummaries: TraceFlowSummary[]
): TraceFlowSummary {
  return {
    label: "Total",
    entries: flowSummaries.flatMap((flow) => flow.entries),
    totalSaltos: flowSummaries.reduce(
      (sum, flow) => sum + flow.totalSaltos,
      0
    ),
    consultasJdbcSelect: flowSummaries.reduce((sum, flow) => sum + flow.consultasJdbcSelect, 0),
    traceResponseMs: flowSummaries.length === 1 ? flowSummaries[0].traceResponseMs : null,
    tiempoTotal: flowSummaries.reduce(
      (sum, flow) => sum + flow.tiempoTotal,
      0
    ),
    totalTiempoEsperadoAws: flowSummaries.reduce(
      (sum, flow) => sum + flow.totalTiempoEsperadoAws,
      0
    ),
    timedEntries: flowSummaries.reduce((sum, flow) => sum + flow.timedEntries, 0),
    missingDurations: flowSummaries.reduce((sum, flow) => sum + flow.missingDurations, 0),
    muAverageMs: flowSummaries[0]?.muAverageMs ?? 0,
  };
}

function buildTraceSummary(entries: TraceEntry[], responseTimeMs = 0, traceResponseMs: number | null = null): string {
  const visibleEntries = entries.filter((entry) => !isGrpcEntry(entry));

  if (!visibleEntries.length) return "Sin trazas encontradas";

  const summary = buildTraceFlowSummary(visibleEntries, 0, responseTimeMs, traceResponseMs);
  const lines: string[] = [];

  appendTraceSummaryHeader(lines, summary);
  appendTraceDetail(visibleEntries, lines);

  return lines.join("\n").trim();
}

function buildTraceSummaryByFlows(
  flows: TraceEntry[][],
  responseTimeMs = 0,
  traceResponseMs: number | null = null,
): string {
  const validFlows = flows
    .map((entries) => entries.filter((entry) => !isGrpcEntry(entry)))
    .filter((entries) => entries.length > 0);

  if (!validFlows.length) return "Sin trazas encontradas";

  if (validFlows.length === 1) {
    return buildTraceSummary(validFlows[0], responseTimeMs, traceResponseMs);
  }

  const flowSummaries = validFlows.map((entries, index) =>
    buildTraceFlowSummary(entries, index, responseTimeMs)
  );
  const combinedSummary = buildCombinedFlowSummary(flowSummaries);
  const lines: string[] = [];

  appendTraceSummaryHeader(lines, combinedSummary);

  flowSummaries.forEach((flow, index) => {
    if (index > 0) {
      lines.push("");
      lines.push("--------------------------");
      lines.push("");
    }

    lines.push(flow.label);
    lines.push("");
    appendTraceDetail(flow.entries, lines);
  });

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

  /*
   * IMPORTANTE: para una fila de Métricas AWS Monitoreo usamos UNA sola
   * ejecución/traceId representativa, la más cercana al tiempo de respuesta
   * de la transacción. Antes se podía recuperar una traza distinta por cada
   * library y luego sumar todas como si fueran una sola ejecución; eso hacía
   * que algunos tiempos se dispararan y dejaran de concordar con Atenea.
   */
  const candidates = await searchSpansByLibraries(
    filters,
    invokerTx,
    cleanHints,
    responseTimeMs
  );

  const hintSpan = getLimitedUniqueHintSpans(candidates)[0] ?? null;

  if (!hintSpan) {
    return [];
  }

  const trace = await traceLimiter(() =>
    fetchFullTraceByHintSpan({
      filters,
      invokerTx,
      hintSpan,
    })
  );

  return trace ? [trace] : [];
}

/**
 * Recuperación progresiva: Rho no garantiza que name, channel-code, site y
 * invokerTx existan en el MISMO span. Primero se buscan Transaction/Job y,
 * si hace falta, sus utilidades. El scope se verifica al descargar el trace.
 */
const DASHBOARD_RHO_BUDGET_MS = 48_000;
const DASHBOARD_RHO_SEARCH_TIMEOUT_MS = 5_500;
const DASHBOARD_RHO_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_RHO_TRACE_RESERVE_MS = 12_000;
const DASHBOARD_RHO_PAGE_SIZE = 100;
const dashboardTraceByTx = new Map<string, RawSpan>();
const dashboardPartialExpiry = new Map<string, number>();
const dashboardTraceFailures = new Map<string, number>();
const dashboardTracePending = new Map<string, Promise<DashboardRhoSnapshot>>();

export interface DashboardRhoSnapshot {
  trace: string;
  metadata: TraceSpanMetadata;
  channels: TraceChannelMetadata[];
  warning?: string;
}

type DashboardSearchPlan = {
  kind: "name" | "invokerTx" | "library";
  window: "recent" | "full" | "oldest" | "middle";
  scope: boolean;
  channel: boolean;
  library?: string;
  // La primera búsqueda de librería conserva invokerTx; el fallback final
  // permite que la propiedad no venga indexada en el span.
  requireInvokerTx?: boolean;
  libraryByProperty?: boolean;
};

function escapeRhoQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function dashboardSearchUrl(
  filters: MetricsFilters,
  invokerTx: string,
  fromDate: Date,
  toDate: Date,
  plan: DashboardSearchPlan,
): string {
  const { from, to } = dateRangeToNano(fromDate, toDate);
  const url = new URL(buildRhoSpanSearchUrl({
    baseSite: filters.site,
    fromDate: from,
    toDate: to,
    includeDuration: false,
  }));
  const safeTx = escapeRhoQueryValue(invokerTx.trim());
  const q: string[] = [];
  if (plan.kind === "name") q.push(`name == "${safeTx}"`);
  if (plan.kind === "invokerTx" || plan.requireInvokerTx) {
    q.push(`properties.invokerTx == "${safeTx}"`);
  }
  if (plan.kind === "library" && plan.library) {
    const library = escapeRhoQueryValue(plan.library);
    q.push(plan.libraryByProperty
      ? `properties.invokerLibrary == "${library}"`
      : `name == "*${library}*"`);
  }
  if (plan.scope) {
    const scope = buildRhoScopeFilter(filters);
    if (scope) q.push(scope);
  }
  if (plan.channel) {
    const channel = buildRhoChannelCodeFilter(getSelectedChannelCodes(filters));
    if (channel) q.push(channel);
  }
  url.searchParams.set("q", q.join(" and "));
  url.searchParams.set("sort", "descending");
  url.searchParams.set("size", String(DASHBOARD_RHO_PAGE_SIZE));
  return url.toString();
}

/** Algunas respuestas traen data[], otras data.items[] o spans[].
 * spanId es suficiente para llamar a :trace, aunque falte traceId.
 */
function readDashboardSearchSpans(response: unknown): RawSpan[] {
  const collected: RawSpan[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 7 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const row = value as Record<string, unknown>;
    const spanId = typeof row.spanId === "string" ? row.spanId.trim() : "";
    if (spanId) {
      if (!seen.has(spanId)) {
        seen.add(spanId);
        collected.push(row as RawSpan);
      }
      return;
    }
    for (const key of ["data", "spans", "items", "results", "content", "span", "root", "trace", "result"]) {
      if (key in row) visit(row[key], depth + 1);
    }
  };
  visit(response, 0);
  return collected;
}

type TraceContextCheck = { accepted: boolean; reason: string; unverified: string[] };

function matchesRhoTraceContext(
  trace: RawSpan,
  filters: MetricsFilters,
  invokerTx: string,
  hintSpan?: RawSpan,
): TraceContextCheck {
  const selectedCodes = getSelectedChannelCodes(filters).map(canonicalChannelCode);
  const expectedTx = invokerTx.trim().toUpperCase();
  const selectedEnv = normalizeRhoEnvironment(filters.environment);
  const selectedSite = String(filters.site ?? "").trim().toUpperCase();
  const channels = new Set<string>();
  const environments = new Set<string>();
  const sites = new Set<string>();
  const transactions = new Set<string>();
  const queue: RawSpan[] = [trace];
  const visited = new WeakSet<object>();
  let visitedCount = 0;
  while (queue.length && visitedCount < 20000) {
    const node = queue.pop();
    if (!node || typeof node !== "object" || visited.has(node)) continue;
    visited.add(node);
    visitedCount += 1;
    const props = node.properties ?? {};
    const name = String(node.name ?? "").trim().toUpperCase();
    const nodeTx = String(props.invokerTx ?? "").trim().toUpperCase();
    if (nodeTx) transactions.add(nodeTx);
    if (name === expectedTx || name.startsWith(`${expectedTx}-`)) transactions.add(expectedTx);
    const channel = canonicalChannelCode(props["channel-code"] ?? props.channelCode);
    if (channel) channels.add(channel);
    const env = normalizeRhoEnvironment(props.env);
    if (env) environments.add(env);
    const site = String(props.site ?? "").trim().toUpperCase();
    if (site) sites.add(site);
    if (Array.isArray(node.children)) queue.push(...node.children);
  }
  const hintTx = String(hintSpan?.properties?.invokerTx ?? "").trim().toUpperCase();
  const hintName = String(hintSpan?.name ?? "").trim().toUpperCase();
  const txMatches = transactions.has(expectedTx) || hintTx === expectedTx || hintName === expectedTx;
  if (!txMatches) return { accepted: false, reason: "El trace no identifica la transacción solicitada", unverified: [] };
  if (selectedCodes.length && channels.size && !selectedCodes.some((code) => channels.has(code))) {
    return { accepted: false, reason: `Canal distinto: ${[...channels].join(", ")}`, unverified: [] };
  }
  if (isWorkSite(filters.site) && selectedEnv && environments.size && !environments.has(selectedEnv)) {
    return { accepted: false, reason: `Entorno distinto: ${[...environments].join(", ")}`, unverified: [] };
  }
  // El host RHO identifica LIVE/WORK; properties.site es opcional en cada span.
  // Rechazar solo contradicciones explícitas, no valores ausentes.
  if (!isWorkSite(filters.site) && selectedSite && sites.size && !sites.has(selectedSite)) {
    return { accepted: false, reason: `Sitio distinto: ${[...sites].join(", ")}`, unverified: [] };
  }
  const unverified: string[] = [];
  if (selectedCodes.length && !channels.size) unverified.push("canal");
  if (isWorkSite(filters.site) && selectedEnv && !environments.size) unverified.push("entorno");
  if (!isWorkSite(filters.site) && selectedSite && !sites.size) unverified.push("sitio");
  return { accepted: true, reason: "", unverified };
}

function isRhoAuthenticationError(error: unknown): boolean {
  return /\bHTTP\s+(401|403)\b/i.test(String(error instanceof Error ? error.message : error));
}

async function recoverDashboardRhoSnapshot(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs: number | undefined,
  invokerLibraryHints: string[],
  cacheKey: string,
): Promise<DashboardRhoSnapshot> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), DASHBOARD_RHO_BUDGET_MS);
  const started = Date.now();
  const errors: string[] = [];
  const rejected: string[] = [];
  let completedSearches = 0;
  let candidatesFound = 0;
  let attemptsMade = 0;
  let truncatedByBudget = false;
  let partialSnapshot: DashboardRhoSnapshot | null = null;
  let partialTrace: RawSpan | null = null;
  try {
    const fromMs = filters.fromDate.getTime();
    const toMs = filters.toDate.getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new Error("Rango de fechas inválido para búsqueda Rho");
    }
    const dayMs = DASHBOARD_RHO_RECENT_WINDOW_MS;
    const spanMs = Math.max(1, toMs - fromMs);
    const mid = Math.round((fromMs + toMs) / 2);
    const windows = {
      full: { from: filters.fromDate, to: filters.toDate },
      recent: { from: new Date(Math.max(fromMs, toMs - dayMs)), to: filters.toDate },
      oldest: { from: filters.fromDate, to: new Date(Math.min(toMs, fromMs + dayMs)) },
      middle: { from: new Date(Math.max(fromMs, mid - dayMs / 2)), to: new Date(Math.min(toMs, mid + dayMs / 2)) },
    };
    const libraries = Array.from(new Set(invokerLibraryHints.map((v) => v.trim()).filter(Boolean))).slice(0, 3);
    // No exigir properties.site/env en el mismo span que el nombre o invokerTx.
    // El endpoint LIVE/WORK y el árbol recuperado permitirán validar contexto.
    const plans: DashboardSearchPlan[] = [
      { kind: "name", window: "full", scope: false, channel: false },
      { kind: "invokerTx", window: "full", scope: false, channel: true },
      { kind: "invokerTx", window: "full", scope: false, channel: false },
      { kind: "name", window: "recent", scope: false, channel: false },
      ...libraries.map((library): DashboardSearchPlan => ({
        kind: "library", library, libraryByProperty: true,
        window: "full", scope: false, channel: false,
      })),
      { kind: "invokerTx", window: "recent", scope: false, channel: false },
      { kind: "name", window: "oldest", scope: false, channel: false },
      { kind: "name", window: "middle", scope: false, channel: false },
      ...libraries.map((library): DashboardSearchPlan => ({
        kind: "library", library, window: "recent", scope: false, channel: false,
      })),
      { kind: "invokerTx", window: "oldest", scope: false, channel: false },
      { kind: "invokerTx", window: "middle", scope: false, channel: false },
      { kind: "name", window: "full", scope: true, channel: false },
    ];
    const visitedUrls = new Set<string>();
    const visitedSpanIds = new Set<string>();
    const headers = buildAuthHeaders(filters.bearerToken);
    for (const plan of plans) {
      if (controller.signal.aborted) break;
      const availableMs = DASHBOARD_RHO_BUDGET_MS - (Date.now() - started);
      if (availableMs <= DASHBOARD_RHO_TRACE_RESERVE_MS) {
        truncatedByBudget = true;
        break;
      }
      const window = windows[plan.window];
      const url = dashboardSearchUrl(filters, invokerTx, window.from, window.to, plan);
      if (visitedUrls.has(url)) continue;
      visitedUrls.add(url);
      attemptsMade += 1;
      let matches: RawSpan[];
      try {
        const response = await apiRequestWithRetry<SpansPaginatedResponse>(
          url,
          {
            headers,
            timeoutMs: Math.max(1_000, Math.min(DASHBOARD_RHO_SEARCH_TIMEOUT_MS, availableMs - DASHBOARD_RHO_TRACE_RESERVE_MS)),
            signal: controller.signal,
          },
          1,
        );
        completedSearches += 1;
        matches = readDashboardSearchSpans(response);
        candidatesFound += matches.length;
        console.info("[RHO Dashboard] Búsqueda respondida", {
          invokerTx, strategy: plan.kind, window: plan.window,
          channelFilter: plan.channel, scopeFilter: plan.scope,
          matches: matches.length, count: completedSearches,
        });
      } catch (error) {
        if (controller.signal.aborted || isRhoAuthenticationError(error)) throw error;
        errors.push(`búsqueda ${plan.kind}/${plan.window}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!matches.length) continue;
      const selectedChannels = getSelectedChannelCodes(filters).map(canonicalChannelCode);
      const ranked = sortSpansByDurationTarget(
        matches.filter((span) => String(span.spanId ?? "").trim() && !visitedSpanIds.has(String(span.spanId).trim())),
        responseTimeMs,
      ).sort((a, b) => {
        const rank = (span: RawSpan): number => {
          const channel = canonicalChannelCode(getSpanProperty(span, "channel-code") || getSpanProperty(span, "channelCode"));
          if (!selectedChannels.length) return 0;
          return !channel ? 1 : selectedChannels.includes(channel) ? 0 : 2;
        };
        return rank(a) - rank(b);
      });
      for (const hintSpan of ranked.slice(0, 6)) {
        if (controller.signal.aborted) break;
        const remainingMs = DASHBOARD_RHO_BUDGET_MS - (Date.now() - started);
        if (remainingMs < 3_000) { truncatedByBudget = true; break; }
        visitedSpanIds.add(String(hintSpan.spanId).trim());
        try {
          const trace = await fetchFullTraceByHintSpan({
            filters, invokerTx, hintSpan, signal: controller.signal, quick: true,
          });
          if (!trace) {
            rejected.push("La respuesta :trace no incluye un span válido");
            continue;
          }
          const context = matchesRhoTraceContext(trace, filters, invokerTx, hintSpan);
          if (!context.accepted) {
            rejected.push(context.reason);
            continue;
          }
          const snapshot = dashboardSnapshotFromTrace(trace, filters, invokerTx, responseTimeMs);
          const hasTransactionRoot = flattenSpans([trace]).some((span) => isTransactionSpan(span, invokerTx));
          if (!hasTransactionRoot || snapshot.warning) {
            // Hay evidencia de una ejecución, pero puede ser solo un subárbol.
            // Guardarla por si ninguna búsqueda entrega el árbol completo.
            if (!partialSnapshot) {
              partialTrace = trace;
              partialSnapshot = {
                ...snapshot,
                warning: snapshot.warning ?? "Rho devolvió un span de utilidad sin la raíz Transaction/Job.",
              };
            }
            continue;
          }
          putBoundedCache(dashboardTraceByTx, cacheKey, trace, 100);
          dashboardPartialExpiry.delete(cacheKey);
          dashboardTraceFailures.delete(cacheKey);
          if (context.unverified.length) {
            console.info("[RHO Dashboard] Metadatos no presentes en el árbol, pero sin contradicción", {
              invokerTx, missing: context.unverified,
            });
          }
          return snapshot;
        } catch (error) {
          if (controller.signal.aborted || isRhoAuthenticationError(error)) throw error;
          errors.push(`trace ${hintSpan.spanId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (partialSnapshot) {
      if (partialTrace) {
        putBoundedCache(dashboardTraceByTx, cacheKey, partialTrace, 100);
        putBoundedCache(dashboardPartialExpiry, cacheKey, Date.now() + 10_000, 100);
      }
      dashboardTraceFailures.delete(cacheKey);
      return partialSnapshot;
    }
    const state = controller.signal.aborted
      ? `tiempo límite de ${DASHBOARD_RHO_BUDGET_MS / 1000}s`
      : errors.length || truncatedByBudget
        ? "búsqueda incompleta por timeout/errores"
        : "búsqueda sin coincidencias verificables";
    const reason = [
      `${state}`,
      `${attemptsMade} estrategia(s) consultadas`,
      `${completedSearches} respuestas OK`,
      `${candidatesFound} spans recibidos`,
      `${rejected.length} trazas descartadas`,
      `${errors.length} errores`,
    ].join(" · ");
    console.warn("[RHO Dashboard] Diagnóstico de recuperación", {
      invokerTx, site: filters.site, environment: filters.environment,
      channelCodes: getSelectedChannelCodes(filters), reason,
      rejected: rejected.slice(0, 3), errors: errors.slice(0, 3),
    });
    putBoundedCache(dashboardTraceFailures, cacheKey, Date.now() + 4_000, 100);
    return {
      trace: `Trace no recuperada (RHO: ${reason}). No se descartan las métricas MU.`,
      metadata: {}, channels: [], warning: reason,
    };
  } catch (error) {
    if (partialSnapshot) {
      if (partialTrace) {
        putBoundedCache(dashboardTraceByTx, cacheKey, partialTrace, 100);
        putBoundedCache(dashboardPartialExpiry, cacheKey, Date.now() + 10_000, 100);
      }
      dashboardTraceFailures.delete(cacheKey);
      return partialSnapshot;
    }
    const reason = controller.signal.aborted
      ? `Rho superó ${DASHBOARD_RHO_BUDGET_MS / 1000}s para esta transacción`
      : error instanceof Error ? error.message : String(error);
    console.warn("[RHO Dashboard] Error de recuperación", { invokerTx, reason });
    putBoundedCache(dashboardTraceFailures, cacheKey, Date.now() + 4_000, 100);
    return {
      trace: `Trace no disponible (RHO: ${reason}). Las métricas MU se conservaron.`,
      metadata: {}, channels: [], warning: reason,
    };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

/** Una sola búsqueda por transacción/rango/canal, también entre filas concurrentes. */
export async function fetchDashboardRhoSnapshot(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHints: string[] = [],
): Promise<DashboardRhoSnapshot> {
  const cacheKey = getCacheScope(filters, invokerTx);
  const partialUntil = dashboardPartialExpiry.get(cacheKey);
  if (partialUntil && partialUntil <= Date.now()) {
    dashboardPartialExpiry.delete(cacheKey);
    dashboardTraceByTx.delete(cacheKey);
  }
  const cached = dashboardTraceByTx.get(cacheKey);
  if (cached) return dashboardSnapshotFromTrace(cached, filters, invokerTx, responseTimeMs);
  // No fusionar una búsqueda sin librerías con otra que sí tiene pistas:
  // la primera podría concluir sin activar los respaldos disponibles.
  const pendingKey = `${cacheKey}|${Array.from(new Set(invokerLibraryHints.map((hint) => hint.trim()).filter(Boolean))).sort().join(",")}`;
  const pending = dashboardTracePending.get(pendingKey);
  if (pending) return pending;
  const promise = recoverDashboardRhoSnapshot(filters, invokerTx, responseTimeMs, invokerLibraryHints, cacheKey);
  dashboardTracePending.set(pendingKey, promise);
  try {
    return await promise;
  } finally {
    dashboardTracePending.delete(pendingKey);
  }
}

function dashboardSnapshotFromTrace(
  trace: RawSpan,
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
): DashboardRhoSnapshot {
  const channels: TraceChannelMetadata[] = [];
  collectChannelMetadataFromTrace(trace, channels);
  const uniqueChannels = dedupeTraceChannels(channels);
  const selectedCodes = getSelectedChannelCodes(filters);
  const metadata = uniqueChannels.find((channel) =>
    Boolean(channel.channelCode && selectedCodes.map(canonicalChannelCode).includes(canonicalChannelCode(channel.channelCode)))
  ) ?? extractSpanMetadata(trace);
  const entries: TraceEntry[] = [];
  collectTraceEntries(trace, entries);
  const filtered = filterEntriesByChannel(dedupeTraceEntries(entries), selectedCodes);
  const traceDuration = readTraceTransactionDurationMs(trace, invokerTx, selectedCodes);
  if (!filtered.length) {
    return {
      trace: [
        "Traza RHO localizada, pero el endpoint :trace no devolvió utilidades clasificables.",
        `Tiempo de respuesta promedio (MU/InvokeTx): ${formatTraceDuration(responseTimeMs ?? null)}`,
        `Tiempo de respuesta de la traza (RHO): ${formatTraceDuration(traceDuration)}`,
        "Consultas JDBC SELECT (READ ONLY): N/D (árbol sin detalle de utilidades)",
      ].join("\n"),
      metadata,
      channels: uniqueChannels,
      warning: "RHO entregó el span principal sin sus utilidades; se conservó la traza como parcial.",
    };
  }
  return {
    trace: buildTraceSummary(filtered, responseTimeMs, traceDuration),
    metadata,
    channels: uniqueChannels,
  };
}

/**
 * El Dashboard selecciona una transacción y muestra su detalle sin repetir
 * las búsquedas amplias de librerías que podían tardar varios minutos.
 */
export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string,
  invokerLibraryHints?: string[]
): Promise<NormalizedSpan[]> {
  const cacheKey = getCacheScope(filters, invokerTx);
  if (!dashboardTraceByTx.has(cacheKey)) {
    if ((dashboardTraceFailures.get(cacheKey) ?? 0) > Date.now()) {
      return [];
    }
    // Si se elige una transacción aún no recuperada, aplicar el mismo camino
    // rápido y el mismo presupuesto de tiempo que al cargar las métricas MU.
    const hints = [invokerLibraryHint, ...(invokerLibraryHints ?? [])]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    await fetchDashboardRhoSnapshot(filters, invokerTx, responseTimeMs, hints);
  }

  const trace = dashboardTraceByTx.get(cacheKey);
  if (!trace) return [];

  const normalized = dedupeNormalizedSpans(normalizeSpans(trace));
  const selectedChannels = getSelectedChannelCodes(filters);
  if (!selectedChannels.length) return normalized;

  // El span Transaction puede tener canal y sus hijos Mongo/JDBC no. Al
  // mostrar solo los spans etiquetados desaparecían todas las utilidades.
  const compatible = normalized.filter((span) => {
    const channel = String(
      span.channelCode ?? span.properties?.["channel-code"] ?? span.properties?.channelCode ?? ""
    ).trim();
    return !channel || selectedChannels.map(canonicalChannelCode).includes(canonicalChannelCode(channel));
  });
  return compatible.length ? compatible : normalized;
}

/**
 * AWS Inform y Dashboard consultaban por caminos diferentes: el primero seguía
 * devolviendo "Sin trazas encontradas" por la búsqueda antigua. Centralizar
 * garantiza el mismo trace, canal y diagnóstico en ambos informes.
 */
export async function fetchTraceSummaryForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string,
  invokerLibraryHints?: string[]
): Promise<string> {
  const snapshot = await fetchDashboardRhoSnapshot(
    filters,
    invokerTx,
    responseTimeMs,
    [invokerLibraryHint, ...(invokerLibraryHints ?? [])]
      .map((hint) => String(hint ?? "").trim())
      .filter(Boolean),
  );
  return snapshot.trace;
}
