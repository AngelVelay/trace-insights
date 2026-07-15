import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, startOfDay, subDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  CalendarRange,
  Copy,
  Download,
  Eye,
  EyeOff,
  Play,
  RefreshCw,
  Search,
  LineChart as LineChartIcon,
  X,
  ChevronDown,
  Check,
} from "lucide-react";
import { toast } from "sonner";
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

import DateTimePicker from "@/components/DateTimePicker";
import LoadingOverlay from "@/components/LoadingOverlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useBearerToken } from "@/hooks/useBearerToken";
import {
  fetchAwsWeeklyReport,
  parseAwsWeeklyTransactions,
  type AwsWeeklyMetric,
  type AwsWeeklyPreset,
  type AwsWeeklyResult,
} from "@/services/awsWeeklyReportService";

function defaultToDate(): Date {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date;
}

function defaultFromDate(): Date {
  const date = subDays(defaultToDate(), 6);
  date.setHours(0, 0, 0, 0);
  return date;
}

function applyPreset(preset: AwsWeeklyPreset, anchorDate: Date): { from: Date; to: Date } {
  const to = new Date(anchorDate);
  to.setHours(23, 59, 59, 999);

  const days = preset === "day" ? 0 : preset === "week" ? 6 : preset === "fortnight" ? 14 : 29;
  return { from: subDays(startOfDay(to), days), to };
}

function metricLabel(metric: AwsWeeklyMetric): string {
  if (metric === "executions") return "Ejecuciones";
  if (metric === "responseTime") return "Tiempos de respuesta";
  return "Errores";
}

function formatCellValue(metric: AwsWeeklyMetric, value: number): string {
  if (metric === "responseTime") {
    return `${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ms`;
  }
  return value.toLocaleString("es-MX", { maximumFractionDigits: 0 });
}

