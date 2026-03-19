import type { MetricRow } from "@/types/bbva";
import type { EnvironmentMonitoringDailyResult } from "@/services/environmentMonitoringService";
import type { IncidentMonitoringResult } from "@/services/versionadoIncidentesService";

type Primitive = string | number;

type InvokerTxItem = {
  invokerTx: string;
  sum_num_executions: number;
  mean_span_duration: number;
  sum_functional_error?: number;
  sum_technical_error?: number;
};

type LibraryItem = {
  invokerLibrary: string;
  count: number;
};

type UtilityTypeItem = {
  invokerLibrary: string;
  utilitytype: string;
  count: number;
};

type InvokedParamItem = {
  invokerLibrary: string;
  utilitytype: string;
  invokedparam: string;
  count: number;
  maxDuration: number;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeCsv(value: Primitive): string {
  const text = String(value ?? "");
  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatExecDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(2)} ms`;
}

function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(2)} ms`;
}

function buildCsv(headers: string[], rows: Primitive[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildTsv(headers: string[], rows: Primitive[][]): string {
  return [headers, ...rows]
    .map((row) => row.map((cell) => String(cell ?? "")).join("\t"))
    .join("\n");
}

function buildHtmlTable(headers: string[], rows: Primitive[][]): string {
  const thead = `
    <thead>
      <tr>
        ${headers
          .map(
            (header) =>
              `<th style="border:1px solid #d1d5db;padding:8px;background:#f3f4f6;font-weight:700;text-align:left;">${escapeHtml(
                header
              )}</th>`
          )
          .join("")}
      </tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${rows
        .map(
          (row) => `
            <tr>
              ${row
                .map((cell) => {
                  const html = escapeHtml(String(cell ?? "")).replace(/\n/g, "<br/>");
                  return `<td style="border:1px solid #d1d5db;padding:8px;vertical-align:top;white-space:pre-wrap;">${html}</td>`;
                })
                .join("")}
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  return `
    <table style="border-collapse:collapse;font-family:Arial, sans-serif;font-size:12px;">
      ${thead}
      ${tbody}
    </table>
  `;
}

export async function copyTableToGoogleSheets(
  headers: string[],
  rows: Primitive[][]
): Promise<void> {
  const html = buildHtmlTable(headers, rows);
  const tsv = buildTsv(headers, rows);

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([tsv], { type: "text/plain" }),
    }),
  ]);
}

function parseInvokerTxItem(value: unknown): InvokerTxItem | null {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as Partial<InvokerTxItem>;
      if (!parsed?.invokerTx) return null;

      return {
        invokerTx: String(parsed.invokerTx),
        sum_num_executions: Number(parsed.sum_num_executions ?? 0),
        mean_span_duration: Number(parsed.mean_span_duration ?? 0),
        sum_functional_error: Number(parsed.sum_functional_error ?? 0),
        sum_technical_error: Number(parsed.sum_technical_error ?? 0),
      };
    } catch {
      return {
        invokerTx: trimmed,
        sum_num_executions: 0,
        mean_span_duration: 0,
        sum_functional_error: 0,
        sum_technical_error: 0,
      };
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const invokerTx = String(obj.invokerTx ?? "").trim();
    if (!invokerTx) return null;

    return {
      invokerTx,
      sum_num_executions: Number(obj.sum_num_executions ?? 0),
      mean_span_duration: Number(obj.mean_span_duration ?? 0),
      sum_functional_error: Number(obj.sum_functional_error ?? 0),
      sum_technical_error: Number(obj.sum_technical_error ?? 0),
    };
  }

  return null;
}

function parseLibraryItems(value: unknown): LibraryItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          invokerLibrary: String(obj.invokerLibrary ?? "").trim(),
          count: Number(obj.count ?? 0),
        };
      })
      .filter(
        (item): item is LibraryItem =>
          Boolean(item && item.invokerLibrary.length > 0)
      );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parseLibraryItems(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseUtilityTypeItems(value: unknown): UtilityTypeItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          invokerLibrary: String(obj.invokerLibrary ?? "").trim(),
          utilitytype: String(obj.utilitytype ?? "").trim(),
          count: Number(obj.count ?? 0),
        };
      })
      .filter(
        (item): item is UtilityTypeItem =>
          Boolean(
            item &&
              item.invokerLibrary.length > 0 &&
              item.utilitytype.length > 0
          )
      );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parseUtilityTypeItems(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function parseInvokedParamItems(value: unknown): InvokedParamItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          invokerLibrary: String(obj.invokerLibrary ?? "").trim(),
          utilitytype: String(obj.utilitytype ?? "").trim(),
          invokedparam: String(obj.invokedparam ?? "").trim(),
          count: Number(obj.count ?? 0),
          maxDuration: Number(obj.maxDuration ?? 0),
        };
      })
      .filter(
        (item): item is InvokedParamItem =>
          Boolean(
            item &&
              item.invokerLibrary.length > 0 &&
              item.utilitytype.length > 0 &&
              item.invokedparam.length > 0
          )
      );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parseInvokedParamItems(parsed);
    } catch {
      return [];
    }
  }

  return [];
}

function renderInvokerTxText(value: unknown): string {
  const item = parseInvokerTxItem(value);
  if (!item) return "-";

  return [
    item.invokerTx,
    `${item.sum_num_executions} exec`,
    formatExecDuration(item.mean_span_duration),
  ].join("\n");
}

function renderLibraryText(value: unknown): string {
  const items = parseLibraryItems(value);
  if (!items.length) return "-";

  return items
    .map((item) => [item.invokerLibrary, `${item.count} exec`].join("\n"))
    .join("\n\n");
}

