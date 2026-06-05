import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { MetricRow } from "@/types/bbva";
import { buildAwsAnalysisReport } from "@/services/awsReportBuilder";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type InvokerTxMeta = {
  invokerTx?: string;
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

interface MetricsTableProps {
  rows: MetricRow[];
  loading?: boolean;
  errorMessage?: string | null;
  selectedInvokerTx?: string | null;
  onSelectInvokerTx?: (invokerTx: string, channelCode?: string) => void;
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

function parseInvokerTx(value: unknown): InvokerTxMeta {
  return safeJsonParse<InvokerTxMeta>(value, {});
}

function normalizeUtilityLabel(utilityType: string): string {
  const clean = String(utilityType ?? "").trim();

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

function buildUtilitySummary(row: MetricRow): string {
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

function getJdbcMethodsFromTrace(trace: unknown): string[] {
  const text = String(trace ?? "");

  const jdbcMatch = text.match(
    /JDBC([\s\S]*?)(?:\n(?:CICS|JPA|MONGO CONNECTOR|API-CONNECTOR INTERNO|API-CONNECTOR EXTERNO|API-CONNECTOR|TITAN CLIENT|GRPC CLIENT|OTROS|🔵)\n|$)/i
  );

  const jdbcBlock = jdbcMatch?.[1] ?? "";

  if (!jdbcBlock.trim()) {
    return [];
  }

  const methods = new Set<string>();

  for (const method of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    const regex = new RegExp(`\\b${method}\\s*:\\s*\\d+\\s*saltos`, "i");

    if (regex.test(jdbcBlock)) {
      methods.add(method);
    }
  }

  return Array.from(methods);
}

function buildJdbcAccessType(row: MetricRow): string {
  const methods = getJdbcMethodsFromTrace(row.trace);

  if (!methods.length) {
    return "-";
  }

  const hasWrite = methods.some((method) =>
    ["INSERT", "UPDATE", "DELETE"].includes(method)
  );

  if (hasWrite) {
    return "JDBC [WRITE]";
  }

  if (methods.includes("SELECT")) {
    return "JDBC [READ_ONLY]";
  }

  return "-";
}

function renderInvokerTxValue(value: unknown): {
  invokerTx: string;
  executions: number;
  durationMs: number;
} {
  const meta = parseInvokerTx(value);

  return {
    invokerTx: String(meta.invokerTx ?? "").trim() || "-",
    executions: Number(meta.sum_num_executions ?? 0),
    durationMs: Number(meta.mean_span_duration ?? 0),
  };
}

function renderInvokerTxCell(
  value: unknown,
  selectedInvokerTx?: string | null,
  onSelectInvokerTx?: (invokerTx: string, channelCode?: string) => void,
  channelCode?: string
) {
  const meta = renderInvokerTxValue(value);
  const selected = selectedInvokerTx === meta.invokerTx;

  return (
    <button
      type="button"
      disabled={!onSelectInvokerTx || meta.invokerTx === "-"}
      onClick={() => onSelectInvokerTx?.(meta.invokerTx, channelCode)}
      className={[
        "w-full rounded-lg border p-2 text-left font-mono text-xs transition",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-muted/30 hover:bg-muted/60",
        !onSelectInvokerTx || meta.invokerTx === "-"
          ? "cursor-default"
          : "cursor-pointer",
      ].join(" ")}
    >
      <div className="font-semibold">{meta.invokerTx}</div>
      <div className="text-muted-foreground">
        {formatNumber(meta.executions)} exec
      </div>
      <div className="text-muted-foreground">{formatMs(meta.durationMs)}</div>
    </button>
  );
}

function renderSimpleInvokerTxCell(value: unknown): string {
  const meta = renderInvokerTxValue(value);
  return meta.invokerTx;
}

function renderLibraryCell(value: unknown) {
  const libraries = safeJsonParse<LibraryItem[]>(value, []);

  if (!libraries.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="space-y-3">
      {libraries.map((item, index) => {
        const library = String(item.invokerLibrary ?? "").trim() || "-";
        const count = Number(item.count ?? 0);

        return (
          <div
            key={`${library}-${index}`}
            className="rounded-lg border border-border bg-muted/30 p-2"
          >
            <div className="font-mono text-xs font-semibold">{library}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {formatNumber(count)} exec
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderUtilityTypeCell(value: unknown) {
  const items = safeJsonParse<UtilityTypeItem[]>(value, []);

  if (!items.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const library = String(item.invokerLibrary ?? "").trim() || "-";
        const utilitytype = String(item.utilitytype ?? "").trim() || "-";
        const count = Number(item.count ?? 0);

        return (
          <div
            key={`${library}-${utilitytype}-${index}`}
            className="rounded-lg border border-border bg-muted/30 p-2"
          >
            <div className="font-mono text-xs font-semibold">{library}</div>
            <div className="font-mono text-xs">{utilitytype}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {formatNumber(count)} exec
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderInvokedParamCell(value: unknown) {
  const items = safeJsonParse<InvokedParamItem[]>(value, []);

  if (!items.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const library = String(item.invokerLibrary ?? "").trim() || "-";
        const utilitytype = String(item.utilitytype ?? "").trim() || "-";
        const invokedparam = String(item.invokedparam ?? "").trim() || "-";
        const count = Number(item.count ?? 0);
        const maxDuration = Number(item.maxDuration ?? 0);

        return (
          <div
            key={`${library}-${utilitytype}-${invokedparam}-${index}`}
            className="rounded-lg border border-border bg-muted/30 p-2"
          >
            <div className="font-mono text-xs font-semibold">{library}</div>
            <div className="font-mono text-xs">{utilitytype}</div>
            <div className="font-mono text-xs break-words">{invokedparam}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {formatNumber(count)} exec
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {formatMs(maxDuration)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderTraceCell(value: unknown) {
  const trace = String(value ?? "").trim();

  if (!trace || trace === "-") {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <pre className="max-h-96 min-w-[520px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-4 text-foreground">
      {trace}
    </pre>
  );
}

export default function MetricsTable({
  rows,
  loading = false,
  errorMessage,
  selectedInvokerTx,
  onSelectInvokerTx,
}: MetricsTableProps) {
  const handleCopyAwsReport = async (row: MetricRow) => {
    const report = buildAwsAnalysisReport(row);

    try {
      await navigator.clipboard.writeText(report);
      toast.success("Informe copiado al portapapeles.");
    } catch {
      toast.error("No se pudo copiar el informe.");
    }
  };

  if (errorMessage) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
        {errorMessage}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Métricas AWS Monitoreo</h2>
            <p className="text-xs text-muted-foreground">
              {rows.length} registros encontrados
            </p>
          </div>

          {loading && (
            <div className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
              Cargando...
            </div>
          )}
        </div>
      </div>

      <div className="max-h-[75vh] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="min-w-[100px]">Site</TableHead>
              <TableHead className="min-w-[100px]">Canal</TableHead>
              <TableHead className="min-w-[180px]">InvokerTx</TableHead>
              <TableHead className="min-w-[160px]">InvokerTx simple</TableHead>
              <TableHead className="min-w-[220px]">Library</TableHead>
              <TableHead className="min-w-[240px]">UtilityType</TableHead>
              <TableHead className="min-w-[240px]">Resumen Utility</TableHead>
              <TableHead className="min-w-[160px]">JDBC Tipo</TableHead>
              <TableHead className="min-w-[320px]">InvokedParam</TableHead>
              <TableHead className="min-w-[540px]">Trace</TableHead>
              <TableHead className="min-w-[420px]">Informe AWS</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {!rows.length && !loading ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  Sin métricas para mostrar.
                </TableCell>
              </TableRow>
            ) : null}

            {rows.map((row, index) => {
              const simpleInvokerTx = renderSimpleInvokerTxCell(row.invokerTx);

              const channelCode =
                String(row.channelCode ?? "").trim() &&
                String(row.channelCode ?? "").trim() !== "-"
                  ? String(row.channelCode ?? "").trim()
                  : undefined;

              return (
                <TableRow
                  key={`${row.site}-${channelCode ?? "all"}-${simpleInvokerTx}-${index}`}
                  className="align-top"
                >
                  <TableCell className="font-mono text-xs">
                    {row.site || "-"}
                  </TableCell>

                  <TableCell className="font-mono text-xs font-semibold">
                    {row.channelCode || "-"}
                  </TableCell>

                  <TableCell>
                    {renderInvokerTxCell(
                      row.invokerTx,
                      selectedInvokerTx,
                      onSelectInvokerTx,
                      channelCode
                    )}
                  </TableCell>

                  <TableCell className="font-mono text-xs font-semibold">
                    {simpleInvokerTx}
                  </TableCell>

                  <TableCell>{renderLibraryCell(row.invokerLibrary)}</TableCell>

                  <TableCell>
                    {renderUtilityTypeCell(row.utilitytype)}
                  </TableCell>

                  <TableCell className="min-w-[240px] align-top">
                    <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-2 text-xs font-medium leading-5">
                      {buildUtilitySummary(row)}
                    </div>
                  </TableCell>

                  <TableCell className="min-w-[160px] align-top">
                    <div className="rounded-lg border border-border bg-muted/30 p-2 text-xs font-semibold">
                      {buildJdbcAccessType(row)}
                    </div>
                  </TableCell>

                  <TableCell>
                    {renderInvokedParamCell(row.invokedparam)}
                  </TableCell>

                  <TableCell>{renderTraceCell(row.trace)}</TableCell>

                  <TableCell className="min-w-[420px] align-top">
                    <div className="space-y-2">
                      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-4 text-foreground">
                        {buildAwsAnalysisReport(row)}
                      </pre>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg text-xs"
                        onClick={() => handleCopyAwsReport(row)}
                      >
                        <Copy className="mr-2 h-3.5 w-3.5" />
                        Copiar informe
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}