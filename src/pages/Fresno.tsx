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
} from "lucide-react";
import { toast } from "sonner";

import LoadingOverlay from "@/components/LoadingOverlay";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { useSessionCookie } from "@/hooks/useSessionCookie";
import {
  fetchFresnoOwners,
  getNormalizedUuaaList,
  type FresnoRow,
} from "@/services/fresnoService";

type FresnoColumnKey =
  | "uuaa"
  | "uuaaId"
  | "countryName"
  | "projectManagerName"
  | "projectManagerEmail"
  | "maintenanceManagerName"
  | "maintenanceManagerEmail"
  | "productionManagerName"
  | "productionManagerEmail"

type FresnoColumn = {
  key: FresnoColumnKey;
  label: string;
};

const ALL_COLUMNS: FresnoColumn[] = [
  { key: "uuaa", label: "UUAA" },
  { key: "uuaaId", label: "UUAA ID" },
  { key: "countryName", label: "País" },
  { key: "projectManagerName", label: "Project Manager Nombre" },
  { key: "projectManagerEmail", label: "Project Manager Email" },
  { key: "maintenanceManagerName", label: "Maintenance Manager Nombre" },
  { key: "maintenanceManagerEmail", label: "Maintenance Manager Email" },
  { key: "productionManagerName", label: "Production Manager Nombre" },
  { key: "productionManagerEmail", label: "Production Manager Email" },
  
];

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowValue(row: FresnoRow, key: FresnoColumnKey): string {
  return String(row[key] ?? "");
}

