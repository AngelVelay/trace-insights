import { addDays, endOfDay, format, startOfDay, subDays } from "date-fns";
import { apiRequest, buildAuthHeaders } from "./httpClient";
import { dateRangeToNano } from "./dateUtils";
import type { NanoTimestamp } from "@/types/bbva";

export type EnvironmentOption =
  | "DEV"
  | "INT"
  | "AUS"
  | "OCT"
  | "PRZ"
  | "LIVE-02";

export type InstallationRangeMode = "before" | "after" | "complete";

interface AggregationBucket {
  bucket?: {
    name?: string;
  };
  values?: {
    sum_num_executions?: number;
    sum_technical_error?: number;
  };
}

interface AggregationResponse {
  buckets?: AggregationBucket[];
}

interface TimeseriesMetricPoint {
  timestamp: number;
  values: Record<string, number>;
}

interface TimeseriesGroup {
  metrics?: TimeseriesMetricPoint[];
}

interface TimeseriesApiResponse {
  timeseries?: TimeseriesGroup[];
  data?: TimeseriesMetricPoint[];
}

interface RhoSpanItem {
  spanId?: string;
  name?: string;
  properties?: {
    ["channel-code"]?: string;
    env?: string;
    ["environ-code"]?: string;
    ["product-code"]?: string;
    returncode?: string;
  };
}

interface RhoSpanSearchResponse {
  data?: RhoSpanItem[];
}

interface OmegaLogItem {
  level?: string;
  message?: string;
}

interface OmegaLogsResponse {
  data?: OmegaLogItem[];
}

type ControlledErrorInfo = {
  code: string;
  title: string;
  detail: string;
};

