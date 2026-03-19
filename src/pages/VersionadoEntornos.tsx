import { useMemo, useRef, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useBearerToken } from "@/hooks/useBearerToken";
import {
  Eye,
  EyeOff,
  CalendarIcon,
  Search,
  Boxes,
  Activity,
  AlertTriangle,
  Download,
  Copy,
  Image,
  BarChart3,
  Table2,
  LayoutPanelTop,
  Sheet,
} from "lucide-react";
import { format } from "date-fns";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import {
  fetchEnvironmentMonitoringDaily,
  type EnvironmentMonitoringDailyResult,
  type EnvironmentOption,
  type InstallationRangeMode,
  type EnvironmentMonitoringDailyRow,
} from "@/services/environmentMonitoringService";

const ENVIRONMENTS: EnvironmentOption[] = [
  "DEV",
  "INT",
  "AUS",
  "OCT",
  "PRZ",
  "LIVE-02",
];

const RANGE_MODES: Array<{ value: InstallationRangeMode; label: string }> = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "complete", label: "Completo" },
];

type ViewMode = "charts" | "table" | "both";

function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(2)} ms`;
}

function getRowClassByPhase(phase: EnvironmentMonitoringDailyRow["phase"]): string {
  if (phase === "before") return "bg-blue-500/10 border-l-4 border-blue-500";
  if (phase === "installation") return "bg-amber-500/10 border-l-4 border-amber-500";
  if (phase === "after") return "bg-emerald-500/10 border-l-4 border-emerald-500";
  return "";
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(result: EnvironmentMonitoringDailyResult): string {
  const headers = [
    "Fecha",
    "Technical Errors",
    "Executions",
    "Span Duration",
  ];

  const rows = result.rows.map((row) => [
    row.date,
    row.technicalErrors,
    row.executions,
    formatMs(row.meanSpanDuration),
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildSheetsText(result: EnvironmentMonitoringDailyResult): string {
  const headers = [
    "Fecha",
    "Technical Errors",
    "Executions",
    "Span Duration",
  ];

  const rows = result.rows.map((row) => [
    row.date,
    String(row.technicalErrors),
    String(row.executions),
    formatMs(row.meanSpanDuration),
  ]);

  return [headers, ...rows].map((row) => row.join("\t")).join("\n");
}

function buildChartDataSheetsText(
  result: EnvironmentMonitoringDailyResult | null
): string {
  if (!result) return "";

  const headers = [
    "Fecha",
    "Technical Errors",
    "Executions",
    "Span Duration",
  ];

  const rows = result.rows.map((row) => [
    row.date,
    String(row.technicalErrors),
    String(row.executions),
    String(Number(row.meanSpanDuration.toFixed(2))),
  ]);

  return [headers, ...rows].map((row) => row.join("\t")).join("\n");
}

function buildSimpleChartData(result: EnvironmentMonitoringDailyResult | null) {
  if (!result) return [];

  return result.rows.map((row) => ({
    xLabel: row.date,
    phase: row.phase,
    technicalErrors: row.technicalErrors,
    executions: row.executions,
    meanSpanDuration: Number(row.meanSpanDuration.toFixed(2)),
  }));
}

function buildOverlayChartData(result: EnvironmentMonitoringDailyResult | null) {
  if (!result || result.mode !== "complete") return [];

  const before = result.rows
    .filter((row) => row.phase === "before")
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));

  const after = result.rows
    .filter((row) => row.phase === "after")
    .sort((a, b) => a.offset - b.offset);

  const installation = result.rows.find((row) => row.phase === "installation");

  const maxLen = Math.max(before.length, after.length);

  return Array.from({ length: maxLen }).map((_, index) => {
    const beforeRow = before[index];
    const afterRow = after[index];

    return {
      compareLabel: `Día ${index + 1}`,
      beforeDate: beforeRow?.date ?? "",
      afterDate: afterRow?.date ?? "",
      beforeTechnicalErrors: beforeRow?.technicalErrors ?? null,
      afterTechnicalErrors: afterRow?.technicalErrors ?? null,
      beforeExecutions: beforeRow?.executions ?? null,
      afterExecutions: afterRow?.executions ?? null,
      beforeMeanSpanDuration:
        beforeRow != null ? Number(beforeRow.meanSpanDuration.toFixed(2)) : null,
      afterMeanSpanDuration:
        afterRow != null ? Number(afterRow.meanSpanDuration.toFixed(2)) : null,
      installationDate: installation?.date ?? "",
      installationTechnicalErrors: installation?.technicalErrors ?? null,
      installationExecutions: installation?.executions ?? null,
      installationMeanSpanDuration:
        installation != null ? Number(installation.meanSpanDuration.toFixed(2)) : null,
    };
  });
}

async function copySvgChartAsImage(container: HTMLDivElement | null) {
  if (!container) throw new Error("No se encontró el gráfico.");

  const svg = container.querySelector("svg");
  if (!svg) throw new Error("No se encontró el SVG del gráfico.");

  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const svgBlob = new Blob([source], {
    type: "image/svg+xml;charset=utf-8",
  });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new window.Image();
    const rect = svg.getBoundingClientRect();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("No se pudo cargar la imagen del gráfico."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(rect.width));
    canvas.height = Math.max(1, Math.floor(rect.height));

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo crear el canvas.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );

    if (!blob) throw new Error("No se pudo generar la imagen PNG.");

    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": blob,
      }),
    ]);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function MetricChart({
  title,
  data,
  dataKey,
  copyRef,
}: {
  title: string;
  data: Array<Record<string, string | number | null>>;
  dataKey: string;
  copyRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await copySvgChartAsImage(copyRef.current);
              toast.success("Gráfico copiado como imagen.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "No se pudo copiar la imagen."
              );
            }
          }}
        >
          <Image className="mr-2 h-4 w-4" />
          Copiar imagen
        </Button>
      </div>

      <div ref={copyRef} className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="xLabel" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "12px",
              }}
              labelStyle={{
                color: "#f59e0b",
                fontWeight: 700,
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function OverlayMetricChart({
  title,
  data,
  beforeKey,
  afterKey,
  installationKey,
  copyRef,
}: {
  title: string;
  data: Array<Record<string, string | number | null>>;
  beforeKey: string;
  afterKey: string;
  installationKey: string;
  copyRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await copySvgChartAsImage(copyRef.current);
              toast.success("Gráfico copiado como imagen.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "No se pudo copiar la imagen."
              );
            }
          }}
        >
          <Image className="mr-2 h-4 w-4" />
          Copiar imagen
        </Button>
      </div>

      <div ref={copyRef} className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="compareLabel" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value, name, item) => {
                if (name === "Before") {
                  return [value, `Before (${item.payload.beforeDate || "-"})`];
                }
                if (name === "After") {
                  return [value, `After (${item.payload.afterDate || "-"})`];
                }
                if (name === "Día de instalación") {
                  return [value, `Día de instalación (${item.payload.installationDate || "-"})`];
                }
                return [value, name];
              }}
            />
            <Legend />
            <ReferenceLine x="Día 1" stroke="#d1d5db" strokeDasharray="4 4" />
            <Line
              type="monotone"
              dataKey={beforeKey}
              name="Before"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey={afterKey}
              name="After"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey={installationKey}
              name="Día de instalación"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function VersionadoEntornos() {
  const { bearerToken, setBearerToken } = useBearerToken();
  const [showToken, setShowToken] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentOption>("LIVE-02");
  const [installationDay, setInstallationDay] = useState<Date>(new Date());
  const [rangeMode, setRangeMode] = useState<InstallationRangeMode>("before");
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EnvironmentMonitoringDailyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const responseChartRef = useRef<HTMLDivElement>(null);
  const executionsChartRef = useRef<HTMLDivElement>(null);
  const errorsChartRef = useRef<HTMLDivElement>(null);

  const simpleChartData = useMemo(() => buildSimpleChartData(result), [result]);
  const overlayChartData = useMemo(() => buildOverlayChartData(result), [result]);

  const handleSearch = async () => {
    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const summary = await fetchEnvironmentMonitoringDaily({
        environment,
        installationDay,
        rangeMode,
        bearerToken: bearerToken.trim(),
      });

      setResult(summary);
      toast.success("Monitoreo de entornos cargado correctamente.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!result) {
      toast.error("No hay informe para descargar.");
      return;
    }

    const csv = buildCsv(result);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const fileName = `monitoreo_entornos_${result.environment}_${result.mode}_${result.installationDay.replace(
      /\//g,
      "-"
    )}.csv`;

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(url);
    toast.success("CSV descargado correctamente.");
  };

  const handleCopySheets = async () => {
    if (!result) {
      toast.error("No hay informe para copiar.");
      return;
    }

    try {
      const text = buildSheetsText(result);
      await navigator.clipboard.writeText(text);
      toast.success("Informe copiado. Ya puedes pegarlo en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  const handleCopyChartData = async () => {
    if (!result) {
      toast.error("No hay datos del gráfico para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(buildChartDataSheetsText(result));
      toast.success(
        "Datos del gráfico copiados. Pégalos en Google Sheets y crea el gráfico allí."
      );
    } catch {
      toast.error("No se pudo copiar la tabla de datos del gráfico.");
    }
  };

  const updateInstallationTime = (timeValue: string) => {
    const [hours, minutes] = timeValue.split(":").map(Number);
    const next = new Date(installationDay);
    next.setHours(Number.isFinite(hours) ? hours : 0);
    next.setMinutes(Number.isFinite(minutes) ? minutes : 0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    setInstallationDay(next);
  };

  const showCharts = viewMode === "charts" || viewMode === "both";
  const showTable = viewMode === "table" || viewMode === "both";
  const isComplete = result?.mode === "complete";

  return (
    <div className="min-h-screen gradient-mesh">
      <LoadingOverlay show={loading} />

      <main className="container space-y-6 py-6">
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Bearer Token</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                placeholder="Pega aquí el bearer token"
                className="pr-10 font-mono text-xs"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Entorno</Label>
              <Select value={environment} onValueChange={(value) => setEnvironment(value as EnvironmentOption)}>
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder="Selecciona entorno" />
                </SelectTrigger>
                <SelectContent>
                  {ENVIRONMENTS.map((env) => (
                    <SelectItem key={env} value={env}>
                      {env}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Día y hora de instalación</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start font-mono text-xs",
                      !installationDay && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {installationDay
                      ? format(installationDay, "dd/MM/yyyy HH:mm")
                      : "Selecciona fecha y hora"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto space-y-3 p-3" align="start">
                  <Calendar
                    mode="single"
                    selected={installationDay}
                    onSelect={(d) => {
                      if (!d) return;
                      const next = new Date(d);
                      next.setHours(installationDay.getHours());
                      next.setMinutes(installationDay.getMinutes());
                      next.setSeconds(0);
                      next.setMilliseconds(0);
                      setInstallationDay(next);
                    }}
                    initialFocus
                  />
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Hora</Label>
                    <Input
                      type="time"
                      step="60"
                      className="font-mono text-xs"
                      value={format(installationDay, "HH:mm")}
                      onChange={(e) => updateInstallationTime(e.target.value)}
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rango</Label>
              <Select
                value={rangeMode}
                onValueChange={(value) => setRangeMode(value as InstallationRangeMode)}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder="Selecciona rango" />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_MODES.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSearch} disabled={loading} className="glow-primary">
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Consultando..." : "Consultar entorno"}
            </Button>

            <Button type="button" variant="outline" onClick={handleDownloadCsv} disabled={!result}>
              <Download className="mr-2 h-4 w-4" />
              Descargar CSV
            </Button>

            <Button type="button" variant="outline" onClick={handleCopySheets} disabled={!result}>
              <Copy className="mr-2 h-4 w-4" />
              Copiar tabla
            </Button>

            
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={viewMode === "charts" ? "default" : "outline"}
              onClick={() => setViewMode("charts")}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              Gráficas
            </Button>
            <Button
              type="button"
              variant={viewMode === "table" ? "default" : "outline"}
              onClick={() => setViewMode("table")}
            >
              <Table2 className="mr-2 h-4 w-4" />
              Tabla
            </Button>
            <Button
              type="button"
              variant={viewMode === "both" ? "default" : "outline"}
              onClick={() => setViewMode("both")}
            >
              <LayoutPanelTop className="mr-2 h-4 w-4" />
              Ambos
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Technical Errors</span>
            </div>
            <div className="mt-2 font-mono text-2xl font-bold">
              {result ? result.totals.technicalErrors.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Executions</span>
            </div>
            <div className="mt-2 font-mono text-2xl font-bold">
              {result ? result.totals.executions.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" />
              <span className="text-xs text-muted-foreground">Span Duration</span>
            </div>
            <div className="mt-2 font-mono text-2xl font-bold">
              {result ? formatMs(result.totals.meanSpanDuration) : "0 ms"}
            </div>
          </div>
        </div>

        {showCharts && (
          <>
            {isComplete ? (
              <div className="grid gap-4 xl:grid-cols-3">
                <OverlayMetricChart
                  title="Tiempo de respuesta"
                  data={overlayChartData}
                  beforeKey="beforeMeanSpanDuration"
                  afterKey="afterMeanSpanDuration"
                  installationKey="installationMeanSpanDuration"
                  copyRef={responseChartRef}
                />

                <OverlayMetricChart
                  title="Executions"
                  data={overlayChartData}
                  beforeKey="beforeExecutions"
                  afterKey="afterExecutions"
                  installationKey="installationExecutions"
                  copyRef={executionsChartRef}
                />

                <OverlayMetricChart
                  title="Errores técnicos"
                  data={overlayChartData}
                  beforeKey="beforeTechnicalErrors"
                  afterKey="afterTechnicalErrors"
                  installationKey="installationTechnicalErrors"
                  copyRef={errorsChartRef}
                />
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-3">
                <MetricChart
                  title="Tiempo de respuesta"
                  data={simpleChartData}
                  dataKey="meanSpanDuration"
                  copyRef={responseChartRef}
                />
                <MetricChart
                  title="Executions"
                  data={simpleChartData}
                  dataKey="executions"
                  copyRef={executionsChartRef}
                />
                <MetricChart
                  title="Errores técnicos"
                  data={simpleChartData}
                  dataKey="technicalErrors"
                  copyRef={errorsChartRef}
                />
              </div>
            )}
          </>
        )}

        {showTable && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Fase</th>
                  <th className="px-4 py-3 font-medium">Fecha</th>
                  <th className="px-4 py-3 font-medium">Technical Errors</th>
                  <th className="px-4 py-3 font-medium">Executions</th>
                  <th className="px-4 py-3 font-medium">Span Duration</th>
                </tr>
              </thead>
              <tbody>
                {result?.rows.map((row) => (
                  <tr
                    key={`${row.phase}-${row.date}`}
                    className={`font-mono text-xs ${getRowClassByPhase(row.phase)}`}
                  >
                    <td className="px-4 py-3 font-semibold">
                      {row.phase === "before"
                        ? "Before"
                        : row.phase === "after"
                        ? "After"
                        : "Día de instalación"}
                    </td>
                    <td className="px-4 py-3">{row.date}</td>
                    <td className="px-4 py-3">{row.technicalErrors.toLocaleString()}</td>
                    <td className="px-4 py-3">{row.executions.toLocaleString()}</td>
                    <td className="px-4 py-3">{formatMs(row.meanSpanDuration)}</td>
                  </tr>
                ))}

                <tr className="border-t border-border bg-muted/20 font-mono text-xs font-bold">
                  <td className="px-4 py-3">TOTAL</td>
                  <td className="px-4 py-3">-</td>
                  <td className="px-4 py-3">
                    {result ? result.totals.technicalErrors.toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {result ? result.totals.executions.toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-3">
                    {result ? formatMs(result.totals.meanSpanDuration) : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}