function buildCsv(rows: FresnoRow[], selectedColumns: FresnoColumn[]) {
  const headers = selectedColumns.map((column) => column.label);
  const data = rows.map((row) =>
    selectedColumns.map((column) => rowValue(row, column.key))
  );

  return [headers, ...data]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function buildSheetsText(rows: FresnoRow[], selectedColumns: FresnoColumn[]) {
  const headers = selectedColumns.map((column) => column.label);
  const data = rows.map((row) =>
    selectedColumns.map((column) => rowValue(row, column.key))
  );

  return [headers, ...data].map((row) => row.join("\t")).join("\n");
}

export default function Fresno() {
  const { sessionCookie, setSessionCookie } = useSessionCookie();

  const [showCookie, setShowCookie] = useState(false);
  const [uuaaInput, setUuaaInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<FresnoRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [selectedColumnKeys, setSelectedColumnKeys] = useState<FresnoColumnKey[]>(
    ALL_COLUMNS.map((column) => column.key)
  );

  const selectedColumns = useMemo(() => {
    return ALL_COLUMNS.filter((column) => selectedColumnKeys.includes(column.key));
  }, [selectedColumnKeys]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((row) =>
      [
        row.uuaa,
        row.uuaaId,
        row.countryName,
        row.projectManagerName,
        row.projectManagerEmail,
        row.maintenanceManagerName,
        row.maintenanceManagerEmail,
        row.productionManagerName,
        row.productionManagerEmail,
        row.error,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, search]);

  const totalUuaas = useMemo(() => getNormalizedUuaaList(uuaaInput).length, [uuaaInput]);

  const rowsWithError = useMemo(() => rows.filter((row) => row.error).length, [rows]);

  const rowsWithoutError = useMemo(
    () => rows.filter((row) => !row.error).length,
    [rows]
  );

  const handleToggleColumn = (key: FresnoColumnKey, checked: boolean) => {
    setSelectedColumnKeys((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, key]));
      }
      return prev.filter((item) => item !== key);
    });
  };

  const handleSearchFresno = async () => {
    if (!sessionCookie.trim()) {
      toast.error("La cookie es requerida.");
      return;
    }

    if (!uuaaInput.trim()) {
      toast.error("Debes capturar al menos una UUAA.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchFresnoOwners({
        uuaaInput,
        sessionCookie: sessionCookie.trim(),
      });

      setRows(data);
      toast.success("Consulta Fresno completada.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCsv = () => {
    if (!filteredRows.length) {
      toast.error("No hay datos para descargar.");
      return;
    }

    if (!selectedColumns.length) {
      toast.error("Selecciona al menos una columna.");
      return;
    }

    const csv = buildCsv(filteredRows, selectedColumns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "fresno_uuaa_responsables.csv";
    link.click();

    URL.revokeObjectURL(url);
    toast.success("CSV descargado correctamente.");
  };

  const handleCopySelectedColumns = async () => {
    if (!filteredRows.length) {
      toast.error("No hay datos para copiar.");
      return;
    }

    if (!selectedColumns.length) {
      toast.error("Selecciona al menos una columna.");
      return;
    }

    try {
      const text = buildSheetsText(filteredRows, selectedColumns);
      await navigator.clipboard.writeText(text);
      toast.success("Columnas copiadas. Ya puedes pegarlas en Google Sheets.");
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <LoadingOverlay show={loading} />

      <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
        <section className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Cookie de sesión
              </Label>
              <div className="relative">
                <Input
                  type={showCookie ? "text" : "password"}
                  placeholder="Pega aquí la cookie"
                  className="h-11 rounded-xl pr-10 font-mono text-xs"
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

            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Lista de UUAAs
              </Label>
              <Textarea
                value={uuaaInput}
                onChange={(e) => setUuaaInput(e.target.value.toUpperCase())}
                placeholder={`Ejemplo:\nXPPW\nMBGD\nABCD`}
                className="min-h-[180px] rounded-xl font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Puedes pegar una UUAA por línea, o separadas por coma, espacio o punto y coma.
              </p>
            </div>

            <div className="space-y-2 xl:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Buscar en resultados
              </Label>
              <Input
                type="text"
                placeholder="Buscar UUAA, manager, email..."
                className="h-11 rounded-xl font-mono text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={handleSearchFresno}
              disabled={loading}
              className="h-11 rounded-xl px-5"
            >
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Consultando..." : "Consultar Fresno"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleDownloadCsv}
              disabled={!filteredRows.length}
              className="h-11 rounded-xl px-5"
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleCopySelectedColumns}
              disabled={!filteredRows.length}
              className="h-11 rounded-xl px-5"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar columnas seleccionadas
            </Button>
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-sm font-semibold tracking-tight">
              Columnas para copiar/exportar
            </h2>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ALL_COLUMNS.map((column) => {
              const checked = selectedColumnKeys.includes(column.key);

              return (
                <label
                  key={column.key}
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-4 py-3"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      handleToggleColumn(column.key, Boolean(value))
                    }
                  />
                  <span className="text-sm">{column.label}</span>
                </label>
              );
            })}
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
              <span className="text-xs font-medium text-muted-foreground">
                UUAAs capturadas
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {totalUuaas.toLocaleString()}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-medium text-muted-foreground">
                Consultas correctas
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {rowsWithoutError.toLocaleString()}
            </div>
          </div>

    

          <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-accent" />
              <span className="text-xs font-medium text-muted-foreground">
                Filtradas
              </span>
            </div>
            <div className="mt-3 font-mono text-3xl font-bold">
              {filteredRows.length.toLocaleString()}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/95 shadow-sm">
          <div className="border-b border-border/60 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight">FRESNO</h2>
          </div>

          <div className="overflow-auto max-h-[78vh]">
            <table className="w-full min-w-[2200px] text-left text-sm">
              <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
                <tr className="border-b border-border/70">
                  {ALL_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {filteredRows.map((row, idx) => (
                  <tr
                    key={`${row.uuaa}-${idx}`}
                    className="border-b border-border/50 align-top transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-4 font-mono font-semibold">{row.uuaa}</td>
                    <td className="px-4 py-4 font-mono">{row.uuaaId}</td>
                    <td className="px-4 py-4">{row.countryName}</td>
                    <td className="px-4 py-4">{row.projectManagerName}</td>
                    <td className="px-4 py-4 font-mono break-all">
                      {row.projectManagerEmail}
                    </td>
                    <td className="px-4 py-4">{row.maintenanceManagerName}</td>
                    <td className="px-4 py-4 font-mono break-all">
                      {row.maintenanceManagerEmail}
                    </td>
                    <td className="px-4 py-4">{row.productionManagerName}</td>
                    <td className="px-4 py-4 font-mono break-all">
                      {row.productionManagerEmail}
                    </td>
                    <td className="px-4 py-4 break-words text-destructive">
                      {row.error || "-"}
                    </td>
                  </tr>
                ))}

                {!filteredRows.length && (
                  <tr>
                    <td
                      colSpan={ALL_COLUMNS.length}
                      className="px-6 py-12 text-center text-sm text-muted-foreground"
                    >
                      {rows.length
                        ? "No hay resultados con el filtro actual."
                        : "Ejecuta una consulta para ver datos."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}