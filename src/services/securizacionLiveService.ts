import { format } from "date-fns";
import { apiRequest, buildAuthHeaders } from "./httpClient";
import { dateRangeToNano } from "./dateUtils";
import type { NanoTimestamp } from "@/types/bbva";

const OMEGA_LIVE_BASE = "https://omega.live-02.nextgen.igrupobbva";
const RHO_LIVE_BASE = "https://rho.live-02.nextgen.igrupobbva";

const OMEGA_PAGE_SIZE = 100;
const OMEGA_MAX_PAGES = 500;

const AAP_CATALOG: Record<string, string> = {
  "00000000": "BCom (Personas)",
  "00000033": "GNC Intraday",
  "10000002": "BCom (Pymes)",
  "10000003": "APX (BackEnd)",
  "10000007": "Intranet",
  "10000008": "Web Methods (BackEnd)",
  "10000011": "BCom (Público)",
  "10000017": "Fiduciario (Privado)",
  "10000023": "Comercio Exterior",
  "10000025": "Cajero Híbrido",
  "10000027": "GCC - Nuevo SAC",
  "10000028": "Portal Extranet",
  "10000029": "Gestión de Empresas",
  "10000033": "GloMo",
  "10000036": "CCZ",
  "10000038": "Fiduciario (Máquina)",
  "10000040": "Plataforma Fiscal",
  "10000041": "GCC - IVR (Público)",
  "10000042": "GCC - IVR (Privado)",
  "10000043": "SAP Arrendamiento",
  "10000044": "Terminal Financiero (Máquina)",
  "10000045": "Arquitectura Seguridad",
  "10000047": "Calypso",
  "10000048": "MAC RUC",
  "10000050": "Gestor de Transmisiones",
  "10000051": "MSD",
  "10000053": "IVR Legacy",
  "10000054": "H2H (BNC)",
  "10000055": "H2H (Máquina)",
  "10000056": "AACC (Final)",
  "10000057": "EECC (Final)",
  "10000058": "Amelia - Aclaraciones",
  "10000059": "Max Mistral (Sales Force)",
  "10000061": "Pagos Ripple",
  "10000062": "Auto Alerta (Público)",
  "10000063": "Claim Center (Máquina)",
  "10000064": "GPS Ajustadores",
  "10000065": "GCC - IVR Preguntas (Privado)",
  "10000066": "Gestor de Mensajes",
  "10000067": "H2H APX (Máquina)",
  "10000068": "Auto Alerta (Privado)",
  "10000070": "H2H - HelpDesk",
  "10000071": "Comercio Exterior en BankTrade",
  "10000072": "BNC",
  "10000074": "Extranet (No clientes)",
  "10000075": "Extranet (Público)",
  "10000077": "Gestión de Liquidez",
  "10000079": "Prestanet ATA y Seguros",
  "10000080": "APIs Empresariales",
  "10000081": "SICA",
  "10000083": "CyberFinancial Front",
  "10000084": "SIP2000",
  "10000085": "GloMo (Público)",
  "10000088": "GloMo (Enrolamiento)",
  "10000093": "Procredit 2.0",
  "10000094": "Stand In de Canales (stand-in)",
  "10000095": "ATM",
  "10000098": "BeneflexMAX",
  "10000099": "CF Broker Marsh",
  "10000100": "Comercio Exterior en BankTrade (PyMEs)",
  "10000106": "CyberFinancial",
  "10000110": "Podio Virtual Privado",
  "10000111": "Promotores Hipotecarios (privado)",
  "10000112": "Promotores Hipotecarios (publico)",
  "10000113": "LeaseCloud (Privado)",
  "10000115": "My Business (Público)",
  "10000116": "Multicanal de Seguros MFSA",
  "10000117": "API Market Test (pruebas)",
  "10000118": "JBPM (Privado)",
  "10000120": "Seguros WEB Público",
  "10000121": "Wibe WEB Privado / OpenMarket WEB Privado",
  "10000125": "LOG ATM's",
  "10000126": "USAC - IVR",
  "10000128": "Onboarding Digital",
  "10000129": "Bandas Salariales WEB Privado",
  "10000130": "NetCash Público",
  "10000131": "Bcom Cells Público",
  "10000132": "App Somos Privado",
  "10000133": "Gema Privado",
  "10000134": "BBVA SOS Privado",
  "10000135": "BBVA SOS (No clientes - Privado)",
  "10000136": "PureCloud Interbacked",
  "10000137": "Salesforce",
  "10000138": "Chatbot Público",
  "10000139": "Universidad BBVA Privado",
  "10000141": "Voz del Cliente Privado",
  "10000142": "Calypso OTC Privado",
  "10000143": "Seguros Movil Privado",
  "10000144": "Seguros Movil Público",
  "10000145": "Calypso GCE Privado",
  "10000146": "Seguros dinámico Privado",
  "10000147": "Seguros dinámico Público",
  "10000148": "LeasingDigital Público",
  "10000151": "Remote Digital Banker",
  "10000152": "BNC Privado",
  "10000153": "BNC Alpha Privado",
  "10000154": "API Market Banxico",
  "10000155": "H2H Sterling Privado",
  "10000156": "GEMA Corporativo Privado",
  "10000157": "API Channel Enterprise Frontal Privado",
  "10000158": "Seguros Wibe Privado",
  "10000159": "Cyber Notarial Privado",
  "10000160": "CaS ATMs",
  "10000162": "PAC-CFDI",
  "10000163": "Journey TDC 2Play Público",
  "10000164": "Onboarding FX Privado",
  "10000165": "Eikos&Seguros Privado",
  "10000166": "Seguros Partners Público",
  "10000167": "Seguros Partners Privado",
  "10000168": "mPOS PYME Privado",
  "10000169": "BPyP Privado IB",
  "10000170": "Portal IGBC Privado",
  "10000171": "Soluciones WOW Zappar Privado",
  "10000172": "Hipotecario Individual RI Privado",
  "10000173": "GloMo Enrolamiento QR",
  "10000174": "GEMA mPOS Público",
  "10000176": "LíneaBBVA Público",
  "10000177": "mPOS SMEs Privado IB",
  "10000178": "Equities Investment Solution Privado",
  "10000179": "Contact Center Público",
  "10000180": "Lynx (BackEnd)",
  "10000181": "Cuenta eje Privado",
  "10000182": "Cuenta eje Público",
  "10000183": "Genesys Cloud IVR Privado",
  "10000184": "OBS TDD Chip Privado",
  "10000185": "Estudio Socioeconómico Privado",
  "10000186": "Senda Pymes Privada",
  "10000187": "GloMo lowcost",
  "10000188": "AACC full Cells",
  "10000189": "Onboarding FX Público",
  "10000190": "Alianzas Partnerships Seguros Privado",
  "10000191": "Alianzas Partnerships Seguros Público",
  "10000192": "BCom Personas Privado",
  "10000193": "BCom Pymes Privado",
  "10000194": "EECC full Cells (EVA)",
  "10000195": "BTGE Monitor F-T Privado",
  "10000196": "Combo Consumo+TDC Privado",
  "10000197": "ServiceNow-Remdy",
  "10000199": "Discovery Seguros Privado",
  "10000200": "Cerberos Connector IB",
  "10000201": "RVTA eGlobal",
  "10000202": "GUIA Privado",
  "10000203": "GUIA Privado IB",
  "10000204": "Bcom F Cells Stand In Privado (stand-in)",
  "10000206": "Onboarding Transversal DIY Privado",
  "10000207": "Senda BNC Privada",
  "10000208": "Front Bandera StandIn Privado",
  "10000209": "Tableros Cash Management IB",
  "10000210": "ASD web cells Público",
  "10000211": "Bcom Full Cells F Privado",
  "10000215": "Bcom Cells GloMo Privado",
  "10000216": "Tracking Hipotecario - noClientes / Tracking Hipotecario - Privado",
  "10000217": "Extranet Bastanteo Cells Privado",
  "10000218": "MTRE Gateway Privado",
  "10000219": "Stand In Gema Privado",
  "10000220": "API Channel Privado",
  "10000221": "BOT Cobranza Público",
  "10000222": "IVR Seguros Autoservicio Privado",
  "10000223": "Stand In SENDA Pymes Privada",
  "10000224": "Stand In SENDA BNC Privada",
  "10000225": "Transformación Backoffice Canales Digitales",
  "10000226": "Gestion PLD - CAR Privado",
  "10000227": "Digital Activation Gema Privado",
  "10000228": "Chat Asesor Linea BBVA Privado",
  "10000229": "FDT Cliente Sin Canal Pública",
  "10000230": "AWS VDC Interbackend",
  "10000231": "Digital Onboarding Gema noClientes Público",
  "10000232": "Reconexión Automática E-global Privado",
  "10000233": "Contratación Paperless Privado",
  "10000234": "Lectura PDFs Interbackend",
  "10000235": "Onboarding crediProvedores Anonimo",
  "10000236": "eDUA Privado",
  "10000237": "VoiceBot Cobranza Público",
  "10000238": "ATM Runtime Handler Privado",
  "10000239": "BNPL Apertura no clientes Pública",
  "10000240": "Seguros - CCM Multiasistencia Full Cells",
  "10000241": "Seguros - Landing Multiasistencia Público",
  "10000242": "CALYPSO_MCVO IB",
  "10000243": "GloMo enrolment no clientes",
  "10000244": "Feature Space ARIC",
  "10000245": "Tablero banca PYME",
  "10000246": "Firma Diferida Personas Físicas",
  "10000247": "Firma Diferida Personas Morales",
  "10000248": "AACC Microcréditos",
  "10000249": "Centra C&IB Full Cells",
  "10000250": "Record Keeping Privado",
  "10000251": "IVR Pensionados Caliope IB",
  "10000252": "ORBIT Privado",
  "10000253": "Audiocodes Core Interbackend",
  "10000254": "Enroll GEMA SoftToken Corporativo Privado",
  "10000255": "Enroll GEMA SoftToken PyME Privado",
  "10000256": "Contrapartes CIB IB",
  "10000257": "Record Keeping Management Privado",
  "10000258": "App Asesor Digital Privado",
  "10000259": "Whatsapp & SA Cliente Alto Valor IB",
  "10000260": "GCP CIB Privado",
  "10000261": "Blue GenAI Agent Privado",
  "10000800": "SSA Interbackend (Pruebas)",
  "10990003": "APX (Pruebas Interbackends)",
  "20000055": "API Channel Global Pivot Connect Público",
  "30000008": "CLAN Online",
  "30000009": "CLAN Batch",
  "30000016": "ARCE Provenir (gtOAuth)",
  "30000018": "PIVOT NET Movil Privado",
  "30000019": "GNC Intraday Web Privado",
  "30000026": "DWP ORGs Globales Privado",
  "30000030": "API Channel Backoffice full cells",
  "30000031": "APIC Portal Privado",
  "30000038": "ASO GATEWAY Pruebas",
  "30000041": "ARCE Corporate Rating System IB",
  "30000042": "Pago y conciliación B2B2B Privado",
  "30000043": "Open Banking B2B2C Consumo",
  "30000051": "Notificaciones ToHu-Visa IB",
  "30000052": "ASO Gateway",
  "30000055": "API Channel B2B Autoconsumo Público",
  "30000057": "API Channel B2B No Autoconsumo Privado",
  "30000059": "Login B2B2B Privado",
  "30000069": "Logs Arquitectura Privado",
  "30000072": "FRM IB",
  "30000073": "Open Banking B2B2C Connect Retail",
  "30000075": "ASOGW IB / Transformación Producto Pagos - Integración Producto Digital local de M",
  "30000078": "International Cashpooling Privado",
  "30000079": "Front KCSN Privado",
  "30000080": "Tablas Generales y Corporativas",
  "30000095": "ASO Gateway Tracking Streaming",
  "30000105": "Conversational HUB / AI Assistant Blue MX",
  "30000118": "Login Onboarding usuarios Público",
  "30000130": "Onboarding Portal Privado SandBox No cliente",
  "30000135": "Validación Backend Roles Privado",
  "30000136": "Validación Backend Roles Público",
};

