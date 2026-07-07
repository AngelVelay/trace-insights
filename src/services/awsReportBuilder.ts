import { CHANNEL_CODES, type MetricRow } from "@/types/bbva";

type InvokerTxMeta = {
  invokerTx: string;
  sum_num_executions: number;
  mean_span_duration: number;
  sum_functional_error?: number;
  sum_technical_error?: number;
};

type UtilityBlock = {
  invokerLibrary?: string;
  utilitytype?: string;
  count?: number;
};

type InvokedParamBlock = {
  invokerLibrary?: string;
  utilitytype?: string;
  invokedparam?: string;
  count?: number;
  maxDuration?: number;
};

type RiskLevel = "BAJO" | "MEDIO" | "ALTO";

type RiskAssessment = {
  level: RiskLevel;
  emoji: string;
  score: number;
  motive: string;
};

const BRS_AVAILABLE_UTILITIES = new Set([
  "Jdbc",
  "Jpa",
  "TitanClient",
  "APIInternalConnectorImpl",
]);

const DB_MODIFIER_METHODS = ["INSERT", "UPDATE", "DELETE"];

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "string" || value === "-") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseInvokerTxMeta(value: unknown): InvokerTxMeta | null {
  if (!value || typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as Partial<InvokerTxMeta>;

    if (!parsed.invokerTx) return null;

    return {
      invokerTx: String(parsed.invokerTx),
      sum_num_executions: Number(parsed.sum_num_executions ?? 0),
      mean_span_duration: Number(parsed.mean_span_duration ?? 0),
      sum_functional_error: Number(parsed.sum_functional_error ?? 0),
      sum_technical_error: Number(parsed.sum_technical_error ?? 0),
    };
  } catch {
    return null;
  }
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString("en-US");
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "0.00ms";

  if (value < 1000) {
    return `${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}ms`;
  }

  return `${(value / 1000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}s`;
}

function getChannelName(channelCode?: string): string {
  const cleanChannel = String(channelCode ?? "").trim();

  if (!cleanChannel || cleanChannel === "-") {
    return "-";
  }

  const channel = CHANNEL_CODES.find(
    (item) => item.channelCode === cleanChannel
  );

  if (!channel) return cleanChannel;

  const firstAppName = channel.applications?.[0]?.name?.trim();

  return firstAppName || channel.name || cleanChannel;
}

function getTotalErrors(meta: InvokerTxMeta | null): number {
  return (
    Number(meta?.sum_functional_error ?? 0) +
    Number(meta?.sum_technical_error ?? 0)
  );
}

function extractLastTraceValue(trace: string, regex: RegExp): string {
  const matches = [...String(trace ?? "").matchAll(regex)];
  const lastMatch = matches[matches.length - 1];

  return lastMatch?.[1]?.trim() || "";
}

function extractTotalJumps(trace: string): number {
  const value = extractLastTraceValue(
    trace,
    /Total de saltos encontrados:\s*(\d+)/gi
  );

  return value ? Number(value) : 0;
}

function extractTraceJumpTime(trace: string): string {
  return extractLastTraceValue(
    trace,
    /Tiempo total de saltos:\s*([0-9,.]+\s*(?:ms|s)?)/gi
  );
}

function extractExpectedAwsTime(trace: string): string {
  return (
    extractLastTraceValue(
      trace,
      /Total de Tiempo Esperado en AWS:\s*([0-9,.]+\s*(?:ms|s)?)/gi
    ) || "-"
  );
}

function extractSection(trace: string, title: string): string {
  const text = String(trace ?? "");

  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `${escapedTitle}([\\s\\S]*?)(?:\\n(?:CICS|JDBC|JPA|MONGO CONNECTOR|API-CONNECTOR INTERNO|API-CONNECTOR EXTERNO|API-CONNECTOR|TITAN CLIENT|GRPC CLIENT|OTROS|🔵)\\n|$)`,
    "i"
  );

  const match = text.match(regex);

  return match?.[1] ?? "";
}

function extractJdbcBlock(trace: string): string {
  return extractSection(trace, "JDBC");
}

function extractMongoBlock(trace: string): string {
  return extractSection(trace, "MONGO CONNECTOR");
}

function extractCicsBlock(trace: string): string {
  return extractSection(trace, "CICS");
}

