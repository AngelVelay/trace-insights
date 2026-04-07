import { apiRequest } from "./httpClient";

export type ApxConsoleEnvironment = "DEV" | "INT" | "OCTA" | "AUS" | "PROD";

export interface CicsDetailRow {
  uuaa: string;
  key: string;
  value: string;
  incidente: boolean;
  motivos: string[];
}

export interface CicsIncidentGroup {
  uuaa: string;
  hostKey: string;
  hostValue: string;
  portKey: string;
  portValue: string;
  httpKey: string;
  httpValue: string;
  incidente: boolean;
  motivos: string[];
  resumenMotivos: string;
}

export interface ApxCicsConsolaResult {
  environment: ApxConsoleEnvironment;
  totalRows: number;
  detailRows: CicsDetailRow[];
  incidentGroups: CicsIncidentGroup[];
}

type RawApxConsoleRecord = {
  key?: string;
  value?: string;
  uuAaName?: string;
  uuaa?: string;
  name?: string;
};

function extractRecords(payload: unknown): RawApxConsoleRecord[] {
  if (Array.isArray(payload)) {
    return payload as RawApxConsoleRecord[];
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;

    if (Array.isArray(obj.records)) {
      return obj.records as RawApxConsoleRecord[];
    }

    if (Array.isArray(obj.data)) {
      return obj.data as RawApxConsoleRecord[];
    }
  }

  return [];
}

function normalizeKey(record: RawApxConsoleRecord): string {
  return String(record.key ?? record.name ?? "").trim();
}

function normalizeValue(record: RawApxConsoleRecord): string {
  return String(record.value ?? "").trim();
}

function deriveUuaaFromKey(key: string): string {
  const match = key.match(/^cics\.([^.]+)\./i);
  return match?.[1]?.trim() || "SIN_UUAA";
}

function looksLikeHost(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes(".") ||
    normalized.includes("igrupobbva") ||
    normalized.includes("ccr") ||
    /^[a-z0-9-]+$/i.test(normalized)
  );
}

function looksLikePort(value: string): boolean {
  return /^\d{1,6}$/.test(value.trim());
}

function buildMotivosSummary(uuaa: string, motivos: string[]): string {
  if (!motivos.length) {
    return `UUAA ${uuaa}: sin inconsistencias.`;
  }

  return `UUAA ${uuaa}: ${motivos.join(" | ")}`;
}

function hasIncident(hostValue: string, portValue: string, httpValue: string) {
  const motivos: string[] = [];

  const host = hostValue.trim();
  const port = portValue.trim();
  const http = httpValue.trim();

  if (host.startsWith("150")) {
    motivos.push("host inicia con 150");
  }

  if (!/^\d{5}$/.test(port)) {
    motivos.push("port no tiene 5 digitos");
  }

  if (!http.toLowerCase().includes("active")) {
    motivos.push("http no contiene active");
  }

  if (/:\d{2,6}$/.test(host)) {
    motivos.push("host contiene puerto embebido");
  }

  if (port.toLowerCase().includes("active")) {
    motivos.push("port contiene active");
  }

  if (looksLikeHost(port) && !looksLikePort(port)) {
    motivos.push("port parece host");
  }

  if (looksLikePort(http)) {
    motivos.push("http parece puerto");
  }

  if (looksLikeHost(http) && !http.toLowerCase().includes("active")) {
    motivos.push("http parece host");
  }

  if (looksLikePort(host)) {
    motivos.push("host parece puerto");
  }

  return {
    incidente: motivos.length > 0,
    motivos,
  };
}

export async function fetchApxCicsConsola(params: {
  environment: ApxConsoleEnvironment;
  sessionCookie?: string;
}): Promise<ApxCicsConsolaResult> {
  const { environment, sessionCookie } = params;

  const response = await apiRequest<unknown>(
    `/apx-console/${environment}/cfgapponline/records?dependent=0&uuaaName=ALL`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-session-cookie": sessionCookie?.trim() || "",
      },
      timeoutMs: 30000,
    }
  );

  const records = extractRecords(response);

  const cicsRecords = records
    .map((record) => {
      const key = normalizeKey(record);
      const value = normalizeValue(record);

      return {
        key,
        value,
        uuaa: deriveUuaaFromKey(key),
      };
    })
    .filter((item) => item.key.toLowerCase().includes("cics"));

  const grouped = new Map<
    string,
    {
      hostKey: string;
      hostValue: string;
      portKey: string;
      portValue: string;
      httpKey: string;
      httpValue: string;
    }
  >();

  for (const item of cicsRecords) {
    const current = grouped.get(item.uuaa) ?? {
      hostKey: "",
      hostValue: "",
      portKey: "",
      portValue: "",
      httpKey: "",
      httpValue: "",
    };

    const loweredKey = item.key.toLowerCase();

    if (loweredKey.endsWith(".host")) {
      current.hostKey = item.key;
      current.hostValue = item.value;
    }

    if (loweredKey.endsWith(".port")) {
      current.portKey = item.key;
      current.portValue = item.value;
    }

    if (loweredKey.endsWith(".http")) {
      current.httpKey = item.key;
      current.httpValue = item.value;
    }

    grouped.set(item.uuaa, current);
  }

  const incidentByUuaa = new Map<string, { incidente: boolean; motivos: string[] }>();

  const incidentGroups: CicsIncidentGroup[] = Array.from(grouped.entries())
    .map(([uuaa, group]) => {
      const validation = hasIncident(
        group.hostValue,
        group.portValue,
        group.httpValue
      );

      incidentByUuaa.set(uuaa, validation);

      return {
        uuaa,
        hostKey: group.hostKey || `cics.${uuaa}.host`,
        hostValue: group.hostValue || "-",
        portKey: group.portKey || `cics.${uuaa}.port`,
        portValue: group.portValue || "-",
        httpKey: group.httpKey || `cics.${uuaa}.http`,
        httpValue: group.httpValue || "-",
        incidente: validation.incidente,
        motivos: validation.motivos,
        resumenMotivos: buildMotivosSummary(uuaa, validation.motivos),
      };
    })
    .sort((a, b) => a.uuaa.localeCompare(b.uuaa));

  const detailRows: CicsDetailRow[] = cicsRecords
    .map((item) => ({
      uuaa: item.uuaa,
      key: item.key,
      value: item.value,
      incidente: incidentByUuaa.get(item.uuaa)?.incidente ?? false,
      motivos: incidentByUuaa.get(item.uuaa)?.motivos ?? [],
    }))
    .sort((a, b) => {
      const byUuaa = a.uuaa.localeCompare(b.uuaa);
      if (byUuaa !== 0) return byUuaa;
      return a.key.localeCompare(b.key);
    });

  return {
    environment,
    totalRows: detailRows.length,
    detailRows,
    incidentGroups: incidentGroups.filter((item) => item.incidente),
  };
}