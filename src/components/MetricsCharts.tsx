import { useMemo } from "react";
import type { MetricRow } from "@/types/bbva";
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
} from "recharts";

interface MetricsChartsProps {
  rows: MetricRow[];
}

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

const COLORS = [
  "hsl(199, 89%, 48%)",
  "hsl(160, 84%, 39%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 51%)",
  "hsl(210, 70%, 55%)",
  "hsl(130, 60%, 45%)",
  "hsl(50, 80%, 55%)",
];

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
      if (Array.isArray(parsed)) {
        return parseUtilityTypeItems(parsed);
      }
    } catch {
      return [];
    }
  }

  return [];
}

export default function MetricsCharts({ rows }: MetricsChartsProps) {
  const parsedRows = useMemo(() => {
    return rows.map((row) => ({
      ...row,
      invokerTxMeta: parseInvokerTxItem(row.invokerTx),
      utilityTypeItems: parseUtilityTypeItems(row.utilitytype),
    }));
  }, [rows]);

  const byUtilityType = useMemo(() => {
    const map = new Map<
      string,
      { count: number; avgDurationAcc: number; entries: number; maxDuration: number }
    >();

    for (const row of parsedRows) {
      const utilityItems = row.utilityTypeItems;

      if (utilityItems.length > 0) {
        for (const item of utilityItems) {
          const current = map.get(item.utilitytype) ?? {
            count: 0,
            avgDurationAcc: 0,
            entries: 0,
            maxDuration: 0,
          };

          current.count += item.count;
          current.avgDurationAcc += Number(row.mean_utility_duration ?? 0);
          current.entries += 1;
          current.maxDuration = Math.max(
            current.maxDuration,
            Number(row.max_utility_duration ?? 0)
          );

          map.set(item.utilitytype, current);
        }
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        count: value.count,
        avgDuration:
          value.entries > 0 ? value.avgDurationAcc / value.entries : 0,
        maxDuration: value.maxDuration,
      }))
      .sort((a, b) => b.count - a.count);
  }, [parsedRows]);

  const byInvokerTx = useMemo(() => {
    return parsedRows
      .map((row) => {
        const meta = row.invokerTxMeta;
        return {
          name: meta?.invokerTx ?? String(row.invokerTx ?? ""),
          count: Number(meta?.sum_num_executions ?? row.utility_count ?? 0),
          avgDuration: Number(
            meta?.mean_span_duration ?? row.mean_utility_duration ?? 0
          ),
        };
      })
      .filter((item) => item.name.trim().length > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }, [parsedRows]);

  const durationComparison = useMemo(() => {
    const map = new Map<
      string,
      { min: number; meanAcc: number; max: number; entries: number }
    >();

    for (const row of parsedRows) {
      for (const item of row.utilityTypeItems) {
        const current = map.get(item.utilitytype) ?? {
          min: Number.POSITIVE_INFINITY,
          meanAcc: 0,
          max: 0,
          entries: 0,
        };

        current.min = Math.min(
          current.min,
          Number(row.min_utility_duration ?? 0)
        );
        current.meanAcc += Number(row.mean_utility_duration ?? 0);
        current.max = Math.max(current.max, Number(row.max_utility_duration ?? 0));
        current.entries += 1;

        map.set(item.utilitytype, current);
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        min:
          value.min === Number.POSITIVE_INFINITY ? 0 : Number(value.min.toFixed(2)),
        mean:
          value.entries > 0
            ? Number((value.meanAcc / value.entries).toFixed(2))
            : 0,
        max: Number(value.max.toFixed(2)),
      }))
      .sort((a, b) => b.mean - a.mean);
  }, [parsedRows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Ejecuta una consulta para ver las gráficas.
      </div>
    );
  }

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "hsl(220, 18%, 10%)",
      border: "1px solid hsl(220, 14%, 18%)",
      borderRadius: "8px",
      fontSize: "12px",
      fontFamily: "JetBrains Mono, monospace",
    },
    labelStyle: { color: "hsl(210, 20%, 92%)" },
    itemStyle: { color: "hsl(210, 20%, 85%)" },
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Distribución por Utility Type
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
                label={({ name, percent }) =>
                  `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                }
                labelLine={{ stroke: "hsl(215, 12%, 55%)" }}
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

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top InvokerTx por ejecuciones
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={byInvokerTx} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{
                  fontSize: 10,
                  fill: "hsl(210, 20%, 85%)",
                  fontFamily: "JetBrains Mono",
                }}
                width={130}
              />
              <Tooltip {...tooltipStyle} />
              <Bar
                dataKey="count"
                fill="hsl(199, 89%, 48%)"
                radius={[0, 4, 4, 0]}
                name="Ejecuciones"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Duración por Utility Type (Min / Mean / Max)
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={durationComparison} margin={{ bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis
                dataKey="name"
                tick={{
                  fontSize: 10,
                  fill: "hsl(215, 12%, 55%)",
                  fontFamily: "JetBrains Mono",
                }}
                angle={-25}
                textAnchor="end"
              />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="min" fill="hsl(160, 84%, 39%)" name="Min" radius={[4, 4, 0, 0]} />
              <Bar dataKey="mean" fill="hsl(199, 89%, 48%)" name="Mean" radius={[4, 4, 0, 0]} />
              <Bar dataKey="max" fill="hsl(0, 72%, 51%)" name="Max" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Perfil de Utility Types
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={byUtilityType} cx="50%" cy="50%" outerRadius="70%">
              <PolarGrid stroke="hsl(220, 14%, 18%)" />
              <PolarAngleAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(210, 20%, 85%)" }}
              />
              <PolarRadiusAxis
                tick={{ fontSize: 9, fill: "hsl(215, 12%, 55%)" }}
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