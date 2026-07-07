import JSZip from "jszip";

import { apiRequest, buildAuthHeaders } from "./httpClient";
import { dateRangeToNano } from "./dateUtils";
import {
  buildChannelCodeFilter,
  buildCompoundQuery,
  buildInvokerTxFilter,
  buildMetricsUrl,
  buildSiteFilter,
  buildUtilityTypeFilter,
} from "./urlBuilder";
import type { ApxConsoleEnvironment } from "./apxCicsConsolaService";

export type DependencyComponentType = "ONLINE";

export type DependencyNodeKind =
  | "transaction"
  | "library"
  | "utility"
  | "binary"
  | "other";

export type DependencyPayload = {
  compName: string;
  up: boolean;
  allComponents: boolean;
  manualDepthLevel: number;
  type: DependencyComponentType;
};

export type RawDependencyProperty = {
  key?: string;
  value?: unknown;
};

export type RawDependencyNode = {
  id: number | string;
  version?: unknown;
  labels?: string[];
  primaryIndex?: unknown;
  generatedNode?: boolean;
  previousDynamicLabels?: string[];
  propertyList?: RawDependencyProperty[];
};

export type RawDependencyRelation = {
  id: number | string;
  version?: unknown;
  type?: string;
  startNode: number | string;
  endNode: number | string;
  primaryIdName?: unknown;
  propertyList?: RawDependencyProperty[];
};

export type RawDependencyTree = {
  nodes?: RawDependencyNode[];
  relations?: RawDependencyRelation[];
  nodBase?: RawDependencyNode;
};

type AggregationBucket = {
  bucket?: Record<string, string | number | undefined>;
  values?: Record<string, number | undefined>;
};

type AggregationResponse = {
  buckets?: AggregationBucket[];
  data?: AggregationBucket[];
  aggregations?: AggregationBucket[];
};

export type AteneaDependencyComparisonParams = {
  bearerToken?: string;
  fromDate?: Date;
  toDate?: Date;
  site?: string;
  channelCode?: string;
};

export type DependencyUtilityComparisonRow = {
  transactionName: string;
  utility: string;
  operationLibraries: string[];
  ateneaLibraries: string[];
  executingInAtenea: string[];
  missingInAtenea: string[];
};

export type DependencySqlMethod =
  | "SELECT"
  | "UPDATE"
  | "INSERT"
  | "DELETE"
  | "MERGE"
  | "UNKNOWN";

export type DependencyLibraryQuery = {
  name: string;
  sqlMethod: DependencySqlMethod;
  ateneaExecutions?: number;
  ateneaResponseTimeMs?: number;
};

export type DependencyAteneaQueryMetric = {
  queryName: string;
  executions: number;
  responseTimeMs: number;
};

export type DependencySqlSummaryItem = {
  method: DependencySqlMethod;
  count: number;
};

export type DependencyLibraryQueryInfo = {
  libraryName: string;
  implementationName: string;
  jarPath: string;
  propertiesFiles: string[];
  queries: DependencyLibraryQuery[];
  sqlSummary: DependencySqlSummaryItem[];
  executingQueriesInAtenea: DependencyLibraryQuery[];
  missingQueriesInAtenea: DependencyLibraryQuery[];
  error?: string;
};

export type DependencyUtilityRow = {
  transactionName: string;
  utility: string;
  libraryName: string;
  implementationName: string;
  uuaa: string;
  dependencies: string[];
  interfaceDependencies: string[];
  implementationDependencies: string[];
};

export type DependencyUtilityGroup = {
  utility: string;
  rows: DependencyUtilityRow[];
};

export type DependencyGraphNode = {
  id: string;
  name: string;
  kind: DependencyNodeKind;
  uuaa: string;
  generated?: boolean;
};

export type DependencyGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: string;
};

export type DependencyGraph = {
  transactionNodeId: string;
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
};

export type DependencyTransactionResult = {
  /** Nombre homologado para Atenea: sin guiones. Ej. KUSUT02201ZZ */
  transactionName: string;
  /** Nombre usado para Consola de Operaciones: con guiones. Ej. KUSUT022-01-ZZ */
  consoleTransactionName: string;
  payload: DependencyPayload;
  raw: RawDependencyTree[];
  utilityRows: DependencyUtilityRow[];
  utilityGroups: DependencyUtilityGroup[];
  ateneaLibraries: string[];
  comparisonRows: DependencyUtilityComparisonRow[];
  jdbcQueryInfos: DependencyLibraryQueryInfo[];
  ateneaQueryNames: string[];
  graph: DependencyGraph;
};

export type DependencyTreeResult = {
  environment: ApxConsoleEnvironment;
  transactions: DependencyTransactionResult[];
  utilityRows: DependencyUtilityRow[];
  utilityGroups: DependencyUtilityGroup[];
  comparisonRows: DependencyUtilityComparisonRow[];
  jdbcQueryInfos: DependencyLibraryQueryInfo[];
  ateneaQueryNames: string[];
};

