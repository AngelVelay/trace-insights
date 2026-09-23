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
const RHO_MAX_RETRIES = 3;
const RHO_RETRY_BASE_MS = 600;
const OMEGA_PAGE_SIZE = 100;
// El 503 observado aparece al intentar continuar después de 10,000 registros.
// Por eso cada día se consulta de forma independiente y nunca se solicita
// la página 101 (page=100 si el API usa índice base 0).
const OMEGA_MAX_LOGS_PER_DAY = 10_000;
const OMEGA_MAX_PAGES_PER_DAY = Math.ceil(
  OMEGA_MAX_LOGS_PER_DAY / OMEGA_PAGE_SIZE,
);
const OMEGA_MAX_RETRIES = 3;
const OMEGA_RETRY_BASE_MS = 800;
const PARTIAL_RHO_UPDATE_EVERY = 100;
const MAX_PARTIAL_RHO_UPDATES = 20;

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

interface OmegaPagination {
  totalElements?: number;
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
  children?: RhoSpanItem[];
  properties?: {
    applicationUUAA?: string;
    env?: string;
    exitCode?: string;
    readerProvider?: string;
    type?: string;
    [key: string]: unknown;
  };
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
  message: string;
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
  message: string;
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
  /** Valor canónico que Omega WORK-02 entiende en properties.env. */
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
    // WORK-02 contiene varios entornos. El filtro debe viajar a Omega para
    // que el límite diario se aplique al entorno seleccionado, no a la mezcla
    // DEV/INT/AUS/OCT. OCT se almacena históricamente como OCTA.
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

function shouldKeepOmegaLogForEnvironment(
  log: OmegaLogItem,
  config: EnvironmentConfig,
): boolean {
  const logEnv = normalizeEnvironment(log.properties?.env);

  if (logEnv) return matchesEnvironment(logEnv, config);

  // Si Omega no proyecta properties.env en la respuesta, conservamos el log:
  // en WORK-02 el q ya viaja filtrado por entorno y en PRO el host LIVE-02 ya
  // delimita el ámbito. Si env sí viene informado, el match anterior es estricto.
  return true;
}

function getRhoEnvironmentValues(span: RhoSpanItem | null): string[] {
  if (!span) return [];

  const values: string[] = [];
  const walk = (node: RhoSpanItem) => {
    const env = normalizeEnvironment(node.properties?.env);
    if (env) values.push(env);
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };

  walk(span);
  return Array.from(new Set(values));
}

function isRhoTraceCompatibleWithEnvironment(
  span: RhoSpanItem | null,
  config: EnvironmentConfig,
): boolean {
  const rhoEnvs = getRhoEnvironmentValues(span);

  if (!rhoEnvs.length) {
    // Algunos traces no proyectan env en todos sus nodos. La ausencia de env no
    // invalida un spanId que ya proviene de un log de Omega correctamente filtrado.
    return true;
  }

  return rhoEnvs.some((value) => matchesEnvironment(value, config));
}

/**
 * Normaliza el patrón de message que Omega entiende. Se conserva el wildcard
 * `*` tal como lo captura la UI. Por compatibilidad con valores antiguos,
 * `.*` también se convierte a `*`, pero ya no se interpreta como RegExp.
 */
export function buildOmegaMessageWildcard(value: string): string {
  let raw = String(value ?? "").trim();
  if (!raw) {
    throw new Error("Escribe el message que quieres buscar en Omega.");
  }

  // Compatibilidad con la antigua UI que permitía /expresion/i.
  const delimited = raw.match(/^\/(.*)\/[a-z]*$/i);
  if (delimited) raw = delimited[1].trim();

  raw = raw.replace(/\.\*/g, "*").replace(/\.\+/g, "*").trim();

  if (!raw) {
    throw new Error("Escribe el message que quieres buscar en Omega.");
  }

  return raw;
}

/**
 * Consulta Omega con la misma estrategia usada por securizacion-live:
 * page=0,1,2... + size=100. Atenea divide además el rango por día y corta
 * cada día en 10,000 logs para no solicitar la página 101 problemática.
 * El message es editable y se envía como wildcard nativo de Omega.
 */
export function buildAteneaOmegaLogsUrl(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  message: string;
  fromTimestamp: string;
  toTimestamp: string;
  page?: number;
  size?: number;
}): string {
  const {
    environment,
    namespace,
    message,
    fromTimestamp,
    toTimestamp,
    page = 0,
    size = OMEGA_PAGE_SIZE,
  } = params;

  const config = resolveEnvironmentConfig(environment);
  const pattern = buildOmegaMessageWildcard(message);
  const url = new URL(`/v1/ns/${namespace}/logs`, config.omegaBaseUrl);

  const filters = [
    `message == "${escapeDoubleQuotedQueryValue(pattern)}"`,
  ];

  // DEV/INT/AUS/OCT comparten WORK-02. Si no se manda properties.env en el
  // query, las primeras 10,000 filas del día pueden pertenecer a otros
  // entornos y consumir el límite antes de llegar a los datos seleccionados.
  if (config.serverEnvFilter) {
    filters.push(
      `properties.env == "${escapeDoubleQuotedQueryValue(
        config.serverEnvFilter,
      )}"`,
    );
  }

  url.searchParams.set("q", filters.join(" AND "));
  url.searchParams.set("sort", "descending");
  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));

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

  // Copia el mismo endpoint que usa Securización Live: se obtiene el trace
  // completo a partir del spanId, no se hace una búsqueda genérica /spans?q=.
  const url = new URL(
    `/v1/ns/${namespace}/mrs/RhoTraces/spans/${encodeURIComponent(spanId)}:trace`,
    config.rhoBaseUrl,
  );

  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("profile", "default");
  url.searchParams.set("crossRegion", "false");
  return url.toString();
}

