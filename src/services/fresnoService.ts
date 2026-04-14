import { apiRequest } from "./httpClient";

export type FresnoPerson = {
  given_name?: string;
  sn?: string;
  sn2?: string;
  email?: string;
};

export interface FresnoRow {
  uuaa: string;
  uuaaId: string;
  countryName: string;
  projectManagerName: string;
  projectManagerEmail: string;
  maintenanceManagerName: string;
  maintenanceManagerEmail: string;
  productionManagerName: string;
  productionManagerEmail: string;
  error: string;
}

type FresnoSearchItem = {
  uuaa_id?: string | number;
  acronym_name?: string;
  deployment_country?: Array<{
    country_name?: string;
  }>;
};

type FresnoDetailResponse = {
  uuaa_id?: string | number;
  acronym_name?: string;
  project_manager?: FresnoPerson | null;
  maintenance_manager?: FresnoPerson | null;
  production_manager?: FresnoPerson | null;
};

const FRESNO_TIMEOUT_MS = 20000;
const FRESNO_MAX_CONCURRENCY = 4;
const FRESNO_MAX_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = FRESNO_MAX_RETRIES,
  baseDelayMs = 600
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        break;
      }

      await sleep(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = FRESNO_MAX_CONCURRENCY
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;

      if (current >= items.length) {
        break;
      }

      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => runner()
  );

  await Promise.all(runners);
  return results;
}

function buildPersonName(person?: FresnoPerson | null): string {
  if (!person) return "-";

  const fullName = [
    String(person.given_name ?? "").trim(),
    String(person.sn ?? "").trim(),
    String(person.sn2 ?? "").trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || "-";
}

function buildPersonEmail(person?: FresnoPerson | null): string {
  return String(person?.email ?? "").trim() || "-";
}

function normalizeUuaaList(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\n,;\t ]+/g)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function findMexicoUuaaCode(items: FresnoSearchItem[]): FresnoSearchItem | null {
  for (const item of items) {
    const countries = Array.isArray(item.deployment_country)
      ? item.deployment_country
      : [];

    const foundMexico = countries.some((country) => {
      const countryName = String(country.country_name ?? "").trim().toLowerCase();
      return countryName === "méxico" || countryName === "mexico";
    });

    if (foundMexico) {
      return item;
    }
  }

  return items[0] ?? null;
}

function buildSearchUrl(uuaa: string): string {
  const url = new URL("/fresno/api/uas-government/v1/uuaa", window.location.origin);
  url.searchParams.set("acronym_name", uuaa);
  url.searchParams.set("include_virtual_divisions", "true");
  url.searchParams.set("offset", "0");
  url.searchParams.set("rows_per_page", "15");
  return url.toString();
}

function buildDetailUrl(uuaaId: string): string {
  return new URL(
    `/fresno/api/uas-government/v1/uuaa/${uuaaId}`,
    window.location.origin
  ).toString();
}

async function fetchSingleFresnoRow(
  uuaa: string,
  sessionCookie: string
): Promise<FresnoRow> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "x-session-cookie": sessionCookie,
  };

  const searchResponse = await withRetry(() =>
    apiRequest<FresnoSearchItem[]>(buildSearchUrl(uuaa), {
      method: "GET",
      headers,
      timeoutMs: FRESNO_TIMEOUT_MS,
    })
  );

  const mexicoItem = findMexicoUuaaCode(Array.isArray(searchResponse) ? searchResponse : []);

  if (!mexicoItem?.uuaa_id) {
    return {
      uuaa,
      uuaaId: "-",
      countryName: "-",
      projectManagerName: "-",
      projectManagerEmail: "-",
      maintenanceManagerName: "-",
      maintenanceManagerEmail: "-",
      productionManagerName: "-",
      productionManagerEmail: "-",
      error: "No se encontró UUAA en Fresno",
    };
  }

  const uuaaId = String(mexicoItem.uuaa_id).trim();
  const countryName =
    Array.isArray(mexicoItem.deployment_country) &&
    mexicoItem.deployment_country.length > 0
      ? String(mexicoItem.deployment_country[0]?.country_name ?? "").trim() || "-"
      : "-";

  const detailResponse = await withRetry(() =>
    apiRequest<FresnoDetailResponse>(buildDetailUrl(uuaaId), {
      method: "GET",
      headers,
      timeoutMs: FRESNO_TIMEOUT_MS,
    })
  );

  return {
    uuaa,
    uuaaId,
    countryName,
    projectManagerName: buildPersonName(detailResponse.project_manager),
    projectManagerEmail: buildPersonEmail(detailResponse.project_manager),
    maintenanceManagerName: buildPersonName(detailResponse.maintenance_manager),
    maintenanceManagerEmail: buildPersonEmail(detailResponse.maintenance_manager),
    productionManagerName: buildPersonName(detailResponse.production_manager),
    productionManagerEmail: buildPersonEmail(detailResponse.production_manager),
    error: "",
  };
}

export async function fetchFresnoOwners(params: {
  uuaaInput: string;
  sessionCookie: string;
}): Promise<FresnoRow[]> {
  const { uuaaInput, sessionCookie } = params;
  const uuaas = normalizeUuaaList(uuaaInput);

  return runWithConcurrency(
    uuaas,
    async (uuaa) => {
      try {
        return await fetchSingleFresnoRow(uuaa, sessionCookie);
      } catch (error) {
        return {
          uuaa,
          uuaaId: "-",
          countryName: "-",
          projectManagerName: "-",
          projectManagerEmail: "-",
          maintenanceManagerName: "-",
          maintenanceManagerEmail: "-",
          productionManagerName: "-",
          productionManagerEmail: "-",
          error:
            error instanceof Error
              ? error.message
              : "Error desconocido consultando Fresno",
        } satisfies FresnoRow;
      }
    },
    FRESNO_MAX_CONCURRENCY
  );
}

export function getNormalizedUuaaList(input: string): string[] {
  return normalizeUuaaList(input);
}