const KNOWN_UTILITY_LABELS: Record<string, string> = {
  jdbc: "JDBC",
  cics: "CICS",
  "api-connector": "API-CONNECTOR",
  apiconnector: "API-CONNECTOR",
  "api_connector": "API-CONNECTOR",
  mongo: "MONGO",
  mongodb: "MONGO",
  "daas-mongo-connector": "MONGO",
  daasmongoconnector: "MONGO",
  grpc: "GRPC",
  titan: "TITAN",
};

const JAR_DOWNLOAD_TIMEOUT_MS = 180000;
const JAR_DOWNLOAD_MAX_RETRIES = 3;
const JAR_DOWNLOAD_RETRY_DELAY_MS = 1200;
const MAX_PARALLEL_JAR_DOWNLOADS = 2;


function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex], currentIndex);
      }
    }
  );

  await Promise.all(workers);

  return results;
}

function normalizeKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeTransactionForAtenea(value: unknown): string {
  return normalizeText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatTransactionForConsole(value: unknown): string {
  const normalized = normalizeTransactionForAtenea(value);

  if (normalized.length >= 12) {
    return [
      normalized.slice(0, 8),
      normalized.slice(8, 10),
      normalized.slice(10),
    ]
      .filter(Boolean)
      .join("-");
  }

  return normalized;
}

function normalizeUtilityKey(value: unknown): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
}

function compactUnique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => normalizeText(value)).filter(Boolean))
  );
}

function getProperty(node: RawDependencyNode | undefined, key: string): unknown {
  const properties = node?.propertyList ?? [];
  const wanted = normalizeKey(key);

  return properties.find((property) => normalizeKey(property.key) === wanted)
    ?.value;
}

function getStringProperty(node: RawDependencyNode | undefined, key: string): string {
  return normalizeText(getProperty(node, key));
}

function getStringArrayProperty(
  node: RawDependencyNode | undefined,
  key: string
): string[] {
  const value = getProperty(node, key);

  if (Array.isArray(value)) {
    return compactUnique(value.map((item) => normalizeText(item)));
  }

  if (typeof value === "string") {
    return compactUnique(
      value
        .split(/[;,\n]/g)
        .map((item) => item.trim())
    );
  }

  return [];
}

function getNodeName(node: RawDependencyNode | undefined): string {
  return (
    getStringProperty(node, "name") ||
    getStringProperty(node, "interfaceName") ||
    getStringProperty(node, "implementationName") ||
    normalizeText(node?.id)
  );
}

function getNodeUuaa(node: RawDependencyNode | undefined): string {
  return getStringProperty(node, "uuaa");
}

function getNodeDeclaredType(node: RawDependencyNode | undefined): string {
  return getStringProperty(node, "type").toUpperCase();
}

function getNodeKind(node: RawDependencyNode | undefined): DependencyNodeKind {
  const labels = (node?.labels ?? []).map((label) => label.toLowerCase());
  const type = getNodeDeclaredType(node);

  if (labels.includes("transaction") || type === "TRANSACTION") {
    return "transaction";
  }

  if (labels.includes("library") || type.includes("LIBRARY")) {
    return "library";
  }

  if (labels.includes("utility") || type === "UTILITY") {
    return "utility";
  }

  if (labels.includes("binary") || type === "BINARY") {
    return "binary";
  }

  return "other";
}

function isApxComponentName(value: string): boolean {
  const normalized = value.trim().toUpperCase();

  /**
   * Las UUAA pueden traer números, por ejemplo W1BD.
   * Antes se exigían 4 letras al inicio y valores como W1BDR001
   * se confundían con utilities.
   */
  return /^[A-Z0-9]{4}[A-Z0-9]{4,}$/i.test(normalized);
}

type DependencyNodeIndexes = {
  nodeByName: Map<string, RawDependencyNode>;
  utilityNodeByName: Map<string, RawDependencyNode>;
};

function buildDependencyNodeIndexes(
  trees: RawDependencyTree[]
): DependencyNodeIndexes {
  const nodeByName = new Map<string, RawDependencyNode>();
  const utilityNodeByName = new Map<string, RawDependencyNode>();

  for (const tree of trees) {
    for (const node of tree.nodes ?? []) {
      const name = getNodeName(node);
      const key = normalizeUtilityKey(name);

      if (!key) {
        continue;
      }

      nodeByName.set(key, node);

      if (getNodeKind(node) === "utility") {
        utilityNodeByName.set(key, node);
      }
    }
  }

  return { nodeByName, utilityNodeByName };
}

function utilityLabelFromKnownUtility(value: string): string | null {
  const normalized = normalizeUtilityKey(value);

  if (!normalized) {
    return null;
  }

  if (KNOWN_UTILITY_LABELS[normalized]) {
    return KNOWN_UTILITY_LABELS[normalized];
  }

  if (normalized.includes("jdbc")) return "JDBC";
  if (normalized.includes("mongo")) return "MONGO";
  if (normalized.includes("cics")) return "CICS";
  if (normalized.includes("api") && normalized.includes("connector")) {
    return "API-CONNECTOR";
  }
  if (normalized.includes("grpc")) return "GRPC";
  if (normalized.includes("titan")) return "TITAN";

  return null;
}

