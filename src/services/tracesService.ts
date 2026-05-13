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
  const ut = span.properties?.utilitytype;
  if (ut) return String(ut);

  const name = String(span.name ?? "").toLowerCase();
  const dbQuery = String(span.properties?.databaseQuery ?? "").toLowerCase();
  const collection = String(span.properties?.collection ?? "").toLowerCase();

  if (name.includes("jdbc") || dbQuery) return "Jdbc";

  if (name.includes("mongo") || name.includes("daas") || collection) {
    return "DaasMongoConnector";
  }

  if (name.includes("cics") || name.includes("interbackend")) {
    return "InterBackendCics";
  }

  if (
    name.includes("apiinternalconnector") ||
    name.includes("api internal connector") ||
    name.includes("api-connector") ||
    name.includes("api connector")
  ) {
    return "APIInternalConnectorImpl";
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
  invokerTx: string;
  fromDate: string;
  toDate: string;
  site?: string;
  channelCodes?: string[];
  durationMs?: number;
}): string {
  const {
    invokerTx,
    fromDate,
    toDate,
    site,
    channelCodes = [],
    durationMs,
  } = params;

  const filters: string[] = [
    `name == "**"`,
    `properties.invokerTx == "${invokerTx}"`,
  ];

  if (site?.trim()) {
    filters.push(`properties.site == "${site.trim()}"`);
  }

  const channelFilter = buildRhoChannelCodeFilter(channelCodes);

  if (channelFilter) {
    filters.push(channelFilter);
  }

  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
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

async function searchBestSpanId(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number
): Promise<string | null> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);
  const channelCodes = getSelectedChannelCodes(filters);

  const targetDuration =
  typeof responseTimeMs === "number" && Number.isFinite(responseTimeMs) && responseTimeMs > 0
    ? Math.round(responseTimeMs)
    : undefined;

  const pickBestSpan = (items: RawSpan[]): RawSpan | undefined => {
    const validItems = items.filter(
      (span) =>
        typeof span.spanId === "string" && span.spanId.trim().length > 0
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
    useChannelFilter: boolean;
    useDurationFilter: boolean;
  }): Promise<string | null> => {
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
    });

    console.log("[RHO span search URL]", {
      invokerTx,
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
      console.log("[RHO selected span]", {
        invokerTx,
        targetDuration,
        selectedSpanId: best.spanId,
        selectedDuration: normalizeDuration(best),
        diff:
          targetDuration !== undefined
            ? Math.abs(normalizeDuration(best) - targetDuration)
            : undefined,
      });
    }

    return best?.spanId ?? null;
  };

  /**
   * Orden:
   * 1. canal + duration exacta
   * 2. canal sin duration, pero elige la duración más cercana
   * 3. duration exacta sin canal
   * 4. sin canal ni duration, pero elige la duración más cercana
   */
  if (channelCodes.length && targetDuration !== undefined) {
    const spanId = await search({
      useChannelFilter: true,
      useDurationFilter: true,
    });

    if (spanId) return spanId;
  }

  if (channelCodes.length) {
    const spanId = await search({
      useChannelFilter: true,
      useDurationFilter: false,
    });

    if (spanId) return spanId;
  }

  if (targetDuration !== undefined) {
    const spanId = await search({
      useChannelFilter: false,
      useDurationFilter: true,
    });

    if (spanId) return spanId;
  }

  return search({
    useChannelFilter: false,
    useDurationFilter: false,
  });
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

  // Si los nodos hijos no traen channel-code, no vaciamos la traza.
  // El spanId ya se intentó seleccionar por canal en /spans.
  return exactMatches.length ? exactMatches : entries;
}

function getEntryLabel(item: TraceEntry): string {
  return (
    item.invokedparam ||
    item.invokerLibrary ||
    item.name ||
    item.databaseQuery ||
    item.collection ||
    "-"
  );
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

    const label = getEntryLabel(item);
    const library = item.invokerLibrary || item.name || "InterBackendCics";

    lines.push(`${branch} ${label} (${formatTraceDuration(item.durationMs)})`);
    lines.push(`${secondBranch} InterBackendCics[${library}]`);
    lines.push(`${thirdBranch} ${library}`);
  });

  lines.push("");
}

function buildJdbcTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("JDBC");

  const byDatabase = groupBy(entries, (item) => {
    return item.databaseInstance || item.invokerLibrary || item.name || "JDBC";
  });

  Object.entries(byDatabase).forEach(([database, databaseEntries]) => {
    const avg = getAverageDuration(databaseEntries);

    lines.push(
      `└── ${database} (Tiempo promedio: ${formatTraceDuration(avg)})`
    );

    const byMethod = groupBy(databaseEntries, (item) => {
      return getSqlMethod(item.databaseQuery) || "SQL";
    });

    Object.entries(byMethod).forEach(([method, methodEntries]) => {
      lines.push(`    ├── ${method}: ${methodEntries.length} saltos`);

      methodEntries.forEach((item, index) => {
        const isLast = index === methodEntries.length - 1;
        const branch = isLast ? "    │   └──" : "    │   ├──";
        const label = getEntryLabel(item);

        lines.push(
          `${branch} Jdbc[${label}] (${formatTraceDuration(item.durationMs)})`
        );
        lines.push(`    │   │   └── ${label}`);
      });
    });

    lines.push("");
  });
}

function buildMongoTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("MONGO CONNECTOR");

  const byCollection = groupBy(entries, (item) => {
    return (
      item.collection ||
      item.databaseInstance ||
      item.invokerLibrary ||
      item.name ||
      "Mongo"
    );
  });

  Object.entries(byCollection).forEach(([collection, collectionEntries]) => {
    const avg = getAverageDuration(collectionEntries);

    lines.push(
      `└── ${collection} (Tiempo promedio: ${formatTraceDuration(avg)})`
    );

    const byOperation = groupBy(collectionEntries, (item) => {
      return getMongoOperation(item);
    });

    Object.entries(byOperation).forEach(([operation, operationEntries]) => {
      lines.push(`    ├── ${operation}: ${operationEntries.length} saltos`);

      operationEntries.forEach((item, index) => {
        const isLast = index === operationEntries.length - 1;
        const branch = isLast ? "    │   └──" : "    │   ├──";
        const label = getEntryLabel(item);

        lines.push(
          `${branch} DaasMongoConnector[${label}] (${formatTraceDuration(
            item.durationMs
          )})`
        );
        lines.push(`    │   │   └── ${label}`);
      });
    });

    lines.push("");
  });
}

function buildApiConnectorTreeSection(entries: TraceEntry[], lines: string[]) {
  if (!entries.length) return;

  lines.push("API-CONNECTOR");

  const avg = getAverageDuration(entries);

  lines.push(`└── Tiempo promedio sección: ${formatTraceDuration(avg)}`);

  entries.forEach((item, index) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "    └──" : "    ├──";
    const secondBranch = isLast ? "        └──" : "    │   └──";
    const thirdBranch = isLast ? "            └──" : "    │       └──";

    const label = getEntryLabel(item);
    const library =
      item.invokerLibrary || item.name || "APIInternalConnectorImpl";

    lines.push(`${branch} ${label} (${formatTraceDuration(item.durationMs)})`);
    lines.push(`${secondBranch} APIInternalConnectorImpl[${library}]`);
    lines.push(`${thirdBranch} ${library}`);
  });

  lines.push("");
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

    const label = getEntryLabel(item);
    const type = item.utilitytype || "UNKNOWN";
    const library = item.invokerLibrary || item.name || type;

    lines.push(`${branch} ${label} (${formatTraceDuration(item.durationMs)})`);
    lines.push(`${secondBranch} ${type}[${library}]`);
    lines.push(`${thirdBranch} ${library}`);
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

  const tr = Number.isFinite(responseTimeMs) ? Number(responseTimeMs) : 0;

  const tiempoTotalAws = Math.round(
    (tr + AWS_NETWORK_CONSTANT_MS) * totalSaltos
  );

  const lines: string[] = [];

  lines.push("=== RESUMEN DE SALTOS Y TIEMPOS DE RESPUESTA ===");
  lines.push(`Total de saltos encontrados: ${totalSaltos}`);
  lines.push(`Tiempo total de saltos: ${formatTraceDuration(tiempoTotalSaltos)}`);
  lines.push(`Tiempo total de  comunicación con AWS: ${tiempoTotalAws} ms`);
  lines.push("");
  lines.push("============================================================");
  lines.push("");
  lines.push("=== DETALLE DE TRAZAS ===");
  lines.push("");

  buildCicsTreeSection(
    entries.filter((e) => e.utilitytype === "InterBackendCics"),
    lines
  );

  buildJdbcTreeSection(
    entries.filter((e) => e.utilitytype === "Jdbc"),
    lines
  );

  buildMongoTreeSection(
    entries.filter((e) => e.utilitytype === "DaasMongoConnector"),
    lines
  );

  buildApiConnectorTreeSection(
    entries.filter((e) => e.utilitytype === "APIInternalConnectorImpl"),
    lines
  );

  const otherEntries = entries.filter(
    (e) =>
      ![
        "InterBackendCics",
        "Jdbc",
        "DaasMongoConnector",
        "APIInternalConnectorImpl",
      ].includes(e.utilitytype)
  );

  buildOtherTreeSection(otherEntries, lines);

  return lines.join("\n").trim();
}

export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string,
  responseTimeMs?: number
): Promise<NormalizedSpan[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const bestSpanId = await searchBestSpanId(
    filters,
    invokerTx,
    responseTimeMs
  );

  if (!bestSpanId) {
    console.warn(`[RHO] No se encontró spanId para invokerTx=${invokerTx}`);
    return [];
  }

  const url = buildRhoTraceUrl({
    spanId: bestSpanId,
    fromDate: from,
    toDate: to,
  });

  console.log("[RHO trace URL]", {
    invokerTx,
    responseTimeMs,
    spanId: bestSpanId,
    url,
  });

  const trace = await apiRequest<RawSpan>(url, { headers });
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
  responseTimeMs?: number
): Promise<string> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const bestSpanId = await searchBestSpanId(
    filters,
    invokerTx,
    responseTimeMs
  );

  if (!bestSpanId) {
    console.warn(
      `[RHO] No se encontró spanId para resumen invokerTx=${invokerTx}`
    );
    return "Sin trazas encontradas";
  }

  const url = buildRhoTraceUrl({
    spanId: bestSpanId,
    fromDate: from,
    toDate: to,
  });

  console.log("[RHO trace summary URL]", {
    invokerTx,
    responseTimeMs,
    spanId: bestSpanId,
    url,
  });

  const trace = await apiRequest<RawSpan>(url, { headers });
  const entries: TraceEntry[] = [];

  collectTraceEntries(trace, entries);

  const filteredEntries = filterEntriesByChannel(
    entries,
    getSelectedChannelCodes(filters)
  );

  return buildTraceSummary(filteredEntries, responseTimeMs);
}