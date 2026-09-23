import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Braces,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  FileSearch2,
  Loader2,
  Play,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import DateTimePicker from "@/components/DateTimePicker";
import { useBearerToken } from "@/hooks/useBearerToken";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  fetchAteneaLogs,
  type AteneaExitCodeFilter,
  type AteneaLogRow,
  type AteneaLogsEnvironment,
  type AteneaLogsNamespace,
  type AteneaLogsProgress,
  type AteneaLogsSearchResult,
} from "@/services/ateneaLogsService";

const ENVIRONMENTS: AteneaLogsEnvironment[] = ["DEV", "INT", "AUS", "OCT", "PRO"];
const NAMESPACES: AteneaLogsNamespace[] = ["apx.batch", "apx.online"];
const ALL_EXIT_CODES = "ALL";
const MESSAGE_PREVIEW_MAX_CHARS = 900;
const DEFAULT_TABLE_PAGE_SIZE = 100;
const TABLE_PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

type ResultTab = "logs" | "spans";
type SpanViewMode = "spanId" | "trxJob";

function getDefaultFromDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDefaultToDate(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  return date;
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildLogsCsv(rows: AteneaLogRow[]): string {
  const header = [
    "TRX/JOB",
    "Tipo",
    "applicationUUAA",
    "Message",
    "Fecha",
    "Span ID",
    "Trace ID",
    "Env",
    "Exit Code",
    "Level",
  ];

  return [
    header,
    ...rows.map((row) => [
      row.name,
      row.trxJobType,
      row.applicationUUAA,
      row.message,
      row.date,
      row.spanId,
      row.traceId,
      row.env,
      row.exitCode,
      row.level,
    ]),
  ]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function buildSpansCsv(rows: AteneaLogRow[]): string {
  const header = [
    "TRX/JOB",
    "Tipo",
    "applicationUUAA",
    "Message",
    "Fecha",
    "Span ID",
    "Trace ID",
    "Env",
    "Exit Code",
  ];

  return [
    header,
    ...rows.map((row) => [
      row.name,
      row.trxJobType,
      row.applicationUUAA,
      row.message,
      row.date,
      row.spanId,
      row.traceId,
      row.env,
      row.exitCode,
    ]),
  ]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

function buildLogsClipboardTable(rows: AteneaLogRow[]): string {
  const table = [
    [
      "TRX/JOB",
      "Tipo",
      "applicationUUAA",
      "Message",
      "Fecha",
      "Span ID",
      "Trace ID",
      "Env",
      "Exit Code",
      "Level",
    ],
    ...rows.map((row) => [
      row.name,
      row.trxJobType,
      row.applicationUUAA,
      row.message.replace(/[\t\r\n]+/g, " "),
      row.date,
      row.spanId,
      row.traceId,
      row.env,
      row.exitCode,
      row.level,
    ]),
  ];

  return table.map((row) => row.join("\t")).join("\n");
}

function buildSpansClipboardTable(rows: AteneaLogRow[]): string {
  const table = [
    [
      "TRX/JOB",
      "Tipo",
      "applicationUUAA",
      "Message",
      "Fecha",
      "Span ID",
      "Trace ID",
      "Env",
      "Exit Code",
    ],
    ...rows.map((row) => [
      row.name,
      row.trxJobType,
      row.applicationUUAA,
      row.message.replace(/[\t\r\n]+/g, " "),
      row.date,
      row.spanId,
      row.traceId,
      row.env,
      row.exitCode,
    ]),
  ];

  return table.map((row) => row.join("\t")).join("\n");
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeMessage(value: string): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function splitMessageParagraphs(message: string): string[] {
  const normalized = normalizeMessage(message);
  if (!normalized) return ["-"];

  const paragraphs = normalized
    .split(/\n\s*\n+/g)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) return paragraphs;

  const lines = normalized
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 1 ? lines : [normalized];
}

function getMessagePreview(message: string): {
  preview: string;
  truncated: boolean;
  paragraphCount: number;
} {
  const normalized = normalizeMessage(message);
  const paragraphs = splitMessageParagraphs(normalized);
  const firstThree = paragraphs.slice(0, 3).join("\n\n");

  const hardTruncated = firstThree.length > MESSAGE_PREVIEW_MAX_CHARS;
  const preview = hardTruncated
    ? `${firstThree.slice(0, MESSAGE_PREVIEW_MAX_CHARS).trimEnd()}…`
    : firstThree;

  return {
    preview,
    truncated:
      paragraphs.length > 3 || hardTruncated || preview.length < normalized.length,
    paragraphCount: paragraphs.length,
  };
}

function getExitCodeBadgeVariant(exitCode: string): "destructive" | "secondary" | "outline" {
  const normalized = String(exitCode ?? "").trim().toUpperCase();
  if (["FAILED", "ERROR", "KO"].includes(normalized)) return "destructive";
  if (["SUCCESS", "COMPLETED", "OK"].includes(normalized)) return "secondary";
  return "outline";
}

function getLevelBadgeClass(level: string): string {
  const normalized = String(level ?? "").trim().toUpperCase();
  if (normalized === "ERROR") {
    return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
  }
  if (normalized === "WARN" || normalized === "WARNING") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  return "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300";
}

interface ResultPaginationProps {
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

function ResultPagination({
  page,
  pageSize,
  totalRows,
  onPageChange,
  onPageSizeChange,
}: ResultPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const firstRow = totalRows ? (safePage - 1) * pageSize + 1 : 0;
  const lastRow = Math.min(safePage * pageSize, totalRows);

  return (
    <div className="flex flex-col gap-3 border-t border-border bg-muted/10 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground">
        {totalRows
          ? `Mostrando ${firstRow.toLocaleString("es-MX")}-${lastRow.toLocaleString("es-MX")} de ${totalRows.toLocaleString("es-MX")}`
          : "Sin filas para mostrar"}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Filas</span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger className="h-8 w-[84px] rounded-lg font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TABLE_PAGE_SIZE_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="min-w-[110px] text-center font-mono text-xs text-muted-foreground">
          Página {safePage.toLocaleString("es-MX")} / {totalPages.toLocaleString("es-MX")}
        </span>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={safePage <= 1}
          onClick={() => onPageChange(1)}
          aria-label="Primera página"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="Última página"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function LogsAtenea() {
  const { bearerToken, setBearerToken } = useBearerToken();

  const [environment, setEnvironment] = useState<AteneaLogsEnvironment>("INT");
  const [namespace, setNamespace] = useState<AteneaLogsNamespace>("apx.batch");
  const [message, setMessage] = useState(
    "InvoicesTransaction*V0",
  );
  const [fromDate, setFromDate] = useState<Date>(getDefaultFromDate);
  const [toDate, setToDate] = useState<Date>(getDefaultToDate);
  const [exitCode, setExitCode] = useState<AteneaExitCodeFilter>(ALL_EXIT_CODES);
  const [activeTab, setActiveTab] = useState<ResultTab>("logs");
  const [spanViewMode, setSpanViewMode] = useState<SpanViewMode>("trxJob");
  const [selectedMessageRow, setSelectedMessageRow] = useState<AteneaLogRow | null>(
    null,
  );
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<AteneaLogsProgress | null>(null);
  const [result, setResult] = useState<AteneaLogsSearchResult | null>(null);
  const [error, setError] = useState("");
  const [tablePageSize, setTablePageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [logsPage, setLogsPage] = useState(1);
  const [spansPage, setSpansPage] = useState(1);

  const exitCodeOptions = useMemo(() => {
    const common = ["FAILED", "SUCCESS", "COMPLETED", "OK", "ERROR"];
    const fromResult = result?.exitCodes ?? [];
    return Array.from(new Set([...common, ...fromResult])).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [result]);

  const visibleRows = useMemo(() => {
    if (!result) return [];
    if (exitCode === ALL_EXIT_CODES) return result.rows;
    return result.rows.filter(
      (row) => row.exitCode.toUpperCase() === exitCode.toUpperCase(),
    );
  }, [result, exitCode]);

  const uniqueSpanRows = useMemo(() => {
    const bySpanId = new Map<string, AteneaLogRow>();

    for (const row of visibleRows) {
      const spanId = String(row.spanId ?? "").trim();
      if (!spanId || spanId === "-" || bySpanId.has(spanId)) continue;
      bySpanId.set(spanId, row);
    }

    const spanRows = Array.from(bySpanId.values());
    if (spanViewMode === "spanId") return spanRows;

    // visibleRows ya viene ordenado de más reciente a más antiguo. Por eso al
    // quitar TRX/JOB repetidas se conserva la ejecución más reciente de cada name.
    const byTrxJob = new Map<string, AteneaLogRow>();
    for (const row of spanRows) {
      const name = String(row.name ?? "").trim();
      const key = name && name !== "-" ? name.toUpperCase() : `SPAN:${row.spanId}`;
      if (!byTrxJob.has(key)) byTrxJob.set(key, row);
    }

    return Array.from(byTrxJob.values());
  }, [visibleRows, spanViewMode]);

  const logsTotalPages = Math.max(1, Math.ceil(visibleRows.length / tablePageSize));
  const spansTotalPages = Math.max(1, Math.ceil(uniqueSpanRows.length / tablePageSize));
  const safeLogsPage = Math.min(logsPage, logsTotalPages);
  const safeSpansPage = Math.min(spansPage, spansTotalPages);

  const pagedVisibleRows = useMemo(() => {
    const start = (safeLogsPage - 1) * tablePageSize;
    return visibleRows.slice(start, start + tablePageSize);
  }, [safeLogsPage, tablePageSize, visibleRows]);

  const pagedUniqueSpanRows = useMemo(() => {
    const start = (safeSpansPage - 1) * tablePageSize;
    return uniqueSpanRows.slice(start, start + tablePageSize);
  }, [safeSpansPage, tablePageSize, uniqueSpanRows]);

  useEffect(() => {
    setLogsPage(1);
    setSpansPage(1);
  }, [exitCode, tablePageSize]);

  useEffect(() => {
    setSpansPage(1);
  }, [spanViewMode]);

  useEffect(() => {
    setLogsPage((current) => Math.min(current, logsTotalPages));
  }, [logsTotalPages]);

  useEffect(() => {
    setSpansPage((current) => Math.min(current, spansTotalPages));
  }, [spansTotalPages]);

  const progressValue = useMemo(() => {
    if (!progress) return 0;
    if (progress.phase === "omega") return 12;
    if (!progress.total) return 20;
    return Math.max(
      20,
      Math.min(100, 20 + Math.round((progress.completed / progress.total) * 80)),
    );
  }, [progress]);

  const handleSearch = async () => {
    setError("");

    if (!message.trim()) {
      setError("Escribe el message que quieres buscar en Omega.");
      return;
    }

    if (!bearerToken.trim()) {
      setError("Bearer Token es requerido para consultar Omega y Rho.");
      return;
    }

    if (fromDate.getTime() >= toDate.getTime()) {
      setError("La fecha Desde debe ser menor que la fecha Hasta.");
      return;
    }

    setLoading(true);
    setResult(null);
    setActiveTab("logs");
    setExitCode(ALL_EXIT_CODES);
    setLogsPage(1);
    setSpansPage(1);
    setProgress({
      phase: "omega",
      completed: 0,
      total: 1,
      message: "Preparando consulta Omega...",
    });

    try {
      const response = await fetchAteneaLogs({
        environment,
        namespace,
        message,
        fromDate,
        toDate,
        bearerToken,
        onProgress: setProgress,
        onPartialResult: setResult,
      });

      setResult(response);

      if (response.truncated) {
        toast.warning(
          response.paginationError ??
            "La paginación de Omega se detuvo. Los registros recuperados hasta ese punto permanecen visibles en la tabla.",
        );
      } else if (response.enrichmentErrors > 0) {
        toast.warning(
          `Consulta completada con ${response.enrichmentErrors} span(s) que no pudieron enriquecerse en Rho.`,
        );
      } else {
        toast.success(`${response.matchingLogs} log(s) recuperados.`);
      }
    } catch (searchError) {
      const message =
        searchError instanceof Error ? searchError.message : String(searchError);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleCopy = async () => {
    const rows = activeTab === "logs" ? visibleRows : uniqueSpanRows;
    if (!rows.length) return;

    try {
      await navigator.clipboard.writeText(
        activeTab === "logs"
          ? buildLogsClipboardTable(rows)
          : buildSpansClipboardTable(rows),
      );
      toast.success(
        activeTab === "logs"
          ? "Tabla de logs copiada al portapapeles."
          : "Tabla de spans únicos copiada al portapapeles.",
      );
    } catch {
      toast.error("No se pudo copiar la tabla.");
    }
  };

  const handleCsv = () => {
    const rows = activeTab === "logs" ? visibleRows : uniqueSpanRows;
    if (!rows.length) return;

    const datePart = new Date().toISOString().slice(0, 10);
    const suffix = activeTab === "logs" ? "logs" : "spans-unicos";

    downloadTextFile(
      `\uFEFF${activeTab === "logs" ? buildLogsCsv(rows) : buildSpansCsv(rows)}`,
      `logs-atenea-${namespace}-${suffix}-${datePart}.csv`,
      "text/csv",
    );
  };

  return (
    <main className="mx-auto w-full max-w-[1880px] space-y-6 px-6 py-8">
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/20 px-6 py-6">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <FileSearch2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">LOGS ATENEA</h2>
                <p className="mt-1 max-w-4xl text-sm text-muted-foreground">
                  Consulta Omega con la misma paginación por page/size usada en Securización Live y resuelve cada spanId en Rho para obtener
                  TRX/JOB, applicationUUAA, Env y Exit Code. El message de Omega es editable.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Omega Logs
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Rho Spans
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Message editable
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                Paginación completa
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid gap-4 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Entorno</Label>
              <Select
                value={environment}
                onValueChange={(value) =>
                  setEnvironment(value as AteneaLogsEnvironment)
                }
                disabled={loading}
              >
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENVIRONMENTS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                DEV, INT, AUS y OCT usan WORK-02. PRO usa LIVE-02.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Namespace</Label>
              <Select
                value={namespace}
                onValueChange={(value) =>
                  setNamespace(value as AteneaLogsNamespace)
                }
                disabled={loading}
              >
                <SelectTrigger className="h-11 rounded-xl font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NAMESPACES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Desde</Label>
              <DateTimePicker
                value={fromDate}
                onChange={setFromDate}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label>Hasta</Label>
              <DateTimePicker
                value={toDate}
                onChange={setToDate}
                disabled={loading}
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <div className="space-y-2">
              <Label>Message de Omega</Label>
              <div className="relative">
                <Braces className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={loading}
                  placeholder="InvoicesTransaction*V0"
                  className="h-11 rounded-xl pl-10 font-mono text-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Escribe el patrón de <span className="font-mono">message</span> que se enviará a Omega.
                Usa <span className="font-mono">*</span> como wildcard. Ejemplo: <span className="font-mono">InvoicesTransaction*V0</span>.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Bearer Token</Label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  value={bearerToken}
                  onChange={(event) => setBearerToken(event.target.value)}
                  disabled={loading}
                  placeholder="Bearer token de Atenea"
                  className="h-11 rounded-xl pr-11 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1 h-9 w-9"
                  onClick={() => setShowToken((current) => !current)}
                  disabled={loading}
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Reutiliza el mismo token local de las otras páginas de Atenea.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-6 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              {environment === "PRO" ? "LIVE-02" : "WORK-02"} · {namespace} ·
              Omega → spanId → Rho
            </div>

            <Button
              type="button"
              onClick={handleSearch}
              disabled={loading || !message.trim() || !bearerToken.trim()}
              className="h-11 rounded-xl px-6"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {loading ? "Consultando..." : "Buscar logs"}
            </Button>
          </div>

          {loading && progress ? (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between gap-4 text-xs text-muted-foreground">
                <span>{progress.message}</span>
                {progress.phase === "rho" && progress.total ? (
                  <span>
                    {progress.completed}/{progress.total}
                  </span>
                ) : null}
              </div>
              <Progress value={progressValue} />
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Logs leídos Omega
                </div>
                <div className="mt-2 text-3xl font-bold">
                  {result.omegaLogsRead.toLocaleString("es-MX")}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {result.omegaPagesRead.toLocaleString("es-MX")} página(s)
                  {result.omegaTotalElements !== undefined
                    ? ` · ${result.omegaTotalElements.toLocaleString("es-MX")} reportados`
                    : ""}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Coincidencias
                </div>
                <div className="mt-2 text-3xl font-bold text-primary">
                  {result.matchingLogs.toLocaleString("es-MX")}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Span IDs únicos
                </div>
                <div className="mt-2 text-3xl font-bold">
                  {result.uniqueSpanIds.toLocaleString("es-MX")}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Spans enriquecidos
                </div>
                <div className="mt-2 text-3xl font-bold text-emerald-600">
                  {result.enrichedSpans.toLocaleString("es-MX")}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Errores Rho
                </div>
                <div className="mt-2 text-3xl font-bold text-destructive">
                  {result.enrichmentErrors.toLocaleString("es-MX")}
                </div>
              </CardContent>
            </Card>
          </section>

          {result.truncated ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <div className="font-semibold">Resultados parciales visibles</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {result.paginationError ??
                    "La paginación de Omega se detuvo, pero los datos recuperados se conservaron y se muestran en la tabla."}
                </div>
              </div>
            </div>
          ) : null}

          {loading && result?.rows.length ? (
            <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
              <div>
                <div className="font-semibold">Mostrando datos mientras continúa la consulta</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Ya puedes revisar {result.rows.length.toLocaleString("es-MX")} fila(s). Rho continúa enriqueciendo TRX/JOB, UUAA y Exit Code en segundo plano.
                </div>
              </div>
            </div>
          ) : null}

          <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b border-border p-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  <Search className="h-5 w-5 text-primary" />
                  Resultados LOGS ATENEA
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  La vista Logs mantiene todos los registros. En Spans únicos puedes
                  dejar un solo registro por TRX/JOB o únicamente quitar spanId repetidos.
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[190px] space-y-1">
                  <Label className="text-xs">Exit Code</Label>
                  <Select value={exitCode} onValueChange={setExitCode}>
                    <SelectTrigger className="h-9 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_EXIT_CODES}>Todos</SelectItem>
                      {exitCodeOptions.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {activeTab === "spans" ? (
                  <div className="min-w-[210px] space-y-1">
                    <Label className="text-xs">Sin repetir</Label>
                    <Select
                      value={spanViewMode}
                      onValueChange={(value) => setSpanViewMode(value as SpanViewMode)}
                    >
                      <SelectTrigger className="h-9 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trxJob">TRX/JOB únicos</SelectItem>
                        <SelectItem value="spanId">Solo Span ID único</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={
                    activeTab === "logs"
                      ? !visibleRows.length
                      : !uniqueSpanRows.length
                  }
                  className="rounded-lg"
                >
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copiar
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCsv}
                  disabled={
                    activeTab === "logs"
                      ? !visibleRows.length
                      : !uniqueSpanRows.length
                  }
                  className="rounded-lg"
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as ResultTab)}
              className="w-full"
            >
              <div className="flex flex-col gap-3 border-b border-border bg-muted/10 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <TabsList className="grid w-full max-w-[420px] grid-cols-2 rounded-xl">
                  <TabsTrigger value="logs" className="rounded-lg">
                    Logs ({visibleRows.length.toLocaleString("es-MX")})
                  </TabsTrigger>
                  <TabsTrigger value="spans" className="rounded-lg">
                    Spans únicos ({uniqueSpanRows.length.toLocaleString("es-MX")})
                  </TabsTrigger>
                </TabsList>

                <div className="text-xs text-muted-foreground">
                  {exitCode !== ALL_EXIT_CODES ? `Filtro Exit Code: ${exitCode}` : "Sin filtro de Exit Code"}
                </div>
              </div>

              <TabsContent value="logs" className="m-0">
                <div className="max-h-[72vh] overflow-auto">
                  <Table className="min-w-[1540px] table-fixed">
                    <TableHeader className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
                      <TableRow className="border-b-2 bg-muted/60 hover:bg-muted/60">
                        <TableHead className="w-[230px] font-bold">TRX/JOB</TableHead>
                        <TableHead className="w-[105px] font-bold">Tipo</TableHead>
                        <TableHead className="w-[135px] font-bold">applicationUUAA</TableHead>
                        <TableHead className="w-[560px] font-bold">Message</TableHead>
                        <TableHead className="w-[185px] font-bold">Fecha</TableHead>
                        <TableHead className="w-[270px] font-bold">Span ID</TableHead>
                        <TableHead className="w-[90px] font-bold">Env</TableHead>
                        <TableHead className="w-[125px] font-bold">Exit Code</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.length ? (
                        pagedVisibleRows.map((row, index) => {
                          const preview = getMessagePreview(row.message);

                          return (
                            <TableRow
                              key={row.id}
                              className={
                                index % 2 === 0
                                  ? "align-top bg-background transition-colors hover:bg-primary/[0.04]"
                                  : "align-top bg-muted/[0.12] transition-colors hover:bg-primary/[0.04]"
                              }
                            >
                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <div className="break-words font-mono text-xs font-bold text-foreground">
                                  {row.name}
                                </div>
                                {row.traceId && row.traceId !== "-" ? (
                                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={row.traceId}>
                                    trace: {row.traceId}
                                  </div>
                                ) : null}
                              </TableCell>

                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {row.trxJobType}
                                </Badge>
                              </TableCell>

                              <TableCell className="border-r border-border/40 py-4 align-top font-mono text-xs font-semibold">
                                {row.applicationUUAA}
                              </TableCell>

                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={`font-mono text-[10px] ${getLevelBadgeClass(row.level)}`}
                                    >
                                      {row.level}
                                    </Badge>
                                    {preview.paragraphCount > 1 ? (
                                      <span className="text-[10px] text-muted-foreground">
                                        {preview.paragraphCount} párrafo(s)
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground">
                                    {preview.preview}
                                  </div>

                                  {preview.truncated ? (
                                    <Button
                                      type="button"
                                      variant="link"
                                      size="sm"
                                      className="mt-2 h-auto p-0 text-xs font-semibold"
                                      onClick={() => setSelectedMessageRow(row)}
                                    >
                                      Ver más
                                    </Button>
                                  ) : null}
                                </div>

                                {row.enrichmentError ? (
                                  <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-[10px] text-destructive">
                                    Rho: {row.enrichmentError}
                                  </div>
                                ) : null}
                              </TableCell>

                              <TableCell className="border-r border-border/40 py-4 align-top whitespace-nowrap font-mono text-[11px]">
                                {row.date}
                              </TableCell>

                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <div className="break-all rounded-lg bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-4">
                                  {row.spanId}
                                </div>
                              </TableCell>

                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                  {row.env}
                                </Badge>
                              </TableCell>

                              <TableCell className="py-4 align-top">
                                <Badge
                                  variant={getExitCodeBadgeVariant(row.exitCode)}
                                  className="font-mono text-[10px]"
                                >
                                  {row.exitCode}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="h-32 text-center text-muted-foreground"
                          >
                            No hay resultados para el filtro seleccionado.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <ResultPagination
                  page={safeLogsPage}
                  pageSize={tablePageSize}
                  totalRows={visibleRows.length}
                  onPageChange={setLogsPage}
                  onPageSizeChange={setTablePageSize}
                />
              </TabsContent>

              <TabsContent value="spans" className="m-0">
                <div className="max-h-[72vh] overflow-auto">
                  <Table className="min-w-[1760px] table-fixed">
                    <TableHeader className="sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
                      <TableRow className="border-b-2 bg-muted/60 hover:bg-muted/60">
                        <TableHead className="w-[240px] font-bold">TRX/JOB</TableHead>
                        <TableHead className="w-[105px] font-bold">Tipo</TableHead>
                        <TableHead className="w-[145px] font-bold">applicationUUAA</TableHead>
                        <TableHead className="w-[500px] font-bold">Message</TableHead>
                        <TableHead className="w-[185px] font-bold">Fecha</TableHead>
                        <TableHead className="w-[280px] font-bold">Span ID</TableHead>
                        <TableHead className="w-[280px] font-bold">Trace ID</TableHead>
                        <TableHead className="w-[90px] font-bold">Env</TableHead>
                        <TableHead className="w-[125px] font-bold">Exit Code</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uniqueSpanRows.length ? (
                        pagedUniqueSpanRows.map((row, index) => {
                          const preview = getMessagePreview(row.message);

                          return (
                            <TableRow
                              key={`span-${row.spanId}-${row.name}`}
                              className={
                                index % 2 === 0
                                  ? "align-top bg-background transition-colors hover:bg-primary/[0.04]"
                                  : "align-top bg-muted/[0.12] transition-colors hover:bg-primary/[0.04]"
                              }
                            >
                              <TableCell className="border-r border-border/40 py-4 align-top font-mono text-xs font-bold">
                                {row.name}
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {row.trxJobType}
                                </Badge>
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top font-mono text-xs font-semibold">
                                {row.applicationUUAA}
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                                  <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={`font-mono text-[10px] ${getLevelBadgeClass(row.level)}`}
                                    >
                                      {row.level}
                                    </Badge>
                                  </div>
                                  <div className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground">
                                    {preview.preview}
                                  </div>
                                  {preview.truncated ? (
                                    <Button
                                      type="button"
                                      variant="link"
                                      size="sm"
                                      className="mt-2 h-auto p-0 text-xs font-semibold"
                                      onClick={() => setSelectedMessageRow(row)}
                                    >
                                      Ver más
                                    </Button>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top whitespace-nowrap font-mono text-[11px]">
                                {row.date}
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <div className="break-all rounded-lg bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-4">
                                  {row.spanId}
                                </div>
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <div className="break-all font-mono text-[10px] leading-4 text-muted-foreground">
                                  {row.traceId}
                                </div>
                              </TableCell>
                              <TableCell className="border-r border-border/40 py-4 align-top">
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                  {row.env}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-4 align-top">
                                <Badge
                                  variant={getExitCodeBadgeVariant(row.exitCode)}
                                  className="font-mono text-[10px]"
                                >
                                  {row.exitCode}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="h-32 text-center text-muted-foreground"
                          >
                            No hay spans para el filtro seleccionado.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <ResultPagination
                  page={safeSpansPage}
                  pageSize={tablePageSize}
                  totalRows={uniqueSpanRows.length}
                  onPageChange={setSpansPage}
                  onPageSizeChange={setTablePageSize}
                />
              </TabsContent>
            </Tabs>
          </section>
        </>
      ) : null}

      <Dialog
        open={Boolean(selectedMessageRow)}
        onOpenChange={(open) => {
          if (!open) setSelectedMessageRow(null);
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>Log message completo</DialogTitle>
            <DialogDescription>
              {selectedMessageRow
                ? `${selectedMessageRow.name} · ${selectedMessageRow.env} · ${selectedMessageRow.date}`
                : "Detalle del mensaje"}
            </DialogDescription>
          </DialogHeader>

          {selectedMessageRow ? (
            <div className="space-y-4 overflow-hidden px-6 pb-6">
              <div className="flex flex-wrap gap-2 pt-4">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {selectedMessageRow.trxJobType}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  UUAA {selectedMessageRow.applicationUUAA}
                </Badge>
                <Badge
                  variant={getExitCodeBadgeVariant(selectedMessageRow.exitCode)}
                  className="font-mono text-[10px]"
                >
                  {selectedMessageRow.exitCode}
                </Badge>
                <Badge
                  variant="outline"
                  className={`font-mono text-[10px] ${getLevelBadgeClass(selectedMessageRow.level)}`}
                >
                  {selectedMessageRow.level}
                </Badge>
              </div>

              <div className="grid gap-2 rounded-xl border border-border bg-muted/20 p-3 text-[11px] sm:grid-cols-2">
                <div>
                  <span className="font-semibold">Span ID:</span>{" "}
                  <span className="break-all font-mono text-muted-foreground">
                    {selectedMessageRow.spanId}
                  </span>
                </div>
                <div>
                  <span className="font-semibold">Trace ID:</span>{" "}
                  <span className="break-all font-mono text-muted-foreground">
                    {selectedMessageRow.traceId}
                  </span>
                </div>
              </div>

              <div className="max-h-[58vh] overflow-auto rounded-xl border border-border bg-background p-4 shadow-inner">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-foreground">
                  {selectedMessageRow.message}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