function extractJdbcMethods(trace: string): string[] {
  const block = extractJdbcBlock(trace);

  if (!block.trim()) {
    return [];
  }

  const methods = new Set<string>();

  for (const method of ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE"]) {
    const regex = new RegExp(`\\b${method}\\s*:\\s*\\d+\\s*saltos`, "i");

    if (regex.test(block)) {
      methods.add(method);
    }
  }

  return Array.from(methods);
}

function extractMongoOperations(trace: string): string[] {
  const block = extractMongoBlock(trace);

  if (!block.trim()) {
    return [];
  }

  const operations = new Set<string>();

  for (const op of [
    "FIND",
    "INSERT",
    "INSERT_ONE",
    "INSERT_MANY",
    "UPDATE",
    "UPDATE_ONE",
    "UPDATE_MANY",
    "DELETE",
    "DELETE_ONE",
    "DELETE_MANY",
    "AGGREGATE",
  ]) {
    const regex = new RegExp(`\\b${op}\\b`, "i");

    if (regex.test(block)) {
      operations.add(op);
    }
  }

  return Array.from(operations);
}

function getUtilityTypes(row: MetricRow): string[] {
  const utilities = safeJsonParse<UtilityBlock[]>(row.utilitytype, []);

  return Array.from(
    new Set(
      utilities
        .map((item) => String(item.utilitytype ?? "").trim())
        .filter(Boolean)
    )
  );
}

function getInvokedParams(row: MetricRow): InvokedParamBlock[] {
  return safeJsonParse<InvokedParamBlock[]>(row.invokedparam, []);
}

function hasUtility(row: MetricRow, utilityType: string): boolean {
  return getUtilityTypes(row).includes(utilityType);
}

function extractCicsTxHostsFromRow(row: MetricRow): string[] {
  const invokedParams = getInvokedParams(row);
  const values = new Set<string>();

  for (const item of invokedParams) {
    const utilitytype = String(item.utilitytype ?? "").trim();
    const invokedparam = String(item.invokedparam ?? "").trim();

    if (utilitytype === "InterBackendCics" && invokedparam) {
      values.add(invokedparam);
    }
  }

  return Array.from(values);
}

function extractCicsTxHostsFromTrace(trace: string): string[] {
  const block = extractCicsBlock(trace);
  const values = new Set<string>();

  /**
   * Este valor corresponde a properties.invokedparam:
   * InterBackendCics[MCNH_WYEV_CICS]
   */
  const connectorMatches = [...block.matchAll(/InterBackendCics\[(.*?)\]/gim)];

  for (const match of connectorMatches) {
    const value = match[1]?.trim();

    if (value) {
      values.add(value);
    }
  }

  /**
   * Fallback: toma nodos terminales del bloque CICS.
   */
  if (!values.size) {
    const nodeMatches = [...block.matchAll(/└──\s*([A-Za-z0-9_.-]+)\s*$/gim)];

    for (const match of nodeMatches) {
      const value = match[1]?.trim();

      if (value && !value.includes("InterBackendCics")) {
        values.add(value);
      }
    }
  }

  return Array.from(values);
}

function getCicsTxHosts(row: MetricRow, trace: string): string[] {
  const fromRow = extractCicsTxHostsFromRow(row);

  if (fromRow.length > 0) {
    return fromRow;
  }

  return extractCicsTxHostsFromTrace(trace);
}

function hasElastic(row: MetricRow, trace: string): boolean {
  const utilityTypes = getUtilityTypes(row);

  if (
    utilityTypes.some((utility) =>
      utility.toLowerCase().includes("elastic")
    )
  ) {
    return true;
  }

  return /elastic/i.test(String(trace ?? ""));
}

function extractElasticDependencies(trace: string): string[] {
  const text = String(trace ?? "");
  const values = new Set<string>();

  const apiInternalElastic = [
    ...text.matchAll(/APIInternalConnectorImpl\[(elastic\.[^\]]+)\]/gi),
  ].map((match) => match[1]);

  for (const item of apiInternalElastic) {
    if (item?.trim()) values.add(item.trim());
  }

  const genericElastic = [
    ...text.matchAll(/elastic\.[A-Za-z0-9_.-]+/gi),
  ].map((match) => match[0]);

  for (const item of genericElastic) {
    if (item?.trim()) values.add(item.trim());
  }

  return Array.from(values);
}

function getUnavailableUtilitiesForBrs(row: MetricRow, trace: string): string[] {
  const utilityTypes = getUtilityTypes(row);
  const unavailable = new Set<string>();

  for (const utility of utilityTypes) {
    if (!BRS_AVAILABLE_UTILITIES.has(utility)) {
      unavailable.add(utility);
    }
  }

  if (hasElastic(row, trace)) {
    unavailable.add("ELASTIC");
  }

  return Array.from(unavailable);
}

