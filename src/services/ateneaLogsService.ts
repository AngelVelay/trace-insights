import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "@/services/httpClient";
import { dateRangeToNano } from "@/services/dateUtils";

const OMEGA_WORK_BASE = "https://omega.work-02.nextgen.igrupobbva";
const RHO_WORK_BASE = "https://rho.work-02.nextgen.igrupobbva";
const OMEGA_LIVE_BASE = "https://omega.live-02.nextgen.igrupobbva";
const RHO_LIVE_BASE = "https://rho.live-02.nextgen.igrupobbva";

const RHO_CONCURRENCY = 6;
const OMEGA_MAX_RETRIES = 5;
const OMEGA_RETRY_BASE_MS = 900;
const PARTIAL_RHO_UPDATE_EVERY = 100;

export type AteneaLogsEnvironment = "DEV" | "INT" | "AUS" | "OCT" | "PRO";
export type AteneaLogsNamespace = "apx.batch" | "apx.online";
export type AteneaExitCodeFilter = "ALL" | string;

export interface OmegaLogItem {
  recordDate?: number | string;
  creationDate?: number | string;
  namespace?: string;
  level?: string;
  message?: string;
  mrId?: string;
  spanId?: string;
  traceId?: string;
  properties?: {
    block?: string;
    env?: string;
    hostname?: string;
    nameLog?: string;
    readerProvider?: string;
    site?: string;
    thread?: string;
    typeLog?: string;
    typology?: string;
    [key: string]: unknown;
  };
}

interface OmegaPaginationLinks {
  first?: string;
  next?: string;
  previous?: string;
  prev?: string;
  last?: string;
}

interface OmegaPagination {
  totalElements?: number;
  links?: OmegaPaginationLinks;
}

interface OmegaLogsResponse {
  data?: OmegaLogItem[];
  items?: OmegaLogItem[];
  results?: OmegaLogItem[];
  pagination?: OmegaPagination;
}

export interface RhoSpanItem {
  namespace?: string;
  recordDate?: number | string;
  duration?: number;
  finishDate?: number | string;
  mrId?: string;
  name?: string;
  parentSpan?: string;
  spanId?: string;
  startDate?: number | string;
  traceId?: string;
  _region?: string;
  properties?: {
    applicationUUAA?: string;
    env?: string;
    exitCode?: string;
    readerProvider?: string;
    type?: string;
    [key: string]: unknown;
  };
}

interface RhoSpansResponse {
  data?: RhoSpanItem[];
  items?: RhoSpanItem[];
  results?: RhoSpanItem[];
}

export interface AteneaLogRow {
  id: string;
  trxJobType: string;
  name: string;
  applicationUUAA: string;
  message: string;
  date: string;
  recordDate: number | string | undefined;
  spanId: string;
  traceId: string;
  env: string;
  exitCode: string;
  level: string;
  namespace: AteneaLogsNamespace;
  enrichmentError?: string;
}

export interface AteneaLogsSearchParams {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  messageRegex: string;
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
  onProgress?: (progress: AteneaLogsProgress) => void;
  onPartialResult?: (result: AteneaLogsSearchResult) => void;
}

export interface AteneaLogsProgress {
  phase: "omega" | "rho";
  completed: number;
  total: number;
  message: string;
}

export interface AteneaLogsSearchResult {
  rows: AteneaLogRow[];
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  messageRegex: string;
  fromDate: Date;
  toDate: Date;
  omegaLogsRead: number;
  omegaPagesRead: number;
  omegaTotalElements?: number;
  matchingLogs: number;
  uniqueSpanIds: number;
  enrichedSpans: number;
  enrichmentErrors: number;
  truncated: boolean;
  paginationError?: string;
  exitCodes: string[];
}

interface EnvironmentConfig {
  omegaBaseUrl: string;
  rhoBaseUrl: string;
  acceptedEnvValues: string[];
  serverEnvFilter?: string;
}

