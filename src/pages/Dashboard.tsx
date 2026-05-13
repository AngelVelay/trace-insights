import { useCallback, useMemo, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useBearerToken } from "@/hooks/useBearerToken";
import type {
  MetricsFilters,
  MetricRow,
  KPISummary,
  NormalizedSpan,
  ClassifiedTraces,
} from "@/types/bbva";
import { CHANNEL_CODES } from "@/types/bbva";
import {
  fetchFullMetrics,
  fetchAwsInformComparison,
  type AwsInformComparisonResult,
  type AwsInformChannelCodeOption,
} from "@/services/metricsService";
import {
  fetchSpans,
  classifySpans,
} from "@/services/tracesService";
import {
  buildAwsMonitoringCsv,
  copyAwsMonitoringToSheets,
  buildAwsInformCsv,
  copyAwsInformToSheets,
} from "@/services/monitoringExportService";
import FilterPanel from "@/components/FilterPanel";
import KPIDashboard from "@/components/KPIDashboard";
import MetricsTable from "@/components/MetricsTable";
import TracesView from "@/components/TracesView";
import MetricsCharts from "@/components/MetricsCharts";
import AwsInformCharts from "@/components/AwsInformCharts";
import DateTimePicker from "@/components/DateTimePicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Download, Search } from "lucide-react";

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

const AWS_CHANNEL_OPTIONS: AwsInformChannelCodeOption[] = CHANNEL_CODES.map(
  (item) => ({
    channelCode: item.channelCode,
    executionsLive02: 0,
    executionsLive04: 0,
    totalExecutions: item.applications.length,
  })
);

function getDefaultFromDate() {
  const date = new Date();
  date.setDate(date.getDate() - 28);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDefaultToDate() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function parseInvokerTxItem(value: unknown): InvokerTxItem | null {
  if (!value || typeof value !== "string") return null;

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
    const trimmed = value.trim();

    if (!trimmed) return null;

    return {
      invokerTx: trimmed,
      sum_num_executions: 0,
      mean_span_duration: 0,
      sum_functional_error: 0,
      sum_technical_error: 0,
    };
  }
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

function emptyClassifiedTraces(): ClassifiedTraces {
  return {
    InterBackendCics: [],
    APIInternalConnectorImpl: [],
    Jdbc: [],
    DaasMongoConnector: [],
    other: [],
  };
}

function computeKPIs(
  rows: MetricRow[] = [],
  spans: NormalizedSpan[] = []
): KPISummary {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeSpans = Array.isArray(spans) ? spans : [];

  const invokerTxs = new Set<string>();
  const utilityTypes = new Set<string>();
  const invokedParams = new Set<string>();

  let totalExecutions = 0;

  for (const row of safeRows) {
    const tx = parseInvokerTxItem(row.invokerTx);

    if (tx?.invokerTx) {
      invokerTxs.add(tx.invokerTx);
      totalExecutions += Number(tx.sum_num_executions ?? 0);
    }

    const utilityItems = parseUtilityTypeItems(row.utilitytype);

    for (const item of utilityItems) {
      if (item.utilitytype) {
        utilityTypes.add(item.utilitytype);
      }
    }

    const invokedItems = parseInvokedParamItems(row.invokedparam);

    for (const item of invokedItems) {
      if (item.invokedparam) {
        invokedParams.add(item.invokedparam);
      }
    }
  }

  const totalDur = safeSpans.reduce((sum, span) => {
    return sum + Number(span.durationMs ?? 0);
  }, 0);

  const classified = classifySpans(safeSpans);

  return {
    totalInvokerTx: invokerTxs.size,
    totalUtilityTypes: utilityTypes.size,
    totalInvokedParams: invokedParams.size,
    totalExecutions,
    totalJumps: safeSpans.length,
    totalDurationMs: totalDur,
    avgDurationMs: safeSpans.length > 0 ? totalDur / safeSpans.length : 0,
    traceApiConnectors: classified.APIInternalConnectorImpl.length,
    traceCics: classified.InterBackendCics.length,
    traceJdbc: classified.Jdbc.length,
    traceMongo: classified.DaasMongoConnector.length,
  };
}

function parseInvokerTxList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,;\t ]+/g)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function getRowChannelCode(row?: MetricRow | null): string | undefined {
  const value = String(row?.channelCode ?? "").trim();
  return value && value !== "-" ? value : undefined;
}

