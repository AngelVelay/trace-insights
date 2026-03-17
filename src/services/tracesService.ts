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
import { apiRequest, buildAuthHeaders } from "./httpClient";

const RHO_BASE = "https://rho.live-02.nextgen.igrupobbva";

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
  if (ut) return ut;

  const name = (span.name ?? "").toLowerCase();
  const dbQuery = (span.properties?.databaseQuery ?? "").toLowerCase();
  const collection = (span.properties?.collection ?? "").toLowerCase();

  if (name.includes("jdbc") || dbQuery) return "Jdbc";
  if (name.includes("mongo") || name.includes("daas") || collection) {
    return "DaasMongoConnector";
  }
  if (name.includes("cics") || name.includes("interbackend")) {
    return "InterBackendCics";
  }
  if (name.includes("apiinternalconnector")) {
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

function buildRhoSpanSearchUrl(params: {
  invokerTx: string;
  fromDate: string;
  toDate: string;
  site?: string;
}): string {
  const { invokerTx, fromDate, toDate, site } = params;

  const q = `name == "**" and properties.invokerTx == "${invokerTx}" and properties.site == "${site ?? ""}"`;

  const url = new URL("/v1/ns/apx.online/spans", RHO_BASE);
  url.searchParams.set("q", q);
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

type TraceEntry = {
  utilitytype: string;
  invokerLibrary: string;
  name: string;
  invokedparam: string;
  databaseQuery: string;
  databaseInstance: string;
  collection: string;
  durationMs: number;
};

function getSqlMethod(databaseQuery: string): string {
  const q = databaseQuery.trim();
  if (!q) return "";
  const first = q.split(/\s+/)[0].toUpperCase();
  return ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(first)
    ? first
    : "DESCONOCIDO";
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
  const invokerLibrary = properties.invokerLibrary ?? "";
  const invokedparam = properties.invokedparam ?? "";
  const databaseQuery = properties.databaseQuery ?? "";
  const databaseInstance = properties.databaseInstance ?? "";
  const collection = properties.collection ?? "";
  const name = node.name ?? "";

  if (
    utilitytype !== "UNKNOWN" &&
    (invokerLibrary || invokedparam || databaseQuery || collection || name)
  ) {
    out.push({
      utilitytype,
      invokerLibrary,
      name,
      invokedparam,
      databaseQuery,
      databaseInstance,
      collection,
      durationMs: normalizeDuration(node),
    });
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child) => collectTraceEntries(child, out));
  }
}