function extractOmegaData(payload: OmegaLogsResponse | OmegaLogItem[]): OmegaLogItem[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function extractOmegaTotalElements(
  payload: OmegaLogsResponse | OmegaLogItem[],
): number | undefined {
  if (Array.isArray(payload)) return undefined;
  const value = Number(payload?.pagination?.totalElements);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}


function logIdentity(log: OmegaLogItem): string {
  return [
    String(log.recordDate ?? ""),
    String(log.creationDate ?? ""),
    String(log.spanId ?? ""),
    String(log.traceId ?? ""),
    String(log.mrId ?? ""),
    String(log.level ?? ""),
    String(log.message ?? ""),
    String(log.namespace ?? ""),
    String(log.properties?.env ?? ""),
    String(log.properties?.site ?? ""),
    String(log.properties?.hostname ?? ""),
    String(log.properties?.thread ?? ""),
    String(log.properties?.nameLog ?? ""),
  ].join("|");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRetryableHttpError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s+(429|5\d\d)|Timeout|Failed to fetch|NetworkError|Load failed/i.test(
    message,
  );
}

interface OmegaFetchResult {
  logs: OmegaLogItem[];
  readCount: number;
  pagesRead: number;
  totalElements?: number;
  truncated: boolean;
  paginationError?: string;
}

interface OmegaDayWindow {
  label: string;
  fromDate: Date;
  toDate: Date;
  fromTimestamp: string;
  toTimestamp: string;
}

interface OmegaDayFetchResult extends OmegaFetchResult {
  capReached: boolean;
}

function formatOmegaDayLabel(value: Date): string {
  return new Intl.DateTimeFormat("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/**
 * Divide [fromDate, toDate] en ventanas locales de un día, respetando las horas
 * exactas del primer y último día. Las ventanas son disjuntas a precisión de ms,
 * por lo que el mismo log de medianoche no se pide en dos días diferentes.
 */
function buildDailyOmegaWindows(fromDate: Date, toDate: Date): OmegaDayWindow[] {
  const windows: OmegaDayWindow[] = [];
  const finalMs = toDate.getTime();
  let currentStart = new Date(fromDate.getTime());

  while (currentStart.getTime() <= finalMs) {
    const nextDay = new Date(currentStart.getTime());
    nextDay.setHours(0, 0, 0, 0);
    nextDay.setDate(nextDay.getDate() + 1);

    const endMs = Math.min(finalMs, nextDay.getTime() - 1);
    const currentEnd = new Date(Math.max(currentStart.getTime(), endMs));
    const range = dateRangeToNano(currentStart, currentEnd);

    windows.push({
      label: formatOmegaDayLabel(currentStart),
      fromDate: new Date(currentStart.getTime()),
      toDate: currentEnd,
      fromTimestamp: range.from,
      toTimestamp: range.to,
    });

    if (nextDay.getTime() > finalMs) break;
    currentStart = nextDay;
  }

  return windows;
}

function isFatalOmegaRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP\s+(400|401|403|404|422)\b/i.test(message);
}

async function fetchOmegaDay(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  message: string;
  window: OmegaDayWindow;
  dayIndex: number;
  totalDays: number;
  bearerToken?: string;
  onProgress?: (progress: AteneaLogsProgress) => void;
}): Promise<OmegaDayFetchResult> {
  const {
    environment,
    namespace,
    message,
    window,
    dayIndex,
    totalDays,
    bearerToken,
    onProgress,
  } = params;

  const headers = buildAuthHeaders(bearerToken);
  const config = resolveEnvironmentConfig(environment);
  const unique = new Map<string, OmegaLogItem>();
  let readCount = 0;
  let rawReadCount = 0;
  let pagesRead = 0;
  let totalElements: number | undefined;
  let truncated = false;
  let paginationError: string | undefined;
  let capReached = false;

  for (let page = 0; page < OMEGA_MAX_PAGES_PER_DAY; page += 1) {
    const pageNumber = page + 1;

    onProgress?.({
      phase: "omega",
      completed: dayIndex,
      total: totalDays,
      message:
        `Omega · día ${dayIndex + 1}/${totalDays} (${window.label}) · ` +
        `página ${pageNumber}/${OMEGA_MAX_PAGES_PER_DAY} · ` +
        `${readCount.toLocaleString("es-MX")} log(s) del día...`,
    });

    const omegaUrl = buildAteneaOmegaLogsUrl({
      environment,
      namespace,
      message,
      fromTimestamp: window.fromTimestamp,
      toTimestamp: window.toTimestamp,
      page,
      size: OMEGA_PAGE_SIZE,
    });

    let payload: OmegaLogsResponse | OmegaLogItem[] | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= OMEGA_MAX_RETRIES; attempt += 1) {
      try {
        payload = await apiRequest<OmegaLogsResponse | OmegaLogItem[]>(omegaUrl, {
          headers,
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;

        if (isFatalOmegaRequestError(error)) throw error;
        if (!isRetryableHttpError(error) || attempt >= OMEGA_MAX_RETRIES) break;

        await wait(
          Math.min(4_000, OMEGA_RETRY_BASE_MS * 2 ** (attempt - 1)),
        );
      }
    }

    if (payload === undefined) {
      truncated = true;
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      paginationError =
        `${window.label}: Omega falló en la página ${pageNumber} después de ` +
        `${OMEGA_MAX_RETRIES} intento(s). Se conservaron ` +
        `${unique.size.toLocaleString("es-MX")} log(s) de ese día. ${detail}`;
      break;
    }

    pagesRead += 1;
    const batch = extractOmegaData(payload);
    const reportedTotal = extractOmegaTotalElements(payload);
    if (page === 0 && reportedTotal !== undefined) totalElements = reportedTotal;

    if (!batch.length) break;

    // Defensa adicional: aunque Omega ignore/malinterprete el filtro q, nunca
    // permitimos que un log de otro entorno llegue a Resultados LOGS ATENEA.
    rawReadCount += batch.length;
    const environmentBatch = batch.filter((log) =>
      shouldKeepOmegaLogForEnvironment(log, config),
    );

    readCount += environmentBatch.length;
    for (const log of environmentBatch) unique.set(logIdentity(log), log);

    // Menos de 100 indica fin natural del día.
    if (batch.length < OMEGA_PAGE_SIZE) break;

    // Corte duro de seguridad: 100 páginas x 100 = 10,000. Nunca se hace la
    // petición siguiente, que sería la página 101 donde se observó el 503.
    if (page === OMEGA_MAX_PAGES_PER_DAY - 1) {
      const moreExpected =
        totalElements === undefined || totalElements > rawReadCount;

      if (moreExpected) {
        capReached = true;
        truncated = true;
        paginationError =
          `${window.label}: se alcanzó el límite de ` +
          `${OMEGA_MAX_LOGS_PER_DAY.toLocaleString("es-MX")} logs consultados del día ` +
          `y se conservaron ${unique.size.toLocaleString("es-MX")} del entorno ${environment}. ` +
          "No se solicitó la página 101 para evitar el error de paginación de Omega.";
      }
    }
  }

  onProgress?.({
    phase: "omega",
    completed: dayIndex + 1,
    total: totalDays,
    message:
      `Omega · ${window.label} completado · ` +
      `${unique.size.toLocaleString("es-MX")} log(s) · ` +
      `${pagesRead.toLocaleString("es-MX")} página(s).`,
  });

  return {
    logs: Array.from(unique.values()),
    readCount,
    pagesRead,
    totalElements,
    truncated,
    paginationError,
    capReached,
  };
}

/**
 * Lee cada día del rango por separado. Un día que alcance 10,000 registros o
 * falle en una página tardía no impide que se consulten los demás días.
 */
async function fetchOmegaLogs(params: {
  environment: AteneaLogsEnvironment;
  namespace: AteneaLogsNamespace;
  message: string;
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
  onProgress?: (progress: AteneaLogsProgress) => void;
}): Promise<OmegaFetchResult> {
  const {
    environment,
    namespace,
    message,
    fromDate,
    toDate,
    bearerToken,
    onProgress,
  } = params;

  buildOmegaMessageWildcard(message);

  const windows = buildDailyOmegaWindows(fromDate, toDate);
  const unique = new Map<string, OmegaLogItem>();
  const cappedDays: string[] = [];
  const dayErrors: string[] = [];

  let readCount = 0;
  let pagesRead = 0;
  let knownTotal = 0;
  let everyDayReportedTotal = true;
  let successfulDays = 0;

  for (let dayIndex = 0; dayIndex < windows.length; dayIndex += 1) {
    const window = windows[dayIndex];
    const dayResult = await fetchOmegaDay({
      environment,
      namespace,
      message,
      window,
      dayIndex,
      totalDays: windows.length,
      bearerToken,
      onProgress,
    });

    if (dayResult.pagesRead > 0) successfulDays += 1;
    readCount += dayResult.readCount;
    pagesRead += dayResult.pagesRead;

    if (dayResult.totalElements === undefined) {
      everyDayReportedTotal = false;
    } else {
      knownTotal += dayResult.totalElements;
    }

    for (const log of dayResult.logs) unique.set(logIdentity(log), log);

    if (dayResult.capReached) cappedDays.push(window.label);
    if (dayResult.paginationError && !dayResult.capReached) {
      dayErrors.push(dayResult.paginationError);
    }
  }

  if (windows.length > 0 && successfulDays === 0 && dayErrors.length > 0) {
    throw new Error(
      `No fue posible recuperar logs de Omega para ningún día del rango. ${dayErrors[0]}`,
    );
  }

  const messages: string[] = [];
  if (cappedDays.length) {
    const visibleDays = cappedDays.slice(0, 10).join(", ");
    const remaining = cappedDays.length - Math.min(cappedDays.length, 10);
    messages.push(
      `Se aplicó el límite seguro de ${OMEGA_MAX_LOGS_PER_DAY.toLocaleString("es-MX")} ` +
        `logs por día en ${cappedDays.length.toLocaleString("es-MX")} día(s): ` +
        `${visibleDays}${remaining > 0 ? ` y ${remaining} día(s) más` : ""}. ` +
        "No se solicitó la página 101.",
    );
  }
  if (dayErrors.length) messages.push(...dayErrors);

  onProgress?.({
    phase: "omega",
    completed: windows.length,
    total: windows.length,
    message:
      `${unique.size.toLocaleString("es-MX")} log(s) agregados de ` +
      `${windows.length.toLocaleString("es-MX")} día(s) · ` +
      `${pagesRead.toLocaleString("es-MX")} página(s) de Omega.`,
  });

  return {
    logs: Array.from(unique.values()),
    readCount,
    pagesRead,
    totalElements: everyDayReportedTotal ? knownTotal : undefined,
    truncated: cappedDays.length > 0 || dayErrors.length > 0,
    paginationError: messages.length ? messages.join(" ") : undefined,
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

  let lastError: unknown = null;
  const config = resolveEnvironmentConfig(environment);

  for (let attempt = 1; attempt <= RHO_MAX_RETRIES; attempt += 1) {
    try {
      const url = buildAteneaRhoSpanUrl({
        environment,
        namespace,
        spanId,
        fromTimestamp,
        toTimestamp,
      });

      const trace = await apiRequest<RhoSpanItem>(url, {
        headers: buildAuthHeaders(bearerToken),
        timeoutMs: 45_000,
      });

      // Securización Live usa directamente el trace devuelto por :trace. El
      // span solicitado puede ser un hijo y el objeto raíz representar la TRX/JOB.
      // En WORK-02, sin embargo, debemos impedir que un trace de otro entorno
      // contamine TRX/JOB, UUAA o Exit Code de una fila válida de Omega.
      if (trace && typeof trace === "object") {
        if (!isRhoTraceCompatibleWithEnvironment(trace, config)) {
          const rhoEnvs = getRhoEnvironmentValues(trace);
          return {
            span: null,
            error:
              `Rho devolvió un trace de otro entorno (${rhoEnvs.join(", ") || "sin env"}) ` +
              `para una búsqueda ${environment}. Se conservó el log de Omega sin ese enriquecimiento.`,
          };
        }
        return { span: trace };
      }
      return { span: null };
    } catch (error) {
      lastError = error;
      if (!isRetryableHttpError(error) || attempt >= RHO_MAX_RETRIES) break;

      const delay = Math.min(
        4_000,
        RHO_RETRY_BASE_MS * 2 ** (attempt - 1),
      );
      await wait(delay);
    }
  }

  return {
    span: null,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
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

function flattenRhoTrace(span: RhoSpanItem | null): RhoSpanItem[] {
  if (!span) return [];

  const nodes: RhoSpanItem[] = [];
  const walk = (current: RhoSpanItem) => {
    nodes.push(current);
    if (Array.isArray(current.children)) current.children.forEach(walk);
  };

  walk(span);
  return nodes;
}

function resolveTrxJobNode(
  namespace: AteneaLogsNamespace,
  span: RhoSpanItem | null,
): RhoSpanItem | null {
  if (!span) return null;

  const nodes = flattenRhoTrace(span);
  const expectedTypes =
    namespace === "apx.batch"
      ? new Set(["JOB", "BATCH"])
      : new Set(["TRANSACTION", "TRX"]);

  // El endpoint :trace puede devolver como raíz un span técnico. Para recuperar
  // el TRX/JOB real buscamos dentro del trace el nodo funcional cuyo `name`
  // identifica la transacción o job.
  const typedNode = nodes.find((node) => {
    const type = String(node.properties?.type ?? "").trim().toUpperCase();
    const name = String(node.name ?? "").trim();
    return Boolean(name) && expectedTypes.has(type);
  });

  if (typedNode) return typedNode;

  // Fallback: si Rho no informa type, priorizamos cualquier nodo con name y,
  // finalmente, el name raíz que viene directamente del endpoint :trace.
  return nodes.find((node) => String(node.name ?? "").trim()) ?? span;
}

function resolveTrxJobType(
  namespace: AteneaLogsNamespace,
  span: RhoSpanItem | null,
): string {
  const trxJobNode = resolveTrxJobNode(namespace, span);
  const explicit = String(trxJobNode?.properties?.type ?? "").trim().toUpperCase();
  if (explicit) {
    if (explicit === "JOB" || explicit === "BATCH") return "JOB";
    if (explicit === "TRANSACTION" || explicit === "TRX") return "TRX";
    return explicit;
  }
  return namespace === "apx.batch" ? "JOB" : "TRX";
}

function resolveTrxJobName(
  namespace: AteneaLogsNamespace,
  span: RhoSpanItem | null,
): string {
  const trxJobNode = resolveTrxJobNode(namespace, span);
  return String(trxJobNode?.name ?? span?.name ?? "").trim() || "-";
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
    // Última barrera antes de renderizar. Esto evita fugas entre entornos incluso
    // si el backend devuelve datos fuera del filtro solicitado.
    if (!shouldKeepOmegaLogForEnvironment(log, config)) continue;

    const compatibleSpan =
      span && isRhoTraceCompatibleWithEnvironment(span, config)
        ? span
        : null;
    const trxJobNode = resolveTrxJobNode(namespace, compatibleSpan);

    rows.push({
      id: `${spanId || "no-span"}-${String(log.recordDate ?? index)}-${index}`,
      trxJobType: resolveTrxJobType(namespace, compatibleSpan),
      name: resolveTrxJobName(namespace, compatibleSpan),
      applicationUUAA:
        String(
          trxJobNode?.properties?.applicationUUAA ??
            compatibleSpan?.properties?.applicationUUAA ??
            "",
        ).trim() || "-",
      message: String(log.message ?? "").trim() || "-",
      date: formatAteneaNanoDate(log.recordDate ?? log.creationDate),
      recordDate: log.recordDate ?? log.creationDate,
      spanId: spanId || "-",
      traceId: String(log.traceId ?? trxJobNode?.traceId ?? compatibleSpan?.traceId ?? "").trim() || "-",
      // Se muestra el entorno seleccionado, no un alias técnico (DE/EI/OCTA)
      // ni un valor de un trace inconsistente.
      env: environment,
      exitCode:
        String(
          trxJobNode?.properties?.exitCode ?? compatibleSpan?.properties?.exitCode ?? "",
        ).trim() || "-",
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
  message: string;
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
    message,
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
    message,
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
    message,
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

  buildOmegaMessageWildcard(message);

  const { from, to } = dateRangeToNano(fromDate, toDate);

  const omega = await fetchOmegaLogs({
    environment,
    namespace,
    message,
    fromDate,
    toDate,
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
      message,
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
  const partialUpdateEvery = Math.max(
    PARTIAL_RHO_UPDATE_EVERY,
    Math.ceil(spanIds.length / MAX_PARTIAL_RHO_UPDATES),
  );
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
          (completed % partialUpdateEvery === 0 || completed === spanIds.length)
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
