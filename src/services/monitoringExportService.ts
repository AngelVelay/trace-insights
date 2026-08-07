
import { GROUPED_CHANNEL_CODES, type MetricRow } from "@/types/bbva";import type {
  AwsInformComparisonResult,
  AwsInformComparisonRow,
} from "@/services/metricsService";
import { buildAwsAnalysisReport } from "@/services/awsReportBuilder";

type InvokerTxMeta = {
  invokerTx?: string;
  channelCode?: string;
  aap?: string;
  typology?: string;
  sum_num_executions?: number;
  mean_span_duration?: number;
  sum_functional_error?: number;
  sum_technical_error?: number;
};

type LibraryItem = {
  invokerLibrary?: string;
  count?: number;
};

type UtilityTypeItem = {
  invokerLibrary?: string;
  utilitytype?: string;
  count?: number;
};

type InvokedParamItem = {
  invokerLibrary?: string;
  utilitytype?: string;
  invokedparam?: string;
  count?: number;
  maxDuration?: number;
};

type GroupedChannelApplication = {
  channel: string;
  name: string;
  aap: number | string;
};

function findChannelByAap(
  aapValue?: string | number | null
): GroupedChannelApplication | null {
  const cleanAap = String(aapValue ?? "").trim();

  if (!cleanAap || cleanAap === "-") {
    return null;
  }

  for (const applications of Object.values(GROUPED_CHANNEL_CODES)) {
    const match = (applications as GroupedChannelApplication[]).find((item) => {
      return String(item.aap ?? "").trim() === cleanAap;
    });

    if (match) {
      return match;
    }
  }

  return null;
}

function findChannelByCode(
  channelCode?: string | null
): GroupedChannelApplication | null {
  const cleanChannel = String(channelCode ?? "").trim();

  if (!cleanChannel || cleanChannel === "-") {
    return null;
  }

  const applications = GROUPED_CHANNEL_CODES[
    cleanChannel as keyof typeof GROUPED_CHANNEL_CODES
  ] as GroupedChannelApplication[] | undefined;

  return applications?.[0] ?? null;
}

function renderChannelCell(row: MetricRow): string {
   const meta = parseInvokerTx(row.invokerTx);

  const aap =
    String(row.aap ?? "").trim() ||
    String(meta.aap ?? "").trim();

  const channelCode =
    String(row.channelCode ?? "").trim() ||
    String(meta.channelCode ?? "").trim();

  const mappedChannel = findChannelByAap(aap);

  if (mappedChannel) {
    return [
      `• Canal: ${mappedChannel.channel}`,
      `• Nombre: ${mappedChannel.name}`,
      `• AAP: ${mappedChannel.aap}`,
    ].join("\n");
  }

  if (channelCode && aap) {
    return [`• Canal: ${channelCode}`, `• AAP: ${aap}`].join("\n");
  }

  if (channelCode) {
    return `• Canal: ${channelCode}`;
  }

  if (aap) {
    return `• AAP: ${aap}`;
  }

  return "-";
}

function renderTypologyCell(row: MetricRow): string {
  const meta = parseInvokerTx(row.invokerTx);

  return (
    String(row.typology ?? "").trim() ||
    String(meta.typology ?? "").trim() ||
    "-"
  );
}

function normalizeUtilityLabel(utilityType: string): string {
  const clean = utilityType.trim();

  const map: Record<string, string> = {
    Jdbc: "JDBC",
    Jpa: "JPA",
    DaasMongoConnector: "MONGO",
    InterBackendCics: "CICS",
    TitanClient: "TITAN",
    APIInternalConnectorImpl: "API CONNECTOR INTERNAL",
    APIExternalConnectorImpl: "API CONNECTOR EXTERNAL",
    GRPCClient: "GRPC",
  };

  return map[clean] ?? clean.toUpperCase();
}