function utilityLabelFromDependency(
  value: string,
  indexes: DependencyNodeIndexes
): string | null {
  const normalized = normalizeUtilityKey(value);

  if (!normalized) {
    return null;
  }

  /**
   * Regla principal: solo es utility si en el JSON existe como nodo Utility.
   * implementationDependencies puede traer mezcladas librerías y utilities.
   */
  const utilityNode = indexes.utilityNodeByName.get(normalized);

  if (utilityNode) {
    return utilityLabelFromKnownUtility(getNodeName(utilityNode)) ||
      getNodeName(utilityNode).toUpperCase();
  }

  /**
   * Si existe como nodo pero NO es Utility, entonces es Library/Binary/Transaction.
   * No debe agregarse como utilidad.
   */
  const dependencyNode = indexes.nodeByName.get(normalized);

  if (dependencyNode && getNodeKind(dependencyNode) !== "utility") {
    return null;
  }

  /**
   * Fallback solo para nombres técnicos de utilities conocidas.
   * Nunca devolvemos el texto crudo como utilidad porque eso convierte
   * librerías como W1BDR001 o MPBDR300 en utilities.
   */
  return utilityLabelFromKnownUtility(value);
}

function extractDependencyTreeItems(payload: unknown): RawDependencyTree[] {
  if (Array.isArray(payload)) {
    return payload as RawDependencyTree[];
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;

    if (Array.isArray(obj.data)) {
      return obj.data as RawDependencyTree[];
    }

    if (Array.isArray(obj.result)) {
      return obj.result as RawDependencyTree[];
    }

    if (Array.isArray(obj.items)) {
      return obj.items as RawDependencyTree[];
    }
  }

  return [];
}

function groupUtilityRows(rows: DependencyUtilityRow[]): DependencyUtilityGroup[] {
  const grouped = new Map<string, DependencyUtilityRow[]>();

  for (const row of rows) {
    const current = grouped.get(row.utility) ?? [];
    current.push(row);
    grouped.set(row.utility, current);
  }

  return Array.from(grouped.entries())
    .map(([utility, groupRows]) => ({
      utility,
      rows: groupRows.sort((a, b) => {
        const byTransaction = a.transactionName.localeCompare(b.transactionName);
        if (byTransaction !== 0) return byTransaction;
        return a.libraryName.localeCompare(b.libraryName);
      }),
    }))
    .sort((a, b) => a.utility.localeCompare(b.utility));
}

function extractBuckets(
  res: AggregationResponse & { buckets?: AggregationBucket[] }
): AggregationBucket[] {
  return res.buckets ?? res.data ?? res.aggregations ?? [];
}

function normalizeLibraryKey(value: string): string {
  return normalizeText(value).toUpperCase();
}

function normalizeQueryNameKey(value: string): string {
  return normalizeText(value).toUpperCase();
}

function getBucketTextValue(bucket: AggregationBucket, keys: string[]): string {
  for (const key of keys) {
    const value = bucket.bucket?.[key];

    if (value !== undefined && value !== null && String(value).trim()) {
      return normalizeText(value);
    }
  }

  return "";
}

