import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Eye,
  EyeOff,
  CalendarIcon,
  Search,
  Download,
  Copy,
  ShieldAlert,
  FileWarning,
  Boxes,
} from "lucide-react";

import { useBearerToken } from "@/hooks/useBearerToken";
import LoadingOverlay from "@/components/LoadingOverlay";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import {
  fetchSecurizacionLive,
  type SecurizacionLiveResult,
  type SecurizacionLiveRow,
} from "@/services/securizacionLiveService";

type InformeRow = {
  fechaEjecucion: string;
  invokedparam: string;
  invokerLibrary: string;
  invokerTx: string;
  aap: string;
  aapName: string;
  channelCode: string;
};

function setStartOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function setEndOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildDetalleCsv(rows: SecurizacionLiveRow[]): string {
  const headers = [
    "Fecha de ejecucion",
    "Error Message",
    "Application UUAA",
    "InvokedParam",
    "InvokerLibrary",
    "InvokerTx",
    "AAP",
    "AAP Name",
    "Channel Code",
    "SpanId",
    "TraceId",
  ];

  const data = rows.map((row) => [
    row.fechaEjecucion,
    row.errorMessage,
    row.applicationUUAA,
    row.invokedparam,
    row.invokerLibrary,
    row.invokerTx,
    row.aap,
    row.aapName,
    row.channelCode,
    row.spanId,
    row.traceId,
  ]);

  return [headers, ...data]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildInformeCsv(rows: InformeRow[]): string {
  const headers = [
    "Fecha de ejecucion",
    "InvokedParam",
    "InvokerLibrary",
    "InvokerTx",
    "AAP",
    "AAP Name",
    "Channel Code",
  ];

  const data = rows.map((row) => [
    row.fechaEjecucion,
    row.invokedparam,
    row.invokerLibrary,
    row.invokerTx,
    row.aap,
    row.aapName,
    row.channelCode,
  ]);

  return [headers, ...data]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildDetalleSheetsText(rows: SecurizacionLiveRow[]): string {
  const headers = [
    "Fecha de ejecucion",
    "Error Message",
    "Application UUAA",
    "InvokedParam",
    "InvokerLibrary",
    "InvokerTx",
    "AAP",
    "AAP Name",
    "Channel Code",
    "SpanId",
    "TraceId",
  ];

  const data = rows.map((row) => [
    row.fechaEjecucion,
    row.errorMessage,
    row.applicationUUAA,
    row.invokedparam,
    row.invokerLibrary,
    row.invokerTx,
    row.aap,
    row.aapName,
    row.channelCode,
    row.spanId,
    row.traceId,
  ]);

  return [headers, ...data].map((row) => row.join("\t")).join("\n");
}

function buildInformeSheetsText(rows: InformeRow[]): string {
  const headers = [
    "Fecha de ejecucion",
    "InvokedParam",
    "InvokerLibrary",
    "InvokerTx",
    "AAP",
    "AAP Name",
    "Channel Code",
  ];

  const data = rows.map((row) => [
    row.fechaEjecucion,
    row.invokedparam,
    row.invokerLibrary,
    row.invokerTx,
    row.aap,
    row.aapName,
    row.channelCode,
  ]);

  return [headers, ...data].map((row) => row.join("\t")).join("\n");
}

export default function MonitoreoSecurizacionLive() {
  const { bearerToken, setBearerToken } = useBearerToken();

  const [showToken, setShowToken] = useState(false);
  const [fromDate, setFromDate] = useState<Date>(setStartOfDay(new Date()));
  const [toDate, setToDate] = useState<Date>(setEndOfDay(new Date()));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SecurizacionLiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"detalle" | "informe">("detalle");

  const filteredDetalleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = result?.rows ?? [];

    if (!q) return rows;

    return rows.filter((row) =>
      [
        row.fechaEjecucion,
        row.errorMessage,
        row.applicationUUAA,
        row.invokedparam,
        row.invokerLibrary,
        row.invokerTx,
        row.aap,
        row.aapName,
        row.channelCode,
        row.spanId,
        row.traceId,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [result, search]);

  const informeRows = useMemo(() => {
    const uniqueMap = new Map<string, InformeRow>();

    for (const row of filteredDetalleRows) {
      const key = [
        (row.invokedparam || "-").trim().toUpperCase() || "-",
        (row.aap || "-").trim().toUpperCase() || "-",
        (row.channelCode || "-").trim().toUpperCase() || "-",
      ].join("::");

      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, {
          fechaEjecucion: row.fechaEjecucion || "-",
          invokedparam: row.invokedparam || "-",
          invokerLibrary: row.invokerLibrary || "-",
          invokerTx: row.invokerTx || "-",
          aap: row.aap || "-",
          aapName: row.aapName || "-",
          channelCode: row.channelCode || "-",
        });
      }
    }

    return Array.from(uniqueMap.values()).sort((a, b) => {
      const byAap = (a.aap || "-").localeCompare(b.aap || "-");
      if (byAap !== 0) return byAap;

      const byChannel = (a.channelCode || "-").localeCompare(
        b.channelCode || "-"
      );
      if (byChannel !== 0) return byChannel;

      return (a.invokedparam || "-").localeCompare(b.invokedparam || "-");
    });
  }, [filteredDetalleRows]);

  const handleSearch = async () => {
    if (!bearerToken.trim()) {
      toast.error("Bearer Token es requerido.");
      return;
    }

    if (fromDate.getTime() > toDate.getTime()) {
      toast.error("La fecha inicio no puede ser mayor que la fecha fin.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchSecurizacionLive({
        fromDate,
        toDate,
        bearerToken: bearerToken.trim(),
      });

      setResult(data);
      toast.success("Monitoreo de securización cargado correctamente.");
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
      toast.error("No hay información para descargar.");
      return;
    }

    const csv =
      activeTab === "detalle"
        ? buildDetalleCsv(filteredDetalleRows)
        : buildInformeCsv(informeRows);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const fileName = `monitoreo_securizacion_live_${activeTab}_${format(
      fromDate,
      "yyyyMMdd_HHmm"
    )}_${format(toDate, "yyyyMMdd_HHmm")}.csv`;

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();

    URL.revokeObjectURL(url);
    toast.success("CSV descargado correctamente.");
  };

  const handleCopySheets = async () => {
    if (!result) {
      toast.error("No hay información para copiar.");
      return;
    }

    try {
      const text =
        activeTab === "detalle"
          ? buildDetalleSheetsText(filteredDetalleRows)
          : buildInformeSheetsText(informeRows);

      await navigator.clipboard.writeText(text);
      toast.success("Información copiada. Ya puedes pegarla en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <LoadingOverlay show={loading} />

      <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
        <section className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-4">
            <div className="space-y-2 xl:col-span-4">
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
                Fecha inicio
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-11 w-full justify-start rounded-xl font-mono text-xs",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate
                      ? format(fromDate, "dd/MM/yyyy")
                      : "Selecciona fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto rounded-xl p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={(date) => {
                      if (!date) return;
                      const next = new Date(date);
                      next.setHours(0, 0, 0, 0);
                      setFromDate(next);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Fecha fin
              </Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-11 w-full justify-start rounded-xl font-mono text-xs",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "dd/MM/yyyy") : "Selecciona fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto rounded-xl p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={(date) => {
                      if (!date) return;
                      const next = new Date(date);
                      next.setHours(23, 59, 59, 999);
                      setToDate(next);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Buscar en tabla
              </Label>
              <Input
                type="text"
                placeholder="Buscar por error, invokedparam, aap, nombre aap, channel code..."
                className="h-11 rounded-xl font-mono text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={handleSearch}
              disabled={loading}
              className="h-11 rounded-xl px-5"
            >
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Consultando..." : "Consultar securización"}
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
        </section>

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">
                Total registros
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? filteredDetalleRows.length.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-destructive" />
              <span className="text-xs font-medium text-muted-foreground">
                Registros únicos informe
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? informeRows.length.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">
                Rango consultado
              </span>
            </div>
            <div className="mt-3 text-sm font-medium">
              {result ? `${result.fromDate} - ${result.toDate}` : "-"}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/95 shadow-sm">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">
              Monitoreo Securización LIVE
            </h2>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "detalle" | "informe")
            }
            className="w-full"
          >
            <div className="px-5 pt-4">
              <TabsList className="border border-border bg-card">
                <TabsTrigger value="detalle" className="text-xs">
                  Detalle ({filteredDetalleRows.length})
                </TabsTrigger>
                <TabsTrigger value="informe" className="text-xs">
                  Informe ({informeRows.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="detalle" className="mt-0">
              <div className="overflow-auto max-h-[78vh]">
                <table className="w-full min-w-[2200px] text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border/70">
                      <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Fecha de ejecución
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Error Message
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Application UUAA
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        InvokedParam
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        InvokerLibrary
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        InvokerTx
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        AAP
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Nombre AAP
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Channel Code
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        SpanId
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        TraceId
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredDetalleRows.map((row, idx) => (
                      <tr
                        key={`${row.spanId}-${row.traceId}-${idx}`}
                        className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap px-4 py-4 font-medium">
                          {row.fechaEjecucion}
                        </td>

                        <td className="max-w-[460px] px-4 py-4">
                          <div className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
                            {row.errorMessage}
                          </div>
                        </td>

                        <td className="px-4 py-4 font-mono break-all">
                          {row.applicationUUAA}
                        </td>

                        <td className="px-4 py-4 font-mono break-all">
                          {row.invokedparam}
                        </td>

                        <td className="px-4 py-4 font-mono break-all">
                          {row.invokerLibrary}
                        </td>

                        <td className="px-4 py-4 font-mono font-semibold break-all">
                          {row.invokerTx}
                        </td>

                        <td className="px-4 py-4">
                          <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 font-mono text-xs font-semibold text-primary">
                            {row.aap}
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <div className="max-w-[280px] break-words text-sm">
                            {row.aapName}
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 font-mono text-xs font-semibold text-emerald-600">
                            {row.channelCode}
                          </span>
                        </td>

                        <td className="px-4 py-4 font-mono break-all text-xs">
                          {row.spanId}
                        </td>

                        <td className="px-4 py-4 font-mono break-all text-xs">
                          {row.traceId}
                        </td>
                      </tr>
                    ))}

                    {!filteredDetalleRows.length && (
                      <tr>
                        <td
                          colSpan={11}
                          className="px-6 py-12 text-center text-sm text-muted-foreground"
                        >
                          {result
                            ? "No hay datos para mostrar con el filtro actual."
                            : "Ejecuta una consulta para ver datos."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="informe" className="mt-0">
              <div className="overflow-auto max-h-[78vh]">
                <table className="w-full min-w-[1500px] text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border/70">
                      <th className="whitespace-nowrap px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Fecha de ejecución
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        AAP
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Nombre AAP
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Channel Code
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        InvokedParam
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        InvokerLibrary
                      </th>
                      <th className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        InvokerTx
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {informeRows.map((row, idx) => (
                      <tr
                        key={`${row.aap}-${row.channelCode}-${row.invokedparam}-${idx}`}
                        className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap px-4 py-4 font-medium">
                          {row.fechaEjecucion}
                        </td>

                        <td className="px-4 py-4">
                          <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 font-mono text-xs font-semibold text-primary">
                            {row.aap}
                          </span>
                        </td>

                        <td className="px-4 py-4">
                          <div className="max-w-[280px] break-words text-sm font-medium">
                            {row.aapName}
                          </div>
                        </td>

                        <td className="px-4 py-4">
                          <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 font-mono text-xs font-semibold text-emerald-600">
                            {row.channelCode}
                          </span>
                        </td>

                        <td className="px-4 py-4 font-mono break-all">
                          {row.invokedparam}
                        </td>

                        <td className="px-4 py-4 font-mono break-all">
                          {row.invokerLibrary}
                        </td>

                        <td className="px-4 py-4 font-mono font-semibold break-all">
                          {row.invokerTx}
                        </td>
                      </tr>
                    ))}

                    {!informeRows.length && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-6 py-12 text-center text-sm text-muted-foreground"
                        >
                          {result
                            ? "No hay datos para mostrar en el informe."
                            : "Ejecuta una consulta para ver el informe."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}