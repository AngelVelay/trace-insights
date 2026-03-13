import { useState, useCallback } from "react";
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

function dedupeSpans(spans: NormalizedSpan[]): NormalizedSpan[] {
  const seen = new Set<string>();
  const result: NormalizedSpan[] = [];

  for (const span of spans) {
    const key = span.spanId || `${span.traceId}-${span.name}-${span.durationMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(span);
  }

  return result;
}

function computeKPIs(rows: MetricRow[], spans: NormalizedSpan[]): KPISummary {
  const invokerTxs = new Set(
    rows.map((r) => r.invokerTx).filter(Boolean)
  );

  const utypes = new Set(
    rows.map((r) => r.utilitytype).filter(Boolean)
  );

  const params = new Set(
    rows.map((r) => r.invokedparam).filter(Boolean)
  );

  const totalDur = spans.reduce((s, sp) => s + (sp.durationMs || 0), 0);

  return {
    totalInvokerTx: invokerTxs.size,
    totalUtilityTypes: utypes.size,
    totalInvokedParams: params.size,
    totalJumps: spans.length,
    totalDurationMs: totalDur,
    avgDurationMs: spans.length > 0 ? totalDur / spans.length : 0,
  };
}

async function fetchSpansForManyInvokerTx(
  filters: MetricsFilters,
  invokerTxList: string[],
  setProgress: (value: string) => void
): Promise<NormalizedSpan[]> {
  const uniqueInvokerTx = Array.from(
    new Set(invokerTxList.map((v) => String(v || "").trim()).filter(Boolean))
  );

  if (!uniqueInvokerTx.length) return [];

  const allSpans: NormalizedSpan[] = [];
  const total = uniqueInvokerTx.length;

  // Baja concurrencia para no romper RHO
  const CONCURRENCY = 3;

  for (let i = 0; i < uniqueInvokerTx.length; i += CONCURRENCY) {
    const chunk = uniqueInvokerTx.slice(i, i + CONCURRENCY);

    setProgress(
      `Obteniendo trazas RHO ${Math.min(i + 1, total)}-${Math.min(
        i + chunk.length,
        total
      )} de ${total}...`
    );

    const chunkResults = await Promise.allSettled(
      chunk.map(async (invokerTx) => {
        try {
          const spans = await fetchSpans(filters, invokerTx);
          return spans;
        } catch (error) {
          console.error(`Error obteniendo trazas para ${invokerTx}:`, error);
          return [];
        }
      })
    );

    for (const result of chunkResults) {
      if (result.status === "fulfilled" && Array.isArray(result.value)) {
        allSpans.push(...result.value);
      }
    }
  }

  return dedupeSpans(allSpans);
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [spans, setSpans] = useState<NormalizedSpan[]>([]);
  const [classified, setClassified] = useState<ClassifiedTraces | null>(null);
  const [kpis, setKpis] = useState<KPISummary>({
    totalInvokerTx: 0,
    totalUtilityTypes: 0,
    totalInvokedParams: 0,
    totalJumps: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
  });

  const handleSearch = useCallback(async (filters: MetricsFilters) => {
    setLoading(true);
    setProgress("Iniciando consulta...");
    setMetricsError(null);
    setRows([]);
    setSpans([]);
    setClassified(null);
    setKpis({
      totalInvokerTx: 0,
      totalUtilityTypes: 0,
      totalInvokedParams: 0,
      totalJumps: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
    });

    try {
      // 1) Fetch métricas completas
      setProgress("Obteniendo métricas MU...");
      const metricRows = await fetchFullMetrics(filters, setProgress);
      setRows(metricRows);

      // 2) Resolver qué invokerTx consultar en RHO
      let invokerTxToTrace: string[] = [];

      const iterateAllInvokerTx =
        (filters as MetricsFilters & { iterateAllInvokerTx?: boolean }).iterateAllInvokerTx === true;

      if (iterateAllInvokerTx) {
        invokerTxToTrace = Array.from(
          new Set(
            metricRows
              .map((r) => r.invokerTx)
              .filter((v): v is string => Boolean(v && String(v).trim()))
          )
        );
      } else if (filters.invokerTx?.trim()) {
        invokerTxToTrace = [filters.invokerTx.trim()];
      }

      // 3) Fetch trazas
      let allSpans: NormalizedSpan[] = [];

      if (invokerTxToTrace.length > 0) {
        allSpans = await fetchSpansForManyInvokerTx(
          filters,
          invokerTxToTrace,
          setProgress
        );
      }

      // 4) Clasificar y KPIs
      const dedupedSpans = dedupeSpans(allSpans);
      const cls = classifySpans(dedupedSpans);

      setSpans(dedupedSpans);
      setClassified(cls);
      setKpis(computeKPIs(metricRows, dedupedSpans));

      toast.success(
        `Consulta completada: ${metricRows.length} métricas, ${dedupedSpans.length} trazas, ${invokerTxToTrace.length} invokerTx`
      );
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setMetricsError(msg);
      toast.error(`Error: ${msg}`);
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, []);

  return (
    <div className="min-h-screen gradient-mesh">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">B</span>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">BBVA Observability</h1>
              <p className="text-xs text-muted-foreground">
                Métricas & Trazas Dashboard
              </p>
            </div>
          </div>

          <ExportButtons rows={rows} classified={classified} allSpans={spans} />
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <FilterPanel onSearch={handleSearch} loading={loading} />

        {loading && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-primary animate-pulse-glow" />
            <span className="text-sm font-mono text-primary">{progress}</span>
          </div>
        )}

        <KPIDashboard kpis={kpis} />

        <Tabs defaultValue="charts" className="space-y-4">
          <TabsList className="bg-card border border-border">
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
            <MetricsTable rows={rows} loading={loading} errorMessage={metricsError} />
          </TabsContent>

          <TabsContent value="traces">
            {classified ? (
              <TracesView classified={classified} allSpans={spans} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                Ejecuta la consulta para ver las trazas de los invokerTx.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}