function getAapName(aap: string | null | undefined): string {
  const normalized = String(aap ?? "").trim();

  if (!normalized || normalized === "-") {
    return "-";
  }

  const padded = normalized.padStart(8, "0");
  return AAP_CATALOG[padded] ?? "AAP sin nombre homologado";
}

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
    aap?: string;
    ["channel-code"]?: string;
    channelCode?: string;
    applicationUUAA?: string;
    invokedparam?: string;
    invokerLibrary?: string;
    invokerTx?: string;
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
  aap: string;
  aapName: string;
  channelCode: string;
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
  page?: number;
  size?: number;
}): string {
  const { fromTimestamp, toTimestamp, page = 0, size = OMEGA_PAGE_SIZE } = params;

  const url = new URL("/v1/ns/apx.online/logs", OMEGA_LIVE_BASE);
  url.searchParams.set("q", `message == "with protocol HTTPS*"`);
  url.searchParams.set("sort", "descending");
  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));

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

function getFirstPropertyValue(trace: RhoTraceNode, keys: string[]): string {
  const nodes = flattenTrace(trace);
  const rootProps = trace.properties ?? {};

  for (const key of keys) {
    const rootValue = rootProps[key];
    if (rootValue != null && String(rootValue).trim()) {
      return String(rootValue).trim();
    }
  }

  for (const node of nodes) {
    const props = node.properties ?? {};
    for (const key of keys) {
      const value = props[key];
      if (value != null && String(value).trim()) {
        return String(value).trim();
      }
    }
  }

  return "-";
}

