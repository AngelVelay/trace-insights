import type { KPISummary } from "@/types/bbva";
import { formatDurationMs } from "@/services/dateUtils";
import {
  Activity,
  Layers,
  Zap,
  Clock,
  Hash,
  Server,
  Database,
  Workflow,
  Cable,
  Boxes,
  PlayCircle,
} from "lucide-react";

interface KPIDashboardProps {
  kpis: KPISummary;
  selectedInvokerTx?: string | null;
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

export default function KPIDashboard({
  kpis,
  selectedInvokerTx,
}: KPIDashboardProps) {
  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {selectedInvokerTx
          ? `Vista filtrada por invokerTx: ${selectedInvokerTx}`
          : "Vista general. Haz click en un invokerTx para ver KPIs y trazas específicas."}
      </div>

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
                {c.format ? formatDurationMs(Number(value ?? 0)) : Number(value ?? 0).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}