const CONTROLLED_ERROR_DICTIONARY: Record<string, ControlledErrorInfo> = {
  QWPO01211000: {
    code: "QWPO01211000",
    title: "ERROR TECNICO $112$ EN LA TRANSACCION $212",
    detail: "Error genérico de la arquitectura",
  },
  QWPO01211001: {
    code: "QWPO01211001",
    title: "ERROR PROCESANDO EL CAMPO $115$ DE LA CABECERA",
    detail:
      "Esta excepción no se produce al validar el campo de la cabecera. Tiene lugar si ocurre algún error al procesar un campo durante su validación.",
  },
  QWPO01211002: {
    code: "QWPO01211002",
    title: "CAMPO OBLIGATORIO $115$ NO INFORMADO",
    detail:
      "Se ha definido un campo obligatorio para la ejecución de la transacción y no se ha especificado.",
  },
  QWPO01211003: {
    code: "QWPO01211003",
    title: "ERROR AL VALIDAR EL PARAMETRO $115$",
    detail:
      "Sólo es validación de parámetros de entrada y de salida. No de campos de cabecera.",
  },
  QWPO01211005: {
    code: "QWPO01211005",
    title: "ERROR AL INSTALAR LA TRANSACCION",
    detail:
      "Excepción que se lanza si se produce algún error al instalar el Bundle de la tx en OSGi.",
  },
  QWPO01211006: {
    code: "QWPO01211006",
    title: "ERROR AL INVOCAR UN WEB SERVICE",
    detail: "Error al invocar un WebService por url incorrecta.",
  },
  QWPO01211007: {
    code: "QWPO01211007",
    title: "PARAMETROS DE WEB SERVICE INCORRECTOS",
    detail: "Error al invocar un WebService por parámetros incorrectos.",
  },
  QWPO01211008: {
    code: "QWPO01211008",
    title: "EL USUARIO NO TIENE PERMISOS PARA EJECUTAR LA TRANSACCION",
    detail: "El usuario no está autorizado para ejecutar la transacción.",
  },
  QWPO01211010: {
    code: "QWPO01211010",
    title: "ERROR DURANTE LA EJECUCION DE LA TRANSACCION",
    detail:
      "Esta excepción se lanza si no se completan correctamente todos los módulos de la cadena de control que incluyen la ejecución de la lógica.",
  },
  QWPO01211012: {
    code: "QWPO01211012",
    title: "ERROR AL EJECUTAR LA ARQUITECTURA BANCARIA DE LA TRANSACCION",
    detail:
      "Error en la ejecución de la arquitectura bancaria asociada a la transacción.",
  },
  QWPO01211014: {
    code: "QWPO01211014",
    title: "ERROR AL GENERAR EL MENSAJE DE RESPUESTA",
    detail:
      "Se produce algún error durante el marshal de una respuesta.",
  },
  QWPO01211018: {
    code: "QWPO01211018",
    title: "NO SE HA PODIDO ALMACENAR LA INFORMACION DEL DATASOURCE",
    detail:
      "Se produce algún error al procesar un objeto dataSource para obtener la información de conexión.",
  },
  QWPO01211019: {
    code: "QWPO01211019",
    title: "EL GESTOR DE MQ NO ESTA DISPONIBLE",
    detail:
      "Hay algún problema durante la comunicación mediante colas MQ al invocar a un Backend.",
  },
  QWPO01211024: {
    code: "QWPO01211024",
    title: "ERROR EN LA CABECERA DEL MENSAJE OTMA",
    detail: "Error en la cabecera del mensaje OTMA.",
  },
  QWPO01211025: {
    code: "QWPO01211025",
    title: "ERROR EN LA EJECUCION DE LA TRANSACCION OTMA",
    detail: "Error en la ejecución de la transacción OTMA.",
  },
  QWPO01211032: {
    code: "QWPO01211032",
    title: "ERROR AL ACCEDER A LA BASE DE DATOS",
    detail:
      "Se produce algún error al acceder por JDBC o JPA a la base de datos.",
  },
  QWPO01211034: {
    code: "QWPO01211034",
    title:
      "ERROR AL RECUPERAR LA CONFIGURACION DE LA TRANSACCION. TRANSACCION INEXISTENTE",
    detail:
      "La información de la transacción no está disponible al recuperarla.",
  },
  QWPO01211035: {
    code: "QWPO01211035",
    title: "SE HA PRODUCIDO UN ABEND/ERROR NO CONTROLADO",
    detail:
      "Se genera cuando se captura una excepción Runtime no considerada.",
  },
  QWPO01211046: {
    code: "QWPO01211046",
    title: "TIMEOUT DE LA RESPUESTA DEL ELEMENTO RFA",
    detail: "Error en la conexión con RFA.",
  },
  QWPO01211067: {
    code: "QWPO01211067",
    title: "TRANSACCION NO OPERATIVA",
    detail:
      "La transacción está deshabilitada o la configuración de operaciones Restful es inválida.",
  },
  QWPO01211069: {
    code: "QWPO01211069",
    title:
      "SE HA PRODUCIDO UN ERROR TECNICO EN LA GENERACION DEL UID DE LA TRANSACCION",
    detail: "Error durante la generación del UID único de la transacción.",
  },
  QWPO01211074: {
    code: "QWPO01211074",
    title: "ERROR DE AUTORIZACION: ERROR AL CONECTARSE CON LDAP",
    detail:
      "Error conectándose al LDAP para validar permisos de ejecución.",
  },
  QWPO01211077: {
    code: "QWPO01211077",
    title: "LA TRANSACCION NO TIENE PERMISOS PARA SER EJECUTADA",
    detail:
      "La transacción está desaprovisionada desde configuración.",
  },
  QWPO01211078: {
    code: "QWPO01211078",
    title:
      "SE HA ALCANZADO EL TIMEOUT MAXIMO DEFINIDO EN LA GESTION DE RECURSOS DE APX",
    detail:
      "Se ha alcanzado el timeout máximo definido en configuración para la ejecución de una transacción.",
  },
  QWPO01211079: {
    code: "QWPO01211079",
    title:
      "SE HA ALCANZADO EL TIEMPO MAXIMO DE CPU PARA LA GESTION DE RECURSOS DE APX",
    detail:
      "Se ha alcanzado el límite de CPU establecido en configuración para la ejecución de una transacción.",
  },
  QWPO01211080: {
    code: "QWPO01211080",
    title: "ERROR EN EL FORMATEO/DESFORMATEO EN EL INTERBACKEND PROXY",
    detail:
      "Error durante el formateo o desformateo de la petición/respuesta del servicio proxy.",
  },
  QWPO01211081: {
    code: "QWPO01211081",
    title: "ERROR EN LA INVOCACION EN EL INTERBACKEND PROXY",
    detail:
      "Error durante la invocación HTTP del servicio proxy.",
  },
  QWPO01211083: {
    code: "QWPO01211083",
    title: "ERROR DE VISIBILIDAD DE APLICATIVO",
    detail:
      "Acceso a una librería aplicativa cuyo invocador no tiene permisos para ejecutar.",
  },
  QWPO01211084: {
    code: "QWPO01211084",
    title:
      "LA COMBINACION DE CANAL , MEDIO Y SERVICIO INDICADA NO ES VALIDA",
    detail:
      "Los valores APX channelCode, environCode y productCode no están entre los permitidos.",
  },
  QWPO01211086: {
    code: "QWPO01211086",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A MONGODB",
    detail:
      "Timeout de operación o conexión accediendo a MongoDb.",
  },
  QWPO01211087: {
    code: "QWPO01211087",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A LITE",
    detail:
      "Timeout de operación o conexión accediendo a servicio Lite.",
  },
  QWPO01211088: {
    code: "QWPO01211088",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A PROXY",
    detail:
      "Timeout de operación o conexión accediendo a Proxy.",
  },
  QWPO01211089: {
    code: "QWPO01211089",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A SERVICIO ASO",
    detail:
      "Timeout de operación o conexión accediendo a ASO.",
  },
  QWPO01211090: {
    code: "QWPO01211090",
    title:
      "ERROR DE TIEMPO EXCEDIDO DE CONEXION AL GESTOR DOCUMENTAL",
    detail:
      "Timeout de operación o conexión accediendo al Gestor Documental.",
  },
  QWPO01211091: {
    code: "QWPO01211091",
    title:
      "ERROR DE TIEMPO EXCEDIDO DE CONEXION AL SERVICIO DE FIRMA DIGITAL",
    detail:
      "Timeout de operación o conexión accediendo al servicio de Firma Digital.",
  },
  QWPO01211092: {
    code: "QWPO01211092",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION VIA SFTP",
    detail:
      "Timeout de operación o conexión accediendo a una máquina a través de SFTP.",
  },
  QWPO01211093: {
    code: "QWPO01211093",
    title:
      "ERROR DE TIEMPO EXCEDIDO DE CONEXION AL SERVICIO DE GRANTING TICKET",
    detail:
      "Timeout de operación o conexión accediendo al servicio de Granting Ticket.",
  },
  QWPO01211095: {
    code: "QWPO01211095",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A ELASTICSEARCH",
    detail:
      "Timeout de operación o conexión accediendo a Elasticsearch.",
  },
  QWPO01211115: {
    code: "QWPO01211115",
    title: "ERROR CREANDO LOS CLIENTES ASO",
    detail: "Error en la creación del cliente del servicio ASO.",
  },
  QWPO01211116: {
    code: "QWPO01211116",
    title: "ERROR EN LA INVOCACION AL SERVICIO ASO",
    detail: "Error en la invocación al servicio ASO.",
  },
  QWPO01211119: {
    code: "QWPO01211119",
    title: "ERROR PRODUCIDO DURANTE EL PARSEO DE UN OBJETO",
    detail:
      "ParseException - Error de parseo o mapeo durante la operación ejecutada.",
  },
  QWPO01211120: {
    code: "QWPO01211120",
    title: "ERROR DE ENTRADA Y SALIDA, BIEN SEA A NIVEL LOCAL O EN RED",
    detail:
      "IOException - Error genérico de entrada/salida durante la operación ejecutada.",
  },
  QWPO01211121: {
    code: "QWPO01211121",
    title: "ERROR DE ENTRADA Y SALIDA A NIVEL DE RED $115$",
    detail:
      "NetworkIOException - Error de entrada/salida en red durante la operación ejecutada.",
  },
  QWPO01211122: {
    code: "QWPO01211122",
    title:
      "ERROR PRODUCIDO EN LA PARTE SERVIDORA DURANTE LA COMUNICACION HTTP",
    detail:
      "HTTPServerException - Error de comunicación en la parte servidora durante la operación ejecutada.",
  },
  QWPO01211123: {
    code: "QWPO01211123",
    title:
      "ERROR PRODUCIDO EN LA PARTE CLIENTE DURANTE LA COMUNICACION HTTP",
    detail:
      "HTTPClientException - Error de comunicación en la parte cliente durante la operación ejecutada.",
  },
  QWPO01211124: {
    code: "QWPO01211124",
    title: "ERROR PRODUCIDO AL ESTABLECER COMUNICACION HTTP $115$ $215$",
    detail:
      "HTTPException - Error al establecer la comunicación HTTP.",
  },
  QWPO01211125: {
    code: "QWPO01211125",
    title: "TIMEOUT EN ACCESO A BD $115$ $215$",
    detail:
      "TimeoutException - Error de timeout en la conexión con la base de datos.",
  },
  QWPO01211126: {
    code: "QWPO01211126",
    title: "OPERACION NO PERMITIDA $115$",
    detail:
      "OperationNotAllowedException - La operación ejecutada no está permitida.",
  },
  QWPO01211127: {
    code: "QWPO01211127",
    title: "ERROR DE COMUNICACION CON BD $115$ $215$",
    detail:
      "DBException - Error en la ejecución de la query con la base de datos.",
  },
  QWPO01211128: {
    code: "QWPO01211128",
    title: "ERROR EN LA EJECUCION DE LA TRANSACCION",
    detail:
      "ExecutionException - Error durante la operación ejecutada.",
  },
  QWPO01211131: {
    code: "QWPO01211131",
    title: "ERROR: USUARIO NO AUTORIZADO A CONECTAR A GLUSTER",
    detail:
      "Error de autenticación al intentar conectarse a Gluster.",
  },
  QWPO01211132: {
    code: "QWPO01211132",
    title: "TIMEOUT EXCEDIDO AL INTENTAR CONECTARSE A GLUSTER",
    detail:
      "Se excedió el tiempo límite para conectarse al servicio Gluster.",
  },
  QWPO01211133: {
    code: "QWPO01211133",
    title: "ERROR PRODUCIDO AL REALIZAR UNA OPERACION DE I/O LOCAL",
    detail:
      "LocalIOException - Error genérico de entrada/salida durante la operación ejecutada en el cliente.",
  },
  QWPO01211134: {
    code: "QWPO01211134",
    title: "ERROR DE TIMEOUT",
    detail:
      "network.TimeoutException - Excepción genérica de la jerarquía de excepciones APX. Excepción de la rama I/O red que indica que se ha producido un error de timeout durante la petición de red.",
  },
  QWPO01211135: {
    code: "QWPO01211135",
    title: "LA URL NO ESTA BIEN FORMADA",
    detail:
      "MalformedURLException - La URL solicitada no tiene un formato válido.",
  },
  QWPO01211136: {
    code: "QWPO01211136",
    title: "PROTOCOLO DESCONOCIDO",
    detail:
      "UnknownProtocolException - El protocolo usado en la invocación no es válido.",
  },
  QWPO01211137: {
    code: "QWPO01211137",
    title: "ACCESO NO PERMITIDO",
    detail:
      "IllegalAccessException - Acceso no autorizado a un recurso.",
  },
  QWPO01211138: {
    code: "QWPO01211138",
    title: "CLASE NO ENCONTRADA",
    detail:
      "ClassNotFoundException - La clase solicitada no está disponible.",
  },
  QWPO01211139: {
    code: "QWPO01211139",
    title: "ERROR EN LA INSTANCIACION DEL OBJETO",
    detail:
      "InstantiationException - Error creando una nueva instancia del objeto solicitado.",
  },
  QWPO01211140: {
    code: "QWPO01211140",
    title: "METODO NO DISPONIBLE",
    detail:
      "NoSuchMethodException - El método invocado no existe.",
  },
  QWPO01211141: {
    code: "QWPO01211141",
    title: "ERROR EN LA INVOCACION",
    detail:
      "InvocationTargetException - Error genérico durante la invocación a un recurso.",
  },
  QWPO01211142: {
    code: "QWPO01211142",
    title: "USUARIO NO AUTORIZADO",
    detail:
      "UserNotAuthorizedException - El usuario no está autorizado para acceder al recurso.",
  },
  QWPO01211144: {
    code: "QWPO01211144",
    title: "TIMEOUT EXCEEDED BEFORE INVOKE NEO4J REQUEST",
    detail:
      "Se alcanzó el timeout antes de invocar la petición a Neo4j.",
  },
  QWPO01211145: {
    code: "QWPO01211145",
    title: "TIMEOUT EXCEEDED BEFORE INVOKE ELASTICSEARCH REQUEST",
    detail:
      "Se alcanzó el timeout antes de invocar la petición a Elasticsearch.",
  },
  QWPO01211146: {
    code: "QWPO01211146",
    title:
      "SE HA ENONTRADO UN ERROR EN EL PROCESO DE LA LLAMADA A CICS",
    detail:
      "Se produjo un error dentro del conector de CICS al ejecutar la llamada de la transacción.",
  },
  QWPO01211147: {
    code: "QWPO01211147",
    title: "ERROR DE TIEMPO EXCEDIDO EN LLAMADA A TRX CICS",
    detail:
      "Se produjo un error por timeout en la llamada a la transacción CICS.",
  },
  QWPO01211148: {
    code: "QWPO01211148",
    title: "ERROR DE CONFIGURACION EN LA LLAMADA A CICS",
    detail:
      "Se produjo un error por mala configuración en el conector CICS.",
  },
  QWPO01211149: {
    code: "QWPO01211149",
    title: "ERROR EN LA FABRICA DE SOCKET PARA CICS",
    detail:
      "Se produjo un error al crear el pool de conexiones del socket para CICS.",
  },
};

