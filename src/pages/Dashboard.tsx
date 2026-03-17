import { useCallback, useMemo, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useBearerToken } from "@/hooks/useBearerToken";
import type {
  MetricsFilters,
  MetricRow,
  KPISummary,
  NormalizedSpan,
  ClassifiedTraces,
} from "@/types/bbva";
import { fetchFullMetrics } from "@/services/metricsService";
import { fetchSpans, classifySpans } from "@/services/tracesService";
import FilterPanel from "@/components/FilterPanel";
import KPIDashboard from "@/components/KPIDashboard";
import MetricsTable from "@/components/MetricsTable";
import TracesView from "@/components/TracesView";
import MetricsCharts from "@/components/MetricsCharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";

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

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function flattenRowsForExport(rows: MetricRow[]) {
  const output: Array<Record<string, string | number>> = [];

  for (const row of rows) {
    const tx = parseInvokerTxItem(row.invokerTx);
    const libraries = parseLibraryItems(row.invokerLibrary);
    const utilityTypes = parseUtilityTypeItems(row.utilitytype);
    const invokedParams = parseInvokedParamItems(row.invokedparam);

    if (invokedParams.length > 0) {
      for (const item of invokedParams) {
        output.push({
          site: row.site,
          invokerTx: tx?.invokerTx ?? "",
          invokerTxExecuciones: tx?.sum_num_executions ?? row.utility_count ?? 0,
          invokerTxMeanSpanDuration:
            tx?.mean_span_duration ?? row.mean_utility_duration ?? 0,
          invokerLibrary: item.invokerLibrary,
          utilityType: item.utilitytype,
          invokedParam: item.invokedparam,
          count: item.count,
          maxDuration: item.maxDuration,
        });
      }
      continue;
    }

    if (utilityTypes.length > 0) {
      for (const item of utilityTypes) {
        output.push({
          site: row.site,
          invokerTx: tx?.invokerTx ?? "",
          invokerTxExecuciones: tx?.sum_num_executions ?? row.utility_count ?? 0,
          invokerTxMeanSpanDuration:
            tx?.mean_span_duration ?? row.mean_utility_duration ?? 0,
          invokerLibrary: item.invokerLibrary,
          utilityType: item.utilitytype,
          invokedParam: "",
          count: item.count,
          maxDuration: row.max_utility_duration ?? 0,
        });
      }
      continue;
    }

    if (libraries.length > 0) {
      for (const item of libraries) {
        output.push({
          site: row.site,
          invokerTx: tx?.invokerTx ?? "",
          invokerTxExecuciones: tx?.sum_num_executions ?? row.utility_count ?? 0,
          invokerTxMeanSpanDuration:
            tx?.mean_span_duration ?? row.mean_utility_duration ?? 0,
          invokerLibrary: item.invokerLibrary,
          utilityType: "",
          invokedParam: "",
          count: item.count,
          maxDuration: row.max_utility_duration ?? 0,
        });
      }
      continue;
    }

    output.push({
      site: row.site,
      invokerTx: tx?.invokerTx ?? "",
      invokerTxExecuciones: tx?.sum_num_executions ?? row.utility_count ?? 0,
      invokerTxMeanSpanDuration:
        tx?.mean_span_duration ?? row.mean_utility_duration ?? 0,
      invokerLibrary: "",
      utilityType: "",
      invokedParam: "",
      count: row.utility_count ?? 0,
      maxDuration: row.max_utility_duration ?? 0,
    });
  }

  return output;
}

