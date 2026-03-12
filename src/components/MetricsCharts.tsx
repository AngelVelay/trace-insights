import { useMemo } from 'react';
import type { MetricRow } from '@/types/bbva';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts';

interface MetricsChartsProps {
  rows: MetricRow[];
}

const COLORS = [
  'hsl(199, 89%, 48%)',  // primary
  'hsl(160, 84%, 39%)',  // accent
  'hsl(38, 92%, 50%)',   // warning
  'hsl(280, 65%, 60%)',  // chart-4
  'hsl(0, 72%, 51%)',    // chart-5
  'hsl(210, 70%, 55%)',
  'hsl(130, 60%, 45%)',
  'hsl(50, 80%, 55%)',
];

export default function MetricsCharts({ rows }: MetricsChartsProps) {
  // Aggregate by utilityType
  const byUtilityType = useMemo(() => {
    const map = new Map<string, { count: number; meanDur: number; maxDur: number; entries: number }>();
    for (const r of rows) {
      const existing = map.get(r.utilitytype) ?? { count: 0, meanDur: 0, maxDur: 0, entries: 0 };
      existing.count += r.utility_count;
      existing.meanDur += r.mean_utility_duration;
      existing.maxDur = Math.max(existing.maxDur, r.max_utility_duration);
      existing.entries += 1;
      map.set(r.utilitytype, existing);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      count: v.count,
      avgDuration: v.entries > 0 ? v.meanDur / v.entries : 0,
      maxDuration: v.maxDur,
    }));
  }, [rows]);

  // Aggregate by invokerTx (top 15)
  const byInvokerTx = useMemo(() => {
    const map = new Map<string, { count: number; meanDur: number; entries: number }>();
    for (const r of rows) {
      const existing = map.get(r.invokerTx) ?? { count: 0, meanDur: 0, entries: 0 };
      existing.count += r.utility_count;
      existing.meanDur += r.mean_utility_duration;
      existing.entries += 1;
      map.set(r.invokerTx, existing);
    }
    return [...map.entries()]
      .map(([name, v]) => ({
        name,
        count: v.count,
        avgDuration: v.entries > 0 ? v.meanDur / v.entries : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [rows]);

  // Duration distribution by utilityType (min/mean/max)
  const durationComparison = useMemo(() => {
    const map = new Map<string, { min: number; mean: number; max: number; entries: number }>();
    for (const r of rows) {
      const existing = map.get(r.utilitytype) ?? { min: Infinity, mean: 0, max: 0, entries: 0 };
      existing.min = Math.min(existing.min, r.min_utility_duration);
      existing.mean += r.mean_utility_duration;
      existing.max = Math.max(existing.max, r.max_utility_duration);
      existing.entries += 1;
      map.set(r.utilitytype, existing);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      min: v.min === Infinity ? 0 : Number(v.min.toFixed(2)),
      mean: v.entries > 0 ? Number((v.mean / v.entries).toFixed(2)) : 0,
      max: Number(v.max.toFixed(2)),
    }));
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Ejecuta una consulta para ver las gráficas.
      </div>
    );
  }

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: 'hsl(220, 18%, 10%)',
      border: '1px solid hsl(220, 14%, 18%)',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: 'JetBrains Mono, monospace',
    },
    labelStyle: { color: 'hsl(210, 20%, 92%)' },
    itemStyle: { color: 'hsl(210, 20%, 85%)' },
  };

  return (
    <div className="space-y-6">
      {/* Row 1: Pie + Bar count */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pie: Distribution by utilityType */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Distribución por Utility Type (Conteo)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={byUtilityType}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={50}
                strokeWidth={2}
                stroke="hsl(220, 20%, 7%)"
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                labelLine={{ stroke: 'hsl(215, 12%, 55%)' }}
                fontSize={11}
              >
                {byUtilityType.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar: Count by invokerTx */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Top InvokerTx por Conteo
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byInvokerTx} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215, 12%, 55%)' }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: 'hsl(210, 20%, 85%)', fontFamily: 'JetBrains Mono' }}
                width={110}
              />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="count" fill="hsl(199, 89%, 48%)" radius={[0, 4, 4, 0]} name="Conteo" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Duration comparison (min/mean/max by utilityType) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Duración por Utility Type (Min / Mean / Max)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={durationComparison} margin={{ bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: 'hsl(215, 12%, 55%)', fontFamily: 'JetBrains Mono' }}
                angle={-25}
                textAnchor="end"
              />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(215, 12%, 55%)' }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="min" fill="hsl(160, 84%, 39%)" name="Min" radius={[4, 4, 0, 0]} />
              <Bar dataKey="mean" fill="hsl(199, 89%, 48%)" name="Mean" radius={[4, 4, 0, 0]} />
              <Bar dataKey="max" fill="hsl(0, 72%, 51%)" name="Max" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar: utility types profile */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            Perfil de Utility Types
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={byUtilityType} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="hsl(220, 14%, 18%)" />
              <PolarAngleAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: 'hsl(210, 20%, 85%)' }}
              />
              <PolarRadiusAxis
                tick={{ fontSize: 9, fill: 'hsl(215, 12%, 55%)' }}
                axisLine={false}
              />
              <Radar
                name="Conteo"
                dataKey="count"
                stroke="hsl(199, 89%, 48%)"
                fill="hsl(199, 89%, 48%)"
                fillOpacity={0.2}
              />
              <Radar
                name="Duración Promedio"
                dataKey="avgDuration"
                stroke="hsl(160, 84%, 39%)"
                fill="hsl(160, 84%, 39%)"
                fillOpacity={0.2}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