export type IncidentPhase = "before" | "installation" | "after";

export interface IncidentMonitoringRow {
  phase: IncidentPhase;
  date: string;
  trx: string;
  exception: string;
  description: string;
  resumenIA: string;
  detalleErroresControlados: string;
  codigoErrorControlado: string;
  apxChannel: string;
  fechaRevision: string;
  numeroEjecuciones: number;
  numeroErrores: number;
  numeroTiempoRespuestaMs: number;
  tuvoMayorNumeroEjecuciones: string;
  aumentoPromedioTiempoRespuesta: string;
}

export interface IncidentMonitoringResult {
  environment: EnvironmentOption;
  mode: InstallationRangeMode;
  installationDay: string;
  trx: string;
  rows: IncidentMonitoringRow[];
  totals: {
    numeroEjecuciones: number;
    numeroErrores: number;
    numeroTiempoRespuestaMs: number;
  };
}

const MU_WORK_BASE = "https://mu.work-02.nextgen.igrupobbva";
const MU_LIVE_BASE = "https://mu.live-02.nextgen.igrupobbva";
const RHO_WORK_BASE = "https://rho.work-02.nextgen.igrupobbva";
const RHO_LIVE_BASE = "https://rho.live-02.nextgen.igrupobbva";
const OMEGA_WORK_BASE = "https://omega.work-02.nextgen.igrupobbva";
const OMEGA_LIVE_BASE = "https://omega.live-02.nextgen.igrupobbva";