function normalizeAap(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "-") return "-";
  return trimmed.padStart(8, "0");
}

function normalizeChannelCode(value: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || "-";
}

function mapTraceAndLogToRow(log: OmegaLogItem, trace: RhoTraceNode): SecurizacionLiveRow {
  const utilityNode = getBestUtilityNode(trace);
  const rootProps = trace.properties ?? {};
  const utilityProps = utilityNode?.properties ?? {};

  const aap = normalizeAap(
    String(log.properties?.aap ?? "").trim() ||
      String(rootProps.aap ?? "").trim() ||
      String(utilityProps.aap ?? "").trim() ||
      getFirstPropertyValue(trace, ["aap"])
  );

  const channelCode = normalizeChannelCode(
    String(log.properties?.["channel-code"] ?? "").trim() ||
      String(log.properties?.channelCode ?? "").trim() ||
      String(rootProps["channel-code"] ?? "").trim() ||
      String(rootProps.channelCode ?? "").trim() ||
      String(utilityProps["channel-code"] ?? "").trim() ||
      String(utilityProps.channelCode ?? "").trim() ||
      getFirstPropertyValue(trace, ["channel-code", "channelCode"])
  );

  return {
    fechaEjecucion: nanoToDisplayDate(log.recordDate ?? trace.recordDate),
    errorMessage: String(log.message ?? "").trim() || "-",
    applicationUUAA:
      String(rootProps.applicationUUAA ?? "").trim() ||
      String(log.properties?.applicationUUAA ?? "").trim() ||
      getFirstPropertyValue(trace, ["applicationUUAA"]) ||
      "-",
    invokedparam:
      String(utilityProps.invokedparam ?? "").trim() ||
      String(log.properties?.invokedparam ?? "").trim() ||
      "-",
    invokerLibrary:
      String(utilityProps.invokerLibrary ?? "").trim() ||
      String(log.properties?.invokerLibrary ?? "").trim() ||
      "-",
    invokerTx:
      String(utilityProps.invokerTx ?? "").trim() ||
      String(log.properties?.invokerTx ?? "").trim() ||
      String(trace.name ?? "").trim() ||
      "-",
    spanId: String(log.spanId ?? trace.spanId ?? "").trim() || "-",
    traceId: String(log.traceId ?? trace.traceId ?? "").trim() || "-",
    aap,
    aapName: getAapName(aap),
    channelCode,
  };
}

