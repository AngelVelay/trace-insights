import { useMemo, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Network,
  Play,
} from "lucide-react";
import { toast } from "sonner";

import DateTimePicker from "@/components/DateTimePicker";
import { useBearerToken } from "@/hooks/useBearerToken";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import {
  fetchWorkChannelRelation,
  formatCompactExecutions,
  getConfiguredWorkAapCatalog,
  resolveWorkChannels,
  type WorkChannelRelationEnvironment,
  type WorkChannelRelationSearchResult,
} from "@/services/workChannelRelationService";

const NO_ENVIRONMENT = "__NO_ENVIRONMENT__";
const WORK_ENVIRONMENTS: WorkChannelRelationEnvironment[] = ["DEV", "INT", "AUS", "OCTA"];

function getDefaultFromDate(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 28);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getDefaultToDate(): Date {
  const date = new Date();
  date.setSeconds(0, 0);
  return date;
}

function formatExactExecutions(value: number): string {
  return Math.round(Number(value ?? 0)).toLocaleString("es-MX");
}

function getAapTableRows(
  result: WorkChannelRelationSearchResult,
): string[][] {
  const rows: string[][] = [[
    "AAP",
    "TRX",
    "TRX (Número de ejecuciones)",
  ]];

  for (const item of result.rows) {
    if (item.status === "error") {
      rows.push([
        item.aap,
        "ERROR",
        item.error ?? "Error consultando AAP",
      ]);
      continue;
    }

    if (!item.topTransactions.length) {
      rows.push([
        item.aap,
        "Sin resultados",
        "Sin resultados",
      ]);
      continue;
    }

    rows.push([
      item.aap,
      item.topTransactions.map((trx) => trx.trx).join("\n"),
      item.topTransactions
        .map(
          (trx) =>
            `${trx.trx} (${formatCompactExecutions(trx.executions)})`,
        )
        .join("\n"),
    ]);
  }

  return rows;
}

