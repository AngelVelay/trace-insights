import { useMemo, useRef, useState } from "react";
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
  Brain,
  Cpu,
  Sparkles,
  Bot,
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
  type IncidentAiProvider,
  type IncidentAiModel,
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

const AI_PROVIDER_OPTIONS: Array<{
  value: IncidentAiProvider;
  label: string;
}> = [
  { value: "heuristic", label: "Resumen heurístico" },
  { value: "local", label: "Local (Gemini Nano / Prompt API)" },
  { value: "openai", label: "OpenAI API" },
  { value: "gemini", label: "Gemini API" },
];

const OPENAI_MODELS: IncidentAiModel[] = ["gpt-4.1-nano"];
const GEMINI_MODELS: IncidentAiModel[] = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
];
const LOCAL_MODELS: IncidentAiModel[] = ["local-gemini-nano"];
const HEURISTIC_MODELS: IncidentAiModel[] = ["heuristic-summary"];

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

function StyledIncidentTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Record<string, unknown> }>;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload;

  return (
    <div className="max-w-[420px] rounded-2xl border border-slate-700 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-2 text-sm font-bold text-cyan-300">
        {String(point.fecha ?? "-")}
      </div>

      <div className="space-y-1 text-xs text-slate-200">
        <div>
          <span className="font-semibold text-slate-400">InvokerTx:</span>{" "}
          {String(point.trx ?? "-")}
        </div>
        <div>
          <span className="font-semibold text-slate-400">Número de ejecuciones:</span>{" "}
          {Number(point.numeroEjecuciones ?? 0).toLocaleString()}
        </div>
        <div>
          <span className="font-semibold text-slate-400">Número de errores:</span>{" "}
          {Number(point.numeroErrores ?? 0).toLocaleString()}
        </div>
        <div>
          <span className="font-semibold text-slate-400">Tiempo de respuesta:</span>{" "}
          {formatMs(Number(point.numeroTiempoRespuestaMs ?? 0))}
        </div>

        <div className="pt-2">
          <span className="font-semibold text-slate-400">Description:</span>
          <div className="mt-1 whitespace-pre-wrap break-words text-slate-300">
            {String(point.description ?? "-")}
          </div>
        </div>

        <div className="pt-2">
          <span className="font-semibold text-slate-400">Resumen IA:</span>
          <div className="mt-1 whitespace-pre-wrap break-words text-emerald-300">
            {String(point.resumenIA ?? "-")}
          </div>
        </div>
      </div>
    </div>
  );
}

