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

export type IncidentAiProvider =
  | "heuristic"
  | "local"
  | "openai"
  | "gemini";

export type IncidentAiModel =
  | "heuristic-summary"
  | "local-gemini-nano"
  | "gpt-4.1-nano"
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-flash"
  | "gemini-2.0-flash-lite"
  | "gemini-2.0-flash";

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

type LocalLanguageModelSession = {
  prompt: (input: string) => Promise<string>;
  destroy?: () => Promise<void> | void;
};

type LocalLanguageModel = {
  availability?: () => Promise<string>;
  create?: () => Promise<LocalLanguageModelSession>;
};

const MU_WORK_BASE = "https://mu.work-02.nextgen.igrupobbva";
const MU_LIVE_BASE = "https://mu.live-02.nextgen.igrupobbva";
const RHO_WORK_BASE = "https://rho.work-02.nextgen.igrupobbva";
const RHO_LIVE_BASE = "https://rho.live-02.nextgen.igrupobbva";
const OMEGA_WORK_BASE = "https://omega.work-02.nextgen.igrupobbva";
const OMEGA_LIVE_BASE = "https://omega.live-02.nextgen.igrupobbva";

const CONTROLLED_ERROR_DICTIONARY: Record<string, ControlledErrorInfo> = {
  QWPO01211000: {
    code: "QWPO01211000",
    title: "ERROR TECNICO $112$ EN LA TRANSACCION $212",
    detail: "Error genérico de la arquitectura.",
  },
  QWPO01211001: {
    code: "QWPO01211001",
    title: "ERROR PROCESANDO EL CAMPO $115$ DE LA CABECERA",
    detail:
      "Esta excepción no se produce al validar el campo de la cabecera. Tiene lugar si ocurre algún error al procesar un campo durante su validación, por ejemplo al recuperar el método set correspondiente o al aplicar el set en la cabecera del TransactionRequest.",
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
      "Corresponde a validación de parámetros de entrada y salida. No aplica a campos de cabecera.",
  },
  QWPO01211004: {
    code: "QWPO01211004",
    title: "EL ERROR INFORMADO POR LA APLICACION NO EXISTE: $112$",
    detail:
      "Desde la ejecución de la transacción se añadió un error que no está definido en base de datos.",
  },
  QWPO01211005: {
    code: "QWPO01211005",
    title: "ERROR AL INSTALAR LA TRANSACCION",
    detail:
      "Se lanza si se produce algún error al instalar el bundle de la transacción en OSGi.",
  },
  QWPO01211006: {
    code: "QWPO01211006",
    title: "ERROR AL INVOCAR UN WEB SERVICE",
    detail:
      "Error al invocar un Web Service, normalmente por URL incorrecta.",
  },
  QWPO01211007: {
    code: "QWPO01211007",
    title: "PARAMETROS DE WEB SERVICE INCORRECTOS",
    detail:
      "Error al invocar un Web Service por parámetros incorrectos.",
  },
  QWPO01211008: {
    code: "QWPO01211008",
    title: "EL USUARIO NO TIENE PERMISOS PARA EJECUTAR LA TRANSACCION",
    detail:
      "El usuario no está autorizado para ejecutar la transacción.",
  },
  QWPO01211009: {
    code: "QWPO01211009",
    title: "ERROR AL EJECUTAR PREACCIONES DE LA TRANSACCION",
    detail:
      "Se lanza si no se completan correctamente todas las pre-acciones de la transacción.",
  },
  QWPO01211010: {
    code: "QWPO01211010",
    title: "ERROR DURANTE LA EJECUCION DE LA TRANSACCION",
    detail:
      "Se lanza si no se completan correctamente todos los módulos de la cadena de control, incluida la lógica de ejecución.",
  },
  QWPO01211011: {
    code: "QWPO01211011",
    title: "ERROR AL EJECUTAR POSTACCIONES DE LA TRANSACCION",
    detail:
      "Se lanza si no se completan correctamente todas las post-acciones de la transacción.",
  },
  QWPO01211012: {
    code: "QWPO01211012",
    title: "ERROR AL EJECUTAR LA ARQUITECTURA BANCARIA DE LA TRANSACCION",
    detail:
      "Error en la ejecución de la arquitectura bancaria asociada a la transacción.",
  },
  QWPO01211013: {
    code: "QWPO01211013",
    title: "ERROR AL GENERAR EL GENERADOR DEL IDENTIFICADOR DE LA TRANSACCION",
    detail:
      "Este error tiene lugar al generar el generador de UID al levantar la arquitectura, no al generar el UID de cada transacción.",
  },
  QWPO01211014: {
    code: "QWPO01211014",
    title: "ERROR AL GENERAR EL MENSAJE DE RESPUESTA",
    detail:
      "Se lanza si se produce algún error durante el marshal de una respuesta.",
  },
  QWPO01211015: {
    code: "QWPO01211015",
    title: "ERROR AL GENERAR EL XML DE RESPUESTA",
    detail:
      "Se lanza si se produce algún error durante el marshal de un XML.",
  },
  QWPO01211016: {
    code: "QWPO01211016",
    title: "ERROR AL PROCESAR EL MENSAJE CON LA PETICION",
    detail:
      "Se lanza si se produce algún error durante el unmarshal de una petición.",
  },
  QWPO01211017: {
    code: "QWPO01211017",
    title: "ERROR AL PROCESAR EL XML CON LA PETICION",
    detail:
      "Se lanza si se produce algún error durante el unmarshal de un XML.",
  },
  QWPO01211018: {
    code: "QWPO01211018",
    title: "NO SE HA PODIDO ALMACENAR LA INFORMACION DEL DATASOURCE",
    detail:
      "Se lanza si se produce algún error al procesar un objeto dataSource y obtener la información de conexión a base de datos.",
  },
  QWPO01211019: {
    code: "QWPO01211019",
    title: "EL GESTOR DE MQ NO ESTA DISPONIBLE",
    detail:
      "Hay un problema durante la comunicación mediante colas MQ al invocar un backend desde una transacción.",
  },
  QWPO01211020: {
    code: "QWPO01211020",
    title: "ERROR EN LA CONEXION MQ",
    detail:
      "Se produjo un problema en la conexión MQ al invocar un backend desde una transacción.",
  },
  QWPO01211021: {
    code: "QWPO01211021",
    title: "ERROR CREANDO EL MENSAJE MQ",
    detail:
      "Se produjo un problema al construir el mensaje MQ para invocar un backend.",
  },
  QWPO01211022: {
    code: "QWPO01211022",
    title: "ERROR AL LEER LA RESPUESTA MQ",
    detail:
      "Se produjo un problema al leer la respuesta MQ devuelta por el backend.",
  },
  QWPO01211023: {
    code: "QWPO01211023",
    title: "ERROR AL FORMATEAR EL MENSAJE PARA EL TIPO MQ",
    detail:
      "Se produjo un problema al formatear el mensaje para su envío por MQ.",
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
  QWPO01211026: {
    code: "QWPO01211026",
    title: "ERROR EN LA CABECERA DEL MENSAJE PS9",
    detail: "Error en la cabecera del mensaje PS9.",
  },
  QWPO01211027: {
    code: "QWPO01211027",
    title: "ERROR EN EL CUERPO DEL MENSAJE PS9",
    detail: "Error en el cuerpo del mensaje PS9.",
  },
  QWPO01211028: {
    code: "QWPO01211028",
    title: "ERROR AL LEER DESCRIPTOR DEL MENSAJE PS9 PARA GENERAR RESPUESTA",
    detail:
      "Error al leer el descriptor del mensaje PS9 para generar la respuesta.",
  },
  QWPO01211029: {
    code: "QWPO01211029",
    title: "ERROR: EL CUERPO DE LA TRANSACCION NO SE HA PROPORCIONADO",
    detail:
      "Al invocar desde una transacción a un backend, no se recibió la lista de parámetros esperada.",
  },
  QWPO01211030: {
    code: "QWPO01211030",
    title: "CODIGO PUESTO DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El código puesto de la transacción informado en la cabecera es incorrecto.",
  },
  QWPO01211031: {
    code: "QWPO01211031",
    title:
      "CODIGO ORIGEN FISICO DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El código de origen físico de la transacción informado en la cabecera es incorrecto.",
  },
  QWPO01211032: {
    code: "QWPO01211032",
    title: "ERROR AL ACCEDER A LA BASE DE DATOS",
    detail:
      "Se lanza si se produce algún error al acceder a base de datos por JDBC o JPA.",
  },
  QWPO01211033: {
    code: "QWPO01211033",
    title:
      "INDICADOR DE PRE-FORMATTING INDICADO EN LA CABECERA INCORRECTO",
    detail:
      'El valor del indicador de preformateo indicado en la cabecera es incorrecto; debe ser "Y" o "N".',
  },
  QWPO01211034: {
    code: "QWPO01211034",
    title:
      "ERROR AL RECUPERAR LA CONFIGURACION DE LA TRANSACCION. TRANSACCION INEXISTENTE",
    detail:
      "No se ha podido recuperar la información de configuración de la transacción; equivale a una transacción inexistente.",
  },
  QWPO01211035: {
    code: "QWPO01211035",
    title: "SE HA PRODUCIDO UN ABEND/ERROR NO CONTROLADO",
    detail:
      "Se genera cuando se captura una excepción Runtime no contemplada explícitamente.",
  },
  QWPO01211036: {
    code: "QWPO01211036",
    title: "SE RECIBE UN DATO NO NUMERICO Y DEBERIA SER NUMERICO",
    detail:
      "Error validando parámetros: se recibió un dato no numérico donde debía recibirse un valor numérico.",
  },
  QWPO01211037: {
    code: "QWPO01211037",
    title:
      "VERSION DE AUTORIZACION DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "La versión de autorización de la transacción informada en la cabecera es incorrecta.",
  },
  QWPO01211038: {
    code: "QWPO01211038",
    title:
      "CODIGO DIVISA SECUNDARIA DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El código de divisa secundaria informado en la cabecera es incorrecto.",
  },
  QWPO01211039: {
    code: "QWPO01211039",
    title:
      "NO HA SIDO POSIBLE RECUPERAR LA TRANSACCION/MODULO EJECUTABLE ASOCIADO A LA TX",
    detail:
      "No se pudo recuperar el bundle o módulo ejecutable asociado a la transacción desde el repositorio OSGi.",
  },
  QWPO01211040: {
    code: "QWPO01211040",
    title: "ERROR AL GESTIONAR EVENTOS DE LA TRANSACCION",
    detail:
      "Error al gestionar post-eventos en la ejecución de la transacción. No usado.",
  },
  QWPO01211041: {
    code: "QWPO01211041",
    title: "NO HAY PLANTILLA QUE SEA MAPEABLE CON LOS PARAMETROS DADOS",
    detail:
      "No se encontró una plantilla mapeable con los parámetros dados. No usado; legacy de Elara.",
  },
  QWPO01211042: {
    code: "QWPO01211042",
    title: "EL MENSAJE NO HA PODIDO SER ENVIADO",
    detail:
      "El mensaje SMTP no se ha podido enviar. No usado; legacy de Elara.",
  },
  QWPO01211043: {
    code: "QWPO01211043",
    title: "LA DIRECCION ESTA MAL FORMADA",
    detail:
      "Dirección incorrecta. No usado; legacy de Elara.",
  },
  QWPO01211044: {
    code: "QWPO01211044",
    title: "ERROR DURANTE LA FORMACION DE LA PLANTILLA DEL DATA SOURCE",
    detail:
      "Error durante la formación de la plantilla del data source. No usado; legacy de Elara.",
  },
  QWPO01211045: {
    code: "QWPO01211045",
    title: "ERROR DURANTE EL PARSEO DEL XML",
    detail:
      "Error parseando XML para RFA. No usado; legacy de Elara.",
  },
  QWPO01211046: {
    code: "QWPO01211046",
    title: "TIMEOUT DE LA RESPUESTA DEL ELEMENTO RFA",
    detail:
      "Error en la conexión con RFA. No usado; legacy de Elara.",
  },
  QWPO01211047: {
    code: "QWPO01211047",
    title:
      "ERROR DURANTE EL ENVIO DE MENSAJE SIN PROTOCOLO LOGICO DEFINIDO",
    detail:
      "Error al enviar un mensaje sin protocolo lógico definido.",
  },
  QWPO01211048: {
    code: "QWPO01211048",
    title: "ERROR AL CARGAR EL SCRIPT",
    detail: "Error al ejecutar un script LUA.",
  },
  QWPO01211049: {
    code: "QWPO01211049",
    title:
      "CODIGO DE AUTORIZACION INFORMADO EN LA CABECERA ES INCORRECTO",
    detail:
      "El valor de la cabecera authorizationCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211050: {
    code: "QWPO01211050",
    title:
      "CODIGO DE TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera logicalTransactionCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211051: {
    code: "QWPO01211051",
    title:
      "TIPO DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera typeCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211052: {
    code: "QWPO01211052",
    title:
      "SUBTIPO DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera subtypeCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211053: {
    code: "QWPO01211053",
    title:
      "VERSION DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera versionCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211054: {
    code: "QWPO01211054",
    title:
      "PAIS DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera countryCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211055: {
    code: "QWPO01211055",
    title:
      "IDIOMA DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera languageCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211056: {
    code: "QWPO01211056",
    title:
      "BANCO DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera entityCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211057: {
    code: "QWPO01211057",
    title:
      "OFICINA DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera branchCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211058: {
    code: "QWPO01211058",
    title:
      "CANAL DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera channelCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211059: {
    code: "QWPO01211059",
    title:
      "MEDIO DE LA TRANSACCION INFORMADO EN LA TRANSACCION INCORRECTO",
    detail:
      "El valor de la cabecera environCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211060: {
    code: "QWPO01211060",
    title:
      "APLICACION DEL CANAL INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera productCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211061: {
    code: "QWPO01211061",
    title:
      "USUARIO DE LA TRANSACCION INFORMADO EN LA CABECERA INCORRECTO",
    detail:
      "El valor de la cabecera userCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211062: {
    code: "QWPO01211062",
    title:
      "LA FECHA DEL CANAL INFORMADA EN LA CABECERA ES INCORRECTA",
    detail:
      "El valor de la cabecera operationDate no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211063: {
    code: "QWPO01211063",
    title:
      "LA HORA DEL CANAL INFORMADA EN LA CABECERA ES INCORRECTA",
    detail:
      "El valor de la cabecera operationTime no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211064: {
    code: "QWPO01211064",
    title:
      "BANCO OPERATIVO DE LA TRANSACCION INFORMADO EN LA CABECERA ES INCORRECTO",
    detail:
      "El valor de la cabecera operativeEntityCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211065: {
    code: "QWPO01211065",
    title:
      "OFICINA OPERATIVA DE LA TRANSACCION INFORMADA EN LA CABECERA ES INCORRECTA",
    detail:
      "El valor de la cabecera operativeBranchCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211066: {
    code: "QWPO01211066",
    title: "LA DIVISA BASE INFORMADA EN LA CABECERA ES INCORRECTA",
    detail:
      "El valor de la cabecera currencyCode no está bien informado. Se debe revisar el mensaje de entrada.",
  },
  QWPO01211067: {
    code: "QWPO01211067",
    title: "TRANSACCION NO OPERATIVA",
    detail:
      "La transacción está deshabilitada o no operativa. También puede ocurrir en una TX Restful cuando los XML de operaciones contienen más de una entidad.",
  },
  QWPO01211068: {
    code: "QWPO01211068",
    title: "CAMPO DE LA CABECERA NO INFORMADO",
    detail:
      "Durante el unmarshal de la petición no se recibió un campo obligatorio de la cabecera.",
  },
  QWPO01211069: {
    code: "QWPO01211069",
    title:
      "SE HA PRODUCIDO UN ERROR TECNICO EN LA GENERACION DEL UID DE LA TRANSACCION",
    detail:
      "Error durante la generación del UID único por ejecución de transacción.",
  },
  QWPO01211070: {
    code: "QWPO01211070",
    title:
      "SE HA PRODUCIDO UN ERROR TECNICO EN LOS MARSHALLER Y UNMARSHALLER",
    detail:
      "Error genérico de arquitectura relacionado con marshaller y unmarshaller.",
  },
  QWPO01211071: {
    code: "QWPO01211071",
    title: "EL CAMPO NO TIENE UNA LONGITUD DEFINIDA",
    detail:
      "Error validando parámetros: el campo no tiene definida una longitud.",
  },
  QWPO01211072: {
    code: "QWPO01211072",
    title:
      "ERROR AL EJECUTAR LA SENTENCIA ABEND EN LA GESTION DE ERRORES NO CONTROLADOS",
    detail:
      "No se puede crear la sentencia Abend para la gestión de errores no controlados.",
  },
  QWPO01211073: {
    code: "QWPO01211073",
    title: "HA OCURRIDO UN ERROR EN LA SUBCADENA DEL ROP",
    detail:
      "Error ejecutando la subcadena de escritura en ROP.",
  },
  QWPO01211074: {
    code: "QWPO01211074",
    title: "ERROR DE AUTORIZACION: ERROR AL CONECTARSE CON LDAP",
    detail:
      "Error conectándose a LDAP para comprobar si un usuario tiene permisos para ejecutar la transacción.",
  },
  QWPO01211075: {
    code: "QWPO01211075",
    title:
      "NO SE HA ENCONTRADO FECHA CONTABLE EN BD PARA LA ENTIDAD Y PAIS INTRODUCIDOS",
    detail:
      "No se ha encontrado registro en la tabla de día contable para el país y entidad especificados.",
  },
  QWPO01211076: {
    code: "QWPO01211076",
    title: "ERROR EJECUTANDO CONECTOR GUC",
    detail:
      "La tabla de ROP activa asociada no existe.",
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
      "Se alcanzó el timeout máximo definido en configuración para la ejecución de la transacción.",
  },
  QWPO01211079: {
    code: "QWPO01211079",
    title:
      "SE HA ALCANZADO EL TIEMPO MAXIMO DE CPU PARA LA GESTION DE RECURSOS DE APX",
    detail:
      "Se alcanzó el límite de CPU establecido en configuración para la ejecución de la transacción.",
  },
  QWPO01211080: {
    code: "QWPO01211080",
    title:
      "ERROR EN EL FORMATEO/DESFORMATEO EN EL INTERBACKEND PROXY",
    detail:
      "Se produjo un error durante el formateo o desformateo de la petición o respuesta del servicio proxy.",
  },
  QWPO01211081: {
    code: "QWPO01211081",
    title: "ERROR EN LA INVOCACION EN EL INTERBACKEND PROXY",
    detail:
      "Se produjo un error durante la invocación HTTP del servicio proxy.",
  },
  QWPO01211082: {
    code: "QWPO01211082",
    title: "ERROR DE VISIBILIDAD DE COMPONENTES DE ARQUITECTURA",
    detail:
      "Se intentó acceder a un componente de arquitectura que no es público o no está permitido.",
  },
  QWPO01211083: {
    code: "QWPO01211083",
    title: "ERROR DE VISIBILIDAD DE APLICATIVO",
    detail:
      "Se intentó acceder a una librería aplicativa cuyo invocador no tiene permisos de ejecución.",
  },
  QWPO01211084: {
    code: "QWPO01211084",
    title:
      "LA COMBINACION DE CANAL , MEDIO Y SERVICIO INDICADA NO ES VALIDA",
    detail:
      "Los valores de channelCode, environCode y productCode recibidos en cabecera no están entre los permitidos por MIS.",
  },
  QWPO01211085: {
    code: "QWPO01211085",
    title:
      "LAS UTILIDADES DE ARQUITECTURA NO PUEDEN SER COMPARTIDAS ENTRE LIBRERIAS",
    detail:
      "Se intentó usar directamente una utilidad de arquitectura instanciada desde una librería de una UUAA por otra librería de otra UUAA.",
  },
  QWPO01211086: {
    code: "QWPO01211086",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A MONGODB",
    detail:
      "Timeout de operación o conexión accediendo a MongoDB.",
  },
  QWPO01211087: {
    code: "QWPO01211087",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A LITE",
    detail:
      "Timeout de operación o conexión accediendo al servicio Lite.",
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
      "Timeout de operación o conexión accediendo al Gestor Documental (Livelink).",
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
  QWPO01211094: {
    code: "QWPO01211094",
    title: "ERROR DE TIEMPO EXCEDIDO DE CONEXION A EXACTTARGET",
    detail:
      "Timeout de operación o conexión accediendo al servicio externo ExactTarget. Actualmente en desuso.",
  },
  QWPO01211095: {
    code: "QWPO01211095",
    title:
      "ERROR DE TIEMPO EXCEDIDO DE CONEXION A ELASTICSEARCH",
    detail:
      "Timeout de operación o conexión accediendo a Elasticsearch.",
  },
  QWPO01211096: {
    code: "QWPO01211096",
    title:
      "SE HA SUPERADO EL LIMITE DE FICHEROS ADJUNTOS EN LA TRANSACCION",
    detail:
      "Se superó el número de ficheros adjuntos permitidos en una petición Multipart.",
  },
  QWPO01211097: {
    code: "QWPO01211097",
    title:
      "SE HA SUPERADO EL LIMITE DE BYTES DE LOS FICHEROS ADJUNTOS EN LA TRANSACCION",
    detail:
      "Se superó el tamaño total permitido de ficheros adjuntos en una petición Multipart.",
  },
  QWPO01211098: {
    code: "QWPO01211098",
    title:
      "SE HA PRODUCIDO UN ERROR EN LA RECEPCION DE LOS FICHEROS ADJUNTOS EN LA TRX",
    detail:
      "Se produjo un error al procesar algún fichero incluido en una petición Multipart.",
  },
  QWPO01211099: {
    code: "QWPO01211099",
    title: "CONFIGURACION DE RUTAS DE RECURSOS NO ENCONTRADA",
    detail:
      "No se pudo recuperar la ruta de configuración de recursos de Tercios (doc@web).",
  },
  QWPO01211100: {
    code: "QWPO01211100",
    title: "ARCHIVO DE DATOS NO ENCONTRADO",
    detail:
      "No se pudo recuperar un archivo de datos para la generación de informes de Tercios (doc@web).",
  },
  QWPO01211101: {
    code: "QWPO01211101",
    title: "ARCHIVO DE PROPERTIES NO ENCONTRADO",
    detail:
      "No se pudo recuperar un archivo de properties para la generación de informes de Tercios (doc@web).",
  },
  QWPO01211102: {
    code: "QWPO01211102",
    title: "ERROR DURANTE EL PROCESAMIENTO DEL PROPERTIES",
    detail:
      "Se produjo un error al procesar un archivo de datos o properties para la generación de informes de Tercios (doc@web).",
  },
  QWPO01211103: {
    code: "QWPO01211103",
    title: "ARCHIVO DE IMAGENES NO ENCONTRADO",
    detail:
      "No se pudo recuperar un archivo de imágenes para la generación de informes de Tercios (doc@web).",
  },
  QWPO01211104: {
    code: "QWPO01211104",
    title: "ATRIBUTO ERRONEO",
    detail:
      "Error interno de doc@web relacionado con un atributo.",
  },
  QWPO01211105: {
    code: "QWPO01211105",
    title: "ARCHIVO NO ENCONTRADO(A NIVEL DE PROCESAMIENTO DOC@WEB)",
    detail:
      "Error interno de doc@web relacionado con la inexistencia de un fichero.",
  },
  QWPO01211106: {
    code: "QWPO01211106",
    title: "ARCHIVO CORRUPTO",
    detail:
      "Error interno de doc@web relacionado con un archivo corrupto.",
  },
  QWPO01211107: {
    code: "QWPO01211107",
    title: "ERROR DURANTE EL TRATAMIENTO DE LAS IMAGENES DEL PDF",
    detail:
      "Error interno de doc@web relacionado con imágenes en el PDF.",
  },
  QWPO01211108: {
    code: "QWPO01211108",
    title: "ERROR DURANTE EL TRATAMIENTO DE LAS METRICAS DEL PDF",
    detail:
      "Error interno de doc@web relacionado con métricas del PDF a generar.",
  },
  QWPO01211109: {
    code: "QWPO01211109",
    title: "ERROR DURANTE EL TRATAMIENDO DEL OVERLAY DEL PDF",
    detail:
      "Error interno de doc@web relacionado con el overlay del PDF a generar.",
  },
  QWPO01211110: {
    code: "QWPO01211110",
    title: "ERROR DURANTE EL TRATAMIENDO DEL PAGEFORMAT DEL PDF",
    detail:
      "Error interno de doc@web relacionado con el pageformat del PDF a generar.",
  },
  QWPO01211111: {
    code: "QWPO01211111",
    title:
      "ERROR DURANTE EL TRATAMIENTO DE LOS DATOS DINAMICOS DEL DOCUMENTO PDF",
    detail:
      "Error interno de doc@web relacionado con los datos de entrada para generar el PDF.",
  },
  QWPO01211112: {
    code: "QWPO01211112",
    title: "ERROR INTERNO AL GENERAR EL DOCUMENTO PDF",
    detail: "Se produjo un error interno de doc@web al generar el PDF.",
  },
  QWPO01211113: {
    code: "QWPO01211113",
    title: 'EXCEPCION INTERNA "ITEXT"',
    detail:
      "Se produjo un error interno de doc@web relacionado con iText.",
  },
  QWPO01211114: {
    code: "QWPO01211114",
    title: "ERROR DESCONOCIDO EN EJECUCION DE DOC@WEB",
    detail:
      "Se produjo un error interno desconocido en doc@web.",
  },
  QWPO01211115: {
    code: "QWPO01211115",
    title: "ERROR CREANDO LOS CLIENTES ASO",
    detail:
      "Se produjo un error en la creación del cliente del servicio ASO.",
  },
  QWPO01211116: {
    code: "QWPO01211116",
    title: "ERROR EN LA INVOCACION AL SERVICIO ASO",
    detail:
      "Se produjo un error en la invocación al servicio ASO.",
  },
  QWPO01211117: {
    code: "QWPO01211117",
    title: "EL METODO DEL ABSTRACT TRANSACTION NO SE PUEDE EJECUTAR",
    detail:
      "Se intentó ejecutar un método legacy del AbstractTransaction que está temporalmente bloqueado por configuración.",
  },
  QWPO01211118: {
    code: "QWPO01211118",
    title: "EL METODO DEL ABSTRACT LIBRARY NO SE PUEDE EJECUTAR",
    detail:
      "Se intentó ejecutar un método legacy del AbstractLibrary que está temporalmente bloqueado por configuración.",
  },
  QWPO01211119: {
    code: "QWPO01211119",
    title: "ERROR PRODUCIDO DURANTE EL PARSEO DE UN OBJETO",
    detail:
      "ParseException. Error de parseo o mapeo durante la operación ejecutada.",
  },
  QWPO01211120: {
    code: "QWPO01211120",
    title: "ERROR DE ENTRADA Y SALIDA, BIEN SEA A NIVEL LOCAL O EN RED",
    detail:
      "IOException. Error genérico de entrada/salida durante la operación ejecutada.",
  },
  QWPO01211121: {
    code: "QWPO01211121",
    title: "ERROR DE ENTRADA Y SALIDA A NIVEL DE RED $115$",
    detail:
      "NetworkIOException. Error de entrada/salida en red durante la operación ejecutada.",
  },
  QWPO01211122: {
    code: "QWPO01211122",
    title:
      "ERROR PRODUCIDO EN LA PARTE SERVIDORA DURANTE LA COMUNICACION HTTP",
    detail:
      "HTTPServerException. Error de comunicación en la parte servidora durante la operación ejecutada.",
  },
  QWPO01211123: {
    code: "QWPO01211123",
    title:
      "ERROR PRODUCIDO EN LA PARTE CLIENTE DURANTE LA COMUNICACION HTTP",
    detail:
      "HTTPClientException. Error de comunicación en la parte cliente durante la operación ejecutada.",
  },
  QWPO01211124: {
    code: "QWPO01211124",
    title: "ERROR PRODUCIDO AL ESTABLECER COMUNICACION HTTP $115$ $215$",
    detail:
      "HTTPException. Error al establecer la comunicación HTTP.",
  },
  QWPO01211125: {
    code: "QWPO01211125",
    title: "TIMEOUT EN ACCESO A BD $115$ $215$",
    detail:
      "TimeoutException. Timeout en la conexión o acceso a base de datos.",
  },
  QWPO01211126: {
    code: "QWPO01211126",
    title: "OPERACION NO PERMITIDA $115$",
    detail:
      "OperationNotAllowedException. La operación ejecutada no está permitida.",
  },
  QWPO01211127: {
    code: "QWPO01211127",
    title: "ERROR DE COMUNICACION CON BD $115$ $215$",
    detail:
      "DBException. Error en la ejecución de la query o comunicación con base de datos.",
  },
  QWPO01211128: {
    code: "QWPO01211128",
    title: "ERROR EN LA EJECUCION DE LA TRANSACCION",
    detail:
      "ExecutionException. Error durante la operación ejecutada.",
  },
  QWPO01211129: {
    code: "QWPO01211129",
    title: "ERROR CREANDO UTILIDAD GESTOR DOCUMENTAL GLUSTER",
    detail:
      "Se produjo un error al crear una utilidad de Gestión Documental de tipo Gluster.",
  },
  QWPO01211130: {
    code: "QWPO01211130",
    title: "ERROR CREANDO UTILIDAD GESTOR DOCUMENTAL LIVELINK",
    detail:
      "Se produjo un error al crear una utilidad de Gestión Documental de tipo Livelink.",
  },
  QWPO01211131: {
    code: "QWPO01211131",
    title: "ERROR: USUARIO NO AUTORIZADO A CONECTAR A GLUSTER",
    detail:
      "Error de autenticación al intentar conectarse a Gluster desde una utilidad de Gestión Documental.",
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
      "LocalIOException. Error genérico de entrada/salida local en cliente.",
  },
  QWPO01211134: {
    code: "QWPO01211134",
    title: "ERROR DE TIMEOUT",
    detail:
      "network.TimeoutException. Error de timeout durante la petición de red.",
  },
  QWPO01211135: {
    code: "QWPO01211135",
    title: "LA URL NO ESTA BIEN FORMADA",
    detail:
      "MalformedURLException. La URL solicitada no tiene un formato válido.",
  },
  QWPO01211136: {
    code: "QWPO01211136",
    title: "PROTOCOLO DESCONOCIDO",
    detail:
      "UnknownProtocolException. El protocolo usado en la invocación no es válido.",
  },
  QWPO01211137: {
    code: "QWPO01211137",
    title: "ACCESO NO PERMITIDO",
    detail:
      "IllegalAccessException. Se produjo un acceso no autorizado a un recurso.",
  },
  QWPO01211138: {
    code: "QWPO01211138",
    title: "CLASE NO ENCONTRADA",
    detail:
      "ClassNotFoundException. La clase solicitada no está disponible.",
  },
  QWPO01211139: {
    code: "QWPO01211139",
    title: "ERROR EN LA INSTANCIACION DEL OBJETO",
    detail:
      "InstantiationException. Error genérico creando una nueva instancia del objeto solicitado.",
  },
  QWPO01211140: {
    code: "QWPO01211140",
    title: "METODO NO DISPONIBLE",
    detail:
      "NoSuchMethodException. El método invocado no existe.",
  },
  QWPO01211141: {
    code: "QWPO01211141",
    title: "ERROR EN LA INVOCACION",
    detail:
      "InvocationTargetException. Error genérico durante la invocación a un recurso.",
  },
  QWPO01211142: {
    code: "QWPO01211142",
    title: "USUARIO NO AUTORIZADO",
    detail:
      "UserNotAuthorizedException. El usuario no está autorizado para acceder al recurso.",
  },
  QWPO01211143: {
    code: "QWPO01211143",
    title: "EL DOCUMENTO PDF QUE SE ESTA TRATANDO ESTA PROTEGIDO",
    detail:
      "El documento PDF procesado está protegido y no puede ser tratado normalmente.",
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
    title: "SE HA ENONTRADO UN ERROR EN EL PROCESO DE LA LLAMADA A CICS",
    detail:
      "Se ha producido un error dentro del conector de CICS al momento de ejecutar la llamada de la transacción.",
  },
  QWPO01211147: {
    code: "QWPO01211147",
    title: "ERROR DE TIEMPO EXCEDIDO EN LLAMADA A TRX CICS",
    detail:
      "Se ha producido un error por timeout en la llamada a la transacción de CICS.",
  },
  QWPO01211148: {
    code: "QWPO01211148",
    title: "ERROR DE CONFIGURACION EN LA LLAMADA A CICS",
    detail:
      "Se ha producido un error por una mala configuración en el conector CICS, tanto de arquitectura como aplicativa.",
  },
  QWPO01211149: {
    code: "QWPO01211149",
    title: "ERROR EN LA FABRICA DE SOCKET PARA CICS",
    detail:
      "Se ha producido un error al momento de la creación del pool de conexiones del socket para la conexión con CICS.",
  },
};

function firstTwoParagraphs(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";

  const paragraphs = source
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!paragraphs.length) return "";

  return paragraphs.slice(0, 2).join("\n\n").trim();
}

function sumMetricValues(
  response: TimeseriesApiResponse,
  key:
    | "sum_technical_error"
    | "sum_num_executions"
    | "mean_span_duration"
): number {
  const groups = Array.isArray(response.timeseries) ? response.timeseries : [];
  const data = Array.isArray(response.data) ? response.data : [];

  const metrics =
    groups.flatMap((group) => group.metrics ?? []).length > 0
      ? groups.flatMap((group) => group.metrics ?? [])
      : data;

  if (!metrics.length) return 0;

  return metrics.reduce((sum, point) => {
    return sum + Number(point.values?.[key] ?? 0);
  }, 0);
}

function extractControlledErrorCodeOnly(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";

  const match = source.match(/\b(QWPO\d{8})\b/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function extractControlledErrorCode(text: string): string {
  return extractControlledErrorCodeOnly(text);
}

function extractControlledErrorDetail(text: string): string {
  const code = extractControlledErrorCodeOnly(text);
  if (!code) return "";

  const dict = CONTROLLED_ERROR_DICTIONARY[code];
  if (!dict) return "";

  return `${dict.title}\n${dict.detail}`;
}

function extractExceptionName(text: string): string {
  const source = String(text || "").trim();
  if (!source) return "";

  const methodMatches = [
    ...source.matchAll(/\bat\s+[A-Za-z0-9_$.]+\.([A-Za-z0-9_]+)\(/g),
  ];
  const preferredMethod = methodMatches.find(
    (m) => /Exception/i.test(m[1]) || /CircuitBreaker/i.test(m[1])
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
    source.match(/([A-Za-z0-9_$.]*DBException)/) ||
    source.match(/([A-Za-z0-9_$.]*HTTPException)/) ||
    source.match(/([A-Za-z0-9_$.]*Exception)/);

  const exceptionName = exceptionMatch?.[1]?.split(".").pop() ?? "";
  const controlledCode = extractControlledErrorCodeOnly(source);

  if (/timeout/i.test(source) && /API-CONNECTOR/i.test(source)) {
    const target = apiId ? ` al invocar ${apiId}` : "";
    const trxText = trx ? ` en la trx ${trx}` : "";
    const ex = exceptionName ? ` (${exceptionName})` : "";
    const code = controlledCode ? ` [${controlledCode}]` : "";
    return `Timeout en API-CONNECTOR${target}${trxText}${ex}${code}. Posible indisponibilidad o alta latencia en dependencia remota.`;
  }

  if (/cics/i.test(source)) {
    const trxText = trx ? ` en la trx ${trx}` : "";
    const ex = exceptionName ? ` (${exceptionName})` : "";
    const code = controlledCode ? ` [${controlledCode}]` : "";
    return `Fallo en integración CICS${trxText}${ex}${code}. Requiere revisión del backend transaccional o del conector.`;
  }

  if (/jdbc|dbexception|sql|database/i.test(source)) {
    const trxText = trx ? ` para la trx ${trx}` : "";
    const ex = exceptionName ? ` (${exceptionName})` : "";
    return `Error de base de datos${trxText}${ex}. Posible problema de conectividad, consulta o dependencia JDBC.`;
  }

  if (/http/i.test(source)) {
    const target = apiId ? ` al consumir ${apiId}` : "";
    const trxText = trx ? ` en la trx ${trx}` : "";
    const ex = exceptionName ? ` (${exceptionName})` : "";
    return `Error HTTP${target}${trxText}${ex}. Revisar disponibilidad o respuesta de la API remota.`;
  }

  if (exceptionName) {
    const trxText = trx ? ` en la trx ${trx}` : "";
    return `Se detectó ${exceptionName}${trxText}. Requiere revisión técnica del flujo y de la dependencia asociada.`;
  }

  if (firstLine) {
    return `${firstLine.slice(
      0,
      220
    )}. Requiere revisión del flujo técnico y de la dependencia asociada a la transacción.`;
  }

  return source.slice(0, 220);
}

function formatSummaryMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(2)} ms`;
}

type IncidentSummaryContext = {
  trx?: string;
  exception?: string;
  controlledErrorCode?: string;
  controlledErrorDetail?: string;
  apxChannel?: string;
  numeroErrores?: number;
  numeroEjecuciones?: number;
  numeroTiempoRespuestaMs?: number;
  tuvoMayorNumeroEjecuciones?: string;
  aumentoPromedioTiempoRespuesta?: string;
};

function buildHeuristicActionText(
  source: string,
  context?: IncidentSummaryContext
): string {
  const text = `${source}\n${context?.controlledErrorDetail ?? ""}\n${
    context?.exception ?? ""
  }`;

  if (/timeout|time out|timed out/i.test(text)) {
    return "Revisar latencia de la dependencia invocada, tiempos de espera configurados y saturación del servicio o backend asociado.";
  }

  if (/CircuitBreaker/i.test(text)) {
    return "Validar disponibilidad del servicio remoto, tasa de fallos recientes y políticas de resiliencia antes de reintentar.";
  }

  if (/DBException|JDBC|JPA|database|sql/i.test(text)) {
    return "Revisar conectividad, pool de conexiones, consultas ejecutadas y salud de la base de datos involucrada.";
  }

  if (/HTTPException|HTTPClientException|HTTPServerException|http/i.test(text)) {
    return "Validar endpoint, payload, códigos de respuesta y disponibilidad de la API o dependencia remota.";
  }

  if (/CICS/i.test(text)) {
    return "Comprobar timeout, configuración del conector CICS y disponibilidad del backend transaccional.";
  }

  if (/NullPointerException/i.test(text)) {
    return "Revisar datos de entrada, valores nulos y validaciones previas en el flujo técnico.";
  }

  if (/composeTransactionResponse/i.test(text)) {
    return "Revisar el armado de la respuesta transaccional, el mapeo de datos y el manejo del error controlado devuelto por la arquitectura.";
  }

  return "Validar trazas, dependencia invocada y el punto exacto del flujo donde se origina la excepción para acotar causa raíz.";
}

function buildHeuristicIncidentSummary(
  source: string,
  context?: IncidentSummaryContext
): string {
  const diagnostic = summarizeDescription(source);

  const impactParts: string[] = [];
  if (Number(context?.numeroErrores ?? 0) > 0) {
    impactParts.push(
      `${Number(context?.numeroErrores ?? 0).toLocaleString()} errores técnicos detectados`
    );
  }
  if (Number(context?.numeroEjecuciones ?? 0) > 0) {
    impactParts.push(
      `${Number(context?.numeroEjecuciones ?? 0).toLocaleString()} ejecuciones asociadas`
    );
  }
  if (Number(context?.numeroTiempoRespuestaMs ?? 0) > 0) {
    impactParts.push(
      `tiempo promedio de ${formatSummaryMs(
        Number(context?.numeroTiempoRespuestaMs ?? 0)
      )}`
    );
  }

  const signalParts: string[] = [];
  if (context?.trx) {
    signalParts.push(`TRX afectada: ${context.trx}`);
  }
  if (context?.exception) {
    signalParts.push(`excepción principal: ${context.exception}`);
  }
  if (context?.controlledErrorCode) {
    signalParts.push(`código controlado: ${context.controlledErrorCode}`);
  }
  if (context?.apxChannel) {
    signalParts.push(`canal APX: ${context.apxChannel}`);
  }
  if (context?.tuvoMayorNumeroEjecuciones === "Sí") {
    signalParts.push("subió el volumen de ejecuciones respecto al día previo");
  }
  if (context?.aumentoPromedioTiempoRespuesta === "Sí") {
    signalParts.push(
      "aumentó el tiempo de respuesta respecto al día previo"
    );
  }

  return [
    `Diagnóstico: ${diagnostic}`,
    impactParts.length
      ? `Impacto observado: ${impactParts.join(", ")}.`
      : "Impacto observado: no hay suficiente señal operativa para cuantificar el impacto con mayor detalle.",
    signalParts.length
      ? `Señales relevantes: ${signalParts.join(". ")}.`
      : "",
    `Acción sugerida: ${buildHeuristicActionText(source, context)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function summarizeDescriptionWithLocalAI(
  text: string
): Promise<string | null> {
  const source = String(text || "").trim();
  if (!source) return null;

  try {
    const LanguageModelCtor = (
      globalThis as typeof globalThis & {
        LanguageModel?: LocalLanguageModel;
      }
    ).LanguageModel;

    if (!LanguageModelCtor?.availability || !LanguageModelCtor?.create) {
      return null;
    }

    const availability = await LanguageModelCtor.availability();

    if (
      availability === "unavailable" ||
      availability === "no" ||
      availability === "unsupported"
    ) {
      return null;
    }

    const session = await LanguageModelCtor.create();

    const prompt = [
      "Resume este error tecnico en espanol para un dashboard operativo.",
      "Debe ser claro, descriptivo y util.",
      "Maximo 35 palabras.",
      "Menciona dependencia, impacto o causa probable si es evidente.",
      "",
      source,
    ].join("\n");

    const output = await session.prompt(prompt);
    await session.destroy?.();

    const summary = String(output || "").trim();
    return summary || null;
  } catch {
    return null;
  }
}

async function summarizeDescriptionWithOpenAI(
  text: string,
  apiKey?: string,
  model: IncidentAiModel = "gpt-4.1-nano"
): Promise<string | null> {
  const source = String(text || "").trim();
  const key = String(apiKey || "").trim();

  if (!source || !key) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Resume errores tecnicos en espanol para un dashboard operativo. " +
                  "Debe ser claro, descriptivo y util. Maximo 35 palabras. " +
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
      return null;
    }

    const data = (await response.json()) as { output_text?: string };
    const summary = String(data.output_text || "").trim();
    return summary || null;
  } catch {
    return null;
  }
}

async function summarizeDescriptionWithGemini(
  text: string,
  apiKey?: string,
  model: IncidentAiModel = "gemini-2.5-flash-lite"
): Promise<string | null> {
  const source = String(text || "").trim();
  const key = String(apiKey || "").trim();

  if (!source || !key) return null;

  try {
    const prompt = [
      "Resume este error tecnico en espanol para un dashboard operativo.",
      "Debe ser claro, descriptivo y util.",
      "Maximo 35 palabras.",
      "Menciona dependencia, impacto o causa probable si es evidente.",
      "",
      source,
    ].join("\n");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
        key
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 90,
          },
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const summary = String(
      data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    ).trim();

    return summary || null;
  } catch {
    return null;
  }
}

async function summarizeDescriptionWithAIFrontend(params: {
  text: string;
  provider: IncidentAiProvider;
  model: IncidentAiModel;
  openAiApiKey?: string;
  geminiApiKey?: string;
  context?: IncidentSummaryContext;
}): Promise<string> {
  const { text, provider, model, openAiApiKey, geminiApiKey, context } = params;
  const source = String(text || "").trim();
  if (!source) return "";

  if (provider === "heuristic") {
    return buildHeuristicIncidentSummary(source, context);
  }

  if (provider === "local") {
    const localSummary = await summarizeDescriptionWithLocalAI(source);
    return localSummary || buildHeuristicIncidentSummary(source, context);
  }

  if (provider === "openai") {
    const openAiSummary = await summarizeDescriptionWithOpenAI(
      source,
      openAiApiKey,
      model
    );
    return openAiSummary || buildHeuristicIncidentSummary(source, context);
  }

  if (provider === "gemini") {
    const geminiSummary = await summarizeDescriptionWithGemini(
      source,
      geminiApiKey,
      model
    );
    return geminiSummary || buildHeuristicIncidentSummary(source, context);
  }

  return buildHeuristicIncidentSummary(source, context);
}

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
  operation:
    | "sum:technical_error"
    | "sum:num_executions"
    | "mean:span_duration";
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
  url.searchParams.set(
    "q",
    `spanId == "${spanId}" AND level == "ERROR"`
  );
  url.searchParams.set("sort", "ascending");
  url.searchParams.set("fromDate", fromTimestamp);
  url.searchParams.set("toDate", toTimestamp);
  url.searchParams.set("profile", "default");

  return url.toString();
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
  operation:
    | "sum:technical_error"
    | "sum:num_executions"
    | "mean:span_duration";
  key:
    | "sum_technical_error"
    | "sum_num_executions"
    | "mean_span_duration";
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
  const errorLogs = (omegaRes.data ?? []).filter(
    (item) => item.level === "ERROR"
  );

  const controlledLog =
    errorLogs.find((item) =>
      String(item.message ?? "").includes(
        "Error en composeTransactionResponse"
      )
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
    detalleErroresControlados: firstTwoParagraphs(
      controlledLog?.message ?? ""
    ),
    apxChannel: span.properties?.["channel-code"] ?? "",
    exception: span.properties?.returncode
      ? `returncode ${span.properties.returncode}`
      : "returncode 12",
  };
}

function buildDailyDates(
  installationDay: Date,
  mode: InstallationRangeMode
): Array<{ date: Date; phase: IncidentPhase }> {
  const base = startOfDay(installationDay);
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
  aiProvider?: IncidentAiProvider;
  aiModel?: IncidentAiModel;
  openAiApiKey?: string;
  geminiApiKey?: string;
}): Promise<IncidentMonitoringResult> {
  const {
    environment,
    installationDay,
    mode,
    bearerToken,
    aiProvider = "heuristic",
    aiModel = "heuristic-summary",
    openAiApiKey,
    geminiApiKey,
  } = params;

  const dailyDates = buildDailyDates(installationDay, mode);

  const rows = await Promise.all(
    dailyDates.map(async ({ date, phase }) => {
      const fromDate = startOfDay(date);
      const toDate = endOfDay(date);

      const trx = await fetchTopTrx(environment, fromDate, toDate, bearerToken);

      if (!trx) {
        return {
          phase,
          date: format(date, "dd/MM/yyyy"),
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
        } satisfies IncidentMonitoringRow;
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

      const resumenIA = await summarizeDescriptionWithAIFrontend({
        text: descriptionInfo.description,
        provider: aiProvider,
        model: aiModel,
        openAiApiKey,
        geminiApiKey,
        context: {
          trx,
          exception: exceptionName,
          controlledErrorCode,
          controlledErrorDetail,
          apxChannel: descriptionInfo.apxChannel,
          numeroErrores,
          numeroEjecuciones,
          numeroTiempoRespuestaMs,
        },
      });

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
      } satisfies IncidentMonitoringRow;
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
        row.numeroTiempoRespuestaMs > previousRow.numeroTiempoRespuestaMs
          ? "Sí"
          : "No",
    };
  });

  const rowsEnriched = rowsWithComparisons.map((row) => {
    if (aiProvider !== "heuristic") return row;

    const rebuiltSummary = buildHeuristicIncidentSummary(row.description, {
      trx: row.trx,
      exception: row.exception,
      controlledErrorCode: row.codigoErrorControlado,
      controlledErrorDetail: row.detalleErroresControlados,
      apxChannel: row.apxChannel,
      numeroErrores: row.numeroErrores,
      numeroEjecuciones: row.numeroEjecuciones,
      numeroTiempoRespuestaMs: row.numeroTiempoRespuestaMs,
      tuvoMayorNumeroEjecuciones: row.tuvoMayorNumeroEjecuciones,
      aumentoPromedioTiempoRespuesta: row.aumentoPromedioTiempoRespuesta,
    });

    return {
      ...row,
      resumenIA: rebuiltSummary,
    };
  });

  const totals = rowsEnriched.reduce(
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
    trx: rowsEnriched.find((row) => row.trx)?.trx ?? "",
    rows: rowsEnriched,
    totals,
  };
}