function sheetsEscape(value: unknown): string {
  const text = String(value ?? "");

  if (/["\t\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildGoogleSheetsTable(result: WorkChannelRelationSearchResult): string {
  return getAapTableRows(result)
    .map((row) => row.map(sheetsEscape).join("\t"))
    .join("\n");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildGoogleSheetsHtml(result: WorkChannelRelationSearchResult): string {
  const rows = getAapTableRows(result);

  const htmlRows = rows
    .map((row, rowIndex) => {
      const cellTag = rowIndex === 0 ? "th" : "td";
      const cells = row
        .map((cell) => {
          const value = escapeHtml(cell).replace(/\n/g, "<br>");
          return `<${cellTag}>${value}</${cellTag}>`;
        })
        .join("");

      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table>${htmlRows}</table>`;
}

function buildTextSummary(result: WorkChannelRelationSearchResult): string {
  return buildGoogleSheetsTable(result);
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildCsv(result: WorkChannelRelationSearchResult): string {
  return getAapTableRows(result)
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
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

export default function RelacionCanalesWork() {
  const { bearerToken, setBearerToken } = useBearerToken();

  const [fromDate, setFromDate] = useState<Date>(getDefaultFromDate);
  const [toDate, setToDate] = useState<Date>(getDefaultToDate);
  const [environmentValue, setEnvironmentValue] = useState<string>(NO_ENVIRONMENT);
  const [aapListText, setAapListText] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({
    completed: 0,
    total: 0,
    aap: "",
    channelCode: "",
  });
  const [result, setResult] = useState<WorkChannelRelationSearchResult | null>(null);
  const [error, setError] = useState("");

  const configuredAapCount = useMemo(() => getConfiguredWorkAapCatalog().length, []);
  const previewResolution = useMemo(
    () => resolveWorkChannels(aapListText),
    [aapListText],
  );

  const selectedEnvironment: WorkChannelRelationEnvironment | undefined =
    environmentValue === NO_ENVIRONMENT
      ? undefined
      : (environmentValue as WorkChannelRelationEnvironment);

  const aapsToRun = previewResolution.aapTargets.length;

  const progressPercent = progress.total
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  const handleSearch = async () => {
    setError("");
    setResult(null);

    if (fromDate.getTime() > toDate.getTime()) {
      setError("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }

    if (aapListText.trim() && previewResolution.aapTargets.length === 0) {
      setError("No se encontró ningún AAP de 8 dígitos en el listado pegado.");
      return;
    }

    setLoading(true);
    setProgress({ completed: 0, total: aapsToRun, aap: "", channelCode: "" });

    try {
      const response = await fetchWorkChannelRelation({
        fromDate,
        toDate,
        environment: selectedEnvironment,
        channelListText: aapListText,
        bearerToken,
        onProgress: (next) => setProgress(next),
      });

      setResult(response);

      if (response.failedAaps > 0) {
        toast.warning(
          `Consulta terminada con ${response.failedAaps} AAP con error.`,
        );
      } else {
        toast.success("Relación de canales WORK recuperada.");
      }
    } catch (searchError) {
      const message =
        searchError instanceof Error ? searchError.message : String(searchError);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;

    const plainText = buildTextSummary(result);
    const htmlText = buildGoogleSheetsHtml(result);

    try {
      if (
        typeof ClipboardItem !== "undefined" &&
        typeof navigator.clipboard.write === "function"
      ) {
        const clipboardItem = new ClipboardItem({
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          "text/html": new Blob([htmlText], { type: "text/html" }),
        });

        await navigator.clipboard.write([clipboardItem]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }

      toast.success(
        "Tabla copiada. Cada AAP queda en una sola fila con sus Top 5 TRX dentro de una celda.",
      );
    } catch {
      try {
        await navigator.clipboard.writeText(plainText);
        toast.success("Tabla copiada. Pégala directamente en Google Sheets.");
      } catch {
        toast.error("No se pudo copiar el listado.");
      }
    }
  };

  const handleCsv = () => {
    if (!result) return;
    const datePart = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `\uFEFF${buildCsv(result)}`,
      `relacion-canales-work-${datePart}.csv`,
      "text/csv",
    );
  };

  return (
    <main className="mx-auto w-full max-w-[1880px] space-y-6 px-6 py-8">
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/20 px-6 py-6">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Network className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">
                    Relación de Canales WORK
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Catálogo JSON → itera cada AAP → functional-dashboard → Top 5 TRX por ejecuciones
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="rounded-full px-3 py-1">
                WORK-02
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                functional-dashboard · aggregate: name
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                4 métricas por AAP
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
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

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Entorno WORK</Label>
                <Select
                  value={environmentValue}
                  onValueChange={setEnvironmentValue}
                  disabled={loading}
                >
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ENVIRONMENT}>
                      Sin entorno · endpoint original
                    </SelectItem>
                    {WORK_ENVIRONMENTS.map((environment) => (
                      <SelectItem key={environment} value={environment}>
                        {environment}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Sin entorno no agrega el filtro env al endpoint.
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
                  Se reutiliza el mismo token almacenado por AWS Monitoreo.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Label>Listado de AAP</Label>
                <Badge variant="outline" className="font-mono text-[10px]">
                  JSON: {configuredAapCount} AAP
                </Badge>
                <Badge
                  variant={aapListText.trim() ? "default" : "secondary"}
                  className="font-mono text-[10px]"
                >
                  Fuente: {aapListText.trim() ? "CUADRO DE TEXTO" : "JSON"}
                </Badge>
              </div>
              <Badge variant="secondary" className="font-mono">
                {aapsToRun} AAP a consultar
              </Badge>
            </div>

            <Textarea
              value={aapListText}
              onChange={(event) => setAapListText(event.target.value)}
              disabled={loading}
              rows={9}
              className="min-h-[220px] resize-y rounded-xl font-mono text-xs"
              placeholder={[
                "PRIORIDAD 1: pega aqui los AAP que quieres consultar. Si hay contenido, SOLO se consultan estos AAP.",
                "10000200",
                "10000063",
                "10000187",
                "",
                `PRIORIDAD 2: solo si este cuadro esta vacio se usan los ${configuredAapCount} AAP de src/data/workChannelTargets.json.`,
                "Cada AAP se consulta directamente en functional-dashboard y conserva su propio Top 5.",
              ].join("\n")}
            />

            {previewResolution.resolvedAaps.length > 0 ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
                <div className="font-semibold text-primary">
                  AAP resueltos: {previewResolution.resolvedAaps.length}
                </div>
                <div className="mt-2 max-h-28 space-y-1 overflow-auto font-mono text-[11px] text-muted-foreground">
                  {previewResolution.resolvedAaps.slice(0, 20).map((item) => (
                    <div key={`${item.aap}-${item.channelCode}-${item.applicationName}`}>
                      {item.aap} → canal {item.channelCode}
                      {item.applicationName ? ` → ${item.applicationName}` : ""}
                    </div>
                  ))}
                  {previewResolution.resolvedAaps.length > 20 ? (
                    <div>+{previewResolution.resolvedAaps.length - 20} más...</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {previewResolution.unresolved.length > 0 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                <div className="font-semibold text-amber-700 dark:text-amber-300">
                  AAP sin canal en bbva.ts: {previewResolution.unresolved.length}
                </div>
                <div className="mt-1 break-words text-muted-foreground">
                  {previewResolution.unresolved.join(" · ")} · Estos AAP sí se consultarán; la falta de canal en bbva.ts no afecta la consulta.
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border px-6 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Consulta WORK-02 · functional-dashboard · filtro por AAP · 4 operaciones
              {selectedEnvironment ? ` + env ${selectedEnvironment}` : ""}
            </div>

            <Button
              type="button"
              onClick={handleSearch}
              disabled={loading || aapsToRun === 0}
              className="h-11 rounded-xl px-6"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {loading ? "Consultando..." : "Consultar AAP"}
            </Button>
          </div>

          {loading ? (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  AAP actual: {progress.aap || "preparando..."}{progress.channelCode && progress.channelCode !== "-" ? ` · Canal ${progress.channelCode}` : ""}
                </span>
                <span>
                  {progress.completed}/{progress.total} · {progressPercent}%
                </span>
              </div>
              <Progress value={progressPercent} />
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
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  AAP consultados
                </div>
                <div className="mt-2 text-3xl font-bold">{result.totalAaps}</div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Con datos
                </div>
                <div className="mt-2 text-3xl font-bold text-emerald-600">
                  {result.successfulAaps}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Sin datos
                </div>
                <div className="mt-2 text-3xl font-bold">{result.emptyAaps}</div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Con error
                </div>
                <div className="mt-2 text-3xl font-bold text-destructive">
                  {result.failedAaps}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="rounded-3xl border border-border bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Tabla para Google Sheets
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Formato de tres columnas listo para Google Sheets. Cada AAP ocupa una sola fila y conserva su propio Top 5 de TRX. No se mezclan ni se suman resultados entre AAP distintos, aunque pertenezcan al mismo canal.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="rounded-lg"
                >
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copiar para Google Sheets
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCsv}
                  className="rounded-lg"
                >
                  <Download className="mr-2 h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>

            <div className="space-y-4 p-5">
              {result.unresolvedInputs.length > 0 ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                  <div className="font-semibold text-amber-700 dark:text-amber-300">
                    AAP sin canal en bbva.ts (informativo; la consulta por AAP sí se ejecutó)
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {result.unresolvedInputs.join(" · ")}
                  </div>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-2xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-[180px] font-bold">AAP</TableHead>
                      <TableHead className="w-[300px] font-bold">TRX</TableHead>
                      <TableHead className="font-bold">
                        TRX (Número de ejecuciones)
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.rows.map((item, itemIndex) => {
                      if (item.status === "error") {
                        return (
                          <TableRow key={`${item.aap}-error-${itemIndex}`}>
                            <TableCell className="align-top font-mono text-base font-bold text-primary">
                              {item.aap}
                            </TableCell>
                            <TableCell className="align-top font-mono text-destructive">
                              ERROR
                            </TableCell>
                            <TableCell className="align-top text-destructive">
                              {item.error ?? "Error consultando AAP"}
                            </TableCell>
                          </TableRow>
                        );
                      }

                      if (!item.topTransactions.length) {
                        return (
                          <TableRow key={`${item.aap}-empty-${itemIndex}`}>
                            <TableCell className="align-top font-mono text-base font-bold text-primary">
                              {item.aap}
                            </TableCell>
                            <TableCell className="align-top text-muted-foreground">
                              Sin resultados
                            </TableCell>
                            <TableCell className="align-top text-muted-foreground">
                              Sin resultados
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return (
                        <TableRow
                          key={`${item.aap}-${itemIndex}`}
                          className="border-t-2 border-primary/20"
                        >
                          <TableCell className="align-top bg-primary/[0.03] pt-4 font-mono text-base font-bold text-primary">
                            <div>{item.aap}</div>
                            {item.configuredName ? (
                              <div className="mt-1 max-w-[220px] whitespace-normal font-sans text-[11px] font-normal text-muted-foreground">
                                {item.configuredName}
                              </div>
                            ) : null}
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="space-y-1.5 py-1">
                              {item.topTransactions.map((transaction, index) => (
                                <div
                                  key={`${item.aap}-trx-${transaction.trx}`}
                                  className="min-h-7 border-b border-border/50 pb-1.5 font-mono font-semibold last:border-b-0 last:pb-0"
                                >
                                  <span className="mr-2 text-[10px] text-muted-foreground">
                                    #{index + 1}
                                  </span>
                                  {transaction.trx}
                                </div>
                              ))}
                            </div>
                          </TableCell>

                          <TableCell className="align-top">
                            <div className="space-y-1.5 py-1">
                              {item.topTransactions.map((transaction) => (
                                <div
                                  key={`${item.aap}-exec-${transaction.trx}`}
                                  className="min-h-7 border-b border-border/50 pb-1.5 font-mono font-semibold last:border-b-0 last:pb-0"
                                >
                                  {transaction.trx}{" "}
                                  <span className="font-bold text-foreground">
                                    ({formatCompactExecutions(transaction.executions)})
                                  </span>
                                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                                    {formatExactExecutions(transaction.executions)} exec
                                  </span>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
