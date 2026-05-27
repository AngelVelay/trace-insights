import type {
  RawSpan,
  NormalizedSpan,
  SpansPaginatedResponse,
  ClassifiedTraces,
  MetricsFilters,
} from "@/types/bbva";
import { dateRangeToNano } from "./dateUtils";
import { apiRequest, buildAuthHeaders } from "./httpClient";

const RHO_BASE = "https://rho.live-02.nextgen.igrupobbva";
const AWS_NETWORK_CONSTANT_MS = 89;

type TraceEntry = {
  utilitytype: string;
  invokerLibrary: string;
  name: string;
  invokedparam: string;
  databaseQuery: string;
  databaseInstance: string;
  collection: string;
  durationMs: number;
  channelCode: string;
};

type SpanWithParent = RawSpan & {
  parentSpanId?: string;
  parentId?: string;
};

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
  } = params;

  const cleanInvokerLibraryHint = String(invokerLibraryHint ?? "").trim();

  const filters: string[] = [];

  if (cleanInvokerLibraryHint) {
    filters.push(`name == "*${cleanInvokerLibraryHint}*"`);
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

  const pickBestSpan = (items: RawSpan[]): RawSpan | undefined => {
    const validItems = items.filter(
      (span) =>
        typeof span.spanId === "string" &&
        span.spanId.trim().length > 0 &&
        typeof span.traceId === "string" &&
        span.traceId.trim().length > 0
    );

    if (!validItems.length) return undefined;

    if (targetDuration !== undefined) {
      return validItems.sort((a, b) => {
        const diffA = Math.abs(normalizeDuration(a) - targetDuration);
        const diffB = Math.abs(normalizeDuration(b) - targetDuration);

        if (diffA !== diffB) return diffA - diffB;

        return normalizeDuration(b) - normalizeDuration(a);
      })[0];
    }

    return validItems.sort(
      (a, b) => normalizeDuration(b) - normalizeDuration(a)
    )[0];
  };

  const search = async (params: {
    useLibraryHint: boolean;
    useChannelFilter: boolean;
    useDurationFilter: boolean;
  }): Promise<RawSpan | null> => {
    const url = buildRhoSpanSearchUrl({
      invokerTx,
      fromDate: from,
      toDate: to,
      site: filters.site,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      durationMs:
        params.useDurationFilter && targetDuration !== undefined
          ? targetDuration
          : undefined,
      invokerLibraryHint: params.useLibraryHint
        ? invokerLibraryHint
        : undefined,
    });

    console.log("[RHO span search URL]", {
      invokerTx,
      invokerLibraryHint: params.useLibraryHint
        ? invokerLibraryHint
        : undefined,
      channelCodes: params.useChannelFilter ? channelCodes : [],
      targetDuration,
      useDurationFilter: params.useDurationFilter,
      url,
    });

    const res = await apiRequest<SpansPaginatedResponse>(url, { headers });
    const items = Array.isArray(res.data) ? res.data : [];

    if (!items.length) return null;

    const best = pickBestSpan(items);

    if (best) {
      console.log("[RHO selected child/hint span]", {
        invokerTx,
        invokerLibraryHint,
        targetDuration,
        selectedSpanId: best.spanId,
        selectedTraceId: best.traceId,
        selectedDuration: normalizeDuration(best),
        diff:
          targetDuration !== undefined
            ? Math.abs(normalizeDuration(best) - targetDuration)
            : undefined,
      });
    }

    return best ?? null;
  };

  const attempts = [
    {
      useLibraryHint: Boolean(invokerLibraryHint),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: Boolean(invokerLibraryHint),
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: false,
    },
    {
      useLibraryHint: false,
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: false,
      useChannelFilter: channelCodes.length > 0,
      useDurationFilter: false,
    },
    {
      useLibraryHint: false,
      useChannelFilter: false,
      useDurationFilter: targetDuration !== undefined,
    },
    {
      useLibraryHint: false,
      useChannelFilter: false,
      useDurationFilter: false,
    },
  ];

  for (const attempt of attempts) {
    const span = await search(attempt);

    if (span) return span;
  }

  return null;
}

