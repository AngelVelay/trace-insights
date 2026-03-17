import { useMemo, useState } from "react";
import type { MetricRow } from "@/types/bbva";
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

type InvokerTxItem = {
  invokerTx: string;
  sum_num_executions: number;
  mean_span_duration: number;
  sum_functional_error?: number;
  sum_technical_error?: number;
};

type LibraryItem = {
  invokerLibrary: string;
  count: number;
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

function parseInvokerTxItem(value: unknown): InvokerTxItem | null {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed) as Partial<InvokerTxItem>;
      if (!parsed?.invokerTx) return null;
      return {
        invokerTx: String(parsed.invokerTx),
        sum_num_executions: Number(parsed.sum_num_executions ?? 0),
        mean_span_duration: Number(parsed.mean_span_duration ?? 0),
        sum_functional_error: Number(parsed.sum_functional_error ?? 0),
        sum_technical_error: Number(parsed.sum_technical_error ?? 0),
      };
    } catch {
      return {
        invokerTx: trimmed,
        sum_num_executions: 0,
        mean_span_duration: 0,
        sum_functional_error: 0,
        sum_technical_error: 0,
      };
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const invokerTx = String(obj.invokerTx ?? "").trim();
    if (!invokerTx) return null;
    return {
      invokerTx,
      sum_num_executions: Number(obj.sum_num_executions ?? 0),
      mean_span_duration: Number(obj.mean_span_duration ?? 0),
      sum_functional_error: Number(obj.sum_functional_error ?? 0),
      sum_technical_error: Number(obj.sum_technical_error ?? 0),
    };
  }

  return null;
}

function parseLibraryItems(value: unknown): LibraryItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          invokerLibrary: String(obj.invokerLibrary ?? "").trim(),
          count: Number(obj.count ?? 0),
        };
      })
      .filter(
        (item): item is LibraryItem =>
          Boolean(item && item.invokerLibrary.length > 0)
      );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseLibraryItems(parsed);
      }
    } catch {
      return [];
    }
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const invokerLibrary = String(obj.invokerLibrary ?? "").trim();
    if (!invokerLibrary) return [];
    return [
      {
        invokerLibrary,
        count: Number(obj.count ?? 0),
      },
    ];
  }

  return [];
}

function parseUtilityTypeItems(value: unknown): UtilityTypeItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          invokerLibrary: String(obj.invokerLibrary ?? "").trim(),
          utilitytype: String(obj.utilitytype ?? "").trim(),
          count: Number(obj.count ?? 0),
        };
      })
      .filter(
        (item): item is UtilityTypeItem =>
          Boolean(
            item &&
              item.invokerLibrary.length > 0 &&
              item.utilitytype.length > 0
          )
      );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseUtilityTypeItems(parsed);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function parseInvokedParamItems(value: unknown): InvokedParamItem[] {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        return {
          invokerLibrary: String(obj.invokerLibrary ?? "").trim(),
          utilitytype: String(obj.utilitytype ?? "").trim(),
          invokedparam: String(obj.invokedparam ?? "").trim(),
          count: Number(obj.count ?? 0),
          maxDuration: Number(obj.maxDuration ?? 0),
        };
      })
      .filter(
        (item): item is InvokedParamItem =>
          Boolean(
            item &&
              item.invokerLibrary.length > 0 &&
              item.utilitytype.length > 0 &&
              item.invokedparam.length > 0
          )
      );
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "-") return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parseInvokedParamItems(parsed);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function invokerTxSearchText(value: unknown): string {
  const item = parseInvokerTxItem(value);
  if (!item) return String(value ?? "");
  return `${item.invokerTx} ${item.sum_num_executions} exec ${item.mean_span_duration} ms`.toLowerCase();
}

function librarySearchText(value: unknown): string {
  const items = parseLibraryItems(value);
  if (!items.length) return String(value ?? "");
  return items
    .map((item) => `${item.invokerLibrary} ${item.count} exec`)
    .join(" ")
    .toLowerCase();
}

function utilityTypeSearchText(value: unknown): string {
  const items = parseUtilityTypeItems(value);
  if (!items.length) return String(value ?? "");
  return items
    .map(
      (item) =>
        `${item.invokerLibrary} ${item.utilitytype} ${item.count} exec`
    )
    .join(" ")
    .toLowerCase();
}

