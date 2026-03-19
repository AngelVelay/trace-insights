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
  ComposedChart,
  Line,
} from "recharts";

interface MetricsChartsProps {
  rows: MetricRow[];
  selectedInvokerTx?: string | null;
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

type InvokedParamItem = {
  invokerLibrary: string;
  utilitytype: string;
  invokedparam: string;
  count: number;
  maxDuration: number;
};

const COLORS = [
  "hsl(199, 89%, 48%)",
  "hsl(160, 84%, 39%)",
  "hsl(38, 92%, 50%)",
  "hsl(280, 65%, 60%)",
  "hsl(0, 72%, 51%)",
  "hsl(210, 70%, 55%)",
];

function parseInvokerTxItem(value: unknown): InvokerTxItem | null {
  if (!value) return null;

  if (typeof value === "string") {
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

  return null;
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

export default function MetricsCharts({
  rows,
  selectedInvokerTx,
}: MetricsChartsProps) {
  const scopedRows = useMemo(() => {
    if (!selectedInvokerTx) return rows;

    return rows.filter((row) => {
      const meta = parseInvokerTxItem(row.invokerTx);
      return meta?.invokerTx === selectedInvokerTx;
    });
  }, [rows, selectedInvokerTx]);

  const utilityTypeDistribution = useMemo(() => {
    const map = new Map<string, { count: number; avgDurationSum: number; entries: number }>();

    for (const row of scopedRows) {
      const utilityItems = parseUtilityTypeItems(row.utilitytype);

      for (const item of utilityItems) {
        const current = map.get(item.utilitytype) ?? {
          count: 0,
          avgDurationSum: 0,
          entries: 0,
        };

        current.count += item.count;
        current.avgDurationSum += Number(row.mean_utility_duration ?? 0);
        current.entries += 1;

        map.set(item.utilitytype, current);
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        count: value.count,
        avgDuration: value.entries > 0 ? value.avgDurationSum / value.entries : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [scopedRows]);

  const topInvokerTxByExec = useMemo(() => {
    return scopedRows
      .map((row) => {
        const meta = parseInvokerTxItem(row.invokerTx);
        return {
          name: meta?.invokerTx ?? "-",
          ejecuciones: Number(meta?.sum_num_executions ?? row.utility_count ?? 0),
          duracion: Number(meta?.mean_span_duration ?? row.mean_utility_duration ?? 0),
          errores: Number(meta?.sum_technical_error ?? 0),
        };
      })
      .filter((item) => item.name !== "-")
      .sort((a, b) => b.ejecuciones - a.ejecuciones)
      .slice(0, 12);
  }, [scopedRows]);

  const durationByUtilityType = useMemo(() => {
    const map = new Map<string, { min: number; mean: number; max: number; entries: number }>();

    for (const row of scopedRows) {
      const utilityItems = parseUtilityTypeItems(row.utilitytype);

      for (const item of utilityItems) {
        const current = map.get(item.utilitytype) ?? {
          min: Number.POSITIVE_INFINITY,
          mean: 0,
          max: 0,
          entries: 0,
        };

        const minValue = Number(row.min_utility_duration ?? 0);
        const meanValue = Number(row.mean_utility_duration ?? 0);
        const maxValue = Number(row.max_utility_duration ?? 0);

        current.min = Math.min(current.min, minValue);
        current.mean += meanValue;
        current.max = Math.max(current.max, maxValue);
        current.entries += 1;

        map.set(item.utilitytype, current);
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        min: value.min === Number.POSITIVE_INFINITY ? 0 : Number(value.min.toFixed(2)),
        mean: value.entries > 0 ? Number((value.mean / value.entries).toFixed(2)) : 0,
        max: Number(value.max.toFixed(2)),
      }))
      .sort((a, b) => b.mean - a.mean);
  }, [scopedRows]);

  const utilityTypeComparative = useMemo(() => {
    return utilityTypeDistribution.map((item) => ({
      name: item.name,
      count: item.count,
      avgDuration: Number(item.avgDuration.toFixed(2)),
    }));
  }, [utilityTypeDistribution]);

  const topInvokedParams = useMemo(() => {
    const map = new Map<string, { count: number; maxDuration: number }>();

    for (const row of scopedRows) {
      const invokedParams = parseInvokedParamItems(row.invokedparam);

      for (const item of invokedParams) {
        const current = map.get(item.invokedparam) ?? { count: 0, maxDuration: 0 };
        current.count += item.count;
        current.maxDuration = Math.max(current.maxDuration, item.maxDuration);
        map.set(item.invokedparam, current);
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({
        name,
        count: value.count,
        maxDuration: Number(value.maxDuration.toFixed(2)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [scopedRows]);

  if (scopedRows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Ejecuta una consulta o selecciona un invokerTx para ver las gráficas.
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
      <div className="text-xs text-muted-foreground">
        {selectedInvokerTx
          ? `Gráficas filtradas por invokerTx: ${selectedInvokerTx}`
          : "Vista general. Haz click en un invokerTx para enfocar gráficas y KPIs."}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Distribución por Utility Type
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={utilityTypeDistribution}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={50}
                strokeWidth={2}
                stroke="hsl(220, 20%, 7%)"
              >
                {utilityTypeDistribution.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top InvokerTx por ejecuciones
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topInvokerTxByExec} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(210, 20%, 85%)" }}
                width={140}
              />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ejecuciones" fill="hsl(199, 89%, 48%)" name="Ejecuciones" />
              <Bar dataKey="errores" fill="hsl(0, 72%, 51%)" name="Errores" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Duración por Utility Type (Min / Mean / Max)
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={durationByUtilityType}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }}
                angle={-20}
                textAnchor="end"
                height={70}
              />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="min" stroke="hsl(160, 84%, 39%)" name="Min" strokeWidth={2} />
              <Line type="monotone" dataKey="mean" stroke="hsl(199, 89%, 48%)" name="Mean" strokeWidth={2} />
              <Line type="monotone" dataKey="max" stroke="hsl(0, 72%, 51%)" name="Max" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Comparativo Utility Type (conteo vs duración promedio)
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={utilityTypeComparative}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }}
                angle={-20}
                textAnchor="end"
                height={70}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
              <Tooltip {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="count" fill="hsl(199, 89%, 48%)" name="Conteo" />
              <Line yAxisId="right" type="monotone" dataKey="avgDuration" stroke="hsl(160, 84%, 39%)" name="Duración promedio" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Top InvokedParam por uso
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={topInvokedParams} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 14%, 18%)" />
            <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(215, 12%, 55%)" }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: "hsl(210, 20%, 85%)" }}
              width={220}
            />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="count" fill="hsl(38, 92%, 50%)" name="Conteo" />
            <Bar dataKey="maxDuration" fill="hsl(280, 65%, 60%)" name="Max duración" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}