function getInvokerTxResponseTimeMs(row?: MetricRow | null): number | undefined {
  const meta = parseInvokerTxItem(row?.invokerTx);

  if (!meta) return undefined;

  const responseTimeMs = Number(meta.mean_span_duration ?? 0);

  if (!Number.isFinite(responseTimeMs) || responseTimeMs <= 0) {
    return undefined;
  }

  return responseTimeMs;
}

function findMetricRowForTrace(
  rows: MetricRow[],
  invokerTx: string,
  channelCode?: string
): MetricRow | undefined {
  return rows.find((row) => {
    const meta = parseInvokerTxItem(row.invokerTx);

    if (meta?.invokerTx !== invokerTx) {
      return false;
    }

    if (!channelCode) {
      return true;
    }

    return String(row.channelCode ?? "").trim() === channelCode;
  });
}

export default function Dashboard() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [progressValue, setProgressValue] = useState<number>(0);

  const [rows, setRows] = useState<MetricRow[]>([]);
  const [spans, setSpans] = useState<NormalizedSpan[]>([]);
  const [classified, setClassified] = useState<ClassifiedTraces | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [selectedInvokerTx, setSelectedInvokerTx] = useState<string | null>(
    null
  );
  const [selectedChannelCode, setSelectedChannelCode] = useState<string | null>(
    null
  );
  const [lastFilters, setLastFilters] = useState<MetricsFilters | null>(null);

  const [awsInformInvokerTxInput, setAwsInformInvokerTxInput] = useState("");
  const [awsInformFromDate, setAwsInformFromDate] = useState<Date>(() =>
    getDefaultFromDate()
  );
  const [awsInformToDate, setAwsInformToDate] = useState<Date>(() =>
    getDefaultToDate()
  );
  const [awsInformResult, setAwsInformResult] =
    useState<AwsInformComparisonResult | null>(null);
  const [awsInformError, setAwsInformError] = useState<string | null>(null);

  const [awsInformChannelCode, setAwsInformChannelCode] = useState(
    AWS_CHANNEL_OPTIONS[0]?.channelCode ?? "MG"
  );
  const [awsInformChannelCodes] = useState<AwsInformChannelCodeOption[]>(
    AWS_CHANNEL_OPTIONS
  );

  const { bearerToken, setBearerToken } = useBearerToken();

  const [kpis, setKpis] = useState<KPISummary>({
    totalInvokerTx: 0,
    totalUtilityTypes: 0,
    totalInvokedParams: 0,
    totalExecutions: 0,
    totalJumps: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    traceApiConnectors: 0,
    traceCics: 0,
    traceJdbc: 0,
    traceMongo: 0,
  });

  const selectedRows = useMemo(() => {
    if (!selectedInvokerTx) return rows;

    return rows.filter((row) => {
      const meta = parseInvokerTxItem(row.invokerTx);
      const sameTx = meta?.invokerTx === selectedInvokerTx;
      const sameChannel = selectedChannelCode
        ? String(row.channelCode ?? "") === selectedChannelCode
        : true;

      return sameTx && sameChannel;
    });
  }, [rows, selectedInvokerTx, selectedChannelCode]);

  const loadSpansForInvokerTx = useCallback(
    async (
      filters: MetricsFilters,
      invokerTx: string,
      metricRows: MetricRow[],
      channelCode?: string
    ) => {
      const scopedFilters: MetricsFilters = channelCode
        ? {
            ...filters,
            channelCode,
            channelCodes: undefined,
          }
        : filters;

      const scopedRows = metricRows.filter((row) => {
        const meta = parseInvokerTxItem(row.invokerTx);
        const sameTx = meta?.invokerTx === invokerTx;
        const sameChannel = channelCode
          ? String(row.channelCode ?? "") === channelCode
          : true;

        return sameTx && sameChannel;
      });

      const metricRowForTrace =
        scopedRows[0] ?? findMetricRowForTrace(metricRows, invokerTx, channelCode);

      const responseTimeMs = getInvokerTxResponseTimeMs(metricRowForTrace);

      console.log("[Dashboard trace lookup]", {
        invokerTx,
        channelCode,
        responseTimeMs,
        metricRowForTrace,
      });

      setProgress(
        `Obteniendo trazas de ${invokerTx}${channelCode ? ` · canal ${channelCode}` : ""}${
          responseTimeMs ? ` · TR ${Math.round(responseTimeMs)}ms` : ""
        }...`
      );
      setProgressValue(70);

      const normalizedSpans = await fetchSpans(
        scopedFilters,
        invokerTx,
        responseTimeMs
      );

      setSpans(normalizedSpans);

      const cls = classifySpans(normalizedSpans);
      setClassified(cls);

      setKpis(computeKPIs(scopedRows, normalizedSpans));
      setProgressValue(100);
    },
    []
  );

  const handleSearch = useCallback(
    async (filters: MetricsFilters) => {
      setLoading(true);
      setProgress("Iniciando consulta...");
      setProgressValue(5);
      setMetricsError(null);
      setRows([]);
      setSpans([]);
      setClassified(null);
      setSelectedInvokerTx(null);
      setSelectedChannelCode(null);
      setLastFilters(filters);

      try {
        if (filters.bearerToken) {
          setBearerToken(filters.bearerToken);
        }

        const metricRows = await fetchFullMetrics(filters, (msg) => {
          setProgress(msg);
          setProgressValue((current) => Math.min(65, current + 8));
        });

        const safeRows = Array.isArray(metricRows) ? metricRows : [];

        setRows(safeRows);

        if (safeRows.length > 0) {
          const firstRow = safeRows[0];
          const firstMeta = parseInvokerTxItem(firstRow.invokerTx);
          const firstInvokerTx = firstMeta?.invokerTx ?? null;
          const firstChannelCode = getRowChannelCode(firstRow);

          if (firstInvokerTx) {
            setSelectedInvokerTx(firstInvokerTx);
            setSelectedChannelCode(firstChannelCode ?? null);

            await loadSpansForInvokerTx(
              filters,
              firstInvokerTx,
              safeRows,
              firstChannelCode
            );
          } else {
            setKpis(computeKPIs(safeRows, []));
            setClassified(emptyClassifiedTraces());
            setProgressValue(100);
          }
        } else {
          setKpis(computeKPIs([], []));
          setClassified(emptyClassifiedTraces());
          setProgressValue(100);
        }

        toast.success(`Consulta completada: ${safeRows.length} métricas`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        console.error("[Dashboard] Error:", err);
        setMetricsError(msg);
        toast.error(`Error: ${msg}`);
      } finally {
        setLoading(false);
        setProgress("");
        setTimeout(() => setProgressValue(0), 200);
      }
    },
    [loadSpansForInvokerTx, setBearerToken]
  );

  const handleSelectInvokerTx = useCallback(
    async (invokerTx: string, channelCode?: string) => {
      if (!lastFilters) return;

      const scopedChannel =
        channelCode ||
        getRowChannelCode(
          rows.find((row) => {
            const meta = parseInvokerTxItem(row.invokerTx);
            return meta?.invokerTx === invokerTx;
          })
        );

      const cleanChannel =
        scopedChannel && scopedChannel !== "-" ? scopedChannel : undefined;

      setSelectedInvokerTx(invokerTx);
      setSelectedChannelCode(cleanChannel ?? null);
      setLoading(true);
      setProgress(
        `Cargando detalle de ${invokerTx}${cleanChannel ? ` · canal ${cleanChannel}` : ""}...`
      );
      setProgressValue(40);

      try {
        await loadSpansForInvokerTx(
          lastFilters,
          invokerTx,
          rows,
          cleanChannel
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        toast.error(`Error cargando trazas de ${invokerTx}: ${msg}`);
      } finally {
        setLoading(false);
        setProgress("");
        setTimeout(() => setProgressValue(0), 200);
      }
    },
    [lastFilters, loadSpansForInvokerTx, rows]
  );

  const handleAwsInformSearch = useCallback(async () => {
    const invokerTxList = parseInvokerTxList(awsInformInvokerTxInput);

    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido.");
      return;
    }

    if (!invokerTxList.length) {
      toast.error("Captura al menos un invokerTx.");
      return;
    }

    if (!awsInformChannelCode.trim()) {
      toast.error("Selecciona un channel-code.");
      return;
    }

    if (awsInformFromDate.getTime() > awsInformToDate.getTime()) {
      toast.error("La fecha inicio no puede ser mayor que la fecha fin.");
      return;
    }

    setLoading(true);
    setProgress("Preparando informe AWS...");
    setProgressValue(2);
    setAwsInformError(null);
    setAwsInformResult(null);

    try {
      const result = await fetchAwsInformComparison({
        invokerTxList,
        fromDate: awsInformFromDate,
        toDate: awsInformToDate,
        bearerToken: bearerToken.trim(),
        channelCode: awsInformChannelCode.trim(),
        onProgress: setProgress,
        onProgressValue: setProgressValue,
      });

      setAwsInformResult(result);
      toast.success(`Informe AWS generado: ${result.rows.length} invokerTx`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      console.error("[AWS Inform] Error:", err);
      setAwsInformError(msg);
      toast.error(`Error generando Informe AWS: ${msg}`);
    } finally {
      setLoading(false);
      setProgress("");
      setTimeout(() => setProgressValue(0), 200);
    }
  }, [
    awsInformChannelCode,
    awsInformFromDate,
    awsInformInvokerTxInput,
    awsInformToDate,
    bearerToken,
  ]);

  const handleExportMetricsCsv = () => {
    if (!rows.length) {
      toast.error("No hay métricas para exportar.");
      return;
    }

    downloadCsvFile(
      buildAwsMonitoringCsv(rows),
      `aws_monitoreo_metricas_${Date.now()}.csv`
    );
    toast.success("CSV de métricas descargado.");
  };

  const handleCopyMetricsSheets = async () => {
    if (!rows.length) {
      toast.error("No hay métricas para copiar.");
      return;
    }

    try {
      await copyAwsMonitoringToSheets(rows);
      toast.success("Métricas copiadas. Ya puedes pegarlas en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  const handleExportChartsCsv = () => {
    if (!rows.length) {
      toast.error("No hay datos de gráficas para exportar.");
      return;
    }

    downloadCsvFile(
      buildAwsMonitoringCsv(rows),
      `aws_monitoreo_graficas_${Date.now()}.csv`
    );
    toast.success("CSV de gráficas descargado.");
  };

  const handleCopyChartsSheets = async () => {
    if (!rows.length) {
      toast.error("No hay datos de gráficas para copiar.");
      return;
    }

    try {
      await copyAwsMonitoringToSheets(rows);
      toast.success(
        "Datos de gráficas copiados. Ya puedes pegarlos en Google Sheets."
      );
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  const handleExportAwsInformCsv = (view: "metrics" | "traces") => {
    if (!awsInformResult) {
      toast.error("No hay informe AWS para exportar.");
      return;
    }

    downloadCsvFile(
      buildAwsInformCsv(awsInformResult, view),
      `inform_aws_${view}_${Date.now()}.csv`
    );
    toast.success(`CSV de Inform AWS (${view}) descargado.`);
  };

  const handleCopyAwsInformSheets = async (view: "metrics" | "traces") => {
    if (!awsInformResult) {
      toast.error("No hay informe AWS para copiar.");
      return;
    }

    try {
      await copyAwsInformToSheets(awsInformResult, view);
      toast.success(
        `Inform AWS (${view}) copiado. Ya puedes pegarlo en Google Sheets.`
      );
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <LoadingOverlay
        show={loading}
        progressText={progress}
        progressValue={progressValue}
      />

      <main className="container space-y-6 py-6">
        <FilterPanel onSearch={handleSearch} loading={loading} />

        <KPIDashboard
          kpis={kpis}
          selectedInvokerTx={
            selectedChannelCode
              ? `${selectedInvokerTx ?? ""} · Canal ${selectedChannelCode}`
              : selectedInvokerTx
          }
        />

        <Tabs defaultValue="metrics" className="space-y-4">
          <TabsList className="border border-border bg-card">
            <TabsTrigger value="charts" className="text-xs">
              Gráficas
            </TabsTrigger>

            <TabsTrigger value="metrics" className="text-xs">
              Métricas ({rows.length})
            </TabsTrigger>

            <TabsTrigger value="traces" className="text-xs">
              Trazas ({spans.length})
            </TabsTrigger>

            <TabsTrigger value="inform-aws" className="text-xs">
              Inform AWS
            </TabsTrigger>
          </TabsList>

          <TabsContent value="charts" className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleExportChartsCsv}
                disabled={!rows.length}
                className="h-10 rounded-xl"
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleCopyChartsSheets}
                disabled={!rows.length}
                className="h-10 rounded-xl"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copiar para Google Sheets
              </Button>
            </div>

            <MetricsCharts
              rows={selectedRows}
              selectedInvokerTx={selectedInvokerTx}
            />
          </TabsContent>

          <TabsContent value="metrics" className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleExportMetricsCsv}
                disabled={!rows.length}
                className="h-10 rounded-xl"
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleCopyMetricsSheets}
                disabled={!rows.length}
                className="h-10 rounded-xl"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copiar para Google Sheets
              </Button>
            </div>

            <MetricsTable
              rows={rows}
              loading={loading}
              errorMessage={metricsError}
              selectedInvokerTx={selectedInvokerTx}
              onSelectInvokerTx={handleSelectInvokerTx}
            />
          </TabsContent>

          <TabsContent value="traces">
            {classified ? (
              <TracesView classified={classified} allSpans={spans} />
            ) : (
              <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
                Selecciona un invokerTx para ver sus trazas.
              </div>
            )}
          </TabsContent>

          <TabsContent value="inform-aws" className="space-y-6">
            <section className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
              <div className="grid gap-5 xl:grid-cols-3">
                <div className="space-y-2 xl:col-span-3">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Lista de invokerTx
                  </Label>

                  <Textarea
                    value={awsInformInvokerTxInput}
                    onChange={(event) =>
                      setAwsInformInvokerTxInput(
                        event.target.value.toUpperCase()
                      )
                    }
                    placeholder={`Ejemplo:\nKSKRT00201ZZ\nMMCDT01901MX\nMCNHTWEF01MX`}
                    className="min-h-[160px] rounded-xl font-mono text-xs"
                  />

                  <p className="text-xs text-muted-foreground">
                    Puedes pegar uno por línea, separados por coma, espacio o
                    punto y coma.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Fecha inicio
                  </Label>

                  <DateTimePicker
                    value={awsInformFromDate}
                    onChange={setAwsInformFromDate}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Fecha fin
                  </Label>

                  <DateTimePicker
                    value={awsInformToDate}
                    onChange={setAwsInformToDate}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">
                    Channel-code
                  </Label>

                  <Select
                    value={awsInformChannelCode}
                    onValueChange={setAwsInformChannelCode}
                    disabled={loading}
                  >
                    <SelectTrigger className="h-11 rounded-xl font-mono text-xs">
                      <SelectValue placeholder="Selecciona channel-code" />
                    </SelectTrigger>

                    <SelectContent>
                      {awsInformChannelCodes.map((item) => (
                        <SelectItem
                          key={item.channelCode}
                          value={item.channelCode}
                        >
                          {item.channelCode} ·{" "}
                          {item.totalExecutions.toLocaleString()} exec
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <p className="text-xs text-muted-foreground">
                    Se enviará como{" "}
                    <span className="font-mono">
                      properties.channel-code
                    </span>{" "}
                    en LIVE-02 y LIVE-04.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  onClick={handleAwsInformSearch}
                  disabled={loading || !awsInformChannelCode}
                  className="h-11 rounded-xl px-5"
                >
                  <Search className="mr-2 h-4 w-4" />
                  {loading ? "Generando..." : "Generar informe AWS"}
                </Button>

                <div className="flex h-11 items-center rounded-xl border border-border bg-muted/20 px-4 text-xs text-muted-foreground">
                  Consulta comparativa en LIVE-02 y LIVE-04
                  {awsInformChannelCode
                    ? ` · Canal ${awsInformChannelCode}`
                    : ""}
                </div>
              </div>
            </section>

            {awsInformResult ? (
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleExportAwsInformCsv("metrics")}
                  className="h-10 rounded-xl"
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV métricas
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleExportAwsInformCsv("traces")}
                  className="h-10 rounded-xl"
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV trazas
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCopyAwsInformSheets("metrics")}
                  className="h-10 rounded-xl"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar métricas a Google Sheets
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCopyAwsInformSheets("traces")}
                  className="h-10 rounded-xl"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar trazas a Google Sheets
                </Button>
              </div>
            ) : null}

            {awsInformError && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive shadow-sm">
                {awsInformError}
              </div>
            )}

            <AwsInformCharts result={awsInformResult} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}