import type { RawSpan } from "@/types/bbva";

/** RHO puede entregar los tiempos como números, texto, ISO-8601 o nanosegundos. */
type TimeUnit = "ns" | "us" | "ms" | "s";
type SpanWithTiming = RawSpan & Record<string, unknown>;

const TIMESTAMP_PAIRS: Array<[string, string, TimeUnit | null]> = [
  ["startTimeUnixNano", "endTimeUnixNano", "ns"],
  ["startTimestampNano", "endTimestampNano", "ns"],
  ["startDate", "finishDate", null],
  ["startDate", "endDate", null],
  ["startTime", "endTime", null],
  ["startTimestamp", "endTimestamp", null],
];

const EXPLICIT_DURATIONS: Array<[string, TimeUnit]> = [
  ["durationMs", "ms"],
  ["durationMillis", "ms"],
  ["durationMilliseconds", "ms"],
  ["durationUs", "us"],
  ["durationMicros", "us"],
  ["durationMicroseconds", "us"],
  ["durationNs", "ns"],
  ["durationNanos", "ns"],
  ["durationNanoseconds", "ns"],
  ["durationSeconds", "s"],
  ["durationSec", "s"],
];

function spanValue(span: RawSpan, name: string): unknown {
  const root = (span as SpanWithTiming)[name];
  if (root !== undefined && root !== null && root !== "") return root;
  return span.properties?.[name];
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toMilliseconds(value: number, unit: TimeUnit): number {
  switch (unit) {
    case "ns": return value / 1_000_000;
    case "us": return value / 1_000;
    case "s": return value * 1_000;
    default: return value;
  }
}

function timestampUnit(value: number): TimeUnit {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e17) return "ns";
  if (magnitude >= 1e14) return "us";
  if (magnitude >= 1e11) return "ms";
  if (magnitude >= 1e9) return "s";
  return "ms"; // Tiempos relativos sin epoch explícito.
}

function timestampDifferenceMs(start: unknown, end: unknown, unitHint: TimeUnit | null): number | null {
  if (start == null || end == null || start === "" || end === "") return null;

  const startNumber = numericValue(start);
  const endNumber = numericValue(end);

  if (startNumber !== null && endNumber !== null) {
    const unit = unitHint ?? timestampUnit(Math.max(Math.abs(startNumber), Math.abs(endNumber)));
    const startText = String(start).trim();
    const endText = String(end).trim();

    // BigInt evita perder milisegundos al restar epochs en nanosegundos (19 dígitos).
    if (/^[+-]?\d+$/.test(startText) && /^[+-]?\d+$/.test(endText)) {
      const difference = BigInt(endText) - BigInt(startText);
      if (difference < 0n) return null;
      return toMilliseconds(Number(difference), unit);
    }

    const difference = endNumber - startNumber;
    return difference >= 0 ? toMilliseconds(difference, unit) : null;
  }

  if (typeof start !== "string" || typeof end !== "string") return null;
  const startMillis = Date.parse(start);
  const endMillis = Date.parse(end);
  if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis) || endMillis < startMillis) return null;
  return endMillis - startMillis;
}

function declaredDurationMs(value: unknown, unit: TimeUnit): number | null {
  const numeric = numericValue(value);
  if (numeric === null || numeric < 0) return null;
  return toMilliseconds(numeric, unit);
}

function genericDurationMs(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const formatted = trimmed.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(ns|us|µs|μs|ms|s)$/i);
    if (formatted) {
      const amount = Number(formatted[1]);
      const unit = formatted[2].toLowerCase();
      return declaredDurationMs(amount, unit === "µs" || unit === "μs" ? "us" : unit as TimeUnit);
    }
    const isoDuration = trimmed.match(/^PT(\d+(?:\.\d+)?)S$/i);
    if (isoDuration) return declaredDurationMs(isoDuration[1], "s");
  }

  const duration = numericValue(value);
  if (duration === null || duration < 0) return null;

  // Convenio legado de RHO: magnitudes mayores se expresan en ns/us,
  // fracciones de segundo se convierten a ms y el resto ya representa ms.
  if (duration >= 1_000_000) return duration / 1_000_000;
  if (duration >= 1_000) return duration / 1_000;
  if (duration > 0 && duration < 1) return duration * 1_000;
  return duration;
}

/**
 * Devuelve null cuando RHO no proporciona una duración interpretable.
 * No confundir "desconocida" con 0 ms: falsearía las sumas del trace AWS.
 */
export function readTraceSpanDurationMs(span: RawSpan): number | null {
  let zeroTimestamp: number | null = null;

  for (const [startName, endName, unit] of TIMESTAMP_PAIRS) {
    const difference = timestampDifferenceMs(spanValue(span, startName), spanValue(span, endName), unit);
    if (difference === null) continue;
    if (difference > 0) return difference;
    zeroTimestamp = 0;
  }

  for (const [name, unit] of EXPLICIT_DURATIONS) {
    const duration = declaredDurationMs(spanValue(span, name), unit);
    if (duration !== null) return duration;
  }

  const generic = genericDurationMs(spanValue(span, "duration"));
  if (generic !== null) return generic;
  return zeroTimestamp;
}

/**
 * Tiempo de respuesta de UNA ejecución, tomado de su span Transaction/Job.
 * No se sustituye por la suma de tiempos de sus utilidades (podrían solaparse).
 * Si no hay un span de transacción identificable, el dato es N/D.
 */
export function readTraceTransactionDurationMs(
  trace: RawSpan | RawSpan[] | null | undefined,
  invokerTx: string,
  channelCodes: string[] = [],
): number | null {
  if (!trace) return null;

  const pending = Array.isArray(trace) ? [...trace] : [trace];
  const visited = new WeakSet<object>();
  const selected = new Set(channelCodes.map((code) => code.trim()).filter(Boolean));
  const expectedName = invokerTx.trim().toUpperCase();
  let selectedDuration: number | null = null;
  let bestScore = -1;

  while (pending.length) {
    const span = pending.pop();
    if (!span || typeof span !== "object" || visited.has(span)) continue;
    visited.add(span);
    if (Array.isArray(span.children)) pending.push(...span.children);

    const name = String(span.name ?? "").trim().toUpperCase();
    const type = String(span.properties?.type ?? "").trim().toUpperCase();
    const isTransaction = /^(TRANSACTION|TRX|JOB|BATCH)$/.test(type);
    const nameMatches = Boolean(expectedName) && name === expectedName;
    if (!isTransaction && !nameMatches) continue;

    const channel = String(span.properties?.["channel-code"] ?? span.properties?.channelCode ?? "").trim();
    if (selected.size && channel && !selected.has(channel)) continue;

    const duration = readTraceSpanDurationMs(span);
    if (duration === null) continue;

    // Preferir el nodo real de la transacción y no un contenedor homónimo.
    const score = (nameMatches ? 4 : 0) + (isTransaction ? 2 : 0) + (channel && selected.has(channel) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      selectedDuration = duration;
    }
  }

  return selectedDuration;
}
