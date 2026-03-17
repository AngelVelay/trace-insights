import { useCallback, useState } from "react";
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
import ExportButtons from "@/components/ExportButtons";
import MetricsCharts from "@/components/MetricsCharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

function computeKPIs(rows: MetricRow[], spans: NormalizedSpan[]): KPISummary {
  const invokerTxs = new Set(
    rows.map((r) => {
      try {
        const parsed = JSON.parse(String(r.invokerTx));
        return parsed?.invokerTx ?? String(r.invokerTx);
      } catch {
        return String(r.invokerTx);
      }
    })
  );

  const utypes = new Set<string>();
  const params = new Set<string>();

  for (const row of rows) {
    try {
      const utilityItems = JSON.parse(String(row.utilitytype));
      if (Array.isArray(utilityItems)) {
        utilityItems.forEach((item) => {
          if (item?.utilitytype) utypes.add(String(item.utilitytype));
        });
      } else if (row.utilitytype && row.utilitytype !== "-") {
        utypes.add(String(row.utilitytype));
      }
    } catch {
      if (row.utilitytype && row.utilitytype !== "-") {
        utypes.add(String(row.utilitytype));
      }
    }

    try {
      const invokedItems = JSON.parse(String(row.invokedparam));
      if (Array.isArray(invokedItems)) {
        invokedItems.forEach((item) => {
          if (item?.invokedparam) params.add(String(item.invokedparam));
        });
      } else if (row.invokedparam && row.invokedparam !== "-") {
        params.add(String(row.invokedparam));
      }
    } catch {
      if (row.invokedparam && row.invokedparam !== "-") {
        params.add(String(row.invokedparam));
      }
    }
  }

  const totalDur = spans.reduce((s, sp) => s + sp.durationMs, 0);
  const classified = classifySpans(spans);

  return {
    totalInvokerTx: invokerTxs.size,
    totalUtilityTypes: utypes.size,
    totalInvokedParams: params.size,
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
  const { bearerToken, setBearerToken } = useBearerToken();

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

  const handleSearch = useCallback(async (filters: MetricsFilters) => {
    setLoading(true);
    setProgress("Iniciando consulta...");
    setMetricsError(null);
    setRows([]);
    setSpans([]);
    setClassified(null);

    try {
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
  }, []);

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