function IncidentMetricChart({
  title,
  data,
  dataKey,
  lineColor,
  chartRef,
}: {
  title: string;
  data: Array<Record<string, unknown>>;
  dataKey: string;
  lineColor: string;
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

      <div ref={chartRef} className="h-[290px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<StyledIncidentTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={title}
              stroke={lineColor}
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

  const [aiProvider, setAiProvider] = useState<IncidentAiProvider>("heuristic");
  const [aiModel, setAiModel] = useState<IncidentAiModel>("heuristic-summary");
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [environment, setEnvironment] = useState<EnvironmentOption>("INT");
  const [installationDay, setInstallationDay] = useState<Date>(new Date());
  const [rangeMode, setRangeMode] = useState<InstallationRangeMode>("before");
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IncidentMonitoringResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beforeExecRef = useRef<HTMLDivElement>(null);
  const beforeErrorRef = useRef<HTMLDivElement>(null);
  const beforeTimeRef = useRef<HTMLDivElement>(null);

  const installExecRef = useRef<HTMLDivElement>(null);
  const installErrorRef = useRef<HTMLDivElement>(null);
  const installTimeRef = useRef<HTMLDivElement>(null);

  const afterExecRef = useRef<HTMLDivElement>(null);
  const afterErrorRef = useRef<HTMLDivElement>(null);
  const afterTimeRef = useRef<HTMLDivElement>(null);

  const simpleChartData = useMemo(
    () =>
      (result?.rows ?? []).map((row) => ({
        fecha: row.date,
        trx: row.trx,
        numeroEjecuciones: row.numeroEjecuciones,
        numeroErrores: row.numeroErrores,
        numeroTiempoRespuestaMs: Number(row.numeroTiempoRespuestaMs.toFixed(2)),
        description: row.description,
        resumenIA: row.resumenIA,
      })),
    [result]
  );

  const beforeChartData = useMemo(
    () =>
      (result?.rows ?? [])
        .filter((row) => row.phase === "before")
        .map((row) => ({
          fecha: row.date,
          trx: row.trx,
          numeroEjecuciones: row.numeroEjecuciones,
          numeroErrores: row.numeroErrores,
          numeroTiempoRespuestaMs: Number(row.numeroTiempoRespuestaMs.toFixed(2)),
          description: row.description,
          resumenIA: row.resumenIA,
        })),
    [result]
  );

  const installationChartData = useMemo(
    () =>
      (result?.rows ?? [])
        .filter((row) => row.phase === "installation")
        .map((row) => ({
          fecha: row.date,
          trx: row.trx,
          numeroEjecuciones: row.numeroEjecuciones,
          numeroErrores: row.numeroErrores,
          numeroTiempoRespuestaMs: Number(row.numeroTiempoRespuestaMs.toFixed(2)),
          description: row.description,
          resumenIA: row.resumenIA,
        })),
    [result]
  );

  const afterChartData = useMemo(
    () =>
      (result?.rows ?? [])
        .filter((row) => row.phase === "after")
        .map((row) => ({
          fecha: row.date,
          trx: row.trx,
          numeroEjecuciones: row.numeroEjecuciones,
          numeroErrores: row.numeroErrores,
          numeroTiempoRespuestaMs: Number(row.numeroTiempoRespuestaMs.toFixed(2)),
          description: row.description,
          resumenIA: row.resumenIA,
        })),
    [result]
  );

  const modelOptions = useMemo(() => {
    if (aiProvider === "openai") return OPENAI_MODELS;
    if (aiProvider === "gemini") return GEMINI_MODELS;
    if (aiProvider === "local") return LOCAL_MODELS;
    return HEURISTIC_MODELS;
  }, [aiProvider]);

  const handleProviderChange = (provider: IncidentAiProvider) => {
    setAiProvider(provider);

    if (provider === "openai") {
      setAiModel("gpt-4.1-nano");
      return;
    }
    if (provider === "gemini") {
      setAiModel("gemini-2.5-flash-lite");
      return;
    }
    if (provider === "local") {
      setAiModel("local-gemini-nano");
      return;
    }

    setAiModel("heuristic-summary");
  };

  const handleSearch = async () => {
    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido.");
      return;
    }

    if (aiProvider === "openai" && !openAiApiKey.trim()) {
      toast.error("Debes capturar la OpenAI API Key.");
      return;
    }

    if (aiProvider === "gemini" && !geminiApiKey.trim()) {
      toast.error("Debes capturar la Gemini API Key.");
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
        aiProvider,
        aiModel,
        openAiApiKey: openAiApiKey.trim(),
        geminiApiKey: geminiApiKey.trim(),
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
  const isComplete = result?.mode === "complete";

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
                Proveedor IA
              </Label>
              <Select value={aiProvider} onValueChange={(value) => handleProviderChange(value as IncidentAiProvider)}>
                <SelectTrigger className="h-11 rounded-xl font-mono text-xs">
                  <SelectValue placeholder="Selecciona proveedor IA" />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Modelo IA
              </Label>
              <Select value={aiModel} onValueChange={(value) => setAiModel(value as IncidentAiModel)}>
                <SelectTrigger className="h-11 rounded-xl font-mono text-xs">
                  <SelectValue placeholder="Selecciona modelo IA" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {aiProvider === "openai" && (
              <div className="space-y-2 xl:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  OpenAI API Key
                </Label>
                <div className="relative">
                  <Input
                    type={showOpenAiKey ? "text" : "password"}
                    placeholder="Captura tu OpenAI API Key"
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
            )}

            {aiProvider === "gemini" && (
              <div className="space-y-2 xl:col-span-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  Gemini API Key
                </Label>
                <div className="relative">
                  <Input
                    type={showGeminiKey ? "text" : "password"}
                    placeholder="Captura tu Gemini API Key"
                    className="h-11 rounded-xl pr-10 font-mono text-xs"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  >
                    {showGeminiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            )}
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

        <section className="grid gap-4 lg:grid-cols-4">
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
              <Brain className="h-4 w-4 text-violet-500" />
              <span className="text-xs font-medium text-muted-foreground">Proveedor IA</span>
            </div>
            <div className="mt-3 font-mono text-sm font-bold">
              {aiProvider}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium text-muted-foreground">Modelo IA</span>
            </div>
            <div className="mt-3 break-all font-mono text-sm font-bold">
              {aiModel}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-medium text-muted-foreground">Registros</span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result?.rows.length ?? 0}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">Ejecuciones</span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? result.totals.numeroEjecuciones.toLocaleString() : "0"}
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

        {showCharts && result && (
          <>
            {isComplete ? (
              <section className="space-y-6">
                <div>
                  <h2 className="mb-3 text-sm font-semibold">Before</h2>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <IncidentMetricChart
                      title="Before · Número de ejecuciones"
                      data={beforeChartData}
                      dataKey="numeroEjecuciones"
                      lineColor="#3b82f6"
                      chartRef={beforeExecRef}
                    />
                    <IncidentMetricChart
                      title="Before · Número de errores"
                      data={beforeChartData}
                      dataKey="numeroErrores"
                      lineColor="#ef4444"
                      chartRef={beforeErrorRef}
                    />
                    <IncidentMetricChart
                      title="Before · Tiempo de respuesta"
                      data={beforeChartData}
                      dataKey="numeroTiempoRespuestaMs"
                      lineColor="#8b5cf6"
                      chartRef={beforeTimeRef}
                    />
                  </div>
                </div>

                <div>
                  <h2 className="mb-3 text-sm font-semibold">Día de instalación</h2>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <IncidentMetricChart
                      title="Instalación · Número de ejecuciones"
                      data={installationChartData}
                      dataKey="numeroEjecuciones"
                      lineColor="#f59e0b"
                      chartRef={installExecRef}
                    />
                    <IncidentMetricChart
                      title="Instalación · Número de errores"
                      data={installationChartData}
                      dataKey="numeroErrores"
                      lineColor="#f97316"
                      chartRef={installErrorRef}
                    />
                    <IncidentMetricChart
                      title="Instalación · Tiempo de respuesta"
                      data={installationChartData}
                      dataKey="numeroTiempoRespuestaMs"
                      lineColor="#d946ef"
                      chartRef={installTimeRef}
                    />
                  </div>
                </div>

                <div>
                  <h2 className="mb-3 text-sm font-semibold">After</h2>
                  <div className="grid gap-4 xl:grid-cols-3">
                    <IncidentMetricChart
                      title="After · Número de ejecuciones"
                      data={afterChartData}
                      dataKey="numeroEjecuciones"
                      lineColor="#10b981"
                      chartRef={afterExecRef}
                    />
                    <IncidentMetricChart
                      title="After · Número de errores"
                      data={afterChartData}
                      dataKey="numeroErrores"
                      lineColor="#22c55e"
                      chartRef={afterErrorRef}
                    />
                    <IncidentMetricChart
                      title="After · Tiempo de respuesta"
                      data={afterChartData}
                      dataKey="numeroTiempoRespuestaMs"
                      lineColor="#06b6d4"
                      chartRef={afterTimeRef}
                    />
                  </div>
                </div>
              </section>
            ) : (
              <section className="grid gap-4 xl:grid-cols-3">
                <IncidentMetricChart
                  title="Número de ejecuciones"
                  data={simpleChartData}
                  dataKey="numeroEjecuciones"
                  lineColor="#3b82f6"
                  chartRef={beforeExecRef}
                />
                <IncidentMetricChart
                  title="Número de errores"
                  data={simpleChartData}
                  dataKey="numeroErrores"
                  lineColor="#ef4444"
                  chartRef={beforeErrorRef}
                />
                <IncidentMetricChart
                  title="Tiempo de respuesta"
                  data={simpleChartData}
                  dataKey="numeroTiempoRespuestaMs"
                  lineColor="#8b5cf6"
                  chartRef={beforeTimeRef}
                />
              </section>
            )}
          </>
        )}

        {showTable && (
          <section className="rounded-2xl border border-border/70 bg-card/95 shadow-sm">
            <div className="border-b border-border/60 px-5 py-4">
              <h2 className="text-sm font-semibold tracking-tight">
                Detalle de incidentes
              </h2>
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