import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FileText,
  FolderOpen,
  FileCode2,
  ListChecks,
  Loader2,
  PackageSearch,
  Play,
  Search,
  Square,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useSessionCookie } from "@/hooks/useSessionCookie";
import {
  analyzeConsoleComponents,
  buildComponentBucketPathCandidates,
  buildConsoleDownloadUrl,
  type AnalysisCheck,
  type AnalysisOption,
  type ComponentType,
  type ConsoleAnalysisResult,
  type ConsoleComponentInput,
  type ConsoleEnvironment,
} from "@/services/consoleOperationsDownloadService";

const ENVIRONMENTS: Array<{ value: ConsoleEnvironment; label: string }> = [
  { value: "DEV", label: "DEV · WORK-02" },
  { value: "INT", label: "INT · WORK-02" },
  { value: "OCTA", label: "OCT · WORK-02" },
  { value: "AUS", label: "AUS · WORK-02" },
  { value: "PROD", label: "PRO · LIVE-02" },
];

const COMPONENT_TYPES: Array<{ value: ComponentType; label: string; path: string }> = [
  { value: "TRX", label: "Transacción", path: "app/trx" },
  { value: "JOB", label: "JOB", path: "app/jobs" },
  { value: "ONLINE_LIB", label: "Librería online", path: "app/onlinelibs" },
  { value: "BATCH_LIB", label: "Librería batch", path: "app/batchlibs" },
  { value: "DTO", label: "DTO", path: "app/dtos" },
];

const ANALYSIS_OPTIONS: Array<{ value: AnalysisOption; label: string; description: string }> = [
  {
    value: "pom",
    label: "pom.xml",
    description: "Busca la dependencia y optional/configuración de Import-Package en los POM incluidos.",
  },
  {
    value: "manifest",
    label: "MANIFEST.MF",
    description: "Valida Import-Package y resolution:=optional respetando continuaciones del manifest.",
  },
  {
    value: "project",
    label: "Todo el JAR",
    description: "Busca referencias en recursos de texto y constant pools de las clases.",
  },
  {
    value: "methods",
    label: "Métodos que usan la dependencia",
    description: "Inspecciona bytecode y lista métodos, invocaciones, campos, tipos y firmas relacionadas.",
  },
];

const TYPE_ALIASES: Record<string, ComponentType> = {
  TRX: "TRX",
  TRANSACCION: "TRX",
  "TRANSACCIÓN": "TRX",
  TRANSACTION: "TRX",
  JOB: "JOB",
  ONLINE_LIB: "ONLINE_LIB",
  ONLINELIB: "ONLINE_LIB",
  "LIBRERIA ONLINE": "ONLINE_LIB",
  "LIBRERÍA ONLINE": "ONLINE_LIB",
  BATCH_LIB: "BATCH_LIB",
  BATCHLIB: "BATCH_LIB",
  "LIBRERIA BATCH": "BATCH_LIB",
  "LIBRERÍA BATCH": "BATCH_LIB",
  DTO: "DTO",
};

