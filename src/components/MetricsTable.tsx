import { useMemo, useState } from "react";
import type { MetricRow } from "@/types/bbva";
import { formatDurationMs } from "@/services/dateUtils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { ArrowUpDown } from "lucide-react";

interface MetricsTableProps {
  rows: MetricRow[];
  loading?: boolean;
  errorMessage?: string | null;
}

type SortKey = keyof MetricRow;

export default function MetricsTable({
  rows,
  loading = false,
  errorMessage = null,
}: MetricsTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("utility_count");
  const [sortAsc, setSortAsc] = useState(false);

  const filtered = useMemo(() => {
    console.debug("[MetricsTable] rows =", rows);

    const q = search.trim().toLowerCase();

    const result = rows.filter((r) => {
      const site = String(r.site ?? "").toLowerCase();
      const invokerTx = String(r.invokerTx ?? "").toLowerCase();
      const invokedparam = String(r.invokedparam ?? "").toLowerCase();
      const utilitytype = String(r.utilitytype ?? "").toLowerCase();
      const invokerLibrary = String(r.invokerLibrary ?? "").toLowerCase();

      return (
        site.includes(q) ||
        invokerTx.includes(q) ||
        invokedparam.includes(q) ||
        utilitytype.includes(q) ||
        invokerLibrary.includes(q)
      );
    });

    result.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];

      if (typeof av === "number" && typeof bv === "number") {
        return sortAsc ? av - bv : bv - av;
      }

      return sortAsc
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : String(bv ?? "").localeCompare(String(av ?? ""));
    });

    console.debug("[MetricsTable] filtered =", result.length);
    return result;
  }, [rows, search, sortKey, sortAsc]);

  const hasSearch = search.trim().length > 0;

  let emptyStateMessage = "Sin datos. Ejecuta una consulta para ver métricas.";

  if (loading) {
    emptyStateMessage = "Cargando métricas...";
  } else if (errorMessage) {
    emptyStateMessage = `Error cargando métricas: ${errorMessage}`;
  } else if (rows.length === 0) {
    emptyStateMessage = "La consulta terminó, pero no devolvió métricas.";
  } else if (hasSearch && filtered.length === 0) {
    emptyStateMessage = `No hay coincidencias para "${search.trim()}".`;
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const SortableHead = ({ label, field }: { label: string; field: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none text-xs whitespace-nowrap"
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
      </span>
    </TableHead>
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Métricas {hasSearch ? `(${filtered.length}/${rows.length})` : `(${rows.length})`}
        </h3>

        <Input
          placeholder="Buscar..."
          className="max-w-xs text-xs font-mono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Site" field="site" />
              <SortableHead label="InvokerTx" field="invokerTx" />
              <SortableHead label="Library" field="invokerLibrary" />
              <SortableHead label="UtilityType" field="utilitytype" />
              <SortableHead label="InvokedParam" field="invokedparam" />
              <SortableHead label="Count" field="utility_count" />
              <SortableHead label="Min" field="min_utility_duration" />
              <SortableHead label="Mean" field="mean_utility_duration" />
              <SortableHead label="Max" field="max_utility_duration" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  {emptyStateMessage}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow
                  key={`${row.invokerTx}-${row.invokerLibrary}-${row.utilitytype}-${row.invokedparam}-${i}`}
                  className="font-mono text-xs"
                >
                  <TableCell>{row.site}</TableCell>
                  <TableCell className="text-primary font-medium">{row.invokerTx}</TableCell>
                  <TableCell>{row.invokerLibrary}</TableCell>
                  <TableCell>
                    <span className="inline-block rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">
                      {row.utilitytype}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">{row.invokedparam}</TableCell>
                  <TableCell className="text-right">{row.utility_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{formatDurationMs(row.min_utility_duration)}</TableCell>
                  <TableCell className="text-right">{formatDurationMs(row.mean_utility_duration)}</TableCell>
                  <TableCell className="text-right">{formatDurationMs(row.max_utility_duration)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}