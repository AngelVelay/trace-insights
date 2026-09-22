import type { MetricRow } from "@/types/bbva";

type InvokerTxMeta = {
  invokerTx?: string;
  mean_span_duration?: number;
};

type TraceSummaryData = {
  totalJumps: number;
  totalLive: string;
  queryCount: number;
  expectedAws: string;
  jdbcReadOnly: number;
  jdbcJumps: number;
  utilities: Array<{ label: string; count: number }>;
};

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim() || value === "-") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function countMatches(text: string, regex: RegExp): number {
  return [...String(text ?? "").matchAll(regex)].length;
}

function sumNumericMatches(text: string, regex: RegExp): number {
  let total = 0;

  for (const match of String(text ?? "").matchAll(regex)) {
    const value = Number(match[1] ?? 0);

    if (Number.isFinite(value) && value > 0) {
      total += value;
    }
  }

  return total;
}

function countJdbcSelectsFromTrace(trace: string): number {
  const groupedCount = sumNumericMatches(
    trace,
    /^\s*[│ ]*[├└]──\s+SELECT:\s*(\d+)\s*$/gim,
  );

  if (groupedCount > 0) {
    return groupedCount;
  }

  // Compatibilidad con trazas antiguas sin encabezado SELECT: N.
  return countMatches(
    trace,
    /^\s*[│ ]*[├└]──\s+(?:Consulta|Salto)\s*·\s*Jdbc\[/gim,
  );
}

function countJdbcWritesFromTrace(trace: string): number {
  const methods = ["INSERT", "UPDATE", "DELETE"];

  return methods.reduce((total, method) => {
    const regex = new RegExp(
      `^\\s*[│ ]*[├└]──\\s+${method}:\\s*(\\d+)\\s*$`,
      "gim",
    );

    return total + sumNumericMatches(trace, regex);
  }, 0);
}

function extractLastValue(text: string, regex: RegExp): string {
  const matches = [...String(text ?? "").matchAll(regex)];
  const match = matches[matches.length - 1];
  return String(match?.[1] ?? "").trim();
}

function formatNumberPart(value: number): string {
  if (!Number.isFinite(value)) return "0";

  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Formato exacto y legible:
 * 9307     -> 9s 307ms
 * 1002.89  -> 1s 2.89ms
 * 89.25    -> 89.25ms
 */
export function formatAwsTraceDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";

  const seconds = Math.floor(ms / 1000);
  const remainingMs = Math.max(0, ms - seconds * 1000);
  const msText = formatNumberPart(remainingMs);

  if (seconds <= 0) {
    return `${msText}ms`;
  }

  if (remainingMs < 0.005) {
    return `${seconds}s`;
  }

  return `${seconds}s ${msText}ms`;
}

function getInvokerTxMeanDuration(row: MetricRow): number {
  const meta = safeJsonParse<InvokerTxMeta>(row.invokerTx, {});
  const value = Number(meta.mean_span_duration ?? row.mean_utility_duration ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getSiteTimeLabel(row: MetricRow): string {
  const site = String(row.site ?? "LIVE-02").trim().toUpperCase() || "LIVE-02";
  return site.replace(/-/g, " ");
}

function getTraceTotalTime(trace: string, row: MetricRow): string {
  // La fuente de verdad para el resumen es el mismo Tiempo total calculado
  // por tracesService. Así evitamos comparar el mean_span_duration de Atenea
  // con la suma real de los spans recuperados en la traza.
  const traceTotal = extractLastValue(
    trace,
    /^Tiempo total:\s*([^\r\n]+)$/gim,
  );

  if (traceTotal) {
    return traceTotal;
  }

  // Fallback para trazas antiguas que todavía no imprimen "Tiempo total".
  const fallbackMs = getInvokerTxMeanDuration(row);
  return fallbackMs > 0 ? formatAwsTraceDuration(fallbackMs) : "-";
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countMongoEntries(trace: string): number {
  const lines = String(trace ?? "").split(/\r?\n/);
  let insideMongo = false;
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "MONGO CONNECTOR") {
      insideMongo = true;
      continue;
    }

    if (
      insideMongo &&
      /^(?:CICS|JDBC|JPA|API-CONNECTOR INTERNO|API-CONNECTOR EXTERNO|TITAN CLIENT|OTROS|Flujo\s+\d+|={3,}|-{3,})$/i.test(
        trimmed,
      )
    ) {
      insideMongo = false;
    }

    if (!insideMongo) continue;

    // Entrada de primer nivel de MONGO: "├── LIB (12ms)" / "└── LIB (12ms)"
    if (/^\s{4}[├└]──\s+.+\([^)]*(?:ms|s)\)\s*$/i.test(line)) {
      count += 1;
    }
  }

  return count;
}

function countOtherUtilityTypes(trace: string): Map<string, number> {
  const result = new Map<string, number>();
  const lines = String(trace ?? "").split(/\r?\n/);
  let insideOther = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "OTROS") {
      insideOther = true;
      continue;
    }

    if (
      insideOther &&
      /^(?:CICS|JDBC|JPA|MONGO CONNECTOR|API-CONNECTOR INTERNO|API-CONNECTOR EXTERNO|TITAN CLIENT|Flujo\s+\d+|={3,}|-{3,})$/i.test(
        trimmed,
      )
    ) {
      insideOther = false;
    }

    if (!insideOther) continue;

    const match = trimmed.match(/^.+?([A-Za-z][A-Za-z0-9_-]+)\[[^\]]*\]$/);
    const utilityType = match?.[1]?.trim();

    if (!utilityType || /grpc/i.test(utilityType)) continue;

    const normalized = /elastic/i.test(utilityType)
      ? "ELASTIC"
      : utilityType.toUpperCase();

    result.set(normalized, (result.get(normalized) ?? 0) + 1);
  }

  return result;
}

