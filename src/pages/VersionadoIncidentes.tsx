import { useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useBearerToken } from "@/hooks/useBearerToken";
import {
  Eye,
  EyeOff,
  CalendarIcon,
  Search,
  Download,
  Copy,
  Image,
  BarChart3,
  Table2,
  LayoutPanelTop,
  AlertTriangle,
  Boxes,
  Activity,
} from "lucide-react";
import { format } from "date-fns";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import LoadingOverlay from "@/components/LoadingOverlay";

import {
  fetchIncidentMonitoring,
  type IncidentMonitoringResult,
  type EnvironmentOption,
  type InstallationRangeMode,
} from "@/services/versionadoIncidentesService";

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

function getRowClassByPhase(phase: string): string {
  if (phase === "before") return "bg-blue-500/5";
  if (phase === "installation") return "bg-amber-500/5";
  if (phase === "after") return "bg-emerald-500/5";
  return "";
}

function getPhaseBadgeClass(phase: string): string {
  if (phase === "before") {
    return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20";
  }
  if (phase === "installation") {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20";
  }
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
}

function getPhaseLabel(phase: string): string {
  if (phase === "before") return "Before";
  if (phase === "installation") return "Instalación";
  return "After";
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(result: IncidentMonitoringResult): string {
  const headers = [
    "TRX",
    "Fase",
    "Fecha",
    "Exception",
    "Description",
    "Resumen IA",
    "Detalle Errores controlados",
    "Codigo de Error Controlado",
    "APX Chanel",
    "Fecha de Revision",
    "Numero de ejecuciones",
    "Número de Errores",
    "Numero de tiempo de respuesta(ms)",
    "Tuvo mayor numero de ejecuciones",
    "Aumento el promedio de tiempo respuesta",
  ];

  const rows = result.rows.map((row) => [
    row.trx,
    row.phase,
    row.date,
    row.exception,
    row.description,
    row.resumenIA,
    row.detalleErroresControlados,
    row.codigoErrorControlado,
    row.apxChannel,
    row.fechaRevision,
    row.numeroEjecuciones,
    row.numeroErrores,
    row.numeroTiempoRespuestaMs,
    row.tuvoMayorNumeroEjecuciones,
    row.aumentoPromedioTiempoRespuesta,
  ]);

  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildSheetsText(result: IncidentMonitoringResult): string {
  const headers = [
    "TRX",
    "Fase",
    "Fecha",
    "Exception",
    "Description",
    "Resumen IA",
    "Detalle Errores controlados",
    "Codigo de Error Controlado",
    "APX Chanel",
    "Fecha de Revision",
    "Numero de ejecuciones",
    "Número de Errores",
    "Numero de tiempo de respuesta(ms)",
    "Tuvo mayor numero de ejecuciones",
    "Aumento el promedio de tiempo respuesta",
  ];

  const rows = result.rows.map((row) => [
    row.trx,
    row.phase,
    row.date,
    row.exception,
    row.description,
    row.resumenIA,
    row.detalleErroresControlados,
    row.codigoErrorControlado,
    row.apxChannel,
    row.fechaRevision,
    String(row.numeroEjecuciones),
    String(row.numeroErrores),
    String(row.numeroTiempoRespuestaMs),
    row.tuvoMayorNumeroEjecuciones,
    row.aumentoPromedioTiempoRespuesta,
  ]);

  return [headers, ...rows].map((row) => row.join("\t")).join("\n");
}

async function copySvgChartAsImage(container: HTMLDivElement | null) {
  if (!container) throw new Error("No se encontró el gráfico.");

  const svg = container.querySelector("svg");
  if (!svg) throw new Error("No se encontró el SVG del gráfico.");

  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
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

function ChartCard({
  title,
  data,
  dataKey,
  chartRef,
}: {
  title: string;
  data: Array<Record<string, string | number>>;
  dataKey: string;
  chartRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/90 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={async () => {
            try {
              await copySvgChartAsImage(chartRef.current);
              toast.success("Gráfico copiado como imagen.");
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "No se pudo copiar la imagen."
              );
            }
          }}
        >
          <Image className="mr-2 h-4 w-4" />
          Copiar gráfico
        </Button>
      </div>

      <div ref={chartRef} className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
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
              strokeWidth={2.5}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function VersionadoIncidentes() {
  const { bearerToken, setBearerToken } = useBearerToken();
  const [showToken, setShowToken] = useState(false);
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);

  const [environment, setEnvironment] = useState<EnvironmentOption>("INT");
  const [installationDay, setInstallationDay] = useState<Date>(new Date());
  const [rangeMode, setRangeMode] = useState<InstallationRangeMode>("before");
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IncidentMonitoringResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execChartRef = useRef<HTMLDivElement>(null);
  const errorChartRef = useRef<HTMLDivElement>(null);
  const timeChartRef = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
const location = useLocation();

const currentPage = location.pathname.startsWith("/versionado/incidentes")
  ? "versionado-incidentes"
  : location.pathname.startsWith("/versionado/entornos")
  ? "versionado-entornos"
  : "pipeline";

  const chartData = useMemo(
    () =>
      (result?.rows ?? []).map((row) => ({
        fecha: row.date,
        numeroEjecuciones: row.numeroEjecuciones,
        numeroErrores: row.numeroErrores,
        numeroTiempoRespuestaMs: Number(row.numeroTiempoRespuestaMs.toFixed(2)),
      })),
    [result]
  );

  const handleSearch = async () => {
    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchIncidentMonitoring({
        environment,
        installationDay,
        mode: rangeMode,
        bearerToken: bearerToken.trim(),
        openAiApiKey: openAiApiKey.trim(),
      });

      setResult(data);
      toast.success("Monitoreo de incidentes cargado correctamente.");
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

    const fileName = `monitoreo_incidentes_${result.environment}_${result.mode}_${result.installationDay.replace(
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
      await navigator.clipboard.writeText(buildSheetsText(result));
      toast.success("Informe copiado. Ya puedes pegarlo en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  const showCharts = viewMode === "charts" || viewMode === "both";
  const showTable = viewMode === "table" || viewMode === "both";

  return (
    <div className="min-h-screen gradient-mesh">
   <LoadingOverlay show={loading} />

      <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
        <section className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Bearer Token
              </Label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  placeholder="Pega aquí el bearer token"
                  className="h-11 rounded-xl pr-10 font-mono text-xs"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                OpenAI API Key
              </Label>
              <div className="relative">
                <Input
                  type={showOpenAiKey ? "text" : "password"}
                  placeholder="Pega aquí tu OpenAI API Key"
                  className="h-11 rounded-xl pr-10 font-mono text-xs"
                  value={openAiApiKey}
                  onChange={(e) => setOpenAiApiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowOpenAiKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showOpenAiKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Entorno</Label>
              <Select
                value={environment}
                onValueChange={(value) => setEnvironment(value as EnvironmentOption)}
              >
                <SelectTrigger className="h-11 rounded-xl font-mono text-xs">
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

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Día de instalación
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-11 w-full justify-start rounded-xl font-mono text-xs",
                      !installationDay && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {installationDay
                      ? format(installationDay, "dd/MM/yyyy")
                      : "Selecciona fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto rounded-xl p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={installationDay}
                    onSelect={(d) => d && setInstallationDay(d)}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Rango</Label>
              <Select
                value={rangeMode}
                onValueChange={(value) =>
                  setRangeMode(value as InstallationRangeMode)
                }
              >
                <SelectTrigger className="h-11 rounded-xl font-mono text-xs">
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

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={handleSearch}
              disabled={loading}
              className="h-11 rounded-xl px-5"
            >
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Consultando..." : "Consultar incidentes"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={!result}
              className="h-11 rounded-xl px-5"
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopySheets}
              disabled={!result}
              className="h-11 rounded-xl px-5"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar para Google Sheets
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              type="button"
              variant={viewMode === "charts" ? "default" : "outline"}
              className="rounded-xl"
              onClick={() => setViewMode("charts")}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              Gráficas
            </Button>
            <Button
              type="button"
              variant={viewMode === "table" ? "default" : "outline"}
              className="rounded-xl"
              onClick={() => setViewMode("table")}
            >
              <Table2 className="mr-2 h-4 w-4" />
              Tabla
            </Button>
            <Button
              type="button"
              variant={viewMode === "both" ? "default" : "outline"}
              className="rounded-xl"
              onClick={() => setViewMode("both")}
            >
              <LayoutPanelTop className="mr-2 h-4 w-4" />
              Ambos
            </Button>
          </div>
        </section>

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">TRX Principal</span>
            </div>
            <div className="mt-3 break-all font-mono text-xl font-bold">
              {result?.trx || "-"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-xs font-medium text-muted-foreground">Errores</span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? result.totals.numeroErrores.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">
                Tiempo respuesta
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? formatMs(result.totals.numeroTiempoRespuestaMs) : "0 ms"}
            </div>
          </div>
        </section>

        {showCharts && chartData.length > 0 && (
          <section className="grid gap-4 xl:grid-cols-3">
            <ChartCard
              title="Número de ejecuciones"
              data={chartData}
              dataKey="numeroEjecuciones"
              chartRef={execChartRef}
            />
            <ChartCard
              title="Número de errores"
              data={chartData}
              dataKey="numeroErrores"
              chartRef={errorChartRef}
            />
            <ChartCard
              title="Tiempo de respuesta (ms)"
              data={chartData}
              dataKey="numeroTiempoRespuestaMs"
              chartRef={timeChartRef}
            />
          </section>
        )}

        {showTable && (
          <section className="rounded-2xl border border-border/70 bg-card/95 shadow-sm">
            <div className="border-b border-border/60 px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">
                Detalle de incidentes
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
              </p>
            </div>

            <div className="overflow-auto max-h-[78vh]">
              <table className="w-max min-w-[2550px] text-left text-sm">
                <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                  <tr className="border-b border-border/70">
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[120px]">
                      Fase
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[125px]">
                      Fecha
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[150px]">
                      TRX
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[260px]">
                      Exception
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[420px]">
                      Description
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[360px]">
                      Resumen IA
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[420px]">
                      Detalle Errores controlados
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[290px]">
                      Codigo de Error Controlado
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[120px]">
                      APX Chanel
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[145px]">
                      Fecha de Revision
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[160px] text-right">
                      Número de ejecuciones
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[150px] text-right">
                      Número de errores
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[210px] text-right">
                      Tiempo de respuesta (ms)
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[220px]">
                      Tuvo mayor número de ejecuciones
                    </th>
                    <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-[240px]">
                      Aumento el promedio de tiempo respuesta
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {result?.rows.map((row, idx) => (
                    <tr
                      key={`${row.phase}-${row.date}-${row.trx}-${idx}`}
                      className={cn(
                        "border-b border-border/50 align-top transition-colors hover:bg-muted/30",
                        getRowClassByPhase(row.phase)
                      )}
                    >
                      <td className="px-4 py-4">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
                            getPhaseBadgeClass(row.phase)
                          )}
                        >
                          {getPhaseLabel(row.phase)}
                        </span>
                      </td>

                      <td className="px-4 py-4 font-medium whitespace-nowrap">
                        {row.date}
                      </td>

                      <td className="px-4 py-4 font-mono font-semibold break-all">
                        {row.trx}
                      </td>

                      <td className="px-4 py-4">
                        <div className="max-w-[240px] break-words text-sm font-medium text-foreground">
                          {row.exception || "-"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="max-w-[390px] whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                          {row.description || "-"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="max-w-[330px] whitespace-pre-wrap break-words text-sm leading-6 text-primary">
                          {row.resumenIA || "-"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="max-w-[390px] whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                          {row.detalleErroresControlados || "-"}
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="max-w-[260px] break-words text-sm font-semibold text-destructive">
                          {row.codigoErrorControlado || "-"}
                        </div>
                      </td>

                      <td className="px-4 py-4 font-mono font-medium whitespace-nowrap">
                        {row.apxChannel || "-"}
                      </td>

                      <td className="px-4 py-4 whitespace-nowrap">
                        {row.fechaRevision || "-"}
                      </td>

                      <td className="px-4 py-4 text-right font-mono font-semibold whitespace-nowrap">
                        {row.numeroEjecuciones.toLocaleString()}
                      </td>

                      <td className="px-4 py-4 text-right font-mono font-semibold whitespace-nowrap">
                        {row.numeroErrores.toLocaleString()}
                      </td>

                      <td className="px-4 py-4 text-right font-mono font-semibold whitespace-nowrap">
                        {formatMs(row.numeroTiempoRespuestaMs)}
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                            row.tuvoMayorNumeroEjecuciones === "Sí"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {row.tuvoMayorNumeroEjecuciones}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
                            row.aumentoPromedioTiempoRespuesta === "Sí"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {row.aumentoPromedioTiempoRespuesta}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {!result?.rows?.length && (
                    <tr>
                      <td
                        colSpan={15}
                        className="px-6 py-12 text-center text-sm text-muted-foreground"
                      >
                        No hay datos para mostrar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}