async function fetchAllOmegaLogs(params: {
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  headers: HeadersInit;
}): Promise<OmegaLogItem[]> {
  const { fromTimestamp, toTimestamp, headers } = params;

  const collected: OmegaLogItem[] = [];

  for (let page = 0; page < OMEGA_MAX_PAGES; page += 1) {
    const omegaUrl = buildOmegaLogsUrl({
      fromTimestamp,
      toTimestamp,
      page,
      size: OMEGA_PAGE_SIZE,
    });

    const omegaRes = await apiRequest<OmegaLogsResponse>(omegaUrl, { headers });
    const batch = Array.isArray(omegaRes.data) ? omegaRes.data : [];

    if (!batch.length) {
      break;
    }

    collected.push(...batch);

    if (batch.length < OMEGA_PAGE_SIZE) {
      break;
    }
  }

  return collected;
}

export async function fetchSecurizacionLive(params: {
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
}): Promise<SecurizacionLiveResult> {
  const { fromDate, toDate, bearerToken } = params;

  const { from, to } = dateRangeToNano(fromDate, toDate);
  const headers = buildAuthHeaders(bearerToken);

  const omegaLogs = await fetchAllOmegaLogs({
    fromTimestamp: from,
    toTimestamp: to,
    headers,
  });

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
        const fallbackAap = normalizeAap(String(log.properties?.aap ?? "").trim());

        return {
          fechaEjecucion: nanoToDisplayDate(log.recordDate),
          errorMessage: String(log.message ?? "").trim() || "-",
          applicationUUAA: String(log.properties?.applicationUUAA ?? "").trim() || "-",
          invokedparam: String(log.properties?.invokedparam ?? "").trim() || "-",
          invokerLibrary: String(log.properties?.invokerLibrary ?? "").trim() || "-",
          invokerTx: String(log.properties?.invokerTx ?? "").trim() || "-",
          spanId: String(log.spanId ?? "").trim() || "-",
          traceId: String(log.traceId ?? "").trim() || "-",
          aap: fallbackAap,
          aapName: getAapName(fallbackAap),
          channelCode: normalizeChannelCode(
            String(log.properties?.["channel-code"] ?? "").trim() ||
              String(log.properties?.channelCode ?? "").trim()
          ),
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