function renderUtilitySummaryCell(row: MetricRow): string {
  const result = new Set<string>();

  const utilityItems = safeJsonParse<UtilityTypeItem[]>(row.utilitytype, []);
  const invokedItems = safeJsonParse<InvokedParamItem[]>(row.invokedparam, []);

  for (const item of utilityItems) {
    const utilityType = String(item.utilitytype ?? "").trim();

    if (utilityType) {
      result.add(normalizeUtilityLabel(utilityType));
    }
  }

  for (const item of invokedItems) {
    const utilityType = String(item.utilitytype ?? "").trim();
    const invokedparam = String(item.invokedparam ?? "").trim();

    if (utilityType) {
      result.add(normalizeUtilityLabel(utilityType));
    }

    if (/elastic/i.test(invokedparam)) {
      result.add("ELASTIC");
    }
  }

  if (/elastic/i.test(String(row.trace ?? ""))) {
    result.add("ELASTIC");
  }

  return Array.from(result).join(", ") || "-";
}

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

function parseInvokerTx(value: unknown): InvokerTxMeta {
  return safeJsonParse<InvokerTxMeta>(value, {});
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString("en-US");
}

function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "0.00 ms";

  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ms`;
}

function normalizeMultilineText(value: unknown): string {
  return String(value ?? "-")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

/**
 * CSV:
 * - Siempre usa comillas.
 * - Conserva saltos de línea dentro de la celda.
 * - Duplica comillas internas.
 */
function stringifyForCsv(value: unknown): string {
  const text = normalizeMultilineText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Google Sheets:
 * - TSV.
 * - Si la celda trae saltos de línea, tabs o comillas, se encierra en comillas.
 * - Conserva saltos de línea dentro de la celda.
 */
function stringifyForSheets(value: unknown): string {
  const text = normalizeMultilineText(value);

  if (text.includes("\n") || text.includes("\t") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function renderInvokerTxCell(row: MetricRow): string {
  const meta = parseInvokerTx(row.invokerTx);

  const invokerTx = String(meta.invokerTx ?? "").trim() || "-";
  const executions = Number(meta.sum_num_executions ?? row.utility_count ?? 0);
  const duration = Number(
    meta.mean_span_duration ?? row.mean_utility_duration ?? 0
  );

  return [
    invokerTx,
    `${formatNumber(executions)} exec`,
    formatMs(duration),
  ].join("\n");
}

function renderSimpleInvokerTxCell(row: MetricRow): string {
  const meta = parseInvokerTx(row.invokerTx);
  return String(meta.invokerTx ?? "").trim() || "-";
}

function renderLibraryCell(row: MetricRow): string {
  const libraries = safeJsonParse<LibraryItem[]>(row.invokerLibrary, []);

  if (!libraries.length) return "-";

  return libraries
    .map((item) => {
      const library = String(item.invokerLibrary ?? "").trim() || "-";
      const count = Number(item.count ?? 0);

      return [library, `${formatNumber(count)} exec`].join("\n");
    })
    .join("\n\n");
}

function renderUtilityTypeCell(row: MetricRow): string {
  const items = safeJsonParse<UtilityTypeItem[]>(row.utilitytype, []);

  if (!items.length) return "-";

  return items
    .map((item) => {
      const library = String(item.invokerLibrary ?? "").trim() || "-";
      const utilitytype = String(item.utilitytype ?? "").trim() || "-";
      const count = Number(item.count ?? 0);

      return [
        library,
        utilitytype,
        `${formatNumber(count)} exec`,
      ].join("\n");
    })
    .join("\n\n");
}

function renderInvokedParamCell(row: MetricRow): string {
  const items = safeJsonParse<InvokedParamItem[]>(row.invokedparam, []);

  if (!items.length) return "-";

  return items
    .map((item) => {
      const library = String(item.invokerLibrary ?? "").trim() || "-";
      const utilitytype = String(item.utilitytype ?? "").trim() || "-";
      const invokedparam = String(item.invokedparam ?? "").trim() || "-";
      const count = Number(item.count ?? 0);
      const maxDuration = Number(item.maxDuration ?? 0);

      return [
        library,
        utilitytype,
        invokedparam,
        `${formatNumber(count)} exec`,
        formatMs(maxDuration),
      ].join("\n");
    })
    .join("\n\n");
}

function renderTraceCell(row: MetricRow): string {
  return normalizeMultilineText(row.trace || "-");
}

function renderInformeAwsCell(row: MetricRow): string {
  return buildAwsAnalysisReport(row);
}

const AWS_MONITORING_TABLE_HEADERS = [
  "Site",
  "Canal",
  "Zona de Ejecución",
  "InvokerTx",
  "InvokerTx simple",
  "Library",
  "UtilityType",
  "Resumen Utility",
  "JDBC Tipo",
  "InvokedParam",
  "Trace",
  "Informe AWS",
];

function getMonitoringTableRows(rows: MetricRow[]) {
  return rows.map((row) => {
    return [
      row.site || "-",
      renderChannelCell(row),
      renderTypologyCell(row),
      renderInvokerTxCell(row),
      renderSimpleInvokerTxCell(row),
      renderLibraryCell(row),
      renderUtilityTypeCell(row),
      renderUtilitySummaryCell(row),
      renderJdbcAccessTypeCell(row),
      renderInvokedParamCell(row),
      renderTraceCell(row),
      renderInformeAwsCell(row),
    ];
  });
}


const JDBC_READ_METHODS = new Set(["SELECT"]);
const JDBC_WRITE_METHODS = new Set([
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
]);
const JDBC_SQL_METHODS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
] as const;

function normalizeJdbcMethod(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .replace(/^[\s\-├└│─]+/, "")
    .toUpperCase();

  if (!text) return null;

  if (text.startsWith("WITH ") || text === "WITH") {
    return "SELECT";
  }

  return JDBC_SQL_METHODS.find((method) => text.startsWith(method)) ?? null;
}

function extractJdbcSection(trace: unknown): string {
  const lines = String(trace ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  const startIndex = lines.findIndex((line) => /^\s*JDBC(?:\s|$)/i.test(line));

  if (startIndex < 0) {
    return "";
  }

  const nextSectionPattern = /^\s*(?:CICS|JPA|MONGO CONNECTOR|API-CONNECTOR INTERNO|API-CONNECTOR EXTERNO|API-CONNECTOR|TITAN CLIENT|GRPC CLIENT|OTROS|🔵)(?:\s|$)/i;
  const jdbcLines: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];

    if (index > startIndex && nextSectionPattern.test(line)) {
      break;
    }

    jdbcLines.push(line);
  }

  return jdbcLines.join("\n");
}

function getJdbcMethodsFromTrace(trace: unknown): string[] {
  const text = String(trace ?? "");
  const jdbcSection = extractJdbcSection(text);
  const methods = new Set<string>();

  if (jdbcSection) {
    for (const method of JDBC_SQL_METHODS) {
      const counterPattern = new RegExp(
        `\\b${method}\\s*:\\s*\\d+(?:\\s*saltos)?\\b`,
        "i",
      );

      if (counterPattern.test(jdbcSection)) {
        methods.add(method);
      }
    }

    for (const line of jdbcSection.split("\n")) {
      const method = normalizeJdbcMethod(line);

      if (method) {
        methods.add(method);
      }
    }
  }

  const inlineJdbcPattern = /Jdbc\s*\[([^\]]+)\]/gi;
  let match: RegExpExecArray | null;

  while ((match = inlineJdbcPattern.exec(text)) !== null) {
    const method = normalizeJdbcMethod(match[1]);

    if (method) {
      methods.add(method);
    }
  }

  return Array.from(methods);
}

function getJdbcMethodsFromStructuredData(row: MetricRow): string[] {
  const methods = new Set<string>();
  const invokedItems = safeJsonParse<InvokedParamItem[]>(row.invokedparam, []);

  for (const item of invokedItems) {
    const utilityType = String(item.utilitytype ?? "").trim();

    if (!/^jdbc$/i.test(utilityType)) {
      continue;
    }

    const method = normalizeJdbcMethod(item.invokedparam);

    if (method) {
      methods.add(method);
    }
  }

  return Array.from(methods);
}

function getJdbcMethods(row: MetricRow): string[] {
  return Array.from(
    new Set([
      ...getJdbcMethodsFromTrace(row.trace),
      ...getJdbcMethodsFromStructuredData(row),
    ]),
  );
}

function renderJdbcAccessTypeCell(row: MetricRow): string {
  const methods = getJdbcMethods(row);

  if (methods.some((method) => JDBC_WRITE_METHODS.has(method))) {
    return "JDBC [WRITE]";
  }

  if (methods.some((method) => JDBC_READ_METHODS.has(method))) {
    return "JDBC [READ_ONLY]";
  }

  return "-";
}

export function buildAwsMonitoringCsv(rows: MetricRow[]): string {
  const header = AWS_MONITORING_TABLE_HEADERS.map(stringifyForCsv).join(",");

  const body = getMonitoringTableRows(rows).map((row) => {
    return row.map(stringifyForCsv).join(",");
  });

  return [header, ...body].join("\n");
}

export async function copyAwsMonitoringToSheets(
  rows: MetricRow[]
): Promise<void> {
  const header = AWS_MONITORING_TABLE_HEADERS.map(stringifyForSheets).join("\t");

  const body = getMonitoringTableRows(rows).map((row) => {
    return row.map(stringifyForSheets).join("\t");
  });

  const content = [header, ...body].join("\n");

  await navigator.clipboard.writeText(content);
}

/**
 * INFORM AWS EXPORTS
 * Se conservan para que Dashboard.tsx no rompa imports:
 * buildAwsInformCsv
 * copyAwsInformToSheets
 */

const AWS_INFORM_METRICS_HEADERS = [
  "InvokerTX",
  "Canal",
  "LIVE-02 Ejecuciones",
  "LIVE-04 Ejecuciones",
  "Delta Ejecuciones",
  "LIVE-02 Errores Tecnicos",
  "LIVE-04 Errores Tecnicos",
  "Delta Errores Tecnicos",
  "LIVE-02 Tiempo Promedio MS",
  "LIVE-04 Tiempo Promedio MS",
  "Delta Tiempo Promedio MS",
  "LIVE-02 Saltos",
  "LIVE-04 Saltos",
  "Delta Saltos",
];

const AWS_INFORM_TRACES_HEADERS = [
  "InvokerTX",
  "Canal",
  "LIVE-02 Trace",
  "LIVE-04 Trace",
];

function getAwsInformMetricsRow(
  result: AwsInformComparisonResult,
  row: AwsInformComparisonRow
) {
  return [
    row.invokerTx,
    result.channelCode || "-",
    row.live02.executions,
    row.live04.executions,
    row.deltaExecutions,
    row.live02.technicalErrors,
    row.live04.technicalErrors,
    row.deltaTechnicalErrors,
    row.live02.meanDurationMs,
    row.live04.meanDurationMs,
    row.deltaMeanDurationMs,
    row.live02.jumps,
    row.live04.jumps,
    row.deltaJumps,
  ];
}

function getAwsInformTracesRow(
  result: AwsInformComparisonResult,
  row: AwsInformComparisonRow
) {
  return [
    row.invokerTx,
    result.channelCode || "-",
    row.live02.trace || "-",
    row.live04.trace || "-",
  ];
}

export function buildAwsInformCsv(
  result: AwsInformComparisonResult,
  view: "metrics" | "traces"
): string {
  const headers =
    view === "metrics" ? AWS_INFORM_METRICS_HEADERS : AWS_INFORM_TRACES_HEADERS;

  const rows = result.rows.map((row) => {
    return view === "metrics"
      ? getAwsInformMetricsRow(result, row)
      : getAwsInformTracesRow(result, row);
  });

  const headerLine = headers.map(stringifyForCsv).join(",");

  const body = rows.map((row) => row.map(stringifyForCsv).join(","));

  return [headerLine, ...body].join("\n");
}

export async function copyAwsInformToSheets(
  result: AwsInformComparisonResult,
  view: "metrics" | "traces"
): Promise<void> {
  const headers =
    view === "metrics" ? AWS_INFORM_METRICS_HEADERS : AWS_INFORM_TRACES_HEADERS;

  const rows = result.rows.map((row) => {
    return view === "metrics"
      ? getAwsInformMetricsRow(result, row)
      : getAwsInformTracesRow(result, row);
  });

  const headerLine = headers.map(stringifyForSheets).join("\t");

  const body = rows.map((row) => row.map(stringifyForSheets).join("\t"));

  const content = [headerLine, ...body].join("\n");

  await navigator.clipboard.writeText(content);
}