function parseComponents(text: string, defaultType: ComponentType): ConsoleComponentInput[] {
  const seen = new Set<string>();
  const rows: ConsoleComponentInput[] = [];

  const directoryTypes: Record<string, ComponentType> = {
    "app/trx": "TRX",
    "app/jobs": "BATCH_LIB",
    "app/onlinelibs": "ONLINE_LIB",
    "app/dtos": "DTO",
  };

  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line, index) => {
      let type = defaultType;
      let jarName = line;

      // Permite pegar directamente un endpoint de Consola de Operaciones.
      if (/^https?:\/\//i.test(line)) {
        try {
          const parsedUrl = new URL(line);
          const bucketName = parsedUrl.searchParams.get("name") ?? "";
          const normalizedPath = bucketName.replace(/^\/+/, "");
          const matchedDirectory = Object.keys(directoryTypes).find((directory) =>
            normalizedPath.toLowerCase().startsWith(`${directory}/`)
          );
          if (matchedDirectory) {
            type = matchedDirectory === "app/batchlibs" && (defaultType === "JOB" || defaultType === "BATCH_LIB")
              ? defaultType
              : directoryTypes[matchedDirectory];
            jarName = normalizedPath.slice(matchedDirectory.length + 1);
          }
        } catch {
          // Si no es una URL válida, continúa con los formatos de texto.
        }
      } else {
        const delimited = line.split(/\s*[|,;\t]\s*/).filter(Boolean);
        if (delimited.length >= 2) {
          const candidate = TYPE_ALIASES[delimited[0].trim().toUpperCase()];
          if (candidate) {
            type = candidate;
            jarName = delimited.slice(1).join("-").trim();
          }
        } else {
          // También acepta: "TRX KARCT001-01-MX.jar" o "TRANSACCION KARCT...".
          const whitespaceMatch = line.match(/^(TRANSACCI[ÓO]N|TRANSACTION|TRX|JOB|ONLINE_LIB|ONLINELIB|LIBRER[IÍ]A\s+ONLINE|BATCH_LIB|BATCHLIB|LIBRER[IÍ]A\s+BATCH|DTO)\s+(.+)$/i);
          if (whitespaceMatch) {
            const candidate = TYPE_ALIASES[whitespaceMatch[1].trim().toUpperCase()];
            if (candidate) {
              type = candidate;
              jarName = whitespaceMatch[2].trim();
            }
          }
        }
      }

      jarName = jarName.trim();
      if (!jarName) return;
      if (!jarName.toLowerCase().endsWith(".jar")) jarName = `${jarName}.jar`;

      const key = `${type}:${jarName.toUpperCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ id: `${index}-${key}`, type, jarName });
    });

  return rows;
}

function formatBytes(bytes: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function analysisLabel(options: AnalysisOption[]) {
  if (!options.length) return "Selecciona análisis";
  if (options.length === ANALYSIS_OPTIONS.length) return "Todos los análisis";
  return `${options.length} análisis seleccionados`;
}

function environmentLabel(environments: ConsoleEnvironment[]) {
  if (!environments.length) return "Selecciona entornos";
  if (environments.length === ENVIRONMENTS.length) return "Todos los entornos";
  return environments.join(", ");
}

function statusCell(check: AnalysisCheck, showOptional = false) {
  if (!check.requested) {
    return <span className="text-xs text-muted-foreground">No solicitado</span>;
  }

  if (!check.found) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <XCircle className="h-4 w-4" />
        No encontrado
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs font-medium text-foreground">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        Encontrado ({check.matchCount})
      </div>
      {showOptional && check.optionalResolution !== null && check.optionalResolution !== undefined ? (
        <div className="pl-6 text-[11px] text-muted-foreground">
          resolution optional: {check.optionalResolution ? "Sí" : "No"}
        </div>
      ) : null}
    </div>
  );
}

type ReportRow = Record<string, string | number>;

type MethodGroup = {
  key: string;
  className: string;
  methodName: string;
  descriptor: string;
  classPath: string;
  references: ConsoleAnalysisResult["methods"];
};

type ImportGroup = {
  sourcePath: string;
  imports: ConsoleAnalysisResult["imports"];
};

const REPORT_COLUMNS = [
  "Entorno",
  "Tipo",
  "Componente",
  "Estado",
  "Dependencia",
  "POM / optional",
  "MANIFEST / optional",
  "Todo JAR",
  "Imports Java",
  "Imports Java (detalle)",
  "Métodos únicos",
  "Referencias bytecode",
  "Métodos (detalle)",
  "Ruta bucket",
  "Rutas con coincidencias",
  "Tamaño",
  "Duración",
  "Error",
] as const;

const JVM_PRIMITIVES: Record<string, string> = {
  B: "byte",
  C: "char",
  D: "double",
  F: "float",
  I: "int",
  J: "long",
  S: "short",
  Z: "boolean",
  V: "void",
};

function parseJvmType(descriptor: string, start: number): { type: string; next: number } {
  let index = start;
  let dimensions = 0;
  while (descriptor[index] === "[") {
    dimensions += 1;
    index += 1;
  }

  const token = descriptor[index];
  if (!token) return { type: descriptor.slice(start), next: descriptor.length };

  let type = JVM_PRIMITIVES[token];
  if (token === "L") {
    const end = descriptor.indexOf(";", index);
    if (end === -1) return { type: descriptor.slice(start), next: descriptor.length };
    type = descriptor.slice(index + 1, end).replace(/\//g, ".").replace(/\$/g, ".");
    index = end + 1;
  } else if (type) {
    index += 1;
  } else {
    return { type: descriptor.slice(start), next: descriptor.length };
  }

  return {
    type: `${type}${"[]".repeat(dimensions)}`,
    next: index,
  };
}

function shortJavaType(type: string) {
  const arraySuffix = type.endsWith("[]") ? type.slice(type.indexOf("[")) : "";
  const base = arraySuffix ? type.slice(0, -arraySuffix.length) : type;
  const parts = base.split(".");
  const firstClassIndex = parts.findIndex((part) => /^[A-Z]/.test(part));
  const className = firstClassIndex >= 0 ? parts.slice(firstClassIndex).join(".") : parts.at(-1) ?? base;
  return `${className}${arraySuffix}`;
}

function parseJvmMethodDescriptor(descriptor: string) {
  if (!descriptor.startsWith("(")) {
    return { parameters: [] as string[], returnType: descriptor, valid: false };
  }

  const parameters: string[] = [];
  let index = 1;
  while (index < descriptor.length && descriptor[index] !== ")") {
    const parsed = parseJvmType(descriptor, index);
    parameters.push(parsed.type);
    if (parsed.next <= index) break;
    index = parsed.next;
  }

  if (descriptor[index] !== ")") {
    return { parameters, returnType: "?", valid: false };
  }

  const returned = parseJvmType(descriptor, index + 1);
  return { parameters, returnType: returned.type, valid: true };
}

function simpleClassName(className: string) {
  const normalized = className.replace(/\//g, ".").replace(/\$/g, ".");
  const parts = normalized.split(".");
  const firstClassIndex = parts.findIndex((part) => /^[A-Z]/.test(part));
  return firstClassIndex >= 0 ? parts.slice(firstClassIndex).join(".") : parts.at(-1) ?? normalized;
}

function formatSourceMethod(methodName: string, descriptor: string) {
  const parsed = parseJvmMethodDescriptor(descriptor);
  if (!parsed.valid) return `${methodName}${descriptor}`;
  const params = parsed.parameters.map(shortJavaType).join(", ");
  return `${methodName}(${params}) → ${shortJavaType(parsed.returnType)}`;
}

function formatTargetReference(target: string) {
  if (target.startsWith("descriptor ")) {
    const descriptor = target.slice("descriptor ".length);
    const parsed = parseJvmMethodDescriptor(descriptor);
    if (!parsed.valid) return `Firma ${descriptor}`;
    return `Firma (${parsed.parameters.map(shortJavaType).join(", ")}) → ${shortJavaType(parsed.returnType)}`;
  }

  const paren = target.indexOf("(");
  if (paren >= 0) {
    const ownerAndMethod = target.slice(0, paren);
    const descriptor = target.slice(paren);
    const lastDot = ownerAndMethod.lastIndexOf(".");
    if (lastDot >= 0) {
      const owner = simpleClassName(ownerAndMethod.slice(0, lastDot));
      const method = ownerAndMethod.slice(lastDot + 1);
      const parsed = parseJvmMethodDescriptor(descriptor);
      if (parsed.valid) {
        return `${owner}.${method}(${parsed.parameters.map(shortJavaType).join(", ")}) → ${shortJavaType(parsed.returnType)}`;
      }
    }
  }

  return target.replace(/\//g, ".").replace(/\$/g, ".");
}

function usageLabel(usage: string) {
  const labels: Record<string, string> = {
    "invocación": "Invocación",
    campo: "Campo",
    tipo: "Tipo",
    "instanciación": "Instanciación",
    firma: "Firma",
  };
  return labels[usage] ?? usage;
}

function groupMethods(methods: ConsoleAnalysisResult["methods"]): MethodGroup[] {
  const groups = new Map<string, MethodGroup>();
  for (const method of methods) {
    const key = `${method.className}#${method.methodName}${method.descriptor}`;
    const current = groups.get(key);
    if (current) {
      if (!current.references.some((item) => item.usage === method.usage && item.target === method.target)) {
        current.references.push(method);
      }
      continue;
    }
    groups.set(key, {
      key,
      className: method.className,
      methodName: method.methodName,
      descriptor: method.descriptor,
      classPath: method.classPath,
      references: [method],
    });
  }
  return Array.from(groups.values());
}