async function searchRootSpanIdByTraceId(params: {
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
    fromDate: from,
    toDate: to,
    site: filters.site,
  });

  console.log("[RHO root span search URL]", {
    invokerTx,
    traceId,
    fallbackSpanId,
    url,
  });

  try {
    const res = await apiRequest<SpansPaginatedResponse>(url, { headers });
    const items = Array.isArray(res.data) ? (res.data as SpanWithParent[]) : [];

    if (!items.length) {
      return fallbackSpanId;
    }

    const root =
      items.find((span) => {
        const parentSpanId = String(
          span.parentSpanId ?? span.parentId ?? ""
        ).trim();

        return !parentSpanId;
      }) ?? items.sort((a, b) => normalizeDuration(b) - normalizeDuration(a))[0];

    const rootSpanId = String(root?.spanId ?? "").trim();

    console.log("[RHO selected root span]", {
      invokerTx,
      traceId,
      rootSpanId,
      rootDuration: root ? normalizeDuration(root) : undefined,
      fallbackSpanId,
    });

    return rootSpanId || fallbackSpanId;
  } catch (error) {
    console.warn("[RHO] Error buscando root span, usando fallback", {
      invokerTx,
      traceId,
      fallbackSpanId,
      error,
    });

    return fallbackSpanId;
  }
}

function getSqlMethod(databaseQuery: string): string {
  const q = databaseQuery.trim();

  if (!q) return "";

  const first = q.split(/\s+/)[0].toUpperCase();

  return ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(first)
    ? first
    : "DESCONOCIDO";
}

function getMongoOperation(item: TraceEntry): string {
  const source = `${item.invokedparam} ${item.name}`.toUpperCase();

  if (source.includes("FIND")) return "FIND";
  if (source.includes("INSERT")) return "INSERT";
  if (source.includes("UPDATE")) return "UPDATE";
  if (source.includes("DELETE")) return "DELETE";
  if (source.includes("AGGREGATE")) return "AGGREGATE";

  return item.invokedparam || item.name || "OPERACION";
}

function formatTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0.00ms";
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
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
      invokerLibrary,
      name,
      invokedparam,
      databaseQuery,
      databaseInstance,
      collection,
      durationMs,
      channelCode,
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

function getEntryLabel(item: TraceEntry): string {
  return getEntryInvokedParam(item) || getEntryLibrary(item) || "-";
}

function getEntryDatabaseOrCollection(item: TraceEntry): string {
  return String(
    item.databaseInstance || item.collection || item.databaseQuery || ""
  ).trim();
}

