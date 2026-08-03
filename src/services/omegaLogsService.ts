import { buildAuthHeaders } from "./httpClient";
import { dateRangeToNano } from "./dateUtils";

export type OmegaSort = "ascending" | "descending";
export type OmegaLogRecord = Record<string, unknown>;

export interface OmegaLogsProgress {
  page: number;
  pageRecords: number;
  totalRecords: number;
  hasNextPage: boolean;
  elapsedMs: number;
}

export interface FetchAllOmegaLogsParams {
  namespace?: string;
  query: string;
  sort?: OmegaSort;
  profile?: string;
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
  pageSize?: number;
  maxPages?: number;
  maxRecords?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: OmegaLogsProgress) => void;
}

export interface FetchAllOmegaLogsResult {
  rows: OmegaLogRecord[];
  columns: string[];
  pages: number;
  totalRecords: number;
  elapsedMs: number;
  stoppedByLimit: boolean;
  repeatedPaginationKey: boolean;
  lastPaginationKey: string;
}

const OMEGA_LIVE_ORIGIN = "https://omega.live-02.nextgen.igrupobbva";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 1000;
const DEFAULT_MAX_RECORDS = 100000;
const DEFAULT_TIMEOUT_MS = 30000;

const PRIORITY_COLUMNS = [
  "recordDateFormatted",
  "recordDate",
  "timestamp",
  "namespace",
  "level",
  "message",
  "spanId",
  "traceId",
  "mrId",
  "name",
  "properties.site",
  "properties.env",
  "properties.hostname",
  "properties.applicationUUAA",
  "properties.aap",
  "properties.channel-code",
  "properties.channelCode",
  "properties.invokerTx",
  "properties.invokerLibrary",
  "properties.invokedparam",
];

function buildOmegaEndpoint(namespace: string): URL {
  const path = `/v1/ns/${encodeURIComponent(namespace)}/logs`;

  if (import.meta.env.DEV && typeof window !== "undefined") {
    return new URL(`/omega-live-02${path}`, window.location.origin);
  }

  return new URL(path, OMEGA_LIVE_ORIGIN);
}

function buildInitialUrl(params: {
  namespace: string;
  query: string;
  sort: OmegaSort;
  profile: string;
  fromTimestamp: string;
  toTimestamp: string;
  pageSize: number;
}): string {
  const {
    namespace,
    query,
    sort,
    profile,
    fromTimestamp,
    toTimestamp,
    pageSize,
  } = params;

  const url = buildOmegaEndpoint(namespace);

  if (query.trim()) {
    url.searchParams.set("q", query.trim());
  }

  url.searchParams.set("sort", sort);
  url.searchParams.set("profile", profile || "default");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("size", String(pageSize));

  return url.toString();
}

function buildPaginationUrl(namespace: string, paginationKey: string): string {
  const url = buildOmegaEndpoint(namespace);

  // El paginationKey de Omega encapsula la consulta, el orden, las fechas y el
  // tamaño de página. Por eso las páginas siguientes se solicitan únicamente
  // con el token, como en la URL generada por Atenea/Omega.
  url.searchParams.set("paginationKey", paginationKey);

  return url.toString();
}