function getIncidentConfig(environment: EnvironmentOption): {
  muBaseUrl: string;
  rhoBaseUrl: string;
  omegaBaseUrl: string;
  envValue: string;
  qEnv: string;
} {
  if (environment === "PRZ" || environment === "LIVE-02") {
    return {
      muBaseUrl: MU_LIVE_BASE,
      rhoBaseUrl: RHO_LIVE_BASE,
      omegaBaseUrl: OMEGA_LIVE_BASE,
      envValue: environment,
      qEnv: `"env" == "${environment}"`,
    };
  }

  return {
    muBaseUrl: MU_WORK_BASE,
    rhoBaseUrl: RHO_WORK_BASE,
    omegaBaseUrl: OMEGA_WORK_BASE,
    envValue: environment,
    qEnv: `"env" == "${environment}"`,
  };
}

function buildTopTrxUrl(params: {
  environment: EnvironmentOption;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
}): string {
  const { environment, fromTimestamp, toTimestamp } = params;
  const config = getIncidentConfig(environment);

  const url = new URL(
    "/v0/ns/apx.online/metric-sets/technical-dashboard:listAggregations",
    config.muBaseUrl
  );

  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("toTimestamp", toTimestamp);
  url.searchParams.set("propertiesSize", "20000");
  url.searchParams.set("aggregate", '"name"');
  url.searchParams.set("q", `${config.qEnv} AND "returncode" == "12"`);

  url.searchParams.append("operation", "sum:technical_error");
  url.searchParams.append("operation", "sum:num_executions");

  return url.toString();
}