function groupImports(imports: ConsoleAnalysisResult["imports"]): ImportGroup[] {
  const groups = new Map<string, ConsoleAnalysisResult["imports"]>();
  for (const item of imports) {
    const current = groups.get(item.sourcePath) ?? [];
    current.push(item);
    groups.set(item.sourcePath, current);
  }
  return Array.from(groups.entries()).map(([sourcePath, items]) => ({ sourcePath, imports: items }));
}

function reportCheck(check: ConsoleAnalysisResult["checks"]["pom"], showOptional = false) {
  if (!check.requested) return "— No solicitado";
  if (!check.found) return "✗ No encontrado";
  const matches = `✓ Encontrado · ${check.matchCount} coincidencia(s)`;
  if (!showOptional || check.optionalResolution == null) return matches;
  return `${matches} · resolution:=optional: ${check.optionalResolution ? "Sí" : "No"}`;
}

function bulletList(items: string[], multiline: boolean) {
  if (!items.length) return "—";
  return multiline
    ? items.map((item) => `• ${item}`).join("\n")
    : items.map((item) => `• ${item}`).join("  ");
}

function formatImportsForReport(result: ConsoleAnalysisResult, multiline: boolean) {
  const items = result.imports.map(
    (item) => `${item.statement}  ↳ ${item.sourcePath}:${item.lineNumber}`
  );
  return bulletList(items, multiline);
}

