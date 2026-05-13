export type NanoTimestamp = string;

export type SearchMode =
  | "pipeline"
  | "utility"
  | "rho"
  | "versioning-env"
  | "versioning-incidents";

  

export type AggregateField =
  | "name"
  | "invokerTx"
  | "utilitytype"
  | "invokerLibrary"
  | "invokedparam"
  | "channel-code"
  | "typology"
  | "invokedHostTx"
  | "databaseInstance"
  | "site"
  | "env";

export type OperationType =
  | "sum:num_executions"
  | "mean:span_duration"
  | "sum:technical_error"
  | "sum:functional_error"
  | "count:utility_count"
  | "min:utility_duration"
  | "mean:utility_duration"
  | "max:utility_duration";

export type MetricSetName =
  | "functional-dashboard"
  | "utility-metric-set"
  | "technical-dashboard";

export type MetricMethod = "listAggregations" | "listTimeseries";

export interface AggregationBucket {
  bucket: Record<string, string>;
  values: Record<string, number>;
}

export interface AggregationResponse {
  buckets?: AggregationBucket[];
  data?: AggregationBucket[];
  aggregations?: AggregationBucket[];
}



export interface TimeseriesPoint {
  timestamp: string;
  values: Record<string, number>;
}

export interface TimeseriesResponse {
  data?: TimeseriesPoint[];
  timeseries?: TimeseriesPoint[];
}

export interface RawSpan {
  spanId?: string;
  traceId?: string;
  name?: string;
  duration?: number | null;
  startTime?: string | number;
  endTime?: string | number;
  startDate?: number;
  finishDate?: number;
  recordDate?: number;
  parentSpan?: string;
  properties?: Record<string, string>;
  children?: RawSpan[];
}

export interface SpansPaginatedResponse {
  data?: RawSpan[];
  pagination?: {
    totalElements?: number;
    links?: {
      first?: string;
      next?: string;
    };
  };
}

export interface NormalizedSpan {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  durationMs: number;
  utilityType: string;
  channelCode?: string;
  properties: Record<string, string>;
}


export const UTILITY_TYPES = [
  "InterBackendCics",
  "APIInternalConnectorImpl",
  "Jdbc",
  "DaasMongoConnector",
  "APIExternalConnectorImpl",
  "TitanClient",
  "GRPCClient",
  "Jpa",
] as const;

export interface ChannelApplication {
  channel: string;
  name: string;
  aap: number;
}

export type GroupedChannelCodes = Record<string, ChannelApplication[]>;

export interface ChannelCodeOption {
  channelCode: string;
  name: string;
  aap: number;
  applications: ChannelApplication[];
}

