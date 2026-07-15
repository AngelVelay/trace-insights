import { useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  Boxes,
  Eye,
  EyeOff,
  GitBranch,
  Network,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import LoadingOverlay from "@/components/LoadingOverlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useBearerToken } from "@/hooks/useBearerToken";
import { useSessionCookie } from "@/hooks/useSessionCookie";
import type { ApxConsoleEnvironment } from "@/services/apxCicsConsolaService";
import {
  fetchDependencyTreeForTransactions,
  parseTransactionList,
  type DependencyGraph,
  type DependencyGraphNode,
  type DependencyLibraryQueryInfo,
  type DependencyTransactionResult,
  type DependencyTreeResult,
  type DependencyUtilityComparisonRow,
} from "@/services/dependencyTreeService";

const ENVIRONMENTS: ApxConsoleEnvironment[] = [
  "DEV",
  "INT",
  "OCTA",
  "AUS",
  "PROD",
];

const ATENEA_SITES = ["LIVE-02", "LIVE-04"];

const GRAPH_PALETTE = {
  color1: "#12090e",
  color2: "#122e41",
  color3: "#146384",
  color4: "#1fa0d2",
  color5: "#20dad8",
};

const NODE_COLORS: Record<
  string,
  { bg: string; border: string; text: string; glow: string; miniMap: string }
> = {
  transaction: {
    bg: `linear-gradient(135deg, ${GRAPH_PALETTE.color4} 0%, ${GRAPH_PALETTE.color3} 55%, ${GRAPH_PALETTE.color2} 100%)`,
    border: GRAPH_PALETTE.color5,
    text: "#f8feff",
    glow: "0 22px 46px rgba(32, 218, 216, 0.26)",
    miniMap: GRAPH_PALETTE.color4,
  },
  library: {
    bg: `linear-gradient(135deg, ${GRAPH_PALETTE.color3} 0%, ${GRAPH_PALETTE.color2} 100%)`,
    border: GRAPH_PALETTE.color4,
    text: "#e9fbff",
    glow: "0 18px 38px rgba(31, 160, 210, 0.22)",
    miniMap: GRAPH_PALETTE.color3,
  },
  utility: {
    bg: `linear-gradient(135deg, ${GRAPH_PALETTE.color5} 0%, ${GRAPH_PALETTE.color4} 60%, ${GRAPH_PALETTE.color3} 100%)`,
    border: "#9bffff",
    text: GRAPH_PALETTE.color1,
    glow: "0 18px 38px rgba(32, 218, 216, 0.25)",
    miniMap: GRAPH_PALETTE.color5,
  },
  binary: {
    bg: `linear-gradient(135deg, ${GRAPH_PALETTE.color2} 0%, ${GRAPH_PALETTE.color1} 100%)`,
    border: GRAPH_PALETTE.color3,
    text: "#d8f7ff",
    glow: "0 14px 30px rgba(18, 9, 14, 0.28)",
    miniMap: GRAPH_PALETTE.color2,
  },
  other: {
    bg: `linear-gradient(135deg, ${GRAPH_PALETTE.color1} 0%, ${GRAPH_PALETTE.color2} 100%)`,
    border: GRAPH_PALETTE.color3,
    text: "#e9fbff",
    glow: "0 14px 30px rgba(18, 9, 14, 0.28)",
    miniMap: GRAPH_PALETTE.color1,
  },
};

function getNodeMiniMapColor(node: Node): string {
  const kind = String((node.data as { kind?: string } | undefined)?.kind ?? "other");

  return NODE_COLORS[kind]?.miniMap ?? NODE_COLORS.other.miniMap;
}

function getDefaultFromDate(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

function getDefaultToDate(): Date {
  return new Date();
}

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseDateTimeLocalValue(value: string): Date | null {
  if (!value.trim()) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-MX").format(value);
}

function formatMetricDurationMs(value: number | undefined): string {
  const ms = Number(value ?? 0);

  return `${new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(ms) ? ms : 0)} ms`;
}

type UtilityLibrarySection = {
  utility: string;
  libraries: string[];
};

type ConsolidatedTransactionComparisonRow = {
  transactionName: string;
  utilitySections: UtilityLibrarySection[];
  executedSections: UtilityLibrarySection[];
  missingSections: UtilityLibrarySection[];
  jdbcQueryInfos: DependencyLibraryQueryInfo[];
  searchText: string;
};

const UTILITY_ORDER = [
  "JDBC",
  "MONGO",
  "CICS",
  "API-CONNECTOR",
  "GRPC",
  "TITAN",
];

function sortUtilities(a: string, b: string): number {
  const aIndex = UTILITY_ORDER.indexOf(a);
  const bIndex = UTILITY_ORDER.indexOf(b);

  if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
  if (aIndex >= 0) return -1;
  if (bIndex >= 0) return 1;

  return a.localeCompare(b);
}

function dedupeAndSort(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

function formatUtilitySectionsText(sections: UtilityLibrarySection[]): string {
  if (!sections.length) return "Sin faltantes";

  return sections
    .map((section) =>
      [
        `• ${section.utility}`,
        ...section.libraries.map((library) => `  ◦ ${library}`),
      ].join("\n")
    )
    .join("\n\n");
}

function formatJdbcQueriesText(queryInfos: DependencyLibraryQueryInfo[]): string {
  if (!queryInfos.length) return "Sin queries JDBC";

  return queryInfos
    .map((info) => {
      const lines = [`• ${info.libraryName}`];

      if (info.error) {
        lines.push(`  ✕ Error: ${info.error}`);
      } else if (info.queries.length) {
        lines.push(...info.queries.map((query) => `  ◦ ${query.name}`));
      } else {
        lines.push("  ◦ Sin queries en properties");
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatJdbcSqlSummaryText(queryInfos: DependencyLibraryQueryInfo[]): string {
  if (!queryInfos.length) return "Sin resumen SQL";

  return queryInfos
    .map((info) => {
      const lines = [`• ${info.libraryName}`];

      if (info.error) {
        lines.push(`  ✕ Error: ${info.error}`);
      } else if (info.sqlSummary.length) {
        lines.push(
          ...info.sqlSummary.map((item) => `  ◦ ${item.count} ${item.method}`)
        );
      } else {
        lines.push("  ◦ Sin métodos SQL detectados");
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatJdbcQueryExecutionText(
  queryInfos: DependencyLibraryQueryInfo[]
): string {
  if (!queryInfos.length) return "Sin comparativa de queries Atenea";

  const lines = ["• JDBC"];

  for (const info of queryInfos) {
    lines.push("", `  ◦ ${info.libraryName}`);

    if (info.error) {
      lines.push(`    ✕ Error: ${info.error}`);
      continue;
    }

    lines.push("    ✓ Sí se ejecutan en Atenea");

    if (info.executingQueriesInAtenea.length) {
      for (const query of info.executingQueriesInAtenea) {
        lines.push(`      - ${query.name}`);
        lines.push(`        ${formatNumber(Number(query.ateneaExecutions ?? 0))} exec`);
        lines.push(`        ${formatMetricDurationMs(query.ateneaResponseTimeMs)}`);
      }
    } else {
      lines.push("      - Sin queries ejecutadas");
    }

    lines.push("", "    ✕ No se ejecutan en Atenea");

    if (info.missingQueriesInAtenea.length) {
      lines.push(
        ...info.missingQueriesInAtenea.map((query) => `      - ${query.name}`)
      );
    } else {
      lines.push("      - Sin queries faltantes");
    }
  }

  return lines.join("\n");
}

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function groupComparisonRowsByTransaction(
  rows: DependencyUtilityComparisonRow[],
  transactions: DependencyTransactionResult[]
): ConsolidatedTransactionComparisonRow[] {
  const transactionMap = new Map<
    string,
    Map<
      string,
      {
        operationLibraries: string[];
        executingInAtenea: string[];
        missingInAtenea: string[];
      }
    >
  >();
  const jdbcQueryInfosByTransaction = new Map<string, DependencyLibraryQueryInfo[]>();

  for (const transaction of transactions) {
    jdbcQueryInfosByTransaction.set(
      transaction.transactionName,
      [...transaction.jdbcQueryInfos].sort((a, b) =>
        a.libraryName.localeCompare(b.libraryName)
      )
    );
  }

  for (const row of rows) {
    const transactionName = row.transactionName || "SIN TRX";
    const utility = row.utility || "SIN UTILIDAD";
    const utilityMap =
      transactionMap.get(transactionName) ??
      new Map<
        string,
        {
          operationLibraries: string[];
          executingInAtenea: string[];
          missingInAtenea: string[];
        }
      >();
    const current = utilityMap.get(utility) ?? {
      operationLibraries: [],
      executingInAtenea: [],
      missingInAtenea: [],
    };

    current.operationLibraries.push(...row.operationLibraries);
    current.executingInAtenea.push(...row.executingInAtenea);
    current.missingInAtenea.push(...row.missingInAtenea);
    utilityMap.set(utility, current);
    transactionMap.set(transactionName, utilityMap);
  }

  return Array.from(transactionMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([transactionName, utilityMap]) => {
      const utilitySections = Array.from(utilityMap.entries())
        .sort(([a], [b]) => sortUtilities(a, b))
        .map(([utility, values]) => ({
          utility,
          libraries: dedupeAndSort(values.operationLibraries),
        }))
        .filter((section) => section.libraries.length > 0);

      const executedSections = Array.from(utilityMap.entries())
        .sort(([a], [b]) => sortUtilities(a, b))
        .map(([utility, values]) => ({
          utility,
          libraries: dedupeAndSort(values.executingInAtenea),
        }))
        .filter((section) => section.libraries.length > 0);

      const missingSections = Array.from(utilityMap.entries())
        .sort(([a], [b]) => sortUtilities(a, b))
        .map(([utility, values]) => ({
          utility,
          libraries: dedupeAndSort(values.missingInAtenea),
        }))
        .filter((section) => section.libraries.length > 0);

      const jdbcQueryInfos = jdbcQueryInfosByTransaction.get(transactionName) ?? [];

      const searchText = [
        transactionName,
        formatUtilitySectionsText(utilitySections),
        formatUtilitySectionsText(executedSections),
        formatUtilitySectionsText(missingSections),
        formatJdbcQueriesText(jdbcQueryInfos),
        formatJdbcSqlSummaryText(jdbcQueryInfos),
        formatJdbcQueryExecutionText(jdbcQueryInfos),
      ]
        .join(" ")
        .toLowerCase();

      return {
        transactionName,
        utilitySections,
        executedSections,
        missingSections,
        jdbcQueryInfos,
        searchText,
      };
    });
}

function buildComparisonCsv(rows: ConsolidatedTransactionComparisonRow[]): string {
  const headers = [
    "Transaccion",
    "Librerias por utilidad",
    "Ejecutan en Atenea",
    "Faltantes en Atenea",
    "Queries JDBC",
    "Resumen SQL JDBC",
    "Ejecución queries Atenea",
  ];

  const data = rows.map((row) => [
    row.transactionName,
    formatUtilitySectionsText(row.utilitySections),
    row.executedSections.length
      ? formatUtilitySectionsText(row.executedSections)
      : "Sin ejecuciones en Atenea",
    row.missingSections.length
      ? formatUtilitySectionsText(row.missingSections)
      : "Sin faltantes",
    formatJdbcQueriesText(row.jdbcQueryInfos),
    formatJdbcSqlSummaryText(row.jdbcQueryInfos),
    formatJdbcQueryExecutionText(row.jdbcQueryInfos),
  ]);

  return [headers, ...data]
    .map((row) => row.map((cell) => escapeCsv(cell)).join(","))
    .join("\n");
}

function UtilitySectionsCell({
  sections,
  emptyLabel,
  tone = "default",
}: {
  sections: UtilityLibrarySection[];
  emptyLabel: string;
  tone?: "default" | "success" | "warning";
}) {
  if (!sections.length) {
    return (
      <span
        className={
          tone === "warning"
            ? "text-xs font-medium text-emerald-700"
            : "text-xs text-muted-foreground"
        }
      >
        {emptyLabel}
      </span>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <div key={section.utility} className="space-y-2">
          <Badge
            variant={tone === "warning" ? "destructive" : "outline"}
            className={
              tone === "success"
                ? "rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold tracking-wide text-emerald-700"
                : "rounded-full px-3 py-1 text-[11px] font-bold tracking-wide"
            }
          >
            • {section.utility}
          </Badge>
          <div className="space-y-1 pl-4 font-mono text-xs leading-5">
            {section.libraries.map((library) => (
              <div key={`${section.utility}-${library}`}>{library}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JdbcQueriesCell({
  queryInfos,
  mode,
}: {
  queryInfos: DependencyLibraryQueryInfo[];
  mode: "queries" | "summary";
}) {
  if (!queryInfos.length) {
    return (
      <span className="text-xs text-muted-foreground">
        {mode === "queries" ? "Sin queries JDBC" : "Sin resumen SQL"}
      </span>
    );
  }

  return (
    <div className="space-y-4">
      {queryInfos.map((info) => (
        <div key={`${mode}-${info.libraryName}`} className="space-y-2">
          <Badge
            variant="outline"
            className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold tracking-wide text-sky-800"
          >
            {info.libraryName}
          </Badge>

          {info.error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {info.error}
            </div>
          ) : mode === "queries" ? (
            info.queries.length ? (
              <div className="space-y-1 pl-4 font-mono text-xs leading-5">
                {info.queries.map((query) => (
                  <div key={`${info.libraryName}-${query.name}`}>{query.name}</div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Sin queries en properties
              </div>
            )
          ) : info.sqlSummary.length ? (
            <div className="space-y-1 pl-4 font-mono text-xs leading-5">
              {info.sqlSummary.map((item) => (
                <div key={`${info.libraryName}-${item.method}`}>
                  {item.count} {item.method}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Sin métodos SQL detectados
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function JdbcQueryExecutionCell({
  queryInfos,
}: {
  queryInfos: DependencyLibraryQueryInfo[];
}) {
  if (!queryInfos.length) {
    return (
      <span className="text-xs text-muted-foreground">
        Sin comparativa de queries Atenea
      </span>
    );
  }

  return (
    <div className="space-y-5">
      <Badge
        variant="outline"
        className="rounded-full border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-bold tracking-wide text-cyan-800"
      >
        • JDBC
      </Badge>

      {queryInfos.map((info) => (
        <div key={`query-atenea-${info.libraryName}`} className="space-y-3">
          <Badge
            variant="outline"
            className="rounded-full border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-bold tracking-wide text-sky-800"
          >
            {info.libraryName}
          </Badge>

          {info.error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {info.error}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                  [QUERYS DE PROPERTIES QUE SÍ SE EJECUTAN EN ATENEA]
                </div>
                {info.executingQueriesInAtenea.length ? (
                  <div className="space-y-3 font-mono text-xs leading-5 text-emerald-950">
                    {info.executingQueriesInAtenea.map((query) => (
                      <div
                        key={`${info.libraryName}-exec-${query.name}`}
                        className="rounded-xl border border-emerald-200 bg-white/70 p-2"
                      >
                        <div className="font-semibold">{query.name}</div>
                        <div>{formatNumber(Number(query.ateneaExecutions ?? 0))} exec</div>
                        <div>{formatMetricDurationMs(query.ateneaResponseTimeMs)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-emerald-800">
                    [SIN QUERIES QUE SE ENCUNTRAN EN PROPERTIES EJECUTADAS EN ATENEA]
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                  [SE ENCUENTRAN EN PROPERTIES PERO NO SE EJECUTAN EN ATENEA]
                </div>
                {info.missingQueriesInAtenea.length ? (
                  <div className="space-y-1 font-mono text-xs leading-5 text-amber-950">
                    {info.missingQueriesInAtenea.map((query) => (
                      <div key={`${info.libraryName}-missing-${query.name}`}>
                        {query.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-amber-800">
                     [TODAS LAS QUERYS DE PROPERTIES SE EJECUTAN EN ATENEA O  NO UTILIZA JDBC] 
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function getNodeLevel(node: DependencyGraphNode): number {
  if (node.kind === "transaction") return 0;
  if (node.kind === "library") return 1;
  if (node.kind === "utility") return 2;
  return 3;
}

function getNodeKindLabel(node: DependencyGraphNode): string {
  if (node.kind === "transaction") return "Transacción";
  if (node.kind === "library") return "Library";
  if (node.kind === "utility") return "Utility";
  if (node.kind === "binary") return "Binary";
  return "Nodo";
}

function buildReactFlowData(graph: DependencyGraph): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodesByLevel = new Map<number, DependencyGraphNode[]>();

  for (const node of graph.nodes) {
    const level = getNodeLevel(node);
    const current = nodesByLevel.get(level) ?? [];
    current.push(node);
    nodesByLevel.set(level, current);
  }

  const positionedNodes: Node[] = graph.nodes.map((node) => {
    const level = getNodeLevel(node);
    const siblings = nodesByLevel.get(level) ?? [];
    const index = siblings.findIndex((item) => item.id === node.id);
    const count = Math.max(siblings.length, 1);
    const colors = NODE_COLORS[node.kind] ?? NODE_COLORS.other;

    if (node.kind === "transaction") {
      return {
        id: node.id,
        type: "default",
        position: { x: 0, y: 0 },
        data: {
          kind: node.kind,
          label: (
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.22em] opacity-80">
                Transacción
              </div>
              <div className="mt-1 text-base font-black tracking-wide">
                {node.name}
              </div>
              {node.uuaa ? <div className="text-[10px]">UUAA {node.uuaa}</div> : null}
            </div>
          ),
        },
        draggable: true,
        selectable: true,
        style: {
          minWidth: 230,
          borderRadius: 24,
          padding: 16,
          border: `2px solid ${colors.border}`,
          background: colors.bg,
          color: colors.text,
          boxShadow: colors.glow,
        },
      } satisfies Node;
    }

    const radius = level === 1 ? 420 : level === 2 ? 760 : 960;
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    return {
      id: node.id,
      type: "default",
      position: { x, y },
      data: {
        kind: node.kind,
        label: (
          <div className="text-center">
            <div className="text-[10px] uppercase tracking-wide opacity-70">
              {getNodeKindLabel(node)}
            </div>
            <div className="mt-1 font-bold">{node.name}</div>
            {node.uuaa ? <div className="text-[10px] opacity-80">{node.uuaa}</div> : null}
          </div>
        ),
      },
      draggable: true,
      selectable: true,
      style: {
        minWidth: node.kind === "utility" ? 165 : 190,
        borderRadius: 20,
        padding: 12,
        border: `1.5px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
        boxShadow: colors.glow,
      },
    } satisfies Node;
  });

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: "smoothstep",
    animated: edge.type === "IMPLEMENTATION_TO_UTILITY",
    style: {
      strokeWidth: edge.type === "IMPLEMENTATION_TO_UTILITY" ? 2.25 : 1.7,
      stroke:
        edge.type === "IMPLEMENTATION_TO_UTILITY"
          ? GRAPH_PALETTE.color5
          : edge.type === "LIBRARY_TO"
            ? GRAPH_PALETTE.color4
            : GRAPH_PALETTE.color3,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color:
        edge.type === "IMPLEMENTATION_TO_UTILITY"
          ? GRAPH_PALETTE.color5
          : edge.type === "LIBRARY_TO"
            ? GRAPH_PALETTE.color4
            : GRAPH_PALETTE.color3,
    },
    labelStyle: {
      fontSize: 10,
      fontWeight: 700,
      fill: "#e9fbff",
    },
    labelBgStyle: {
      fill: GRAPH_PALETTE.color2,
      fillOpacity: 0.86,
    },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 8,
  }));

  return { nodes: positionedNodes, edges };
}

export default function MonitoreoArbolDependencias() {
  const { sessionCookie, setSessionCookie } = useSessionCookie();
  const { bearerToken, setBearerToken } = useBearerToken();

  const [showCookie, setShowCookie] = useState(false);
  const [showBearerToken, setShowBearerToken] = useState(false);
  const [environment, setEnvironment] = useState<ApxConsoleEnvironment>("AUS");
  const [transactionsText, setTransactionsText] = useState("KUSUT02201ZZ");
  const [manualDepthLevel, setManualDepthLevel] = useState(1);
  const [ateneaFromDate, setAteneaFromDate] = useState(() =>
    toDateTimeLocalValue(getDefaultFromDate())
  );
  const [ateneaToDate, setAteneaToDate] = useState(() =>
    toDateTimeLocalValue(getDefaultToDate())
  );
  const [ateneaSite, setAteneaSite] = useState("LIVE-02");
  const [ateneaChannelCode, setAteneaChannelCode] = useState("");
  const [selectedTransaction, setSelectedTransaction] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DependencyTreeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transactionList = useMemo(
    () => parseTransactionList(transactionsText),
    [transactionsText]
  );

  const selectedTransactionResult = useMemo(() => {
    const transactions = result?.transactions ?? [];

    return (
      transactions.find((item) => item.transactionName === selectedTransaction) ??
      transactions[0] ??
      null
    );
  }, [result, selectedTransaction]);

  const consolidatedRows = useMemo(
    () =>
      groupComparisonRowsByTransaction(
        result?.comparisonRows ?? [],
        result?.transactions ?? []
      ),
    [result]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return consolidatedRows;

    return consolidatedRows.filter((row) => row.searchText.includes(q));
  }, [consolidatedRows, search]);

  const graphData = useMemo(() => {
    if (!selectedTransactionResult) {
      return { nodes: [], edges: [] };
    }

    return buildReactFlowData(selectedTransactionResult.graph);
  }, [selectedTransactionResult]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(graphData.nodes);
    setEdges(graphData.edges);
  }, [graphData.nodes, graphData.edges, setNodes, setEdges]);

  const totalLibraries = useMemo(() => {
    return new Set(
      (result?.comparisonRows ?? []).flatMap((row) => row.operationLibraries)
    ).size;
  }, [result]);

  const totalUtilities = useMemo(() => {
    return new Set((result?.comparisonRows ?? []).map((row) => row.utility)).size;
  }, [result]);

  const totalMissingInAtenea = useMemo(() => {
    return (result?.comparisonRows ?? []).reduce(
      (sum, row) => sum + row.missingInAtenea.length,
      0
    );
  }, [result]);

  const handleSearch = async () => {
    const fromDate = parseDateTimeLocalValue(ateneaFromDate);
    const toDate = parseDateTimeLocalValue(ateneaToDate);

    if (!sessionCookie.trim()) {
      toast.error("La cookie de sesión APX Console es requerida.");
      return;
    }

    if (!bearerToken.trim()) {
      toast.error("El Bearer token de Atenea es requerido para comparar librerías.");
      return;
    }

    if (!fromDate || !toDate) {
      toast.error("Las fechas de Atenea no son válidas.");
      return;
    }

    if (fromDate >= toDate) {
      toast.error("La fecha desde debe ser menor que la fecha hasta.");
      return;
    }

    if (!transactionList.length) {
      toast.error("Agrega al menos una transacción.");
      return;
    }

    setLoading(true);
    setError(null);
    setBearerToken(bearerToken.trim());

    try {
      const data = await fetchDependencyTreeForTransactions({
        environment,
        sessionCookie: sessionCookie.trim(),
        transactions: transactionList,
        manualDepthLevel,
        atenea: {
          bearerToken: bearerToken.trim(),
          fromDate,
          toDate,
          site: ateneaSite.trim() || undefined,
          channelCode: ateneaChannelCode.trim() || undefined,
        },
      });

      setResult(data);
      setSelectedTransaction(data.transactions[0]?.transactionName ?? "");
      toast.success("Árbol y comparativa cargados correctamente.");
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

    const csv = buildComparisonCsv(filteredRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `arbol_dependencias_comparativa_${environment}.csv`;
    link.click();

    URL.revokeObjectURL(url);
    toast.success("CSV descargado correctamente.");
  };

  return (
    <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
      <LoadingOverlay show={loading} />

      <section className="rounded-3xl border border-border/60 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sky-200">
              <Network className="h-5 w-5" />
              <span className="text-sm font-semibold uppercase tracking-[0.2em]">
                Monitoreo Consola APX + Atenea
              </span>
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              Monitoreo Árbol de Dependencias
            </h1>
           
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
              <div className="text-2xl font-bold">
                {formatNumber(result?.transactions.length ?? 0)}
              </div>
              <div className="text-xs text-slate-300">Transacciones comparadas </div>
            </div>
          
            
          </div>
        </div>
      </section>

      <Card className="rounded-3xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Búsqueda
          </CardTitle>
          <CardDescription>
            Pega una lista de transacciones sin guiones separadas por salto de línea.
            Atenea se consulta sin guiones y la Consola de Operaciones se consulta
            automáticamente con formato KUSUT022-01-ZZ.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 xl:grid-cols-[1.2fr_1fr_1fr]">
          <div className="space-y-2">
            <Label>Transacciones</Label>
            <Textarea
              value={transactionsText}
              onChange={(event) => setTransactionsText(event.target.value)}
              className="min-h-[212px] font-mono text-xs"
              placeholder={`KUSUT02201ZZ\nXXXXT00101XX\nYYYYT00201YY`}
            />
            <p className="text-xs text-muted-foreground">
              Detectadas para Atenea: {transactionList.length ? transactionList.join(", ") : "-"}
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Cookie de sesión APX Console</Label>
              <div className="flex gap-2">
                <Input
                  type={showCookie ? "text" : "password"}
                  value={sessionCookie}
                  onChange={(event) => setSessionCookie(event.target.value)}
                  placeholder="SESSION=..."
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCookie((value) => !value)}
                >
                  {showCookie ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Entorno consola</Label>
                <Select
                  value={environment}
                  onValueChange={(value) =>
                    setEnvironment(value as ApxConsoleEnvironment)
                  }
                >
                  <SelectTrigger>
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
              </div>

              <div className="space-y-2">
                <Label>Profundidad</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={manualDepthLevel}
                  onChange={(event) =>
                    setManualDepthLevel(
                      Math.max(1, Number(event.target.value || 1))
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Bearer token Atenea</Label>
              <div className="flex gap-2">
                <Input
                  type={showBearerToken ? "text" : "password"}
                  value={bearerToken}
                  onChange={(event) => setBearerToken(event.target.value)}
                  placeholder="Bearer token MU/Atenea"
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowBearerToken((value) => !value)}
                >
                  {showBearerToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Desde Atenea</Label>
                <Input
                  type="datetime-local"
                  value={ateneaFromDate}
                  onChange={(event) => setAteneaFromDate(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Hasta Atenea</Label>
                <Input
                  type="datetime-local"
                  value={ateneaToDate}
                  onChange={(event) => setAteneaToDate(event.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Site Atenea</Label>
                <Select value={ateneaSite} onValueChange={setAteneaSite}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATENEA_SITES.map((site) => (
                      <SelectItem key={site} value={site}>
                        {site}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Canal Atenea opcional</Label>
                <Input
                  value={ateneaChannelCode}
                  onChange={(event) => setAteneaChannelCode(event.target.value)}
                  placeholder="Ej. MG"
                />
              </div>
            </div>

            <Button onClick={handleSearch} className="h-12 w-full rounded-xl">
              <GitBranch className="mr-2 h-4 w-4" />
              Buscar y comparar
            </Button>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <section className="space-y-6">
          <Card className="overflow-hidden rounded-3xl border border-[#146384]/40 bg-white shadow-sm">
            <CardHeader className="border-b border-[#146384]/40 bg-[#122e41]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#20dad8]">
                    Monitoreo
                  </p>
                  <CardTitle className="mt-1 flex items-center gap-2 text-white">
                    <Boxes className="h-5 w-5 text-[#20dad8]" />
                    Árbol de dependencias
                  </CardTitle>
                
                </div>

                <div className="w-full lg:w-[340px]">
                  <Select
                    value={selectedTransactionResult?.transactionName ?? ""}
                    onValueChange={setSelectedTransaction}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona una TRX" />
                    </SelectTrigger>
                    <SelectContent>
                      {result.transactions.map((item) => (
                        <SelectItem
                          key={item.transactionName}
                          value={item.transactionName}
                        >
                          {item.transactionName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="h-[760px] overflow-hidden bg-[#122e41]">
                {graphData.nodes.length ? (
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    nodesDraggable
                    elementsSelectable
                    nodesConnectable={false}
                    panOnDrag
                    selectionOnDrag
                    fitView
                    minZoom={0.12}
                    maxZoom={2}
                    colorMode="dark"
                    className="bg-[#122e41]"
                    defaultEdgeOptions={{
                      type: "smoothstep",
                      style: {
                        stroke: GRAPH_PALETTE.color4,
                        strokeWidth: 2.25,
                      },
                      markerEnd: {
                        type: MarkerType.ArrowClosed,
                        color: GRAPH_PALETTE.color4,
                      },
                    }}
                  >
                    <Background gap={24} size={1.1} color={GRAPH_PALETTE.color3} />
                    <Controls className="!border-[#146384]/70 !bg-[#12090e]/80 !shadow-lg [&_button]:!border-[#146384]/60 [&_button]:!bg-[#122e41] [&_button:hover]:!bg-[#146384] [&_button_svg]:!fill-[#20dad8]" />
                    <MiniMap
                      pannable
                      zoomable
                      nodeColor={getNodeMiniMapColor}
                      nodeStrokeColor={GRAPH_PALETTE.color5}
                      maskColor="rgba(18, 46, 65, 0.78)"
                      className="!border !border-[#146384]/70 !bg-[#12090e]/70"
                    />
                  </ReactFlow>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No hay grafo para mostrar.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>Tabla comparativa</CardTitle>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Filtrar tabla..."
                    className="w-full sm:w-[260px]"
                  />
                  <Button variant="outline" onClick={handleDownloadCsv}>
                    Descargar CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
      

              <div className="relative max-h-[620px] overflow-auto rounded-2xl border bg-background">
                <table className="w-full min-w-[2300px] border-separate border-spacing-0 text-sm">
                  <thead className="sticky top-0 z-40">
                    <tr className="bg-background text-foreground shadow-sm">
                      <th className="sticky left-0 top-0 z-50 w-[240px] min-w-[240px] border-b border-r bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Transacción
                      </th>
                      <th className="sticky top-0 z-40 w-[330px] min-w-[330px] border-b border-r bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Librerías por Utilidad [Árbol de Dependencias]
                      </th>
                      <th className="sticky top-0 z-40 w-[360px] min-w-[360px] border-b border-r bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Librerías ejecutadas en Atenea / Árbol de Dependencias
                      </th>
                      <th className="sticky top-0 z-40 w-[390px] min-w-[390px] border-b border-r bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Librerías NO EJECUTADAS en Atenea / Árbol de Dependencias
                      </th>
                      <th className="sticky top-0 z-40 w-[310px] min-w-[310px] border-b border-r bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Queries JDBC [.properties]
                      </th>
                      <th className="sticky top-0 z-40 w-[300px] min-w-[300px] border-b border-r bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Resumen SQL JDBC [.properties]
                      </th>
                      <th className="sticky top-0 z-40 w-[420px] min-w-[420px] border-b bg-background px-5 py-6 text-left align-middle text-sm font-bold leading-snug tracking-wide text-foreground">
                        Ejecución queries Atenea [.properties vs Atenea]
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? (
                      filteredRows.map((row) => (
                        <tr
                          key={row.transactionName}
                          className="align-top bg-background hover:bg-muted/40"
                        >
                          <td className="sticky left-0 z-20 border-b border-r bg-background px-5 py-4 font-mono text-xs font-semibold text-foreground">
                            {row.transactionName}
                          </td>
                          <td className="border-b border-r px-5 py-4 align-top">
                            <UtilitySectionsCell
                              sections={row.utilitySections}
                              emptyLabel="Sin librerías"
                            />
                          </td>
                          <td className="border-b border-r px-5 py-4 align-top">
                            <UtilitySectionsCell
                              sections={row.executedSections}
                              emptyLabel="Sin ejecuciones en Atenea"
                              tone="success"
                            />
                          </td>
                          <td className="border-b border-r px-5 py-4 align-top">
                            <UtilitySectionsCell
                              sections={row.missingSections}
                              emptyLabel="Sin faltantes"
                              tone="warning"
                            />
                          </td>
                          <td className="border-b border-r px-5 py-4 align-top">
                            <JdbcQueriesCell
                              queryInfos={row.jdbcQueryInfos}
                              mode="queries"
                            />
                          </td>
                          <td className="border-b border-r px-5 py-4 align-top">
                            <JdbcQueriesCell
                              queryInfos={row.jdbcQueryInfos}
                              mode="summary"
                            />
                          </td>
                          <td className="border-b px-5 py-4 align-top">
                            <JdbcQueryExecutionCell queryInfos={row.jdbcQueryInfos} />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="h-32 border-b px-5 py-8 text-center text-sm text-muted-foreground"
                        >
                          No hay registros para mostrar.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