function invokedParamSearchText(value: unknown): string {
  const items = parseInvokedParamItems(value);
  if (!items.length) return String(value ?? "");
  return items
    .map(
      (item) =>
        `${item.invokerLibrary} ${item.utilitytype} ${item.invokedparam} ${item.count} exec ${item.maxDuration}`
    )
    .join(" ")
    .toLowerCase();
}

function traceSearchText(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function formatExecDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(2)} ms`;
}

function renderInvokerTxCell(value: unknown) {
  const item = parseInvokerTxItem(value);

  if (!item) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div>
      <div className="font-bold text-primary">{item.invokerTx}</div>
      <div className="italic text-muted-foreground">
        {item.sum_num_executions} exec
      </div>
      <div className="italic text-muted-foreground">
        {formatExecDuration(item.mean_span_duration)}
      </div>
    </div>
  );
}

function renderLibraryCell(value: unknown) {
  const items = parseLibraryItems(value);

  if (!items.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div>
      {items.map((item, index) => (
        <div key={`${item.invokerLibrary}-${index}`}>
          <div className="font-bold">{item.invokerLibrary}</div>
          <div className="italic text-muted-foreground">{item.count} exec</div>
        </div>
      ))}
    </div>
  );
}

function renderUtilityTypeCell(value: unknown) {
  const items = parseUtilityTypeItems(value);

  if (!items.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div>
      {items.map((item, index) => (
        <div key={`${item.invokerLibrary}-${item.utilitytype}-${index}`}>
          <div className="font-bold">{item.invokerLibrary}</div>
          <div>{item.utilitytype}</div>
          <div className="italic text-muted-foreground">{item.count} exec</div>
        </div>
      ))}
    </div>
  );
}

function renderInvokedParamCell(value: unknown) {
  const items = parseInvokedParamItems(value);

  if (!items.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <div>
      {items.map((item, index) => (
        <div
          key={`${item.invokerLibrary}-${item.utilitytype}-${item.invokedparam}-${index}`}
          className="mb-2"
        >
          <div className="font-bold">{item.invokerLibrary}</div>
          <div>{item.utilitytype}</div>
          <div>{item.invokedparam}</div>
          <div className="italic text-muted-foreground">
            {item.count} exec
          </div>
          <div className="italic text-muted-foreground">
            {formatExecDuration(item.maxDuration)}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderTraceCell(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
      {text}
    </pre>
  );
}

export default function MetricsTable({
  rows,
  loading = false,
  errorMessage = null,
}: MetricsTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("invokerTx");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    const result = rows.filter((r) => {
      const site = String(r.site ?? "").toLowerCase();
      const invokerTx = invokerTxSearchText(r.invokerTx);
      const invokedparam = invokedParamSearchText(r.invokedparam);
      const utilitytype = utilityTypeSearchText(r.utilitytype);
      const invokerLibrary = librarySearchText(r.invokerLibrary);
      const trace = traceSearchText(r.trace);

      return (
        site.includes(q) ||
        invokerTx.includes(q) ||
        invokedparam.includes(q) ||
        utilitytype.includes(q) ||
        invokerLibrary.includes(q) ||
        trace.includes(q)
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
      setSortAsc(true);
    }
  };

  const SortableHead = ({ label, field }: { label: string; field: SortKey }) => (
    <TableHead
      className="cursor-pointer select-none whitespace-nowrap text-xs"
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Input
          placeholder="Buscar..."
          className="max-w-xs font-mono text-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="max-h-[500px] overflow-x-auto overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Site" field="site" />
              <SortableHead label="InvokerTx" field="invokerTx" />
              <SortableHead label="Library" field="invokerLibrary" />
              <SortableHead label="UtilityType" field="utilitytype" />
              <SortableHead label="InvokedParam" field="invokedparam" />
              <SortableHead label="Trace" field="trace" />
            </TableRow>
          </TableHeader>

          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-muted-foreground"
                >
                  {emptyStateMessage}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={`${i}`} className="font-mono text-xs">
                  <TableCell>{row.site}</TableCell>
                  <TableCell>{renderInvokerTxCell(row.invokerTx)}</TableCell>
                  <TableCell>{renderLibraryCell(row.invokerLibrary)}</TableCell>
                  <TableCell>{renderUtilityTypeCell(row.utilitytype)}</TableCell>
                  <TableCell>{renderInvokedParamCell(row.invokedparam)}</TableCell>
                  <TableCell className="min-w-[420px]">
                    {renderTraceCell(row.trace)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}