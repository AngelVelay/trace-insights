import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";
import type { AwsInformComparisonResult } from "@/services/metricsService";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface AwsInformChartsProps {
  result: AwsInformComparisonResult | null;
}

function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(2)} ms`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.00%";
  return `${value.toFixed(2)}%`;
}

function BaseTooltipContainer({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-[320px] rounded-2xl border border-slate-700 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-2 text-sm font-bold text-cyan-300">{label}</div>
      <div className="space-y-1 text-xs text-slate-200">{children}</div>
    </div>
  );
}

function ExecutionsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};

  return (
    <BaseTooltipContainer label={label}>
      <div>
        <span className="font-semibold text-slate-400">LIVE-02 ejecuciones:</span>{" "}
        {Number(row.live02ExecutionsReal ?? 0).toLocaleString()}
      </div>
      <div>
        <span className="font-semibold text-slate-400">LIVE-04 ejecuciones:</span>{" "}
        {Number(row.live04ExecutionsReal ?? 0).toLocaleString()}
      </div>
      <div>
        <span className="font-semibold text-slate-400">Δ ejecuciones:</span>{" "}
        {Number(row.deltaExecutions ?? 0).toLocaleString()}
      </div>
    </BaseTooltipContainer>
  );
}

function ErrorsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};

  return (
    <BaseTooltipContainer label={label}>
      <div>
        <span className="font-semibold text-slate-400">LIVE-02 errores:</span>{" "}
        {Number(row.live02Errors ?? 0).toLocaleString()}
      </div>
      <div>
        <span className="font-semibold text-slate-400">LIVE-04 errores:</span>{" "}
        {Number(row.live04Errors ?? 0).toLocaleString()}
      </div>
      <div>
        <span className="font-semibold text-slate-400">Δ errores:</span>{" "}
        {Number(row.deltaErrors ?? 0).toLocaleString()}
      </div>
    </BaseTooltipContainer>
  );
}

function JumpsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};

  return (
    <BaseTooltipContainer label={label}>
      <div>
        <span className="font-semibold text-slate-400">LIVE-02 saltos:</span>{" "}
        {Number(row.live02Jumps ?? 0).toLocaleString()}
      </div>
      <div>
        <span className="font-semibold text-slate-400">LIVE-04 saltos:</span>{" "}
        {Number(row.live04Jumps ?? 0).toLocaleString()}
      </div>
      <div>
        <span className="font-semibold text-slate-400">Δ saltos:</span>{" "}
        {Number(row.deltaJumps ?? 0).toLocaleString()}
      </div>
    </BaseTooltipContainer>
  );
}

function DurationTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};

  return (
    <BaseTooltipContainer label={label}>
      <div>
        <span className="font-semibold text-slate-400">LIVE-02 tiempo:</span>{" "}
        {formatMs(Number(row.live02Duration ?? 0))}
      </div>
      <div>
        <span className="font-semibold text-slate-400">LIVE-04 tiempo:</span>{" "}
        {formatMs(Number(row.live04Duration ?? 0))}
      </div>
      <div>
        <span className="font-semibold text-slate-400">Δ tiempo:</span>{" "}
        {formatMs(Number(row.deltaDuration ?? 0))}
      </div>
    </BaseTooltipContainer>
  );
}

function computeRoundedMax(values: number[], step: number, minMax = step): number {
  const max = Math.max(...values, 0);
  if (max <= 0) return minMax;
  return Math.max(minMax, Math.ceil(max / step) * step);
}

function computeRoundedMinMax(values: number[], step: number) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return { min: 0, max: step };

  const min = Math.min(...valid);
  const max = Math.max(...valid);

  if (min === max) {
    return {
      min: Math.max(0, min - step),
      max: max + step,
    };
  }

  return {
    min: Math.max(0, Math.floor(min / step) * step),
    max: Math.ceil(max / step) * step,
  };
}

function computeExecutionsDomain(
  values: number[],
  mode: "full" | "tight" | "very-tight"
): [number, number] {
  const valid = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (!valid.length) return [1, 10000];

  const max = Math.max(...valid);
  const positives = valid.filter((v) => v > 0);
  const minPositive = positives.length ? Math.min(...positives) : 1;

  if (max <= 0) return [1, 10000];

  if (mode === "full") {
    return [1, max];
  }

  if (mode === "tight") {
    return [Math.max(1, minPositive), Math.max(minPositive + 1, max)];
  }

  return [Math.max(1, minPositive), Math.max(minPositive + 1, max)];
}

export default function AwsInformCharts({ result }: AwsInformChartsProps) {
  const [search, setSearch] = useState("");
const [tableTab, setTableTab] = useState<"metrics" | "traces">("metrics");
const [execZoomMode, setExecZoomMode] = useState<"full" | "tight" | "very-tight">("full");
const [live02ExecutionsInput, setLive02ExecutionsInput] = useState("");
const [awsPowerOnPercentInput, setAwsPowerOnPercentInput] = useState("40");

const filteredRows = useMemo(() => {
  const rows = result?.rows ?? [];
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.invokerTx.toLowerCase().includes(q));
}, [result, search]);

const totalLive04Executions = useMemo(
  () => filteredRows.reduce((sum, row) => sum + row.live04.executions, 0),
  [filteredRows]
);

const totalLive02Executions = useMemo(
  () => filteredRows.reduce((sum, row) => sum + row.live02.executions, 0),
  [filteredRows]
);

const live02ExecutionsValue = useMemo(() => {
  const cleaned = String(live02ExecutionsInput)
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  const normalized = Number(cleaned);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 0;
}, [live02ExecutionsInput]);

const awsPowerOnPercent = useMemo(() => {
  const cleaned = String(awsPowerOnPercentInput)
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .trim();

  const normalized = Number(cleaned);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : 40;
}, [awsPowerOnPercentInput]);

// LIVE-04 al porcentaje configurado = Total AWS
const totalAwsEnabled = useMemo(() => {
  return totalLive04Executions * (awsPowerOnPercent / 100);
}, [totalLive04Executions, awsPowerOnPercent]);

// Total ejecuciones LIVE-02 / Total AWS * 100
const live02VsAwsPercent = useMemo(() => {
  if (!live02ExecutionsValue) return 0;
  return (
    ((totalLive04Executions * (awsPowerOnPercent / 100)) /
      live02ExecutionsValue) *
    100
  );
}, [totalLive04Executions, awsPowerOnPercent, live02ExecutionsValue]);

  const chartData = useMemo(() => {
    return filteredRows.map((row) => ({
      invokerTx: row.invokerTx,
      live02Executions: Math.max(1, row.live02.executions),
      live04Executions: Math.max(1, row.live04.executions),
      live02ExecutionsReal: row.live02.executions,
      live04ExecutionsReal: row.live04.executions,
      live02Errors: row.live02.technicalErrors,
      live04Errors: row.live04.technicalErrors,
      live02Jumps: row.live02.jumps,
      live04Jumps: row.live04.jumps,
      live02Duration: Number(row.live02.meanDurationMs.toFixed(2)),
      live04Duration: Number(row.live04.meanDurationMs.toFixed(2)),
      deltaExecutions: row.deltaExecutions,
      deltaErrors: row.deltaTechnicalErrors,
      deltaJumps: row.deltaJumps,
      deltaDuration: Number(row.deltaMeanDurationMs.toFixed(2)),
      live02Trace: row.live02.trace,
      live04Trace: row.live04.trace,
    }));
  }, [filteredRows]);

  const executionsDomain = useMemo(() => {
    return computeExecutionsDomain(
      chartData.flatMap((row) => [row.live02Executions, row.live04Executions]),
      execZoomMode
    );
  }, [chartData, execZoomMode]);

  const errorsMax = useMemo(() => {
    return computeRoundedMax(
      chartData.flatMap((row) => [row.live02Errors, row.live04Errors]),
      1000,
      1000
    );
  }, [chartData]);

  const jumpsMax = useMemo(() => {
    return computeRoundedMax(
      chartData.flatMap((row) => [row.live02Jumps, row.live04Jumps]),
      5,
      5
    );
  }, [chartData]);

  const durationRange = useMemo(() => {
    return computeRoundedMinMax(
      chartData.flatMap((row) => [row.live02Duration, row.live04Duration]),
      100
    );
  }, [chartData]);

  if (!result || !result.rows.length) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
        Genera el informe para ver comparativos entre LIVE-02 y LIVE-04.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
  <div className="mb-3 text-xs text-muted-foreground">Calculadora porcentaje de ejecuciones AWS</div>

  <div className="mt-5 space-y-3">
    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">
        Total ejecuciones LIVE-02
      </div>
      <Input
        value={live02ExecutionsInput}
        onChange={(e) => setLive02ExecutionsInput(e.target.value)}
        placeholder="Ej. 559067559"
        className="font-mono text-xs"
      />
    </div>

    <div>
      <div className="mb-1 text-[11px] text-muted-foreground">
        % de encendido AWS
      </div>
      <Input
        value={awsPowerOnPercentInput}
        onChange={(e) => setAwsPowerOnPercentInput(e.target.value)}
        placeholder="40"
        className="font-mono text-xs"
      />
    </div>

    <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
      <div className="text-muted-foreground">LIVE-04 total</div>
      <div className="mt-1 font-mono text-base font-bold">
        {totalLive04Executions.toLocaleString()}
      </div>

      <div className="mt-3 text-muted-foreground">
        LIVE-04 al {awsPowerOnPercent}% = Total AWS
      </div>
      <div className="mt-1 font-mono text-base font-bold">
        {Math.round(totalAwsEnabled).toLocaleString()}
      </div>

      <div className="mt-3 text-muted-foreground">
        LIVE-02 / Total AWS * 100
      </div>
      <div className="mt-1 font-mono text-base font-bold text-cyan-300">
        {live02ExecutionsValue > 0 ? formatPercent(live02VsAwsPercent) : "Captura LIVE-02"}
      </div>
    </div>
  </div>
</div>

        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5 shadow-sm">
          <div className="text-xs text-cyan-300">Ejecuciones LIVE-02</div>
          <div className="mt-3 font-mono text-3xl font-bold">
            {totalLive02Executions.toLocaleString()}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 shadow-sm">
          <div className="text-xs text-emerald-300">Ejecuciones LIVE-04</div>
          <div className="mt-3 font-mono text-3xl font-bold">
            {totalLive04Executions.toLocaleString()}
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
          <div className="text-xs text-muted-foreground">Canal consultado</div>
          <div className="mt-3 font-mono text-3xl font-bold text-amber-300">
            {result.channelCode || "-"}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Aplicado en LIVE-02 y LIVE-04
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
          <div className="text-xs text-muted-foreground">Filtro actual</div>
          <div className="mt-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value.toUpperCase())}
              placeholder="Buscar invokerTx..."
              className="font-mono text-xs"
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Comparativo de ejecuciones</h3>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setExecZoomMode("full")}
                className={`rounded-lg border px-3 py-1 text-xs ${
                  execZoomMode === "full"
                    ? "border-cyan-400 bg-cyan-500/10 text-cyan-300"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                Rango completo
              </button>

              <button
                type="button"
                onClick={() => setExecZoomMode("tight")}
                className={`rounded-lg border px-3 py-1 text-xs ${
                  execZoomMode === "tight"
                    ? "border-cyan-400 bg-cyan-500/10 text-cyan-300"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                Zoom medio
              </button>

              <button
                type="button"
                onClick={() => setExecZoomMode("very-tight")}
                className={`rounded-lg border px-3 py-1 text-xs ${
                  execZoomMode === "very-tight"
                    ? "border-cyan-400 bg-cyan-500/10 text-cyan-300"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                Zoom alto
              </button>
            </div>
          </div>

          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap={8}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="invokerTx"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-22}
                  textAnchor="end"
                  height={95}
                />
                <YAxis
                  scale="log"
                  tick={{ fontSize: 11 }}
                  domain={executionsDomain}
                  allowDataOverflow={true}
                  tickFormatter={(value) => Number(value).toLocaleString()}
                />
                <Tooltip content={<ExecutionsTooltip />} />
                <Legend />
                <Bar
                  dataKey="live02Executions"
                  name="LIVE-02"
                  fill="#06b6d4"
                  radius={[6, 6, 0, 0]}
                  barSize={34}
                />
                <Bar
                  dataKey="live04Executions"
                  name="LIVE-04"
                  fill="#10b981"
                  radius={[6, 6, 0, 0]}
                  barSize={34}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">Comparativo de errores técnicos</h3>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap={12}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="invokerTx"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-22}
                  textAnchor="end"
                  height={95}
                />
                <YAxis tick={{ fontSize: 11 }} domain={[0, errorsMax]} tickCount={7} />
                <Tooltip content={<ErrorsTooltip />} />
                <Legend />
                <Bar dataKey="live02Errors" name="LIVE-02" fill="#0891b2" radius={[6, 6, 0, 0]} barSize={24} />
                <Bar dataKey="live04Errors" name="LIVE-04" fill="#059669" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">Comparativo de saltos</h3>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap={12}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="invokerTx"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-22}
                  textAnchor="end"
                  height={95}
                />
                <YAxis tick={{ fontSize: 11 }} domain={[0, jumpsMax]} tickCount={6} />
                <Tooltip content={<JumpsTooltip />} />
                <Legend />
                <Bar dataKey="live02Jumps" name="LIVE-02" fill="#0ea5e9" radius={[6, 6, 0, 0]} barSize={24} />
                <Bar dataKey="live04Jumps" name="LIVE-04" fill="#22c55e" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">Comparativo de tiempo de respuesta</h3>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="invokerTx"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-22}
                  textAnchor="end"
                  height={95}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  domain={[durationRange.min, durationRange.max]}
                  tickCount={7}
                />
                <Tooltip content={<DurationTooltip />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="live02Duration"
                  name="LIVE-02"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="live04Duration"
                  name="LIVE-04"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-border/70 bg-card/95 shadow-sm">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-tight">
              Tabla comparativa LIVE-02 vs LIVE-04
            </h2>

            <Tabs value={tableTab} onValueChange={(v) => setTableTab(v as "metrics" | "traces")}>
              <TabsList className="border border-border bg-muted/40">
                <TabsTrigger value="metrics" className="text-xs">
                  Métricas
                </TabsTrigger>
                <TabsTrigger value="traces" className="text-xs">
                  Trazas
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <Tabs value={tableTab} onValueChange={(v) => setTableTab(v as "metrics" | "traces")}>
          <TabsContent value="metrics" className="m-0">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full min-w-[1800px] text-left text-sm">
                <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                  <tr className="border-b border-border/70">
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      InvokerTx
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Canal
                    </th>

                    <th className="bg-cyan-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                      LIVE-02 Exec
                    </th>
                    <th className="bg-cyan-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                      LIVE-02 Errors
                    </th>
                    <th className="bg-cyan-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                      LIVE-02 Saltos
                    </th>
                    <th className="bg-cyan-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                      LIVE-02 Resp
                    </th>

                    <th className="bg-emerald-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      LIVE-04 Exec
                    </th>
                    <th className="bg-emerald-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      LIVE-04 Errors
                    </th>
                    <th className="bg-emerald-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      LIVE-04 Saltos
                    </th>
                    <th className="bg-emerald-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      LIVE-04 Resp
                    </th>

                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.invokerTx}
                      className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-4 font-mono font-semibold">{row.invokerTx}</td>
                      <td className="px-4 py-4 font-mono">{result.channelCode || "-"}</td>

                      <td className="bg-cyan-500/5 px-4 py-4 font-mono">
                        {row.live02.executions.toLocaleString()}
                      </td>
                      <td className="bg-cyan-500/5 px-4 py-4 font-mono">
                        {row.live02.technicalErrors.toLocaleString()}
                      </td>
                      <td className="bg-cyan-500/5 px-4 py-4 font-mono">
                        {row.live02.jumps.toLocaleString()}
                      </td>
                      <td className="bg-cyan-500/5 px-4 py-4 font-mono">
                        {formatMs(row.live02.meanDurationMs)}
                      </td>

                      <td className="bg-emerald-500/5 px-4 py-4 font-mono">
                        {row.live04.executions.toLocaleString()}
                      </td>
                      <td className="bg-emerald-500/5 px-4 py-4 font-mono">
                        {row.live04.technicalErrors.toLocaleString()}
                      </td>
                      <td className="bg-emerald-500/5 px-4 py-4 font-mono">
                        {row.live04.jumps.toLocaleString()}
                      </td>
                      <td className="bg-emerald-500/5 px-4 py-4 font-mono">
                        {formatMs(row.live04.meanDurationMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="traces" className="m-0">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full min-w-[1400px] text-left text-sm">
                <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                  <tr className="border-b border-border/70">
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      InvokerTx
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Canal
                    </th>
                    <th className="bg-cyan-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-cyan-300">
                      Trace LIVE-02
                    </th>
                    <th className="bg-emerald-500/10 px-4 py-4 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                      Trace LIVE-04
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`trace-${row.invokerTx}`}
                      className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-4 font-mono font-semibold">{row.invokerTx}</td>
                      <td className="px-4 py-4 font-mono">{result.channelCode || "-"}</td>
                      <td className="bg-cyan-500/5 px-4 py-4">
                        <pre className="max-w-[560px] whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-cyan-100">
                          {row.live02.trace || "-"}
                        </pre>
                      </td>
                      <td className="bg-emerald-500/5 px-4 py-4">
                        <pre className="max-w-[560px] whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-emerald-100">
                          {row.live04.trace || "-"}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}