function buildTimeseriesUrl(params: {
  environment: EnvironmentOption;
  trx: string;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
  operation: "sum:technical_error" | "sum:num_executions" | "mean:span_duration";
}): string {
  const { environment, trx, fromTimestamp, toTimestamp, operation } = params;
  const config = getIncidentConfig(environment);

  const url = new URL(
    "/v0/ns/apx.online/metric-sets/technical-dashboard:listTimeseries",
    config.muBaseUrl
  );

  url.searchParams.set("fromTimestamp", fromTimestamp);
  url.searchParams.set("toTimestamp", toTimestamp);
  url.searchParams.set("granularity", "300s");
  url.searchParams.set("q", `${config.qEnv} AND "name" == "${trx}"`);
  url.searchParams.append("operation", operation);

  return url.toString();
}

function buildRhoSpanSearchUrl(params: {
  environment: EnvironmentOption;
  trx: string;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
}): string {
  const { environment, trx, fromTimestamp, toTimestamp } = params;
  const config = getIncidentConfig(environment);

  const url = new URL("/v1/ns/apx.online/spans", config.rhoBaseUrl);

  url.searchParams.set(
    "q",
    `properties.metrics|technicalError == '1' AND name == '${trx}' AND properties.env == ${config.envValue}`
  );
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set(
    "properties",
    "channel-code,environ-code,env,product-code,returncode"
  );
  url.searchParams.set("profile", "default");

  return url.toString();
}

function buildOmegaLogUrl(params: {
  environment: EnvironmentOption;
  spanId: string;
  fromTimestamp: NanoTimestamp;
  toTimestamp: NanoTimestamp;
}): string {
  const { environment, spanId, fromTimestamp, toTimestamp } = params;
  const config = getIncidentConfig(environment);

  const url = new URL("/v1/ns/apx.online/logs", config.omegaBaseUrl);

  url.searchParams.set("q", `spanId = "${spanId}"`);
  url.searchParams.set("sort", "descending");
  url.searchParams.set("profile", "default");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);

  return url.toString();
}

function extractMetricPoints(payload: TimeseriesApiResponse): TimeseriesMetricPoint[] {
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.timeseries)) {
    return payload.timeseries.flatMap((group) => group.metrics ?? []);
  }
  return [];
}

function sumMetricValues(
  payload: TimeseriesApiResponse,
  key: "sum_technical_error" | "sum_num_executions" | "mean_span_duration"
): number {
  return extractMetricPoints(payload).reduce(
    (sum, point) => sum + Number(point.values?.[key] ?? 0),
    0
  );
}

function firstTwoParagraphs(text: string): string {
  const normalized = String(text ?? "").trim();
  if (!normalized) return "";

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length >= 2) {
    return `${paragraphs[0]}\n\n${paragraphs[1]}`;
  }

  return paragraphs[0] ?? normalized;
}

function extractControlledErrorCodeOnly(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";

  const match = source.match(/Error code:\s*([A-Z0-9]+)/i);
  return match?.[1] ?? "";
}

function extractControlledErrorCode(text: string): string {
  const code = extractControlledErrorCodeOnly(text);
  if (!code) return "";

  const dict = CONTROLLED_ERROR_DICTIONARY[code];
  if (!dict) return code;

  return `${dict.code} - ${dict.title}.`;
}

function extractControlledErrorDetail(text: string): string {
  const code = extractControlledErrorCodeOnly(text);
  if (!code) return "";

  const dict = CONTROLLED_ERROR_DICTIONARY[code];
  if (!dict) return "";

  return dict.detail;
}

