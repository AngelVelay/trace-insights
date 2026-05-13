import type {
  ClassifiedTraces,
  MetricsFilters,
  NormalizedSpan,
} from "@/types/bbva";
import { apiRequest, buildAuthHeaders } from "./httpClient";

const RHO_BASE = "https://rho.live-02.nextgen.igrupobbva";

export interface RhoSpan {
  id?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  service?: string;
  duration?: number;
  properties?: Record<string, unknown>;
}

export interface RhoSpansResponse {
  data?: RhoSpan[];
  spans?: RhoSpan[];
  items?: RhoSpan[];
  buckets?: RhoSpan[];
}

export interface ClassifiedSpan {
  id?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  service?: string;
  duration?: number;
  properties?: Record<string, unknown>;
  label: string;
  utilitytype?: string;
  invokerLibrary?: string;
  invokedparam?: string;
  databaseInstance?: string;
  collection?: string;
  databaseQuery?: string;
  channelCode?: string;
  site?: string;
}

function extractSpans(response: RhoSpansResponse): RhoSpan[] {
  return response.data ?? response.spans ?? response.items ?? response.buckets ?? [];
}

function formatDateForRho(date: Date): string {
  return date.toISOString();
}

function buildRhoSpanSearchUrl(params: {
  invokerTx: string;
  fromDate: string;
  toDate: string;
  site?: string;
  channelCode?: string;
  channelCodes?: string[];
}): string {
  const { invokerTx, fromDate, toDate, site, channelCode, channelCodes } =
    params;

  const selectedChannelCodes = channelCodes?.length
    ? channelCodes
    : channelCode
      ? [channelCode]
      : [];

  const filters: string[] = [
    `name == "**"`,
    `properties.invokerTx == "${invokerTx}"`,
  ];

  if (site?.trim()) {
    filters.push(`properties.site == "${site.trim()}"`);
  }

  const channelFilter = buildRhoChannelCodeFilter(selectedChannelCodes);

  if (channelFilter) {
    filters.push(channelFilter);
  }

  const q = filters.join(" and ");

  const url = new URL("/v1/ns/apx.online/spans", RHO_BASE);

  url.searchParams.set("q", q);
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromDate);
  url.searchParams.set("toDate", toDate);
  url.searchParams.set(
    "properties",
    [
      "channel-code",
      "environ-code",
      "env",
      "product-code",
      "returncode",
      "utilitytype",
      "invokerTx",
      "invokerLibrary",
      "invokedparam",
      "databaseInstance",
      "collection",
      "databaseQuery",
      "site",
    ].join(",")
  );
  url.searchParams.set("profile", "default");

  return url.toString();
}

function removeChannelCodeFilter(filters: MetricsFilters): MetricsFilters {
  return {
    ...filters,
    channelCode: undefined,
  };
}
function getPropertyValue(
  properties: Record<string, unknown>,
  key: string
): string {
  return String(properties[key] ?? "").trim();
}

function getSpanLabel(span: RhoSpan): string {
  const props = span.properties ?? {};

  const utilitytype = getPropertyValue(props, "utilitytype");
  const invokerLibrary = getPropertyValue(props, "invokerLibrary");
  const invokedparam = getPropertyValue(props, "invokedparam");

  const databaseInstance = getPropertyValue(props, "databaseInstance");
  const collection = getPropertyValue(props, "collection");
  const databaseQuery = getPropertyValue(props, "databaseQuery");

  if (utilitytype || invokerLibrary || invokedparam) {
    return [utilitytype, invokerLibrary, invokedparam]
      .filter(Boolean)
      .join(" / ");
  }

  if (databaseInstance || collection || databaseQuery) {
    return [databaseInstance, collection, databaseQuery]
      .filter(Boolean)
      .join(" / ");
  }

  return span.name ?? span.id ?? "span";
}

