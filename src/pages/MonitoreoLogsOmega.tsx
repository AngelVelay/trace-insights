import { useMemo, useRef, useState } from "react";
import {
  Activity,
  Braces,
  ChevronLeft,
  ChevronRight,
  Database,
  GitBranch,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  Filter,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";

import DateTimePicker from "@/components/DateTimePicker";
import { useBearerToken } from "@/hooks/useBearerToken";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  downloadOmegaCsv,
  downloadRhoTraceCsv,
  downloadTextFile,
  fetchAllOmegaLogs,
  fetchRhoTraceTable,
  flattenOmegaLog,
  type FetchAllOmegaLogsResult,
  type FetchRhoTraceTableResult,
  type OmegaLogRecord,
  type OmegaLogsProgress,
  type OmegaSort,
  type RhoTraceProgress,
  type RhoTraceTableRow,
} from "@/services/omegaLogsService";

const TABLE_PAGE_SIZES = [25, 50, 100, 250, 500];

function getDefaultFromDate(): Date {
  const date = new Date();
  date.setHours(date.getHours() - 1, 0, 0, 0);
  return date;
}

function getDefaultToDate(): Date {
  const date = new Date();
  date.setSeconds(59, 999);
  return date;
}

function sanitizeFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function displayCell(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  if (typeof value === "string") return value;
  return String(value);
}

function levelClass(level: string): string {
  const normalized = level.toUpperCase();

  if (normalized === "ERROR" || normalized === "FATAL") {
    return "border-rose-400/30 bg-rose-500/15 text-rose-200";
  }

  if (normalized === "WARN" || normalized === "WARNING") {
    return "border-amber-400/30 bg-amber-500/15 text-amber-100";
  }

  if (normalized === "INFO") {
    return "border-sky-400/30 bg-sky-500/15 text-sky-100";
  }

  if (normalized === "DEBUG" || normalized === "TRACE") {
    return "border-violet-400/30 bg-violet-500/15 text-violet-100";
  }

  return "border-slate-600 bg-slate-800 text-slate-200";
}


type RhoTraceTabProps = {
  bearerToken: string;
  setBearerToken: (value: string) => void;
  clearBearerToken: () => void;
};