function buildUtilityCounts(trace: string): Array<{ label: string; count: number }> {
  const values = new Map<string, number>();

  const add = (label: string, count: number) => {
    if (!Number.isFinite(count) || count <= 0) return;
    values.set(label, (values.get(label) ?? 0) + count);
  };

  add("API CONNECTOR INTERNO", countMatches(trace, /APIInternalConnectorImpl\[/gi));
  add("API CONNECTOR EXTERNO", countMatches(trace, /APIExternalConnectorImpl\[/gi));
  add("CICS", countMatches(trace, /InterBackendCics\[/gi));
  add("JPA", countMatches(trace, /\bJpa\[/gi));
  add("TITAN CLIENT", countMatches(trace, /TitanClient\[/gi));
  add("MONGO", countMongoEntries(trace));

  const other = countOtherUtilityTypes(trace);
  for (const [label, count] of other.entries()) {
    add(label, count);
  }

  // Si ELASTIC aparece explícitamente fuera de OTROS, lo reportamos una sola vez
  // como dependencia detectada, sin inventar un volumen mayor al observado.
  if (!values.has("ELASTIC") && /\belastic\b/i.test(trace)) {
    add("ELASTIC", 1);
  }

  return Array.from(values.entries()).map(([label, count]) => ({ label, count }));
}

export function getAwsTraceSummaryData(row: MetricRow): TraceSummaryData {
  const trace = String(row.trace ?? "").trim();

  const totalJumpsText = extractLastValue(
    trace,
    /Total de saltos encontrados:\s*(\d+)/gi,
  );

  const expectedAws =
    extractLastValue(
      trace,
      /Total de Tiempo Esperado en AWS:\s*([^\r\n]+)/gi,
    ) || "-";

  // READ ONLY se obtiene del método SQL, no de la etiqueta visual Consulta/Salto.
  // Así un SELECT nunca se reporta como WRITE aunque una versión antigua del
  // trace lo haya etiquetado incorrectamente como Salto.
  const jdbcReadOnly = countJdbcSelectsFromTrace(trace);
  const jdbcJumps = countJdbcWritesFromTrace(trace);

  return {
    totalJumps: Number(totalJumpsText || 0),
    totalLive: getTraceTotalTime(trace, row),
    queryCount: jdbcReadOnly,
    expectedAws,
    jdbcReadOnly,
    jdbcJumps,
    utilities: buildUtilityCounts(trace),
  };
}

export function buildAwsTraceSummary(row: MetricRow): string {
  const data = getAwsTraceSummaryData(row);
  const separator = "────────────────────────────";

  const lines: string[] = [
    "RESUMEN TRAZAS AWS",
    separator,
    `• Saltos a Lago Esmeralda: ${data.totalJumps}`,
    `• Tiempo total ${getSiteTimeLabel(row)}: ${data.totalLive}`,
    `• Consultas realizadas en AWS: ${data.queryCount}`,
    `• Total de Tiempo Esperado en AWS: ${data.expectedAws}`,
  ];

  const hasUtilities =
    data.jdbcReadOnly > 0 ||
    data.jdbcJumps > 0 ||
    data.utilities.length > 0;

  if (hasUtilities) {
    lines.push("");
    lines.push("UTILIDADES DETECTADAS");
    lines.push(separator);
  }

  if (data.jdbcReadOnly > 0) {
    lines.push(
      `• JDBC READ ONLY: ${countLabel(data.jdbcReadOnly, "consulta", "consultas")}`,
    );
  }

  if (data.jdbcJumps > 0) {
    lines.push(
      `• JDBC WRITE / SALTOS: ${countLabel(data.jdbcJumps, "salto", "saltos")}`,
    );
  }

  for (const utility of data.utilities) {
    lines.push(
      `• ${utility.label}: ${countLabel(utility.count, "salto", "saltos")}`,
    );
  }

  return lines.join("\n");
}