function formatMethodsForReport(result: ConsoleAnalysisResult, multiline: boolean) {
  const groups = groupMethods(result.methods);
  if (!groups.length) return "—";

  return groups
    .map((group, index) => {
      const title = `${index + 1}. ${simpleClassName(group.className)}#${formatSourceMethod(group.methodName, group.descriptor)}`;
      const refs = group.references.map(
        (reference) => `${usageLabel(reference.usage)}: ${formatTargetReference(reference.target)}`
      );
      if (multiline) {
        return [
          title,
          ...refs.map((reference) => `   • ${reference}`),
          `   ↳ ${group.classPath}`,
        ].join("\n");
      }
      return `${title}  ${refs.map((reference) => `• ${reference}`).join("  ")}  ↳ ${group.classPath}`;
    })
    .join(multiline ? "\n\n" : "   ");
}

function buildReportRows(results: ConsoleAnalysisResult[], multilineDetails: boolean): ReportRow[] {
  return results.map((result) => {
    const paths = Array.from(
      new Set([
        ...result.checks.pom.paths,
        ...result.checks.manifest.paths,
        ...result.checks.project.paths,
        ...result.checks.methods.paths,
        ...result.checks.imports.paths,
      ])
    );
    const methodGroups = groupMethods(result.methods);

    return {
      Entorno: result.environment,
      Tipo: result.componentType,
      Componente: result.jarName,
      Estado:
        result.status === "error"
          ? "✗ Error"
          : result.status === "ok"
            ? "✓ Encontrado"
            : "— Sin coincidencia",
      Dependencia: result.dependency,
      "POM / optional": reportCheck(result.checks.pom, true),
      "MANIFEST / optional": reportCheck(result.checks.manifest, true),
      "Todo JAR": reportCheck(result.checks.project),
      "Imports Java": result.checks.imports.requested
        ? `${result.imports.length} import(s)${result.importsTruncated ? "+" : ""}`
        : "— No solicitado",
      "Imports Java (detalle)": formatImportsForReport(result, multilineDetails),
      "Métodos únicos": methodGroups.length,
      "Referencias bytecode": result.methods.length,
      "Métodos (detalle)": formatMethodsForReport(result, multilineDetails),
      "Ruta bucket": result.bucketPath,
      "Rutas con coincidencias": bulletList(paths, multilineDetails),
      Tamaño: formatBytes(result.sizeBytes),
      Duración: `${(result.durationMs / 1000).toFixed(2)} s`,
      Error: result.error ?? "",
    };
  });
}

