import type { KPISummary } from '@/types/bbva';
import { formatDurationMs } from '@/services/dateUtils';
import { Activity, Layers, Zap, Clock, Hash, Server } from 'lucide-react';

interface KPIDashboardProps {
  kpis: KPISummary;
}

const cards = [
  { key: 'totalInvokerTx' as const, label: 'InvokerTx', icon: Server, color: 'text-primary' },
  { key: 'totalUtilityTypes' as const, label: 'Utility Types', icon: Layers, color: 'text-accent' },
  { key: 'totalInvokedParams' as const, label: 'Invoked Params', icon: Hash, color: 'text-warning' },
  { key: 'totalJumps' as const, label: 'Total Saltos', icon: Zap, color: 'text-primary' },
  { key: 'totalDurationMs' as const, label: 'Tiempo Total', icon: Clock, color: 'text-accent', format: true },
  { key: 'avgDurationMs' as const, label: 'Tiempo Promedio', icon: Activity, color: 'text-warning', format: true },
];

export default function KPIDashboard({ kpis }: KPIDashboardProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        const value = kpis[c.key];
        return (
          <div
            key={c.key}
            className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${c.color}`} />
              <span className="text-xs text-muted-foreground">{c.label}</span>
            </div>
            <span className="text-2xl font-bold font-mono">
              {c.format ? formatDurationMs(value) : value.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