export const GROUPED_CHANNEL_CODES: GroupedChannelCodes = {
    "01": [
        {
            "channel": "01",
            "name": "ASO GATEWAY Pruebas ",
            "aap": 30000038
        },
        {
            "channel": "01",
            "name": "ASO Gateway ",
            "aap": 30000052
        },
        {
            "channel": "01",
            "name": "ASO Gateway Tracking Streaming",
            "aap": 30000095
        }
    ],
    "03": [
        {
            "channel": "03",
            "name": "Cajero Híbrido",
            "aap": 10000025
        },
        {
            "channel": "03",
            "name": "ATM",
            "aap": 10000095
        },
        {
            "channel": "03",
            "name": "LOG ATM's",
            "aap": 10000125
        }
    ],
    "04": [
        {
            "channel": "04",
            "name": "Comercio Exterior",
            "aap": 10000023
        }
    ],
    "12": [
        {
            "channel": "12",
            "name": "Logs Arquitectura Privado",
            "aap": 30000069
        }
    ],
    "14": [
        {
            "channel": "14",
            "name": "PIVOT NET Movil Privado",
            "aap": 30000018
        },
        {
            "channel": "14",
            "name": "GNC Intraday Web Privado",
            "aap": 30000019
        }
    ],
    "15": [
        {
            "channel": "15",
            "name": "MSD",
            "aap": 10000051
        }
    ],
    "20": [
        {
            "channel": "20",
            "name": "AACC (Final)",
            "aap": 10000056
        },
        {
            "channel": "20",
            "name": "AACC full Cells",
            "aap": 10000188
        },
        {
            "channel": "20",
            "name": "AACC Microcréditos",
            "aap": 10000248
        }
    ],
    "24": [
        {
            "channel": "24",
            "name": "API Channel Enterprise Frontal Privado",
            "aap": 10000157
        },
        {
            "channel": "24",
            "name": "APIC Portal Privado",
            "aap": 30000031
        },
        {
            "channel": "24",
            "name": "Pago y conciliación B2B2B Privado",
            "aap": 30000042
        },
        {
            "channel": "24",
            "name": "API Channel B2B Autoconsumo Público",
            "aap": 30000055
        },
        {
            "channel": "24",
            "name": "Login B2B2B Privado",
            "aap": 30000059
        }
    ],
    "26": [
        {
            "channel": "26",
            "name": "Comercio Exterior en BankTrade",
            "aap": 10000071
        },
        {
            "channel": "26",
            "name": "BNC",
            "aap": 10000072
        },
        {
            "channel": "26",
            "name": "BNC Privado",
            "aap": 10000152
        },
        {
            "channel": "26",
            "name": "BNC Alpha Privado",
            "aap": 10000153
        }
    ],
    "27": [
        {
            "channel": "27",
            "name": "GNC Intraday  ",
            "aap": 33
        }
    ],
    "28": [
        {
            "channel": "28",
            "name": "GEMA Corporativo Privado",
            "aap": 10000156
        },
        {
            "channel": "28",
            "name": "Enroll GEMA SoftToken Corporativo Privado",
            "aap": 10000254
        }
    ],
    "29": [
        {
            "channel": "29",
            "name": "Senda BNC Privada",
            "aap": 10000207
        }
    ],
    "2B": [
        {
            "channel": "2B",
            "name": "H2H (BNC)",
            "aap": 10000054
        }
    ],
    "51 / 6Z": [
        {
            "channel": "51 / 6Z",
            "name": "Web Methods (BackEnd)",
            "aap": 10000008
        }
    ],
    "54": [
        {
            "channel": "54",
            "name": "JBPM (Privado)",
            "aap": 10000118
        }
    ],
    "60": [
        {
            "channel": "60",
            "name": "BCom (Personas)",
            "aap": 0
        },
        {
            "channel": "60",
            "name": "BCom (Pymes)",
            "aap": 10000002
        },
        {
            "channel": "60",
            "name": "Pagos Ripple",
            "aap": 10000061
        },
        {
            "channel": "60",
            "name": "Comercio Exterior en BankTrade (PyMEs)",
            "aap": 10000100
        },
        {
            "channel": "60",
            "name": "mPOS SMEs Privado IB",
            "aap": 10000177
        },
        {
            "channel": "60",
            "name": "BCom Personas Privado",
            "aap": 10000192
        },
        {
            "channel": "60",
            "name": "BCom Pymes Privado",
            "aap": 10000193
        },
        {
            "channel": "60",
            "name": "Front Bandera StandIn Privado",
            "aap": 10000208
        },
        {
            "channel": "60",
            "name": "Bcom Full Cells F Privado",
            "aap": 10000211
        },
        {
            "channel": "60",
            "name": "Bcom Cells GloMo Privado",
            "aap": 10000215
        }
    ],
    "6B": [
        {
            "channel": "6B",
            "name": "Procredit 2.0",
            "aap": 10000093
        }
    ],
    "6G": [
        {
            "channel": "6G",
            "name": "Gema Privado",
            "aap": 10000133
        },
        {
            "channel": "6G",
            "name": "mPOS PYME Privado",
            "aap": 10000168
        },
        {
            "channel": "6G",
            "name": "GEMA mPOS Público",
            "aap": 10000174
        },
        {
            "channel": "6G",
            "name": "Stand In Gema Privado",
            "aap": 10000219
        },
        {
            "channel": "6G",
            "name": "Digital Activation Gema Privado",
            "aap": 10000227
        },
        {
            "channel": "6G",
            "name": "Digital Onboarding Gema noClientes Público",
            "aap": 10000231
        },
        {
            "channel": "6G",
            "name": "Enroll GEMA SoftToken PyME Privado",
            "aap": 10000255
        }
    ],
    "6M": [
        {
            "channel": "6M",
            "name": "My Business (Público)",
            "aap": 10000115
        }
    ],
    "6P": [
        {
            "channel": "6P",
            "name": "Gestión de Empresas",
            "aap": 10000029
        },
        {
            "channel": "6P",
            "name": "Bcom F Cells Stand In Privado (stand-in)",
            "aap": 10000204
        }
    ],
    "6Z": [
        {
            "channel": "6Z",
            "name": "BCom (Público)",
            "aap": 10000011
        },
        {
            "channel": "6Z",
            "name": "NetCash Público",
            "aap": 10000130
        },
        {
            "channel": "6Z",
            "name": "Bcom Cells Público",
            "aap": 10000131
        },
        {
            "channel": "6Z",
            "name": "Journey TDC 2Play Público",
            "aap": 10000163
        },
        {
            "channel": "6Z",
            "name": "Cuenta eje Público",
            "aap": 10000182
        },
        {
            "channel": "6Z",
            "name": "Onboarding crediProvedores Anonimo",
            "aap": 10000235
        }
    ],
    "70": [
        {
            "channel": "70",
            "name": "EECC (Final)",
            "aap": 10000057
        },
        {
            "channel": "70",
            "name": "SICA",
            "aap": 10000081
        },
        {
            "channel": "70",
            "name": "EECC full Cells (EVA)",
            "aap": 10000194
        }
    ],
    "7P": [
        {
            "channel": "7P",
            "name": "Intranet",
            "aap": 10000007
        },
        {
            "channel": "7P",
            "name": "Prestanet ATA y Seguros",
            "aap": 10000079
        },
        {
            "channel": "7P",
            "name": "SIP2000",
            "aap": 10000084
        },
        {
            "channel": "7P",
            "name": "Bandas Salariales WEB Privado",
            "aap": 10000129
        },
        {
            "channel": "7P",
            "name": "App Somos Privado",
            "aap": 10000132
        },
        {
            "channel": "7P",
            "name": "Universidad BBVA Privado",
            "aap": 10000139
        }
    ],
    "8A": [
        {
            "channel": "8A",
            "name": "Portal Extranet",
            "aap": 10000028
        },
        {
            "channel": "8A",
            "name": "Record Keeping Privado",
            "aap": 10000250
        }
    ],
    "8B": [
        {
            "channel": "8B",
            "name": "Extranet (No clientes)",
            "aap": 10000074
        },
        {
            "channel": "8B",
            "name": "Extranet (Público)",
            "aap": 10000075
        },
        {
            "channel": "8B",
            "name": "Promotores Hipotecarios (privado)",
            "aap": 10000111
        },
        {
            "channel": "8B",
            "name": "Promotores Hipotecarios (publico)",
            "aap": 10000112
        },
        {
            "channel": "8B",
            "name": "PAC-CFDI",
            "aap": 10000162
        },
        {
            "channel": "8B",
            "name": "Extranet Bastanteo Cells Privado",
            "aap": 10000217
        }
    ],
    "9A": [
        {
            "channel": "9A",
            "name": "SAP Arrendamiento",
            "aap": 10000043
        }
    ],
    "9B": [
        {
            "channel": "9B",
            "name": "Auto Alerta (Público)",
            "aap": 10000062
        },
        {
            "channel": "9B",
            "name": "Auto Alerta (Privado)",
            "aap": 10000068
        },
        {
            "channel": "9B",
            "name": "BBVA SOS Privado",
            "aap": 10000134
        },
        {
            "channel": "9B",
            "name": "BBVA SOS (No clientes -  Privado)",
            "aap": 10000135
        }
    ],
    "9C": [
        {
            "channel": "9C",
            "name": "Claim Center (Máquina)",
            "aap": 10000063
        }
    ],
    "9D": [
        {
            "channel": "9D",
            "name": "GPS Ajustadores",
            "aap": 10000064
        },
        {
            "channel": "9D",
            "name": "eDUA Privado",
            "aap": 10000236
        }
    ],
    "9E": [
        {
            "channel": "9E",
            "name": "CyberFinancial Front",
            "aap": 10000083
        },
        {
            "channel": "9E",
            "name": "CyberFinancial",
            "aap": 10000106
        }
    ],
    "9F": [
        {
            "channel": "9F",
            "name": "Plataforma Fiscal",
            "aap": 10000040
        }
    ],
    "9G": [
        {
            "channel": "9G",
            "name": "Gestor de Mensajes",
            "aap": 10000066
        },
        {
            "channel": "9G",
            "name": "Gestión de Liquidez",
            "aap": 10000077
        }
    ],
    "9H": [
        {
            "channel": "9H",
            "name": "Onboarding Digital",
            "aap": 10000128
        },
        {
            "channel": "9H",
            "name": "Cuenta eje Privado",
            "aap": 10000181
        }
    ],
    "9I": [
        {
            "channel": "9I",
            "name": "MAC RUC",
            "aap": 10000048
        }
    ],
    "9K": [
        {
            "channel": "9K",
            "name": "CF Broker Marsh",
            "aap": 10000099
        },
        {
            "channel": "9K",
            "name": "Eikos&Seguros Privado",
            "aap": 10000165
        }
    ],
    "9O": [
        {
            "channel": "9O",
            "name": "LeaseCloud (Privado)",
            "aap": 10000113
        },
        {
            "channel": "9O",
            "name": "LeasingDigital Público",
            "aap": 10000148
        }
    ],
    "9S": [
        {
            "channel": "9S",
            "name": "Login Onboarding usuarios Público",
            "aap": 30000118
        },
        {
            "channel": "9S",
            "name": "Onboarding Portal Privado SandBox No cliente",
            "aap": 30000130
        },
        {
            "channel": "9S",
            "name": "Validación Backend Roles Privado",
            "aap": 30000135
        },
        {
            "channel": "9S",
            "name": "Validación Backend Roles Público",
            "aap": 30000136
        }
    ],
    "9V": [
        {
            "channel": "9V",
            "name": "Voz del Cliente Privado",
            "aap": 10000141
        }
    ],
    "9W": [
        {
            "channel": "9W",
            "name": "Equities Investment Solution Privado",
            "aap": 10000178
        },
        {
            "channel": "9W",
            "name": "GUIA Privado",
            "aap": 10000202
        },
        {
            "channel": "9W",
            "name": "GUIA Privado IB",
            "aap": 10000203
        },
        {
            "channel": "9W",
            "name": "Centra C&IB Full Cells",
            "aap": 10000249
        },
        {
            "channel": "9W",
            "name": "International Cashpooling Privado",
            "aap": 30000078
        }
    ],
    "9X": [
        {
            "channel": "9X",
            "name": "Onboarding FX Privado",
            "aap": 10000164
        },
        {
            "channel": "9X",
            "name": "Onboarding FX Público",
            "aap": 10000189
        },
        {
            "channel": "9X",
            "name": "Onboarding Transversal DIY Privado",
            "aap": 10000206
        }
    ],
    "AL": [
        {
            "channel": "AL",
            "name": "App Asesor Digital Privado",
            "aap": 10000258
        }
    ],
    "AM": [
        {
            "channel": "AM",
            "name": "Multicanal de Seguros MFSA",
            "aap": 10000116
        },
        {
            "channel": "AM",
            "name": "PureCloud Interbacked",
            "aap": 10000136
        },
        {
            "channel": "AM",
            "name": "Salesforce",
            "aap": 10000137
        }
    ],
    "AP": [
        {
            "channel": "AP",
            "name": "APIs Empresariales",
            "aap": 10000080
        },
        {
            "channel": "AP",
            "name": "API Channel Privado",
            "aap": 10000220
        },
        {
            "channel": "AP",
            "name": "API Channel Backoffice full cells",
            "aap": 30000030
        },
        {
            "channel": "AP",
            "name": "API Channel B2B No Autoconsumo Privado",
            "aap": 30000057
        }
    ],
    "AR": [
        {
            "channel": "AR",
            "name": "ARCE Provenir (gtOAuth)",
            "aap": 30000016
        },
        {
            "channel": "AR",
            "name": "ARCE Corporate Rating System IB",
            "aap": 30000041
        }
    ],
    "AX": [
        {
            "channel": "AX",
            "name": "APX (BackEnd)",
            "aap": 10000003
        },
        {
            "channel": "AX",
            "name": "Transformación Backoffice Canales Digitales",
            "aap": 10000225
        },
        {
            "channel": "AX",
            "name": "FDT Cliente Sin Canal Pública",
            "aap": 10000229
        },
        {
            "channel": "AX",
            "name": "Lectura PDFs Interbackend",
            "aap": 10000234
        },
        {
            "channel": "AX",
            "name": "APX (Pruebas Interbackends)",
            "aap": 10990003
        },
        {
            "channel": "AX",
            "name": "Front KCSN Privado",
            "aap": 30000079
        },
        {
            "channel": "AX",
            "name": "Tablas Generales y Corporativas",
            "aap": 30000080
        }
    ],
    "BN": [
        {
            "channel": "BN",
            "name": "BNPL Apertura no clientes Pública",
            "aap": 10000239
        }
    ],
    "BT": [
        {
            "channel": "BT",
            "name": "BTGE Monitor F-T Privado",
            "aap": 10000195
        }
    ],
    "C0": [
        {
            "channel": "C0",
            "name": "Calypso",
            "aap": 10000047
        },
        {
            "channel": "C0",
            "name": "CALYPSO_MCVO IB",
            "aap": 10000242
        }
    ],
    "C2": [
        {
            "channel": "C2",
            "name": "Calypso OTC Privado",
            "aap": 10000142
        },
        {
            "channel": "C2",
            "name": "Calypso GCE Privado",
            "aap": 10000145
        }
    ],
    "CC": [
        {
            "channel": "CC",
            "name": "CaS ATMs",
            "aap": 10000160
        }
    ],
    "CH": [
        {
            "channel": "CH",
            "name": "Chatbot Público",
            "aap": 10000138
        }
    ],
    "CL": [
        {
            "channel": "CL",
            "name": "CLAN Online",
            "aap": 30000008
        },
        {
            "channel": "CL",
            "name": "CLAN Batch",
            "aap": 30000009
        }
    ],
    "CR": [
        {
            "channel": "CR",
            "name": "ATM Runtime Handler Privado",
            "aap": 10000238
        }
    ],
    "DC": [
        {
            "channel": "DC",
            "name": "Contrapartes CIB IB ",
            "aap": 10000256
        }
    ],
    "DF": [
        {
            "channel": "DF",
            "name": "BOT Cobranza Público",
            "aap": 10000221
        }
    ],
    "EG": [
        {
            "channel": "EG",
            "name": "Reconexión Automática E-global Privado",
            "aap": 10000232
        }
    ],
    "EN": [
        {
            "channel": "EN",
            "name": "Cyber Notarial Privado",
            "aap": 10000159
        }
    ],
    "F2": [
        {
            "channel": "F2",
            "name": "Fiduciario (Privado)",
            "aap": 10000017
        },
        {
            "channel": "F2",
            "name": "Fiduciario (Máquina)",
            "aap": 10000038
        }
    ],
    "FB": [
        {
            "channel": "FB",
            "name": "Contact Center Público",
            "aap": 10000179
        },
        {
            "channel": "FB",
            "name": "Estudio Socioeconómico Privado",
            "aap": 10000185
        }
    ],
    "FD": [
        {
            "channel": "FD",
            "name": "Firma Diferida Personas Físicas",
            "aap": 10000246
        },
        {
            "channel": "FD",
            "name": "Firma Diferida Personas Morales",
            "aap": 10000247
        }
    ],
    "FG": [
        {
            "channel": "FG",
            "name": "Tablero banca PYME",
            "aap": 10000245
        }
    ],
    "FR": [
        {
            "channel": "FR",
            "name": "FRM IB",
            "aap": 30000072
        }
    ],
    "FS": [
        {
            "channel": "FS",
            "name": "Feature Space ARIC",
            "aap": 10000244
        }
    ],
    "GC": [
        {
            "channel": "GC",
            "name": "VoiceBot Cobranza Público",
            "aap": 10000237
        }
    ],
    "GG": [
        {
            "channel": "GG",
            "name": "Podio Virtual Privado",
            "aap": 10000110
        }
    ],
    "GM": [
        {
            "channel": "GM",
            "name": "MTRE Gateway Privado",
            "aap": 10000218
        }
    ],
    "GP": [
        {
            "channel": "GP",
            "name": "GCP CIB Privado",
            "aap": 10000260
        }
    ],
    "GR": [
        {
            "channel": "GR",
            "name": "ORBIT Privado",
            "aap": 10000252
        }
    ],
    "H2": [
        {
            "channel": "H2",
            "name": "H2H (Máquina)",
            "aap": 10000055
        },
        {
            "channel": "H2",
            "name": "H2H APX (Máquina)",
            "aap": 10000067
        },
        {
            "channel": "H2",
            "name": "H2H - HelpDesk",
            "aap": 10000070
        },
        {
            "channel": "H2",
            "name": "H2H Sterling Privado",
            "aap": 10000155
        }
    ],
    "H3": [
        {
            "channel": "H3",
            "name": "API Channel Global Pivot Connect Público",
            "aap": 20000055
        },
        {
            "channel": "H3",
            "name": "ASOGW IB\nTransformación Producto Pagos - Integración Producto Digital local de M",
            "aap": 30000075
        }
    ],
    "IB": [
        {
            "channel": "IB",
            "name": "ServiceNow-Remdy",
            "aap": 10000197
        }
    ],
    "IG": [
        {
            "channel": "IG",
            "name": "Portal IGBC Privado",
            "aap": 10000170
        },
        {
            "channel": "IG",
            "name": "Discovery Seguros Privado",
            "aap": 10000199
        }
    ],
    "L1": [
        {
            "channel": "L1",
            "name": "Gestion PLD - CAR Privado",
            "aap": 10000226
        }
    ],
    "LB": [
        {
            "channel": "LB",
            "name": "GCC - IVR (Público)",
            "aap": 10000041
        },
        {
            "channel": "LB",
            "name": "GCC - IVR (Privado)",
            "aap": 10000042
        },
        {
            "channel": "LB",
            "name": "IVR Legacy",
            "aap": 10000053
        },
        {
            "channel": "LB",
            "name": "Amelia - Aclaraciones",
            "aap": 10000058
        },
        {
            "channel": "LB",
            "name": "GCC - IVR Preguntas (Privado)",
            "aap": 10000065
        },
        {
            "channel": "LB",
            "name": "USAC - IVR",
            "aap": 10000126
        }
    ],
    "LE": [
        {
            "channel": "LE",
            "name": "GCC - Nuevo SAC",
            "aap": 10000027
        }
    ],
    "LP": [
        {
            "channel": "LP",
            "name": "LíneaBBVA Público",
            "aap": 10000176
        },
        {
            "channel": "LP",
            "name": "Genesys Cloud IVR Privado",
            "aap": 10000183
        },
        {
            "channel": "LP",
            "name": "OBS TDD Chip Privado",
            "aap": 10000184
        },
        {
            "channel": "LP",
            "name": "Chat Asesor Linea BBVA Privado",
            "aap": 10000228
        },
        {
            "channel": "LP",
            "name": "AWS VDC Interbackend",
            "aap": 10000230
        },
        {
            "channel": "LP",
            "name": "IVR Pensionados Caliope IB",
            "aap": 10000251
        }
    ],
    "LR": [
        {
            "channel": "LR",
            "name": "Remote Digital Banker",
            "aap": 10000151
        }
    ],
    "M1": [
        {
            "channel": "M1",
            "name": "​BeneflexMAX",
            "aap": 10000098
        }
    ],
    "MB\nMG": [
        {
            "channel": "MB\nMG",
            "name": "Stand In de Canales (stand-in)",
            "aap": 10000094
        }
    ],
    "MG": [
        {
            "channel": "MG",
            "name": "GloMo",
            "aap": 10000033
        },
        {
            "channel": "MG",
            "name": "Arquitectura Seguridad",
            "aap": 10000045
        },
        {
            "channel": "MG",
            "name": "GloMo (Público)",
            "aap": 10000085
        },
        {
            "channel": "MG",
            "name": "GloMo (Enrolamiento)",
            "aap": 10000088
        },
        {
            "channel": "MG",
            "name": "GloMo Enrolamiento QR",
            "aap": 10000173
        },
        {
            "channel": "MG",
            "name": "Lynx (BackEnd)",
            "aap": 10000180
        },
        {
            "channel": "MG",
            "name": "GloMo lowcost",
            "aap": 10000187
        },
        {
            "channel": "MG",
            "name": "Combo Consumo+TDC Privado",
            "aap": 10000196
        },
        {
            "channel": "MG",
            "name": "RVTA eGlobal",
            "aap": 10000201
        },
        {
            "channel": "MG",
            "name": "Audiocodes Core Interbackend",
            "aap": 10000253
        },
        {
            "channel": "MG",
            "name": "Blue GenAI Agent Privado",
            "aap": 10000261
        },
        {
            "channel": "MG",
            "name": "Open Banking B2B2C Consumo",
            "aap": 30000043
        },
        {
            "channel": "MG",
            "name": "Open Banking B2B2C Connect Retail",
            "aap": 30000073
        },
        {
            "channel": "MG",
            "name": "Conversational HUB\nAI Assistant Blue MX",
            "aap": 30000105
        }
    ],
    "MJ": [
        {
            "channel": "MJ",
            "name": "Soluciones WOW Zappar Privado",
            "aap": 10000171
        }
    ],
    "MZ": [
        {
            "channel": "MZ",
            "name": "API Market Test (pruebas)",
            "aap": 10000117
        },
        {
            "channel": "MZ",
            "name": "API Market Banxico",
            "aap": 10000154
        },
        {
            "channel": "MZ",
            "name": "Tracking Hipotecario - noClientes\nTracking Hipotecario - Privado",
            "aap": 10000216
        },
        {
            "channel": "MZ",
            "name": "GloMo enrolment no clientes",
            "aap": 10000243
        }
    ],
    "R3": [
        {
            "channel": "R3",
            "name": "CCZ",
            "aap": 10000036
        }
    ],
    "RK": [
        {
            "channel": "RK",
            "name": "Record Keeping Management Privado",
            "aap": 10000257
        }
    ],
    "S1": [
        {
            "channel": "S1",
            "name": "Seguros WEB Público",
            "aap": 10000120
        },
        {
            "channel": "S1",
            "name": "Seguros dinámico Público",
            "aap": 10000147
        },
        {
            "channel": "S1",
            "name": "ASD web cells Público",
            "aap": 10000210
        },
        {
            "channel": "S1",
            "name": "IVR Seguros Autoservicio Privado",
            "aap": 10000222
        }
    ],
    "S2": [
        {
            "channel": "S2",
            "name": "Seguros WEB Privado",
            "aap": 10000119
        },
        {
            "channel": "S2",
            "name": "Wibe WEB Privado\nOpenMarket WEB Privado",
            "aap": 10000121
        },
        {
            "channel": "S2",
            "name": "Seguros dinámico Privado",
            "aap": 10000146
        }
    ],
    "SA": [
        {
            "channel": "SA",
            "name": "Max Mistral (Sales Force)",
            "aap": 10000059
        },
        {
            "channel": "SA",
            "name": "BPyP Privado IB",
            "aap": 10000169
        },
        {
            "channel": "SA",
            "name": "Hipotecario Individual RI Privado",
            "aap": 10000172
        },
        {
            "channel": "SA",
            "name": "Tableros Cash Management IB",
            "aap": 10000209
        },
        {
            "channel": "SA",
            "name": "Whatsapp & SA Cliente Alto Valor IB",
            "aap": 10000259
        },
        {
            "channel": "SA",
            "name": "DWP ORGs Globales Privado",
            "aap": 30000026
        }
    ],
    "SC": [
        {
            "channel": "SC",
            "name": "Seguros - CCM Multiasistencia Full Cells",
            "aap": 10000240
        },
        {
            "channel": "SC",
            "name": "Seguros - Landing Multiasistencia Público",
            "aap": 10000241
        }
    ],
    "SN": [
        {
            "channel": "SN",
            "name": "Senda Pymes Privada",
            "aap": 10000186
        },
        {
            "channel": "SN",
            "name": "Stand In SENDA Pymes Privada",
            "aap": 10000223
        },
        {
            "channel": "SN",
            "name": "Stand In SENDA BNC Privada",
            "aap": 10000224
        }
    ],
    "SP": [
        {
            "channel": "SP",
            "name": "Cerberos Connector IB",
            "aap": 10000200
        }
    ],
    "TF": [
        {
            "channel": "TF",
            "name": "Terminal Financiero (Máquina)",
            "aap": 10000044
        }
    ],
    "TH": [
        {
            "channel": "TH",
            "name": "Notificaciones ToHu-Visa IB",
            "aap": 30000051
        }
    ],
    "TM": [
        {
            "channel": "TM",
            "name": "Contratación Paperless Privado",
            "aap": 10000233
        }
    ],
    "VB": [
        {
            "channel": "VB",
            "name": "Gestor de Transmisiones",
            "aap": 10000050
        }
    ],
    "W1": [
        {
            "channel": "W1",
            "name": "Seguros Movil Privado",
            "aap": 10000143
        },
        {
            "channel": "W1",
            "name": "Seguros Movil Público",
            "aap": 10000144
        },
        {
            "channel": "W1",
            "name": "Seguros Wibe Privado",
            "aap": 10000158
        },
        {
            "channel": "W1",
            "name": "Seguros Partners Público",
            "aap": 10000166
        },
        {
            "channel": "W1",
            "name": "Seguros Partners Privado",
            "aap": 10000167
        },
        {
            "channel": "W1",
            "name": "Alianzas Partnerships Seguros Privado",
            "aap": 10000190
        },
        {
            "channel": "W1",
            "name": "Alianzas Partnerships Seguros Público",
            "aap": 10000191
        }
    ]
}