function RhoTraceTab({
  bearerToken,
  setBearerToken,
  clearBearerToken,
}: RhoTraceTabProps) {
  const [showToken, setShowToken] = useState(false);
  const [namespace, setNamespace] = useState("apx.online");
  const [transactionName, setTransactionName] = useState("Z7J3T00301ZZ");
  const [returncode, setReturncode] = useState("12");
  const [sort, setSort] = useState<OmegaSort>("ascending");
  const [profile, setProfile] = useState("default");
  const [fromDate, setFromDate] = useState(getDefaultFromDate);
  const [toDate, setToDate] = useState(getDefaultToDate);
  const [pageSize, setPageSize] = useState("100");
  const [maxPages, setMaxPages] = useState("1000");
  const [maxSpans, setMaxSpans] = useState("100000");
  const [concurrency, setConcurrency] = useState("5");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<RhoTraceProgress | null>(null);
  const [result, setResult] = useState<FetchRhoTraceTableResult | null>(null);
  const [error, setError] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tablePageSize, setTablePageSize] = useState(50);
  const [tablePage, setTablePage] = useState(1);
  const [selectedTrace, setSelectedTrace] = useState<RhoTraceTableRow | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const filteredRows = useMemo(() => {
    const search = localSearch.trim().toLowerCase();

    return (result?.rows ?? []).filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!search) return true;

      return [
        row.spanId,
        row.traceId,
        row.trxName,
        row.executionDateTimeCdmx,
        row.executionTimestamp,
        row.applicationUUAA,
        row.consumerRequestId,
        row.architectureWarnings,
        row.returncode,
        row.environment,
        row.channelCode,
        row.productCode,
        row.status,
        row.error,
      ].some((value) => value.toLowerCase().includes(search));
    });
  }, [localSearch, result, statusFilter]);

  const effectiveTablePageSize =
    tablePageSize === 0 ? Math.max(1, filteredRows.length) : tablePageSize;
  const tablePageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / effectiveTablePageSize)
  );
  const safeTablePage = tablePageSize === 0
    ? 1
    : Math.min(tablePage, tablePageCount);
  const visibleRows = useMemo(() => {
    if (tablePageSize === 0) return filteredRows;
    const start = (safeTablePage - 1) * effectiveTablePageSize;
    return filteredRows.slice(start, start + effectiveTablePageSize);
  }, [effectiveTablePageSize, filteredRows, safeTablePage, tablePageSize]);

  const handleSearch = async () => {
    if (!bearerToken.trim()) {
      toast.error("Agrega el Bearer Token antes de consultar RHO.");
      return;
    }

    if (!transactionName.trim()) {
      toast.error("Indica el nombre de la TRX.");
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);
    setProgress(null);
    setResult(null);
    setError("");
    setLocalSearch("");
    setStatusFilter("all");
    setTablePage(1);

    try {
      const response = await fetchRhoTraceTable({
        namespace: namespace.trim() || "apx.online",
        transactionName: transactionName.trim(),
        returncode: returncode.trim() || "12",
        sort,
        profile: profile.trim() || "default",
        fromDate,
        toDate,
        bearerToken,
        pageSize: Number(pageSize) || 100,
        maxPages: Number(maxPages) || 1000,
        maxSpans: Number(maxSpans) || 100000,
        concurrency: Number(concurrency) || 5,
        signal: controller.signal,
        onProgress: setProgress,
      });

      setResult(response);

      if (response.paginationIncomplete) {
        toast.error(
          `RHO informó ${response.totalAvailable.toLocaleString()} registros, pero no entregó un paginationKey utilizable. Se cargaron ${response.spansFound.toLocaleString()}.`
        );
      } else if (response.stoppedByLimit) {
        toast.warning(
          `La recuperación terminó por el límite configurado. Cargados: ${response.spansFound.toLocaleString()} de ${response.totalAvailable.toLocaleString()}.`
        );
      } else if (response.repeatedPaginationKey) {
        toast.warning(
          "RHO devolvió un cursor de paginación que ya había sido utilizado. La consulta se detuvo para evitar duplicar páginas o entrar en un ciclo."
        );
      } else {
        toast.success(
          `Consulta completa: ${response.spansFound.toLocaleString()} registros en ${response.spanPages.toLocaleString()} páginas; ${response.successfulTraces.toLocaleString()} trazas correctas y ${response.failedTraces.toLocaleString()} con error.`
        );
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        toast.info("Consulta cancelada.");
        return;
      }

      const message =
        caught instanceof Error
          ? caught.message
          : "Error desconocido consultando RHO.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleReset = () => {
    abortControllerRef.current?.abort();
    setResult(null);
    setProgress(null);
    setError("");
    setLocalSearch("");
    setStatusFilter("all");
    setTablePage(1);
    setSelectedTrace(null);
  };

  const handleExport = () => {
    if (!filteredRows.length) return;
    const trx = sanitizeFilename(transactionName) || "trx";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadRhoTraceCsv(
      filteredRows,
      `rho-traces-${trx}-${timestamp}.csv`
    );
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20">
        <div className="border-b border-slate-800 bg-[#070E46] px-6 py-6">
          <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#85C8FF]">
                <GitBranch className="h-4 w-4" />
                RHO · Spans y trazas
              </div>
              <h1 className="text-2xl font-bold text-white md:text-3xl">
                Errores técnicos enriquecidos
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
                Recupera los <span className="font-mono text-[#8BE1E9]">spanId</span> de una TRX con
                <span className="font-mono text-[#FFB56B]"> returncode 12</span>, consulta cada traza y obtiene
                TRX NAME, fecha y hora de ejecución en CDMX (GMT-6), applicationUUAA, consumerRequestId y architectureWarnings.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Registros cargados</div>
                <div className="mt-1 text-xl font-bold text-white">
                  {(result?.spansFound ?? progress?.spansFound ?? 0).toLocaleString()}
                  <span className="ml-1 text-xs font-medium text-slate-400">
                    / {(result?.totalAvailable ?? progress?.totalAvailable ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {(result?.uniqueSpanIds ?? progress?.uniqueSpanIds ?? 0).toLocaleString()} spanId únicos
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Procesados</div>
                <div className="mt-1 text-xl font-bold text-[#85C8FF]">
                  {(result?.tracesProcessed ?? progress?.tracesProcessed ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Correctos</div>
                <div className="mt-1 text-xl font-bold text-[#88E783]">
                  {(result?.successfulTraces ?? progress?.successfulTraces ?? 0).toLocaleString()}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Errores</div>
                <div className="mt-1 text-xl font-bold text-rose-300">
                  {(result?.failedTraces ?? progress?.failedTraces ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs text-slate-300">Bearer Token</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showToken ? "text" : "password"}
                    value={bearerToken}
                    onChange={(event) => setBearerToken(event.target.value)}
                    placeholder="Bearer Token de Atenea"
                    className="h-11 border-slate-700 bg-slate-950 pr-11 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    clearBearerToken();
                    toast.success("Bearer Token eliminado.");
                  }}
                  className="h-11 border-slate-700 bg-slate-950"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Namespace</Label>
              <Input
                value={namespace}
                onChange={(event) => setNamespace(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950 font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Perfil</Label>
              <Input
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950 font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs text-slate-300">TRX NAME</Label>
              <Input
                value={transactionName}
                onChange={(event) => setTransactionName(event.target.value.toUpperCase())}
                placeholder="Z7J3T00301ZZ"
                className="h-11 border-slate-700 bg-slate-950 font-mono text-sm font-semibold tracking-wide"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Return code</Label>
              <Input
                value={returncode}
                onChange={(event) => setReturncode(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950 font-mono text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Orden de spans</Label>
              <Select value={sort} onValueChange={(value) => setSort(value as OmegaSort)}>
                <SelectTrigger className="h-11 border-slate-700 bg-slate-950">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ascending">Ascendente</SelectItem>
                  <SelectItem value="descending">Descendente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Desde</Label>
              <DateTimePicker value={fromDate} onChange={setFromDate} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Hasta</Label>
              <DateTimePicker value={toDate} onChange={setToDate} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Registros por petición</Label>
              <Input
                type="number"
                min="1"
                value={pageSize}
                onChange={(event) => setPageSize(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Máximo de páginas</Label>
              <Input
                type="number"
                min="1"
                value={maxPages}
                onChange={(event) => setMaxPages(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Límite total de registros</Label>
              <Input
                type="number"
                min="1"
                value={maxSpans}
                onChange={(event) => setMaxSpans(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-slate-300">Concurrencia de trazas</Label>
              <Input
                type="number"
                min="1"
                max="12"
                value={concurrency}
                onChange={(event) => setConcurrency(event.target.value)}
                className="h-11 border-slate-700 bg-slate-950"
              />
            </div>
          </div>

          <p className="text-xs leading-5 text-slate-500">
            “Registros por petición” solo controla el tamaño de cada página del endpoint. La aplicación continúa solicitando páginas hasta recuperar todos los resultados o alcanzar el límite total configurado.
          </p>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 font-mono text-[11px] leading-5 text-slate-400">
            <div className="text-[#85C8FF]">Consulta de spans</div>
            <div className="mt-1 break-all">
              name == "{transactionName || "TRX"}" and properties.returncode == "{returncode || "12"}"
            </div>
            <div className="mt-2 text-[#8BE1E9]">
              Cada spanId se consulta después en /mrs/RhoTraces/spans/&lt;spanId&gt;:trace
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleSearch}
              disabled={loading}
              className="h-11 bg-[#001391] px-5 text-white hover:bg-[#1828b8]"
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Recuperar spans y trazas
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => abortControllerRef.current?.abort()}
              disabled={!loading}
              className="h-11 border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
            >
              <Square className="mr-2 h-4 w-4" />
              Detener
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              className="h-11 border-slate-700 bg-slate-950"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Limpiar
            </Button>
          </div>

          {progress ? (
            <div className="rounded-2xl border border-[#85C8FF]/20 bg-[#85C8FF]/5 p-4 text-sm text-slate-300">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span>
                  Fase: <strong className="text-white">{progress.phase === "spans" ? "Recuperando spans" : "Consultando trazas"}</strong>
                </span>
                <span>
                  Cargados: <strong className="text-white">{progress.spansFound.toLocaleString()}</strong>
                  <span className="text-slate-500"> / {progress.totalAvailable.toLocaleString()}</span>
                </span>
                <span>SpanId únicos: <strong className="text-white">{progress.uniqueSpanIds.toLocaleString()}</strong></span>
                <span>Páginas: <strong className="text-white">{progress.pages.toLocaleString()}</strong></span>
                <span>Procesados: <strong className="text-white">{progress.tracesProcessed.toLocaleString()}</strong></span>
                <span>Tiempo: <strong className="text-white">{formatElapsed(progress.elapsedMs)}</strong></span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              {error}
            </div>
          ) : null}
        </div>
      </section>

      {result ? (
        <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-800 bg-slate-950/70 px-5 py-5 xl:flex-row xl:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldAlert className="h-4 w-4 text-[#FFB56B]" />
                Tabla de errores técnicos enriquecidos
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Cargados {result.rows.length.toLocaleString()} de {result.totalAvailable.toLocaleString()} registros · {result.uniqueSpanIds.toLocaleString()} spanId únicos · mostrando {visibleRows.length.toLocaleString()} en esta vista.
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-[280px]">
                <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  value={localSearch}
                  onChange={(event) => {
                    setLocalSearch(event.target.value);
                    setTablePage(1);
                  }}
                  placeholder="Filtrar TRX, UUAA, requestId, warnings..."
                  className="h-10 border-slate-700 bg-slate-950 pl-9 text-xs"
                />
              </div>

              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setTablePage(1);
                }}
              >
                <SelectTrigger className="h-10 min-w-[150px] border-slate-700 bg-slate-950">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="OK">Correctos</SelectItem>
                  <SelectItem value="ERROR">Con error</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="outline"
                onClick={handleExport}
                disabled={!filteredRows.length}
                className="h-10 border-slate-700 bg-slate-950"
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            </div>
          </div>

          {result.paginationIncomplete ? (
            <div className="mx-5 mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
              RHO reportó {result.totalAvailable.toLocaleString()} registros, pero la respuesta no expuso un paginationKey utilizable. No se presenta el resultado como completo: se cargaron {result.rows.length.toLocaleString()}.
            </div>
          ) : null}

          <div className="max-h-[720px] overflow-auto scrollbar-thin">
            <table className="min-w-max border-collapse text-left text-xs">
              <thead className="sticky top-0 z-20 bg-[#070E46] text-slate-100 shadow-lg">
                <tr>
                  <th className="sticky left-0 z-30 border-b border-r border-slate-700 bg-[#001391] px-3 py-3 text-center">JSON</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">SPAN ID</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">TRX NAME</th>
                  <th className="min-w-[225px] border-b border-r border-slate-700 px-3 py-3">FECHA Y HORA · CDMX (GMT-6)</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">applicationUUAA</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">consumerRequestId</th>
                  <th className="min-w-[360px] border-b border-r border-slate-700 px-3 py-3">architectureWarnings</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">ENV</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">CHANNEL</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">PRODUCT</th>
                  <th className="border-b border-r border-slate-700 px-3 py-3">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, rowIndex) => (
                  <tr key={`${row.spanId || "sin-span"}-${safeTablePage}-${rowIndex}`} className="border-b border-slate-800 bg-slate-950/50 hover:bg-slate-800/70">
                    <td className="sticky left-0 z-10 border-r border-slate-700 bg-[#0a1735] px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedTrace(row)}
                        className="rounded-lg border border-[#85C8FF]/30 bg-[#85C8FF]/10 p-2 text-[#85C8FF] hover:bg-[#85C8FF]/20"
                        title="Ver span y traza completos"
                      >
                        <Braces className="h-3.5 w-3.5" />
                      </button>
                    </td>
                    <td className="max-w-[250px] truncate border-r border-slate-800 px-3 py-2 font-mono text-[11px] text-[#85C8FF]" title={row.spanId}>{row.spanId || "-"}</td>
                    <td className="border-r border-slate-800 px-3 py-2 font-mono font-semibold text-white">{row.trxName || "-"}</td>
                    <td
                      className="whitespace-nowrap border-r border-slate-800 px-3 py-2 font-mono text-[11px] font-semibold text-[#FFE761]"
                      title={row.executionTimestamp || row.executionDateTimeCdmx}
                    >
                      {row.executionDateTimeCdmx || "-"}
                    </td>
                    <td className="border-r border-slate-800 px-3 py-2 font-mono text-slate-200">{row.applicationUUAA || "-"}</td>
                    <td className="max-w-[300px] truncate border-r border-slate-800 px-3 py-2 font-mono text-[11px] text-slate-300" title={row.consumerRequestId}>{row.consumerRequestId || "-"}</td>
                    <td className="max-w-[520px] border-r border-slate-800 px-3 py-2 align-top text-[11px] leading-5 text-slate-200">
                      <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words">{row.architectureWarnings || "-"}</div>
                    </td>
                    <td className="border-r border-slate-800 px-3 py-2 font-mono text-slate-300">{row.environment || "-"}</td>
                    <td className="border-r border-slate-800 px-3 py-2 font-mono text-slate-300">{row.channelCode || "-"}</td>
                    <td className="border-r border-slate-800 px-3 py-2 font-mono text-slate-300">{row.productCode || "-"}</td>
                    <td className="border-r border-slate-800 px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${row.status === "OK" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-200" : "border-rose-400/30 bg-rose-500/15 text-rose-200"}`} title={row.error}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col justify-between gap-4 border-t border-slate-800 bg-slate-950/70 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>Filas por página</span>
              <Select
                value={String(tablePageSize)}
                onValueChange={(value) => {
                  setTablePageSize(Number(value));
                  setTablePage(1);
                }}
              >
                <SelectTrigger className="h-9 w-24 border-slate-700 bg-slate-900"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TABLE_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
                  <SelectItem value="0">Todos ({filteredRows.length.toLocaleString()})</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" disabled={tablePageSize === 0 || safeTablePage <= 1} onClick={() => setTablePage((page) => Math.max(1, page - 1))} className="border-slate-700 bg-slate-900">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-slate-300">Página {safeTablePage.toLocaleString()} de {tablePageCount.toLocaleString()}</span>
              <Button type="button" variant="outline" size="sm" disabled={tablePageSize === 0 || safeTablePage >= tablePageCount} onClick={() => setTablePage((page) => Math.min(tablePageCount, page + 1))} className="border-slate-700 bg-slate-900">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {selectedTrace ? (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/70 backdrop-blur-sm">
          <button type="button" className="flex-1 cursor-default" onClick={() => setSelectedTrace(null)} aria-label="Cerrar detalle" />
          <aside className="flex h-full w-full max-w-4xl flex-col border-l border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-white">Span y traza completos</div>
                <div className="text-xs text-slate-500">{selectedTrace.spanId}</div>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedTrace(null)} className="border-slate-700 bg-slate-900">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6 text-slate-200 scrollbar-thin">
              {JSON.stringify({ sourceSpan: selectedTrace.sourceSpan, tracePayload: selectedTrace.tracePayload, extraction: selectedTrace }, null, 2)}
            </pre>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export default function MonitoreoLogsOmega() {
  const { bearerToken, setBearerToken, clearBearerToken } = useBearerToken();
  const [activeTab, setActiveTab] = useState<"logs" | "rho">("logs");

  const [showToken, setShowToken] = useState(false);
  const [namespace, setNamespace] = useState("apx.online");
  const [query, setQuery] = useState(
    'message == "*409 CONFLICT with protocol HTTPS*"'
  );
  const [sort, setSort] = useState<OmegaSort>("descending");
  const [profile, setProfile] = useState("default");
  const [fromDate, setFromDate] = useState(getDefaultFromDate);
  const [toDate, setToDate] = useState(getDefaultToDate);
  const [pageSize, setPageSize] = useState("100");
  const [maxPages, setMaxPages] = useState("1000");
  const [maxRecords, setMaxRecords] = useState("100000");

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<OmegaLogsProgress | null>(null);
  const [result, setResult] = useState<FetchAllOmegaLogsResult | null>(null);
  const [error, setError] = useState("");

  const [localSearch, setLocalSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [tablePageSize, setTablePageSize] = useState(50);
  const [tablePage, setTablePage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<OmegaLogRecord | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const flattenedRows = useMemo(
    () => (result?.rows ?? []).map((row) => ({ raw: row, flat: flattenOmegaLog(row) })),
    [result]
  );

  const levelOptions = useMemo(() => {
    const levels = new Set<string>();

    for (const row of flattenedRows) {
      const level = displayCell(row.flat.level).trim();
      if (level) levels.add(level);
    }

    return [...levels].sort((a, b) => a.localeCompare(b));
  }, [flattenedRows]);

  const filteredRows = useMemo(() => {
    const search = localSearch.trim().toLowerCase();

    return flattenedRows.filter(({ flat }) => {
      const level = displayCell(flat.level);

      if (levelFilter !== "all" && level !== levelFilter) {
        return false;
      }

      if (!search) return true;

      return Object.values(flat).some((value) =>
        displayCell(value).toLowerCase().includes(search)
      );
    });
  }, [flattenedRows, levelFilter, localSearch]);

  const tablePageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / tablePageSize)
  );

  const safeTablePage = Math.min(tablePage, tablePageCount);

  const visibleRows = useMemo(() => {
    const start = (safeTablePage - 1) * tablePageSize;
    return filteredRows.slice(start, start + tablePageSize);
  }, [filteredRows, safeTablePage, tablePageSize]);

  const levelCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const row of flattenedRows) {
      const level = displayCell(row.flat.level).trim() || "SIN NIVEL";
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }

    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [flattenedRows]);

  const handleSearch = async () => {
    if (!bearerToken.trim()) {
      toast.error("Agrega el Bearer Token antes de consultar Omega.");
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError("");
    setResult(null);
    setProgress(null);
    setTablePage(1);
    setLocalSearch("");
    setLevelFilter("all");

    try {
      const response = await fetchAllOmegaLogs({
        namespace: namespace.trim() || "apx.online",
        query,
        sort,
        profile: profile.trim() || "default",
        fromDate,
        toDate,
        bearerToken,
        pageSize: Number(pageSize) || 100,
        maxPages: Number(maxPages) || 1000,
        maxRecords: Number(maxRecords) || 100000,
        signal: controller.signal,
        onProgress: setProgress,
      });

      setResult(response);

      if (response.stoppedByLimit) {
        toast.warning(
          `La recuperación se detuvo por el límite configurado. Registros: ${response.totalRecords.toLocaleString()}.`
        );
      } else if (response.repeatedPaginationKey) {
        toast.warning(
          "Omega repitió el paginationKey. Se detuvo la consulta para evitar un ciclo infinito."
        );
      } else {
        toast.success(
          `Recuperación finalizada: ${response.totalRecords.toLocaleString()} logs en ${response.pages.toLocaleString()} páginas.`
        );
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        toast.info("Consulta cancelada.");
        return;
      }

      const message =
        caught instanceof Error ? caught.message : "Error desconocido consultando Omega.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
  };

  const handleReset = () => {
    abortControllerRef.current?.abort();
    setResult(null);
    setProgress(null);
    setError("");
    setLocalSearch("");
    setLevelFilter("all");
    setTablePage(1);
    setSelectedLog(null);
  };

  const exportFilename = (extension: string) => {
    const prefix = sanitizeFilename(namespace || "apx-online") || "apx-online";
    return `omega-logs-${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
  };

  const handleExportAllCsv = () => {
    if (!result?.rows.length) return;
    downloadOmegaCsv(result.rows, exportFilename("csv"));
  };

  const handleExportFilteredCsv = () => {
    if (!filteredRows.length) return;
    downloadOmegaCsv(
      filteredRows.map((row) => row.raw),
      exportFilename("filtrado.csv")
    );
  };

  const handleExportJson = () => {
    if (!result?.rows.length) return;
    downloadTextFile(
      JSON.stringify(result.rows, null, 2),
      exportFilename("json"),
      "application/json;charset=utf-8"
    );
  };

  const handleClearToken = () => {
    clearBearerToken();
    toast.success("Bearer Token eliminado.");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto w-full max-w-[1880px] space-y-6 px-5 py-8 lg:px-8">
        <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-800 bg-slate-900 p-2 shadow-xl shadow-black/10">
          <button
            type="button"
            onClick={() => setActiveTab("logs")}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${activeTab === "logs" ? "bg-[#001391] text-white shadow-lg" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            <Database className="h-4 w-4" />
            Logs Omega
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("rho")}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${activeTab === "rho" ? "bg-[#001391] text-white shadow-lg" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            <Activity className="h-4 w-4" />
            Spans RHO enriquecidos
          </button>
        </nav>

        <div className={activeTab === "logs" ? "contents" : "hidden"}>
        <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20">
          <div className="border-b border-slate-800 bg-[#070E46] px-6 py-6">
            <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-center">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#85C8FF]">
                  <Database className="h-4 w-4" />
                  Omega · Logs paginados
                </div>
                <h1 className="text-2xl font-bold text-white md:text-3xl">
                  Recuperación y exportación de logs
                </h1>
                <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
                  Recorre automáticamente cada <span className="font-mono text-[#8BE1E9]">paginationKey</span>,
                  conserva todos los campos del JSON, aplana propiedades anidadas y genera un CSV único.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Páginas</div>
                  <div className="mt-1 text-xl font-bold text-white">
                    {(result?.pages ?? progress?.page ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Logs</div>
                  <div className="mt-1 text-xl font-bold text-[#88E783]">
                    {(result?.totalRecords ?? progress?.totalRecords ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Columnas</div>
                  <div className="mt-1 text-xl font-bold text-[#85C8FF]">
                    {(result?.columns.length ?? 0).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Tiempo</div>
                  <div className="mt-1 text-xl font-bold text-[#FFE761]">
                    {formatElapsed(result?.elapsedMs ?? progress?.elapsedMs ?? 0)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
              <div className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2 xl:col-span-2">
                    <Label className="text-xs text-slate-300">Bearer Token</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showToken ? "text" : "password"}
                          value={bearerToken}
                          onChange={(event) => setBearerToken(event.target.value)}
                          placeholder="Bearer Token de Atenea"
                          className="h-11 border-slate-700 bg-slate-900 pr-11 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowToken((value) => !value)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                          aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                        >
                          {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleClearToken}
                        className="h-11 border-slate-700 bg-slate-900"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Namespace</Label>
                    <Input
                      value={namespace}
                      onChange={(event) => setNamespace(event.target.value)}
                      className="h-11 border-slate-700 bg-slate-900 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Perfil</Label>
                    <Input
                      value={profile}
                      onChange={(event) => setProfile(event.target.value)}
                      className="h-11 border-slate-700 bg-slate-900 font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-slate-300">Consulta restSQL</Label>
                  <Textarea
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    rows={4}
                    placeholder={'message == "*409 CONFLICT with protocol HTTPS*"'}
                    className="resize-y border-slate-700 bg-slate-900 font-mono text-xs leading-5"
                  />
                  <div className="text-[11px] text-slate-500">
                    Ejemplo: <span className="font-mono text-slate-300">level == "ERROR" AND properties.hostname == "host*"</span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Desde</Label>
                    <DateTimePicker value={fromDate} onChange={setFromDate} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Hasta</Label>
                    <DateTimePicker value={toDate} onChange={setToDate} />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Orden</Label>
                    <Select value={sort} onValueChange={(value) => setSort(value as OmegaSort)}>
                      <SelectTrigger className="h-11 border-slate-700 bg-slate-900">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="descending">Descendente</SelectItem>
                        <SelectItem value="ascending">Ascendente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Tamaño de página</Label>
                    <Input
                      type="number"
                      min={1}
                      value={pageSize}
                      onChange={(event) => setPageSize(event.target.value)}
                      className="h-11 border-slate-700 bg-slate-900 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Máximo de páginas</Label>
                    <Input
                      type="number"
                      min={1}
                      value={maxPages}
                      onChange={(event) => setMaxPages(event.target.value)}
                      className="h-11 border-slate-700 bg-slate-900 font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-slate-300">Máximo de registros</Label>
                    <Input
                      type="number"
                      min={1}
                      value={maxRecords}
                      onChange={(event) => setMaxRecords(event.target.value)}
                      className="h-11 border-slate-700 bg-slate-900 font-mono text-xs"
                    />
                  </div>

                  <div className="flex items-end">
                    <Button
                      type="button"
                      onClick={handleSearch}
                      disabled={loading}
                      className="h-11 w-full bg-[#001391] text-white hover:bg-[#1428bf]"
                    >
                      {loading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="mr-2 h-4 w-4" />
                      )}
                      Recuperar todos
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={!loading}
                    className="border-rose-500/40 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                  >
                    <Square className="mr-2 h-4 w-4" />
                    Detener
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleReset}
                    className="border-slate-700 bg-slate-900"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Limpiar resultados
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportAllCsv}
                    disabled={!result?.rows.length || loading}
                    className="border-[#88E783]/40 bg-[#88E783]/10 text-[#c9ffd0] hover:bg-[#88E783]/20"
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Exportar CSV completo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleExportJson}
                    disabled={!result?.rows.length || loading}
                    className="border-[#9694FF]/40 bg-[#9694FF]/10 text-[#d8d7ff] hover:bg-[#9694FF]/20"
                  >
                    <FileJson className="mr-2 h-4 w-4" />
                    Exportar JSON
                  </Button>
                </div>
              </div>

              <aside className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                <div>
                  <div className="text-sm font-semibold text-white">Estado de la recuperación</div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Las páginas se solicitan de forma secuencial usando el token devuelto por Omega.
                  </p>
                </div>

                {loading ? (
                  <div className="rounded-2xl border border-[#85C8FF]/20 bg-[#85C8FF]/5 p-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-[#85C8FF]" />
                      <div>
                        <div className="text-sm font-semibold text-white">Recuperando páginas</div>
                        <div className="text-xs text-slate-400">
                          Página {(progress?.page ?? 0).toLocaleString()} · {(progress?.totalRecords ?? 0).toLocaleString()} logs
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full w-2/3 animate-pulse rounded-full bg-[#85C8FF]" />
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                    {error}
                  </div>
                ) : null}

                {result ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {levelCounts.slice(0, 6).map(([level, count]) => (
                        <div key={level} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                          <div className="truncate text-[10px] uppercase tracking-wider text-slate-500">{level}</div>
                          <div className="mt-1 text-lg font-bold text-white">{count.toLocaleString()}</div>
                        </div>
                      ))}
                    </div>

                    {result.stoppedByLimit ? (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
                        La consulta llegó al máximo configurado. Aumenta páginas o registros para continuar recuperando más datos.
                      </div>
                    ) : null}

                    {result.repeatedPaginationKey ? (
                      <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs leading-5 text-violet-100">
                        Omega repitió un paginationKey; el proceso se detuvo para evitar un ciclo infinito.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-xs leading-5 text-slate-500">
                    Ejecuta una consulta para ver el avance y el resumen por nivel.
                  </div>
                )}
              </aside>
            </div>
          </div>
        </section>

        {result?.rows.length ? (
          <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/20">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-800 bg-slate-950/70 px-5 py-5 xl:flex-row xl:items-center">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Braces className="h-4 w-4 text-[#85C8FF]" />
                  Logs recuperados
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Mostrando {filteredRows.length.toLocaleString()} de {result.totalRecords.toLocaleString()} registros · {result.columns.length.toLocaleString()} columnas JSON
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative min-w-[280px]">
                  <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <Input
                    value={localSearch}
                    onChange={(event) => {
                      setLocalSearch(event.target.value);
                      setTablePage(1);
                    }}
                    placeholder="Filtrar en todos los campos..."
                    className="h-10 border-slate-700 bg-slate-950 pl-9 text-xs"
                  />
                </div>

                <Select
                  value={levelFilter}
                  onValueChange={(value) => {
                    setLevelFilter(value);
                    setTablePage(1);
                  }}
                >
                  <SelectTrigger className="h-10 min-w-[160px] border-slate-700 bg-slate-950">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los niveles</SelectItem>
                    {levelOptions.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleExportFilteredCsv}
                  disabled={!filteredRows.length}
                  className="h-10 border-slate-700 bg-slate-950"
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV filtrado
                </Button>
              </div>
            </div>

            <div className="max-h-[720px] overflow-auto scrollbar-thin">
              <table className="min-w-max border-collapse text-left text-xs">
                <thead className="sticky top-0 z-20 bg-[#070E46] text-slate-100 shadow-lg">
                  <tr>
                    <th className="sticky left-0 z-30 w-16 border-b border-r border-slate-700 bg-[#001391] px-3 py-3 text-center">
                      JSON
                    </th>
                    {result.columns.map((column) => (
                      <th
                        key={column}
                        className="max-w-[320px] border-b border-r border-slate-700 px-3 py-3 font-semibold"
                        title={column}
                      >
                        <div className="max-w-[300px] truncate">{column}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ raw, flat }, rowIndex) => {
                    const level = displayCell(flat.level);

                    return (
                      <tr
                        key={`${safeTablePage}-${rowIndex}-${displayCell(flat.spanId)}-${displayCell(flat.recordDate)}`}
                        className="border-b border-slate-800 bg-slate-950/50 hover:bg-slate-800/70"
                      >
                        <td className="sticky left-0 z-10 border-r border-slate-700 bg-[#0a1735] px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => setSelectedLog(raw)}
                            className="rounded-lg border border-[#85C8FF]/30 bg-[#85C8FF]/10 p-2 text-[#85C8FF] hover:bg-[#85C8FF]/20"
                            title="Ver JSON completo"
                          >
                            <Braces className="h-3.5 w-3.5" />
                          </button>
                        </td>
                        {result.columns.map((column) => {
                          const value = displayCell(flat[column]);
                          const isMessage = column.toLowerCase().includes("message");
                          const isLevel = column === "level";

                          return (
                            <td
                              key={column}
                              className="max-w-[420px] border-r border-slate-800 px-3 py-2 align-top font-mono text-[11px] text-slate-300"
                              title={value}
                            >
                              {isLevel && value ? (
                                <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${levelClass(level)}`}>
                                  {value}
                                </span>
                              ) : (
                                <div
                                  className={
                                    isMessage
                                      ? "max-h-20 min-w-[340px] overflow-hidden whitespace-pre-wrap break-words leading-5"
                                      : "max-w-[300px] truncate"
                                  }
                                >
                                  {value || "-"}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col justify-between gap-4 border-t border-slate-800 bg-slate-950/70 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>Filas por página</span>
                <Select
                  value={String(tablePageSize)}
                  onValueChange={(value) => {
                    setTablePageSize(Number(value));
                    setTablePage(1);
                  }}
                >
                  <SelectTrigger className="h-9 w-24 border-slate-700 bg-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TABLE_PAGE_SIZES.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeTablePage <= 1}
                  onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                  className="border-slate-700 bg-slate-900"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-slate-300">
                  Página {safeTablePage.toLocaleString()} de {tablePageCount.toLocaleString()}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={safeTablePage >= tablePageCount}
                  onClick={() =>
                    setTablePage((page) => Math.min(tablePageCount, page + 1))
                  }
                  className="border-slate-700 bg-slate-900"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </section>
        ) : null}
        </div>

        {activeTab === "rho" ? (
          <RhoTraceTab
            bearerToken={bearerToken}
            setBearerToken={setBearerToken}
            clearBearerToken={clearBearerToken}
          />
        ) : null}
      </main>

      {selectedLog ? (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/70 backdrop-blur-sm">
          <button
            type="button"
            className="flex-1 cursor-default"
            onClick={() => setSelectedLog(null)}
            aria-label="Cerrar detalle"
          />
          <aside className="flex h-full w-full max-w-3xl flex-col border-l border-slate-700 bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-white">JSON completo del log</div>
                <div className="text-xs text-slate-500">Incluye propiedades anidadas sin transformación.</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedLog(null)}
                className="border-slate-700 bg-slate-900"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-6 text-slate-200 scrollbar-thin">
              {JSON.stringify(selectedLog, null, 2)}
            </pre>
          </aside>
        </div>
      ) : null}
    </div>
  );
}