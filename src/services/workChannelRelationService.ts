import { CHANNEL_CODES } from "@/types/bbva";
import {
  apiRequest,
  buildAuthHeaders,
  createConcurrencyLimiter,
} from "@/services/httpClient";
import { dateRangeToNano } from "@/services/dateUtils";
import configuredTargetsRaw from "@/data/workChannelTargets.json?raw";

const MU_WORK_BASE = "https://mu.work-02.nextgen.igrupobbva";
const FUNCTIONAL_AGGREGATION_PATH =
  "/v0/ns/apx.online/metric-sets/functional-dashboard:listAggregations";
const PROPERTIES_SIZE = 20_000;
const TOP_TRX_LIMIT = 5;
const AAP_CONCURRENCY = 5;

export type WorkChannelRelationEnvironment = "DEV" | "INT" | "AUS" | "OCTA";

export interface ConfiguredWorkChannelItem {
  aap: string;
  name: string;
}

interface ConfiguredWorkChannelFile {
  version?: number;
  description?: string;
  items?: ConfiguredWorkChannelItem[];
}

export interface WorkChannelAapTarget {
  aap: string;
  configuredName: string;
  channelCode: string;
  applicationName: string;
  channelResolved: boolean;
}

export interface WorkChannelTarget {
  channelCode: string;
  displayName: string;
  applicationNames: string[];
  sourceAaps: string[];
}

export interface ResolvedAapMapping {
  aap: string;
  channelCode: string;
  applicationName: string;
  configuredName?: string;
}

export interface WorkChannelTransaction {
  trx: string;
  executions: number;
  meanSpanDuration: number;
  technicalErrors: number;
  functionalErrors: number;
}

export interface WorkChannelResult {
  aap: string;
  configuredName: string;
  channelCode: string;
  applicationName: string;
  channelResolved: boolean;
  status: "ok" | "empty" | "error";
  topTransactions: WorkChannelTransaction[];
  totalTransactions: number;
  totalExecutions: number;
  error?: string;
}

export interface ChannelInputResolution {
  channels: WorkChannelTarget[];
  aapTargets: WorkChannelAapTarget[];
  unresolved: string[];
  resolvedAaps: ResolvedAapMapping[];
  mode: "configured" | "aap";
}

export interface WorkChannelRelationSearchParams {
  fromDate: Date;
  toDate: Date;
  environment?: WorkChannelRelationEnvironment;
  channelListText?: string;
  bearerToken?: string;
  onProgress?: (progress: {
    completed: number;
    total: number;
    aap: string;
    channelCode: string;
  }) => void;
}

export interface WorkChannelRelationSearchResult {
  rows: WorkChannelResult[];
  unresolvedInputs: string[];
  resolvedAaps: ResolvedAapMapping[];
  inputMode: "configured" | "aap";
  environment?: WorkChannelRelationEnvironment;
  fromDate: Date;
  toDate: Date;
  totalAaps: number;
  successfulAaps: number;
  emptyAaps: number;
  failedAaps: number;

  // Alias de compatibilidad con la version anterior. Ya no representan grupos
  // por canal: cada fila corresponde exclusivamente a un AAP.
  totalChannels: number;
  successfulChannels: number;
  emptyChannels: number;
  failedChannels: number;
}

interface AapCatalogItem {
  aap: string;
  channelCode: string;
  applicationName: string;
}

interface AggregationBucketLike {
  bucket?: Record<string, unknown>;
  values?: Record<string, unknown>;
  name?: unknown;
  sum_num_executions?: unknown;
  mean_span_duration?: unknown;
  sum_technical_error?: unknown;
  sum_functional_error?: unknown;
}

interface AggregationResponseLike {
  buckets?: AggregationBucketLike[];
  data?: AggregationBucketLike[];
  aggregations?: AggregationBucketLike[];
  items?: AggregationBucketLike[];
  results?: AggregationBucketLike[];
}

interface AapFetchResult {
  target: WorkChannelAapTarget;
  status: "ok" | "empty" | "error";
  transactions: WorkChannelTransaction[];
  error?: string;
}