function getAverageDuration(entries: TraceEntry[]): number {
  if (!entries.length) return 0;

  return (
    entries.reduce((sum, item) => sum + Number(item.durationMs ?? 0), 0) /
    entries.length
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

  const avg = getAverageDuration(entries);

  lines.push(`└── Tiempo promedio sección: ${formatTraceDuration(avg)}`);

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

  const byLibrary = groupBy(entries, (item) => {
    return getEntryLibrary(item);
  });

  Object.entries(byLibrary).forEach(([library, libraryEntries]) => {
    const avg = getAverageDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo promedio: ${formatTraceDuration(avg)})`);

    const byMethod = groupBy(libraryEntries, (item) => {
      return getSqlMethod(item.databaseQuery) || "DESCONOCIDO";
    });

    Object.entries(byMethod).forEach(([method, methodEntries]) => {
      lines.push(`    ├── ${method}: ${methodEntries.length} saltos`);

      methodEntries.forEach((item, index) => {
        const isLast = index === methodEntries.length - 1;
        const branch = isLast ? "    │   └──" : "    │   ├──";

        const invokedParam = getEntryInvokedParam(item);
        const database = getEntryDatabaseOrCollection(item);

        lines.push(
          `${branch} Jdbc[${invokedParam}] (${formatTraceDuration(
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
    const avg = getAverageDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo promedio: ${formatTraceDuration(avg)})`);

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

  const avg = getAverageDuration(entries);

  lines.push(`└── Tiempo promedio sección: ${formatTraceDuration(avg)}`);

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

  const avg = getAverageDuration(entries);

  lines.push(`└── Tiempo promedio sección: ${formatTraceDuration(avg)}`);

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
    const avg = getAverageDuration(libraryEntries);

    lines.push(`└── ${library} (Tiempo promedio: ${formatTraceDuration(avg)})`);

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

  const avg = getAverageDuration(entries);

  lines.push(`└── Tiempo promedio sección: ${formatTraceDuration(avg)}`);

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

function buildTraceSummary(entries: TraceEntry[], responseTimeMs = 0): string {
  if (!entries.length) return "Sin trazas encontradas";

  const totalSaltos = entries.length;

  const tiempoTotalSaltos = entries.reduce(
    (sum, item) => sum + Number(item.durationMs ?? 0),
    0
  );

  const tr =
    Number.isFinite(responseTimeMs) && responseTimeMs > 0
      ? Number(responseTimeMs)
      : 0;

  const totalTiempoEsperadoAws =
    (tr + AWS_NETWORK_CONSTANT_MS) * totalSaltos;

  const lines: string[] = [];

  lines.push("RESUMEN DE SALTOS Y TIEMPOS DE RESPUESTA");
  lines.push(`Total de saltos encontrados: ${totalSaltos}`);
  lines.push(`Tiempo total de saltos: ${formatTraceDuration(tiempoTotalSaltos)}`);
  lines.push(
    `Total de Tiempo Esperado en AWS: ${formatTraceDuration(
      totalTiempoEsperadoAws
    )}`
  );
  lines.push("");
  lines.push("============================================================");
  lines.push("");
  lines.push("=== DETALLE DE TRAZAS ===");
  lines.push("");

  const cicsEntries = entries.filter(
    (entry) => entry.utilitytype === "InterBackendCics"
  );

  const jdbcEntries = entries.filter((entry) => entry.utilitytype === "Jdbc");

  const jpaEntries = entries.filter((entry) => entry.utilitytype === "Jpa");

  const mongoEntries = entries.filter(
    (entry) => entry.utilitytype === "DaasMongoConnector"
  );

  const apiInternalEntries = entries.filter(
    (entry) => entry.utilitytype === "APIInternalConnectorImpl"
  );

  const apiExternalEntries = entries.filter(
    (entry) => entry.utilitytype === "APIExternalConnectorImpl"
  );

  const titanEntries = entries.filter(
    (entry) => entry.utilitytype === "TitanClient"
  );

  const grpcEntries = entries.filter(
    (entry) => entry.utilitytype === "GRPCClient"
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

  const otherEntries = entries.filter(
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

  buildGenericClientTreeSection(
    "GRPC CLIENT",
    "GRPCClient",
    grpcEntries,
    lines
  );

  buildOtherTreeSection(otherEntries, lines);

  return lines.join("\n").trim();
}

export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string
): Promise<NormalizedSpan[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

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

  const traceId = String(hintSpan.traceId ?? "").trim();
  const hintSpanId = String(hintSpan.spanId ?? "").trim();

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

  console.log("[RHO full trace URL]", {
    invokerTx,
    responseTimeMs,
    invokerLibraryHint,
    hintSpanId,
    traceId,
    rootSpanId,
    url,
  });

  const trace = await apiRequest<RawSpan>(url, {
    headers: buildAuthHeaders(filters.bearerToken),
  });

  const normalized = normalizeSpans(trace);

  const channelCodes = getSelectedChannelCodes(filters);

  if (!channelCodes.length) {
    return normalized;
  }

  const exactMatches = normalized.filter((span) => {
    const channelCode =
      String(span.channelCode ?? "").trim() ||
      String(span.properties?.["channel-code"] ?? "").trim() ||
      String(span.properties?.channelCode ?? "").trim();

    return channelCodes.includes(channelCode);
  });

  return exactMatches.length ? exactMatches : normalized;
}

export async function fetchTraceSummaryForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number,
  invokerLibraryHint?: string
): Promise<string> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);

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

  const traceId = String(hintSpan.traceId ?? "").trim();
  const hintSpanId = String(hintSpan.spanId ?? "").trim();

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

  console.log("[RHO full trace summary URL]", {
    invokerTx,
    invokerLibraryHint,
    responseTimeMs,
    hintSpanId,
    traceId,
    rootSpanId,
    url,
  });

  const trace = await apiRequest<RawSpan>(url, {
    headers: buildAuthHeaders(filters.bearerToken),
  });

  const entries: TraceEntry[] = [];

  collectTraceEntries(trace, entries);

  const filteredEntries = filterEntriesByChannel(
    entries,
    getSelectedChannelCodes(filters)
  );

  return buildTraceSummary(filteredEntries, responseTimeMs);
}