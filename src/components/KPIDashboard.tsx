import type { KPISummary } from "@/types/bbva";
import type { AwsInformComparisonResult } from "@/services/metricsService";
import { formatDurationMs } from "@/services/dateUtils";
import {
  Activity,
  Boxes,
  Cable,
  Clock,
  Database,
  Hash,
  Layers,
  PlayCircle,
  Server,
  Workflow,
  Zap,
  SplitSquareVertical,
  AlertTriangle,
} from "lucide-react";

interface KPIDashboardProps {
  kpis: KPISummary;
  selectedInvokerTx?: string | null;
  comparisonResult?: AwsInformComparisonResult | null;
}

const cards = [
  { key: "totalInvokerTx" as const, label: "InvokerTx", icon: Server, color: "text-primary" },
  { key: "totalUtilityTypes" as const, label: "Utility Types", icon: Layers, color: "text-accent" },
  { key: "totalInvokedParams" as const, label: "Invoked Params", icon: Hash, color: "text-warning" },
  { key: "totalExecutions" as const, label: "Ejecuciones", icon: PlayCircle, color: "text-primary" },
  { key: "totalJumps" as const, label: "Saltos", icon: Zap, color: "text-destructive" },
  { key: "totalDurationMs" as const, label: "Tiempo Total", icon: Clock, color: "text-accent", format: true },
  { key: "avgDurationMs" as const, label: "Tiempo Promedio", icon: Activity, color: "text-warning", format: true },
  { key: "traceApiConnectors" as const, label: "API Connectors", icon: Workflow, color: "text-primary" },
  { key: "traceCics" as const, label: "CICS", icon: Cable, color: "text-destructive" },
  { key: "traceJdbc" as const, label: "JDBC", icon: Database, color: "text-accent" },
  { key: "traceMongo" as const, label: "Mongo", icon: Boxes, color: "text-warning" },
];

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString();
}

export default function KPIDashboard({
  kpis,
  selectedInvokerTx,
  comparisonResult,
}: KPIDashboardProps) {
  const comparison = comparisonResult?.summary ?? null;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {selectedInvokerTx
          ? `Vista filtrada por invokerTx: ${selectedInvokerTx}`
          : "Vista general. Haz click en un invokerTx para ver KPIs, trazas y comparativo LIVE-02 vs LIVE-04."}
      </div>

      {comparison ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <SplitSquareVertical className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">LIVE-02 Exec</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatNumber(comparison.totalExecutionsLive02)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <SplitSquareVertical className="h-4 w-4 text-accent" />
              <span className="text-xs text-muted-foreground">LIVE-04 Exec</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatNumber(comparison.totalExecutionsLive04)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">LIVE-02 Err</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatNumber(comparison.totalErrorsLive02)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground">LIVE-04 Err</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatNumber(comparison.totalErrorsLive04)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">LIVE-02 Saltos</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatNumber(comparison.totalJumpsLive02)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-accent" />
              <span className="text-xs text-muted-foreground">LIVE-04 Saltos</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatNumber(comparison.totalJumpsLive04)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground">LIVE-02 Prom</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatDurationMs(comparison.avgDurationLive02)}
            </span>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">LIVE-04 Prom</span>
            </div>
            <span className="font-mono text-2xl font-bold">
              {formatDurationMs(comparison.avgDurationLive04)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-11">
        {cards.map((c) => {
          const Icon = c.icon;
          const value = kpis[c.key];

          return (
            <div
              key={c.key}
              className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${c.color}`} />
                <span className="text-xs text-muted-foreground">{c.label}</span>
              </div>

              <span className="font-mono text-2xl font-bold">
                {c.format
                  ? formatDurationMs(Number(value ?? 0))
                  : Number(value ?? 0).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}