function extractExceptionName(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";

  const methodMatches = [...source.matchAll(/\bat\s+[A-Za-z0-9_$.]+\.([A-Za-z0-9_]+)\(/g)];
  const preferredMethod = methodMatches.find((m) =>
    /Exception/i.test(m[1]) || /CircuitBreaker/i.test(m[1])
  );
  if (preferredMethod?.[1]) {
    return preferredMethod[1];
  }
  if (methodMatches[0]?.[1]) {
    return methodMatches[0][1];
  }

  const exceptionMatch =
    source.match(/([A-Za-z0-9_$.]*TimeoutException)/) ||
    source.match(/([A-Za-z0-9_$.]*ExecutionException)/) ||
    source.match(/([A-Za-z0-9_$.]*DBException)/) ||
    source.match(/([A-Za-z0-9_$.]*HTTPException)/) ||
    source.match(/([A-Za-z0-9_$.]*Exception)/);

  if (exceptionMatch?.[1]) {
    const raw = exceptionMatch[1];
    const parts = raw.split(".");
    return parts[parts.length - 1];
  }

  return "";
}

function summarizeDescription(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";

  const firstLine =
    source
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || "";

  const apiIdMatch = source.match(/apiID\s+([A-Za-z0-9._-]+)/i);
  const apiId = apiIdMatch?.[1] ?? "";

  const trxMatch = source.match(/Transaction code:\s*([A-Z0-9]+)/i);
  const trx = trxMatch?.[1] ?? "";

  const exceptionMatch =
    source.match(/([A-Za-z0-9_$.]*TimeoutException)/) ||
    source.match(/([A-Za-z0-9_$.]*ExecutionException)/) ||
    source.match(/([A-Za-z0-9_$.]*Exception)/);
  const exceptionName = exceptionMatch?.[1]?.split(".").pop() ?? "";

  const controlledCode = extractControlledErrorCodeOnly(source);

  if (/timeout/i.test(source) && /API-CONNECTOR/i.test(source)) {
    const target = apiId ? ` al invocar ${apiId}` : "";
    const ex = exceptionName ? ` (${exceptionName})` : "";
    const code = controlledCode ? ` [${controlledCode}]` : "";
    return `Se detectó un timeout en API-CONNECTOR${target}${ex}${code}. El incidente apunta a una degradación, indisponibilidad o latencia elevada en una dependencia remota durante la ejecución transaccional.`;
  }

  if (/composeTransactionResponse/i.test(source)) {
    const trxText = trx ? ` de la transacción ${trx}` : "";
    const codeText = controlledCode ? ` con código ${controlledCode}` : "";
    return `Se produjo un error controlado en composeTransactionResponse${trxText}${codeText}. La arquitectura no pudo construir correctamente la respuesta transaccional y requiere revisión del flujo funcional asociado.`;
  }

  if (/CircuitBreaker/i.test(source)) {
    return "Se activó el Circuit Breaker durante la invocación a un servicio remoto. Esto sugiere fallos repetidos, indisponibilidad o saturación en la dependencia consumida por la transacción.";
  }

  if (/NullPointerException/i.test(source)) {
    return "Se identificó un NullPointerException en el flujo de ejecución. El incidente sugiere datos nulos, referencias no inicializadas o una validación insuficiente antes de acceder al recurso.";
  }

  if (/connection refused/i.test(source)) {
    return "La conexión fue rechazada por el servicio remoto. El incidente apunta a indisponibilidad del endpoint, configuración incorrecta o problemas de red entre componentes.";
  }

  if (/DBException|JDBC|JPA/i.test(source)) {
    return "Se detectó un fallo en el acceso a base de datos durante la ejecución. Es recomendable revisar conectividad, tiempos de respuesta, consultas y estado de los recursos persistentes.";
  }

  if (/HTTPException|HTTPClientException|HTTPServerException/i.test(source)) {
    return "Se produjo un error en la comunicación HTTP durante la invocación de un servicio externo o interno. Debe revisarse la disponibilidad del endpoint y la respuesta obtenida.";
  }

  if (firstLine) {
    return `${firstLine.slice(0, 220)}. Requiere revisión del flujo técnico y de la dependencia asociada a la transacción.`;
  }

  return source.slice(0, 220);
}

async function summarizeDescriptionWithAIFrontend(
  text: string,
  apiKey?: string
): Promise<string> {
  const source = String(text || "").trim();
  if (!source) return "";

  const key = String(apiKey || "").trim();
  if (!key) {
    return summarizeDescription(source);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Resume errores tecnicos en espanol para un dashboard operativo. " +
                  "Debe ser un poco descriptivo, claro y util. Maximo 35 palabras. " +
                  "Menciona dependencia, impacto o causa probable si es evidente.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Resume este error tecnico en una sola frase clara y descriptiva, en espanol:\n\n" +
                  source,
              },
            ],
          },
        ],
        max_output_tokens: 90,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => null);

      if (err?.error?.code === "insufficient_quota") {
        return summarizeDescription(source);
      }

      throw new Error(err?.error?.message || `HTTP ${response.status}`);
    }

    const data = (await response.json()) as { output_text?: string };
    const summary = String(data.output_text || "").trim();

    return summary || summarizeDescription(source);
  } catch {
    return summarizeDescription(source);
  }
}