export function classifySpans(
  spans: Array<RhoSpan | NormalizedSpan> = []
): ClassifiedSpan[] {
  return spans.map((span) => {
    const props = span.properties ?? {};

    const utilitytype = getPropertyValue(props, "utilitytype");
    const utilityType = getPropertyValue(props, "utilityType");

    const invokerLibrary = getPropertyValue(props, "invokerLibrary");
    const invokedparam = getPropertyValue(props, "invokedparam");

    const databaseInstance = getPropertyValue(props, "databaseInstance");
    const collection = getPropertyValue(props, "collection");
    const databaseQuery = getPropertyValue(props, "databaseQuery");

    const channelCode = getPropertyValue(props, "channel-code");
    const site = getPropertyValue(props, "site");

    return {
      ...span,
      label: getSpanLabel(span),
      utilitytype: utilitytype || utilityType,
      invokerLibrary,
      invokedparam,
      databaseInstance,
      collection,
      databaseQuery,
      channelCode,
      site,
    };
  });
}

function buildTraceSummary(spans: RhoSpan[]): string {
  if (!spans.length) {
    return "Sin trazas encontradas";
  }

  const classified = classifySpans(spans);

  const labels = classified.map((span) => span.label).filter(Boolean);
  const uniqueLabels = Array.from(new Set(labels));

  const preview = uniqueLabels.slice(0, 10).join(" → ");
  const suffix =
    uniqueLabels.length > 10 ? ` → ... +${uniqueLabels.length - 10}` : "";

  return [
    `Total de saltos encontrados: ${uniqueLabels.length}`,
    preview ? `Secuencia: ${preview}${suffix}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function fetchSpans(
  filters: MetricsFilters,
  invokerTx: string
): Promise<RhoSpan[]> {
  const fromDate = formatDateForRho(filters.fromDate);
  const toDate = formatDateForRho(filters.toDate);

  const search = async (currentFilters: MetricsFilters): Promise<RhoSpan[]> => {
    const url = buildRhoSpanSearchUrl({
      invokerTx,
      fromDate,
      toDate,
      site: currentFilters.site,
      channelCode: currentFilters.channelCode,
    });

    console.log("[RHO spans URL]", url);

    const response = await apiRequest<RhoSpansResponse>(url, {
      headers: buildAuthHeaders(currentFilters.bearerToken),
    });

    return extractSpans(response);
  };

  const spansWithChannel = await search(filters);

  if (spansWithChannel.length > 0 || !filters.channelCode?.trim()) {
    return spansWithChannel;
  }

  console.warn(
    `[RHO spans] Sin trazas para invokerTx=${invokerTx} con channel-code=${filters.channelCode}. Reintentando sin channel-code.`
  );

  return search(removeChannelCodeFilter(filters));
}

export async function fetchTraceSummaryForInvokerTx(
  filters: MetricsFilters,
  invokerTx: string
): Promise<string> {
  const spans = await fetchSpans(filters, invokerTx);
  return buildTraceSummary(spans);
}

function normalizeProperties(
  properties: Record<string, unknown> = {}
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value == null ? "" : String(value),
    ])
  );
}

function getSelectedChannelCodes(filters: MetricsFilters): string[] {
  const codes = filters.channelCodes?.length
    ? filters.channelCodes
    : filters.channelCode
      ? [filters.channelCode]
      : [];

  return Array.from(
    new Set(
      codes
        .map((code) => String(code).trim())
        .filter((code) => code && code !== "all")
    )
  );
}

function buildRhoChannelCodeFilter(channelCodes: string[]): string | undefined {
  if (!channelCodes.length) return undefined;

  const clauses = channelCodes.map(
    (code) => `properties.channel-code == "${code}"`
  );

  if (clauses.length === 1) {
    return clauses[0];
  }

  return `(${clauses.join(" or ")})`;
}

export function normalizeSpans(spans: RhoSpan[] = []): NormalizedSpan[] {
  return spans.map((span) => {
    const props = normalizeProperties(span.properties ?? {});

    const utilityType = String(
      props.utilitytype ?? props.utilityType ?? ""
    ).trim();

    const durationMs = Number(
      span.duration ??
        props.durationMs ??
        props.duration ??
        props.span_duration ??
        0
    );

    return {
      id: String(span.id ?? span.spanId ?? crypto.randomUUID()),
      traceId: String(span.traceId ?? ""),
      spanId: String(span.spanId ?? span.id ?? ""),
      parentSpanId: span.parentSpanId ? String(span.parentSpanId) : undefined,
      name: String(span.name ?? ""),
      service: String(span.service ?? ""),
      durationMs,
      utilityType,
      properties: props,
    };
  });
}