function getDbModifierMethods(trace: string): string[] {
  const jdbcMethods = extractJdbcMethods(trace);

  return jdbcMethods.filter((method) => DB_MODIFIER_METHODS.includes(method));
}

function getRiskEmoji(level: RiskLevel): string {
  if (level === "ALTO") return "🔴";
  if (level === "MEDIO") return "🟡";
  return "🟢";
}

function assessAwsRisk(row: MetricRow, trace: string): RiskAssessment {
  const meta = parseInvokerTxMeta(row.invokerTx);

  const totalJumps = extractTotalJumps(trace);
  const executions = Number(meta?.sum_num_executions ?? row.utility_count ?? 0);
  const dbModifiers = getDbModifierMethods(trace).filter((method) =>
    ["INSERT", "UPDATE", "DELETE"].includes(method)
  );

  const hasMongo = hasUtility(row, "DaasMongoConnector");
  const hasCics = hasUtility(row, "InterBackendCics");
  const hasApiExternal = hasUtility(row, "APIExternalConnectorImpl");
  const containsElastic = hasElastic(row, trace);
  const unavailableUtilities = getUnavailableUtilitiesForBrs(row, trace);

  const highReasons: string[] = [];

  if (hasMongo) highReasons.push("Tiene Mongo");
  if (containsElastic) highReasons.push("Tiene ELASTIC");

  if (unavailableUtilities.length > 0) {
    highReasons.push(
      `Tiene utilities no disponibles en BRS: ${unavailableUtilities.join(
        ", "
      )}`
    );
  }

  if (totalJumps > 10) {
    highReasons.push(`Tiene más de 10 saltos: ${totalJumps}`);
  }

  if (highReasons.length > 0) {
    const score = Math.min(
      100,
      (hasMongo ? 30 : 0) +
      (containsElastic ? 30 : 0) +
      (unavailableUtilities.length > 0 ? 25 : 0) +
      (totalJumps > 10 ? 20 : 0)
    );

    return {
      level: "ALTO",
      emoji: getRiskEmoji("ALTO"),
      score,
      motive: highReasons.join(" + "),
    };
  }

  const mediumReasons: string[] = [];

  if (totalJumps >= 6 && totalJumps <= 10) {
    mediumReasons.push(`Tiene entre 6 y 10 saltos: ${totalJumps}`);
  }

  if (hasApiExternal) mediumReasons.push("Tiene APIExternalConnectorImpl");
  if (hasCics) mediumReasons.push("Tiene CICS");

  if (dbModifiers.length > 0) {
    mediumReasons.push(`Tiene ${dbModifiers.join(" / ")}`);
  }

  if (executions > 1_000_000) {
    mediumReasons.push(
      `Tiene más de 1,000,000 ejecuciones: ${formatNumber(executions)}`
    );
  }

  if (hasCics) {
    mediumReasons.push("SE DEBE RESINCRONIZAR A LAGO ESMERALDA por uso de CICS");
  }

  if (mediumReasons.length > 0) {
    const score = Math.min(
      79,
      (totalJumps >= 6 && totalJumps <= 10 ? 15 : 0) +
      (hasApiExternal ? 15 : 0) +
      (hasCics ? 20 : 0) +
      (dbModifiers.length > 0 ? 20 : 0) +
      (executions > 1_000_000 ? 15 : 0)
    );

    return {
      level: "MEDIO",
      emoji: getRiskEmoji("MEDIO"),
      score,
      motive: mediumReasons.join(" + "),
    };
  }

  const lowReasons = [
    "Solo utilities compatibles:",
    `Saltos <= 5: ${totalJumps}`,
    "Sin modificadores BD",
    "Sin CICS/Mongo",
  ];

  return {
    level: "BAJO",
    emoji: getRiskEmoji("BAJO"),
    score: 10,
    motive: lowReasons.join(" + "),
  };
}

function getVolumeLevel(executions: number): string {
  if (executions > 10_000_000) return "ALTO";
  if (executions > 1_000_000) return "MEDIO";
  return "BAJO";
}

function getTechnicalComplexity(row: MetricRow, trace: string): string {
  const totalJumps = extractTotalJumps(trace);
  const utilityTypes = getUtilityTypes(row);
  const dbModifiers = getDbModifierMethods(trace);

  if (totalJumps > 10 || utilityTypes.length > 3 || dbModifiers.length > 0) {
    return "ALTA";
  }

  if (totalJumps >= 6 || utilityTypes.length >= 2) {
    return "MEDIA";
  }

  return "BAJA";
}

