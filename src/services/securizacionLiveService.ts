import { format } from "date-fns";
import { apiRequest, buildAuthHeaders } from "./httpClient";
import { dateRangeToNano } from "./dateUtils";
import type { NanoTimestamp } from "@/types/bbva";

const OMEGA_LIVE_BASE = "https://omega.live-02.nextgen.igrupobbva";
const RHO_LIVE_BASE = "https://rho.live-02.nextgen.igrupobbva";

interface OmegaLogItem {
  recordDate?: number;
  namespace?: string;
  level?: string;
  message?: string;
  spanId?: string;
  traceId?: string;
  properties?: {
    block?: string;
    env?: string;
    hostname?: string;
    nameLog?: string;
    readerProvider?: string;
    site?: string;
    thread?: string;
    typeLog?: string;
    typology?: string;
    uid?: string;
  };
}

interface OmegaLogsResponse {
  data?: OmegaLogItem[];
}

interface RhoTraceNode {
  namespace?: string;
  recordDate?: number;
  duration?: number;
  finishDate?: number;
  mrId?: string;
  name?: string;
  parentSpan?: string;
  properties?: Record<string, string | number>;
  spanId?: string;
  startDate?: number;
  traceId?: string;
  _region?: string;
  children?: RhoTraceNode[];
}

export interface SecurizacionLiveRow {
  fechaEjecucion: string;
  errorMessage: string;
  applicationUUAA: string;
  invokedparam: string;
  invokerLibrary: string;
  invokerTx: string;
  spanId: string;
  traceId: string;
}

export interface SecurizacionLiveResult {
  fromDate: string;
  toDate: string;
  totalRegistros: number;
  rows: SecurizacionLiveRow[];
}

function buildOmegaLogsUrl(params: {
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
}): string {
  const { fromTimestamp, toTimestamp } = params;

  const url = new URL("/v1/ns/apx.online/logs", OMEGA_LIVE_BASE);
  url.searchParams.set("q", `message == "with protocol HTTPS*"`);
  url.searchParams.set("sort", "descending");
  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);

  return url.toString();
}

function buildRhoTraceUrl(params: {
  spanId: string;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
}): string {
  const { spanId, fromTimestamp, toTimestamp } = params;

  const url = new URL(
    `/v1/ns/apx.online/mrs/RhoTraces/spans/${spanId}:trace`,
    RHO_LIVE_BASE
  );

  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("profile", "default");
  url.searchParams.set("crossRegion", "false");

  return url.toString();
}

function nanoToDisplayDate(nano?: number): string {
  if (!nano || !Number.isFinite(nano)) return "-";
  const millis = Number(String(Math.trunc(nano)).slice(0, 13));
  if (!Number.isFinite(millis)) return "-";
  return format(new Date(millis), "dd/MM/yyyy HH:mm:ss");
}

function flattenTrace(node: RhoTraceNode | null | undefined): RhoTraceNode[] {
  if (!node) return [];

  const out: RhoTraceNode[] = [];

  const walk = (current: RhoTraceNode) => {
    out.push(current);
    if (Array.isArray(current.children)) {
      current.children.forEach(walk);
    }
  };

  walk(node);
  return out;
}

function getBestUtilityNode(trace: RhoTraceNode): RhoTraceNode | null {
  const nodes = flattenTrace(trace);

  const exactUtility = nodes.find(
    (node) =>
      String(node.properties?.type ?? "") === "Utility" &&
      (
        String(node.properties?.invokedparam ?? "").trim() ||
        String(node.properties?.invokerLibrary ?? "").trim() ||
        String(node.properties?.invokerTx ?? "").trim()
      )
  );

  if (exactUtility) return exactUtility;

  const anyNodeWithData = nodes.find(
    (node) =>
      String(node.properties?.invokedparam ?? "").trim() ||
      String(node.properties?.invokerLibrary ?? "").trim() ||
      String(node.properties?.invokerTx ?? "").trim()
  );

  return anyNodeWithData ?? null;
}

function mapTraceAndLogToRow(log: OmegaLogItem, trace: RhoTraceNode): SecurizacionLiveRow {
  const utilityNode = getBestUtilityNode(trace);
  const rootProps = trace.properties ?? {};
  const utilityProps = utilityNode?.properties ?? {};

  return {
    fechaEjecucion: nanoToDisplayDate(log.recordDate ?? trace.recordDate),
    errorMessage: String(log.message ?? "").trim() || "-",
    applicationUUAA: String(rootProps.applicationUUAA ?? "").trim() || "-",
    invokedparam: String(utilityProps.invokedparam ?? "").trim() || "-",
    invokerLibrary: String(utilityProps.invokerLibrary ?? "").trim() || "-",
    invokerTx:
      String(utilityProps.invokerTx ?? "").trim() ||
      String(trace.name ?? "").trim() ||
      "-",
    spanId: String(log.spanId ?? trace.spanId ?? "").trim() || "-",
    traceId: String(log.traceId ?? trace.traceId ?? "").trim() || "-",
  };
}

export async function fetchSecurizacionLive(params: {
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
}): Promise<SecurizacionLiveResult> {
  const { fromDate, toDate, bearerToken } = params;

  const { from, to } = dateRangeToNano(fromDate, toDate);
  const headers = buildAuthHeaders(bearerToken);

  const omegaUrl = buildOmegaLogsUrl({
    fromTimestamp: from,
    toTimestamp: to,
  });

  const omegaRes = await apiRequest<OmegaLogsResponse>(omegaUrl, { headers });
  const omegaLogs = Array.isArray(omegaRes.data) ? omegaRes.data : [];

  const dedupedLogs = omegaLogs.filter(
    (item, index, arr) =>
      item.spanId &&
      arr.findIndex((x) => x.spanId === item.spanId) === index
  );

  const rows = await Promise.all(
    dedupedLogs.map(async (log) => {
      if (!log.spanId) return null;

      try {
        const rhoUrl = buildRhoTraceUrl({
          spanId: log.spanId,
          fromTimestamp: from,
          toTimestamp: to,
        });

        const trace = await apiRequest<RhoTraceNode>(rhoUrl, { headers });
        return mapTraceAndLogToRow(log, trace);
      } catch {
        return {
          fechaEjecucion: nanoToDisplayDate(log.recordDate),
          errorMessage: String(log.message ?? "").trim() || "-",
          applicationUUAA: "-",
          invokedparam: "-",
          invokerLibrary: "-",
          invokerTx: "-",
          spanId: String(log.spanId ?? "").trim() || "-",
          traceId: String(log.traceId ?? "").trim() || "-",
        } satisfies SecurizacionLiveRow;
      }
    })
  );

  const cleanRows = rows.filter((row): row is SecurizacionLiveRow => Boolean(row));

  return {
    fromDate: format(fromDate, "dd/MM/yyyy HH:mm"),
    toDate: format(toDate, "dd/MM/yyyy HH:mm"),
    totalRegistros: cleanRows.length,
    rows: cleanRows,
  };
}