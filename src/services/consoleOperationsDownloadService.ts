import JSZip, { type JSZipObject } from "jszip";

export type ConsoleEnvironment = "DEV" | "INT" | "OCTA" | "AUS" | "PROD";
export type ComponentType = "TRX" | "JOB" | "ONLINE_LIB" | "BATCH_LIB" | "DTO";
export type AnalysisOption = "pom" | "manifest" | "project" | "methods";

export interface ConsoleComponentInput {
  id: string;
  type: ComponentType;
  jarName: string;
}

export interface AnalysisCheck {
  requested: boolean;
  found: boolean;
  optionalResolution?: boolean | null;
  matchCount: number;
  paths: string[];
  details: string[];
}

export interface DependencyMethodMatch {
  className: string;
  methodName: string;
  descriptor: string;
  target: string;
  usage: string;
  classPath: string;
}

export interface DependencyImportMatch {
  sourcePath: string;
  lineNumber: number;
  statement: string;
  imported: string;
  staticImport: boolean;
}

export interface ConsoleAnalysisResult {
  key: string;
  environment: ConsoleEnvironment;
  componentType: ComponentType;
  jarName: string;
  bucketPath: string;
  downloadUrl: string;
  proxyDownloadUrl: string;
  dependency: string;
  sizeBytes: number;
  durationMs: number;
  checks: {
    pom: AnalysisCheck;
    manifest: AnalysisCheck;
    project: AnalysisCheck;
    methods: AnalysisCheck;
    imports: AnalysisCheck;
  };
  methods: DependencyMethodMatch[];
  methodsTruncated: boolean;
  imports: DependencyImportMatch[];
  importsTruncated: boolean;
  status: "ok" | "warning" | "error";
  error?: string;
}

export interface AnalyzeConsoleComponentsParams {
  environments: ConsoleEnvironment[];
  components: ConsoleComponentInput[];
  dependency: string;
  options: AnalysisOption[];
  sessionCookie: string;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (event: {
    completed: number;
    total: number;
    result: ConsoleAnalysisResult;
  }) => void;
}

type ConstantPoolEntry =
  | { tag: 1; value: string }
  | { tag: 7; nameIndex: number }
  | { tag: 8; stringIndex: number }
  | { tag: 9 | 10 | 11; classIndex: number; nameAndTypeIndex: number }
  | { tag: 12; nameIndex: number; descriptorIndex: number }
  | { tag: number; [key: string]: number };

interface ParsedClassMethod {
  name: string;
  descriptor: string;
  code?: Uint8Array;
}

interface ParsedClass {
  className: string;
  utf8Values: string[];
  cp: Array<ConstantPoolEntry | undefined>;
  methods: ParsedClassMethod[];
}

const DOWNLOAD_TIMEOUT_MS = 180_000;
const DOWNLOAD_MAX_RETRIES = 3;
const DOWNLOAD_RETRY_DELAY_MS = 1_200;
const DEFAULT_CONCURRENCY = 3;
const MAX_RESULT_PATHS = 300;
const MAX_METHOD_RESULTS = 500;
const MAX_IMPORT_RESULTS = 500;
const MAX_DETAIL_LINES = 100;
const TEXT_FILE_LIMIT_BYTES = 2 * 1024 * 1024;

const COMPONENT_DIRECTORIES: Record<ComponentType, string> = {
  TRX: "app/trx",
  JOB: "app/jobs",
  ONLINE_LIB: "app/onlinelibs",
  BATCH_LIB: "app/batchlibs",
  DTO: "app/dtos",
};

const APX_CONSOLE_TARGETS: Record<ConsoleEnvironment, string> = {
  DEV: "https://apxconsole-dev-mx.work-02.nextgen.igrupobbva",
  INT: "https://apxconsole-int-mx.work-02.nextgen.igrupobbva",
  OCTA: "https://apxconsole-oct-mx.work-02.nextgen.igrupobbva",
  AUS: "https://apxconsole-aus-mx.work-02.nextgen.igrupobbva",
  PROD: "https://apxconsole-mx.live-02.nextgen.igrupobbva",
};

type DirectDownloadState = "unknown" | "available" | "unavailable";

// Evita repetir una llamada CORS que ya sabemos que el navegador no puede usar.
// El estado se mantiene únicamente durante la vida de la página.
const directDownloadState = new Map<ConsoleEnvironment, DirectDownloadState>();

export function normalizeApxSessionCookie(value: string): string {
  return value
    .replace(/\r?\n/g, "; ")
    .replace(/^\s*cookie\s*:\s*/i, "")
    .replace(/;\s*cookie\s*:\s*/gi, "; ")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("; ");
}

function emptyCheck(requested = false): AnalysisCheck {
  return {
    requested,
    found: false,
    optionalResolution: null,
    matchCount: 0,
    paths: [],
    details: [],
  };
}