function getCommunicationSummary(row: MetricRow, trace: string): string {
  const cics = getCicsTxHosts(row, trace);
  const hasCics = hasUtility(row, "InterBackendCics");

  if (cics.length > 0 || hasCics) {
    return `Hace ${Math.max(cics.length, 1)} llamado hacia Querétaro`;
  }

  return "No se identifican llamados hacia Querétaro";
}

function buildModifierJdbcSection(trace: string): string[] {
  const lines: string[] = [];
  const modifierMethods = getDbModifierMethods(trace).filter((method) =>
    ["INSERT", "UPDATE", "DELETE"].includes(method)
  );

  if (!modifierMethods.length) {
    return [];
  }

  lines.push("JDBC");

  for (const method of modifierMethods) {
    const regex = new RegExp(
      `(?:└──|├──)\\s*([^\\n]+?)\\s*\\(Tiempo promedio:[\\s\\S]*?${method}:\\s*(\\d+)\\s*saltos`,
      "gi"
    );

    let found = false;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(trace)) !== null) {
      found = true;
      const library = match[1]?.trim() || "-";
      const count = Number(match[2] ?? 0);

      lines.push(`└── ${library} - ${buildDependenciesSection(trace).join(", ").replace("❏ Oracle: ", "")}`);
      lines.push(`    ├── ${method}: ${count} saltos`);
    }

    if (!found) {
      const fallback = trace.match(
        new RegExp(`${method}:\\s*(\\d+)\\s*saltos`, "i")
      );
      const count = Number(fallback?.[1] ?? 1);

      lines.push("└── Modificadores encontrados");
      lines.push(`    ├── ${method}: ${count} saltos`);

    }
  }

  return lines;
}

function buildUtilitiesSection(row: MetricRow, trace: string): string[] {
  const utilityTypes = getUtilityTypes(row);
  const invokedParams = getInvokedParams(row);
  const lines: string[] = [];

  const jdbcMethods = extractJdbcMethods(trace);

  if (utilityTypes.includes("Jdbc") || jdbcMethods.length > 0) {
    lines.push(
      `❏ JDBC${jdbcMethods.length ? ` [${jdbcMethods.join(", ")}]` : ""}`
    );
  }

  const cicsTxHosts = getCicsTxHosts(row, trace);

  if (utilityTypes.includes("InterBackendCics") || cicsTxHosts.length > 0) {
    lines.push(
      `❏ CICS${cicsTxHosts.length ? ` - ${cicsTxHosts.join(", ")}` : " - Sin txhost"
      }`
    );
  }

  const mongoOps = extractMongoOperations(trace);
  const hasMongoUtility = utilityTypes.includes("DaasMongoConnector");

  if (hasMongoUtility || mongoOps.length > 0) {
    lines.push(
      `❏ MONGO${mongoOps.length ? ` - ${mongoOps.join(", ")}` : " - Sin método"
      }`
    );
  }

  if (hasElastic(row, trace)) {
    const elastic = extractElasticDependencies(trace);
    lines.push(
      `❏ ELASTIC${elastic.length ? ` - ${elastic.join(", ")}` : ""}`
    );
  }

  if (utilityTypes.includes("Jpa")) {
    lines.push("❏ JPA");
  }

  if (utilityTypes.includes("APIInternalConnectorImpl")) {
    lines.push("❏ API CONNECTOR INTERNO");
  }

  if (utilityTypes.includes("APIExternalConnectorImpl")) {
    lines.push("❏ API CONNECTOR EXTERNO");
  }

  if (utilityTypes.includes("TitanClient")) {
    lines.push("❏ TITAN CLIENT");
  }

  if (utilityTypes.includes("GRPCClient")) {
    lines.push("❏ GRPC CLIENT");
  }

  const known = new Set([
    "Jdbc",
    "Jpa",
    "InterBackendCics",
    "DaasMongoConnector",
    "APIInternalConnectorImpl",
    "APIExternalConnectorImpl",
    "TitanClient",
    "GRPCClient",
  ]);

  for (const utility of utilityTypes) {
    if (!known.has(utility)) {
      lines.push(`❏ ${utility}`);
    }
  }

  if (!lines.length && invokedParams.length) {
    const uniqueUtilityParams = Array.from(
      new Set(
        invokedParams
          .map((item) => {
            const utility = String(item.utilitytype ?? "").trim();
            const param = String(item.invokedparam ?? "").trim();

            return utility && param ? `${utility} - ${param}` : "";
          })
          .filter(Boolean)
      )
    );

    lines.push(...uniqueUtilityParams.map((item) => `❏ ${item}`));
  }

  return lines.length ? lines : ["❏ Sin utilidades identificadas"];
}