async function fetchTopTrx(
  environment: EnvironmentOption,
  fromDate: Date,
  toDate: Date,
  bearerToken?: string
): Promise<string> {
  const { from, to } = dateRangeToNano(fromDate, toDate);
  const url = buildTopTrxUrl({
    environment,
    fromTimestamp: from,
    toTimestamp: to,
  });

  const headers = buildAuthHeaders(bearerToken);
  const res = await apiRequest<AggregationResponse>(url, { headers });
  const buckets = Array.isArray(res.buckets) ? res.buckets : [];

  const sorted = [...buckets].sort((a, b) => {
    const errorsDiff =
      Number(b.values?.sum_technical_error ?? 0) -
      Number(a.values?.sum_technical_error ?? 0);

    if (errorsDiff !== 0) {
      return errorsDiff;
    }

    return (
      Number(b.values?.sum_num_executions ?? 0) -
      Number(a.values?.sum_num_executions ?? 0)
    );
  });

  return sorted[0]?.bucket?.name ?? "";
}

async function fetchTimeseriesMetric(params: {
  environment: EnvironmentOption;
  trx: string;
  fromDate: Date;
  toDate: Date;
  operation: "sum:technical_error" | "sum:num_executions" | "mean:span_duration";
  key: "sum_technical_error" | "sum_num_executions" | "mean_span_duration";
  bearerToken?: string;
}): Promise<number> {
  const { environment, trx, fromDate, toDate, operation, key, bearerToken } =
    params;
  const { from, to } = dateRangeToNano(fromDate, toDate);

  const url = buildTimeseriesUrl({
    environment,
    trx,
    fromTimestamp: from,
    toTimestamp: to,
    operation,
  });

  const headers = buildAuthHeaders(bearerToken);
  const res = await apiRequest<TimeseriesApiResponse>(url, { headers });
  return sumMetricValues(res, key);
}

async function fetchDescriptionFromLogs(params: {
  environment: EnvironmentOption;
  trx: string;
  fromDate: Date;
  toDate: Date;
  bearerToken?: string;
}): Promise<{
  description: string;
  detalleErroresControlados: string;
  apxChannel: string;
  exception: string;
}> {
  const { environment, trx, fromDate, toDate, bearerToken } = params;
  const { from, to } = dateRangeToNano(fromDate, toDate);
  const headers = buildAuthHeaders(bearerToken);

  const rhoUrl = buildRhoSpanSearchUrl({
    environment,
    trx,
    fromTimestamp: from,
    toTimestamp: to,
  });

  const rhoRes = await apiRequest<RhoSpanSearchResponse>(rhoUrl, { headers });
  const span = (rhoRes.data ?? [])[0];

  if (!span?.spanId) {
    return {
      description: "",
      detalleErroresControlados: "",
      apxChannel: "",
      exception: "returncode 12",
    };
  }

  const omegaUrl = buildOmegaLogUrl({
    environment,
    spanId: span.spanId,
    fromTimestamp: from,
    toTimestamp: to,
  });

  const omegaRes = await apiRequest<OmegaLogsResponse>(omegaUrl, { headers });
  const errorLogs = (omegaRes.data ?? []).filter((item) => item.level === "ERROR");

  const controlledLog =
    errorLogs.find((item) =>
      String(item.message ?? "").includes("Error en composeTransactionResponse")
    ) ?? null;

  const technicalLog =
    errorLogs.find((item) =>
      String(item.message ?? "").includes("Exception:")
    ) ??
    errorLogs.find((item) =>
      String(item.message ?? "").toLowerCase().includes("timeout")
    ) ??
    errorLogs[0] ??
    null;

  return {
    description: firstTwoParagraphs(technicalLog?.message ?? ""),
    detalleErroresControlados: firstTwoParagraphs(controlledLog?.message ?? ""),
    apxChannel: span.properties?.["channel-code"] ?? "",
    exception: span.properties?.returncode
      ? `returncode ${span.properties.returncode}`
      : "returncode 12",
  };
}

function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

function buildDailyDates(
  installationDay: Date,
  mode: InstallationRangeMode
): Array<{ date: Date; phase: IncidentPhase }> {
  const base = cloneDate(installationDay);
  const dates: Array<{ date: Date; phase: IncidentPhase }> = [];

  if (mode === "before") {
    for (let i = 7; i >= 1; i--) {
      dates.push({ date: subDays(base, i), phase: "before" });
    }
    return dates;
  }

  if (mode === "after") {
    for (let i = 1; i <= 7; i++) {
      dates.push({ date: addDays(base, i), phase: "after" });
    }
    return dates;
  }

  for (let i = 7; i >= 1; i--) {
    dates.push({ date: subDays(base, i), phase: "before" });
  }

  dates.push({ date: base, phase: "installation" });

  for (let i = 1; i <= 7; i++) {
    dates.push({ date: addDays(base, i), phase: "after" });
  }

  return dates;
}