function cleanInlineReportCell(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function reportToTsv(results: ConsoleAnalysisResult[]) {
  const rows = buildReportRows(results, false);
  const lines = [REPORT_COLUMNS.join("\t")];
  for (const row of rows) {
    lines.push(REPORT_COLUMNS.map((column) => cleanInlineReportCell(row[column])).join("\t"));
  }
  return lines.join("\r\n");
}

function csvCell(value: unknown) {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "    ")
    .trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function resultsToCsv(results: ConsoleAnalysisResult[]) {
  const rows = buildReportRows(results, true);
  const lines = [REPORT_COLUMNS.map(csvCell).join(";")];
  for (const row of rows) {
    lines.push(REPORT_COLUMNS.map((column) => csvCell(row[column])).join(";"));
  }
  // BOM + separador ';' y celdas multilínea para una lectura más clara en Excel.
  return `\uFEFFsep=;\r\n${lines.join("\r\n")}`;
}

export default function DescargaConsolaOperaciones() {
  const { sessionCookie, setSessionCookie } = useSessionCookie();
  const [showCookie, setShowCookie] = useState(false);
  const [environments, setEnvironments] = useState<ConsoleEnvironment[]>(["AUS"]);
  const [defaultType, setDefaultType] = useState<ComponentType>("TRX");
  const [componentsText, setComponentsText] = useState("KARCT001-01-MX.jar");
  const [dependency, setDependency] = useState("org.apache.log4j");
  const [options, setOptions] = useState<AnalysisOption[]>(["pom", "manifest"]);
  const [concurrency, setConcurrency] = useState("3");
  const [results, setResults] = useState<ConsoleAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState("");
  const [detailResult, setDetailResult] = useState<ConsoleAnalysisResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const components = useMemo(
    () => parseComponents(componentsText, defaultType),
    [componentsText, defaultType]
  );

  const filteredResults = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return results;
    return results.filter((result) =>
      [
        result.environment,
        result.componentType,
        result.jarName,
        result.bucketPath,
        result.dependency,
        result.status,
        result.error ?? "",
        ...result.checks.pom.paths,
        ...result.checks.manifest.paths,
        ...result.checks.project.paths,
        ...result.checks.imports.paths,
        ...result.imports.map((item) => `${item.statement} ${item.sourcePath} ${item.lineNumber}`),
        ...result.methods.map((method) => `${method.className} ${method.methodName} ${method.target}`),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [filter, results]);

  const toggleEnvironment = (environment: ConsoleEnvironment) => {
    setEnvironments((current) =>
      current.includes(environment)
        ? current.filter((value) => value !== environment)
        : [...current, environment]
    );
  };

  const toggleOption = (option: AnalysisOption) => {
    setOptions((current) =>
      current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option]
    );
  };

  const handleAnalyze = async () => {
    if (!environments.length) {
      toast.error("Selecciona al menos un entorno.");
      return;
    }
    if (!components.length) {
      toast.error("Agrega al menos un componente/JAR.");
      return;
    }
    if (!dependency.trim()) {
      toast.error("Indica la dependencia o paquete que deseas buscar.");
      return;
    }
    if (!options.length) {
      toast.error("Selecciona al menos un tipo de análisis.");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const expectedTotal = environments.length * components.length;
    setLoading(true);
    setResults([]);
    setCompleted(0);
    setTotal(expectedTotal);

    try {
      const finalResults = await analyzeConsoleComponents({
        environments,
        components,
        dependency: dependency.trim(),
        options,
        sessionCookie: sessionCookie.trim(),
        concurrency: Number(concurrency),
        signal: controller.signal,
        onProgress: ({ completed: done, result }) => {
          setCompleted(done);
          setResults((current) => {
            const next = current.filter((item) => item.key !== result.key);
            return [...next, result].sort((a, b) => a.key.localeCompare(b.key));
          });
        },
      });

      if (controller.signal.aborted) {
        toast.info("Análisis cancelado. Se conservaron los resultados ya terminados.");
      } else {
        setResults(finalResults);
        const errors = finalResults.filter((result) => result.status === "error").length;
        if (errors) {
          toast.warning(`Análisis terminado con ${errors} JAR(s) con error.`);
        } else {
          toast.success(`Análisis terminado: ${finalResults.length} JAR(s) procesados.`);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error durante el análisis");
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  const handleCopy = async () => {
    if (!filteredResults.length) {
      toast.error("No hay resultados para copiar.");
      return;
    }
    await navigator.clipboard.writeText(reportToTsv(filteredResults));
    toast.success("Informe copiado con métodos agrupados, viñetas y columnas listas para Excel/Sheets.");
  };

  const handleDownloadCsv = () => {
    if (!filteredResults.length) {
      toast.error("No hay resultados para exportar.");
      return;
    }
    const blob = new Blob([resultsToCsv(filteredResults)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `descarga_consola_operaciones_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen gradient-mesh">
      <main className="mx-auto flex w-full max-w-[1880px] flex-col gap-6 px-6 py-6">
        <section className="rounded-3xl border border-border/70 bg-card/95 p-6 shadow-sm">
          <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <FileArchive className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-foreground">Descarga Consola de Operaciones</h2>
                  <p className="text-sm text-muted-foreground">
                    Descarga JARs en tiempo de ejecución e inspecciona POM, MANIFEST, clases y métodos sin descompilar todo innecesariamente.
                  </p>
                </div>
              </div>
            </div>
            <Badge variant="outline" className="w-fit font-mono">
              {components.length} componente(s) · {environments.length} entorno(s) · {components.length * environments.length} descarga(s)
            </Badge>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <div className="space-y-2 xl:col-span-12">
              <Label>Cookie de sesión (fallback)</Label>
              <div className="relative">
                <Input
                  type={showCookie ? "text" : "password"}
                  value={sessionCookie}
                  onChange={(event) => setSessionCookie(event.target.value)}
                  placeholder="Opcional: Cookie APX para fallback si la sesión directa no está disponible"
                  className="h-11 rounded-2xl pr-11 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowCookie((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showCookie ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Primero se usa el endpoint APX real con la sesión del navegador. Esta cookie solo se envía al proxy como fallback.
              </p>
            </div>

            <div className="space-y-2 xl:col-span-3">
              <Label>Entornos</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 w-full justify-between rounded-2xl font-mono text-xs">
                    {environmentLabel(environments)}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72">
                  <DropdownMenuLabel>Selecciona uno o varios entornos</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={environments.length === ENVIRONMENTS.length}
                    onCheckedChange={() =>
                      setEnvironments((current) =>
                        current.length === ENVIRONMENTS.length
                          ? []
                          : ENVIRONMENTS.map((item) => item.value)
                      )
                    }
                    onSelect={(event) => event.preventDefault()}
                    className="font-medium"
                  >
                    Todos los entornos
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {ENVIRONMENTS.map((environment) => (
                    <DropdownMenuCheckboxItem
                      key={environment.value}
                      checked={environments.includes(environment.value)}
                      onCheckedChange={() => toggleEnvironment(environment.value)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {environment.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="space-y-2 xl:col-span-3">
              <Label>Tipo por defecto</Label>
              <Select value={defaultType} onValueChange={(value) => setDefaultType(value as ComponentType)}>
                <SelectTrigger className="h-11 rounded-2xl font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPONENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label} · {type.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 xl:col-span-4">
              <Label>Dependencia / paquete a buscar</Label>
              <Input
                value={dependency}
                onChange={(event) => setDependency(event.target.value)}
                placeholder="org.apache.log4j"
                className="h-11 rounded-2xl font-mono text-xs"
              />
            </div>

            <div className="space-y-2 xl:col-span-2">
              <Label>Concurrencia</Label>
              <Select value={concurrency} onValueChange={setConcurrency}>
                <SelectTrigger className="h-11 rounded-2xl font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} JAR{value > 1 ? "s" : ""} en paralelo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 xl:col-span-8">
              <div className="flex items-center justify-between gap-3">
                <Label>Lista de componentes</Label>
                <span className="text-xs text-muted-foreground">
                  Formato opcional: <code>TRX|KARCT001-01-MX.jar</code>
                </span>
              </div>
              <Textarea
                value={componentsText}
                onChange={(event) => setComponentsText(event.target.value)}
                placeholder={[
                  "TRX|KARCT001-01-MX.jar",
                  "JOB|KARCR002.jar",
                  "ONLINE_LIB|MPEZR005",
                  "BATCH_LIB|MPEZR001",
                  "DTO|KARCC001.jar",
                ].join("\n")}
                className="min-h-36 rounded-2xl font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Si una línea no trae tipo, usa “{COMPONENT_TYPES.find((item) => item.value === defaultType)?.label}”. También acepta <code>TRX KARCT001-01-MX.jar</code> y endpoints completos. Para librerías se prueban automáticamente las variantes <code>XXX.jar</code> / <code>XXXIMPL.jar</code>. Se eliminan duplicados automáticamente.
              </p>
              {components.length ? (
                <div className="rounded-xl border bg-muted/30 p-3 text-[11px]">
                  <div className="mb-1 font-semibold text-foreground">Rutas resueltas</div>
                  {components.slice(0, 5).map((component) => {
                    const paths = buildComponentBucketPathCandidates(component.type, component.jarName);
                    return (
                      <div key={component.id} className="truncate font-mono text-muted-foreground">
                        {component.type} → {paths.join(" → fallback: ")}
                      </div>
                    );
                  })}
                  {components.length > 5 ? (
                    <div className="mt-1 text-muted-foreground">+ {components.length - 5} componente(s) más</div>
                  ) : null}
                  {environments.length === 1 && components.length === 1 ? (
                    <div className="mt-2 space-y-1 border-t pt-2 font-mono text-muted-foreground">
                      {buildComponentBucketPathCandidates(components[0].type, components[0].jarName).map((path, index) => {
                        const candidateJar = path.slice(path.lastIndexOf("/") + 1);
                        return (
                          <div key={path} className="break-all">
                            {index === 0 ? "APX real" : "Fallback nombre"} → {buildConsoleDownloadUrl(environments[0], components[0].type, candidateJar)}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 xl:col-span-4">
              <Label>Análisis a ejecutar</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-11 w-full justify-between rounded-2xl">
                    <span className="truncate text-xs">{analysisLabel(options)}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[420px] max-w-[90vw]">
                  <DropdownMenuLabel>Puedes ejecutar más de uno en la misma descarga</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={options.length === ANALYSIS_OPTIONS.length}
                    onCheckedChange={() =>
                      setOptions((current) =>
                        current.length === ANALYSIS_OPTIONS.length
                          ? []
                          : ANALYSIS_OPTIONS.map((item) => item.value)
                      )
                    }
                    onSelect={(event) => event.preventDefault()}
                    className="font-medium"
                  >
                    Todos los análisis
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  {ANALYSIS_OPTIONS.map((option) => (
                    <DropdownMenuCheckboxItem
                      key={option.value}
                      checked={options.includes(option.value)}
                      onCheckedChange={() => toggleOption(option.value)}
                      onSelect={(event) => event.preventDefault()}
                      className="items-start py-2"
                    >
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="max-w-sm whitespace-normal text-xs text-muted-foreground">
                          {option.description}
                        </div>
                      </div>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="rounded-2xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground">
                <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <ListChecks className="h-4 w-4" /> Estrategia rápida
                </div>
                POM/MANIFEST no recorren clases. “Métodos” analiza bytecode directamente para evitar descompilar cada JAR completo.
              </div>
            </div>

            <div className="flex flex-wrap gap-3 xl:col-span-12">
              <Button onClick={handleAnalyze} disabled={loading} className="rounded-2xl">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Analizar JARs
              </Button>
              {loading ? (
                <Button variant="destructive" onClick={handleCancel} className="rounded-2xl">
                  <Square className="mr-2 h-4 w-4" /> Cancelar
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        {loading || total > 0 ? (
          <section className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">Procesados {completed} de {total}</span>
              <span className="text-muted-foreground">{total ? Math.round((completed / total) * 100) : 0}%</span>
            </div>
            <Progress value={total ? (completed / total) * 100 : 0} />
          </section>
        ) : null}

        <section className="rounded-3xl border border-border/70 bg-card/95 shadow-sm">
          <div className="flex flex-col gap-4 border-b border-border/60 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-bold">Resultados del análisis</h3>
              <p className="text-sm text-muted-foreground">
                Checklist por JAR con rutas exactas, imports Java literales y lista de métodos cuando se solicita análisis de bytecode.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filtrar resultados..."
                  className="h-10 rounded-xl pl-9"
                />
              </div>
              <Button variant="outline" onClick={handleCopy} className="rounded-xl">
                <ClipboardCopy className="mr-2 h-4 w-4" /> Copiar
              </Button>
              <Button variant="outline" onClick={handleDownloadCsv} className="rounded-xl">
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entorno</TableHead>
                <TableHead>Componente</TableHead>
                <TableHead>pom.xml</TableHead>
                <TableHead>MANIFEST.MF</TableHead>
                <TableHead>Todo JAR</TableHead>
                <TableHead>Métodos</TableHead>
                <TableHead>Imports Java</TableHead>
                <TableHead>Ruta / tamaño</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!filteredResults.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                    {loading ? "Los resultados aparecerán conforme termine cada JAR..." : "Todavía no hay resultados."}
                  </TableCell>
                </TableRow>
              ) : (
                filteredResults.map((result) => (
                  <TableRow key={result.key}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">{result.environment}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{result.jarName}</div>
                      <div className="text-xs text-muted-foreground">{result.componentType}</div>
                    </TableCell>
                    <TableCell>{statusCell(result.checks.pom, true)}</TableCell>
                    <TableCell>{statusCell(result.checks.manifest, true)}</TableCell>
                    <TableCell>{statusCell(result.checks.project)}</TableCell>
                    <TableCell>
                      {result.checks.methods.requested ? (
                        result.methods.length ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs font-medium">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              {groupMethods(result.methods).length} método(s)
                            </div>
                            <div className="pl-6 text-[11px] text-muted-foreground">
                              {result.methods.length}{result.methodsTruncated ? "+" : ""} referencia(s)
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <XCircle className="h-4 w-4" /> Ninguno
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">No solicitado</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {result.checks.imports.requested ? (
                        result.imports.length ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-xs font-medium">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              {result.imports.length}{result.importsTruncated ? "+" : ""} import(s)
                            </div>
                            <div className="pl-6 text-[11px] text-muted-foreground">
                              {groupImports(result.imports).length} archivo(s)
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <XCircle className="h-4 w-4" /> Ninguno
                          </div>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Automático</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate font-mono text-[11px]" title={result.bucketPath}>{result.bucketPath}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatBytes(result.sizeBytes)} · {(result.durationMs / 1000).toFixed(1)}s
                      </div>
                    </TableCell>
                    <TableCell>
                      {result.status === "error" ? (
                        <Badge variant="destructive">Error</Badge>
                      ) : result.status === "ok" ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">Encontrado</Badge>
                      ) : (
                        <Badge variant="secondary">Sin coincidencia</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setDetailResult(result)}>
                        <FileCode2 className="mr-2 h-4 w-4" /> Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </section>
      </main>

      <Dialog open={Boolean(detailResult)} onOpenChange={(open) => !open && setDetailResult(null)}>
        <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
          {detailResult ? (
            <>
              <DialogHeader>
                <DialogTitle>{detailResult.jarName}</DialogTitle>
                <DialogDescription>
                  {detailResult.environment} · {detailResult.componentType} · {detailResult.bucketPath}
                  <span className="mt-1 block break-all font-mono text-[10px] text-muted-foreground">
                    {detailResult.downloadUrl}
                  </span>
                </DialogDescription>
              </DialogHeader>

              {detailResult.error ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                  <div className="mb-1 flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" /> Error
                  </div>
                  {detailResult.error}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                {(["pom", "manifest", "project", "methods", "imports"] as const).map((key) => {
                  const check = detailResult.checks[key];
                  return (
                    <div key={key} className="rounded-2xl border border-border/60 p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="font-semibold">{key === "imports" ? "Imports Java" : ANALYSIS_OPTIONS.find((item) => item.value === key)?.label}</div>
                        {check.requested ? (
                          check.found ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-muted-foreground" />
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {check.requested ? `${check.matchCount} coincidencia(s)` : "No solicitado"}
                      </div>
                      {(key === "pom" || key === "manifest") && check.optionalResolution !== null && check.optionalResolution !== undefined ? (
                        <div className="mt-2 text-sm">
                          <span className="font-medium">resolution:=optional:</span> {check.optionalResolution ? "Sí" : "No"}
                        </div>
                      ) : null}
                      {check.paths.length ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <FolderOpen className="h-3.5 w-3.5" /> Rutas
                          </div>
                          <ul className="space-y-1.5">
                            {check.paths.slice(0, 30).map((path) => (
                              <li key={path} className="flex items-start gap-2">
                                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                                <span className="break-all font-mono text-[11px]">{path}</span>
                              </li>
                            ))}
                          </ul>
                          {check.paths.length > 30 ? <div className="text-xs text-muted-foreground">+ {check.paths.length - 30} rutas adicionales</div> : null}
                        </div>
                      ) : null}
                      {check.details.length ? (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Braces className="h-3.5 w-3.5" /> Coincidencias
                          </div>
                          <ul className="space-y-1.5">
                            {check.details.slice(0, 20).map((detail, index) => (
                              <li key={`${detail}-${index}`} className="flex items-start gap-2 rounded-lg bg-muted/35 p-2">
                                <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                                <span className="break-all font-mono text-[11px]">{detail}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {detailResult.imports.length ? (
                <div className="overflow-hidden rounded-2xl border border-border/60">
                  <div className="border-b border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center gap-2 font-semibold">
                      <FileText className="h-4 w-4 text-primary" />
                      Imports Java relacionados con {detailResult.dependency}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {detailResult.imports.length}{detailResult.importsTruncated ? "+ (lista limitada para proteger el navegador)" : ""} import(s) en {groupImports(detailResult.imports).length} archivo(s)
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    {groupImports(detailResult.imports).map((group) => (
                      <div key={group.sourcePath} className="overflow-hidden rounded-xl border border-border/60 bg-background">
                        <div className="flex flex-col gap-2 border-b border-border/50 bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-2">
                            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="break-all font-mono text-[11px] font-medium">{group.sourcePath}</span>
                          </div>
                          <Badge variant="secondary" className="w-fit shrink-0">{group.imports.length} import(s)</Badge>
                        </div>
                        <ul className="divide-y divide-border/40">
                          {group.imports.map((item, index) => (
                            <li key={`${item.sourcePath}-${item.lineNumber}-${index}`} className="flex items-start gap-3 px-4 py-3">
                              <span className="mt-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                                {item.lineNumber}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  {item.staticImport ? "Import static" : "Import"}
                                </div>
                                <code className="block break-all rounded-lg bg-muted/45 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                                  {item.statement}
                                </code>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {detailResult.methods.length ? (
                <div className="overflow-hidden rounded-2xl border border-border/60">
                  <div className="border-b border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center gap-2 font-semibold">
                      <PackageSearch className="h-4 w-4 text-primary" />
                      Métodos relacionados con {detailResult.dependency}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {groupMethods(detailResult.methods).length} método(s) · {detailResult.methods.length}{detailResult.methodsTruncated ? "+" : ""} referencia(s) de bytecode
                    </div>
                  </div>
                  <div className="space-y-4 p-4">
                    {groupMethods(detailResult.methods).map((group, groupIndex) => (
                      <article key={group.key} className="overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
                        <div className="border-b border-border/50 bg-muted/20 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">Método {groupIndex + 1}</Badge>
                                <Badge variant="secondary">{group.references.length} referencia(s)</Badge>
                              </div>
                              <div>
                                <div className="break-all font-mono text-xs text-muted-foreground">{group.className}</div>
                                <div className="mt-1 break-words font-mono text-sm font-semibold text-foreground">
                                  {formatSourceMethod(group.methodName, group.descriptor)}
                                </div>
                              </div>
                            </div>
                            <div className="flex max-w-xl items-start gap-2 rounded-xl bg-muted/35 px-3 py-2 text-[11px] text-muted-foreground">
                              <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="break-all font-mono">{group.classPath}</span>
                            </div>
                          </div>
                        </div>

                        <div className="p-4">
                          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Braces className="h-3.5 w-3.5" /> Referencias encontradas
                          </div>
                          <ul className="space-y-2">
                            {group.references.map((reference, referenceIndex) => (
                              <li key={`${reference.usage}-${reference.target}-${referenceIndex}`} className="flex items-start gap-3 rounded-xl border border-border/50 bg-muted/15 p-3">
                                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                                <div className="min-w-0 flex-1">
                                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className="text-[10px]">{usageLabel(reference.usage)}</Badge>
                                    <span className="text-[10px] text-muted-foreground">Referencia {referenceIndex + 1}</span>
                                  </div>
                                  <div className="flex min-w-0 items-start gap-2 font-mono text-[11px] leading-relaxed">
                                    <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="break-all">{formatTargetReference(reference.target)}</span>
                                  </div>
                                  <details className="mt-2 text-[10px] text-muted-foreground">
                                    <summary className="cursor-pointer select-none hover:text-foreground">Ver descriptor JVM original</summary>
                                    <code className="mt-1 block break-all rounded-md bg-muted/40 p-2 font-mono">{reference.target}</code>
                                  </details>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}