function buildBrsCompatibilitySection(row: MetricRow, trace: string): string[] {
  const unsupportedUtilities = getUnavailableUtilitiesForBrs(row, trace);

  if (!unsupportedUtilities.length) {
    return [
      "❏ Compatible directo: SÍ",
      "❏ Utilidades no disponibles: Ninguna",
      "❏ Requiere alternativa técnica en AWS: NO",
    ];
  }

  return [
    "❏ Compatible directo: NO",
    `❏ Utilidades no disponibles: ${unsupportedUtilities.join(", ")}`,
    "❏ Requiere alternativa técnica en AWS: SÍ",
  ];
}

function buildDependenciesSection(trace: string): string[] {
  const text = String(trace ?? "");
  const lines: string[] = [];

  const oracle = Array.from(
    new Set([...text.matchAll(/jdbc\/([A-Z0-9_]+)/g)].map((m) => m[1]))
  );

  if (oracle.length) {
    lines.push(`❏ Oracle: ${oracle.join(", ")}`);
    lines.push();
  }

  return lines.length ? lines : ["❏ Sin dependencias identificadas."];
}

function buildQueretaroSection(row: MetricRow, trace: string): string[] {
  const hasCics = hasUtility(row, "InterBackendCics");
  const cicsTxHosts = getCicsTxHosts(row, trace);

  if (!hasCics && !cicsTxHosts.length) {
    return ["❏ Sin comunicación CICS hacia Querétaro identificada."];
  }

  const lines: string[] = [];

  lines.push("CICS");
  lines.push("└── Realiza comunicación hacia Querétaro");

  if (cicsTxHosts.length) {
    for (const txHost of cicsTxHosts) {
      lines.push(`    └── ${txHost}`);
    }
  } else {
    lines.push("    └── Sin txhost identificada");
  }

  return lines;
}

function buildLakeEmeraldSection(row: MetricRow, trace: string): string[] {
  const lines: string[] = [];
  const mongoOps = extractMongoOperations(trace);
  const elasticDeps = extractElasticDependencies(trace);

  if (!mongoOps.length && !elasticDeps.length) {
    return ["❏ No se identificaron utilidades MONGO ni ELASTIC."];
  }

  lines.push("❏ SE DEBE RESINCRONIZAR A LAGO ESMERALDA");
  lines.push("");

  if (mongoOps.length) {
    lines.push("MONGO");

    for (const op of mongoOps) {
      lines.push(`└── ${op}`);
    }
  }

  if (elasticDeps.length) {
    if (mongoOps.length) lines.push("");

    lines.push("ELASTIC");

    for (const elastic of elasticDeps) {
      lines.push(`└── APIInternalConnectorImpl[${elastic}]`);
    }
  }

  return lines;
}

function buildObservations(row: MetricRow, trace: string): string[] {
  const observations: string[] = [];
  const unsupportedUtilities = getUnavailableUtilitiesForBrs(row, trace);

  const hasCics = hasUtility(row, "InterBackendCics");
  const hasMongo = hasUtility(row, "DaasMongoConnector");

  if (unsupportedUtilities.length > 0) {
    observations.push(
      "❏ Contiene utilidades que no se encuentran disponibles en el BRS actualmente."
    );
  }

  const unavailableSpecific: string[] = [];

  if (hasCics) unavailableSpecific.push("CICS");
  if (hasMongo) unavailableSpecific.push("MONGO");

  if (unavailableSpecific.length > 0) {
    observations.push(
      `❏ Hace uso de ${unavailableSpecific.join(
        " y "
      )}, no se encuentran disponibles en BRS AWS.`
    );
  }

  if (hasElastic(row, trace)) {
    observations.push(
      "❏ Hace uso de ELASTIC, no se encuentra disponible en BRS AWS."
    );
  }

  return observations.length
    ? observations
    : ["❏ Sin observaciones críticas identificadas."];
}

function mongoOpsRequireLake(trace: string): boolean {
  return extractMongoOperations(trace).length > 0;
}