function getBucketNumberValue(bucket: AggregationBucket, keys: string[]): number {
  for (const key of keys) {
    const value = bucket.values?.[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function sortByName(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}


const SQL_METHOD_ORDER: DependencySqlMethod[] = [
  "SELECT",
  "UPDATE",
  "INSERT",
  "DELETE",
  "MERGE",
  "UNKNOWN",
];

function normalizeSqlText(value: string): string {
  return value
    .replace(/--.*$/gm, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSqlMethod(sql: string): DependencySqlMethod {
  const normalized = normalizeSqlText(sql).toUpperCase();

  if (!normalized) return "UNKNOWN";
  if (/^SELECT\b/.test(normalized)) return "SELECT";
  if (/^WITH\b/.test(normalized)) return "SELECT";
  if (/^UPDATE\b/.test(normalized)) return "UPDATE";
  if (/^INSERT\b/.test(normalized)) return "INSERT";
  if (/^DELETE\b/.test(normalized)) return "DELETE";
  if (/^MERGE\b/.test(normalized)) return "MERGE";

  const found = normalized.match(/\b(SELECT|UPDATE|INSERT|DELETE|MERGE)\b/);

  return (found?.[1] as DependencySqlMethod | undefined) ?? "UNKNOWN";
}

function extractSqlFromPropertiesValue(value: string): string {
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    return "";
  }

  /**
   * Formato real del .properties:
   * KUSU.readCoexistenceData=db2;SELECT ...
   *
   * Lo que está antes del ; es el datasource/motor.
   * El SQL real empieza después del primer ;.
   */
  const semicolonIndex = rawValue.indexOf(";");

  if (semicolonIndex >= 0) {
    return rawValue.slice(semicolonIndex + 1).trim();
  }

  return rawValue;
}

function buildQueryFromPropertiesEntry(entry: {
  key: string;
  value: string;
}): DependencyLibraryQuery | null {
  const queryName = normalizeText(entry.key);
  const sql = extractSqlFromPropertiesValue(entry.value);
  const sqlMethod = detectSqlMethod(sql);

  if (!queryName || !sql || sqlMethod === "UNKNOWN") {
    return null;
  }

  return {
    name: queryName,
    sqlMethod,
  };
}

function parsePropertiesEntries(content: string): Array<{ key: string; value: string }> {
  const logicalLines: string[] = [];
  let current = "";

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trimEnd();
    const slashCount = (line.match(/\\+$/)?.[0].length ?? 0);
    const continues = slashCount % 2 === 1;
    const lineWithoutContinuation = continues ? line.slice(0, -1) : line;

    current += current ? lineWithoutContinuation.trimStart() : lineWithoutContinuation;

    if (continues) {
      continue;
    }

    logicalLines.push(current);
    current = "";
  }

  if (current) {
    logicalLines.push(current);
  }

  return logicalLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
    .map((line) => {
      const separatorMatch = line.match(/(?<!\\)(=|:)/);
      let key = "";
      let value = "";

      if (separatorMatch?.index !== undefined) {
        key = line.slice(0, separatorMatch.index).trim();
        value = line.slice(separatorMatch.index + 1).trim();
      } else {
        const whitespaceMatch = line.match(/\s+/);

        if (whitespaceMatch?.index !== undefined) {
          key = line.slice(0, whitespaceMatch.index).trim();
          value = line.slice(whitespaceMatch.index).trim();
        } else {
          key = line.trim();
        }
      }

      return {
        key: key.replace(/\\([:=\s])/g, "$1"),
        value,
      };
    })
    .filter((entry) => Boolean(entry.key));
}

function buildSqlSummary(queries: DependencyLibraryQuery[]): DependencySqlSummaryItem[] {
  const counts = new Map<DependencySqlMethod, number>();

  for (const query of queries) {
    counts.set(query.sqlMethod, (counts.get(query.sqlMethod) ?? 0) + 1);
  }

  return SQL_METHOD_ORDER
    .map((method) => ({ method, count: counts.get(method) ?? 0 }))
    .filter((item) => item.count > 0);
}

async function fetchJarArrayBuffer(params: {
  environment: ApxConsoleEnvironment;
  sessionCookie?: string;
  implementationName: string;
}): Promise<ArrayBuffer> {
  const { environment, sessionCookie, implementationName } = params;
  const jarPath = `app/onlinelibs/${implementationName}.jar`;
  const url = `/apx-console/${environment}/bucketcomponents/download?name=${encodeURIComponent(jarPath)}`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= JAR_DOWNLOAD_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      JAR_DOWNLOAD_TIMEOUT_MS
    );

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-session-cookie": sessionCookie?.trim() || "",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `HTTP ${response.status} ${response.statusText} - ${body.slice(0, 300)}`
        );
      }

      return await response.arrayBuffer();
    } catch (error) {
      lastError = error;

      const message = isAbortError(error)
        ? `Timeout descargando JAR de Consola APX (${JAR_DOWNLOAD_TIMEOUT_MS} ms)`
        : error instanceof Error
          ? error.message
          : "Error desconocido descargando JAR";

      console.warn("[Dependency Tree] Error descargando JAR", {
        implementationName,
        jarPath,
        attempt,
        maxRetries: JAR_DOWNLOAD_MAX_RETRIES,
        message,
      });

      if (attempt < JAR_DOWNLOAD_MAX_RETRIES) {
        await wait(JAR_DOWNLOAD_RETRY_DELAY_MS * attempt);
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  const lastMessage = lastError instanceof Error
    ? lastError.message
    : "Error desconocido descargando JAR";

  throw new Error(
    `No se pudo descargar ${jarPath} después de ${JAR_DOWNLOAD_MAX_RETRIES} intentos. Último error: ${lastMessage}`
  );
}

async function extractQueriesFromJar(params: {
  environment: ApxConsoleEnvironment;
  sessionCookie?: string;
  libraryName: string;
  implementationName: string;
}): Promise<DependencyLibraryQueryInfo> {
  const { environment, sessionCookie, libraryName, implementationName } = params;
  const jarPath = `app/onlinelibs/${implementationName}.jar`;

  try {
    const buffer = await fetchJarArrayBuffer({
      environment,
      sessionCookie,
      implementationName,
    });
    const zip = await JSZip.loadAsync(buffer);
    const propertiesFiles = Object.values(zip.files).filter(
      (file) => !file.dir && file.name.toLowerCase().endsWith(".properties")
    );

    const queriesByName = new Map<string, DependencyLibraryQuery>();

    for (const file of propertiesFiles) {
      const content = await file.async("string");
      const entries = parsePropertiesEntries(content);

      for (const entry of entries) {
        const query = buildQueryFromPropertiesEntry(entry);

        if (!query) {
          continue;
        }

        queriesByName.set(query.name, query);
      }
    }

    const queries = Array.from(queriesByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return {
      libraryName,
      implementationName,
      jarPath,
      propertiesFiles: propertiesFiles.map((file) => file.name).sort(),
      queries,
      sqlSummary: buildSqlSummary(queries),
      executingQueriesInAtenea: [],
      missingQueriesInAtenea: queries,
    };
  } catch (error) {
    return {
      libraryName,
      implementationName,
      jarPath,
      propertiesFiles: [],
      queries: [],
      sqlSummary: [],
      executingQueriesInAtenea: [],
      missingQueriesInAtenea: [],
      error: error instanceof Error ? error.message : "Error desconocido leyendo JAR",
    };
  }
}

async function fetchJdbcQueryInfosForTransaction(params: {
  environment: ApxConsoleEnvironment;
  sessionCookie?: string;
  utilityRows: DependencyUtilityRow[];
}): Promise<DependencyLibraryQueryInfo[]> {
  const { environment, sessionCookie, utilityRows } = params;
  const libraries = new Map<
    string,
    { libraryName: string; implementationName: string }
  >();

  for (const row of utilityRows) {
    if (row.utility !== "JDBC") {
      continue;
    }

    const libraryName = normalizeText(row.libraryName);
    const implementationName = normalizeText(row.implementationName) || `${libraryName}IMPL`;

    if (!libraryName || !implementationName) {
      continue;
    }

    libraries.set(libraryName, { libraryName, implementationName });
  }

  const libraryItems = Array.from(libraries.values());

  const results = await mapWithConcurrency(
    libraryItems,
    MAX_PARALLEL_JAR_DOWNLOADS,
    async (library) => {
      try {
        return await extractQueriesFromJar({
          environment,
          sessionCookie,
          libraryName: library.libraryName,
          implementationName: library.implementationName,
        });
      } catch (error) {
        const implementationName = library.implementationName;

        return {
          libraryName: library.libraryName,
          implementationName,
          jarPath: `app/onlinelibs/${implementationName}.jar`,
          propertiesFiles: [],
          queries: [],
          sqlSummary: [],
          executingQueriesInAtenea: [],
          missingQueriesInAtenea: [],
          error: error instanceof Error
            ? error.message
            : "Error desconocido leyendo JAR",
        };
      }
    }
  );

  return results.sort((a, b) => a.libraryName.localeCompare(b.libraryName));
}

async function fetchAteneaLibrariesForTransaction(params: {
  transactionName: string;
  atenea?: AteneaDependencyComparisonParams;
}): Promise<string[]> {
  const { transactionName, atenea } = params;
  const ateneaTransactionName = normalizeTransactionForAtenea(transactionName);

  if (!atenea?.bearerToken?.trim() || !atenea.fromDate || !atenea.toDate) {
    return [];
  }

  const { from, to } = dateRangeToNano(atenea.fromDate, atenea.toDate);

  const q = buildCompoundQuery(
    buildSiteFilter(atenea.site),
    buildInvokerTxFilter(ateneaTransactionName),
    buildChannelCodeFilter(atenea.channelCode)
  );

  const url = buildMetricsUrl({
    metricSet: "utility-metric-set",
    method: "listAggregations",
    fromTimestamp: from,
    toTimestamp: to,
    propertiesSize: 20000,
    aggregate: "invokerLibrary",
    q,
    operations: ["count:utility_count"],
    baseUrl: "https://mu.live-02.nextgen.igrupobbva",
  });

  const response = await apiRequest<AggregationResponse>(url, {
    headers: buildAuthHeaders(atenea.bearerToken),
    timeoutMs: 45000,
  });

  return sortByName(
    compactUnique(
      extractBuckets(response).map((bucket) =>
        normalizeText(
          bucket.bucket?.invokerLibrary ??
            bucket.bucket?.["invokerLibrary"] ??
            bucket.bucket?.name ??
            ""
        )
      )
    )
  );
}

async function fetchAteneaQueryMetricsForTransaction(params: {
  transactionName: string;
  atenea?: AteneaDependencyComparisonParams;
}): Promise<DependencyAteneaQueryMetric[]> {
  const { transactionName, atenea } = params;
  const ateneaTransactionName = normalizeTransactionForAtenea(transactionName);

  if (!atenea?.bearerToken?.trim() || !atenea.fromDate || !atenea.toDate) {
    return [];
  }

  const { from, to } = dateRangeToNano(atenea.fromDate, atenea.toDate);

  const q = buildCompoundQuery(
    buildSiteFilter(atenea.site),
    buildInvokerTxFilter(ateneaTransactionName),
    buildChannelCodeFilter(atenea.channelCode),
    buildUtilityTypeFilter("Jdbc")
  );

  const url = buildMetricsUrl({
    metricSet: "utility-metric-set",
    method: "listAggregations",
    fromTimestamp: from,
    toTimestamp: to,
    propertiesSize: 20000,
    aggregate: "invokedparam",
    q,
    operations: ["count:utility_count", "mean:utility_duration"],
    baseUrl: "https://mu.live-02.nextgen.igrupobbva",
  });

  const response = await apiRequest<AggregationResponse>(url, {
    headers: buildAuthHeaders(atenea.bearerToken),
    timeoutMs: 45000,
  });

  const metricsByQuery = new Map<
    string,
    { queryName: string; executions: number; weightedDurationSum: number }
  >();

  for (const bucket of extractBuckets(response)) {
    const queryName = getBucketTextValue(bucket, [
      "invokedparam",
      "name",
    ]);

    if (!queryName) {
      continue;
    }

    const key = normalizeQueryNameKey(queryName);
    const executions = getBucketNumberValue(bucket, [
      "utility_count",
      "count_utility_count",
    ]);
    const responseTimeMs = getBucketNumberValue(bucket, [
      "mean_utility_duration",
      "utility_duration",
    ]);

    const current = metricsByQuery.get(key) ?? {
      queryName,
      executions: 0,
      weightedDurationSum: 0,
    };

    current.executions += executions;
    current.weightedDurationSum += responseTimeMs * Math.max(executions, 1);
    metricsByQuery.set(key, current);
  }

  return Array.from(metricsByQuery.values())
    .map((item) => ({
      queryName: item.queryName,
      executions: item.executions,
      responseTimeMs:
        item.executions > 0
          ? item.weightedDurationSum / item.executions
          : item.weightedDurationSum,
    }))
    .sort((a, b) => a.queryName.localeCompare(b.queryName));
}

function compareJdbcQueriesWithAtenea(params: {
  jdbcQueryInfos: DependencyLibraryQueryInfo[];
  ateneaQueryMetrics: DependencyAteneaQueryMetric[];
}): DependencyLibraryQueryInfo[] {
  const { jdbcQueryInfos, ateneaQueryMetrics } = params;
  const ateneaQueryMetricsByName = new Map(
    ateneaQueryMetrics.map((metric) => [normalizeQueryNameKey(metric.queryName), metric])
  );

  return jdbcQueryInfos.map((info) => {
    if (info.error) {
      return {
        ...info,
        executingQueriesInAtenea: [],
        missingQueriesInAtenea: [],
      };
    }

    const executingQueriesInAtenea = info.queries
      .filter((query) => ateneaQueryMetricsByName.has(normalizeQueryNameKey(query.name)))
      .map((query) => {
        const metric = ateneaQueryMetricsByName.get(normalizeQueryNameKey(query.name));

        return {
          ...query,
          ateneaExecutions: metric?.executions ?? 0,
          ateneaResponseTimeMs: metric?.responseTimeMs ?? 0,
        };
      });

    const missingQueriesInAtenea = info.queries.filter(
      (query) => !ateneaQueryMetricsByName.has(normalizeQueryNameKey(query.name))
    );

    return {
      ...info,
      executingQueriesInAtenea,
      missingQueriesInAtenea,
    };
  });
}

function buildComparisonRowsForTransaction(params: {
  transactionName: string;
  utilityRows: DependencyUtilityRow[];
  ateneaLibraries: string[];
}): DependencyUtilityComparisonRow[] {
  const { transactionName, utilityRows, ateneaLibraries } = params;
  const rowsByUtility = new Map<string, string[]>();
  const ateneaSet = new Set(ateneaLibraries.map(normalizeLibraryKey));

  for (const row of utilityRows) {
    const utility = row.utility || "SIN UTILIDAD";
    const current = rowsByUtility.get(utility) ?? [];
    current.push(row.libraryName);
    rowsByUtility.set(utility, current);
  }

  return Array.from(rowsByUtility.entries())
    .map(([utility, libraries]) => {
      const operationLibraries = sortByName(compactUnique(libraries));
      const executingInAtenea = operationLibraries.filter((library) =>
        ateneaSet.has(normalizeLibraryKey(library))
      );

      const missingInAtenea = operationLibraries.filter(
        (library) => !ateneaSet.has(normalizeLibraryKey(library))
      );

      return {
        transactionName,
        utility,
        operationLibraries,
        ateneaLibraries,
        executingInAtenea,
        missingInAtenea,
      };
    })
    .sort((a, b) => a.utility.localeCompare(b.utility));
}

function buildUtilityRowsForTransaction(
  transactionName: string,
  trees: RawDependencyTree[]
): DependencyUtilityRow[] {
  const rows: DependencyUtilityRow[] = [];
  const seenRows = new Set<string>();
  const indexes = buildDependencyNodeIndexes(trees);

  for (const tree of trees) {
    for (const node of tree.nodes ?? []) {
      if (getNodeKind(node) !== "library") {
        continue;
      }

      const implementationDependencies = getStringArrayProperty(
        node,
        "implementationDependencies"
      );

      if (!implementationDependencies.length) {
        continue;
      }

      const libraryName = getNodeName(node);
      const implementationName = getStringProperty(node, "implementationName");
      const uuaa = getNodeUuaa(node);
      const dependencies = getStringArrayProperty(node, "dependencies");
      const interfaceDependencies = getStringArrayProperty(
        node,
        "interfaceDependencies"
      );

      for (const dependency of implementationDependencies) {
        const utility = utilityLabelFromDependency(dependency, indexes);

        if (!utility) {
          continue;
        }

        const rowKey = [transactionName, utility, libraryName].join("|");

        if (seenRows.has(rowKey)) {
          continue;
        }

        seenRows.add(rowKey);

        rows.push({
          transactionName,
          utility,
          libraryName,
          implementationName,
          uuaa,
          dependencies,
          interfaceDependencies,
          implementationDependencies,
        });
      }
    }
  }

  return rows.sort((a, b) => {
    const byUtility = a.utility.localeCompare(b.utility);
    if (byUtility !== 0) return byUtility;
    return a.libraryName.localeCompare(b.libraryName);
  });
}

function pushGraphNode(
  nodes: Map<string, DependencyGraphNode>,
  node: DependencyGraphNode
): void {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
}

function pushGraphEdge(
  edges: Map<string, DependencyGraphEdge>,
  edge: DependencyGraphEdge
): void {
  if (!edges.has(edge.id)) {
    edges.set(edge.id, edge);
  }
}

function buildGraphForTransaction(
  transactionName: string,
  trees: RawDependencyTree[]
): DependencyGraph {
  const graphNodes = new Map<string, DependencyGraphNode>();
  const graphEdges = new Map<string, DependencyGraphEdge>();
  const rawNodeById = new Map<string, RawDependencyNode>();
  const rawUtilityNodeByName = new Map<string, RawDependencyNode>();
  const indexes = buildDependencyNodeIndexes(trees);

  for (const tree of trees) {
    for (const node of tree.nodes ?? []) {
      const id = normalizeText(node.id);
      if (!id) continue;

      rawNodeById.set(id, node);

      if (getNodeKind(node) === "utility") {
        rawUtilityNodeByName.set(normalizeUtilityKey(getNodeName(node)), node);
      }
    }
  }

  let transactionNodeId = "transaction:base";

  for (const tree of trees) {
    const baseNode = tree.nodBase;
    const baseId = normalizeText(baseNode?.id);

    if (baseId) {
      transactionNodeId = baseId;

      pushGraphNode(graphNodes, {
        id: baseId,
        name: getNodeName(baseNode) || transactionName,
        kind: "transaction",
        uuaa: getNodeUuaa(baseNode),
      });
    }
  }

  if (!graphNodes.has(transactionNodeId)) {
    pushGraphNode(graphNodes, {
      id: transactionNodeId,
      name: transactionName,
      kind: "transaction",
      uuaa: transactionName.slice(0, 4),
    });
  }

  for (const [id, node] of rawNodeById.entries()) {
    const kind = getNodeKind(node);

    if (!["transaction", "library", "utility"].includes(kind)) {
      continue;
    }

    pushGraphNode(graphNodes, {
      id,
      name: getNodeName(node),
      kind,
      uuaa: getNodeUuaa(node),
      generated: Boolean(node.generatedNode),
    });
  }

  for (const tree of trees) {
    for (const relation of tree.relations ?? []) {
      const source = normalizeText(relation.startNode);
      const target = normalizeText(relation.endNode);
      const type = normalizeText(relation.type);

      if (!source || !target) continue;
      if (!graphNodes.has(source) || !graphNodes.has(target)) continue;
      if (type === "BINARY_TO") continue;

      pushGraphEdge(graphEdges, {
        id: `relation:${relation.id}`,
        source,
        target,
        label: type.replace(/_/g, " "),
        type,
      });
    }
  }

  for (const [libraryId, node] of rawNodeById.entries()) {
    if (getNodeKind(node) !== "library") {
      continue;
    }

    const implementationDependencies = getStringArrayProperty(
      node,
      "implementationDependencies"
    );

    for (const dependency of implementationDependencies) {
      const utility = utilityLabelFromDependency(dependency, indexes);

      if (!utility) {
        continue;
      }

      const utilityKey = normalizeUtilityKey(dependency);
      const existingUtility = rawUtilityNodeByName.get(utilityKey);
      const utilityId = existingUtility
        ? normalizeText(existingUtility.id)
        : `utility:${utility}`;

      pushGraphNode(graphNodes, {
        id: utilityId,
        name: utility,
        kind: "utility",
        uuaa: existingUtility ? getNodeUuaa(existingUtility) : "ARCH",
        generated: !existingUtility,
      });

      pushGraphEdge(graphEdges, {
        id: `implementation:${libraryId}:${utilityId}`,
        source: libraryId,
        target: utilityId,
        label: "usa",
        type: "IMPLEMENTATION_TO_UTILITY",
      });
    }
  }

  return {
    transactionNodeId,
    nodes: Array.from(graphNodes.values()),
    edges: Array.from(graphEdges.values()),
  };
}

async function fetchDependencyTreeForTransaction(params: {
  environment: ApxConsoleEnvironment;
  sessionCookie?: string;
  transactionName: string;
  manualDepthLevel: number;
  atenea?: AteneaDependencyComparisonParams;
}): Promise<DependencyTransactionResult> {
  const {
    environment,
    sessionCookie,
    transactionName,
    manualDepthLevel,
    atenea,
  } = params;

  const ateneaTransactionName = normalizeTransactionForAtenea(transactionName);
  const consoleTransactionName = formatTransactionForConsole(transactionName);

  const payload: DependencyPayload = {
    compName: consoleTransactionName,
    up: false,
    allComponents: true,
    manualDepthLevel,
    type: "ONLINE",
  };

  const response = await apiRequest<unknown>(
    `/apx-console/${environment}/dependency-tree/dependencies`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-session-cookie": sessionCookie?.trim() || "",
      },
      body: JSON.stringify(payload),
      timeoutMs: 45000,
    }
  );

  const raw = extractDependencyTreeItems(response);
  const utilityRows = buildUtilityRowsForTransaction(ateneaTransactionName, raw);
  const [
    ateneaLibrariesResult,
    ateneaQueryMetricsResult,
    rawJdbcQueryInfosResult,
  ] = await Promise.allSettled([
    fetchAteneaLibrariesForTransaction({
      transactionName: ateneaTransactionName,
      atenea,
    }),
    fetchAteneaQueryMetricsForTransaction({
      transactionName: ateneaTransactionName,
      atenea,
    }),
    fetchJdbcQueryInfosForTransaction({
      environment,
      sessionCookie,
      utilityRows,
    }),
  ]);

  if (ateneaLibrariesResult.status === "rejected") {
    console.warn("[Dependency Tree] Error consultando librerías Atenea", {
      transactionName: ateneaTransactionName,
      error: ateneaLibrariesResult.reason,
    });
  }

  if (ateneaQueryMetricsResult.status === "rejected") {
    console.warn("[Dependency Tree] Error consultando queries Atenea", {
      transactionName: ateneaTransactionName,
      error: ateneaQueryMetricsResult.reason,
    });
  }

  if (rawJdbcQueryInfosResult.status === "rejected") {
    console.warn("[Dependency Tree] Error consultando properties JDBC", {
      transactionName: ateneaTransactionName,
      error: rawJdbcQueryInfosResult.reason,
    });
  }

  const ateneaLibraries = ateneaLibrariesResult.status === "fulfilled"
    ? ateneaLibrariesResult.value
    : [];

  const ateneaQueryMetrics = ateneaQueryMetricsResult.status === "fulfilled"
    ? ateneaQueryMetricsResult.value
    : [];

  const rawJdbcQueryInfos = rawJdbcQueryInfosResult.status === "fulfilled"
    ? rawJdbcQueryInfosResult.value
    : [];

  const ateneaQueryNames = sortByName(
    compactUnique(ateneaQueryMetrics.map((metric) => metric.queryName))
  );

  const jdbcQueryInfos = compareJdbcQueriesWithAtenea({
    jdbcQueryInfos: rawJdbcQueryInfos,
    ateneaQueryMetrics,
  });

  return {
    transactionName: ateneaTransactionName,
    consoleTransactionName,
    payload,
    raw,
    utilityRows,
    utilityGroups: groupUtilityRows(utilityRows),
    ateneaLibraries,
    ateneaQueryNames,
    comparisonRows: buildComparisonRowsForTransaction({
      transactionName: ateneaTransactionName,
      utilityRows,
      ateneaLibraries,
    }),
    jdbcQueryInfos,
    graph: buildGraphForTransaction(consoleTransactionName, raw),
  };
}