function extractArray(value: unknown): OmegaLogRecord[] | null {
  if (!Array.isArray(value)) return null;

  return value.filter(
    (item): item is OmegaLogRecord =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
}

function extractRows(payload: unknown): OmegaLogRecord[] {
  const direct = extractArray(payload);
  if (direct) return direct;

  if (!payload || typeof payload !== "object") return [];

  const root = payload as Record<string, unknown>;
  const candidates = [
    root.data,
    root.items,
    root.logs,
    root.spans,
    root.results,
    root.content,
    root.records,
    root.documents,
  ];

  for (const candidate of candidates) {
    const found = extractArray(candidate);
    if (found) return found;
  }

  if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
    const nested = root.data as Record<string, unknown>;
    const nestedCandidates = [
      nested.data,
      nested.items,
      nested.logs,
      nested.spans,
      nested.results,
      nested.content,
      nested.records,
    ];

    for (const candidate of nestedCandidates) {
      const found = extractArray(candidate);
      if (found) return found;
    }
  }

  return [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tokenFromUrl(value: string): string {
  if (!value) return "";

  try {
    const url = new URL(value, OMEGA_LIVE_ORIGIN);
    return (
      url.searchParams.get("nextPaginationKey") ||
      url.searchParams.get("paginationKey") ||
      ""
    );
  } catch {
    return "";
  }
}

function normalizedMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizePaginationToken(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return "";

  const token = tokenFromUrl(raw) || raw;

  try {
    return decodeURIComponent(token).trim();
  } catch {
    return token.trim();
  }
}

function paginationTokensAreEqual(left: string, right: string): boolean {
  if (!left || !right) return false;
  return normalizePaginationToken(left) === normalizePaginationToken(right);
}

type PaginationCandidate = {
  token: string;
  priority: number;
  source: string;
};

function extractPaginationKeyFromPayload(
  payload: unknown,
  currentPaginationKey = ""
): string {
  const candidates: PaginationCandidate[] = [];
  const visited = new WeakSet<object>();

  const nextTokenKeys = new Set([
    "nextpaginationkey",
    "nextpagekey",
    "nextkey",
    "nexttoken",
    "continuationtoken",
    "nextcursor",
    "nextpagelink",
  ]);

  const nextLinkKeys = new Set([
    "next",
    "nextpage",
    "nextlink",
  ]);

  const genericTokenKeys = new Set([
    "paginationkey",
    "pagelink",
    "cursor",
  ]);

  const addCandidate = (
    value: unknown,
    priority: number,
    source: string
  ): void => {
    const token = normalizePaginationToken(value);
    if (!token) return;
    if (paginationTokensAreEqual(token, currentPaginationKey)) return;

    candidates.push({ token, priority, source });
  };

  const visit = (value: unknown, depth = 0, parentKey = ""): void => {
    if (depth > 14 || value === null || typeof value === "undefined") return;

    if (typeof value === "string") {
      if (/paginationKey=/i.test(value)) {
        addCandidate(value, parentKey.includes("next") ? 85 : 45, parentKey);
      }
      return;
    }

    if (typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1, parentKey));
      return;
    }

    const record = value as Record<string, unknown>;

    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = normalizedMetadataKey(key);

      if (nextTokenKeys.has(normalizedKey)) {
        addCandidate(child, 100, key);
      } else if (nextLinkKeys.has(normalizedKey)) {
        if (typeof child === "string") {
          addCandidate(child, 90, key);
        }
      } else if (genericTokenKeys.has(normalizedKey)) {
        addCandidate(child, 40, key);
      } else if (
        ["href", "url", "link"].includes(normalizedKey) &&
        parentKey.includes("next")
      ) {
        addCandidate(child, 88, `${parentKey}.${key}`);
      }
    }

    for (const [key, child] of Object.entries(record)) {
      visit(child, depth + 1, normalizedMetadataKey(key));
    }
  };

  visit(payload);

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0]?.token ?? "";
}

function extractPaginationKeyFromHeaders(
  headers: Headers,
  currentPaginationKey = ""
): string {
  const candidates: PaginationCandidate[] = [];

  const addCandidate = (
    value: string | null,
    priority: number,
    source: string
  ): void => {
    const token = normalizePaginationToken(value);
    if (!token) return;
    if (paginationTokensAreEqual(token, currentPaginationKey)) return;
    candidates.push({ token, priority, source });
  };

  const preferredHeaders: Array<[string, number]> = [
    ["x-next-pagination-key", 100],
    ["next-pagination-key", 100],
    ["x-next-page-key", 98],
    ["x-next-page-link", 95],
    ["next-page-link", 95],
    ["x-continuation-token", 92],
    ["continuation-token", 92],
    ["x-pagination-key", 45],
    ["pagination-key", 45],
    ["x-page-link", 42],
    ["page-link", 42],
  ];

  for (const [name, priority] of preferredHeaders) {
    addCandidate(headers.get(name), priority, name);
  }

  const linkHeader = headers.get("link");
  if (linkHeader) {
    const nextMatch = linkHeader.match(
      /<([^>]+)>\s*;\s*rel=["']?next["']?/i
    );
    if (nextMatch?.[1]) addCandidate(nextMatch[1], 97, "link-next");
  }

  for (const [name, rawValue] of headers.entries()) {
    const normalizedName = normalizedMetadataKey(name);

    if (
      !normalizedName.includes("pagination") &&
      !normalizedName.includes("pagelink") &&
      !normalizedName.includes("continuation") &&
      normalizedName !== "link"
    ) {
      continue;
    }

    const priority = normalizedName.includes("next") ? 90 : 35;
    addCandidate(rawValue, priority, name);
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates[0]?.token ?? "";
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[,._\s]/g, "");
    if (/^\d+$/.test(normalized)) return Number(normalized);
  }

  return 0;
}

function extractTotalCountFromPayload(payload: unknown): number {
  const preferredKeys = new Set([
    "total",
    "totalcount",
    "totalrecords",
    "totalitems",
    "totaldocuments",
    "totalhits",
    "resultcount",
    "documentscount",
    "recordscount",
  ]);
  const visited = new WeakSet<object>();
  let best = 0;

  const visit = (value: unknown, depth: number): void => {
    if (depth > 10 || value === null || typeof value !== "object") return;
    if (visited.has(value as object)) return;
    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      const normalizedKey = normalizedMetadataKey(key);
      if (preferredKeys.has(normalizedKey)) {
        if (normalizedKey === "totalhits" && child && typeof child === "object") {
          best = Math.max(best, parsePositiveInteger((child as Record<string, unknown>).value));
        } else {
          best = Math.max(best, parsePositiveInteger(child));
        }
      }
      visit(child, depth + 1);
    }
  };

  visit(payload, 0);
  return best;
}

function extractTotalCountFromHeaders(headers: Headers): number {
  const names = [
    "x-total-count",
    "total-count",
    "x-total-records",
    "total-records",
    "x-result-count",
    "result-count",
    "x-total-hits",
  ];

  for (const name of names) {
    const parsed = parsePositiveInteger(headers.get(name));
    if (parsed) return parsed;
  }

  return 0;
}