export async function fetchIncidentMonitoring(params: {
  environment: EnvironmentOption;
  installationDay: Date;
  mode: InstallationRangeMode;
  bearerToken?: string;
  openAiApiKey?: string;
}): Promise<IncidentMonitoringResult> {
  const { environment, installationDay, mode, bearerToken, openAiApiKey } = params;

  const dailyDates = buildDailyDates(installationDay, mode);

  const rows = await Promise.all(
    dailyDates.map(async ({ date, phase }, index) => {
      const fromDate = new Date(date);
const toDate = new Date(date);
toDate.setDate(toDate.getDate() + 1);
toDate.setMilliseconds(toDate.getMilliseconds() - 1);

      const trx = await fetchTopTrx(
        environment,
        fromDate,
        toDate,
        bearerToken
      );

      if (!trx) {
        return {
          phase,
          date: format(date, "dd/MM/yyyy HH:mm"),
          trx: "",
          exception: "",
          description: "",
          resumenIA: "",
          detalleErroresControlados: "",
          codigoErrorControlado: "",
          apxChannel: "",
          fechaRevision: format(new Date(), "dd/MM/yyyy HH:mm"),
          numeroEjecuciones: 0,
          numeroErrores: 0,
          numeroTiempoRespuestaMs: 0,
          tuvoMayorNumeroEjecuciones: "No",
          aumentoPromedioTiempoRespuesta: "No",
        };
      }

      const [
        numeroErrores,
        numeroEjecuciones,
        numeroTiempoRespuestaMs,
        descriptionInfo,
      ] = await Promise.all([
        fetchTimeseriesMetric({
          environment,
          trx,
          fromDate,
          toDate,
          operation: "sum:technical_error",
          key: "sum_technical_error",
          bearerToken,
        }),
        fetchTimeseriesMetric({
          environment,
          trx,
          fromDate,
          toDate,
          operation: "sum:num_executions",
          key: "sum_num_executions",
          bearerToken,
        }),
        fetchTimeseriesMetric({
          environment,
          trx,
          fromDate,
          toDate,
          operation: "mean:span_duration",
          key: "mean_span_duration",
          bearerToken,
        }),
        fetchDescriptionFromLogs({
          environment,
          trx,
          fromDate,
          toDate,
          bearerToken,
        }),
      ]);

      const descriptionReduced = summarizeDescription(descriptionInfo.description);
      const resumenIA = await summarizeDescriptionWithAIFrontend(
        descriptionInfo.description,
        openAiApiKey
      );

      const exceptionName =
        extractExceptionName(descriptionInfo.description) ||
        extractExceptionName(descriptionInfo.detalleErroresControlados) ||
        descriptionInfo.exception;

      const controlledErrorCode = extractControlledErrorCode(
        descriptionInfo.detalleErroresControlados
      );

      const controlledErrorDetail = extractControlledErrorDetail(
        descriptionInfo.detalleErroresControlados
      );

      return {
        phase,
        date: format(date, "dd/MM/yyyy"),
        trx,
        exception: exceptionName,
        description: descriptionReduced,
        resumenIA,
        detalleErroresControlados: controlledErrorDetail,
        codigoErrorControlado: controlledErrorCode,
        apxChannel: descriptionInfo.apxChannel,
        fechaRevision: format(new Date(), "dd/MM/yyyy HH:mm"),
        numeroEjecuciones,
        numeroErrores,
        numeroTiempoRespuestaMs,
        tuvoMayorNumeroEjecuciones: "No",
        aumentoPromedioTiempoRespuesta: "No",
      };
    })
  );

  const rowsWithComparisons = rows.map((row, index) => {
    if (index === 0) {
      return {
        ...row,
        tuvoMayorNumeroEjecuciones: "No",
        aumentoPromedioTiempoRespuesta: "No",
      };
    }

    const previousRow = rows[index - 1];

    return {
      ...row,
      tuvoMayorNumeroEjecuciones:
        row.numeroEjecuciones > previousRow.numeroEjecuciones ? "Sí" : "No",
      aumentoPromedioTiempoRespuesta:
        row.numeroTiempoRespuestaMs > previousRow.numeroTiempoRespuestaMs ? "Sí" : "No",
    };
  });

  const totals = rowsWithComparisons.reduce(
    (acc, row) => {
      acc.numeroEjecuciones += row.numeroEjecuciones;
      acc.numeroErrores += row.numeroErrores;
      acc.numeroTiempoRespuestaMs += row.numeroTiempoRespuestaMs;
      return acc;
    },
    {
      numeroEjecuciones: 0,
      numeroErrores: 0,
      numeroTiempoRespuestaMs: 0,
    }
  );

  return {
    environment,
    mode,
    installationDay: format(installationDay, "dd/MM/yyyy"),
    trx:
      rowsWithComparisons.length > 0 &&
      new Set(rowsWithComparisons.map((row) => row.trx).filter(Boolean)).size > 1
        ? "Múltiples TRX por día"
        : rowsWithComparisons.find((row) => row.trx)?.trx ?? "",
    rows: rowsWithComparisons,
    totals,
  };
}