function normalizeJarName(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "");
  return trimmed.toLowerCase().endsWith(".jar") ? trimmed : `${trimmed}.jar`;
}

function isLibraryType(type: ComponentType): type is "ONLINE_LIB" | "BATCH_LIB" {
  return type === "ONLINE_LIB" || type === "BATCH_LIB";
}

/**
 * Las librerías de Consola no tienen un convenio único: algunas están publicadas
 * como XXX.jar y otras como XXXIMPL.jar. ONLINE_LIB prioriza la convención
 * XXXIMPL.jar usada por Árbol de Dependencias; BATCH_LIB prioriza XXX.jar. En
 * ambos casos se prueba la variante alternativa. TRX/JOB/DTO son búsquedas exactas.
 */
export function buildComponentJarCandidates(type: ComponentType, jarName: string): string[] {
  const exact = normalizeJarName(jarName);
  if (!isLibraryType(type)) return [exact];

  const base = exact.slice(0, -4);
  const alreadyImpl = /IMPL$/i.test(base);
  const withoutImpl = alreadyImpl ? base.slice(0, -4) : base;
  const plainJar = `${withoutImpl}.jar`;
  const implJar = `${withoutImpl}IMPL.jar`;

  // Árbol de Dependencias usa implementationName y, si falta, libraryName + IMPL
  // para las librerías online. Las batch normalmente se publican con el nombre
  // lógico sin IMPL. Si el usuario escribió explícitamente IMPL lo respetamos.
  const ordered = alreadyImpl
    ? [exact, plainJar]
    : type === "ONLINE_LIB"
      ? [implJar, exact]
      : [exact, implJar];

  return [...new Set(ordered.filter(Boolean))];
}

export function buildComponentBucketPath(type: ComponentType, jarName: string): string {
  return `${COMPONENT_DIRECTORIES[type]}/${normalizeJarName(jarName)}`;
}

export function buildComponentBucketPathCandidates(type: ComponentType, jarName: string): string[] {
  return buildComponentJarCandidates(type, jarName).map(
    (candidate) => `${COMPONENT_DIRECTORIES[type]}/${candidate}`
  );
}

export function buildConsoleProxyDownloadUrl(
  environment: ConsoleEnvironment,
  type: ComponentType,
  jarName: string
): string {
  const path = buildComponentBucketPath(type, jarName);
  return `/apx-console/${environment}/bucketcomponents/download?name=${encodeURIComponent(path)}`;
}