async function fetchOmegaPage(params: {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
  currentPaginationKey?: string;
  signal?: AbortSignal;
}): Promise<{
  payload: unknown;
  rows: OmegaLogRecord[];
  paginationKey: string;
}> {
  const {
    url,
    bearerToken,
    timeoutMs,
    currentPaginationKey = "",
    signal,
  } = params;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildAuthHeaders(bearerToken),
      signal: controller.signal,
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} - ${bodyText.slice(0, 500)}`
      );
    }

    let payload: unknown = {};

    if (bodyText.trim()) {
      try {
        payload = JSON.parse(bodyText) as unknown;
      } catch {
        throw new Error(
          `Omega respondió contenido no JSON: ${bodyText.slice(0, 500)}`
        );
      }
    }

    const rows = extractRows(payload);
    const paginationKey =
      extractPaginationKeyFromPayload(payload, currentPaginationKey) ||
      extractPaginationKeyFromHeaders(response.headers, currentPaginationKey);

    return { payload, rows, paginationKey };
  } catch (error) {
    if (controller.signal.aborted) {
      if (signal?.aborted) {
        throw new DOMException("Consulta cancelada por el usuario", "AbortError");
      }

      throw new Error(`Timeout consultando Omega (${timeoutMs} ms)`);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function flattenLogRecord(
  value: unknown,
  prefix = "",
  target: Record<string, string | number | boolean | null> = {}
): Record<string, string | number | boolean | null> {
  if (value === null || typeof value === "undefined") {
    if (prefix) target[prefix] = null;
    return target;
  }

  if (Array.isArray(value)) {
    if (prefix) target[prefix] = JSON.stringify(value);
    return target;
  }

  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenLogRecord(child, nextPrefix, target);
    }
    return target;
  }

  if (prefix) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      target[prefix] = value;
    } else {
      target[prefix] = String(value);
    }
  }

  return target;
}

function nanoToIso(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!/^\d{13,19}$/.test(raw)) return "";

  const millis = Number(raw.slice(0, 13));
  if (!Number.isFinite(millis)) return "";

  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function flattenOmegaLog(
  row: OmegaLogRecord
): Record<string, string | number | boolean | null> {
  const flattened = flattenLogRecord(row);
  const recordDateFormatted = nanoToIso(
    flattened.recordDate ?? flattened.timestamp
  );

  if (recordDateFormatted) {
    return {
      recordDateFormatted,
      ...flattened,
    };
  }

  return flattened;
}

export function collectOmegaColumns(rows: OmegaLogRecord[]): string[] {
  const keys = new Set<string>();

  for (const row of rows) {
    Object.keys(flattenOmegaLog(row)).forEach((key) => keys.add(key));
  }

  const priority = PRIORITY_COLUMNS.filter((key) => keys.delete(key));
  const remaining = [...keys].sort((a, b) => a.localeCompare(b));

  return [...priority, ...remaining];
}

function csvCell(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";

  const text = String(value).replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

export function omegaLogsToCsv(
  rows: OmegaLogRecord[],
  columns = collectOmegaColumns(rows)
): string {
  const flattenedRows = rows.map(flattenOmegaLog);
  const header = columns.map(csvCell).join(",");
  const body = flattenedRows.map((row) =>
    columns.map((column) => csvCell(row[column])).join(",")
  );

  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadOmegaCsv(rows: OmegaLogRecord[], filename: string): void {
  downloadTextFile(
    omegaLogsToCsv(rows),
    filename,
    "text/csv;charset=utf-8"
  );
}

export async function fetchAllOmegaLogs(
  params: FetchAllOmegaLogsParams
): Promise<FetchAllOmegaLogsResult> {
  const {
    namespace = "apx.online",
    query,
    sort = "descending",
    profile = "default",
    fromDate,
    toDate,
    bearerToken,
    pageSize = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    maxRecords = DEFAULT_MAX_RECORDS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    onProgress,
  } = params;

  if (!(fromDate instanceof Date) || Number.isNaN(fromDate.getTime())) {
    throw new Error("La fecha inicial no es válida.");
  }

  if (!(toDate instanceof Date) || Number.isNaN(toDate.getTime())) {
    throw new Error("La fecha final no es válida.");
  }

  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
  }

  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  const normalizedMaxPages = Math.max(1, Math.floor(maxPages));
  const normalizedMaxRecords = Math.max(1, Math.floor(maxRecords));

  const { from, to } = dateRangeToNano(fromDate, toDate);
  const startedAt = performance.now();
  const rows: OmegaLogRecord[] = [];
  const seenPaginationKeys = new Set<string>();

  let nextUrl = buildInitialUrl({
    namespace,
    query,
    sort,
    profile,
    fromTimestamp: String(from),
    toTimestamp: String(to),
    pageSize: normalizedPageSize,
  });

  let pages = 0;
  let stoppedByLimit = false;
  let repeatedPaginationKey = false;
  let lastPaginationKey = "";
  let currentPaginationKey = "";

  while (nextUrl && pages < normalizedMaxPages) {
    if (signal?.aborted) {
      throw new DOMException("Consulta cancelada por el usuario", "AbortError");
    }

    const pageResult = await fetchOmegaPage({
      url: nextUrl,
      bearerToken,
      timeoutMs,
      currentPaginationKey,
      signal,
    });

    pages += 1;

    const available = normalizedMaxRecords - rows.length;
    if (pageResult.rows.length > available) {
      rows.push(...pageResult.rows.slice(0, available));
      stoppedByLimit = true;
    } else {
      rows.push(...pageResult.rows);
    }

    const paginationKey = pageResult.paginationKey.trim();
    const hasNextPage = Boolean(paginationKey) && !stoppedByLimit;

    onProgress?.({
      page: pages,
      pageRecords: pageResult.rows.length,
      totalRecords: rows.length,
      hasNextPage,
      elapsedMs: Math.round(performance.now() - startedAt),
    });

    if (stoppedByLimit) break;
    if (!paginationKey) break;

    if (seenPaginationKeys.has(paginationKey)) {
      repeatedPaginationKey = true;
      lastPaginationKey = paginationKey;
      break;
    }

    seenPaginationKeys.add(paginationKey);
    currentPaginationKey = paginationKey;
    lastPaginationKey = paginationKey;
    nextUrl = buildPaginationUrl(namespace, paginationKey);
  }

  if (pages >= normalizedMaxPages && lastPaginationKey) {
    stoppedByLimit = true;
  }

  return {
    rows,
    columns: collectOmegaColumns(rows),
    pages,
    totalRecords: rows.length,
    elapsedMs: Math.round(performance.now() - startedAt),
    stoppedByLimit,
    repeatedPaginationKey,
    lastPaginationKey,
  };
}

// -----------------------------------------------------------------------------
// RHO · Recuperación de spans con returncode y enriquecimiento por traza
// -----------------------------------------------------------------------------

export type RhoSpanRecord = Record<string, unknown>;

export interface RhoTraceTableRow {
  spanId: string;
  traceId: string;
  trxName: string;
  executionTimestamp: string;
  executionDateTimeCdmx: string;
  applicationUUAA: string;
  consumerRequestId: string;
  architectureWarnings: string;
  returncode: string;
  environment: string;
  channelCode: string;
  productCode: string;
  status: "OK" | "ERROR";
  error: string;
  sourceSpan: RhoSpanRecord;
  tracePayload: unknown;
}

export interface RhoTraceProgress {
  phase: "spans" | "traces";
  pages: number;
  spansFound: number;
  uniqueSpanIds: number;
  totalAvailable: number;
  tracesProcessed: number;
  successfulTraces: number;
  failedTraces: number;
  elapsedMs: number;
}

export interface FetchRhoTraceTableParams {
  namespace?: string;
  transactionName: string;
  returncode?: string;
  sort?: OmegaSort;
  profile?: string;
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
  pageSize?: number;
  maxPages?: number;
  maxSpans?: number;
  concurrency?: number;
  timeoutMs?: number;
  crossRegion?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: RhoTraceProgress) => void;
}

export interface FetchRhoTraceTableResult {
  rows: RhoTraceTableRow[];
  spanPages: number;
  spansFound: number;
  uniqueSpanIds: number;
  totalAvailable: number;
  tracesProcessed: number;
  successfulTraces: number;
  failedTraces: number;
  elapsedMs: number;
  stoppedByLimit: boolean;
  repeatedPaginationKey: boolean;
  paginationIncomplete: boolean;
}

const RHO_LIVE_ORIGIN = "https://rho.live-02.nextgen.igrupobbva";
const RHO_PROPERTIES = [
  "channel-code",
  "environ-code",
  "env",
  "product-code",
  "returncode",
].join(",");

function buildRhoUrl(path: string): URL {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return new URL(`/rho-live-02${path}`, window.location.origin);
  }

  return new URL(path, RHO_LIVE_ORIGIN);
}

function buildRhoSpansInitialUrl(params: {
  namespace: string;
  transactionName: string;
  returncode: string;
  sort: OmegaSort;
  fromTimestamp: string;
  toTimestamp: string;
  profile: string;
  pageSize: number;
}): string {
  const url = buildRhoUrl(
    `/v1/ns/${encodeURIComponent(params.namespace)}/spans`
  );

  const escapedName = params.transactionName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedReturncode = params.returncode.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  url.searchParams.set(
    "q",
    `name == "${escapedName}" and properties.returncode == "${escapedReturncode}"`
  );
  url.searchParams.set("sort", params.sort);
  url.searchParams.set("fromDate", params.fromTimestamp);
  url.searchParams.set("toDate", params.toTimestamp);
  url.searchParams.set("properties", RHO_PROPERTIES);
  url.searchParams.set("profile", params.profile || "default");
  url.searchParams.set("size", String(params.pageSize));

  return url.toString();
}

function buildRhoSpansPaginationUrl(
  namespace: string,
  paginationKey: string
): string {
  const url = buildRhoUrl(
    `/v1/ns/${encodeURIComponent(namespace)}/spans`
  );
  url.searchParams.set("paginationKey", paginationKey);
  return url.toString();
}

function buildRhoTraceUrl(params: {
  namespace: string;
  spanId: string;
  fromTimestamp: string;
  toTimestamp: string;
  profile: string;
  crossRegion: boolean;
}): string {
  const url = buildRhoUrl(
    `/v1/ns/${encodeURIComponent(params.namespace)}/mrs/RhoTraces/spans/${encodeURIComponent(params.spanId)}:trace`
  );

  url.searchParams.set("fromDate", params.fromTimestamp);
  url.searchParams.set("toDate", params.toTimestamp);
  url.searchParams.set("profile", params.profile || "default");
  url.searchParams.set("crossRegion", String(params.crossRegion));

  return url.toString();
}

async function fetchJsonRequest(params: {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  serviceName: string;
}): Promise<{ payload: unknown; headers: Headers }> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), params.timeoutMs);
  const abortFromParent = () => controller.abort();
  params.signal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const response = await fetch(params.url, {
      method: "GET",
      headers: buildAuthHeaders(params.bearerToken),
      signal: controller.signal,
    });

    const bodyText = await response.text();

    if (!response.ok) {
      throw new Error(
        `${params.serviceName}: HTTP ${response.status} ${response.statusText} - ${bodyText.slice(0, 500)}`
      );
    }

    if (!bodyText.trim()) {
      return { payload: {}, headers: response.headers };
    }

    try {
      return {
        payload: JSON.parse(bodyText) as unknown,
        headers: response.headers,
      };
    } catch {
      throw new Error(
        `${params.serviceName} respondió contenido no JSON: ${bodyText.slice(0, 500)}`
      );
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (params.signal?.aborted) {
        throw new DOMException("Consulta cancelada por el usuario", "AbortError");
      }

      throw new Error(
        `Timeout consultando ${params.serviceName} (${params.timeoutMs} ms)`
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    params.signal?.removeEventListener("abort", abortFromParent);
  }
}

function normalizeLookupKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueToReadableString(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectValuesByKeys(
  value: unknown,
  normalizedKeys: Set<string>,
  output: string[] = [],
  visited = new WeakSet<object>()
): string[] {
  if (value === null || typeof value !== "object") return output;

  if (visited.has(value as object)) return output;
  visited.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) {
      collectValuesByKeys(item, normalizedKeys, output, visited);
    }
    return output;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (normalizedKeys.has(normalizeLookupKey(key))) {
      const readable = valueToReadableString(child);
      if (readable) output.push(readable);
    }

    collectValuesByKeys(child, normalizedKeys, output, visited);
  }

  return output;
}

function uniqueReadableValues(
  payload: unknown,
  keys: string[]
): string[] {
  const normalizedKeys = new Set(keys.map(normalizeLookupKey));
  return Array.from(
    new Set(
      collectValuesByKeys(payload, normalizedKeys)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function firstReadableValue(payload: unknown, keys: string[]): string {
  return uniqueReadableValues(payload, keys)[0] ?? "";
}

function getNestedValue(
  object: Record<string, unknown>,
  path: string
): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, object);
}

function firstPathValue(
  object: Record<string, unknown>,
  paths: string[]
): string {
  for (const path of paths) {
    const readable = valueToReadableString(getNestedValue(object, path));
    if (readable) return readable;
  }

  return "";
}

function extractSpanId(span: RhoSpanRecord): string {
  return firstPathValue(span, [
    "spanId",
    "spanID",
    "id",
    "properties.spanId",
    "properties.spanID",
  ]);
}

function extractTraceId(span: RhoSpanRecord): string {
  return firstPathValue(span, [
    "traceId",
    "traceID",
    "properties.traceId",
    "properties.traceID",
  ]);
}

const CDMX_TIME_ZONE = "America/Mexico_City";

function timestampValueToDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const absolute = Math.abs(value);
    let millis = value;

    if (absolute >= 1e17) millis = value / 1e6;
    else if (absolute >= 1e14) millis = value / 1e3;
    else if (absolute < 1e11) millis = value * 1000;

    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const unsigned = raw.replace(/^-/, "").split(".")[0];
    let millis: number;

    // Los timestamps de RHO suelen venir en nanosegundos. Se toman los
    // primeros 13 dígitos para evitar perder precisión al convertir a Number.
    if (unsigned.length >= 17) {
      const sign = raw.startsWith("-") ? -1 : 1;
      millis = sign * Number(unsigned.slice(0, 13));
    } else if (unsigned.length >= 14) {
      millis = Number(raw) / 1000;
    } else if (unsigned.length >= 12) {
      millis = Number(raw);
    } else {
      millis = Number(raw) * 1000;
    }

    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTimeCdmx(date: Date): string {
  const dateLabel = new Intl.DateTimeFormat("es-MX", {
    timeZone: CDMX_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(date)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  const timeParts = new Intl.DateTimeFormat("es-MX", {
    timeZone: CDMX_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const part = (type: string): string =>
    timeParts.find((item) => item.type === type)?.value ?? "";

  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, "0");
  const timeLabel = `${part("hour")}:${part("minute")}:${part("second")}.${milliseconds}`;

  return `${dateLabel} · ${timeLabel}`;
}

function extractExecutionDateTime(
  sourceSpan: RhoSpanRecord,
  tracePayload: unknown
): { executionTimestamp: string; executionDateTimeCdmx: string } {
  const sourceTimestamp = firstPathValue(sourceSpan, [
    "recordDate",
    "recordTimestamp",
    "timestamp",
    "startTime",
    "startDate",
    "startTimestamp",
    "startTimeUnixNano",
    "startTimeUnixNanoString",
    "time",
    "eventTime",
    "properties.recordDate",
    "properties.recordTimestamp",
    "properties.timestamp",
    "properties.startTime",
    "properties.startDate",
    "properties.startTimestamp",
    "properties.startTimeUnixNano",
    "properties.time",
    "properties.eventTime",
  ]);

  const traceTimestamp = sourceTimestamp
    ? ""
    : firstReadableValue(tracePayload, [
        "recordDate",
        "recordTimestamp",
        "timestamp",
        "startTime",
        "startDate",
        "startTimestamp",
        "startTimeUnixNano",
        "eventTime",
      ]);

  const rawTimestamp = sourceTimestamp || traceTimestamp;
  const date = timestampValueToDate(rawTimestamp);

  if (!date) {
    return {
      executionTimestamp: rawTimestamp,
      executionDateTimeCdmx: "",
    };
  }

  return {
    executionTimestamp: date.toISOString(),
    executionDateTimeCdmx: formatDateTimeCdmx(date),
  };
}

function buildRhoTraceTableRow(params: {
  sourceSpan: RhoSpanRecord;
  tracePayload: unknown;
  fallbackTransactionName: string;
}): RhoTraceTableRow {
  const { sourceSpan, tracePayload, fallbackTransactionName } = params;

  const trxName =
    firstPathValue(sourceSpan, [
      "name",
      "transactionName",
      "trxName",
      "properties.transactionName",
      "properties.trxName",
    ]) ||
    firstReadableValue(tracePayload, ["transactionName", "trxName"]) ||
    fallbackTransactionName;

  const applicationUUAA =
    firstReadableValue(tracePayload, ["applicationUUAA", "applicationUuaa"]) ||
    firstPathValue(sourceSpan, [
      "applicationUUAA",
      "properties.applicationUUAA",
      "properties.applicationUuaa",
    ]);

  const consumerRequestId =
    firstReadableValue(tracePayload, [
      "consumerRequestId",
      "consumer-request-id",
    ]) ||
    firstPathValue(sourceSpan, [
      "consumerRequestId",
      "properties.consumerRequestId",
      "properties.consumer-request-id",
    ]);

  const architectureWarningsValues = uniqueReadableValues(tracePayload, [
    "architectureWarnings",
    "architectureWarning",
    "architecture-warnings",
  ]);

  const architectureWarnings = architectureWarningsValues.join(" | ");
  const executionDateTime = extractExecutionDateTime(sourceSpan, tracePayload);

  return {
    spanId: extractSpanId(sourceSpan),
    traceId: extractTraceId(sourceSpan),
    trxName,
    executionTimestamp: executionDateTime.executionTimestamp,
    executionDateTimeCdmx: executionDateTime.executionDateTimeCdmx,
    applicationUUAA,
    consumerRequestId,
    architectureWarnings,
    returncode: firstPathValue(sourceSpan, [
      "returncode",
      "properties.returncode",
    ]),
    environment: firstPathValue(sourceSpan, [
      "env",
      "properties.env",
      "environ-code",
      "properties.environ-code",
    ]),
    channelCode: firstPathValue(sourceSpan, [
      "channel-code",
      "properties.channel-code",
      "channelCode",
      "properties.channelCode",
    ]),
    productCode: firstPathValue(sourceSpan, [
      "product-code",
      "properties.product-code",
      "productCode",
      "properties.productCode",
    ]),
    status: "OK",
    error: "",
    sourceSpan,
    tracePayload,
  };
}

function failedRhoTraceTableRow(
  sourceSpan: RhoSpanRecord,
  fallbackTransactionName: string,
  error: unknown
): RhoTraceTableRow {
  const executionDateTime = extractExecutionDateTime(sourceSpan, null);

  return {
    spanId: extractSpanId(sourceSpan),
    traceId: extractTraceId(sourceSpan),
    trxName:
      firstPathValue(sourceSpan, ["name", "transactionName", "trxName"]) ||
      fallbackTransactionName,
    executionTimestamp: executionDateTime.executionTimestamp,
    executionDateTimeCdmx: executionDateTime.executionDateTimeCdmx,
    applicationUUAA: firstPathValue(sourceSpan, [
      "applicationUUAA",
      "properties.applicationUUAA",
    ]),
    consumerRequestId: firstPathValue(sourceSpan, [
      "consumerRequestId",
      "properties.consumerRequestId",
    ]),
    architectureWarnings: "",
    returncode: firstPathValue(sourceSpan, [
      "returncode",
      "properties.returncode",
    ]),
    environment: firstPathValue(sourceSpan, ["env", "properties.env"]),
    channelCode: firstPathValue(sourceSpan, [
      "channel-code",
      "properties.channel-code",
    ]),
    productCode: firstPathValue(sourceSpan, [
      "product-code",
      "properties.product-code",
    ]),
    status: "ERROR",
    error: error instanceof Error ? error.message : String(error),
    sourceSpan,
    tracePayload: null,
  };
}

async function fetchAllRhoSpans(params: {
  namespace: string;
  transactionName: string;
  returncode: string;
  sort: OmegaSort;
  profile: string;
  fromTimestamp: string;
  toTimestamp: string;
  bearerToken?: string;
  pageSize: number;
  maxPages: number;
  maxSpans: number;
  timeoutMs: number;
  signal?: AbortSignal;
  startedAt: number;
  onProgress?: (progress: RhoTraceProgress) => void;
}): Promise<{
  spans: RhoSpanRecord[];
  pages: number;
  totalAvailable: number;
  uniqueSpanIds: number;
  stoppedByLimit: boolean;
  repeatedPaginationKey: boolean;
  paginationIncomplete: boolean;
}> {
  // Se conservan TODOS los registros devueltos por RHO. No se eliminan filas
  // por spanId, porque el usuario necesita que la tabla refleje el total real.
  const spans: RhoSpanRecord[] = [];
  const seenPaginationKeys = new Set<string>();
  const uniqueSpanIds = new Set<string>();

  let pages = 0;
  let totalAvailable = 0;
  let stoppedByLimit = false;
  let repeatedPaginationKey = false;
  let paginationIncomplete = false;
  let lastPageHadRows = false;
  let currentPaginationKey = "";
  let nextUrl = buildRhoSpansInitialUrl({
    namespace: params.namespace,
    transactionName: params.transactionName,
    returncode: params.returncode,
    sort: params.sort,
    fromTimestamp: params.fromTimestamp,
    toTimestamp: params.toTimestamp,
    profile: params.profile,
    pageSize: params.pageSize,
  });

  while (nextUrl && pages < params.maxPages) {
    if (params.signal?.aborted) {
      throw new DOMException("Consulta cancelada por el usuario", "AbortError");
    }

    const response = await fetchJsonRequest({
      url: nextUrl,
      bearerToken: params.bearerToken,
      timeoutMs: params.timeoutMs,
      signal: params.signal,
      serviceName: "RHO spans",
    });

    pages += 1;
    const pageRows = extractRows(response.payload);
    lastPageHadRows = pageRows.length > 0;
    totalAvailable = Math.max(
      totalAvailable,
      extractTotalCountFromPayload(response.payload),
      extractTotalCountFromHeaders(response.headers)
    );

    for (const row of pageRows) {
      const spanId = extractSpanId(row);
      if (spanId) uniqueSpanIds.add(spanId);

      spans.push(row);
      if (spans.length >= params.maxSpans) {
        stoppedByLimit = true;
        break;
      }
    }

    const paginationKey = (
      extractPaginationKeyFromPayload(
        response.payload,
        currentPaginationKey
      ) ||
      extractPaginationKeyFromHeaders(
        response.headers,
        currentPaginationKey
      )
    ).trim();

    params.onProgress?.({
      phase: "spans",
      pages,
      spansFound: spans.length,
      uniqueSpanIds: uniqueSpanIds.size,
      totalAvailable: totalAvailable || spans.length,
      tracesProcessed: 0,
      successfulTraces: 0,
      failedTraces: 0,
      elapsedMs: Math.round(performance.now() - params.startedAt),
    });

    if (stoppedByLimit) break;

    if (!paginationKey) {
      // Nunca se reporta silenciosamente una sola página como resultado total.
      // Si RHO informa un total mayor, se marca como paginación incompleta.
      if (totalAvailable > spans.length) paginationIncomplete = true;
      break;
    }

    if (seenPaginationKeys.has(paginationKey)) {
      repeatedPaginationKey = true;
      break;
    }

    seenPaginationKeys.add(paginationKey);
    currentPaginationKey = paginationKey;
    nextUrl = buildRhoSpansPaginationUrl(params.namespace, paginationKey);
  }

  if (pages >= params.maxPages && nextUrl && lastPageHadRows) {
    stoppedByLimit = true;
  }

  if (!totalAvailable) totalAvailable = spans.length;

  return {
    spans,
    pages,
    totalAvailable,
    uniqueSpanIds: uniqueSpanIds.size,
    stoppedByLimit,
    repeatedPaginationKey,
    paginationIncomplete,
  };
}

export function rhoTraceRowsToCsv(rows: RhoTraceTableRow[]): string {
  const columns: Array<keyof RhoTraceTableRow> = [
    "spanId",
    "traceId",
    "trxName",
    "executionDateTimeCdmx",
    "executionTimestamp",
    "applicationUUAA",
    "consumerRequestId",
    "architectureWarnings",
    "returncode",
    "environment",
    "channelCode",
    "productCode",
    "status",
    "error",
  ];

  const header = columns.map(csvCell).join(",");
  const body = rows.map((row) =>
    columns.map((column) => csvCell(row[column])).join(",")
  );

  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

export function downloadRhoTraceCsv(
  rows: RhoTraceTableRow[],
  filename: string
): void {
  downloadTextFile(
    rhoTraceRowsToCsv(rows),
    filename,
    "text/csv;charset=utf-8"
  );
}

export async function fetchRhoTraceTable(
  params: FetchRhoTraceTableParams
): Promise<FetchRhoTraceTableResult> {
  const {
    namespace = "apx.online",
    transactionName,
    returncode = "12",
    sort = "ascending",
    profile = "default",
    fromDate,
    toDate,
    bearerToken,
    pageSize = 100,
    maxPages = 1000,
    maxSpans = 100000,
    concurrency = 5,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    crossRegion = false,
    signal,
    onProgress,
  } = params;

  if (!transactionName.trim()) {
    throw new Error("Indica el nombre de la TRX antes de consultar RHO.");
  }

  if (!(fromDate instanceof Date) || Number.isNaN(fromDate.getTime())) {
    throw new Error("La fecha inicial no es válida.");
  }

  if (!(toDate instanceof Date) || Number.isNaN(toDate.getTime())) {
    throw new Error("La fecha final no es válida.");
  }

  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
  }

  const normalizedPageSize = Math.max(1, Math.floor(pageSize));
  const normalizedMaxPages = Math.max(1, Math.floor(maxPages));
  const normalizedMaxSpans = Math.max(1, Math.floor(maxSpans));
  const normalizedConcurrency = Math.min(12, Math.max(1, Math.floor(concurrency)));
  const { from, to } = dateRangeToNano(fromDate, toDate);
  const fromTimestamp = String(from);
  const toTimestamp = String(to);
  const startedAt = performance.now();

  const spanResult = await fetchAllRhoSpans({
    namespace,
    transactionName: transactionName.trim(),
    returncode: returncode.trim() || "12",
    sort,
    profile,
    fromTimestamp,
    toTimestamp,
    bearerToken,
    pageSize: normalizedPageSize,
    maxPages: normalizedMaxPages,
    maxSpans: normalizedMaxSpans,
    timeoutMs,
    signal,
    startedAt,
    onProgress,
  });

  const rows = new Array<RhoTraceTableRow>(spanResult.spans.length);
  // Si RHO devuelve el mismo spanId más de una vez, se conserva cada fila,
  // pero la traza se solicita una sola vez y se reutiliza.
  const traceRequestCache = new Map<string, Promise<unknown>>();
  let cursor = 0;
  let tracesProcessed = 0;
  let successfulTraces = 0;
  let failedTraces = 0;

  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Consulta cancelada por el usuario", "AbortError");
      }

      const index = cursor;
      cursor += 1;
      if (index >= spanResult.spans.length) return;

      const sourceSpan = spanResult.spans[index];
      const spanId = extractSpanId(sourceSpan);

      if (!spanId) {
        rows[index] = failedRhoTraceTableRow(
          sourceSpan,
          transactionName.trim(),
          new Error("El registro no contiene spanId.")
        );
        tracesProcessed += 1;
        failedTraces += 1;
      } else {
        try {
          let tracePromise = traceRequestCache.get(spanId);
          if (!tracePromise) {
            tracePromise = fetchJsonRequest({
              url: buildRhoTraceUrl({
                namespace,
                spanId,
                fromTimestamp,
                toTimestamp,
                profile,
                crossRegion,
              }),
              bearerToken,
              timeoutMs,
              signal,
              serviceName: `RHO trace ${spanId}`,
            }).then((response) => response.payload);
            traceRequestCache.set(spanId, tracePromise);
          }

          const tracePayload = await tracePromise;
          rows[index] = buildRhoTraceTableRow({
            sourceSpan,
            tracePayload,
            fallbackTransactionName: transactionName.trim(),
          });
          tracesProcessed += 1;
          successfulTraces += 1;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }

          rows[index] = failedRhoTraceTableRow(
            sourceSpan,
            transactionName.trim(),
            error
          );
          tracesProcessed += 1;
          failedTraces += 1;
        }
      }

      onProgress?.({
        phase: "traces",
        pages: spanResult.pages,
        spansFound: spanResult.spans.length,
        uniqueSpanIds: spanResult.uniqueSpanIds,
        totalAvailable: spanResult.totalAvailable,
        tracesProcessed,
        successfulTraces,
        failedTraces,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(normalizedConcurrency, Math.max(1, spanResult.spans.length)) },
      () => worker()
    )
  );

  return {
    rows: rows.filter(Boolean),
    spanPages: spanResult.pages,
    spansFound: spanResult.spans.length,
    uniqueSpanIds: spanResult.uniqueSpanIds,
    totalAvailable: spanResult.totalAvailable,
    tracesProcessed,
    successfulTraces,
    failedTraces,
    elapsedMs: Math.round(performance.now() - startedAt),
    stoppedByLimit: spanResult.stoppedByLimit,
    repeatedPaginationKey: spanResult.repeatedPaginationKey,
    paginationIncomplete: spanResult.paginationIncomplete,
  };
}