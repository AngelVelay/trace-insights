import { useState, useCallback } from 'react';
import type {
  MetricsFilters,
  MetricRow,
  KPISummary,
  NormalizedSpan,
  ClassifiedTraces,
} from '@/types/bbva';
import { fetchFullMetrics } from '@/services/metricsService';
import { fetchSpans, classifySpans } from '@/services/tracesService';
import FilterPanel from '@/components/FilterPanel';
import KPIDashboard from '@/components/KPIDashboard';
import MetricsTable from '@/components/MetricsTable';
import TracesView from '@/components/TracesView';
import ExportButtons from '@/components/ExportButtons';
import MetricsCharts from '@/components/MetricsCharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';

function computeKPIs(rows: MetricRow[], spans: NormalizedSpan[]): KPISummary {
  const invokerTxs = new Set(rows.map((r) => r.invokerTx));
  const utypes = new Set(rows.map((r) => r.utilitytype));
  const params = new Set(rows.map((r) => r.invokedparam));
  const totalDur = spans.reduce((s, sp) => s + sp.durationMs, 0);

  return {
    totalInvokerTx: invokerTxs.size,
    totalUtilityTypes: utypes.size,
    totalInvokedParams: params.size,
    totalJumps: spans.length,
    totalDurationMs: totalDur,
    avgDurationMs: spans.length > 0 ? totalDur / spans.length : 0,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
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
    setProgress('Iniciando consulta...');

    try {
      // Fetch metrics
      const metricRows = await fetchFullMetrics(filters, setProgress);
      setRows(metricRows);

      // Fetch traces if invokerTx specified
      let allSpans: NormalizedSpan[] = [];
      if (filters.invokerTx) {
        setProgress('Obteniendo trazas...');
        allSpans = await fetchSpans(filters, filters.invokerTx);
      }

      setSpans(allSpans);
      const cls = classifySpans(allSpans);
      setClassified(cls);
      setKpis(computeKPIs(metricRows, allSpans));

      toast.success(`Consulta completada: ${metricRows.length} métricas, ${allSpans.length} trazas`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      toast.error(`Error: ${msg}`);
    } finally {
      setLoading(false);
      setProgress('');
    }
  }, []);

  return (
    <div className="min-h-screen gradient-mesh">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">B</span>
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight">BBVA Observability</h1>
              <p className="text-xs text-muted-foreground">Métricas & Trazas Dashboard</p>
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

        <Tabs defaultValue="metrics" className="space-y-4">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="metrics" className="text-xs">
              Métricas ({rows.length})
            </TabsTrigger>
            <TabsTrigger value="traces" className="text-xs">
              Trazas ({spans.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="metrics">
            <MetricsTable rows={rows} />
          </TabsContent>

          <TabsContent value="traces">
            {classified ? (
              <TracesView classified={classified} allSpans={spans} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                Especifica un InvokerTx y ejecuta la consulta para ver trazas.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