function buildRecommendationSection(row: MetricRow, trace: string): string[] {
  const hasCics = hasUtility(row, "InterBackendCics");
  const hasMongo = hasUtility(row, "DaasMongoConnector");
  const containsElastic = hasElastic(row, trace);

  const lines: string[] = [];

  lines.push("❏ Requiere análisis técnico previo.");

  const substitutions: string[] = [];

  if (hasCics) substitutions.push("CICS");
  if (hasMongo) substitutions.push("MONGO");
  if (containsElastic) substitutions.push("ELASTIC");

  if (substitutions.length > 0) {
    lines.push(`❏ Validar sustitución de ${substitutions.join(" y ")}.`);
  }

  if (mongoOpsRequireLake(trace) || containsElastic) {
    lines.push("❏ Ejecutar resincronización a Lago Esmeralda.");
  }

  return lines;
}

function getUtilityInvocationCount(row: MetricRow): number {
  const invokedParams = getInvokedParams(row);

  if (invokedParams.length) {
    return invokedParams.reduce((sum, item) => {
      return sum + Number(item.count ?? 0);
    }, 0);
  }

  const utilities = safeJsonParse<UtilityBlock[]>(row.utilitytype, []);

  return utilities.reduce((sum, item) => {
    return sum + Number(item.count ?? 0);
  }, 0);
}

export function buildAwsAnalysisReport(row: MetricRow): string {
  const meta = parseInvokerTxMeta(row.invokerTx);
  const trace = String(row.trace ?? "");

  const executions = Number(
    meta?.sum_num_executions ?? row.utility_count ?? 0
  );

  const meanDuration = Number(
    meta?.mean_span_duration ?? row.mean_utility_duration ?? 0
  );

  const traceJumpTime = extractTraceJumpTime(trace);
  const totalErrors = getTotalErrors(meta);
  const expectedAwsTime = extractExpectedAwsTime(trace);


  const channelName = getChannelName(row.channelCode);
  const communicationSummary = getCommunicationSummary(row, trace);
  const risk = assessAwsRisk(row, trace);
  const utilityInvocationCount = getUtilityInvocationCount(row);

  const lines: string[] = [];

  lines.push(`${risk.emoji} RIESGO AWS/BRS: ${risk.level}`);
  lines.push("");
  lines.push(`❏ Score: ${risk.score}/100`);
  lines.push(`❏ Motivo: ${risk.motive}`);
  lines.push("");
  lines.push("");
  lines.push("🔵 METRICAS");
  lines.push("");
  lines.push(`❏ ${formatNumber(executions)} exec`);
  lines.push(`❏ Tiempo traza: ${traceJumpTime || "0.00ms"}`);
  lines.push(`❏ Tiempo promedio Atenea: ${formatMs(meanDuration)}`);
  lines.push(`❏ ${formatNumber(totalErrors)} errores`);
  lines.push(`❏ Volumen: ${getVolumeLevel(executions)}`);
  lines.push("");
  lines.push("");
  lines.push("🔵 UTILIDADES");
  lines.push("");
  lines.push(...buildUtilitiesSection(row, trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 COMPATIBILIDAD BRS");
  lines.push("");
  lines.push(...buildBrsCompatibilitySection(row, trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 RESUMEN TÉCNICO");
  lines.push("");
  lines.push(`❏ Comunicación/Salto: ${communicationSummary}`);
  lines.push(`❏ Canal: ${channelName}`);
  lines.push(`❏ Invocación a utilidad: ${formatNumber(utilityInvocationCount)} veces`);
  lines.push(`❏ Total de Tiempo Esperado en AWS: ${expectedAwsTime}`);
  lines.push(`❏ Complejidad técnica: ${getTechnicalComplexity(row, trace)}`);
  lines.push("");
  lines.push("");
  lines.push("🔵 DEPENDENCIAS DETECTADAS");
  lines.push("");
  lines.push(...buildDependenciesSection(trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 MODIFICADORES DETECTADOS");
  lines.push("");
  lines.push(...buildModifierJdbcSection(trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 Comunicación/Salto hacia Querétaro");
  lines.push(...buildQueretaroSection(row, trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 OBSERVACIONES");
  lines.push("");
  lines.push(...buildObservations(row, trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 SINCRONIZACION A LAGO ESMERALDA");
  lines.push("");
  lines.push(...buildLakeEmeraldSection(row, trace));
  lines.push("");
  lines.push("");
  lines.push("🔵 RECOMENDACIÓN");
  lines.push("");
  lines.push(...buildRecommendationSection(row, trace));

  return lines.join("\n").trim();
}