export type UtilityType = (typeof UTILITY_TYPES)[number];

export interface MetricRow {
  site: string;
  invokerTx: string;
  invokerLibrary: string;
  utilitytype: string;
  invokedparam: string;
  trace: string;
  utility_count: number;
  min_utility_duration: number;
  mean_utility_duration: number;
  max_utility_duration: number;
  channelCode?: string;
}

export interface KPISummary {
  totalInvokerTx: number;
  totalUtilityTypes: number;
  totalInvokedParams: number;
  totalExecutions: number;
  totalJumps: number;
  totalDurationMs: number;
  avgDurationMs: number;
  traceApiConnectors: number;
  traceCics: number;
  traceJdbc: number;
  traceMongo: number;
}

export interface ClassifiedTraces {
  InterBackendCics: NormalizedSpan[];
  APIInternalConnectorImpl: NormalizedSpan[];
  Jdbc: NormalizedSpan[];
  DaasMongoConnector: NormalizedSpan[];
  other: NormalizedSpan[];
}

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
  maxRetries: number;
}

export interface MetricsFilters {
  fromDate: Date;
  toDate: Date;
  site?: string;
  invokerTx?: string;
  utilityType?: string;
  invokerLibrary?: string;
  channelCode?: string;
  channelCodes?: string[];
  limit?: number;
  bearerToken?: string;
  searchMode?: SearchMode;
  iterateAllInvokerTx?: boolean;
}

function normalizeChannelCodeKey(channel: string): string[] {
  return String(channel)
    .split(/[/\n]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export const CHANNEL_CODES: ChannelCodeOption[] = Object.entries(
  GROUPED_CHANNEL_CODES
)
  .flatMap(([groupKey, applications]) => {
    const codes = normalizeChannelCodeKey(groupKey);

    return codes.map((code) => {
      const normalizedApplications = applications.map((app) => ({
        ...app,
        channel: code,
      }));

      return {
        channelCode: code,
        name:
          normalizedApplications.length === 1
            ? normalizedApplications[0].name
            : `${normalizedApplications.length} aplicaciones`,
        aap: normalizedApplications[0]?.aap ?? 0,
        applications: normalizedApplications,
      };
    });
  })
  .reduce<ChannelCodeOption[]>((acc, item) => {
    const existing = acc.find((current) => current.channelCode === item.channelCode);

    if (!existing) {
      acc.push(item);
      return acc;
    }

    existing.applications.push(...item.applications);
    existing.name = `${existing.applications.length} aplicaciones`;
    existing.aap = existing.applications[0]?.aap ?? existing.aap;

    return acc;
  }, [])
  .sort((a, b) => a.channelCode.localeCompare(b.channelCode));