function getTrendClass(metric: AwsWeeklyMetric, current: number, previous?: number): string {
  if (previous === undefined || current === previous) {
    return "bg-[#101d2b] text-slate-100";
  }

  const improved = current > previous;
  return improved
    ? "bg-emerald-950/80 text-emerald-200 ring-1 ring-inset ring-emerald-700"
    : "bg-rose-950/80 text-rose-200 ring-1 ring-inset ring-rose-700";
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

type DateHeader = {
  date: string;
  year: string;
  month: string;
  week: string;
  day: string;
};

function buildDateHeaders(dates: string[]): DateHeader[] {
  return dates.map((date) => {
    const value = new Date(`${date}T12:00:00`);
    return {
      date,
      year: format(value, "yyyy"),
      month: capitalize(format(value, "MMMM", { locale: es })),
      week: String(Math.ceil(value.getDate() / 7)),
      day: format(value, "dd/MM"),
    };
  });
}

function groupConsecutive(headers: DateHeader[], key: "year" | "month" | "week") {
  const groups: Array<{ label: string; count: number }> = [];
  for (const header of headers) {
    const label = header[key];
    const last = groups[groups.length - 1];
    if (last?.label === label) last.count += 1;
    else groups.push({ label, count: 1 });
  }
  return groups;
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildExportMatrix(
  result: AwsWeeklyResult,
  metric: AwsWeeklyMetric,
  includeReference = false,
): string[][] {
  const headers = buildDateHeaders(result.dates);
  const reference = buildDateHeaders([result.referenceDate])[0];
  const prefix = includeReference
    ? {
        year: ["Referencia"],
        month: [reference?.month ?? "Referencia"],
        week: [reference?.week ?? "Anterior"],
        day: [reference?.day ?? "Anterior"],
      }
    : { year: [], month: [], week: [], day: [] };

  return [
    ["Año", ...prefix.year, ...headers.map((item) => item.year)],
    ["Mes", ...prefix.month, ...headers.map((item) => item.month)],
    ["Semana", ...prefix.week, ...headers.map((item) => item.week)],
    ["Fecha", ...prefix.day, ...headers.map((item) => item.day)],
    ...result.rows.map((row) => [
      row.trx,
      ...(includeReference ? [String(row.byDate[result.referenceDate]?.[metric] ?? 0)] : []),
      ...result.dates.map((date) => String(row.byDate[date]?.[metric] ?? 0)),
    ]),
  ];
}

function downloadCsv(result: AwsWeeklyResult, metric: AwsWeeklyMetric) {
  const csv = buildExportMatrix(result, metric)
    .map((row) => row.map(escapeCsv).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aws_reporte_semanal_${metric}_${format(new Date(), "yyyyMMdd_HHmm")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}


function MetricChart({
  result,
  metric,
  selectedTrx,
}: {
  result: AwsWeeklyResult;
  metric: AwsWeeklyMetric;
  selectedTrx: string;
}) {
  const rows = selectedTrx
    ? result.rows.filter((row) => row.trx === selectedTrx)
    : result.rows;

  const chartData = result.dates.map((date) => {
    const point: Record<string, string | number> = {
      date,
      label: format(new Date(`${date}T12:00:00`), "dd/MM"),
    };

    for (const row of rows) {
      point[row.trx] = row.byDate[date]?.[metric] ?? 0;
    }

    return point;
  });

  if (!rows.length) {
    return (
      <div className="p-10 text-center text-slate-400">
        No se encontró información para la TRX seleccionada.
      </div>
    );
  }

  const tooltipFormatter = (
    value: number | string,
    name: string,
  ): [string, string] => [
    formatCellValue(metric, Number(value ?? 0)),
    `${name} · ${metricLabel(metric)}`,
  ];

  return (
    <div className="rounded-2xl border border-[#146384]/60 bg-gradient-to-br from-[#08131f] via-[#0b1622] to-[#10283a] p-4 shadow-2xl">
      <div className="h-[460px] min-w-[900px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 20, right: 28, left: 16, bottom: 24 }}>
            <CartesianGrid stroke="#29475a" strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#a8c4d4", fontSize: 11 }}
              axisLine={{ stroke: "#146384" }}
              tickLine={{ stroke: "#146384" }}
            />
            <YAxis
              tick={{ fill: "#a8c4d4", fontSize: 11 }}
              axisLine={{ stroke: "#146384" }}
              tickLine={{ stroke: "#146384" }}
              tickFormatter={(value) => formatCellValue(metric, Number(value))}
              width={100}
            />
            <Tooltip
              formatter={tooltipFormatter}
              labelFormatter={(label) => `Fecha: ${label}`}
              contentStyle={{
                backgroundColor: "#07111c",
                border: "1px solid #20dad8",
                borderRadius: "14px",
                boxShadow: "0 18px 50px rgba(0,0,0,.45)",
                color: "#eaf7ff",
              }}
              labelStyle={{ color: "#20dad8", fontWeight: 700 }}
              itemStyle={{ color: "#eaf7ff" }}
            />
            <Legend
              wrapperStyle={{
                color: "#d5e5ed",
                fontSize: "11px",
                paddingTop: "14px",
              }}
            />
            {rows.map((row, index) => (
              <Line
                key={row.trx}
                type="monotone"
                dataKey={row.trx}
                name={row.trx}
                stroke={`hsl(${(index * 47 + 188) % 360} 78% 58%)`}
                strokeWidth={selectedTrx ? 3.5 : 2}
                dot={selectedTrx ? { r: 4, strokeWidth: 2 } : false}
                activeDot={{ r: 7, stroke: "#ffffff", strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function AwsReporteSemanal() {
  const { bearerToken, setBearerToken } = useBearerToken();
  const initialToken = useRef(bearerToken.trim());
  const autoLoaded = useRef(false);

  const [showToken, setShowToken] = useState(false);
  const [site, setSite] = useState("LIVE-04");
  const [preset, setPreset] = useState<AwsWeeklyPreset>("week");
  const [anchorDate, setAnchorDate] = useState(defaultToDate);
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(defaultToDate);
  const [transactionsText, setTransactionsText] = useState("");
  const [metric, setMetric] = useState<AwsWeeklyMetric>("executions");
  const [loading, setLoading] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressValue, setProgressValue] = useState(0);
  const [result, setResult] = useState<AwsWeeklyResult | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [chartQuery, setChartQuery] = useState("");
  const [selectedChartTrx, setSelectedChartTrx] = useState("");
  const [chartSelectorOpen, setChartSelectorOpen] = useState(false);

  const transactions = useMemo(
    () => parseAwsWeeklyTransactions(transactionsText),
    [transactionsText],
  );

  const chartTrxOptions = useMemo(() => {
    const query = chartQuery.trim().toUpperCase();
    const rows = result?.rows ?? [];
    return query ? rows.filter((row) => row.trx.includes(query)) : rows;
  }, [chartQuery, result]);

  const dateHeaders = useMemo(() => buildDateHeaders(result?.dates ?? []), [result]);
  const yearGroups = useMemo(() => groupConsecutive(dateHeaders, "year"), [dateHeaders]);
  const monthGroups = useMemo(() => groupConsecutive(dateHeaders, "month"), [dateHeaders]);
  const weekGroups = useMemo(() => groupConsecutive(dateHeaders, "week"), [dateHeaders]);

  const handlePresetChange = (value: AwsWeeklyPreset) => {
    setPreset(value);
    if (value === "custom") return;
    const next = applyPreset(value, anchorDate);
    setFromDate(next.from);
    setToDate(next.to);
  };

  const handleAnchorDateChange = (date: Date) => {
    setAnchorDate(date);
    if (preset === "custom") return;
    const next = applyPreset(preset, date);
    setFromDate(next.from);
    setToDate(next.to);
  };

  const runQuery = useCallback(
    async (discoverTransactions: boolean, tokenOverride?: string) => {
      const token = (tokenOverride ?? bearerToken).trim();
      if (!token) {
        toast.error("Bearer Token es requerido.");
        return;
      }

      setLoading(true);
      setProgressText("Preparando consulta...");
      setProgressValue(2);

      try {
        const data = await fetchAwsWeeklyReport({
          fromDate,
          toDate,
          bearerToken: token,
          site,
          transactions: discoverTransactions ? [] : transactions,
          discoverTransactions,
          onProgress: (message, percent) => {
            setProgressText(message);
            setProgressValue(percent);
          },
        });

        setResult(data);
        if (data.discoveredTransactions.length) {
          setTransactionsText(data.discoveredTransactions.join("\n"));
        }
        toast.success(`Reporte generado: ${data.rows.length} TRX.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Error generando reporte.");
      } finally {
        setLoading(false);
        setProgressText("");
        setProgressValue(0);
      }
    },
    [bearerToken, fromDate, site, toDate, transactions],
  );

  useEffect(() => {
    if (autoLoaded.current || !initialToken.current) return;
    autoLoaded.current = true;
    void runQuery(true, initialToken.current);
  }, [runQuery]);

  useEffect(() => {
    if (!selectedChartTrx) return;
    const exists = result?.rows.some((row) => row.trx === selectedChartTrx);
    if (!exists) setSelectedChartTrx("");
  }, [result, selectedChartTrx]);

  const handleCopySheets = async () => {
    if (!result) return;
    try {
      const text = buildExportMatrix(result, metric, true).map((row) => row.join("\t")).join("\n");
      await navigator.clipboard.writeText(text);
      toast.success("Tabla copiada. Ya puedes pegarla en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar la tabla al portapapeles.");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
      <LoadingOverlay show={loading} progressText={progressText} progressValue={progressValue} />

      <section className="rounded-3xl border border-border/70 bg-card/95 p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <CalendarRange className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">AWS Reporte Semanal</h1>
            <p className="text-sm text-muted-foreground">
              Cronograma diario por TRX con ejecuciones, tiempos de respuesta y errores.
            </p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-4">
          <div className="space-y-2 xl:col-span-4">
            <Label>Bearer Token</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={bearerToken}
                onChange={(event) => setBearerToken(event.target.value)}
                className="h-11 rounded-xl pr-10 font-mono text-xs"
                placeholder="Pega aquí el Bearer Token de Atenea"
              />
              <button
                type="button"
                onClick={() => setShowToken((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Site</Label>
            <Select value={site} onValueChange={setSite}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="LIVE-02">LIVE-02</SelectItem>
                <SelectItem value="LIVE-04">LIVE-04</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Rango rápido</Label>
            <Select value={preset} onValueChange={(value) => handlePresetChange(value as AwsWeeklyPreset)}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Un día</SelectItem>
                <SelectItem value="week">Una semana</SelectItem>
                <SelectItem value="fortnight">Una quincena</SelectItem>
                <SelectItem value="month">Un mes</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 xl:col-span-2">
            <Label>Fecha de referencia</Label>
            <DateTimePicker value={anchorDate} onChange={handleAnchorDateChange} disabled={preset === "custom"} />
          </div>

          <div className="space-y-2 xl:col-span-2">
            <Label>Desde</Label>
            <DateTimePicker value={fromDate} onChange={setFromDate} disabled={preset !== "custom"} />
          </div>

          <div className="space-y-2 xl:col-span-2">
            <Label>Hasta</Label>
            <DateTimePicker value={toDate} onChange={setToDate} disabled={preset !== "custom"} />
          </div>

          <div className="space-y-2 xl:col-span-4">
            <div className="flex items-center justify-between gap-3">
              <Label>TRX ejecutadas durante el último mes</Label>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                {transactions.length} TRX
              </span>
            </div>
            <Textarea
              value={transactionsText}
              onChange={(event) => setTransactionsText(event.target.value.toUpperCase())}
              className="min-h-[190px] rounded-xl font-mono text-xs"
              placeholder="El listado se cargará automáticamente si ya existe un Bearer Token guardado."
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={() => runQuery(false)} disabled={loading || !transactions.length} className="h-11 rounded-xl">
            <Play className="mr-2 h-4 w-4" />
            Generar cronograma
          </Button>
          <Button variant="outline" onClick={() => runQuery(true)} disabled={loading} className="h-11 rounded-xl">
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizar TRX del último mes
          </Button>
          <Button
            variant="outline"
            onClick={() => result && downloadCsv(result, metric)}
            disabled={!result}
            className="h-11 rounded-xl"
          >
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
          <Button variant="outline" onClick={handleCopySheets} disabled={!result} className="h-11 rounded-xl">
            <Copy className="mr-2 h-4 w-4" />
            Copiar para Google Sheets
          </Button>
          <Button variant={showChart ? "default" : "outline"} onClick={() => setShowChart((value) => !value)} disabled={!result} className="h-11 rounded-xl">
            <LineChartIcon className="mr-2 h-4 w-4" />
            Gráfica
          </Button>
        </div>
      </section>


      {showChart && result && (
        <section className="rounded-3xl border border-[#146384]/60 bg-[#0b1622] p-5 text-slate-100 shadow-2xl">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-semibold">Comportamiento de {metricLabel(metric)}</h2>
              <p className="text-xs text-slate-400">Sin búsqueda se muestran todas las TRX. Escribe una TRX para aislar su comportamiento.</p>
            </div>
            <div className="relative w-full lg:w-[460px]">
              <button
                type="button"
                onClick={() => setChartSelectorOpen((value) => !value)}
                className="flex h-11 w-full items-center justify-between rounded-xl border border-[#29475a] bg-[#08131f] px-3 text-left text-sm text-slate-100 shadow-inner"
              >
                <span className="truncate font-mono text-xs">
                  {selectedChartTrx || "Todas las TRX"}
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition ${chartSelectorOpen ? "rotate-180" : ""}`} />
              </button>

              {chartSelectorOpen && (
                <div className="absolute right-0 top-12 z-50 w-full overflow-hidden rounded-2xl border border-[#20dad8]/60 bg-[#07111c] shadow-2xl">
                  <div className="relative border-b border-[#29475a] p-3">
                    <Search className="absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      autoFocus
                      value={chartQuery}
                      onChange={(event) => setChartQuery(event.target.value.toUpperCase())}
                      placeholder="Buscar dentro del listado..."
                      className="border-[#29475a] bg-[#0b1622] pl-10 pr-10 font-mono text-xs text-slate-100"
                    />
                    {chartQuery && (
                      <button
                        type="button"
                        onClick={() => setChartQuery("")}
                        className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedChartTrx("");
                        setChartSelectorOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-200 hover:bg-[#122e41]"
                    >
                      <span>Todas las TRX</span>
                      {!selectedChartTrx && <Check className="h-4 w-4 text-[#20dad8]" />}
                    </button>

                    {chartTrxOptions.map((row) => (
                      <button
                        key={row.trx}
                        type="button"
                        onClick={() => {
                          setSelectedChartTrx(row.trx);
                          setChartSelectorOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left font-mono text-xs text-slate-200 hover:bg-[#122e41]"
                      >
                        <span>{row.trx}</span>
                        {selectedChartTrx === row.trx && <Check className="h-4 w-4 text-[#20dad8]" />}
                      </button>
                    ))}

                    {!chartTrxOptions.length && (
                      <div className="px-3 py-8 text-center text-xs text-slate-400">
                        No se encontraron TRX.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <MetricChart result={result} metric={metric} selectedTrx={selectedChartTrx} />
        </section>
      )}

      <section className="overflow-hidden rounded-3xl border border-[#146384]/60 bg-[#0b1622] text-slate-100 shadow-2xl">
        <div className="flex flex-col gap-4 border-b border-[#146384]/60 bg-[#122e41] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold">Cronograma de {metricLabel(metric)}</h2>
            <p className="text-xs text-muted-foreground">
              Incremento: verde. Decremento: rojo en las tres métricas. El valor cero sí participa. La primera columna se compara contra el día anterior, consultado pero no mostrado. La semana corresponde al número de semana dentro del mes.
            </p>
          </div>
          <Tabs value={metric} onValueChange={(value) => setMetric(value as AwsWeeklyMetric)}>
            <TabsList className="h-11 rounded-xl border border-[#146384] bg-[#0b1622] text-slate-300">
              <TabsTrigger value="executions">Ejecuciones</TabsTrigger>
              <TabsTrigger value="responseTime">Tiempos</TabsTrigger>
              <TabsTrigger value="errors">Errores</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-30">
              <tr>
                <th className="sticky left-0 top-0 z-50 w-[220px] min-w-[220px] border-b border-r border-[#20dad8]/40 bg-[#122e41] px-4 py-2 text-center font-bold text-white">Año</th>
                {yearGroups.map((group, index) => (
                  <th key={`year-${group.label}-${index}`} colSpan={group.count} className="border-b border-r border-[#146384] bg-[#146384] px-3 py-2 text-center font-bold text-white">
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-50 border-b border-r border-[#20dad8]/40 bg-[#122e41] px-4 py-2 text-center font-bold text-white">Mes</th>
                {monthGroups.map((group, index) => (
                  <th key={`month-${group.label}-${index}`} colSpan={group.count} className={`border-b border-r border-[#146384] px-3 py-2 text-center font-bold text-[#20dad8] ${index % 2 === 0 ? "bg-[#122e41]" : "bg-[#173f56]"}`}>
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-50 border-b border-r border-[#20dad8]/40 bg-[#122e41] px-4 py-2 text-center font-bold text-white">Semana</th>
                {weekGroups.map((group, index) => (
                  <th key={`week-${group.label}-${index}`} colSpan={group.count} className={`border-b border-r border-[#146384] px-3 py-2 text-center font-bold text-sky-100 ${index % 2 === 0 ? "bg-[#0f3f57]" : "bg-[#14546f]"}`}>
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-50 border-b-4 border-r border-[#20dad8]/50 bg-[#122e41] px-4 py-2 text-center font-bold text-white">Fecha</th>
                {dateHeaders.map((header) => (
                  <th key={header.date} className={`min-w-[150px] border-b-4 border-r border-[#20dad8]/40 bg-[#101d2b] px-3 py-2 text-center font-semibold text-slate-100 ${dateHeaders.findIndex((item) => item.date === header.date) > 0 && header.month !== dateHeaders[dateHeaders.findIndex((item) => item.date === header.date) - 1].month ? "border-l-4 border-l-amber-400" : dateHeaders.findIndex((item) => item.date === header.date) > 0 && header.week !== dateHeaders[dateHeaders.findIndex((item) => item.date === header.date) - 1].week ? "border-l-2 border-l-cyan-400" : ""}`}>
                    {header.day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(result?.rows ?? []).map((row, rowIndex) => (
                <tr key={row.trx} className={rowIndex % 2 ? "bg-[#0f2232]" : "bg-[#0b1622]"}>
                  <td className="sticky left-0 z-20 border-b border-r border-[#146384]/60 bg-inherit px-4 py-3 font-mono font-semibold text-slate-100">
                    {row.trx}
                  </td>
                  {(result?.dates ?? []).map((date, dateIndex) => {
                    const value = row.byDate[date]?.[metric] ?? 0;
                    const previousDate = dateIndex > 0
                      ? result!.dates[dateIndex - 1]
                      : result!.referenceDate;
                    const previous = row.byDate[previousDate]?.[metric];

                    return (
                      <td
                        key={`${row.trx}-${date}`}
                        className={`border-b border-r border-[#146384]/60 px-4 py-3 text-center font-mono text-xs font-semibold ${dateIndex > 0 && dateHeaders[dateIndex].month !== dateHeaders[dateIndex - 1].month ? "border-l-4 border-l-amber-400" : dateIndex > 0 && dateHeaders[dateIndex].week !== dateHeaders[dateIndex - 1].week ? "border-l-2 border-l-cyan-400" : ""} ${getTrendClass(metric, value, previous)}`}
                        title={previous === undefined ? "Sin referencia anterior" : `Referencia ${previousDate}: ${formatCellValue(metric, previous)}`}
                      >
                        {formatCellValue(metric, value)}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {!result?.rows.length && (
                <tr>
                  <td colSpan={Math.max(2, dateHeaders.length + 1)} className="px-6 py-16 text-center text-muted-foreground">
                    {initialToken.current
                      ? "Cargando o esperando resultados de Atenea..."
                      : "Captura el Bearer Token y presiona “Actualizar TRX del último mes”."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