function buildCsv(rows: MetricRow[]): string {
  const normalized = flattenRowsForExport(rows);

  const headers = [
    "site",
    "invokerTx",
    "invokerTxExecuciones",
    "invokerTxMeanSpanDuration",
    "invokerLibrary",
    "utilityType",
    "invokedParam",
    "count",
    "maxDuration",
  ];

  return [headers, ...normalized.map((row) => headers.map((key) => row[key] ?? ""))]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildSheetsText(rows: MetricRow[]): string {
  const normalized = flattenRowsForExport(rows);

  const headers = [
    "site",
    "invokerTx",
    "invokerTxExecuciones",
    "invokerTxMeanSpanDuration",
    "invokerLibrary",
    "utilityType",
    "invokedParam",
    "count",
    "maxDuration",
  ];

  return [headers, ...normalized.map((row) => headers.map((key) => String(row[key] ?? "")))]
    .map((row) => row.join("\t"))
    .join("\n");
}

function computeKPIs(rows: MetricRow[], spans: NormalizedSpan[]): KPISummary {
  const invokerTxs = new Set<string>();
  const utilityTypes = new Set<string>();
  const invokedParams = new Set<string>();

  let pipelineApi = 0;
  let pipelineCics = 0;
  let pipelineJdbc = 0;
  let pipelineMongo = 0;
  let pipelineTotalJumps = 0;
  let pipelineDurationTotal = 0;

  for (const row of rows) {
    const tx = parseInvokerTxItem(row.invokerTx);
    if (tx?.invokerTx) {
      invokerTxs.add(tx.invokerTx);
      pipelineDurationTotal += Number(tx.mean_span_duration ?? 0);
    }

    const utilityItems = parseUtilityTypeItems(row.utilitytype);
    for (const item of utilityItems) {
      utilityTypes.add(item.utilitytype);
      pipelineTotalJumps += item.count;

      if (item.utilitytype === "APIInternalConnectorImpl") pipelineApi += item.count;
      if (item.utilitytype === "InterBackendCics") pipelineCics += item.count;
      if (item.utilitytype === "Jdbc") pipelineJdbc += item.count;
      if (item.utilitytype === "DaasMongoConnector") pipelineMongo += item.count;
    }

    const invokedItems = parseInvokedParamItems(row.invokedparam);
    for (const item of invokedItems) {
      invokedParams.add(item.invokedparam);
    }
  }

  if (spans.length > 0) {
    const totalDur = spans.reduce((s, sp) => s + sp.durationMs, 0);
    const classified = classifySpans(spans);

    return {
      totalInvokerTx: invokerTxs.size,
      totalUtilityTypes: utilityTypes.size,
      totalInvokedParams: invokedParams.size,
      totalJumps: spans.length,
      totalDurationMs: totalDur,
      avgDurationMs: spans.length > 0 ? totalDur / spans.length : 0,
      traceApiConnectors: classified.APIInternalConnectorImpl.length,
      traceCics: classified.InterBackendCics.length,
      traceJdbc: classified.Jdbc.length,
      traceMongo: classified.DaasMongoConnector.length,
    };
  }

  return {
    totalInvokerTx: invokerTxs.size,
    totalUtilityTypes: utilityTypes.size,
    totalInvokedParams: invokedParams.size,
    totalJumps: pipelineTotalJumps,
    totalDurationMs: pipelineDurationTotal,
    avgDurationMs: rows.length > 0 ? pipelineDurationTotal / rows.length : 0,
    traceApiConnectors: pipelineApi,
    traceCics: pipelineCics,
    traceJdbc: pipelineJdbc,
    traceMongo: pipelineMongo,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [spans, setSpans] = useState<NormalizedSpan[]>([]);
  const [classified, setClassified] = useState<ClassifiedTraces | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const { setBearerToken } = useBearerToken();

  const [kpis, setKpis] = useState<KPISummary>({
    totalInvokerTx: 0,
    totalUtilityTypes: 0,
    totalInvokedParams: 0,
    totalJumps: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    traceApiConnectors: 0,
    traceCics: 0,
    traceJdbc: 0,
    traceMongo: 0,
  });

  const normalizedExportRows = useMemo(() => flattenRowsForExport(rows), [rows]);

  const handleSearch = useCallback(async (filters: MetricsFilters) => {
    setLoading(true);
    setProgress("Iniciando consulta...");
    setMetricsError(null);
    setRows([]);
    setSpans([]);
    setClassified(null);

    try {
      if (filters.bearerToken) {
        setBearerToken(filters.bearerToken);
      }

      const metricRows = await fetchFullMetrics(filters, setProgress);
      setRows(metricRows);

      let allSpans: NormalizedSpan[] = [];

      if (filters.searchMode === "rho" && filters.invokerTx) {
        setProgress(`Obteniendo trazas de ${filters.invokerTx}...`);
        allSpans = await fetchSpans(filters, filters.invokerTx);
      }

      setSpans(allSpans);

      const cls = classifySpans(allSpans);
      setClassified(cls);
      setKpis(computeKPIs(metricRows, allSpans));

      toast.success(
        `Consulta completada: ${metricRows.length} métricas, ${allSpans.length} trazas`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      console.error("[Dashboard] Error:", err);
      setMetricsError(msg);
      toast.error(`Error: ${msg}`);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, [setBearerToken]);

  const handleDownloadCsv = () => {
    if (!rows.length) {
      toast.error("No hay datos para exportar.");
      return;
    }

    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `aws-monitoreo-${Date.now()}.csv`;
    link.click();

    URL.revokeObjectURL(url);
    toast.success("CSV descargado correctamente.");
  };

  const handleCopySheets = async () => {
    if (!rows.length) {
      toast.error("No hay datos para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildSheetsText(rows));
      toast.success("Tabla copiada. Ya puedes pegarla en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <LoadingOverlay show={loading} />
      <main className="container space-y-6 py-6">
        <FilterPanel onSearch={handleSearch} loading={loading} />

        {loading && (
          <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="h-3 w-3 animate-pulse rounded-full bg-primary" />
            <span className="font-mono text-sm text-primary">{progress}</span>
          </div>
        )}

        <KPIDashboard kpis={kpis} />

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadCsv}
            disabled={!normalizedExportRows.length}
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleCopySheets}
            disabled={!normalizedExportRows.length}
          >
            <Copy className="mr-2 h-4 w-4" />
            Copiar para Google Sheets
          </Button>
        </div>

        <Tabs defaultValue="metrics" className="space-y-4">
          <TabsList className="border border-border bg-card">
            <TabsTrigger value="charts" className="text-xs">
              Gráficas
            </TabsTrigger>
            <TabsTrigger value="metrics" className="text-xs">
              Métricas ({rows.length})
            </TabsTrigger>
            <TabsTrigger value="traces" className="text-xs">
              Trazas ({spans.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="charts">
            <MetricsCharts rows={rows} />
          </TabsContent>

          <TabsContent value="metrics">
            <MetricsTable
              rows={rows}
              loading={loading}
              errorMessage={metricsError}
            />
          </TabsContent>

          <TabsContent value="traces">
            {classified ? (
              <TracesView classified={classified} allSpans={spans} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                Ejecuta una consulta RHO con un invokerTx para ver trazas.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}