function normalizeAap(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";

  const numeric = Number(digits);
  if (!Number.isFinite(numeric) || numeric < 0) return "";

  return String(Math.trunc(numeric)).padStart(8, "0");
}

function parseConfiguredFile(): ConfiguredWorkChannelFile {
  try {
    const parsed = JSON.parse(configuredTargetsRaw) as ConfiguredWorkChannelFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.error("[RelacionCanalesWork] JSON de AAP invalido", error);
    return {};
  }
}

/**
 * Catálogo fijo entregado por el usuario para Relación de Canales WORK.
 * Mantiene el orden y deduplica AAP repetidos.
 */
export function getConfiguredWorkAapCatalog(): ConfiguredWorkChannelItem[] {
  const rawItems = parseConfiguredFile().items ?? [];
  const result: ConfiguredWorkChannelItem[] = [];
  const byAap = new Map<string, ConfiguredWorkChannelItem>();

  for (const rawItem of rawItems) {
    const aap = normalizeAap(rawItem?.aap);
    const name = String(rawItem?.name ?? "").trim();
    if (!aap) continue;

    const existing = byAap.get(aap);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      continue;
    }

    const item = { aap, name };
    byAap.set(aap, item);
    result.push(item);
  }

  return result;
}

/** Índice opcional AAP -> channel-code para conservar la columna Canal. */
export function getWorkAapCatalog(): AapCatalogItem[] {
  const result: AapCatalogItem[] = [];
  const seen = new Set<string>();

  for (const channel of CHANNEL_CODES) {
    for (const application of channel.applications ?? []) {
      const aap = normalizeAap(application.aap);
      const channelCode = String(
        application.channel ?? channel.channelCode ?? "",
      )
        .trim()
        .toUpperCase();
      const applicationName = String(application.name ?? "").trim();

      if (!aap || !channelCode) continue;

      const key = `${aap}|${channelCode}|${applicationName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ aap, channelCode, applicationName });
    }
  }

  return result;
}

/**
 * Extrae AAP de Excel, Markdown, HTML o texto plano.
 *
 * IMPORTANTE: este parser se usa para el cuadro de texto y conserva el orden
 * exacto en que el usuario pego los AAP. No mezcla este listado con el JSON.
 */
export function parseAapList(value: string): string[] {
  const raw = String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  const matches = raw.match(/(?<!\d)\d{8}(?!\d)/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of matches) {
    const aap = normalizeAap(match);
    if (!aap || seen.has(aap)) continue;
    seen.add(aap);
    result.push(aap);
  }

  return result;
}

/**
 * Convierte el contenido manual en items AAP. Si una fila incluye nombre, por
 * ejemplo `10000200\tCerberos Connector IB`, lo conserva solo como etiqueta.
 * El filtro del endpoint siempre usa exclusivamente el AAP.
 */
export function parseManualAapItems(value: string): ConfiguredWorkChannelItem[] {
  const raw = String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ");

  const lines = raw.split(/\r?\n/g);
  const result: ConfiguredWorkChannelItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const matches = [...line.matchAll(/(?<!\d)(\d{8})(?!\d)/g)];

    for (const match of matches) {
      const aap = normalizeAap(match[1]);
      if (!aap || seen.has(aap)) continue;

      const after = line.slice((match.index ?? 0) + match[0].length);
      const name = after
        .replace(/^[\s|:;,-]+/, "")
        .replace(/[|]+$/g, "")
        .trim();

      seen.add(aap);
      result.push({ aap, name });
    }
  }

  // Fallback para tablas HTML/Markdown en una sola linea o formatos raros.
  if (result.length === 0) {
    return parseAapList(raw).map((aap) => ({ aap, name: "" }));
  }

  return result;
}

function buildAapLookup(): Map<string, AapCatalogItem[]> {
  const byAap = new Map<string, AapCatalogItem[]>();

  for (const item of getWorkAapCatalog()) {
    const current = byAap.get(item.aap) ?? [];
    current.push(item);
    byAap.set(item.aap, current);
  }

  return byAap;
}

function resolveAapTargets(
  requested: ConfiguredWorkChannelItem[],
  mode: "configured" | "aap",
): ChannelInputResolution {
  const byAap = buildAapLookup();
  const aapTargets: WorkChannelAapTarget[] = [];
  const unresolved: string[] = [];
  const resolvedAaps: ResolvedAapMapping[] = [];

  for (const item of requested) {
    const aap = normalizeAap(item.aap);
    if (!aap) continue;

    const matches = byAap.get(aap) ?? [];
    const uniqueChannels = Array.from(
      new Set(matches.map((match) => match.channelCode).filter(Boolean)),
    );
    const uniqueNames = Array.from(
      new Set(matches.map((match) => match.applicationName).filter(Boolean)),
    );

    const channelResolved = uniqueChannels.length > 0;
    const channelCode = channelResolved ? uniqueChannels.join(" / ") : "-";
    const applicationName =
      String(item.name ?? "").trim() || uniqueNames[0] || `AAP ${aap}`;

    if (!channelResolved) {
      unresolved.push(aap);
    } else {
      for (const match of matches) {
        resolvedAaps.push({
          aap,
          channelCode: match.channelCode,
          applicationName: match.applicationName,
          configuredName: item.name || undefined,
        });
      }
    }

    aapTargets.push({
      aap,
      configuredName: String(item.name ?? "").trim(),
      channelCode,
      applicationName,
      channelResolved,
    });
  }

  // Compatibilidad con versiones anteriores: `channels` se conserva en la
  // resolución, pero YA NO agrupa AAP que compartan channel-code. Cada elemento
  // representa únicamente un AAP.
  const channels: WorkChannelTarget[] = aapTargets.map((target) => ({
    channelCode: target.channelCode,
    displayName: target.applicationName,
    applicationNames: target.applicationName ? [target.applicationName] : [],
    sourceAaps: [target.aap],
  }));

  return {
    channels,
    aapTargets,
    unresolved: Array.from(new Set(unresolved)),
    resolvedAaps,
    mode,
  };
}

/**
 * PRIORIDAD DE FUENTE (regla definitiva):
 * 1. Si el cuadro de texto contiene cualquier texto, SOLO se consultan los AAP
 *    validos encontrados ahi. El JSON NO se agrega, NO se mezcla y NO se usa
 *    como fallback.
 * 2. Unicamente cuando el cuadro de texto esta realmente vacio se cargan los
 *    AAP de workChannelTargets.json.
 *
 * bbva.ts solo se usa para enriquecer metadatos visuales; nunca decide que AAP
 * se consulta y nunca forma parte del filtro del endpoint functional-dashboard.
 */
export function resolveWorkChannels(
  channelListText?: string,
): ChannelInputResolution {
  const raw = String(channelListText ?? "");

  // El textarea tiene prioridad absoluta. No hacemos trim para decidir la fuente
  // hasta comprobar si hay contenido visible; solo espacios cuentan como vacio.
  if (raw.trim().length > 0) {
    const manualItems = parseManualAapItems(raw);

    if (manualItems.length === 0) {
      return {
        channels: [],
        aapTargets: [],
        unresolved: [],
        resolvedAaps: [],
        mode: "aap",
      };
    }

    return resolveAapTargets(manualItems, "aap");
  }

  return resolveAapTargets(getConfiguredWorkAapCatalog(), "configured");
}

function escapeQueryValue(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

/**
 * Endpoint nuevo solicitado:
 * functional-dashboard:listAggregations
 * q = "aap" == "XXXXXXXX"
 * aggregate = "name"
 * operations = ejecuciones, tiempo medio, error técnico y error funcional.
 */
export function buildWorkChannelRelationUrl(params: {
  fromDate: Date;
  toDate: Date;
  aap: string;
  environment?: WorkChannelRelationEnvironment;
}): string {
  const { from, to } = dateRangeToNano(params.fromDate, params.toDate);
  const aap = normalizeAap(params.aap);

  const url = new URL(FUNCTIONAL_AGGREGATION_PATH, MU_WORK_BASE);
  url.searchParams.set("fromTimestamp", from);
  url.searchParams.set("toTimestamp", to);
  url.searchParams.set("propertiesSize", String(PROPERTIES_SIZE));
  url.searchParams.set("aggregate", '"name"');

  const queryParts = [`"aap" == "${escapeQueryValue(aap)}"`];

  if (params.environment) {
    queryParts.push(`"env" == "${escapeQueryValue(params.environment)}"`);
  }

  url.searchParams.set("q", queryParts.join(" AND "));
  url.searchParams.append("operation", "sum:num_executions");
  url.searchParams.append("operation", "mean:span_duration");
  url.searchParams.append("operation", "sum:technical_error");
  url.searchParams.append("operation", "sum:functional_error");

  return url.toString();
}

function extractBuckets(payload: AggregationResponseLike): AggregationBucketLike[] {
  if (Array.isArray(payload?.buckets)) return payload.buckets;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.aggregations)) return payload.aggregations;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function getBucketTransactionName(bucket: AggregationBucketLike): string {
  return String(bucket?.bucket?.name ?? bucket?.name ?? "").trim();
}

function readMetric(bucket: AggregationBucketLike, key: string): number {
  const values = bucket?.values ?? {};
  const direct = bucket as Record<string, unknown>;
  const value = Number(values[key] ?? direct[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeTransactionName(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Deduplica TRX dentro de una respuesta de AAP. Las ejecuciones y errores se
 * suman. mean_span_duration se combina como media ponderada por ejecuciones.
 */
function normalizeTransactions(
  payload: AggregationResponseLike,
): WorkChannelTransaction[] {
  const aggregated = new Map<
    string,
    {
      executions: number;
      technicalErrors: number;
      functionalErrors: number;
      weightedDuration: number;
      durationWeight: number;
    }
  >();

  for (const bucket of extractBuckets(payload)) {
    const trx = normalizeTransactionName(getBucketTransactionName(bucket));
    if (!trx) continue;

    const executions = readMetric(bucket, "sum_num_executions");
    const meanSpanDuration = readMetric(bucket, "mean_span_duration");
    const technicalErrors = readMetric(bucket, "sum_technical_error");
    const functionalErrors = readMetric(bucket, "sum_functional_error");
    const weight = executions > 0 ? executions : meanSpanDuration > 0 ? 1 : 0;

    const current = aggregated.get(trx) ?? {
      executions: 0,
      technicalErrors: 0,
      functionalErrors: 0,
      weightedDuration: 0,
      durationWeight: 0,
    };

    current.executions += executions;
    current.technicalErrors += technicalErrors;
    current.functionalErrors += functionalErrors;
    current.weightedDuration += meanSpanDuration * weight;
    current.durationWeight += weight;
    aggregated.set(trx, current);
  }

  return Array.from(aggregated.entries())
    .map(([trx, metrics]) => ({
      trx,
      executions: metrics.executions,
      meanSpanDuration:
        metrics.durationWeight > 0
          ? metrics.weightedDuration / metrics.durationWeight
          : 0,
      technicalErrors: metrics.technicalErrors,
      functionalErrors: metrics.functionalErrors,
    }))
    .sort((a, b) => {
      if (b.executions !== a.executions) return b.executions - a.executions;
      return a.trx.localeCompare(b.trx);
    });
}

async function fetchOneAap(params: {
  target: WorkChannelAapTarget;
  fromDate: Date;
  toDate: Date;
  environment?: WorkChannelRelationEnvironment;
  bearerToken?: string;
}): Promise<AapFetchResult> {
  const { target, fromDate, toDate, environment, bearerToken } = params;

  try {
    const url = buildWorkChannelRelationUrl({
      fromDate,
      toDate,
      aap: target.aap,
      environment,
    });

    const payload = await apiRequest<AggregationResponseLike>(url, {
      headers: buildAuthHeaders(bearerToken),
      timeoutMs: 45_000,
    });

    const transactions = normalizeTransactions(payload);

    return {
      target,
      status: transactions.length > 0 ? "ok" : "empty",
      transactions,
    };
  } catch (error) {
    return {
      target,
      status: "error",
      transactions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Construye una fila independiente por AAP.
 *
 * IMPORTANTE: no mezcla ni suma transacciones entre AAP distintos aunque
 * pertenezcan al mismo channel-code. Cada AAP conserva su propio Top 5.
 */
function buildAapRows(aapResults: AapFetchResult[]): WorkChannelResult[] {
  return aapResults.map((result) => {
    const transactions = result.transactions;
    const totalExecutions = transactions.reduce(
      (sum, item) => sum + item.executions,
      0,
    );

    return {
      aap: result.target.aap,
      configuredName: result.target.configuredName,
      channelCode: result.target.channelCode,
      applicationName: result.target.applicationName,
      channelResolved: result.target.channelResolved,
      status: result.status,
      topTransactions: transactions.slice(0, TOP_TRX_LIMIT),
      totalTransactions: transactions.length,
      totalExecutions,
      error: result.error,
    };
  });
}

export async function fetchWorkChannelRelation(
  params: WorkChannelRelationSearchParams,
): Promise<WorkChannelRelationSearchResult> {
  if (!(params.fromDate instanceof Date) || Number.isNaN(params.fromDate.getTime())) {
    throw new Error("Fecha inicial inválida.");
  }
  if (!(params.toDate instanceof Date) || Number.isNaN(params.toDate.getTime())) {
    throw new Error("Fecha final inválida.");
  }
  if (params.fromDate.getTime() > params.toDate.getTime()) {
    throw new Error("La fecha inicial no puede ser posterior a la fecha final.");
  }

  const hasManualInput = String(params.channelListText ?? "").trim().length > 0;
  const resolution = resolveWorkChannels(params.channelListText);

  console.info(
    `[RelacionCanalesWork] fuente=${hasManualInput ? "TEXTAREA" : "JSON"} AAP=${resolution.aapTargets.length}`,
  );

  if (resolution.aapTargets.length === 0) {
    return {
      rows: [],
      unresolvedInputs: resolution.unresolved,
      resolvedAaps: resolution.resolvedAaps,
      inputMode: resolution.mode,
      environment: params.environment,
      fromDate: params.fromDate,
      toDate: params.toDate,
      totalAaps: 0,
      successfulAaps: 0,
      emptyAaps: 0,
      failedAaps: 0,
      totalChannels: 0,
      successfulChannels: 0,
      emptyChannels: 0,
      failedChannels: 0,
    };
  }

  const limiter = createConcurrencyLimiter(AAP_CONCURRENCY);
  let completed = 0;
  const total = resolution.aapTargets.length;

  const aapResults = await Promise.all(
    resolution.aapTargets.map((target) =>
      limiter(async () => {
        const result = await fetchOneAap({
          target,
          fromDate: params.fromDate,
          toDate: params.toDate,
          environment: params.environment,
          bearerToken: params.bearerToken,
        });

        completed += 1;
        params.onProgress?.({
          completed,
          total,
          aap: target.aap,
          channelCode: target.channelCode,
        });

        return result;
      }),
    ),
  );

  // Promise.all conserva el orden del arreglo de entrada, por lo que las filas
  // salen en el mismo orden del JSON o del listado manual pegado.
  const rows = buildAapRows(aapResults);
  const successfulAaps = rows.filter((row) => row.status === "ok").length;
  const emptyAaps = rows.filter((row) => row.status === "empty").length;
  const failedAaps = rows.filter((row) => row.status === "error").length;

  return {
    rows,
    unresolvedInputs: resolution.unresolved,
    resolvedAaps: resolution.resolvedAaps,
    inputMode: resolution.mode,
    environment: params.environment,
    fromDate: params.fromDate,
    toDate: params.toDate,
    totalAaps: resolution.aapTargets.length,
    successfulAaps,
    emptyAaps,
    failedAaps,

    // Compatibilidad hacia atras: estos alias ahora son conteos de AAP.
    totalChannels: rows.length,
    successfulChannels: successfulAaps,
    emptyChannels: emptyAaps,
    failedChannels: failedAaps,
  };
}

export function formatCompactExecutions(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0;

  const format = (scaled: number, suffix: string) => {
    const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${scaled
      .toFixed(decimals)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*?)0+$/, "$1")} ${suffix}`;
  };

  if (safe >= 1_000_000_000) return format(safe / 1_000_000_000, "B");
  if (safe >= 1_000_000) return format(safe / 1_000_000, "M");
  if (safe >= 1_000) return format(safe / 1_000, "K");
  return Math.round(safe).toLocaleString("es-MX");
}
