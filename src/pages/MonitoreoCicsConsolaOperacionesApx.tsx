import { useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Search,
  Download,
  Copy,
  ShieldAlert,
  FileWarning,
  Boxes,
  AlertTriangle,
  FolderKanban,
} from "lucide-react";
import { toast } from "sonner";

import LoadingOverlay from "@/components/LoadingOverlay";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useSessionCookie } from "@/hooks/useSessionCookie";
import {
  fetchApxCicsConsola,
  type ApxConsoleEnvironment,
  type ApxCicsConsolaResult,
  type CicsDetailRow,
  type CicsIncidentGroup,
} from "@/services/apxCicsConsolaService";

type ActiveTab = "detalle" | "informe";

const ENVIRONMENTS: ApxConsoleEnvironment[] = [
  "DEV",
  "INT",
  "OCTA",
  "AUS",
  "PROD",
];

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildDetalleCsv(rows: CicsDetailRow[]): string {
  const headers = ["UUAA", "Key", "Value", "Estatus", "Motivos"];

  const data = rows.map((row) => [
    row.uuaa,
    row.key,
    row.value,
    row.incidente ? "incidente" : "ok",
    row.motivos.join(" | "),
  ]);

  return [headers, ...data]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildInformeCsv(rows: CicsIncidentGroup[]): string {
  const headers = [
    "UUAA",
    "Host Key",
    "Host Value",
    "Port Key",
    "Port Value",
    "Http Key",
    "Http Value",
    "Motivos",
    "Resumen",
    "Estatus",
  ];

  const data = rows.map((row) => [
    row.uuaa,
    row.hostKey,
    row.hostValue,
    row.portKey,
    row.portValue,
    row.httpKey,
    row.httpValue,
    row.motivos.join(" | "),
    row.resumenMotivos,
    row.incidente ? "incidente" : "ok",
  ]);

  return [headers, ...data]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildDetalleSheetsText(rows: CicsDetailRow[]): string {
  const headers = ["UUAA", "Key", "Value", "Estatus", "Motivos"];
  const data = rows.map((row) => [
    row.uuaa,
    row.key,
    row.value,
    row.incidente ? "incidente" : "ok",
    row.motivos.join(" | "),
  ]);
  return [headers, ...data].map((row) => row.join("\t")).join("\n");
}

function buildInformeSheetsText(rows: CicsIncidentGroup[]): string {
  const headers = [
    "UUAA",
    "Host Key",
    "Host Value",
    "Port Key",
    "Port Value",
    "Http Key",
    "Http Value",
    "Motivos",
    "Resumen",
    "Estatus",
  ];

  const data = rows.map((row) => [
    row.uuaa,
    row.hostKey,
    row.hostValue,
    row.portKey,
    row.portValue,
    row.httpKey,
    row.httpValue,
    row.motivos.join(" | "),
    row.resumenMotivos,
    row.incidente ? "incidente" : "ok",
  ]);

  return [headers, ...data].map((row) => row.join("\t")).join("\n");
}

export default function MonitoreoCicsConsolaOperacionesApx() {
  const { sessionCookie, setSessionCookie } = useSessionCookie();

  const [showCookie, setShowCookie] = useState(false);
  const [environment, setEnvironment] = useState<ApxConsoleEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApxCicsConsolaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("detalle");

  const filteredDetalleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = result?.detailRows ?? [];

    if (!q) return rows;

    return rows.filter((row) =>
      [
        row.uuaa,
        row.key,
        row.value,
        row.incidente ? "incidente" : "ok",
        row.motivos.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [result, search]);

  const filteredInformeRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = result?.incidentGroups ?? [];

    if (!q) return rows;

    return rows.filter((row) =>
      [
        row.uuaa,
        row.hostKey,
        row.hostValue,
        row.portKey,
        row.portValue,
        row.httpKey,
        row.httpValue,
        row.motivos.join(" "),
        row.resumenMotivos,
        row.incidente ? "incidente" : "ok",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [result, search]);

  const totalUuaas = useMemo(() => {
    return new Set((result?.detailRows ?? []).map((row) => row.uuaa)).size;
  }, [result]);

  const handleSearch = async () => {
    if (!sessionCookie.trim()) {
      toast.error("La cookie de sesión es requerida.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchApxCicsConsola({
        environment,
        sessionCookie: sessionCookie.trim(),
      });

      setResult(data);
      toast.success("Monitoreo CICS cargado correctamente.");
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
        : buildInformeCsv(filteredInformeRows);

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const fileName = `monitoreo_cics_consola_${environment}_${activeTab}.csv`;

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
          : buildInformeSheetsText(filteredInformeRows);

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
        <section className="rounded-3xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="space-y-2 xl:col-span-3">
              <Label className="text-xs font-medium text-muted-foreground">
                Cookie de sesión
              </Label>
              <div className="relative">
                <Input
                  type={showCookie ? "text" : "password"}
                  placeholder="Pega aquí la cookie de sesión"
                  className="h-11 rounded-2xl pr-10 font-mono text-xs"
                  value={sessionCookie}
                  onChange={(e) => setSessionCookie(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowCookie((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showCookie ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Entorno
              </Label>
              <Select
                value={environment}
                onValueChange={(value) =>
                  setEnvironment(value as ApxConsoleEnvironment)
                }
              >
                <SelectTrigger className="h-11 rounded-2xl font-mono text-xs">
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

            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Buscar en tabla
              </Label>
              <Input
                type="text"
                placeholder="Buscar UUAA, key, value o motivos..."
                className="h-11 rounded-2xl font-mono text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={handleSearch}
              disabled={loading}
              className="h-11 rounded-2xl px-5"
            >
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Consultando..." : "Consultar CICS"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={!result}
              className="h-11 rounded-2xl px-5"
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopySheets}
              disabled={!result}
              className="h-11 rounded-2xl px-5"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar para Google Sheets
            </Button>
          </div>
        </section>

        {error && (
          <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive shadow-sm">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-muted-foreground">
                Total registros CICS
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? filteredDetalleRows.length.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-destructive" />
              <span className="text-xs font-medium text-muted-foreground">
                UUAAs con incidente
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? filteredInformeRows.length.toLocaleString() : "0"}
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">
                Total UUAAs detectadas
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {result ? totalUuaas.toLocaleString() : "0"}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border/70 bg-card/95 shadow-sm">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">
              Monitoreo CICS Consola de Operaciones APX
            </h2>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as ActiveTab)}
            className="w-full"
          >
            <div className="px-5 pt-4">
              <TabsList className="border border-border bg-card">
                <TabsTrigger value="detalle" className="text-xs">
                  Detalle ({filteredDetalleRows.length})
                </TabsTrigger>
                <TabsTrigger value="informe" className="text-xs">
                  Informe ({filteredInformeRows.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="detalle" className="mt-0">
              <div className="overflow-auto max-h-[78vh]">
                <table className="w-full min-w-[1380px] text-left text-sm">
                  <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                    <tr className="border-b border-border/70">
                      <th className="min-w-[180px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        UUAA
                      </th>
                      <th className="min-w-[420px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Key
                      </th>
                      <th className="min-w-[280px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Value
                      </th>
                      <th className="min-w-[140px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Estatus
                      </th>
                      <th className="min-w-[320px] px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Motivos
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredDetalleRows.map((row, idx) => (
                      <tr
                        key={`${row.uuaa}-${row.key}-${idx}`}
                        className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                      >
                        <td className="px-4 py-4 font-mono font-semibold">
                          {row.uuaa}
                        </td>
                        <td className="px-4 py-4 font-mono break-all">
                          {row.key}
                        </td>
                        <td className="px-4 py-4 font-mono break-all">
                          {row.value}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={
                              row.incidente
                                ? "inline-flex rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive"
                                : "inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600"
                            }
                          >
                            {row.incidente ? "incidente" : "ok"}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          {row.motivos.length ? (
                            <div className="flex flex-wrap gap-2">
                              {row.motivos.map((motivo) => (
                                <span
                                  key={`${row.key}-${motivo}`}
                                  className="inline-flex rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-700"
                                >
                                  {motivo}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    ))}

                    {!filteredDetalleRows.length && (
                      <tr>
                        <td
                          colSpan={5}
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
              <div className="space-y-5 p-5">
                {filteredInformeRows.map((row) => (
                  <article
                    key={row.uuaa}
                    className="overflow-hidden rounded-3xl border border-destructive/20 bg-gradient-to-br from-card to-destructive/5 shadow-sm"
                  >
                    <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/40 px-5 py-4 md:flex-row md:items-center md:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                          <FolderKanban className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            UUAA
                          </div>
                          <div className="font-mono text-lg font-bold text-foreground">
                            {row.uuaa}
                          </div>
                        </div>
                      </div>

                      <span className="inline-flex w-fit items-center rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
                        <AlertTriangle className="mr-2 h-3.5 w-3.5" />
                        incidente detectado
                      </span>
                    </div>

                    <div className="grid gap-4 p-5 lg:grid-cols-3">
                      <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Host
                        </div>
                        <div className="mb-2 font-mono text-[11px] break-all text-muted-foreground">
                          {row.hostKey}
                        </div>
                        <div className="font-mono text-sm font-semibold break-all text-foreground">
                          {row.hostValue}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Port
                        </div>
                        <div className="mb-2 font-mono text-[11px] break-all text-muted-foreground">
                          {row.portKey}
                        </div>
                        <div className="font-mono text-sm font-semibold break-all text-foreground">
                          {row.portValue}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Http
                        </div>
                        <div className="mb-2 font-mono text-[11px] break-all text-muted-foreground">
                          {row.httpKey}
                        </div>
                        <div className="font-mono text-sm font-semibold break-all text-foreground">
                          {row.httpValue}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-border/60 px-5 py-5">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Resumen de motivos
                      </div>

                      <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                        <div className="mb-3 font-mono text-sm font-semibold text-foreground">
                          {row.resumenMotivos}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {row.motivos.map((motivo) => (
                            <span
                              key={`${row.uuaa}-${motivo}`}
                              className="inline-flex rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive"
                            >
                              {motivo}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}

                {!filteredInformeRows.length && (
                  <div className="rounded-3xl border border-border/70 bg-card/95 px-6 py-12 text-center text-sm text-muted-foreground shadow-sm">
                    {result
                      ? "No hay UUAAs con incidente para mostrar."
                      : "Ejecuta una consulta para ver el informe."}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </main>
    </div>
  );
}