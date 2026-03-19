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
  ];

  const data = rows.map((row) => [
    row.fechaEjecucion,
    row.invokedparam,
    row.invokerLibrary,
    row.invokerTx,
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
  ];

  const data = rows.map((row) => [
    row.fechaEjecucion,
    row.invokedparam,
    row.invokerLibrary,
    row.invokerTx,
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
    const invokedparamKey = (row.invokedparam || "-").trim().toUpperCase() || "-";

    if (!uniqueMap.has(invokedparamKey)) {
      uniqueMap.set(invokedparamKey, {
        fechaEjecucion: row.fechaEjecucion || "-",
        invokedparam: row.invokedparam || "-",
        invokerLibrary: row.invokerLibrary || "-",
        invokerTx: row.invokerTx || "-",
      });
    }
  }

  return Array.from(uniqueMap.values());
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
      toast.error("No hay informe para descargar.");
      return;
    }

    const csv =
      activeTab === "detalle"
        ? buildDetalleCsv(filteredDetalleRows)
        : buildInformeCsv(informeRows);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const fileName = `monitoreo_securizacion_live_${activeTab}_${format(
      new Date(),
      "yyyy-MM-dd_HH-mm-ss"
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
      const text =
        activeTab === "detalle"
          ? buildDetalleSheetsText(filteredDetalleRows)
          : buildInformeSheetsText(informeRows);

      await navigator.clipboard.writeText(text);
      toast.success("Informe copiado. Ya puedes pegarlo en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <LoadingOverlay show={loading} />

      <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
        <section className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-2 xl:col-span-3">
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
                    {fromDate ? format(fromDate, "dd/MM/yyyy") : "Selecciona fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto rounded-xl p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={(d) => d && setFromDate(setStartOfDay(d))}
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
                    onSelect={(d) => d && setToDate(setEndOfDay(d))}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Buscar en tabla
              </Label>
              <Input
                type="text"
                placeholder="Buscar error, invokerTx, library..."
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
                Total registros detalle
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
                Transacciones HOST Securizadas
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
            <div className="mt-3 font-mono text-sm font-bold leading-6">
              {result ? `${result.fromDate} → ${result.toDate}` : "-"}
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
            onValueChange={(value) => setActiveTab(value as "detalle" | "informe")}
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
                <table className="w-max min-w-[1700px] text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border/70">
                      <th className="min-w-[180px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Fecha de ejecución
                      </th>
                      <th className="min-w-[520px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Error Message
                      </th>
                      <th className="min-w-[140px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        UUAA
                      </th>
                      <th className="min-w-[220px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        TRX Host
                      </th>
                      <th className="min-w-[180px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Libreria
                      </th>
                      <th className="min-w-[170px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Transaccion APX
                      </th>
                      <th className="min-w-[280px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        SpanId
                      </th>
                      <th className="min-w-[280px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                        <td className="px-4 py-4">
                          <div className="max-w-[500px] whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {row.errorMessage}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 font-mono font-semibold">
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
                          colSpan={8}
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
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border/70">
                      <th className="min-w-[180px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Fecha de ejecución
                      </th>
                      <th className="min-w-[260px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        TRX Host
                      </th>
                      <th className="min-w-[220px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Libreria
                      </th>
                      <th className="min-w-[200px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Transacción APX
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {informeRows.map((row, idx) => (
                      <tr
                        key={`${row.fechaEjecucion}-${row.invokedparam}-${row.invokerLibrary}-${row.invokerTx}-${idx}`}
                        className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                      >
                        <td className="whitespace-nowrap px-4 py-4 font-medium">
                          {row.fechaEjecucion}
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
                          colSpan={4}
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