function resolveEnvironmentConfig(
  environment: AteneaLogsEnvironment,
): EnvironmentConfig {
  if (environment === "PRO") {
    return {
      omegaBaseUrl: OMEGA_LIVE_BASE,
      rhoBaseUrl: RHO_LIVE_BASE,
      acceptedEnvValues: ["PRO", "PR", "PRZ", "LIVE-02"],
    };
  }

  const aliases: Record<Exclude<AteneaLogsEnvironment, "PRO">, string[]> = {
    DEV: ["DEV", "DE"],
    INT: ["INT", "EI"],
    AUS: ["AUS"],
    OCT: ["OCT", "OCTA"],
  };

  return {
    omegaBaseUrl: OMEGA_WORK_BASE,
    rhoBaseUrl: RHO_WORK_BASE,
    acceptedEnvValues: aliases[environment],
    serverEnvFilter: environment === "OCT" ? "OCTA" : environment,
  };
}

function escapeDoubleQuotedQueryValue(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function escapeSingleQuotedQueryValue(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function normalizeEnvironment(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function matchesEnvironment(
  value: unknown,
  config: EnvironmentConfig,
): boolean {
  const env = normalizeEnvironment(value);
  if (!env) return false;
  return config.acceptedEnvValues.some(
    (candidate) => normalizeEnvironment(candidate) === env,
  );
}

function unwrapRegexInput(value: string): { source: string; flags: string } {
  const raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("Escribe un mensaje, palabra o expresión regular para buscar.");
  }

  const delimited = raw.match(/^\/(.*)\/([a-z]*)$/i);
  const source = delimited ? delimited[1] : raw;
  const requestedFlags = delimited ? delimited[2] : "i";

  if (!/[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ]{2,}/.test(source)) {
    throw new Error(
      "La búsqueda debe contener al menos una palabra o fragmento de 2 caracteres para evitar consultar todos los logs.",
    );
  }

  const supportedFlags = Array.from(
    new Set(
      requestedFlags
        .split("")
        .filter((flag) => ["i", "m", "s", "u"].includes(flag)),
    ),
  ).join("");

  const flags = supportedFlags.includes("i")
    ? supportedFlags
    : `${supportedFlags}i`;

  // Valida la regex antes de ejecutar cualquier endpoint.
  // eslint-disable-next-line no-new
  new RegExp(source, flags);

  return { source, flags };
}

export function buildMessageRegex(value: string): RegExp {
  const { source, flags } = unwrapRegexInput(value);
  return new RegExp(source, flags);
}

/**
 * Omega soporta wildcard con * en message. La regex completa se vuelve a
 * aplicar en cliente para conservar el comportamiento esperado por el usuario.
 */
export function buildOmegaMessageWildcard(value: string): string {
  const { source } = unwrapRegexInput(value);

  const wildcard = source
    .replace(/\\([.*+?^${}()|[\]\\])/g, "$1")
    .replace(/\.\*/g, "*")
    .replace(/\.\+/g, "*")
    .replace(/\[[^\]]*\]/g, "*")
    .replace(/[(){}^$|+?]/g, "*")
    .replace(/\\[dDsSwWbB]/g, "*")
    .replace(/\\./g, "*")
    .replace(/\*+/g, "*")
    .trim();

  const clean = wildcard || "*";
  return `${clean.startsWith("*") ? "" : "*"}${clean}${
    clean.endsWith("*") ? "" : "*"
  }`;
}

/**
 * Primera petición de Omega. Las siguientes NO se construyen con page/size:
 * se sigue exactamente pagination.links.next, que contiene paginationKey.
 */
export function buildAteneaOmegaLogsUrl(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  messageRegex: string;
  fromTimestamp: string;
  toTimestamp: string;
}): string {
  const {
    environment,
    namespace,
    messageRegex,
    fromTimestamp,
    toTimestamp,
  } = params;

  const config = resolveEnvironmentConfig(environment);
  const pattern = buildOmegaMessageWildcard(messageRegex);
  const filters = [
    `message == "${escapeDoubleQuotedQueryValue(pattern)}"`,
  ];

  if (config.serverEnvFilter) {
    filters.push(
      `properties.env == "${escapeDoubleQuotedQueryValue(
        config.serverEnvFilter,
      )}"`,
    );
  }

  const url = new URL(`/v1/ns/${namespace}/logs`, config.omegaBaseUrl);
  url.searchParams.set("q", filters.join(" AND "));
  url.searchParams.set("sort", "descending");
  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  return url.toString();
}