function buildTraceSummary(entries: TraceEntry[]): string {
  const totalResultados = entries.length;
  const tiempoTotalSaltos = entries.reduce((sum, item) => sum + item.durationMs, 0);

  if (!entries.length) return "-";

  const lines: string[] = [];
  lines.push("=== RESUMEN DE SALTOS Y TIEMPOS DE RESPUESTA ===");
  lines.push(`Total de saltos encontrados: ${totalResultados}`);
  lines.push(`Tiempo total de saltos: ${formatTraceDuration(tiempoTotalSaltos)}`);
  lines.push("============================================================");
  lines.push("");
  lines.push("=== DETALLE DE TRAZAS ===");
  lines.push("");

  const buildGroupedSection = (
    title: string,
    items: TraceEntry[],
    keyFn: (item: TraceEntry) => string,
    renderFn: (item: TraceEntry, count: number, avg: number) => string[]
  ) => {
    if (!items.length) return;

    lines.push(title);

    const avgSection =
      items.reduce((sum, item) => sum + item.durationMs, 0) / items.length;
    lines.push(`└── Tiempo promedio sección: ${formatTraceDuration(avgSection)}`);

    const grouped = new Map<
      string,
      { item: TraceEntry; count: number; total: number }
    >();

    for (const item of items) {
      const key = keyFn(item);
      const current = grouped.get(key) ?? { item, count: 0, total: 0 };
      current.count += 1;
      current.total += item.durationMs;
      grouped.set(key, current);
    }

    for (const { item, count, total } of grouped.values()) {
      const avg = total / count;
      lines.push(...renderFn(item, count, avg));
    }

    lines.push("");
  };

  buildGroupedSection(
    "API-CONNECTOR",
    entries.filter((e) => e.utilitytype === "APIInternalConnectorImpl"),
    (item) => `${item.invokerLibrary}|${item.name}|${item.invokedparam}`,
    (item, count, avg) => {
      const out = [
        `    ├── ${item.invokerLibrary || "(sin library)"} (${formatTraceDuration(avg)})`,
        `    │   └── ${item.name}`,
      ];
      if (item.invokedparam) out.push(`    │       └── ${item.invokedparam}`);
      if (count > 1) out.push(`    │       └── Repeticiones: ${count}`);
      return out;
    }
  );

  buildGroupedSection(
    "CICS",
    entries.filter((e) => e.utilitytype === "InterBackendCics"),
    (item) => `${item.invokerLibrary}|${item.name}|${item.invokedparam}`,
    (item, count, avg) => {
      const out = [
        `    ├── ${item.invokerLibrary || "(sin library)"} (${formatTraceDuration(avg)})`,
        `    │   └── ${item.name}`,
      ];
      if (item.invokedparam) out.push(`    │       └── ${item.invokedparam}`);
      if (count > 1) out.push(`    │       └── Repeticiones: ${count}`);
      return out;
    }
  );

  const jdbcEntries = entries.filter((e) => e.utilitytype === "Jdbc");
  if (jdbcEntries.length) {
    lines.push("JDBC");

    const byLibrary = new Map<string, TraceEntry[]>();
    for (const item of jdbcEntries) {
      const key = item.invokerLibrary || "(sin library)";
      const arr = byLibrary.get(key) ?? [];
      arr.push(item);
      byLibrary.set(key, arr);
    }

    for (const [lib, items] of byLibrary.entries()) {
      const avg =
        items.reduce((sum, item) => sum + item.durationMs, 0) / items.length;

      lines.push(`└── ${lib} (Tiempo promedio: ${formatTraceDuration(avg)})`);

      const methods = new Map<string, TraceEntry[]>();
      for (const item of items) {
        const method = getSqlMethod(item.databaseQuery) || "DESCONOCIDO";
        const arr = methods.get(method) ?? [];
        arr.push(item);
        methods.set(method, arr);
      }

      for (const [method, methodItems] of methods.entries()) {
        lines.push(`    ├── ${method}: ${methodItems.length} saltos`);
        for (const item of methodItems) {
          lines.push(
            `    │   ├── ${item.name} (${formatTraceDuration(item.durationMs)})`
          );
          if (item.invokedparam) {
            lines.push(`    │   │   └── ${item.invokedparam}`);
          }
        }
      }

      lines.push("");
    }
  }

  buildGroupedSection(
    "MONGO CONNECTOR",
    entries.filter((e) => e.utilitytype === "DaasMongoConnector"),
    (item) =>
      `${item.invokerLibrary}|${item.databaseInstance}|${item.collection}|${item.invokedparam}`,
    (item, count, avg) => {
      const dbCol = `${item.databaseInstance || ""}${
        item.databaseInstance || item.collection ? " - " : ""
      }${item.collection || ""}`.trim();

      const out = [
        `    ├── ${item.invokerLibrary || "(sin library)"} (${formatTraceDuration(avg)})`,
      ];
      if (dbCol) out.push(`    │   ├── ${dbCol}`);
      if (item.invokedparam) out.push(`    │   └── ${item.invokedparam}`);
      if (count > 1) out.push(`    │       └── Repeticiones: ${count}`);
      return out;
    }
  );

  return lines.join("\n").trim();
}

async function searchBestSpanId(
  filters: MetricsFilters,
  invokerTx: string
): Promise<string | null> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const url = buildRhoSpanSearchUrl({
    invokerTx,
    fromDate: from,
    toDate: to,
    site: filters.site,
  });

  const res = await apiRequest<SpansPaginatedResponse>(url, { headers });
  const items = Array.isArray(res.data) ? res.data : [];

  if (!items.length) return null;

  const best = items
    .filter((span) => typeof span.spanId === "string" && span.spanId.trim().length > 0)
    .sort((a, b) => normalizeDuration(b) - normalizeDuration(a))[0];

  return best?.spanId ?? null;
}

export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string
): Promise<NormalizedSpan[]> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const bestSpanId = await searchBestSpanId(filters, invokerTx);
  if (!bestSpanId) return [];

  const url = buildRhoTraceUrl({
    spanId: bestSpanId,
    fromDate: from,
    toDate: to,
  });

  const trace = await apiRequest<RawSpan>(url, { headers });
  return normalizeSpans(trace);
}

export async function fetchTraceSummaryForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string
): Promise<string> {
  const { from, to } = dateRangeToNano(filters.fromDate, filters.toDate);
  const headers = buildAuthHeaders(filters.bearerToken);

  const bestSpanId = await searchBestSpanId(filters, invokerTx);
  if (!bestSpanId) return "-";

  const url = buildRhoTraceUrl({
    spanId: bestSpanId,
    fromDate: from,
    toDate: to,
  });

  const trace = await apiRequest<RawSpan>(url, { headers });
  const entries: TraceEntry[] = [];
  collectTraceEntries(trace, entries);

  return buildTraceSummary(entries);
}