function renderUtilityTypeText(value: unknown): string {
  const items = parseUtilityTypeItems(value);
  if (!items.length) return "-";

  return items
    .map((item) =>
      [item.invokerLibrary, item.utilitytype, `${item.count} exec`].join("\n")
    )
    .join("\n\n");
}

function renderInvokedParamText(value: unknown): string {
  const items = parseInvokedParamItems(value);
  if (!items.length) return "-";

  return items
    .map((item) =>
      [
        item.invokerLibrary,
        item.utilitytype,
        item.invokedparam,
        `${item.count} exec`,
        formatExecDuration(item.maxDuration),
      ].join("\n")
    )
    .join("\n\n");
}

function buildAwsMonitoringMatrix(rows: MetricRow[]): {
  headers: string[];
  rows: Primitive[][];
} {
  const headers = [
    "Site",
    "InvokerTx",
    "Library",
    "UtilityType",
    "InvokedParam",
    "Trace",
  ];

  const matrix = rows.map((row) => [
    row.site,
    renderInvokerTxText(row.invokerTx),
    renderLibraryText(row.invokerLibrary),
    renderUtilityTypeText(row.utilitytype),
    renderInvokedParamText(row.invokedparam),
    String(row.trace ?? "").trim() || "-",
  ]);

  return { headers, rows: matrix };
}

export function buildAwsMonitoringCsv(rows: MetricRow[]): string {
  const matrix = buildAwsMonitoringMatrix(rows);
  return buildCsv(matrix.headers, matrix.rows);
}

export function buildAwsMonitoringSheetsText(rows: MetricRow[]): string {
  const matrix = buildAwsMonitoringMatrix(rows);
  return buildTsv(matrix.headers, matrix.rows);
}

export async function copyAwsMonitoringToSheets(rows: MetricRow[]): Promise<void> {
  const matrix = buildAwsMonitoringMatrix(rows);
  await copyTableToGoogleSheets(matrix.headers, matrix.rows);
}

function getEnvironmentPhaseLabel(phase: string): string {
  if (phase === "before") return "Before";
  if (phase === "installation") return "Día de instalación";
  return "After";
}

function buildEnvironmentMonitoringMatrix(result: EnvironmentMonitoringDailyResult): {
  headers: string[];
  rows: Primitive[][];
} {
  const headers = [
    "Fase",
    "Fecha",
    "Technical Errors",
    "Executions",
    "Span Duration",
  ];

  const rows = result.rows.map((row) => [
    getEnvironmentPhaseLabel(row.phase),
    row.date,
    row.technicalErrors,
    row.executions,
    formatMs(row.meanSpanDuration),
  ]);

  rows.push([
    "TOTAL",
    "-",
    result.totals.technicalErrors,
    result.totals.executions,
    formatMs(result.totals.meanSpanDuration),
  ]);

  return { headers, rows };
}

export function buildEnvironmentMonitoringCsv(
  result: EnvironmentMonitoringDailyResult
): string {
  const matrix = buildEnvironmentMonitoringMatrix(result);
  return buildCsv(matrix.headers, matrix.rows);
}

export function buildEnvironmentMonitoringSheetsText(
  result: EnvironmentMonitoringDailyResult
): string {
  const matrix = buildEnvironmentMonitoringMatrix(result);
  return buildTsv(matrix.headers, matrix.rows);
}

export async function copyEnvironmentMonitoringToSheets(
  result: EnvironmentMonitoringDailyResult
): Promise<void> {
  const matrix = buildEnvironmentMonitoringMatrix(result);
  await copyTableToGoogleSheets(matrix.headers, matrix.rows);
}

function getIncidentPhaseLabel(phase: string): string {
  if (phase === "before") return "Before";
  if (phase === "installation") return "Instalación";
  return "After";
}

function buildIncidentMonitoringMatrix(result: IncidentMonitoringResult): {
  headers: string[];
  rows: Primitive[][];
} {
  const headers = [
    "Fase",
    "Fecha",
    "TRX",
    "Exception",
    "Description",
    "Resumen IA",
    "Detalle Errores controlados",
    "Codigo de Error Controlado",
    "APX Chanel",
    "Fecha de Revision",
    "Número de ejecuciones",
    "Número de errores",
    "Tiempo de respuesta (ms)",
    "Tuvo mayor número de ejecuciones",
    "Aumento el promedio de tiempo respuesta",
  ];

  const rows = result.rows.map((row) => [
    getIncidentPhaseLabel(row.phase),
    row.date,
    row.trx || "-",
    row.exception || "-",
    row.description || "-",
    row.resumenIA || "-",
    row.detalleErroresControlados || "-",
    row.codigoErrorControlado || "-",
    row.apxChannel || "-",
    row.fechaRevision || "-",
    row.numeroEjecuciones,
    row.numeroErrores,
    formatMs(row.numeroTiempoRespuestaMs),
    row.tuvoMayorNumeroEjecuciones,
    row.aumentoPromedioTiempoRespuesta,
  ]);

  return { headers, rows };
}

export function buildIncidentMonitoringCsv(
  result: IncidentMonitoringResult
): string {
  const matrix = buildIncidentMonitoringMatrix(result);
  return buildCsv(matrix.headers, matrix.rows);
}

export function buildIncidentMonitoringSheetsText(
  result: IncidentMonitoringResult
): string {
  const matrix = buildIncidentMonitoringMatrix(result);
  return buildTsv(matrix.headers, matrix.rows);
}

export async function copyIncidentMonitoringToSheets(
  result: IncidentMonitoringResult
): Promise<void> {
  const matrix = buildIncidentMonitoringMatrix(result);
  await copyTableToGoogleSheets(matrix.headers, matrix.rows);
}