export function buildAteneaRhoSpanUrl(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  spanId: string;
  fromTimestamp: string;
  toTimestamp: string;
}): string {
  const {
    environment,
    namespace,
    spanId,
    fromTimestamp,
    toTimestamp,
  } = params;
  const config = resolveEnvironmentConfig(environment);
  const url = new URL(`/v1/ns/${namespace}/spans`, config.rhoBaseUrl);

  url.searchParams.set(
    "q",
    `spanId == '${escapeSingleQuotedQueryValue(spanId)}'`,
  );
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("properties", "exitCode,type,applicationUUAA,env");
  url.searchParams.set("profile", "default");
  return url.toString();
}

function extractOmegaData(payload: OmegaLogsResponse | OmegaLogItem[]): OmegaLogItem[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function extractOmegaNextLink(
  payload: OmegaLogsResponse | OmegaLogItem[],
): string | null {
  if (Array.isArray(payload)) return null;
  const next = payload?.pagination?.links?.next;
  return typeof next === "string" && next.trim() ? next.trim() : null;
}

function extractOmegaTotalElements(
  payload: OmegaLogsResponse | OmegaLogItem[],
): number | undefined {
  if (Array.isArray(payload)) return undefined;
  const value = Number(payload?.pagination?.totalElements);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function extractRhoData(payload: RhoSpansResponse | RhoSpanItem[]): RhoSpanItem[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function logIdentity(log: OmegaLogItem): string {
  return [
    String(log.spanId ?? ""),
    String(log.recordDate ?? ""),
    String(log.message ?? ""),
    String(log.level ?? ""),
  ].join("|");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableOmegaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s+(429|5\d\d)|Timeout|Failed to fetch|NetworkError|Load failed/i.test(
    message,
  );
}

async function fetchOmegaPageWithRetry(params: {
  url: string;
  bearerToken?: string;
  pageNumber: number;
  readCount: number;
  onProgress?: (progress: AteneaLogsProgress) => void;
}): Promise<OmegaLogsResponse | OmegaLogItem[]> {
  const { url, bearerToken, pageNumber, readCount, onProgress } = params;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= OMEGA_MAX_RETRIES; attempt += 1) {
    try {
      return await apiRequest<OmegaLogsResponse | OmegaLogItem[]>(url, {
        headers: buildAuthHeaders(bearerToken),
        timeoutMs: 45_000,
      });
    } catch (error) {
      lastError = error;
      const retryable = isRetryableOmegaError(error);
      if (!retryable || attempt >= OMEGA_MAX_RETRIES) break;

      const delay = Math.min(
        8_000,
        OMEGA_RETRY_BASE_MS * 2 ** (attempt - 1),
      );

      onProgress?.({
        phase: "omega",
        completed: pageNumber - 1,
        total: 0,
        message: `Omega no respondió en la página ${pageNumber}. Reintento ${attempt}/${OMEGA_MAX_RETRIES} en ${Math.round(delay / 1000)} s · ${readCount.toLocaleString("es-MX")} registro(s) conservados...`,
      });

      await wait(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Error desconocido consultando Omega"));
}

interface OmegaFetchResult {
  logs: OmegaLogItem[];
  readCount: number;
  pagesRead: number;
  totalElements?: number;
  truncated: boolean;
  paginationError?: string;
}

async function fetchOmegaLogs(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  messageRegex: string;
  fromTimestamp: string;
  toTimestamp: string;
  bearerToken?: string;
  onProgress?: (progress: AteneaLogsProgress) => void;
}): Promise<OmegaFetchResult> {
  const {
    environment,
    namespace,
    messageRegex,
    fromTimestamp,
    toTimestamp,
    bearerToken,
    onProgress,
  } = params;

  const regex = buildMessageRegex(messageRegex);
  const config = resolveEnvironmentConfig(environment);
  const unique = new Map<string, OmegaLogItem>();
  const visitedUrls = new Set<string>();
  let readCount = 0;
  let pagesRead = 0;
  let totalElements: number | undefined;
  let truncated = false;
  let paginationError: string | undefined;
  let nextUrl: string | null = buildAteneaOmegaLogsUrl({
    environment,
    namespace,
    messageRegex,
    fromTimestamp,
    toTimestamp,
  });

  while (nextUrl) {
    const pageNumber = pagesRead + 1;

    if (visitedUrls.has(nextUrl)) {
      truncated = true;
      paginationError =
        `Omega devolvió un paginationKey ya utilizado en la página ${pageNumber}. ` +
        `Se conservaron ${readCount.toLocaleString("es-MX")} registro(s).`;
      break;
    }
    visitedUrls.add(nextUrl);

    onProgress?.({
      phase: "omega",
      completed: pagesRead,
      total: totalElements ? Math.ceil(totalElements / 100) : 0,
      message: `Consultando Omega · página ${pageNumber} · ${readCount.toLocaleString("es-MX")} registro(s) leídos...`,
    });

    let payload: OmegaLogsResponse | OmegaLogItem[];
    try {
      payload = await fetchOmegaPageWithRetry({
        url: nextUrl,
        bearerToken,
        pageNumber,
        readCount,
        onProgress,
      });
    } catch (error) {
      if (pagesRead === 0 && readCount === 0) {
        throw error;
      }

      truncated = true;
      const detail = error instanceof Error ? error.message : String(error);
      paginationError =
        `No se pudo continuar la paginación de Omega en la página ${pageNumber} ` +
        `después de ${OMEGA_MAX_RETRIES} intentos. Se conservaron ` +
        `${readCount.toLocaleString("es-MX")} registro(s). ${detail}`;
      break;
    }

    pagesRead += 1;
    const batch = extractOmegaData(payload);
    readCount += batch.length;

    const reportedTotal = extractOmegaTotalElements(payload);
    if (reportedTotal !== undefined) totalElements = reportedTotal;

    for (const log of batch) {
      const message = String(log.message ?? "");
      if (!regex.test(message)) continue;

      const logEnv = log.properties?.env;
      if (logEnv && !matchesEnvironment(logEnv, config)) continue;

      unique.set(logIdentity(log), log);
    }

    const nextLink = extractOmegaNextLink(payload);
    if (!nextLink) break;

    try {
      nextUrl = new URL(nextLink, config.omegaBaseUrl).toString();
    } catch {
      truncated = true;
      paginationError =
        `Omega devolvió un enlace next inválido en la página ${pageNumber}. ` +
        `Se conservaron ${readCount.toLocaleString("es-MX")} registro(s).`;
      break;
    }
  }

  onProgress?.({
    phase: "omega",
    completed: pagesRead,
    total: pagesRead,
    message: `${unique.size.toLocaleString("es-MX")} log(s) coinciden después de leer ${readCount.toLocaleString("es-MX")} registro(s) en ${pagesRead.toLocaleString("es-MX")} página(s) de Omega.`,
  });

  return {
    logs: Array.from(unique.values()),
    readCount,
    pagesRead,
    totalElements,
    truncated,
    paginationError,
  };
}

interface SpanLookupResult {
  span: RhoSpanItem | null;
  error?: string;
}

async function fetchRhoSpan(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  spanId: string;
  fromTimestamp: string;
  toTimestamp: string;
  bearerToken?: string;
}): Promise<SpanLookupResult> {
  const {
    environment,
    namespace,
    spanId,
    fromTimestamp,
    toTimestamp,
    bearerToken,
  } = params;

  try {
    const url = buildAteneaRhoSpanUrl({
      environment,
      namespace,
      spanId,
      fromTimestamp,
      toTimestamp,
    });

    const payload = await apiRequest<RhoSpansResponse | RhoSpanItem[]>(url, {
      headers: buildAuthHeaders(bearerToken),
      timeoutMs: 45_000,
    });
    const spans = extractRhoData(payload);
    const exact = spans.find((item) => String(item.spanId ?? "") === spanId);
    return { span: exact ?? spans[0] ?? null };
  } catch (error) {
    return {
      span: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function nanoToMilliseconds(value: number | string | undefined): number {
  if (value === undefined || value === null || value === "") return 0;

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const millisecondsText = value.length > 6 ? value.slice(0, -6) : "0";
    const milliseconds = Number(millisecondsText);
    if (Number.isFinite(milliseconds)) return milliseconds;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric / 1_000_000) : 0;
}

export function formatAteneaNanoDate(
  value: number | string | undefined,
): string {
  const milliseconds = nanoToMilliseconds(value);
  if (!milliseconds) return "-";
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveTrxJobType(
  namespace: AteneaLogsNamespace,
  span: RhoSpanItem | null,
): string {
  const explicit = String(span?.properties?.type ?? "").trim().toUpperCase();
  if (explicit) {
    if (explicit === "JOB") return "JOB";
    if (explicit === "TRANSACTION" || explicit === "TRX") return "TRX";
    return explicit;
  }
  return namespace === "apx.batch" ? "JOB" : "TRX";
}

function sortRowsDescending(rows: AteneaLogRow[]): AteneaLogRow[] {
  return [...rows].sort(
    (a, b) => nanoToMilliseconds(b.recordDate) - nanoToMilliseconds(a.recordDate),
  );
}

function buildRows(params: {
  logs: OmegaLogItem[];
  spanMap: Map<string, SpanLookupResult>;
  namespace: AteneaLogsNamespace;
  environment: AteneaLogsEnvironment;
}): AteneaLogRow[] {
  const { logs, spanMap, namespace, environment } = params;
  const config = resolveEnvironmentConfig(environment);
  const rows: AteneaLogRow[] = [];

  for (let index = 0; index < logs.length; index += 1) {
    const log = logs[index];
    const spanId = String(log.spanId ?? "").trim();
    const lookup = spanId ? spanMap.get(spanId) : undefined;
    const span = lookup?.span ?? null;
    const rawResolvedEnv = String(
      log.properties?.env ?? span?.properties?.env ?? "",
    ).trim();

    // Solo descartamos si realmente vino un env y no corresponde. Si Omega/Rho
    // no lo informan, conservamos el registro para no ocultar datos recuperados.
    if (rawResolvedEnv && !matchesEnvironment(rawResolvedEnv, config)) continue;

    const displayEnv = rawResolvedEnv || environment;

    rows.push({
      id: `${spanId || "no-span"}-${String(log.recordDate ?? index)}-${index}`,
      trxJobType: resolveTrxJobType(namespace, span),
      name: String(span?.name ?? "").trim() || "-",
      applicationUUAA:
        String(span?.properties?.applicationUUAA ?? "").trim() || "-",
      message: String(log.message ?? "").trim() || "-",
      date: formatAteneaNanoDate(log.recordDate ?? log.creationDate),
      recordDate: log.recordDate ?? log.creationDate,
      spanId: spanId || "-",
      traceId: String(log.traceId ?? span?.traceId ?? "").trim() || "-",
      env: displayEnv,
      exitCode: String(span?.properties?.exitCode ?? "").trim() || "-",
      level: String(log.level ?? "").trim() || "-",
      namespace,
      enrichmentError: lookup?.error,
    });
  }

  return sortRowsDescending(rows);
}

function buildSearchResult(params: {
  rows: AteneaLogRow[];
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  messageRegex: string;
  fromDate: Date;
  toDate: Date;
  omega: OmegaFetchResult;
  spanIds: string[];
  spanMap: Map<string, SpanLookupResult>;
}): AteneaLogsSearchResult {
  const {
    rows,
    environment,
    namespace,
    messageRegex,
    fromDate,
    toDate,
    omega,
    spanIds,
    spanMap,
  } = params;

  const exitCodes = Array.from(
    new Set(
      rows
        .map((row) => row.exitCode)
        .filter((value) => value && value !== "-"),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const enrichedSpans = Array.from(spanMap.values()).filter(
    (value) => Boolean(value.span),
  ).length;
  const enrichmentErrors = Array.from(spanMap.values()).filter(
    (value) => Boolean(value.error),
  ).length;

  return {
    rows,
    environment,
    namespace,
    messageRegex,
    fromDate,
    toDate,
    omegaLogsRead: omega.readCount,
    omegaPagesRead: omega.pagesRead,
    omegaTotalElements: omega.totalElements,
    matchingLogs: rows.length,
    uniqueSpanIds: spanIds.length,
    enrichedSpans,
    enrichmentErrors,
    truncated: omega.truncated,
    paginationError: omega.paginationError,
    exitCodes,
  };
}

export async function fetchAteneaLogs(
  params: AteneaLogsSearchParams,
): Promise<AteneaLogsSearchResult> {
  const {
    environment,
    namespace,
    messageRegex,
    fromDate,
    toDate,
    bearerToken,
    onProgress,
    onPartialResult,
  } = params;

  if (!(fromDate instanceof Date) || Number.isNaN(fromDate.getTime())) {
    throw new Error("Fecha inicial inválida.");
  }
  if (!(toDate instanceof Date) || Number.isNaN(toDate.getTime())) {
    throw new Error("Fecha final inválida.");
  }
  if (fromDate.getTime() >= toDate.getTime()) {
    throw new Error("La fecha Desde debe ser menor que la fecha Hasta.");
  }

  buildMessageRegex(messageRegex);

  const { from, to } = dateRangeToNano(fromDate, toDate);

  const omega = await fetchOmegaLogs({
    environment,
    namespace,
    messageRegex,
    fromTimestamp: from,
    toTimestamp: to,
    bearerToken,
    onProgress,
  });

  const spanIds = Array.from(
    new Set(
      omega.logs
        .map((log) => String(log.spanId ?? "").trim())
        .filter(Boolean),
    ),
  );

  const spanMap = new Map<string, SpanLookupResult>();

  // Importante: mostramos inmediatamente todos los logs recuperados aunque Rho
  // todavía no haya terminado. Así un 503 tardío o miles de spans no dejan la
  // tabla vacía mientras ya existen datos válidos de Omega.
  const publishPartial = () => {
    const rows = buildRows({ logs: omega.logs, spanMap, namespace, environment });
    const partial = buildSearchResult({
      rows,
      environment,
      namespace,
      messageRegex,
      fromDate,
      toDate,
      omega,
      spanIds,
      spanMap,
    });
    onPartialResult?.(partial);
    return partial;
  };

  let latestResult = publishPartial();

  const limiter = createConcurrencyLimiter(RHO_CONCURRENCY);
  let completed = 0;

  await Promise.all(
    spanIds.map((spanId) =>
      limiter(async () => {
        const result = await fetchRhoSpan({
          environment,
          namespace,
          spanId,
          fromTimestamp: from,
          toTimestamp: to,
          bearerToken,
        });
        spanMap.set(spanId, result);
        completed += 1;

        onProgress?.({
          phase: "rho",
          completed,
          total: spanIds.length,
          message: `Resolviendo TRX/JOB por spanId · ${completed}/${spanIds.length}`,
        });

        if (
          onPartialResult &&
          (completed % PARTIAL_RHO_UPDATE_EVERY === 0 || completed === spanIds.length)
        ) {
          latestResult = publishPartial();
        }
      }),
    ),
  );

  // Si no había spanId o no se publicó exactamente en el último lote, se fuerza
  // el resultado final con todo lo recuperado.
  latestResult = publishPartial();
  return latestResult;
}
