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
import { toast } from "sonner";

type InvokerTxItem = {
  invokerTx: string;
  sum_num_executions: number;
  mean_span_duration: number;
  sum_functional_error?: number;
  sum_technical_error?: number;
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
  if (!value || typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as Partial<InvokerTxItem>;
    if (!parsed?.invokerTx) return null;

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

function parseUtilityTypeItems(value: unknown): UtilityTypeItem[] {
  if (!value || typeof value !== "string" || value === "-") return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        invokerLibrary: String(item?.invokerLibrary ?? "").trim(),
        utilitytype: String(item?.utilitytype ?? "").trim(),
        count: Number(item?.count ?? 0),
      }))
      .filter((item) => item.utilitytype.length > 0);
  } catch {
    return [];
  }
}

function parseInvokedParamItems(value: unknown): InvokedParamItem[] {
  if (!value || typeof value !== "string" || value === "-") return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        invokerLibrary: String(item?.invokerLibrary ?? "").trim(),
        utilitytype: String(item?.utilitytype ?? "").trim(),
        invokedparam: String(item?.invokedparam ?? "").trim(),
        count: Number(item?.count ?? 0),
        maxDuration: Number(item?.maxDuration ?? 0),
      }))
      .filter((item) => item.invokedparam.length > 0);
  } catch {
    return [];
  }
}

function computeKPIs(rows: MetricRow[], spans: NormalizedSpan[]): KPISummary {
  const invokerTxs = new Set<string>();
  const utilityTypes = new Set<string>();
  const invokedParams = new Set<string>();

  let totalExecutions = 0;

  for (const row of rows) {
    const tx = parseInvokerTxItem(row.invokerTx);
    if (tx?.invokerTx) {
      invokerTxs.add(tx.invokerTx);
      totalExecutions += Number(tx.sum_num_executions ?? 0);
    }

    const utilityItems = parseUtilityTypeItems(row.utilitytype);
    for (const item of utilityItems) {
      utilityTypes.add(item.utilitytype);
    }

    const invokedItems = parseInvokedParamItems(row.invokedparam);
    for (const item of invokedItems) {
      invokedParams.add(item.invokedparam);
    }
  }

  const totalDur = spans.reduce((s, sp) => s + sp.durationMs, 0);
  const classified = classifySpans(spans);

  return {
    totalInvokerTx: invokerTxs.size,
    totalUtilityTypes: utilityTypes.size,
    totalInvokedParams: invokedParams.size,
    totalExecutions,
    totalJumps: spans.length,
    totalDurationMs: totalDur,
    avgDurationMs: spans.length > 0 ? totalDur / spans.length : 0,
    traceApiConnectors: classified.APIInternalConnectorImpl.length,
    traceCics: classified.InterBackendCics.length,
    traceJdbc: classified.Jdbc.length,
    traceMongo: classified.DaasMongoConnector.length,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [spans, setSpans] = useState<NormalizedSpan[]>([]);
  const [classified, setClassified] = useState<ClassifiedTraces | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [selectedInvokerTx, setSelectedInvokerTx] = useState<string | null>(null);
  const [lastFilters, setLastFilters] = useState<MetricsFilters | null>(null);
  const { setBearerToken } = useBearerToken();

  const [kpis, setKpis] = useState<KPISummary>({
    totalInvokerTx: 0,
    totalUtilityTypes: 0,
    totalInvokedParams: 0,
    totalExecutions: 0,
    totalJumps: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    traceApiConnectors: 0,
    traceCics: 0,
    traceJdbc: 0,
    traceMongo: 0,
  });

  const selectedRows = useMemo(() => {
    if (!selectedInvokerTx) return rows;

    return rows.filter((row) => {
      const meta = parseInvokerTxItem(row.invokerTx);
      return meta?.invokerTx === selectedInvokerTx;
    });
  }, [rows, selectedInvokerTx]);

  const loadSpansForInvokerTx = useCallback(
    async (filters: MetricsFilters, invokerTx: string, metricRows: MetricRow[]) => {
      setProgress(`Obteniendo trazas de ${invokerTx}...`);

      const allSpans = await fetchSpans(filters, invokerTx);
      setSpans(allSpans);

      const cls = classifySpans(allSpans);
      setClassified(cls);

      const scopedRows = metricRows.filter((row) => {
        const meta = parseInvokerTxItem(row.invokerTx);
        return meta?.invokerTx === invokerTx;
      });

      setKpis(computeKPIs(scopedRows, allSpans));
    },
    []
  );

  const handleSearch = useCallback(
    async (filters: MetricsFilters) => {
      setLoading(true);
      setProgress("Iniciando consulta...");
      setMetricsError(null);
      setRows([]);
      setSpans([]);
      setClassified(null);
      setSelectedInvokerTx(null);
      setLastFilters(filters);

      try {
        if (filters.bearerToken) {
          setBearerToken(filters.bearerToken);
        }

        const metricRows = await fetchFullMetrics(filters, setProgress);
        setRows(metricRows);

        if (metricRows.length > 0) {
          const firstMeta = parseInvokerTxItem(metricRows[0].invokerTx);
          const firstInvokerTx = firstMeta?.invokerTx ?? null;

          if (firstInvokerTx) {
            setSelectedInvokerTx(firstInvokerTx);
            await loadSpansForInvokerTx(filters, firstInvokerTx, metricRows);
          } else {
            setKpis(computeKPIs(metricRows, []));
          }
        } else {
          setKpis(computeKPIs([], []));
        }

        toast.success(`Consulta completada: ${metricRows.length} métricas`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error("[Dashboard] Error:", err);
        setMetricsError(msg);
        toast.error(`Error: ${msg}`);
      } finally {
        setLoading(false);
        setProgress("");
      }
    },
    [loadSpansForInvokerTx, setBearerToken]
  );

  const handleSelectInvokerTx = useCallback(
    async (invokerTx: string) => {
      if (!lastFilters) return;

      setSelectedInvokerTx(invokerTx);
      setLoading(true);

      try {
        await loadSpansForInvokerTx(lastFilters, invokerTx, rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        toast.error(`Error cargando trazas de ${invokerTx}: ${msg}`);
      } finally {
        setLoading(false);
        setProgress("");
      }
    },
    [lastFilters, loadSpansForInvokerTx, rows]
  );

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

        <KPIDashboard kpis={kpis} selectedInvokerTx={selectedInvokerTx} />

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
            <MetricsCharts
              rows={rows}
              selectedInvokerTx={selectedInvokerTx}
            />
          </TabsContent>

          <TabsContent value="metrics">
            <MetricsTable
              rows={rows}
              loading={loading}
              errorMessage={metricsError}
              selectedInvokerTx={selectedInvokerTx}
              onSelectInvokerTx={handleSelectInvokerTx}
            />
          </TabsContent>

          <TabsContent value="traces">
            {classified ? (
              <TracesView classified={classified} allSpans={spans} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                Selecciona un invokerTx para ver sus trazas.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}