export function parseTransactionList(value: string): string[] {
  return compactUnique(
    value
      .split(/[\n,;\t ]+/g)
      .map(normalizeTransactionForAtenea)
      .filter(Boolean)
  );
}

export async function fetchDependencyTreeForTransactions(params: {
  environment: ApxConsoleEnvironment;
  sessionCookie?: string;
  transactions: string[];
  manualDepthLevel?: number;
  atenea?: AteneaDependencyComparisonParams;
}): Promise<DependencyTreeResult> {
  const {
    environment,
    sessionCookie,
    transactions,
    manualDepthLevel = 1,
    atenea,
  } = params;

  const cleanTransactions = compactUnique(
    transactions.map(normalizeTransactionForAtenea)
  );

  const results = await Promise.all(
    cleanTransactions.map((transactionName) =>
      fetchDependencyTreeForTransaction({
        environment,
        sessionCookie,
        transactionName,
        manualDepthLevel,
        atenea,
      })
    )
  );

  const utilityRows = results.flatMap((result) => result.utilityRows);
  const comparisonRows = results.flatMap((result) => result.comparisonRows);
  const jdbcQueryInfos = results.flatMap((result) => result.jdbcQueryInfos);
  const ateneaQueryNames = sortByName(
    compactUnique(results.flatMap((result) => result.ateneaQueryNames))
  );

  return {
    environment,
    transactions: results,
    utilityRows,
    utilityGroups: groupUtilityRows(utilityRows),
    comparisonRows,
    jdbcQueryInfos,
    ateneaQueryNames,
  };
}