export function buildConsoleDownloadUrl(
  environment: ConsoleEnvironment,
  type: ComponentType,
  jarName: string
): string {
  const path = buildComponentBucketPath(type, jarName);
  const url = new URL("/APX_Operation/bucketcomponents/download", APX_CONSOLE_TARGETS[environment]);
  url.searchParams.set("name", path);
  return url.toString();
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function readJarResponse(response: Response): Promise<ArrayBuffer> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const error = new Error(
      `HTTP ${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 400)}` : ""}`
    );
    throw Object.assign(error, { httpStatus: response.status });
  }

  const bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  const isZip = signature.length >= 2 && signature[0] === 0x50 && signature[1] === 0x4b;

  if (!isZip) {
    const preview = new TextDecoder().decode(
      new Uint8Array(bytes, 0, Math.min(500, bytes.byteLength))
    );
    throw new Error(`La respuesta no parece un JAR/ZIP válido. ${preview}`.trim());
  }

  return bytes;
}

async function tryDirectDownload(params: {
  environment: ConsoleEnvironment;
  url: string;
  signal?: AbortSignal;
}): Promise<ArrayBuffer | null> {
  if (directDownloadState.get(params.environment) === "unavailable") {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const abortParent = () => controller.abort();
  params.signal?.addEventListener("abort", abortParent, { once: true });

  try {
    // Primero se intenta el host APX real. No se puede establecer manualmente el
    // header Cookie desde JavaScript, por eso se usa la sesión que ya tenga el
    // navegador para ese dominio.
    const response = await fetch(params.url, {
      method: "GET",
      credentials: "include",
      mode: "cors",
      cache: "no-store",
      signal: controller.signal,
    });

    const bytes = await readJarResponse(response);
    directDownloadState.set(params.environment, "available");
    return bytes;
  } catch (error) {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // 401/403, CORS, redirección a login o ausencia de sesión del navegador:
    // a partir de aquí el lote usa el proxy con la cookie proporcionada.
    const status = error && typeof error === "object" && "httpStatus" in error
      ? Number((error as { httpStatus?: unknown }).httpStatus)
      : null;

    if (status === 401 || status === 403 || error instanceof TypeError) {
      directDownloadState.set(params.environment, "unavailable");
    }

    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
    params.signal?.removeEventListener("abort", abortParent);
  }
}

interface DownloadedJar {
  bytes: ArrayBuffer;
  url: string;
  proxyUrl: string;
  bucketPath: string;
  jarName: string;
  attemptedBucketPaths: string[];
}

async function downloadSingleJar(params: {
  environment: ConsoleEnvironment;
  type: ComponentType;
  jarName: string;
  sessionCookie: string;
  signal?: AbortSignal;
}): Promise<Omit<DownloadedJar, "jarName" | "attemptedBucketPaths">> {
  const proxyUrl = buildConsoleProxyDownloadUrl(params.environment, params.type, params.jarName);
  const url = buildConsoleDownloadUrl(params.environment, params.type, params.jarName);
  const bucketPath = buildComponentBucketPath(params.type, params.jarName);
  const normalizedCookie = normalizeApxSessionCookie(params.sessionCookie);
  let lastError: unknown = null;

  const directBytes = await tryDirectDownload({
    environment: params.environment,
    url,
    signal: params.signal,
  });

  if (directBytes) {
    return { bytes: directBytes, url, proxyUrl, bucketPath };
  }

  if (!normalizedCookie) {
    throw new Error(
      `No se pudo usar la sesión directa del navegador para ${bucketPath} y no hay una cookie APX válida para el fallback.`
    );
  }

  for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt += 1) {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const abortParent = () => controller.abort();
    params.signal?.addEventListener("abort", abortParent, { once: true });

    try {
      const response = await fetch(proxyUrl, {
        method: "GET",
        headers: {
          "x-session-cookie": normalizedCookie,
          Accept: "application/java-archive, application/zip, application/octet-stream, */*",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const bytes = await readJarResponse(response);
      return { bytes, url, proxyUrl, bucketPath };
    } catch (error) {
      lastError = error;

      if (params.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const status = error && typeof error === "object" && "httpStatus" in error
        ? Number((error as { httpStatus?: unknown }).httpStatus)
        : null;

      // 400/404 suelen indicar nombre inexistente. 401/403 no mejoran
      // repitiendo la misma combinación nombre + cookie. En librerías el
      // wrapper probará inmediatamente la variante con/sin IMPL.
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        break;
      }

      if (attempt < DOWNLOAD_MAX_RETRIES) {
        await wait(DOWNLOAD_RETRY_DELAY_MS * attempt, params.signal);
      }
    } finally {
      globalThis.clearTimeout(timeoutId);
      params.signal?.removeEventListener("abort", abortParent);
    }
  }

  const lastMessage = isAbortError(lastError)
    ? `Timeout descargando JAR de Consola APX (${DOWNLOAD_TIMEOUT_MS} ms)`
    : lastError instanceof Error
      ? lastError.message
      : "Error desconocido descargando JAR";

  throw new Error(lastMessage);
}

async function downloadJar(params: {
  environment: ConsoleEnvironment;
  type: ComponentType;
  jarName: string;
  sessionCookie: string;
  signal?: AbortSignal;
}): Promise<DownloadedJar> {
  const candidates = buildComponentJarCandidates(params.type, params.jarName);
  const attemptedBucketPaths: string[] = [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    if (params.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const bucketPath = buildComponentBucketPath(params.type, candidate);
    attemptedBucketPaths.push(bucketPath);

    try {
      const downloaded = await downloadSingleJar({
        environment: params.environment,
        type: params.type,
        jarName: candidate,
        sessionCookie: params.sessionCookie,
        signal: params.signal,
      });

      return {
        ...downloaded,
        jarName: candidate,
        attemptedBucketPaths,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      errors.push(`${bucketPath}: ${error instanceof Error ? error.message : "error desconocido"}`);
    }
  }

  const firstUrl = buildConsoleDownloadUrl(params.environment, params.type, candidates[0]);
  const attempted = attemptedBucketPaths.join(", ");
  const authHint = errors.some((message) => /HTTP (401|403)/.test(message))
    ? " APX devolvió 401/403 para las variantes probadas. Si TRX/JOB funcionan con la misma sesión, revisa que el componente sea realmente una librería del bucket seleccionado; el analizador ya probó automáticamente con y sin sufijo IMPL."
    : "";

  throw new Error(
    `No se pudo descargar la librería/componente. Se probaron: ${attempted}. Endpoint APX base: ${firstUrl}. ${errors.join(" | ")}.${authHint}`
  );
}

function addUnique(target: string[], value: string, limit: number) {
  if (!value || target.includes(value) || target.length >= limit) return;
  target.push(value);
}

function normalizeDependency(value: string): { raw: string; dot: string; slash: string } {
  const raw = value.trim();
  const dot = raw.replace(/\//g, ".").replace(/^\.+|\.+$/g, "");
  return { raw, dot, slash: dot.replace(/\./g, "/") };
}

function containsDependency(text: string, dep: ReturnType<typeof normalizeDependency>): boolean {
  if (!dep.raw) return false;
  const normalized = text.toLowerCase();
  return (
    normalized.includes(dep.raw.toLowerCase()) ||
    normalized.includes(dep.dot.toLowerCase()) ||
    normalized.includes(dep.slash.toLowerCase())
  );
}

function splitManifestClauses(value: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "," && !quoted) {
      if (current.trim()) clauses.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) clauses.push(current.trim());
  return clauses;
}

function parseManifest(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  let currentKey = "";

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.startsWith(" ") && currentKey) {
      headers.set(currentKey, `${headers.get(currentKey) ?? ""}${rawLine.slice(1)}`);
      continue;
    }

    const separator = rawLine.indexOf(":");
    if (separator <= 0) {
      currentKey = "";
      continue;
    }

    currentKey = rawLine.slice(0, separator).trim();
    headers.set(currentKey, rawLine.slice(separator + 1).trim());
  }

  return headers;
}

function inspectManifest(
  text: string,
  path: string,
  dep: ReturnType<typeof normalizeDependency>
): AnalysisCheck {
  const result = emptyCheck(true);
  const headers = parseManifest(text);
  const importPackage = headers.get("Import-Package") ?? "";
  const clauses = splitManifestClauses(importPackage);
  const matches = clauses.filter((clause) => containsDependency(clause.split(";")[0] ?? clause, dep));

  result.found = matches.length > 0 || containsDependency(text, dep);
  result.matchCount = matches.length || (result.found ? 1 : 0);
  if (result.found) addUnique(result.paths, path, MAX_RESULT_PATHS);

  if (matches.length) {
    result.optionalResolution = matches.every((clause) =>
      /resolution\s*:=\s*["']?optional["']?/i.test(clause)
    );
    for (const clause of matches) addUnique(result.details, clause, MAX_DETAIL_LINES);
  } else if (result.found) {
    result.optionalResolution = /resolution\s*:=\s*["']?optional["']?/i.test(text);
    addUnique(result.details, "La dependencia aparece en MANIFEST.MF, pero no se aisló una cláusula Import-Package exacta.", MAX_DETAIL_LINES);
  }

  return result;
}

function inspectPom(
  text: string,
  path: string,
  dep: ReturnType<typeof normalizeDependency>
): AnalysisCheck {
  const result = emptyCheck(true);
  result.found = containsDependency(text, dep);
  result.matchCount = result.found ? 1 : 0;

  if (!result.found) return result;

  addUnique(result.paths, path, MAX_RESULT_PATHS);

  const compact = text.replace(/\s+/g, " ");
  const dot = dep.dot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const slash = dep.slash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPackagePattern = new RegExp(
    `(?:Import-Package|_importpackage)[\\s\\S]{0,2500}(?:${dot}|${slash})[\\s\\S]{0,500}?resolution\\s*:=\\s*(?:&quot;|["'])?optional`,
    "i"
  );
  const mavenOptionalPattern = new RegExp(
    `<dependency>[\\s\\S]{0,1500}(?:${dot}|${slash})[\\s\\S]{0,1500}<optional>\\s*true\\s*</optional>[\\s\\S]{0,300}</dependency>`,
    "i"
  );

  const importOptional = importPackagePattern.test(compact);
  const dependencyOptional = mavenOptionalPattern.test(text);
  result.optionalResolution = importOptional || dependencyOptional;

  if (importOptional) {
    addUnique(result.details, "Import-Package configura la dependencia con resolution:=optional.", MAX_DETAIL_LINES);
  }
  if (dependencyOptional) {
    addUnique(result.details, "La dependencia Maven contiene <optional>true</optional>.", MAX_DETAIL_LINES);
  }
  if (!importOptional && !dependencyOptional) {
    addUnique(result.details, "La dependencia aparece en el POM, sin optional detectado alrededor de su configuración.", MAX_DETAIL_LINES);
  }

  return result;
}


function findDependencyImports(
  text: string,
  path: string,
  dep: ReturnType<typeof normalizeDependency>,
  limit: number
): DependencyImportMatch[] {
  const matches: DependencyImportMatch[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const importPattern = /^\s*import\s+(static\s+)?([^;]+?)\s*;\s*(?:\/\/.*)?$/;

  for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
    const statement = lines[index].trim();
    const match = statement.match(importPattern);
    if (!match) continue;

    const imported = match[2].trim();
    if (!containsDependency(imported, dep)) continue;

    matches.push({
      sourcePath: path,
      lineNumber: index + 1,
      statement,
      imported,
      staticImport: Boolean(match[1]),
    });
  }

  return matches;
}

class ClassReader {
  private offset = 0;

  constructor(private readonly view: DataView) {}

  u1() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u2() {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  u4() {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  bytes(length: number) {
    const start = this.offset;
    this.offset += length;
    return new Uint8Array(this.view.buffer, this.view.byteOffset + start, length);
  }

  skip(length: number) {
    this.offset += length;
  }
}

function cpUtf8(cp: Array<ConstantPoolEntry | undefined>, index: number): string {
  const entry = cp[index];
  return entry?.tag === 1 && typeof entry.value === "string" ? entry.value : "";
}

function cpClassName(cp: Array<ConstantPoolEntry | undefined>, index: number): string {
  const entry = cp[index];
  return entry?.tag === 7 ? cpUtf8(cp, entry.nameIndex) : "";
}

function skipAttributes(reader: ClassReader, count: number) {
  for (let i = 0; i < count; i += 1) {
    reader.u2();
    reader.skip(reader.u4());
  }
}

function parseClassFile(bytes: Uint8Array): ParsedClass | null {
  try {
    const reader = new ClassReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (reader.u4() !== 0xcafebabe) return null;
    reader.u2();
    reader.u2();

    const cpCount = reader.u2();
    const cp: Array<ConstantPoolEntry | undefined> = new Array(cpCount);
    const utf8Values: string[] = [];

    for (let i = 1; i < cpCount; i += 1) {
      const tag = reader.u1();
      switch (tag) {
        case 1: {
          const length = reader.u2();
          const value = new TextDecoder("utf-8").decode(reader.bytes(length));
          cp[i] = { tag: 1, value };
          utf8Values.push(value);
          break;
        }
        case 3:
        case 4:
          reader.skip(4);
          cp[i] = { tag };
          break;
        case 5:
        case 6:
          reader.skip(8);
          cp[i] = { tag };
          i += 1;
          break;
        case 7:
          cp[i] = { tag: 7, nameIndex: reader.u2() };
          break;
        case 8:
          cp[i] = { tag: 8, stringIndex: reader.u2() };
          break;
        case 9:
        case 10:
        case 11:
          cp[i] = {
            tag,
            classIndex: reader.u2(),
            nameAndTypeIndex: reader.u2(),
          } as ConstantPoolEntry;
          break;
        case 12:
          cp[i] = { tag: 12, nameIndex: reader.u2(), descriptorIndex: reader.u2() };
          break;
        case 15:
          cp[i] = { tag, referenceKind: reader.u1(), referenceIndex: reader.u2() };
          break;
        case 16:
        case 19:
        case 20:
          cp[i] = { tag, index: reader.u2() };
          break;
        case 17:
        case 18:
          cp[i] = { tag, bootstrapIndex: reader.u2(), nameAndTypeIndex: reader.u2() };
          break;
        default:
          return null;
      }
    }

    reader.u2();
    const thisClassIndex = reader.u2();
    reader.u2();
    const className = cpClassName(cp, thisClassIndex).replace(/\//g, ".");

    const interfaceCount = reader.u2();
    reader.skip(interfaceCount * 2);

    const fieldCount = reader.u2();
    for (let i = 0; i < fieldCount; i += 1) {
      reader.u2();
      reader.u2();
      reader.u2();
      skipAttributes(reader, reader.u2());
    }

    const methodCount = reader.u2();
    const methods: ParsedClassMethod[] = [];
    for (let i = 0; i < methodCount; i += 1) {
      reader.u2();
      const nameIndex = reader.u2();
      const descriptorIndex = reader.u2();
      const attributeCount = reader.u2();
      const method: ParsedClassMethod = {
        name: cpUtf8(cp, nameIndex),
        descriptor: cpUtf8(cp, descriptorIndex),
      };

      for (let j = 0; j < attributeCount; j += 1) {
        const attributeName = cpUtf8(cp, reader.u2());
        const attributeLength = reader.u4();
        if (attributeName !== "Code") {
          reader.skip(attributeLength);
          continue;
        }

        const attributeStartRemaining = attributeLength;
        reader.u2();
        reader.u2();
        const codeLength = reader.u4();
        method.code = reader.bytes(codeLength);
        const exceptionCount = reader.u2();
        reader.skip(exceptionCount * 8);
        skipAttributes(reader, reader.u2());
        void attributeStartRemaining;
      }
      methods.push(method);
    }

    return { className, utf8Values, cp, methods };
  } catch {
    return null;
  }
}

function resolveMemberRef(
  cp: Array<ConstantPoolEntry | undefined>,
  index: number
): { owner: string; name: string; descriptor: string; kind: string } | null {
  const entry = cp[index];
  if (!entry || ![9, 10, 11].includes(entry.tag)) return null;
  const member = entry as Extract<ConstantPoolEntry, { tag: 9 | 10 | 11 }>;
  const nameType = cp[member.nameAndTypeIndex];
  if (!nameType || nameType.tag !== 12) return null;

  return {
    owner: cpClassName(cp, member.classIndex),
    name: cpUtf8(cp, nameType.nameIndex),
    descriptor: cpUtf8(cp, nameType.descriptorIndex),
    kind: entry.tag === 9 ? "field" : entry.tag === 11 ? "interface" : "method",
  };
}

function operandLength(opcode: number, code: Uint8Array, offset: number): number {
  if (opcode === 0xaa) {
    const padding = (4 - ((offset + 1) % 4)) % 4;
    const base = offset + 1 + padding;
    if (base + 12 > code.length) return Math.max(0, code.length - offset - 1);
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    const low = view.getInt32(base + 4, false);
    const high = view.getInt32(base + 8, false);
    return padding + 12 + Math.max(0, high - low + 1) * 4;
  }
  if (opcode === 0xab) {
    const padding = (4 - ((offset + 1) % 4)) % 4;
    const base = offset + 1 + padding;
    if (base + 8 > code.length) return Math.max(0, code.length - offset - 1);
    const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
    const pairs = Math.max(0, view.getInt32(base + 4, false));
    return padding + 8 + pairs * 8;
  }
  if (opcode === 0xc4) {
    const next = code[offset + 1];
    return next === 0x84 ? 5 : 3;
  }

  if ([0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0xbc].includes(opcode)) return 1;
  if ([0x11, 0x13, 0x14, 0x84].includes(opcode)) return 2;
  if (opcode >= 0x99 && opcode <= 0xa8) return 2;
  if ([0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7].includes(opcode)) return 2;
  if ([0xb9, 0xba, 0xc8, 0xc9].includes(opcode)) return 4;
  if (opcode === 0xc5) return 3;
  return 0;
}

function u2FromCode(code: Uint8Array, offset: number): number {
  return ((code[offset] ?? 0) << 8) | (code[offset + 1] ?? 0);
}

function dependencyMatchesInternal(value: string, dep: ReturnType<typeof normalizeDependency>): boolean {
  const normalized = value.replace(/^L|;$/g, "").toLowerCase();
  return normalized.includes(dep.slash.toLowerCase()) || normalized.includes(dep.dot.toLowerCase());
}

function findMethodDependencyUsages(
  parsed: ParsedClass,
  classPath: string,
  dep: ReturnType<typeof normalizeDependency>,
  remaining: number
): DependencyMethodMatch[] {
  const matches: DependencyMethodMatch[] = [];

  for (const method of parsed.methods) {
    if (matches.length >= remaining) break;
    const emitted = new Set<string>();

    if (dependencyMatchesInternal(method.descriptor, dep)) {
      const target = `descriptor ${method.descriptor}`;
      emitted.add(target);
      matches.push({
        className: parsed.className,
        methodName: method.name,
        descriptor: method.descriptor,
        target,
        usage: "firma",
        classPath,
      });
    }

    const code = method.code;
    if (!code) continue;

    for (let offset = 0; offset < code.length && matches.length < remaining; ) {
      const opcode = code[offset];
      if (opcode == null) break;

      if ([0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9].includes(opcode)) {
        const cpIndex = u2FromCode(code, offset + 1);
        const ref = resolveMemberRef(parsed.cp, cpIndex);
        if (ref && dependencyMatchesInternal(`${ref.owner}${ref.descriptor}`, dep)) {
          const target = `${ref.owner.replace(/\//g, ".")}.${ref.name}${ref.descriptor}`;
          if (!emitted.has(target)) {
            emitted.add(target);
            matches.push({
              className: parsed.className,
              methodName: method.name,
              descriptor: method.descriptor,
              target,
              usage: opcode >= 0xb6 ? "invocación" : "campo",
              classPath,
            });
          }
        }
      } else if ([0xbb, 0xbd, 0xc0, 0xc1, 0xc5].includes(opcode)) {
        const cpIndex = u2FromCode(code, offset + 1);
        const owner = cpClassName(parsed.cp, cpIndex);
        if (owner && dependencyMatchesInternal(owner, dep)) {
          const target = owner.replace(/\//g, ".");
          if (!emitted.has(target)) {
            emitted.add(target);
            matches.push({
              className: parsed.className,
              methodName: method.name,
              descriptor: method.descriptor,
              target,
              usage: opcode === 0xbb ? "instanciación" : "tipo",
              classPath,
            });
          }
        }
      }

      offset += 1 + operandLength(opcode, code, offset);
    }
  }

  return matches;
}

async function readText(entry: JSZipObject): Promise<string> {
  return entry.async("string");
}

function isProbablyTextFile(path: string): boolean {
  return /\.(?:xml|mf|properties|yml|yaml|json|txt|cfg|conf|ini|java|kt|groovy|jsp|js|ts|html|xhtml|sql)$/i.test(path);
}

async function inspectJar(params: {
  zip: JSZip;
  dependency: string;
  options: AnalysisOption[];
}): Promise<{
  checks: ConsoleAnalysisResult["checks"];
  methods: DependencyMethodMatch[];
  methodsTruncated: boolean;
  imports: DependencyImportMatch[];
  importsTruncated: boolean;
}> {
  const dep = normalizeDependency(params.dependency);
  const requested = new Set(params.options);
  const checks: ConsoleAnalysisResult["checks"] = {
    pom: emptyCheck(requested.has("pom")),
    manifest: emptyCheck(requested.has("manifest")),
    project: emptyCheck(requested.has("project")),
    methods: emptyCheck(requested.has("methods")),
    // La detección de imports es automática y barata: solo abre fuentes .java si existen.
    imports: emptyCheck(true),
  };

  const entries = Object.values(params.zip.files).filter((entry) => !entry.dir);
  const pomEntries = entries.filter((entry) => /(^|\/)pom\.xml$/i.test(entry.name));
  const manifestEntries = entries.filter((entry) => /(^|\/)META-INF\/MANIFEST\.MF$/i.test(entry.name));
  const javaEntries = entries.filter((entry) => /\.java$/i.test(entry.name));

  if (requested.has("pom")) {
    for (const entry of pomEntries) {
      const inspected = inspectPom(await readText(entry), entry.name, dep);
      checks.pom.found ||= inspected.found;
      checks.pom.matchCount += inspected.matchCount;
      if (inspected.optionalResolution === true) checks.pom.optionalResolution = true;
      else if (checks.pom.optionalResolution !== true && inspected.optionalResolution === false) checks.pom.optionalResolution = false;
      inspected.paths.forEach((p) => addUnique(checks.pom.paths, p, MAX_RESULT_PATHS));
      inspected.details.forEach((d) => addUnique(checks.pom.details, d, MAX_DETAIL_LINES));
    }
  }

  if (requested.has("manifest")) {
    for (const entry of manifestEntries) {
      const inspected = inspectManifest(await readText(entry), entry.name, dep);
      checks.manifest.found ||= inspected.found;
      checks.manifest.matchCount += inspected.matchCount;
      if (inspected.optionalResolution === true) checks.manifest.optionalResolution = true;
      else if (checks.manifest.optionalResolution !== true && inspected.optionalResolution === false) checks.manifest.optionalResolution = false;
      inspected.paths.forEach((p) => addUnique(checks.manifest.paths, p, MAX_RESULT_PATHS));
      inspected.details.forEach((d) => addUnique(checks.manifest.details, d, MAX_DETAIL_LINES));
    }
  }

  const imports: DependencyImportMatch[] = [];
  let importsTruncated = false;

  for (const entry of javaEntries) {
    const remaining = MAX_IMPORT_RESULTS - imports.length;
    if (remaining <= 0) {
      importsTruncated = true;
      break;
    }

    const uncompressedSize = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (uncompressedSize && uncompressedSize > TEXT_FILE_LIMIT_BYTES) continue;

    const source = await readText(entry);
    const sourceMatches = findDependencyImports(source, entry.name, dep, remaining);
    imports.push(...sourceMatches);
    if (imports.length >= MAX_IMPORT_RESULTS) importsTruncated = true;
  }

  checks.imports.found = imports.length > 0;
  checks.imports.matchCount = imports.length;
  for (const item of imports) {
    addUnique(checks.imports.paths, item.sourcePath, MAX_RESULT_PATHS);
  }
  for (const item of imports.slice(0, MAX_DETAIL_LINES)) {
    addUnique(
      checks.imports.details,
      `${item.sourcePath}:${item.lineNumber} -> ${item.statement}`,
      MAX_DETAIL_LINES
    );
  }

  const needsClasses = requested.has("project") || requested.has("methods");
  const methods: DependencyMethodMatch[] = [];
  let methodsTruncated = false;

  if (needsClasses) {
    for (const entry of entries) {
      if (params.options.includes("project") && isProbablyTextFile(entry.name)) {
        // Evita inflar memoria con recursos enormes; los POM/MANIFEST ya se procesaron arriba.
        const uncompressedSize = (entry as JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
        if (!uncompressedSize || uncompressedSize <= TEXT_FILE_LIMIT_BYTES) {
          const text = await readText(entry);
          if (containsDependency(text, dep)) {
            checks.project.found = true;
            checks.project.matchCount += 1;
            addUnique(checks.project.paths, entry.name, MAX_RESULT_PATHS);
          }
        }
      }

      if (!/\.class$/i.test(entry.name)) continue;
      const bytes = await entry.async("uint8array");
      const parsed = parseClassFile(bytes);
      if (!parsed) continue;

      if (requested.has("project") && parsed.utf8Values.some((value) => containsDependency(value, dep))) {
        checks.project.found = true;
        checks.project.matchCount += 1;
        addUnique(checks.project.paths, entry.name, MAX_RESULT_PATHS);
      }

      if (requested.has("methods")) {
        const remaining = MAX_METHOD_RESULTS - methods.length;
        if (remaining <= 0) {
          methodsTruncated = true;
          continue;
        }
        const classMatches = findMethodDependencyUsages(parsed, entry.name, dep, remaining);
        methods.push(...classMatches);
        if (methods.length >= MAX_METHOD_RESULTS) methodsTruncated = true;
      }
    }
  }

  if (requested.has("methods")) {
    checks.methods.found = methods.length > 0;
    checks.methods.matchCount = methods.length;
    for (const method of methods) addUnique(checks.methods.paths, method.classPath, MAX_RESULT_PATHS);
    for (const method of methods.slice(0, MAX_DETAIL_LINES)) {
      addUnique(
        checks.methods.details,
        `${method.className}#${method.methodName}${method.descriptor} -> ${method.target}`,
        MAX_DETAIL_LINES
      );
    }
  }

  return { checks, methods, methodsTruncated, imports, importsTruncated };
}

async function analyzeOne(params: {
  environment: ConsoleEnvironment;
  component: ConsoleComponentInput;
  dependency: string;
  options: AnalysisOption[];
  sessionCookie: string;
  signal?: AbortSignal;
}): Promise<ConsoleAnalysisResult> {
  const started = performance.now();
  const requestedJarName = normalizeJarName(params.component.jarName);
  const bucketPath = buildComponentBucketPath(params.component.type, requestedJarName);
  const downloadUrl = buildConsoleDownloadUrl(params.environment, params.component.type, requestedJarName);
  const proxyDownloadUrl = buildConsoleProxyDownloadUrl(params.environment, params.component.type, requestedJarName);
  const requested = new Set(params.options);

  try {
    const downloaded = await downloadJar({
      environment: params.environment,
      type: params.component.type,
      jarName: requestedJarName,
      sessionCookie: params.sessionCookie,
      signal: params.signal,
    });
    const zip = await JSZip.loadAsync(downloaded.bytes, { createFolders: false });
    const inspected = await inspectJar({ zip, dependency: params.dependency, options: params.options });

    const requestedChecks = Object.values(inspected.checks).filter((check) => check.requested);
    const anyFound = requestedChecks.some((check) => check.found);

    return {
      key: `${params.environment}:${params.component.type}:${downloaded.jarName}`,
      environment: params.environment,
      componentType: params.component.type,
      jarName: downloaded.jarName,
      bucketPath: downloaded.bucketPath,
      downloadUrl: downloaded.url,
      proxyDownloadUrl: downloaded.proxyUrl,
      dependency: params.dependency,
      sizeBytes: downloaded.bytes.byteLength,
      durationMs: Math.round(performance.now() - started),
      checks: inspected.checks,
      methods: inspected.methods,
      methodsTruncated: inspected.methodsTruncated,
      imports: inspected.imports,
      importsTruncated: inspected.importsTruncated,
      status: anyFound ? "ok" : "warning",
    };
  } catch (error) {
    return {
      key: `${params.environment}:${params.component.type}:${requestedJarName}`,
      environment: params.environment,
      componentType: params.component.type,
      jarName: requestedJarName,
      bucketPath,
      downloadUrl,
      proxyDownloadUrl,
      dependency: params.dependency,
      sizeBytes: 0,
      durationMs: Math.round(performance.now() - started),
      checks: {
        pom: emptyCheck(requested.has("pom")),
        manifest: emptyCheck(requested.has("manifest")),
        project: emptyCheck(requested.has("project")),
        methods: emptyCheck(requested.has("methods")),
        imports: emptyCheck(true),
      },
      methods: [],
      methodsTruncated: false,
      imports: [],
      importsTruncated: false,
      status: "error",
      error: error instanceof Error ? error.message : "Error analizando el JAR",
    };
  }
}

export async function analyzeConsoleComponents(
  params: AnalyzeConsoleComponentsParams
): Promise<ConsoleAnalysisResult[]> {
  const jobs = params.environments.flatMap((environment) =>
    params.components.map((component) => ({ environment, component }))
  );
  const results: ConsoleAnalysisResult[] = [];
  let completed = 0;
  let nextIndex = 0;
  const concurrency = Math.max(1, Math.min(6, params.concurrency ?? DEFAULT_CONCURRENCY));

  async function worker() {
    while (true) {
      if (params.signal?.aborted) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= jobs.length) return;

      const job = jobs[index];
      const result = await analyzeOne({
        environment: job.environment,
        component: job.component,
        dependency: params.dependency,
        options: params.options,
        sessionCookie: params.sessionCookie,
        signal: params.signal,
      });
      results.push(result);
      completed += 1;
      params.onProgress?.({ completed, total: jobs.length, result });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results.sort((a, b) => {
    const byEnv = a.environment.localeCompare(b.environment);
    if (byEnv !== 0) return byEnv;
    return a.jarName.localeCompare(b.jarName);
  });
}
